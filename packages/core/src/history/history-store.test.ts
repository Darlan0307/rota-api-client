import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequestDataSchema } from '../model/schemas';
import type { RunResult } from '../runner/run-request';
import { SECRET_MASK } from '../variables/template';
import { HistoryStore } from './history-store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rota-hist-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function result(status: number, body: string, url = 'http://api/x'): RunResult {
  return {
    startedAt: new Date().toISOString(),
    error: null,
    request: {
      method: 'GET',
      url,
      headers: [['Authorization', 'Bearer tok-123456']],
      body: { kind: 'none' },
      settings: { timeoutMs: 1000, followRedirects: true, verifySsl: true },
    },
    response: {
      status,
      statusText: 'OK',
      headers: [['set-cookie', 'sid=tok-123456']],
      body: { encoding: 'utf8', data: body },
      sizeBytes: body.length,
      truncated: false,
      timings: { ttfb: 5, download: 1, total: 6 },
    },
  };
}

const data = RequestDataSchema.parse({ url: '{{base}}/x' });

describe('HistoryStore', () => {
  it('grava e lista do mais recente para o mais antigo', async () => {
    const h = new HistoryStore(dir);
    await h.add({ name: 'A', data }, result(200, '{}'), []);
    await h.add({ name: 'B', data }, result(404, '{}'), []);
    const { items, total } = await h.list();
    expect(total).toBe(2);
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ['B', 404],
      ['A', 200],
    ]);
    expect(items[0]).not.toHaveProperty('data');
  });

  it('mascara segredos antes de gravar no disco', async () => {
    const h = new HistoryStore(dir);
    const { id } = await h.add({ name: 'Login', data }, result(200, '{"token":"tok-123456"}'), [
      'tok-123456',
    ]);
    const raw = await readFile(join(dir, 'history.jsonl'), 'utf8');
    expect(raw).not.toContain('tok-123456');

    const entry = await h.get(id);
    expect(entry?.result.response?.body.data).toBe(`{"token":"${SECRET_MASK}"}`);
    expect(entry?.result.request?.headers).toEqual([['Authorization', `Bearer ${SECRET_MASK}`]]);
    expect(entry?.data.url).toBe('{{base}}/x');
  });

  it('filtra, remove e limpa', async () => {
    const h = new HistoryStore(dir);
    await h.add(
      { name: 'Listar pedidos', requestId: 'r-1', data },
      result(200, '', 'http://api/pedidos'),
      [],
    );
    const { id } = await h.add({ name: 'Login', data }, result(500, '', 'http://api/login'), []);
    expect((await h.list({ query: 'pedidos' })).items.map((i) => i.name)).toEqual(['Listar pedidos']);
    expect((await h.list({ query: '500' })).items.map((i) => i.name)).toEqual(['Login']);
    expect((await h.list({ requestId: 'r-1' })).items.map((i) => i.name)).toEqual(['Listar pedidos']);

    await h.remove(id);
    expect((await new HistoryStore(dir).list()).total).toBe(1);
    await h.clear();
    expect((await h.list()).total).toBe(0);
  });

  // 620 gravações em disco: sozinho leva menos de 1 s, mas passa de 5 s com a suíte inteira em paralelo.
  it('mantém no máximo 500 entradas', { timeout: 30_000 }, async () => {
    const h = new HistoryStore(dir);
    for (let i = 0; i < 620; i++) await h.add({ name: `R${i}`, data }, result(200, ''), []);
    const fresh = new HistoryStore(dir);
    const { total, items } = await fresh.list({ limit: 1 });
    expect(total).toBeLessThanOrEqual(600);
    expect(items[0]?.name).toBe('R619');
  });
});
