import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedFileSecretStore, GLOBAL_SCOPE, type SecretScope } from './secret-store';

const env: SecretScope = { kind: 'environment', id: 'env-1' };

describe('EncryptedFileSecretStore', () => {
  let dir: string;
  let file: string;
  const key = randomBytes(32);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rota-secrets-'));
    file = join(dir, 'secrets.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('grava cifrado e lê de volta, inclusive valores longos (JWT)', async () => {
    const store = new EncryptedFileSecretStore(file, () => key);
    const jwt = `eyJ${'a'.repeat(5000)}`;
    store.set(env, 'ACCESS_TOKEN', jwt);

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('aaaa');
    expect(raw).toContain('environment/env-1/ACCESS_TOKEN');

    const other = new EncryptedFileSecretStore(file, () => key);
    expect(other.get(env, 'ACCESS_TOKEN')).toBe(jwt);
  });

  it('enxerga alterações feitas por outro processo', () => {
    const app = new EncryptedFileSecretStore(file, () => key);
    const mcp = new EncryptedFileSecretStore(file, () => key);
    app.set(GLOBAL_SCOPE, 'a', '1');
    expect(mcp.get(GLOBAL_SCOPE, 'a')).toBe('1');
    mcp.set(GLOBAL_SCOPE, 'b', '2');
    expect(app.get(GLOBAL_SCOPE, 'b')).toBe('2');
    expect(app.get(GLOBAL_SCOPE, 'a')).toBe('1');
  });

  it('renomeia, apaga e limpa um escopo inteiro', () => {
    const store = new EncryptedFileSecretStore(file, () => key);
    store.set(env, 'x', '1');
    store.set(env, 'y', '2');
    store.set(GLOBAL_SCOPE, 'x', 'g');

    store.rename(env, 'x', 'z');
    expect(store.get(env, 'x')).toBeUndefined();
    expect(store.get(env, 'z')).toBe('1');

    store.delete(env, 'y');
    expect(store.has(env, 'y')).toBe(false);

    store.deleteScope(env);
    expect(store.allValues()).toEqual(['g']);
  });

  it('ignora entradas cifradas com outra chave', () => {
    new EncryptedFileSecretStore(file, () => key).set(env, 'x', '1');
    const wrongKey = new EncryptedFileSecretStore(file, () => randomBytes(32));
    expect(wrongKey.get(env, 'x')).toBeUndefined();
  });
});
