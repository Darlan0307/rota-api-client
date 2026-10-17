import { type LookupAddress, lookup } from 'node:dns';
import { openAsBlob } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { isIP, type LookupFunction, connect as netConnect, type Socket } from 'node:net';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { connect as tlsConnect } from 'node:tls';
import {
  Agent,
  type buildConnector,
  type Dispatcher,
  FormData,
  interceptors,
  ProxyAgent,
  request,
} from 'undici';
import type { PreparedRequest } from './prepare';

export interface ProxySettings {
  enabled: boolean;
  /** Ex.: http://proxy.empresa:8080 (aceita usuário:senha@). */
  url: string;
  /** Hosts que não passam pelo proxy, separados por vírgula ("localhost, *.interno"). */
  bypass: string;
}

export interface ResponseTimings {
  /** Resolução de DNS (ms). Ausente quando não houve nova conexão (ou via proxy). */
  dns?: number;
  tcp?: number;
  tls?: number;
  /** Do início até o primeiro byte da resposta (headers). */
  ttfb: number;
  /** Leitura do body. */
  download: number;
  total: number;
}

export interface ResponseBody {
  encoding: 'utf8' | 'base64';
  data: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ResponseBody;
  sizeBytes: number;
  timings: ResponseTimings;
  /** Corpo truncado por exceder o limite. */
  truncated: boolean;
}

export type HttpErrorCode =
  | 'aborted'
  | 'timeout'
  | 'dns'
  | 'refused'
  | 'reset'
  | 'tls'
  | 'invalid-url'
  | 'file'
  | 'unknown';

export class HttpError extends Error {
  constructor(
    readonly code: HttpErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ExecuteOptions {
  signal?: AbortSignal;
  proxy?: ProxySettings;
  /** Limite do body lido para memória (bytes). Padrão: 50 MB. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 50 * 1024 * 1024;

export async function executeRequest(
  prepared: PreparedRequest,
  options: ExecuteOptions = {},
): Promise<HttpResponse> {
  let url: URL;
  try {
    url = new URL(prepared.url);
  } catch {
    throw new HttpError('invalid-url', `URL inválida: "${prepared.url}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError('invalid-url', `Protocolo não suportado: ${url.protocol}`);
  }

  const timings: Partial<ResponseTimings> = {};
  const { dispatcher, close } = createDispatcher(url, prepared, options.proxy, timings);

  const signals = [options.signal].filter((s): s is AbortSignal => s !== undefined);
  const timeoutSignal =
    prepared.settings.timeoutMs > 0 ? AbortSignal.timeout(prepared.settings.timeoutMs) : undefined;
  if (timeoutSignal) signals.push(timeoutSignal);
  const signal = signals.length ? AbortSignal.any(signals) : undefined;

  const start = performance.now();
  try {
    const body = await buildBody(prepared);
    const res = await request(url, {
      method: prepared.method,
      headers: prepared.headers.flat(),
      body,
      dispatcher,
      ...(signal ? { signal } : {}),
    });
    const headersAt = performance.now();

    const { data, size, truncated } = await readBody(res.body, options.maxBodyBytes ?? DEFAULT_MAX_BODY);
    const end = performance.now();

    const headers = flattenHeaders(res.headers);
    const contentType = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];

    return {
      status: res.statusCode,
      statusText: STATUS_CODES[res.statusCode] ?? '',
      headers,
      body: encodeBody(data, contentType),
      sizeBytes: size,
      truncated,
      timings: {
        ...timings,
        ttfb: round(headersAt - start),
        download: round(end - headersAt),
        total: round(end - start),
      },
    };
  } catch (error) {
    throw toHttpError(error, url, prepared, timeoutSignal);
  } finally {
    void close();
  }
}

// ---------------------------------------------------------------------------
// Conexão

function createDispatcher(
  url: URL,
  prepared: PreparedRequest,
  proxy: ProxySettings | undefined,
  timings: Partial<ResponseTimings>,
): { dispatcher: Dispatcher; close: () => Promise<void> } {
  const verify = prepared.settings.verifySsl;
  let base: Agent | ProxyAgent;

  if (proxy?.enabled && proxy.url.trim() !== '' && !isBypassed(url.hostname, proxy.bypass)) {
    base = new ProxyAgent({
      uri: proxy.url.trim(),
      requestTls: { rejectUnauthorized: verify },
    });
  } else {
    // Agente novo por requisição: cada envio mede a conexão completa.
    base = new Agent({ connect: timedConnector(verify, timings), pipelining: 0 });
  }

  const composed = [interceptors.decompress()];
  if (prepared.settings.followRedirects) composed.unshift(interceptors.redirect({ maxRedirections: 10 }));
  return { dispatcher: base.compose(...composed), close: () => base.close() };
}

function timedConnector(verifySsl: boolean, timings: Partial<ResponseTimings>): buildConnector.connector {
  return (opts, callback) => {
    let done = false;
    const finish = (error: Error | null, socket?: Socket) => {
      if (done) return;
      done = true;
      if (error) callback(error, null);
      else if (socket) callback(null, socket);
    };

    const hostname = opts.hostname.replace(/^\[|\]$/g, '');
    const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
    const dnsStart = performance.now();

    lookup(hostname, { all: true }, (dnsError, addresses) => {
      if (dnsError) return finish(dnsError);
      timings.dns = round(performance.now() - dnsStart);
      const tcpStart = performance.now();
      // Todos os endereços resolvidos vão para o connect, que tenta um a um
      // (IPv6 e IPv4): no Windows "localhost" resolve primeiro para ::1, e uma
      // API local escutando só em 127.0.0.1 recusaria a conexão.
      const target = {
        host: hostname,
        port,
        autoSelectFamily: true,
        lookup: resolved(addresses),
      };

      if (opts.protocol === 'https:') {
        const servername = opts.servername ?? (isIP(hostname) ? undefined : hostname);
        const socket = tlsConnect({
          ...target,
          ...(servername ? { servername } : {}),
          rejectUnauthorized: verifySsl,
          ALPNProtocols: ['http/1.1'],
        });
        let tlsStart = tcpStart;
        socket.once('connect', () => {
          timings.tcp = round(performance.now() - tcpStart);
          tlsStart = performance.now();
        });
        socket.once('secureConnect', () => {
          timings.tls = round(performance.now() - tlsStart);
          finish(null, socket);
        });
        socket.once('error', (err) => finish(err));
      } else {
        const socket = netConnect(target);
        socket.once('connect', () => {
          timings.tcp = round(performance.now() - tcpStart);
          finish(null, socket);
        });
        socket.once('error', (err) => finish(err));
      }
    });
  };
}

/** Função de lookup que devolve endereços já resolvidos (o DNS foi medido antes). */
function resolved(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]?.address ?? '', addresses[0]?.family);
  };
}

