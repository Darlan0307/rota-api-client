import { describe, expect, it } from 'vitest';
import { MemorySecretStore, type SecretScope } from '../secrets/secret-store';
import { persistVariables, viewVariables, withSecretValues } from './persist';

const scope: SecretScope = { kind: 'environment', id: 'e1' };

describe('persistVariables', () => {
  it('nunca grava valor secreto no arquivo', () => {
    const secrets = new MemorySecretStore();
    const vars = persistVariables(
      [
        { key: 'url', type: 'default', enabled: true, value: 'http://x' },
        { key: 'token', type: 'secret', enabled: true, value: 's3cr3t' },
      ],
      [],
      scope,
      secrets,
    );
    expect(vars).toEqual([
      { key: 'url', type: 'default', enabled: true, value: 'http://x' },
      { key: 'token', type: 'secret', enabled: true },
    ]);
    expect(secrets.get(scope, 'token')).toBe('s3cr3t');
  });

  it('mantém o segredo quando o valor não é enviado e migra ao renomear', () => {
    const secrets = new MemorySecretStore();
    secrets.set(scope, 'token', 'abc');
    const previous = [{ key: 'token', type: 'secret' as const, enabled: true }];

    persistVariables([{ key: 'token', type: 'secret', enabled: true }], previous, scope, secrets);
    expect(secrets.get(scope, 'token')).toBe('abc');

    persistVariables(
      [{ key: 'jwt', type: 'secret', enabled: true, previousKey: 'token' }],
      previous,
      scope,
      secrets,
    );
    expect(secrets.get(scope, 'token')).toBeUndefined();
    expect(secrets.get(scope, 'jwt')).toBe('abc');
  });

  it('move o valor entre arquivo e cofre ao trocar o tipo', () => {
    const secrets = new MemorySecretStore();
    const toSecret = persistVariables(
      [{ key: 'pass', type: 'secret', enabled: true }],
      [{ key: 'pass', type: 'default', enabled: true, value: '123456' }],
      scope,
      secrets,
    );
    expect(toSecret[0]).not.toHaveProperty('value');
    expect(secrets.get(scope, 'pass')).toBe('123456');

    const back = persistVariables(
      [{ key: 'pass', type: 'default', enabled: true }],
      toSecret,
      scope,
      secrets,
    );
    expect(back[0]?.value).toBe('123456');
    expect(secrets.has(scope, 'pass')).toBe(false);
  });

  it('apaga segredos de variáveis removidas e ignora chaves vazias', () => {
    const secrets = new MemorySecretStore();
    secrets.set(scope, 'old', 'x');
    const vars = persistVariables(
      [{ key: '  ', type: 'default', enabled: true, value: 'lixo' }],
      [{ key: 'old', type: 'secret', enabled: true }],
      scope,
      secrets,
    );
    expect(vars).toEqual([]);
    expect(secrets.has(scope, 'old')).toBe(false);
  });
});

describe('viewVariables / withSecretValues', () => {
  it('esconde valores secretos na visão e os preenche para execução', () => {
    const secrets = new MemorySecretStore();
    secrets.set(scope, 'token', 'abc');
    const vars = [
      { key: 'token', type: 'secret' as const, enabled: true },
      { key: 'vazio', type: 'secret' as const, enabled: true },
      { key: 'url', type: 'default' as const, enabled: true, value: 'u' },
    ];
    expect(viewVariables(vars, scope, secrets)).toEqual([
      { key: 'token', type: 'secret', enabled: true, hasValue: true },
      { key: 'vazio', type: 'secret', enabled: true, hasValue: false },
      { key: 'url', type: 'default', enabled: true, value: 'u' },
    ]);
    expect(withSecretValues(vars, scope, secrets).map((v) => v.value)).toEqual(['abc', '', 'u']);
  });
});
