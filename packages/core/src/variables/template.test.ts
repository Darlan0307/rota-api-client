import { describe, expect, it } from 'vitest';
import {
  findVariableRefs,
  maskSecretValues,
  resolveTemplate,
  SECRET_MASK,
  unresolvedRefs,
  VariableScope,
  variableRefAt,
} from './template';

describe('findVariableRefs', () => {
  it('encontra referências com posições, ignorando espaços internos', () => {
    expect(findVariableRefs('{{base}}/users/{{ id }}')).toEqual([
      { name: 'base', start: 0, end: 8 },
      { name: 'id', start: 15, end: 23 },
    ]);
  });

  it('localiza a referência sob uma posição', () => {
    const text = 'a {{x}} b';
    expect(variableRefAt(text, 3)?.name).toBe('x');
    expect(variableRefAt(text, 1)).toBeUndefined();
    expect(variableRefAt(text, 7)).toBeUndefined();
  });
});

describe('VariableScope', () => {
  it('segue a prioridade do Postman: global < coleção < ambiente < local', () => {
    const scope = new VariableScope([
      { source: 'environment', variables: [{ key: 'a', value: 'env' }] },
      {
        source: 'global',
        variables: [
          { key: 'a', value: 'global' },
          { key: 'b', value: 'global' },
        ],
      },
      {
        source: 'collection',
        variables: [
          { key: 'a', value: 'col' },
          { key: 'b', value: 'col' },
        ],
      },
    ]);
    expect(scope.get('a')).toMatchObject({ value: 'env', source: 'environment' });
    expect(scope.get('b')).toMatchObject({ value: 'col', source: 'collection' });

    const withLocal = new VariableScope([
      { source: 'environment', variables: [{ key: 'a', value: 'env' }] },
      { source: 'local', variables: [{ key: 'a', value: 'local' }] },
    ]);
    expect(withLocal.get('a')?.value).toBe('local');
  });

  it('ignora variáveis desabilitadas', () => {
    const scope = new VariableScope([
      { source: 'global', variables: [{ key: 'a', value: 'g' }] },
      { source: 'environment', variables: [{ key: 'a', value: 'e', enabled: false }] },
    ]);
    expect(scope.get('a')?.value).toBe('g');
  });
});

describe('resolveTemplate', () => {
  const scope = new VariableScope([
    {
      source: 'environment',
      variables: [
        { key: 'host', value: 'api.local' },
        { key: 'base', value: 'https://{{host}}/v1' },
        { key: 'token', value: 'segredo-123', secret: true },
        { key: 'auth', value: 'Bearer {{token}}' },
        { key: 'loop', value: '{{loop}}' },
      ],
    },
  ]);

  it('resolve recursivamente e mantém referências desconhecidas', () => {
    expect(resolveTemplate('{{base}}/users/{{id}}', scope)).toBe('https://api.local/v1/users/{{id}}');
  });

  it('mascara segredos quando pedido, inclusive aninhados', () => {
    expect(resolveTemplate('{{auth}}', scope)).toBe('Bearer segredo-123');
    expect(resolveTemplate('{{auth}}', scope, { maskSecrets: true })).toBe(`Bearer ${SECRET_MASK}`);
  });

  it('não entra em loop com referências circulares', () => {
    expect(resolveTemplate('{{loop}}', scope)).toBe('{{loop}}');
  });

  it('gera variáveis dinâmicas', () => {
    expect(resolveTemplate('{{$guid}}', scope)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(resolveTemplate('{{$timestamp}}', scope))).toBeGreaterThan(1_600_000_000);
  });

  it('lista referências não resolvidas', () => {
    expect(unresolvedRefs('{{host}} {{nada}} {{$guid}}', scope).map((r) => r.name)).toEqual(['nada']);
  });
});

describe('maskSecretValues', () => {
  it('mascara valores secretos literais, priorizando os mais longos', () => {
    expect(maskSecretValues('token=abcd1234 e abcd', ['abcd', 'abcd1234'])).toBe(
      `token=${SECRET_MASK} e ${SECRET_MASK}`,
    );
  });

  it('ignora valores curtos demais', () => {
    expect(maskSecretValues('a b c', ['a'])).toBe('a b c');
  });
});

describe('pairForReplay', () => {
  it('o segundo escopo repete os valores dinâmicos do primeiro, na ordem', () => {
    const [record, replay] = new VariableScope([]).pairForReplay();
    const text = '{{$guid}} {{$cpf}} {{$guid}}';
    const sent = resolveTemplate(text, record);
    expect(resolveTemplate(text, replay)).toBe(sent);
    expect(sent.split(' ')[0]).not.toBe(sent.split(' ')[2]);
  });

  it('pula o que estava dentro de uma variável secreta (mascarada não entra nela)', () => {
    const scope = new VariableScope([
      { source: 'environment', variables: [{ key: 'token', value: 'tk-{{$guid}}', secret: true }] },
    ]);
    const [record, replay] = scope.pairForReplay();
    const sent = resolveTemplate('{{token}}|{{$cpf}}', record);
    const shown = resolveTemplate('{{token}}|{{$cpf}}', replay, { maskSecrets: true });
    expect(shown.split('|')[0]).toBe(SECRET_MASK);
    expect(shown.split('|')[1]).toBe(sent.split('|')[1]);
  });
});