/** "localhost, *.interno, 10.0.0.1" — curingas só no início. */
export function isBypassed(hostname: string, bypass: string): boolean {
  const host = hostname.toLowerCase();
  return bypass
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*') return true;
      if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) || host === rule.slice(2);
      if (rule.startsWith('.')) return host.endsWith(rule) || host === rule.slice(1);
      return host === rule;
    });
}

// ---------------------------------------------------------------------------
// Body da requisição e da resposta

async function buildBody(prepared: PreparedRequest): Promise<string | FormData | null> {
  const body = prepared.body;
  if (body.kind === 'none') return null;
  if (body.kind === 'text') return body.text;

  const form = new FormData();
  for (const field of body.fields) {
    if (field.type === 'text') {
      form.append(field.key, field.value);
      continue;
    }
    try {
      const blob = await openAsBlob(field.value);
      form.append(field.key, blob, basename(field.value));
    } catch (error) {
      throw new HttpError(
        'file',
        `Não foi possível ler o arquivo do campo "${field.key}": ${field.value}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return form;
}

async function readBody(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<{ data: Buffer; size: number; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let kept = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (kept < maxBytes) {
      const slice = chunk.byteLength + kept > maxBytes ? chunk.subarray(0, maxBytes - kept) : chunk;
      chunks.push(Buffer.from(slice));
      kept += slice.byteLength;
    }
  }
  return { data: Buffer.concat(chunks), size, truncated: size > kept };
}

const TEXT_CONTENT_TYPE =
  /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|ld\+json))/i;

function encodeBody(data: Buffer, contentType: string | undefined): ResponseBody {
  if (contentType && TEXT_CONTENT_TYPE.test(contentType)) {
    return { encoding: 'utf8', data: data.toString('utf8') };
  }
  // Sem content-type conhecido: trata como texto se for UTF-8 válido.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    // Caracteres de controle (exceto tab/quebras de linha) indicam conteúdo binário.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a detecção é justamente de caracteres de controle
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2048))) return { encoding: 'utf8', data: text };
  } catch {
    // binário
  }
  return { encoding: 'base64', data: data.toString('base64') };
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): [string, string][] {
  const result: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) result.push([key, v]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Erros com mensagens úteis

function toHttpError(error: unknown, url: URL, prepared: PreparedRequest, timeout?: AbortSignal): HttpError {
  if (error instanceof HttpError) return error;
  const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = err?.code ?? err?.cause?.code ?? '';
  const detail = err?.message ?? String(error);
  const host = url.host;

  if (timeout?.aborted) {
    return new HttpError('timeout', `Tempo limite de ${prepared.settings.timeoutMs} ms excedido.`, detail);
  }
  if (err?.name === 'AbortError' || code === 'UND_ERR_ABORTED' || code === 'ABORT_ERR') {
    return new HttpError('aborted', 'Requisição cancelada.');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new HttpError(
      'dns',
      `Não foi possível encontrar o servidor "${url.hostname}" (falha de DNS).`,
      detail,
    );
  }
  if (code === 'ECONNREFUSED') {
    return new HttpError('refused', `Conexão recusada em ${host}. O servidor está rodando?`, detail);
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return new HttpError('reset', `A conexão com ${host} foi encerrada inesperadamente.`, detail);
  }
  if (
    /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) ||
    /certificate|self[- ]signed|ssl/i.test(detail)
  ) {
    return new HttpError(
      'tls',
      `Falha no certificado SSL de ${host}. Se for um ambiente de desenvolvimento, desative "Verificar SSL" nas configurações da requisição.`,
      detail,
    );
  }
  return new HttpError('unknown', `Falha ao enviar a requisição: ${detail}`, code || undefined);
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
