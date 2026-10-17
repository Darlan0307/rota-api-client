import { describe, expect, it } from 'vitest';
import { RequestDataSchema } from '../model/schemas';
import { diffLines, diffRequestData, diffVariables } from './diff';

describe('diffLines', () => {
  it('marca linhas iguais, removidas e adicionadas', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('lida com textos vazios e com o limite de tamanho', () => {
    expect(diffLines('', 'novo')).toEqual([
      { type: 'removed', text: '' },
      { type: 'added', text: 'novo' },
    ]);
    expect(diffLines('a\nb', 'a\nc', 1).map((l) => l.type)).toEqual(['removed', 'removed', 'added', 'added']);
  });
});

describe('diffRequestData', () => {
  const base = RequestDataSchema.parse({
    method: 'GET',
    url: 'http://x/a',
    headers: [{ key: 'Accept', value: 'json' }],
    body: { mode: 'json', text: '{\n  "a": 1\n}' },
  });

  it('descreve as mudanças campo a campo', () => {
    const changed = RequestDataSchema.parse({
      ...base,
      method: 'POST',
      headers: [
        { key: 'Accept', value: 'xml' },
        { key: 'X-Id', value: '1' },
      ],
      auth: { type: 'bearer', token: '{{t}}' },
      body: { mode: 'json', text: '{\n  "a": 2\n}' },
      settings: { followRedirects: true, verifySsl: false },
    });
    const changes = diffRequestData(base, changed);
    expect(changes.map((c) => c.field)).toEqual([
      'Método',
      'Header "Accept"',
      'Header "X-Id" adicionado',
      'Autenticação',
      'Body',
      'Verificar SSL',
    ]);
    expect(changes[0]).toMatchObject({ before: 'GET', after: 'POST' });
    expect(changes[3]).toMatchObject({ before: 'Herdar', after: 'Bearer {{t}}' });
    expect(changes[4]?.lines?.filter((l) => l.type !== 'same')).toEqual([
      { type: 'removed', text: '  "a": 1' },
      { type: 'added', text: '  "a": 2' },
    ]);
  });

  it('retorna lista vazia quando nada mudou', () => {
    expect(diffRequestData(base, structuredClone(base))).toEqual([]);
  });
});

describe('diffVariables', () => {
  it('nunca exibe valores secretos', () => {
    const changes = diffVariables(
      [{ key: 'token', type: 'secret', enabled: true }],
      [
        { key: 'token', type: 'secret', enabled: false },
        { key: 'url', type: 'default', enabled: true, value: 'http://x' },
      ],
    );
    expect(changes).toEqual([
      { field: 'Variável "token"', before: '•••••• (secreta)', after: '•••••• (secreta) (desabilitada)' },
      { field: 'Variável "url" adicionada', after: 'http://x' },
    ]);
  });
});
