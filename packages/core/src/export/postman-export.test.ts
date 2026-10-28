import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertCollection, convertEnvironment, detectPostmanFile } from '../import/postman';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { exportCollectionToPostman, exportEnvironmentToPostman } from './postman-export';

let root: string;
let store: WorkspaceStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rota-export-'));
  store = await WorkspaceStore.open(root, { secrets: new MemorySecretStore() });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('exportação para o Postman', () => {
  it('ida e volta preserva a estrutura e não leva valores secretos', async () => {
    const col = await store.createCollection('API', {
      auth: { type: 'bearer', token: '{{token}}' },
      variables: [
        { key: 'base', type: 'default', enabled: true, value: 'https://api.x' },
        { key: 'token', type: 'secret', enabled: true, value: 'segredo-123' },
      ],
    });
    await store.updateCollection(col, { scripts: { preRequest: 'console.log(1)', postResponse: '' } });
    const folder = await store.createFolder(col, 'Usuários');
    const req = await store.createRequest(folder, 'Criar', {
      method: 'POST',
      url: '{{base}}/users',
      query: [{ key: 'notificar', value: 'sim', enabled: false }],
      headers: [{ key: 'X-App', value: 'rota' }],
      body: { mode: 'json', text: '{"nome":"Ana"}' },
      scripts: { preRequest: '', postResponse: 'pm.test("ok", () => {})\npm.environment.set("x", 1)' },
    });
    await store.saveExample(req, {
      name: 'Criado',
      response: {
        status: 201,
        statusText: 'Created',
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        body: '{"id":1}',
      },
    });

    const collection = store.snapshot().collections[0];
    if (!collection) throw new Error('coleção');
    const exported = exportCollectionToPostman(collection);
    const text = JSON.stringify(exported);
    expect(text).not.toContain('segredo-123');
    expect(detectPostmanFile(exported)).toMatchObject({ kind: 'collection', version: '2.1' });

    const back = convertCollection(JSON.parse(text)).collection;
    expect(back.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(back.scripts.preRequest).toBe('console.log(1)');
    expect(back.variables.map((v) => [v.key, v.type])).toEqual([
      ['base', 'default'],
      ['token', 'secret'],
    ]);
    const [f] = back.children;
    if (f?.kind !== 'folder') throw new Error('pasta');
    const [r] = f.children;
    if (r?.kind !== 'request') throw new Error('requisição');
    expect(r.name).toBe('Criar');
    expect(r.data).toMatchObject({
      method: 'POST',
      url: '{{base}}/users',
      query: [{ key: 'notificar', value: 'sim', enabled: false }],
      headers: [{ key: 'X-App', value: 'rota', enabled: true }],
      body: { mode: 'json', text: '{"nome":"Ana"}' },
      scripts: { postResponse: 'pm.test("ok", () => {})\npm.environment.set("x", 1)' },
    });
    expect(r.examples.map((e) => [e.name, e.response.status, e.response.body])).toEqual([
      ['Criado', 201, '{"id":1}'],
    ]);
  });

  it('exporta ambientes sem valores secretos', async () => {
    await store.createEnvironment('Dev', [
      { key: 'url', type: 'default', enabled: true, value: 'http://dev' },
      { key: 'senha', type: 'secret', enabled: true, value: 'abc-123' },
    ]);
    const env = store.snapshot().environments[0];
    if (!env) throw new Error('ambiente');
    const exported = exportEnvironmentToPostman(env);
    expect(JSON.stringify(exported)).not.toContain('abc-123');
    const back = convertEnvironment(exported);
    expect(back.name).toBe('Dev');
    expect(back.variables.map((v) => [v.key, v.type, v.value])).toEqual([
      ['url', 'default', 'http://dev'],
      ['senha', 'secret', ''],
    ]);
  });
});

describe('configurações da requisição no Postman', () => {
  it('headers automáticos desligados, redirecionamento e SSL vão e voltam', async () => {
    const col = await store.createCollection('API');
    await store.createRequest(col, 'Sem UA', {
      url: 'http://x',
      settings: { followRedirects: false, verifySsl: false, disabledAutoHeaders: ['user-agent', 'accept'] },
    });
    const collection = store.snapshot().collections[0];
    if (!collection) throw new Error('coleção');
    const exported = exportCollectionToPostman(collection);
    expect(JSON.stringify(exported)).toContain('"disabledSystemHeaders":{"user-agent":true,"accept":true}');
    const [r] = convertCollection(JSON.parse(JSON.stringify(exported))).collection.children;
    if (r?.kind !== 'request') throw new Error('requisição');
    expect(r.data.settings).toEqual({
      followRedirects: false,
      verifySsl: false,
      disabledAutoHeaders: ['user-agent', 'accept'],
    });
  });

  it('avisa sobre headers que o Rota sempre envia e ignora os que ele nunca manda', () => {
    const { collection, warnings } = convertCollection({
      info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'R',
          protocolProfileBehavior: {
            disabledSystemHeaders: {
              'cache-control': true,
              'postman-token': true,
              host: true,
              'accept-encoding': true,
            },
          },
          request: { method: 'GET', url: 'http://x' },
        },
      ],
    });
    const [r] = collection.children;
    if (r?.kind !== 'request') throw new Error('requisição');
    expect(r.data.settings.disabledAutoHeaders).toEqual(['accept-encoding']);
    expect(warnings.map((w) => w.message)).toEqual([
      'Headers automáticos desligados no Postman que o Rota sempre envia: host.',
    ]);
  });
});
