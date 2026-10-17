import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { describeCloudflaredFailure, parseQuickTunnelUrl, QuickTunnel } from './cloudflared';
import { TunnelInspector } from './inspector';
import { DEFAULT_CAPTURE_BODY, joinUrl, normalizeTarget, type TunnelConfig } from './types';

let api: Server;
let apiPort: number;
const received: { method: string; url: string; host: string; body: string }[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', host: req.headers.host ?? '', body });
      res.setHeader('set-cookie', ['a=1', 'b=2']);
      res.setHeader('content-type', 'application/json');
      res.statusCode = req.url?.includes('falha') ? 500 : 201;
      res.end(JSON.stringify({ ok: true, recebido: body }));
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiPort = (api.address() as AddressInfo).port;
});
afterAll(() => new Promise((r) => api.close(r)));

function config(patch: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    id: 't1',
    name: 'API',
    target: `http://127.0.0.1:${apiPort}`,
    mode: 'forward',
    preserveHost: false,
    captureStatus: 200,
    captureBody: DEFAULT_CAPTURE_BODY,
    webhookPath: '',
    ...patch,
  };
}

let inspector: TunnelInspector | null = null;
afterEach(async () => {
  await inspector?.stop();
  inspector = null;
  received.length = 0;
});

async function start(cfg: () => TunnelConfig, maxBodyBytes?: number) {
  inspector = new TunnelInspector({ getConfig: cfg, ...(maxBodyBytes ? { maxBodyBytes } : {}) });
  const port = await inspector.start();
  return { inspector, base: `http://127.0.0.1:${port}` };
}

