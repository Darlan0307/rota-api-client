import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { decodeContent, encodeBody as encodeResponseBody } from '../http/decode';
import { newId } from '../util/ids';
import type { TunnelBody, TunnelConfig, TunnelExchange } from './types';

/**
 * Proxy local entre o cloudflared e a API: registra cada chamada (pedido e
 * resposta) e repassa para o destino configurado, sem bufferizar (o corpo
 * segue em streaming; só uma cópia limitada fica registrada).
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
]);

export interface TunnelInspectorOptions {
  /** Lido a cada chamada: destino e modo podem mudar com o túnel ligado. */
  getConfig: () => TunnelConfig;
  onExchange?: (exchange: TunnelExchange) => void;
  /** Quanto de cada corpo fica registrado (padrão 1 MB). */
  maxBodyBytes?: number;
  /** Quantas chamadas ficam na memória (padrão 200). */
  maxExchanges?: number;
}

/** Copia limitada de um corpo que está passando. */
class BodyRecorder {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  size = 0;
  constructor(private readonly limit: number) {}

  push(chunk: Buffer) {
    this.size += chunk.length;
    if (this.kept >= this.limit) return;
    const part = chunk.subarray(0, this.limit - this.kept);
    this.chunks.push(part);
    this.kept += part.length;
  }

  toBody(contentType: string | undefined): TunnelBody {
    const buffer = Buffer.concat(this.chunks);
    return { ...encodeBody(buffer, contentType), size: this.size, truncated: this.size > this.kept };
  }

  /** Resposta da API: quem chamou recebe os bytes como vieram, o registro mostra descomprimido. */
  async toResponseBody(headers: readonly [string, string][]): Promise<TunnelBody> {
    const truncated = this.size > this.kept;
    const decoded = await decodeContent(
      Buffer.concat(this.chunks),
      headerOf(headers, 'content-encoding'),
      this.limit,
      truncated,
    );
    const contentType = decoded.error ? undefined : headerOf(headers, 'content-type');
    return {
      ...encodeResponseBody(decoded.data, contentType),
      size: this.size,
      truncated: decoded.truncated,
    };
  }
}

const TEXT_TYPES = /json|text|xml|javascript|x-www-form-urlencoded|graphql|yaml|csv/i;

function encodeBody(buffer: Buffer, contentType: string | undefined): Pick<TunnelBody, 'data' | 'encoding'> {
  if (buffer.length === 0) return { data: '', encoding: 'utf8' };
  if (!contentType || TEXT_TYPES.test(contentType)) {
    try {
      return { data: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf8' };
    } catch {
      // binário
    }
  }
  return { data: buffer.toString('base64'), encoding: 'base64' };
}

function pairs(raw: readonly string[]): [string, string][] {
  const result: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) result.push([raw[i] as string, raw[i + 1] as string]);
  return result;
}

function headerOf(headers: readonly [string, string][], name: string): string | undefined {
  return headers.find(([k]) => k.toLowerCase() === name)?.[1];
}

/** Mensagem clara para quando a API local não responde. */
export function describeTargetError(error: NodeJS.ErrnoException, target: string): string {
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return target;
    }
  })();
  switch (error.code) {
    case 'ECONNREFUSED':
      return `Nada respondeu em ${host}. A sua API está rodando nessa porta?`;
    case 'ENOTFOUND':
      return `O endereço ${host} não foi encontrado.`;
    case 'ECONNRESET':
      return `A API em ${host} fechou a conexão antes de responder.`;
    default:
      return `Não foi possível falar com ${host}: ${error.message}`;
  }
}

interface SendInput {
  method: string;
  path: string;
  headers: [string, string][];
  body: Readable;
  /** Resposta para o cloudflared (ausente no reenvio). */
  client?: ServerResponse;
  replay: boolean;
  simulated?: string;
}

export class TunnelInspector {
  private server: Server | null = null;
  private exchanges: TunnelExchange[] = [];
  private readonly maxBody: number;
  private readonly maxExchanges: number;

