import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeContent, encodeBody } from './decode';

const json = Buffer.from(JSON.stringify({ cliente: 'João da Conceição', itens: [1, 2, 3] }));
const MB = 1024 * 1024;

describe('decodeContent', () => {
  it.each([
    ['gzip', gzipSync(json)],
    ['x-gzip', gzipSync(json)],
    ['br', brotliCompressSync(json)],
    ['deflate', deflateSync(json)],
    ['zstd', zstdCompressSync(json)],
    ['BR', brotliCompressSync(json)],
  ])('descomprime %s', async (encoding, raw) => {
    const res = await decodeContent(raw, encoding, MB, false);
    expect(res.data.equals(json)).toBe(true);
    expect(res.size).toBe(json.byteLength);
    expect(res.error).toBeUndefined();
  });

  it('aceita deflate sem o cabeçalho zlib', async () => {
    const res = await decodeContent(deflateRawSync(json), 'deflate', MB, false);
    expect(res.data.equals(json)).toBe(true);
  });

  it('desfaz codificações encadeadas na ordem inversa', async () => {
    const raw = brotliCompressSync(gzipSync(json));
    const res = await decodeContent(raw, 'gzip, br', MB, false);
    expect(res.data.equals(json)).toBe(true);
  });

  it('não mexe no corpo sem codificação, com identity ou vazio', async () => {
    for (const encoding of [undefined, '', 'identity']) {
      const res = await decodeContent(json, encoding, MB, false);
      expect(res.data).toBe(json);
      expect(res.error).toBeUndefined();
    }
    const empty = await decodeContent(Buffer.alloc(0), 'gzip', MB, false);
    expect(empty.error).toBeUndefined();
  });

  it('devolve o corpo original com aviso quando a codificação não é suportada', async () => {
    const raw = Buffer.from([0x1f, 0x9d, 1, 2]);
    const res = await decodeContent(raw, 'compress', MB, false);
    expect(res.data).toBe(raw);
    expect(res.error).toMatch(/"compress" não é suportada/);
  });

  it('devolve o corpo original com aviso quando está corrompido', async () => {
    const res = await decodeContent(json, 'br', MB, false);
    expect(res.data).toBe(json);
    expect(res.error).toMatch(/content-encoding: br.*não pôde ser descomprimido/);
  });

  it('recusa codificações demais', async () => {
    const res = await decodeContent(json, 'gzip, gzip, gzip, gzip, gzip, gzip', MB, false);
    expect(res.error).toMatch(/codificações demais/);
  });

  it('para no limite mesmo quando o corpo comprimido é pequeno', async () => {
    const raw = gzipSync(Buffer.alloc(20 * MB));
    const res = await decodeContent(raw, 'gzip', MB, false);
    expect(res.data.byteLength).toBe(MB);
    expect(res.truncated).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('mantém o que já descomprimiu quando o corpo bruto foi cortado no limite', async () => {
    const big = Buffer.from('linha de teste\n'.repeat(100_000));
    const raw = gzipSync(big);
    const res = await decodeContent(raw.subarray(0, raw.byteLength / 2), 'gzip', 10 * MB, true);
    expect(res.data.byteLength).toBeGreaterThan(0);
    expect(big.subarray(0, res.data.byteLength).equals(res.data)).toBe(true);
    expect(res.truncated).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

describe('encodeBody', () => {
  const latin1 = Buffer.from([0x4a, 0x6f, 0xe3, 0x6f]);

  it('respeita o charset do content-type', () => {
    expect(encodeBody(latin1, 'text/plain; charset=ISO-8859-1')).toEqual({ encoding: 'utf8', data: 'João' });
    expect(encodeBody(latin1, 'application/json; charset="windows-1252"').data).toBe('João');
  });

  it('lê como Windows-1252 o texto sem charset que não é UTF-8', () => {
    expect(encodeBody(latin1, 'text/html')).toEqual({ encoding: 'utf8', data: 'João' });
  });

  it('tira o BOM do UTF-8 (senão o JSON não é reconhecido)', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]);
    expect(encodeBody(bom, 'application/json').data).toBe('{"a":1}');
  });

  it('reconhece tipos de texto com sufixo e variações', () => {
    for (const ct of [
      'application/problem+json',
      'application/vnd.api+json',
      'application/x-ndjson',
      'text/csv',
    ]) {
      expect(encodeBody(Buffer.from('ok'), ct).encoding).toBe('utf8');
    }
  });

  it('ignora charset desconhecido e decide pelo conteúdo', () => {
    expect(encodeBody(Buffer.from('olá'), 'text/plain; charset=x-inventado').data).toBe('olá');
  });

  it('mantém binário em base64', () => {
    expect(encodeBody(Buffer.from([0, 1, 2, 255]), 'application/octet-stream').encoding).toBe('base64');
    expect(encodeBody(Buffer.from([0, 1, 2, 3]), undefined).encoding).toBe('base64');
  });
});