describe('TunnelInspector', () => {
  it('repassa para a API, registra pedido e resposta e troca o Host', async () => {
    const { inspector, base } = await start(() => config());
    const res = await fetch(`${base}/webhooks/stripe?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'abc.trycloudflare.com' },
      body: '{"evento":"pago"}',
    });
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await res.json()).toEqual({ ok: true, recebido: '{"evento":"pago"}' });
    expect(received[0]).toMatchObject({
      method: 'POST',
      url: '/webhooks/stripe?x=1',
      host: `127.0.0.1:${apiPort}`,
    });

    const [exchange] = inspector.list();
    expect(exchange).toMatchObject({
      method: 'POST',
      path: '/webhooks/stripe?x=1',
      status: 201,
      mode: 'forward',
      replay: false,
      requestBody: { data: '{"evento":"pago"}', encoding: 'utf8', truncated: false },
    });
    expect(exchange?.responseBody?.data).toContain('"ok":true');
  });

  it('usa o caminho base do destino e o destino atual a cada chamada', async () => {
    let target = `http://127.0.0.1:${apiPort}/api`;
    const { base } = await start(() => config({ target }));
    await fetch(`${base}/eventos`);
    // localhost no Windows resolve primeiro para ::1; a API só escuta em 127.0.0.1.
    target = `http://localhost:${apiPort}/v2`;
    await fetch(`${base}/eventos`);
    expect(received.map((r) => r.url)).toEqual(['/api/eventos', '/v2/eventos']);
  });

  it('responde 502 explicando quando a API não está rodando', async () => {
    const { inspector, base } = await start(() => config({ target: 'http://127.0.0.1:1' }));
    const res = await fetch(`${base}/x`, { method: 'POST', body: 'oi' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { erro: string }).erro).toContain('A sua API está rodando');
    expect(inspector.list()[0]).toMatchObject({
      error: expect.stringContaining('127.0.0.1:1'),
      requestBody: { data: 'oi' },
    });
  });

  it('modo captura: não repassa e responde o configurado', async () => {
    const { inspector, base } = await start(() => config({ mode: 'capture', captureStatus: 202 }));
    const res = await fetch(`${base}/hook`, { method: 'POST', body: '{"a":1}' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(received).toHaveLength(0);
    expect(inspector.list()[0]).toMatchObject({
      mode: 'capture',
      status: 202,
      requestBody: { data: '{"a":1}' },
    });
  });

  it('reenvia uma chamada registrada (mesmo capturada) para a API', async () => {
    let mode: TunnelConfig['mode'] = 'capture';
    const { inspector, base } = await start(() => config({ mode }));
    await fetch(`${base}/hook`, { method: 'POST', headers: { 'x-assinatura': 'abc' }, body: 'corpo' });
    mode = 'forward';
    const replayed = await inspector.replay(inspector.list()[0]?.id ?? '');
    expect(replayed).toMatchObject({ replay: true, status: 201, path: '/hook' });
    expect(received[0]).toMatchObject({ method: 'POST', url: '/hook', body: 'corpo' });
    expect(inspector.list()).toHaveLength(2);
  });

  it('limita o corpo registrado sem cortar o repasse', async () => {
    const { inspector, base } = await start(() => config(), 10);
    await fetch(`${base}/grande`, { method: 'POST', body: 'x'.repeat(100) });
    expect(received[0]?.body).toHaveLength(100);
    expect(inspector.list()[0]?.requestBody).toMatchObject({
      size: 100,
      truncated: true,
      data: 'x'.repeat(10),
    });
    await expect(inspector.replay(inspector.list()[0]?.id ?? '')).rejects.toThrow('grande demais');
  });
});

describe('cloudflared', () => {
  it('lê a URL do log e explica falhas', () => {
    expect(
      parseQuickTunnelUrl('INF |  https://lucky-cat-dog-bird.trycloudflare.com                    |'),
    ).toBe('https://lucky-cat-dog-bird.trycloudflare.com');
    expect(parseQuickTunnelUrl('INF Starting tunnel')).toBeNull();
    expect(
      describeCloudflaredFailure(['ERR failed to request quick Tunnel: 429 Too Many Requests']),
    ).toContain('Tente de novo');
  });

  it('inicia um cloudflared (falso) e devolve a URL quando conectado', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rota-cf-'));
    try {
      const script = join(dir, 'fake.cjs');
      await writeFile(
        script,
        [
          "process.stderr.write('INF Requesting new quick Tunnel\\n');",
          "setTimeout(() => process.stderr.write('INF |  https://teste-abc.trycloudflare.com  |\\n'), 50);",
          "setTimeout(() => process.stderr.write('INF Registered tunnel connection connIndex=0\\n'), 100);",
          'setInterval(() => {}, 1000);',
        ].join('\n'),
      );
      const tunnel = new QuickTunnel();
      const logs: string[] = [];
      const url = await tunnel.start({
        binary: process.execPath,
        args: [script],
        localPort: 1234,
        onLog: (l) => logs.push(l),
      });
      expect(url).toBe('https://teste-abc.trycloudflare.com');
      expect(tunnel.running).toBe(true);
      expect(logs).toHaveLength(3);
      tunnel.stop();
      expect(tunnel.running).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falha com mensagem clara se o processo sai antes da URL', async () => {
    const tunnel = new QuickTunnel();
    await expect(
      tunnel.start({
        binary: process.execPath,
        args: ['-e', "process.stderr.write('ERR failed to request quick Tunnel\\n'); process.exit(1)"],
        localPort: 1,
      }),
    ).rejects.toThrow('Cloudflare não criou o túnel');
    await expect(tunnel.start({ binary: 'Z:/nao/existe.exe', localPort: 1 })).rejects.toThrow(
      'não foi encontrado',
    );
  });
});

describe('destino', () => {
  it('normaliza o que o usuário digita', () => {
    expect(normalizeTarget('3000')).toBe('http://localhost:3000');
    expect(normalizeTarget(':8080')).toBe('http://localhost:8080');
    expect(normalizeTarget('localhost:8080/api/')).toBe('http://localhost:8080/api');
    expect(normalizeTarget('https://localhost:5001')).toBe('https://localhost:5001');
    expect(normalizeTarget('99999')).toBeNull();
    expect(joinUrl('https://a.trycloudflare.com', '/webhooks/stripe')).toBe(
      'https://a.trycloudflare.com/webhooks/stripe',
    );
    expect(joinUrl('https://a.trycloudflare.com', '')).toBe('https://a.trycloudflare.com');
  });
});