  constructor(private readonly options: TunnelInspectorOptions) {
    this.maxBody = options.maxBodyBytes ?? 1024 * 1024;
    this.maxExchanges = options.maxExchanges ?? 200;
  }

  /** Porta local onde o cloudflared deve entregar as chamadas. */
  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  start(): Promise<number> {
    if (this.server) return Promise.resolve(this.port);
    const server = createServer((req, res) => void this.handle(req, res));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(this.port));
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  list(): TunnelExchange[] {
    return this.exchanges;
  }

  get(id: string): TunnelExchange | undefined {
    return this.exchanges.find((e) => e.id === id);
  }

  clear(): void {
    this.exchanges = [];
  }

  /** Reenvia uma chamada registrada para o destino atual (sempre repassa, mesmo no modo "capture"). */
  replay(id: string): Promise<TunnelExchange> {
    const original = this.get(id);
    if (!original) return Promise.reject(new Error('Chamada não encontrada (a lista pode ter sido limpa).'));
    if (original.requestBody.truncated)
      return Promise.reject(new Error('O corpo desta chamada era grande demais para ser guardado inteiro.'));
    const body = Buffer.from(original.requestBody.data, original.requestBody.encoding);
    const headers = original.requestHeaders.filter(([k]) => k.toLowerCase() !== 'content-length');
    headers.push(['content-length', String(body.length)]);
    return this.forward({
      method: original.method,
      path: original.path,
      headers,
      body: Readable.from(body.length ? [body] : []),
      replay: true,
    });
  }

  /** Envia uma chamada montada pelo Rota (simulador) direto para o destino, registrando-a. */
  send(input: {
    method: string;
    path: string;
    headers: [string, string][];
    body: Buffer;
    label: string;
  }): Promise<TunnelExchange> {
    const headers = input.headers.filter(([k]) => k.toLowerCase() !== 'content-length');
    headers.push(['content-length', String(input.body.length)]);
    return this.forward({
      method: input.method,
      path: input.path,
      headers,
      body: Readable.from(input.body.length ? [input.body] : []),
      replay: false,
      simulated: input.label,
    });
  }

