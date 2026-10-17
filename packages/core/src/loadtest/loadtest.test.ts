import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PreparedRequest } from '../http/prepare';
import {
  LoadTestRecorder,
  percentile,
  runLoadTest,
  summarizeLatencies,
  validateLoadTestConfig,
} from './loadtest';

let server: Server;
let base: string;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/erro' && hits % 4 === 0) {
      res.statusCode = 500;
      res.end('x');
      return;
    }
    setTimeout(() => res.end('ok'), req.url === '/lento' ? 200 : 2);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const req = (path: string): PreparedRequest => ({
  method: 'GET',
  url: `${base}${path}`,
  headers: [],
  body: { kind: 'none' },
  settings: { timeoutMs: 5000, followRedirects: false, verifySsl: true },
});

describe('estatísticas', () => {
  it('calcula percentis', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(summarizeLatencies([3, 1, 2])).toMatchObject({ min: 1, max: 3, mean: 2, p50: 2 });
    expect(summarizeLatencies([])).toBeNull();
  });

  it('agrupa por segundo e conta falhas', () => {
    const r = new LoadTestRecorder(0);
    r.record(100, 10, { status: 200 });
    r.record(500, 30, { status: 500 });
    r.record(1500, 20, { error: 'Conexão recusada' });
    const s = r.stats(2000);
    expect(s).toMatchObject({
      completed: 3,
      failed: 2,
      networkErrors: 1,
      statusCounts: { '200': 1, '500': 1, erro: 1 },
      errors: { 'Conexão recusada': 1 },
      rps: 1.5,
    });
    expect(s.errorRate).toBeCloseTo(2 / 3);
    // Fatias de 100 ms: 0-0,1 s, 0,5-0,6 s e 1,5-1,6 s têm dados.
    const withData = s.timeline.filter((p) => p.requests > 0);
    expect(withData).toEqual([
      { t: 0.1, requests: 1, rps: 10, errors: 0, meanMs: 10 },
      { t: 0.5, requests: 1, rps: 10, errors: 1, meanMs: 30 },
      { t: 1.5, requests: 1, rps: 10, errors: 1, meanMs: 20 },
    ]);
    expect(s.timeline).toHaveLength(20);
  });

  it('valida a configuração', () => {
    expect(validateLoadTestConfig({ mode: 'count', total: 10, durationSec: 0, concurrency: 0 })).toMatch(
      /concorrência/,
    );
    expect(validateLoadTestConfig({ mode: 'count', total: 0, durationSec: 0, concurrency: 1 })).toMatch(
      /quantas/,
    );
    expect(validateLoadTestConfig({ mode: 'duration', total: 0, durationSec: 5000, concurrency: 1 })).toMatch(
      /1 hora/,
    );
    expect(
      validateLoadTestConfig({ mode: 'duration', total: 0, durationSec: 2, concurrency: 10 }),
    ).toBeNull();
  });
});

describe('runLoadTest', () => {
  it('envia exatamente o total pedido com concorrência', async () => {
    const progress: number[] = [];
    const result = await runLoadTest(
      req('/ok'),
      { mode: 'count', total: 200, durationSec: 0, concurrency: 20 },
      { onProgress: (s) => progress.push(s.completed), progressIntervalMs: 20 },
    );
    expect(result.completed).toBe(200);
    expect(result.statusCounts).toEqual({ '200': 200 });
    expect(result.failed).toBe(0);
    expect(result.rps).toBeGreaterThan(0);
    expect(result.latency?.p99).toBeGreaterThanOrEqual(result.latency?.p50 ?? 0);
    expect(result.cancelled).toBe(false);
  });

  it('conta respostas 5xx como falha', async () => {
    hits = 0;
    const result = await runLoadTest(req('/erro'), {
      mode: 'count',
      total: 40,
      durationSec: 0,
      concurrency: 1,
    });
    expect(result.statusCounts['500']).toBe(10);
    expect(result.errorRate).toBeCloseTo(0.25);
  });

  it('respeita a duração e pode ser cancelado', async () => {
    const byTime = await runLoadTest(req('/ok'), {
      mode: 'duration',
      total: 0,
      durationSec: 1,
      concurrency: 5,
    });
    expect(byTime.elapsedMs).toBeGreaterThanOrEqual(950);
    expect(byTime.elapsedMs).toBeLessThan(2500);
    expect(byTime.cancelled).toBe(false);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const cancelled = await runLoadTest(
      req('/lento'),
      { mode: 'count', total: 10_000, durationSec: 0, concurrency: 4 },
      { signal: controller.signal },
    );
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.completed).toBeLessThan(20);
  });

  it('registra erros de conexão', async () => {
    const result = await runLoadTest(
      { ...req(''), url: 'http://127.0.0.1:1/' },
      { mode: 'count', total: 5, durationSec: 0, concurrency: 1 },
    );
    expect(result.networkErrors).toBe(5);
    expect(result.errors).toEqual({ 'Conexão recusada': 5 });
  });
});
