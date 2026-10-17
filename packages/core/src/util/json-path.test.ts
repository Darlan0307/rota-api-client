import { describe, expect, it } from 'vitest';
import { captureLine, upsertCaptureLine } from '../scripts/capture';
import { formatJsonPath, jsAccessor, jsonPathAtOffset, suggestVariableName, valueAtPath } from './json-path';
import { buildJsonTable, compareCells, findJsonTables, toCsv, VALUE_COLUMN } from './json-table';

const json = JSON.stringify(
  { data: { pedido: { id: 42, 'nota-fiscal': 'NF1' }, items: [{ sku: 'A' }, { sku: 'B' }] }, ok: true },
  null,
  2,
);
const at = (needle: string, delta = 0) => jsonPathAtOffset(json, json.indexOf(needle) + delta);

describe('jsonPathAtOffset', () => {
  it('encontra o campo sob o cursor (valor ou chave)', () => {
    expect(at('42')).toEqual(['data', 'pedido', 'id']);
    expect(at('42', 2)).toEqual(['data', 'pedido', 'id']);
    expect(at('"id"', 1)).toEqual(['data', 'pedido', 'id']);
    expect(at('"B"')).toEqual(['data', 'items', 1, 'sku']);
    expect(at('"nota-fiscal"', 3)).toEqual(['data', 'pedido', 'nota-fiscal']);
    expect(at('true')).toEqual(['ok']);
  });

  it('lida com escapes e JSON inválido', () => {
    const text = '{"a":"x\\"}y","b":1}';
    expect(jsonPathAtOffset(text, text.indexOf('1'))).toEqual(['b']);
    expect(jsonPathAtOffset('{"a":', 3)).toBeNull();
    expect(jsonPathAtOffset('[1,2]', 3)).toEqual([1]);
  });
});

describe('caminhos', () => {
  it('formata e lê valores', () => {
    const path = ['data', 'items', 0, 'nota-fiscal'];
    expect(jsAccessor(path)).toBe('.data.items[0]["nota-fiscal"]');
    expect(formatJsonPath(path)).toBe('data.items[0]["nota-fiscal"]');
    expect(formatJsonPath([0, 'id'])).toBe('[0].id');
    expect(valueAtPath(JSON.parse(json), ['data', 'items', 1, 'sku'])).toBe('B');
    expect(valueAtPath(JSON.parse(json), ['data', 'x', 'y'])).toBeUndefined();
  });

  it('sugere nomes de variável', () => {
    expect(suggestVariableName(['data', 'pedido', 'id'])).toBe('pedidoId');
    expect(suggestVariableName(['data', 'id'])).toBe('id');
    expect(suggestVariableName(['access_token'])).toBe('accessToken');
    expect(suggestVariableName([0])).toBe('valor');
  });
});

describe('captura em script', () => {
  it('gera a linha e substitui em vez de duplicar', () => {
    const line = captureLine('environment', 'pedidoId', ['data', 'pedido', 'id']);
    expect(line).toBe(
      'if (pm.response.code < 400) pm.environment.set("pedidoId", pm.response.json().data.pedido.id);',
    );
    // Linhas escritas à mão (sem a condição) também são substituídas.
    expect(upsertCaptureLine("pm.globals.set('pedidoId', 1);", 'pedidoId', line)).toBe(line);
    const script = upsertCaptureLine('pm.test("ok", () => {});', 'pedidoId', line);
    expect(script).toBe(`pm.test("ok", () => {});\n${line}`);
    const moved = captureLine('collection', 'pedidoId', ['id']);
    expect(upsertCaptureLine(script, 'pedidoId', moved)).toBe(`pm.test("ok", () => {});\n${moved}`);
    expect(upsertCaptureLine('', 'x', 'L')).toBe('L');
  });
});

describe('tabela', () => {
  it('encontra listas e monta colunas', () => {
    const value = { total: 2, data: { items: [{ a: 1 }, { b: 2 }] }, tags: ['x'] };
    expect(findJsonTables(value)).toEqual([{ path: ['data', 'items'], label: 'data.items', count: 2 }]);
    expect(findJsonTables([{ id: 1 }])[0]?.label).toBe('(raiz)');
    expect(buildJsonTable([{ a: 1 }, { b: 2 }, 3])).toEqual({
      columns: ['a', 'b', VALUE_COLUMN],
      rows: [{ a: 1 }, { b: 2 }, { [VALUE_COLUMN]: 3 }],
    });
  });

  it('ordena números como números e vazios no fim', () => {
    expect([10, 2, null, 1].sort(compareCells)).toEqual([1, 2, 10, null]);
    expect(['item 10', 'item 2'].sort(compareCells)).toEqual(['item 2', 'item 10']);
  });

  it('gera CSV com ponto e vírgula e aspas quando preciso', () => {
    const csv = toCsv(['nome', 'obs', 'tags'], [{ nome: 'Ana; Maria', obs: 'diz "oi"', tags: ['a'] }]);
    expect(csv).toBe('nome;obs;tags\r\n"Ana; Maria";"diz ""oi""";"[""a""]"\r\n');
  });
});
