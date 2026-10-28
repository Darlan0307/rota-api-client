import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeRequest, HttpError, isBypassed } from './execute';
import type { PreparedRequest } from './prepare';

let server: Server;
let base: string;
let tmp: string;

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>> = {
  '/json': (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null }));
  },
  '/gzip': (_req, res) => {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync('olá comprimido'));
  },
  '/br403': (_req, res) => {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-encoding', 'br');
    res.end(brotliCompressSync(JSON.stringify({ erro: 'Acesso negado' })));
  },
  '/gzip-corrompido': (_req, res) => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.setHeader('content-encoding', 'gzip');
    res.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x13, 0x9c]));
  },
  '/redirect': (_req, res) => {
    res.statusCode = 302;
    res.setHeader('location', '/json');
    res.end();
  },
  '/slow': (_req, res) => {
    setTimeout(() => res.end('tarde'), 2000);
  },
  '/echo': async (req, res) => {
    const body = await readAll(req);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ contentType: req.headers['content-type'], body: body.toString('utf8') }));
  },
  '/binary': (_req, res) => {
    res.setHeader('content-type', 'application/octet-stream');
    res.end(Buffer.from([0, 1, 2, 255]));
  },
  '/cookies': (_req, res) => {
    res.setHeader('set-cookie', ['a=1', 'b=2']);
    res.end('ok');
  },
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rota-http-'));
  server = createServer((req, res) => {
    const handler = routes[new URL(req.url ?? '/', 'http://x').pathname];
    if (!handler) {
      res.statusCode = 404;
      res.end();
      return;
    }
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
});

function req(path: string, overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    method: 'GET',
    url: `${base}${path}`,
    headers: [],
    body: { kind: 'none' },
    settings: { timeoutMs: 5000, followRedirects: true, verifySsl: true },
    ...overrides,
  };
}

