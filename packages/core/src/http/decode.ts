import { Readable, type Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  constants,
  createBrotliDecompress,
  createGunzip,
  createInflate,
  createInflateRaw,
  createZstdDecompress,
} from 'node:zlib';

export interface DecodedContent {
  data: Buffer;
  /** Tamanho descomprimido (até onde foi lido). */
  size: number;
  truncated: boolean;
  /** Preenchido quando o corpo não pôde ser descomprimido e segue como veio. */
  error?: string;
}

const DECODERS: Record<string, (first: Buffer) => Transform> = {
  gzip: () => createGunzip(),
  'x-gzip': () => createGunzip(),
  // Há servidores que mandam deflate "cru", sem o cabeçalho zlib que a RFC pede.
  deflate: (first) => (hasZlibHeader(first) ? createInflate() : createInflateRaw()),
  br: () => createBrotliDecompress(),
  zstd: () => createZstdDecompress({ params: { [constants.ZSTD_d_windowLogMax]: 23 } }),
};

// Mais que isso só aparece em resposta maliciosa (mesmo limite de curl e urllib3).
const MAX_ENCODINGS = 5;

class LimitReached extends Error {}

/**
 * Desfaz o Content-Encoding do corpo, qualquer que seja o status: erros 4xx/5xx
 * também chegam comprimidos e precisam ser legíveis. Nunca lança: se não der
 * para descomprimir, devolve o corpo original com `error` explicando.
 */
export async function decodeContent(
  raw: Buffer,
  contentEncoding: string | undefined,
  maxBytes: number,
  rawTruncated: boolean,
): Promise<DecodedContent> {
  const original = { data: raw, size: raw.byteLength, truncated: rawTruncated };
  const encodings = (contentEncoding ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '' && e !== 'identity');
  if (encodings.length === 0 || raw.byteLength === 0) return original;

  const label = `content-encoding: ${contentEncoding?.trim()}`;
  if (encodings.length > MAX_ENCODINGS) {
    return {
      ...original,
      error: `O servidor informou "${label}" (codificações demais). O corpo é exibido como veio.`,
    };
  }
  const unsupported = encodings.find((e) => !(e in DECODERS));
  if (unsupported) {
    return {
      ...original,
      error: `A codificação "${unsupported}" não é suportada (${label}). O corpo é exibido como veio, sem descomprimir.`,
    };
  }

  const chunks: Buffer[] = [];
  let kept = 0;
  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const part = chunk.subarray(0, maxBytes - kept);
      chunks.push(part);
      kept += part.byteLength;
      // Para de descomprimir no limite: um corpo pequeno pode virar gigabytes.
      callback(kept >= maxBytes ? new LimitReached() : null);
    },
  });

  // O cabeçalho lista na ordem em que foram aplicadas; desfaz da última para a primeira.
  const decoders = encodings.reverse().map((e) => (DECODERS[e] as (first: Buffer) => Transform)(raw));
  try {
    await pipeline(Readable.from([raw]), ...decoders, collector);
    return { data: Buffer.concat(chunks), size: kept, truncated: rawTruncated };
  } catch (error) {
    if (error instanceof LimitReached) return { data: Buffer.concat(chunks), size: kept, truncated: true };
    // Corpo cortado no limite termina no meio do fluxo comprimido: fica o que já saiu.
    if (rawTruncated && kept > 0) return { data: Buffer.concat(chunks), size: kept, truncated: true };
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...original,
      error: `O servidor informou "${label}", mas o corpo não pôde ser descomprimido (${detail}). O corpo é exibido como veio.`,
    };
  }
}

const TEXT_CONTENT_TYPE =
  /^\s*(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|x-ndjson|csv)\b)/i;

/**
 * Corpo já descomprimido para texto (respeitando o charset e tirando o BOM) ou
 * base64 quando é binário. `contentType` ausente: decide pelo próprio conteúdo.
 */
export function encodeBody(
  data: Buffer,
  contentType: string | undefined,
): { encoding: 'utf8' | 'base64'; data: string } {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
  if (charset) {
    try {
      return { encoding: 'utf8', data: new TextDecoder(charset).decode(data) };
    } catch {
      // charset desconhecido: decide como se não tivesse vindo
    }
  }
  const declaredText = contentType !== undefined && TEXT_CONTENT_TYPE.test(contentType);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    // Caracteres de controle (exceto tab/quebras de linha) indicam conteúdo binário.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a detecção é justamente de caracteres de controle
    if (declaredText || !/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2048))) {
      return { encoding: 'utf8', data: text };
    }
  } catch {
    // Texto sem charset que não é UTF-8: servidores antigos mandam Windows-1252 (superconjunto do Latin-1).
    if (declaredText) return { encoding: 'utf8', data: new TextDecoder('windows-1252').decode(data) };
  }
  return { encoding: 'base64', data: data.toString('base64') };
}

/** RFC 1950: método 8 (deflate) e os dois primeiros bytes múltiplos de 31. */
function hasZlibHeader(data: Buffer): boolean {
  const [cmf, flg] = data;
  return cmf !== undefined && flg !== undefined && (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0;
}
