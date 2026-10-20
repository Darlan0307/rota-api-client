import { describe, expect, it } from 'vitest';
import { formatJsonTemplate, jsonSyntaxError, lineColumnAt } from './json-template';

describe('JSON com {{variáveis}}', () => {
  it('aceita variáveis sem aspas, como no Postman', () => {
    expect(
      jsonSyntaxError(
        '{\n  "LojaId": "{{LOJA_ID}}",\n  "PedidoId": {{PEDIDO_ID}},\n  "Itens": [{{ITEM}}]\n}',
      ),
    ).toBeNull();
    expect(jsonSyntaxError('{{CORPO}}')).toBeNull();
    expect(jsonSyntaxError('{ "texto": "chaves {{ soltas }} e \\"aspas\\"" }')).toBeNull();
    expect(jsonSyntaxError('   ')).toBeNull();
  });

  it('aponta o erro de verdade, com a posição', () => {
    const text = '{\n  "PedidoId": {{PEDIDO_ID}},\n  "Numero": 331,\n}';
    const error = jsonSyntaxError(text);
    expect(error?.message).toMatch(/Vírgula sobrando/);
    expect(lineColumnAt(text, error?.offset ?? 0)).toEqual({ line: 4, column: 1 });
  });

  it('explica texto sem aspas (ex.: um GUID que perdeu as aspas)', () => {
    const error = jsonSyntaxError('{ "LojaId": 3fa85f64-5717-4562-b3fc-2c963f66afa6 }');
    expect(error?.message).toMatch(/precisam estar entre aspas/);
    expect(error?.offset).toBe(12);
  });

  it('acusa vírgula faltando, objeto aberto e lixo no fim', () => {
    expect(jsonSyntaxError('{ "a": 1 "b": 2 }')?.message).toMatch(/falta uma vírgula/);
    expect(jsonSyntaxError('{ "a": 1')?.message).toMatch(/Falta fechar o objeto/);
    expect(jsonSyntaxError('{ "a": 1 } x')?.message).toMatch(/depois do fim/);
    expect(jsonSyntaxError('{ a: 1 }')?.message).toMatch(/nome do campo entre aspas/);
  });

  it('formata mantendo as variáveis sem aspas', () => {
    expect(formatJsonTemplate('{"a":{{A}},"b":"{{B}}","c":[{{C}},2]}')).toBe(
      '{\n  "a": {{A}},\n  "b": "{{B}}",\n  "c": [\n    {{C}},\n    2\n  ]\n}',
    );
    expect(formatJsonTemplate('{"a":1,}')).toBeNull();
  });
});