  private record(exchange: TunnelExchange): TunnelExchange {
    this.exchanges = [exchange, ...this.exchanges].slice(0, this.maxExchanges);
    this.options.onExchange?.(exchange);
    return exchange;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const config = this.options.getConfig();
    const input: SendInput = {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: pairs(req.rawHeaders),
      body: req,
      client: res,
      replay: false,
    };
    try {
      if (config.mode === 'capture') await this.capture(input, config);
      else await this.forward(input);
    } catch (error) {
      // Erro inesperado (ex.: destino inválido): responde para não deixar o serviço esperando.
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ erro: `Rota: ${error instanceof Error ? error.message : String(error)}` }));
      } else res.destroy();
    }
  }

  private async capture(input: SendInput, config: TunnelConfig): Promise<void> {
    const started = Date.now();
    const recorder = new BodyRecorder(this.maxBody);
    for await (const chunk of input.body) recorder.push(chunk as Buffer);
    const body = Buffer.from(config.captureBody, 'utf8');
    const contentType = /^\s*[[{]/.test(config.captureBody)
      ? 'application/json'
      : 'text/plain; charset=utf-8';
    const responseHeaders: [string, string][] = [
      ['content-type', contentType],
      ['content-length', String(body.length)],
    ];
    input.client?.writeHead(config.captureStatus, responseHeaders.flat());
    input.client?.end(body);
    const responseRecorder = new BodyRecorder(this.maxBody);
    responseRecorder.push(body);
    this.record({
      id: newId(),
      at: new Date(started).toISOString(),
      method: input.method,
      path: input.path,
      requestHeaders: input.headers,
      requestBody: recorder.toBody(headerOf(input.headers, 'content-type')),
      status: config.captureStatus,
      responseHeaders,
      responseBody: responseRecorder.toBody(contentType),
      durationMs: Date.now() - started,
      mode: 'capture',
      target: config.target,
      replay: input.replay,
    });
  }

  private forward(input: SendInput): Promise<TunnelExchange> {
    const config = this.options.getConfig();
    const started = Date.now();
    const target = new URL(config.target);
    const basePath = target.pathname.replace(/\/$/, '');
    const requestRecorder = new BodyRecorder(this.maxBody);

    const headers: [string, string][] = [];
    for (const [key, value] of input.headers) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      if (lower === 'host' && !config.preserveHost) {
        headers.push(['X-Forwarded-Host', value]);
        continue;
      }
      headers.push([key, value]);
    }
    if (!config.preserveHost || !headerOf(input.headers, 'host')) headers.push(['Host', target.host]);

    const base = {
      id: newId(),
      at: new Date(started).toISOString(),
      method: input.method,
      path: input.path,
      requestHeaders: input.headers,
      mode: 'forward' as const,
      target: config.target,
      replay: input.replay,
      ...(input.simulated ? { simulated: input.simulated } : {}),
    };

    return new Promise<TunnelExchange>((resolve) => {
      // Cada chamada é registrada uma única vez, aconteça o que acontecer.
      let settled = false;
      const finish = (exchange: TunnelExchange) => {
        if (settled) return;
        settled = true;
        resolve(this.record(exchange));
      };
      const failed = (message: string) =>
        finish({
          ...base,
          requestBody: requestRecorder.toBody(headerOf(input.headers, 'content-type')),
          responseHeaders: [],
          responseBody: null,
          durationMs: Date.now() - started,
          error: message,
        });

      // autoSelectFamily é repassado ao net.connect (falta nos tipos do http).
      const options: RequestOptions & { autoSelectFamily: boolean } = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
        method: input.method,
        path: `${basePath}${input.path}`,
        headers: headers.flat(),
        // "localhost" no Windows resolve primeiro para ::1; tenta IPv4 e IPv6.
        autoSelectFamily: true,
        // Destino local com certificado próprio (https://localhost).
        rejectUnauthorized: false,
      };
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const upstream = send(options, (response) => {
        const responseHeaders = pairs(response.rawHeaders);
        const responseRecorder = new BodyRecorder(this.maxBody);
        const client = input.client;
        if (client) {
          const forwarded = responseHeaders.filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()));
          client.writeHead(response.statusCode ?? 502, forwarded.flat());
        }
        response.on('data', (chunk: Buffer) => {
          responseRecorder.push(chunk);
          client?.write(chunk);
        });
        response.on('end', () => {
          client?.end();
          const durationMs = Date.now() - started;
          void responseRecorder.toResponseBody(responseHeaders).then((responseBody) =>
            finish({
              ...base,
              requestBody: requestRecorder.toBody(headerOf(input.headers, 'content-type')),
              status: response.statusCode ?? 0,
              responseHeaders,
              responseBody,
              durationMs,
            }),
          );
        });
        // A API caiu no meio da resposta (ou quem chamou desistiu).
        response.on('close', () => {
          if (response.complete) return;
          client?.destroy();
          failed('A resposta da API foi interrompida antes do fim.');
        });
        response.on('error', () => client?.destroy());
      });

      upstream.on('error', (error: NodeJS.ErrnoException) => {
        const message = describeTargetError(error, config.target);
        const client = input.client;
        if (client && !client.headersSent) {
          const body = JSON.stringify({ erro: `Rota: ${message}` });
          client.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          client.end(body);
        } else client?.destroy();
        failed(message);
      });

      // Quem chamou desistiu: cancela o repasse.
      input.client?.on('close', () => {
        if (input.client?.writableFinished) return;
        upstream.destroy();
        failed('Quem chamou desistiu antes da resposta (tempo esgotado no serviço?).');
      });

      input.body.on('data', (chunk: Buffer) => requestRecorder.push(chunk));
      input.body.pipe(upstream);
    });
  }
}
