import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findNode } from '../model/tree';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { runRequest } from './run-request';

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/login') {
      res.end(JSON.stringify({ access_token: `tok-${Date.now()}` }));
      return;
    }
    res.end(
      JSON.stringify({ auth: req.headers.authorization ?? null, nonce: req.headers['x-nonce'] ?? null }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

let store: WorkspaceStore;
let secrets: MemorySecretStore;
let envId: string;
let colId: string;

beforeEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(join(tmpdir(), 'rota-run-'));
  secrets = new MemorySecretStore();
  store = await WorkspaceStore.open(root, { secrets });
  envId = await store.createEnvironment('Local', [
    { key: 'base', type: 'default', enabled: true, value: base },
    { key: 'ACCESS_TOKEN', type: 'secret', enabled: true, value: 'antigo' },
  ]);
  colId = await store.createCollection('API', { auth: { type: 'bearer', token: '{{ACCESS_TOKEN}}' } });
  await store.updateCollection(colId, {
    scripts: { preRequest: 'pm.variables.set("nonce", "n-1");', postResponse: '' },
  });
});

const settings = { defaultTimeoutMs: 5000 };

describe('runRequest com scripts', () => {
  it('login salva o token (secreto) e a próxima requisição usa via herança', async () => {
    const loginId = await store.createRequest(colId, 'Login', {
      method: 'POST',
      url: '{{base}}/login',
      auth: { type: 'none' },
      scripts: {
        preRequest: '',
        postResponse: `
          pm.test("200", () => pm.response.to.have.status(200));
          pm.environment.set("ACCESS_TOKEN", pm.response.json().access_token);`,
      },
    });
    const login = findNode(store.snapshot(), loginId);
    if (login?.kind !== 'request') throw new Error('login');

    const outcome = await runRequest(login.data, {
      store,
      requestId: loginId,
      environmentId: envId,
      settings,
      requestName: 'Login',
    });
    expect(outcome.result.error).toBeNull();
    expect(outcome.result.tests).toEqual([
      { name: '200', status: 'passed', phase: 'post', sourceKind: 'request', source: 'Login' },
    ]);
    const token = secrets.get({ kind: 'environment', id: envId }, 'ACCESS_TOKEN');
    expect(token).toMatch(/^tok-/);
    // O valor secreto nunca vai para o arquivo do ambiente.
    expect(await readFile(join(root, 'environments', 'local.env.json'), 'utf8')).not.toContain(token);
    expect(outcome.secretValues).toContain(token);

    const meId = await store.createRequest(colId, 'Me', {
      url: '{{base}}/me',
      headers: [{ key: 'X-Nonce', value: '{{nonce}}' }],
    });
    const me = findNode(store.snapshot(), meId);
    if (me?.kind !== 'request') throw new Error('me');
    const second = await runRequest(me.data, { store, requestId: meId, environmentId: envId, settings });
    expect(JSON.parse(second.result.response?.body.data ?? '{}')).toEqual({
      auth: `Bearer ${token}`,
      nonce: 'n-1',
    });
    // A versão "para exibir" mascara o token.
    expect(second.result.request?.headers).toContainEqual(['Authorization', 'Bearer ••••••']);
  });

  it('relata erros de script sem impedir o envio', async () => {
    const id = await store.createRequest(colId, 'Quebrada', {
      url: '{{base}}/x',
      scripts: { preRequest: 'naoExiste();', postResponse: 'pm.test("ok", () => {});' },
    });
    const node = findNode(store.snapshot(), id);
    if (node?.kind !== 'request') throw new Error('node');
    const { result } = await runRequest(node.data, { store, requestId: id, environmentId: envId, settings });
    expect(result.response?.status).toBe(200);
    expect(result.scriptErrors).toEqual([
      expect.objectContaining({
        phase: 'pre',
        sourceKind: 'request',
        message: expect.stringMatching(/ReferenceError/),
      }),
    ]);
    expect(result.tests?.map((t) => t.status)).toEqual(['passed']);
  });

  it('pode desligar os scripts', async () => {
    const id = await store.createRequest(colId, 'Sem scripts', {
      url: '{{base}}/x',
      scripts: { preRequest: 'pm.environment.set("x","1")', postResponse: '' },
    });
    const node = findNode(store.snapshot(), id);
    if (node?.kind !== 'request') throw new Error('node');
    await runRequest(node.data, { store, requestId: id, environmentId: envId, settings, runScripts: false });
    expect(store.snapshot().environments[0]?.variables.map((v) => v.key)).toEqual(['base', 'ACCESS_TOKEN']);
  });
});

describe('beforeSend', () => {
  it('recebe o método final (alterado pelo pré-script) e pode impedir o envio', async () => {
    let hits = 0;
    const counting = createServer((_req, res) => {
      hits++;
      res.end('ok');
    });
    await new Promise<void>((r) => counting.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(counting.address() as AddressInfo).port}/x`;
    try {
      const id = await store.createRequest(colId, 'Disfarçada', {
        method: 'GET',
        url,
        scripts: { preRequest: 'pm.request.method = "delete";', postResponse: '' },
      });
      const node = findNode(store.snapshot(), id);
      if (node?.kind !== 'request') throw new Error('req');
      const seen: string[] = [];
      await expect(
        runRequest(node.data, {
          store,
          requestId: id,
          environmentId: envId,
          settings,
          beforeSend: async (req) => {
            seen.push(req.method);
            throw new Error('recusado');
          },
        }),
      ).rejects.toThrow('recusado');
      expect(seen).toEqual(['DELETE']);
      expect(hits).toBe(0);
    } finally {
      await new Promise((r) => counting.close(r));
    }
  });
});
