import { describe, expect, it } from 'vitest';
import type { ExampleFile } from '../model/schemas';
import { checkContract, referenceExample } from './reference';
import { compareJsonBodies, compareShapes, describeContractIssue, inferShape } from './shape';

const cmp = (a: unknown, b: unknown) => compareShapes(inferShape(a), inferShape(b));

describe('contrato da resposta', () => {
  it('não acusa nada quando só os valores mudam', () => {
    expect(cmp({ id: 1, nome: 'Ana', tags: ['a'] }, { id: 2, nome: 'Bia', tags: [] })).toEqual({
      breaking: [],
      added: [],
    });
  });

  it('detecta campo removido, tipo trocado e campo novo, inclusive dentro de arrays', () => {
    const report = cmp(
      { users: [{ id: 1, email: 'a@x' }], total: 1 },
      { users: [{ id: '1', nome: 'Ana' }], total: 1 },
    );
    expect(report.breaking).toEqual([
      { kind: 'type', path: 'users[].id', expected: 'number', actual: 'string' },
      { kind: 'removed', path: 'users[].email', expected: 'string' },
    ]);
    expect(report.added).toEqual([{ kind: 'added', path: 'users[].nome', actual: 'string' }]);
    expect(report.breaking.map(describeContractIssue)).toEqual([
      'O campo "users[].id" mudou de tipo: era number, veio string.',
      'O campo "users[].email" não veio na resposta (era string).',
    ]);
  });

  it('campos que já eram opcionais no exemplo (ausentes em algum item) não quebram', () => {
    const report = cmp([{ id: 1, apelido: 'x' }, { id: 2 }], [{ id: 3 }]);
    expect(report.breaking).toEqual([]);
  });

  it('null onde o exemplo tinha outro tipo é quebra; se o exemplo já tinha null, não', () => {
    expect(cmp({ a: 'x' }, { a: null }).breaking).toHaveLength(1);
    expect(cmp([{ a: 'x' }, { a: null }], [{ a: null }]).breaking).toEqual([]);
  });

  it('só compara corpos JSON', () => {
    expect(compareJsonBodies('<html/>', '{}')).toBeUndefined();
    expect(compareJsonBodies('{"a":1}', '{"a":1}')).toEqual({ breaking: [], added: [] });
  });
});

describe('exemplo de referência', () => {
  const ex = (id: string, status: number, body: string, savedAt: string): ExampleFile => ({
    schemaVersion: 1,
    id,
    name: id,
    response: { status, statusText: '', headers: [], body },
    savedAt,
  });
  const examples = [
    ex('antigo', 200, '{"a":1}', '2026-01-01'),
    ex('novo', 200, '{"a":1,"b":2}', '2026-05-01'),
    ex('erro', 404, '{"erro":"x"}', '2026-06-01'),
    ex('texto', 201, 'ok', '2026-06-01'),
  ];

  it('usa o mais recente com o mesmo status e corpo JSON', () => {
    expect(referenceExample(examples, 200)?.id).toBe('novo');
    expect(referenceExample(examples, 201)).toBeUndefined();
    expect(referenceExample(examples, 500)).toBeUndefined();
  });

  it('compara com o escolhido pelo usuário', () => {
    const check = checkContract(examples, 200, '{"a":1}');
    expect(check?.example.id).toBe('novo');
    expect(check?.report.breaking).toEqual([{ kind: 'removed', path: 'b', expected: 'number' }]);
    expect(checkContract(examples, 200, '{"a":1}', 'antigo')?.report.breaking).toEqual([]);
  });
});