describe('executeRequest', () => {
  it('retorna status, headers, body e timings', async () => {
    const res = await executeRequest(req('/json', { headers: [['Authorization', 'Bearer x']] }));
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.body.encoding).toBe('utf8');
    expect(JSON.parse(res.body.data)).toEqual({ method: 'GET', auth: 'Bearer x' });
    expect(res.sizeBytes).toBe(Buffer.byteLength(res.body.data));
    expect(res.timings.dns).toBeTypeOf('number');
    expect(res.timings.tcp).toBeTypeOf('number');
    expect(res.timings.total).toBeGreaterThanOrEqual(res.timings.ttfb);
  });

  it('alcança "localhost" mesmo com o servidor só em IPv4 (localhost resolve ::1 primeiro no Windows)', async () => {
    const res = await executeRequest(req('/json', { url: `${base.replace('127.0.0.1', 'localhost')}/json` }));
    expect(res.status).toBe(200);
  });

  it('descomprime gzip', async () => {
    const res = await executeRequest(req('/gzip'));
    expect(res.body.data).toBe('olá comprimido');
  });

  it('descomprime também respostas de erro (4xx/5xx)', async () => {
    const res = await executeRequest(req('/br403'));
    expect(res.status).toBe(403);
    expect(res.body.encoding).toBe('utf8');
    expect(JSON.parse(res.body.data)).toEqual({ erro: 'Acesso negado' });
    expect(res.decodeError).toBeUndefined();
  });

  it('explica header com caractere que não pode ser enviado', async () => {
    const error = await executeRequest(req('/json', { headers: [['X-Teste', 'linha\nquebrada']] })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('invalid-header');
    expect((error as HttpError).message).toMatch(/header "X-Teste"/);
  });

  it('mantém status e headers quando o corpo comprimido está corrompido', async () => {
    const res = await executeRequest(req('/gzip-corrompido'));
    expect(res.status).toBe(500);
    expect(res.decodeError).toMatch(/não pôde ser descomprimido/);
    expect(res.body.encoding).toBe('base64');
  });

  it('segue redirecionamentos só quando configurado', async () => {
    expect((await executeRequest(req('/redirect'))).status).toBe(200);
    const noFollow = await executeRequest(
      req('/redirect', { settings: { timeoutMs: 5000, followRedirects: false, verifySsl: true } }),
    );
    expect(noFollow.status).toBe(302);
  });

  it('envia body de texto e form-data com arquivo', async () => {
    const text = await executeRequest(
      req('/echo', {
        method: 'POST',
        headers: [['Content-Type', 'text/plain']],
        body: { kind: 'text', text: 'oi' },
      }),
    );
    expect(JSON.parse(text.body.data)).toEqual({ contentType: 'text/plain', body: 'oi' });

    const file = join(tmp, 'nota.txt');
    await writeFile(file, 'conteúdo do arquivo');
    const form = await executeRequest(
      req('/echo', {
        method: 'POST',
        body: {
          kind: 'formdata',
          fields: [
            { key: 'nome', type: 'text', value: 'Ana' },
            { key: 'anexo', type: 'file', value: file },
          ],
        },
      }),
    );
    const echoed = JSON.parse(form.body.data) as { contentType: string; body: string };
    expect(echoed.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(echoed.body).toContain('name="anexo"; filename="nota.txt"');
    expect(echoed.body).toContain('conteúdo do arquivo');
  });

  it('informa erro claro quando o arquivo do form-data não existe', async () => {
    const promise = executeRequest(
      req('/echo', {
        method: 'POST',
        body: { kind: 'formdata', fields: [{ key: 'f', type: 'file', value: join(tmp, 'nao-existe.bin') }] },
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'file' });
  });

  it('codifica respostas binárias em base64 e preserva headers repetidos', async () => {
    const bin = await executeRequest(req('/binary'));
    expect(bin.body).toEqual({ encoding: 'base64', data: Buffer.from([0, 1, 2, 255]).toString('base64') });

    const cookies = await executeRequest(req('/cookies'));
    expect(cookies.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v)).toEqual(['a=1', 'b=2']);
  });

  it('respeita o timeout e o cancelamento', async () => {
    await expect(
      executeRequest(req('/slow', { settings: { timeoutMs: 100, followRedirects: true, verifySsl: true } })),
    ).rejects.toMatchObject({ code: 'timeout' });

    const controller = new AbortController();
    const promise = executeRequest(req('/slow'), { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });

  it('traduz conexão recusada e URL inválida', async () => {
    await expect(executeRequest(req('', { url: 'http://127.0.0.1:1/' }))).rejects.toMatchObject({
      code: 'refused',
    });
    await expect(executeRequest(req('', { url: 'não é url' }))).rejects.toBeInstanceOf(HttpError);
  });
});

describe('isBypassed', () => {
  it('aceita hosts exatos e curingas de subdomínio', () => {
    expect(isBypassed('localhost', 'localhost, *.interno')).toBe(true);
    expect(isBypassed('api.interno', 'localhost, *.interno')).toBe(true);
    expect(isBypassed('interno', '*.interno')).toBe(true);
    expect(isBypassed('externo.com', 'localhost, *.interno')).toBe(false);
  });
});

describe('headers enviados', () => {
  it('registra o que saiu na conexão, com Host, Connection e Content-Length', async () => {
    const res = await executeRequest(
      req('/echo', {
        method: 'POST',
        headers: [
          ['Content-Type', 'application/json'],
          ['Authorization', 'Bearer x'],
        ],
        body: { kind: 'text', text: '{"nome":"João"}' },
      }),
    );
    const sent = new Map((res.sentHeaders ?? []).map(([k, v]) => [k.toLowerCase(), v]));
    expect(sent.get('host')).toBe(new URL(base).host);
    expect(sent.get('connection')).toBe('keep-alive');
    expect(sent.get('content-length')).toBe(String(Buffer.byteLength('{"nome":"João"}')));
    expect(sent.get('authorization')).toBe('Bearer x');
  });

  it('formulário multipart registra o Content-Type com o boundary', async () => {
    const res = await executeRequest(
      req('/echo', {
        method: 'POST',
        body: { kind: 'formdata', fields: [{ key: 'a', type: 'text', value: '1' }] },
      }),
    );
    const type = res.sentHeaders?.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
  });
});
