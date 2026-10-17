import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findNode, walkTree } from '../model/tree';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { Trash } from './trash';

let root: string;
let local: string;
let store: WorkspaceStore;
let secrets: MemorySecretStore;
let trash: Trash;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rota-trash-ws-'));
  local = await mkdtemp(join(tmpdir(), 'rota-trash-local-'));
  secrets = new MemorySecretStore();
  store = await WorkspaceStore.open(root, { secrets });
  trash = new Trash(join(local, 'trash'), store);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(local, { recursive: true, force: true });
});

const names = () => [...walkTree(store.snapshot().collections)].map((n) => n.name);

describe('Trash', () => {
  it('move uma requisição (com exemplos) para a lixeira e restaura no mesmo lugar', async () => {
    const col = await store.createCollection('API');
    await store.createRequest(col, 'A');
    const b = await store.createRequest(col, 'B');
    await store.createRequest(col, 'C');
    await store.saveExample(b, {
      name: 'Ok',
      response: { status: 200, statusText: 'OK', headers: [], body: '{}' },
    });

    const entry = await trash.moveToTrash(b);
    expect(names()).toEqual(['API', 'A', 'C']);
    expect(await trash.list()).toEqual([
      expect.objectContaining({ kind: 'request', name: 'B', breadcrumb: ['API'], index: 1 }),
    ]);

    await trash.restore(entry.id);
    expect(names()).toEqual(['API', 'A', 'B', 'C']);
    const restored = findNode(store.snapshot(), b);
    expect(restored).toMatchObject({ kind: 'request', examples: [{ name: 'Ok' }] });
    expect(await trash.list()).toEqual([]);
  });

  it('restaura pasta com conteúdo e coleção com segredos', async () => {
    const col = await store.createCollection('Loja', {
      variables: [{ key: 'chave', type: 'secret', enabled: true, value: 's3cr3t' }],
    });
    const folder = await store.createFolder(col, 'Pedidos');
    await store.createRequest(folder, 'Listar');

    const folderEntry = await trash.moveToTrash(folder);
    expect(names()).toEqual(['Loja']);
    await trash.restore(folderEntry.id);
    expect(names()).toEqual(['Loja', 'Pedidos', 'Listar']);

    const colEntry = await trash.moveToTrash(col);
    expect(store.snapshot().collections).toEqual([]);
    expect(secrets.get({ kind: 'collection', id: col }, 'chave')).toBeUndefined();
    expect(secrets.get({ kind: 'trash', id: colEntry.id }, 'chave')).toBe('s3cr3t');

    await trash.restore(colEntry.id);
    expect(names()).toEqual(['Loja', 'Pedidos', 'Listar']);
    expect(secrets.get({ kind: 'collection', id: col }, 'chave')).toBe('s3cr3t');
    expect(secrets.allValues()).toEqual(['s3cr3t']);
  });

  it('restaura ambiente e recusa restaurar filho cujo pai não existe', async () => {
    const env = await store.createEnvironment('Hml', [
      { key: 'TOKEN', type: 'secret', enabled: true, value: 'jwt' },
    ]);
    const envEntry = await trash.moveToTrash(env);
    expect(store.snapshot().environments).toEqual([]);
    await trash.restore(envEntry.id);
    expect(store.snapshot().environments.map((e) => e.name)).toEqual(['Hml']);
    expect(store.revealSecret({ kind: 'environment', id: env }, 'TOKEN')).toBe('jwt');

    const col = await store.createCollection('C');
    const req = await store.createRequest(col, 'R');
    const reqEntry = await trash.moveToTrash(req);
    await store.remove(col);
    await expect(trash.restore(reqEntry.id)).rejects.toThrow(/não existe mais/);
    // Continua na lixeira para tentar depois.
    expect((await trash.list()).map((e) => e.name)).toEqual(['R']);
  });

  it('apaga definitivamente e esvazia, limpando os segredos', async () => {
    const env = await store.createEnvironment('E', [{ key: 'K', type: 'secret', enabled: true, value: 'v' }]);
    const col = await store.createCollection('C');
    await trash.moveToTrash(env);
    const colEntry = await trash.moveToTrash(col);
    await trash.remove(colEntry.id);
    expect((await trash.list()).map((e) => e.name)).toEqual(['E']);
    expect(await trash.empty()).toBe(1);
    expect(await trash.list()).toEqual([]);
    expect(secrets.allValues()).toEqual([]);
  });
});
