import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertEnvironment, detectPostmanFile } from '../import/postman';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { buildBackup } from './backup';

let root: string;
let store: WorkspaceStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rota-backup-'));
  store = await WorkspaceStore.open(root, { secrets: new MemorySecretStore() });
  await store.createCollection('API', {
    variables: [{ key: 'token', type: 'secret', enabled: true, value: 'tok-colecao' }],
  });
  // Nome repetido: arquivos não podem se sobrescrever.
  await store.createCollection('API');
  await store.createEnvironment('Produção', [
    { key: 'base', type: 'default', enabled: true, value: 'https://api.x' },
    { key: 'senha', type: 'secret', enabled: true, value: 'senha-prod' },
  ]);
  await store.updateGlobals([{ key: 'g', type: 'secret', enabled: true, value: 'global-secreto' }]);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('backup completo', () => {
  it('gera um arquivo por coleção e ambiente, sem segredos por padrão', () => {
    const backup = buildBackup(store.snapshot());
    expect(backup.files.map((f) => f.path)).toEqual([
      'colecoes/api.postman_collection.json',
      'colecoes/api-2.postman_collection.json',
      'ambientes/producao.postman_environment.json',
      'globais.postman_globals.json',
      'LEIA-ME.txt',
    ]);
    expect(backup).toMatchObject({ collections: 2, environments: 1, secretsTotal: 3, secretsIncluded: 0 });
    const all = backup.files.map((f) => f.content).join('\n');
    expect(all).not.toMatch(/tok-colecao|senha-prod|global-secreto/);
    expect(all).toContain('https://api.x');
    expect(detectPostmanFile(JSON.parse(backup.files[2]?.content ?? '{}'))).toMatchObject({
      kind: 'environment',
    });
    expect(backup.files.at(-1)?.content).toContain('exportadas VAZIAS');
  });

  it('inclui os segredos só quando pedido, e avisa no LEIA-ME', () => {
    const backup = buildBackup(store.snapshot(), {
      revealSecret: (target, key) => store.revealSecret(target, key),
    });
    const all = backup.files.map((f) => f.content).join('\n');
    expect(all).toContain('tok-colecao');
    expect(all).toContain('senha-prod');
    expect(all).toContain('global-secreto');
    expect(backup.secretsIncluded).toBe(3);
    expect(backup.files.at(-1)?.content).toContain('TEXTO PURO');

    // Reimportar devolve o segredo como secreto (com o valor).
    const env = convertEnvironment(JSON.parse(backup.files[2]?.content ?? '{}'));
    expect(env.variables.find((v) => v.key === 'senha')).toMatchObject({
      type: 'secret',
      value: 'senha-prod',
    });
  });
});
