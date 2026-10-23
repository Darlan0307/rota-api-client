import { describe, expect, it } from 'vitest';
import { bodyForPack, maskHeaderValue, renderContextPack, trimJson } from './pack';

describe('pacote de contexto', () => {
  it('mascara valor digitado em header sensível, mas não {{variável}}', () => {
    expect(maskHeaderValue('Authorization', 'Bearer eyJhbGciOi')).toBe('Bearer ••••••');
    expect(maskHeaderValue('Authorization', 'Bearer {{token}}')).toBe('Bearer {{token}}');
    expect(maskHeaderValue('X-Api-Key', 'abc123')).toBe('••••••');
    expect(maskHeaderValue('Content-Type', 'application/json')).toBe('application/json');
  });

  it('encurta listas longas do JSON', () => {
    expect(trimJson({ itens: [1, 2, 3, 4, 5] }, 2)).toEqual({ itens: [1, 2, '… mais 3 itens'] });
    expect(trimJson([{ a: [1, 2, 3] }], 2)).toEqual([{ a: [1, 2, '… mais 1 itens'] }]);
  });

  it('formata corpo JSON, mantém {{variáveis}} sem aspas e corta texto enorme', () => {
    expect(bodyForPack('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', language: 'json' });
    expect(bodyForPack('{ "id": {{ID}} }').language).toBe('json');
    expect(bodyForPack('x'.repeat(9000)).text).toContain('cortado: 1000 caracteres a mais');
  });

  it('monta o Markdown na ordem dos itens', () => {
    const md = renderContextPack([
      { kind: 'note', id: '1', title: 'Objetivo', text: 'Integrar pedidos.' },
      {
        kind: 'request',
        id: '2',
        title: 'Listar pedidos',
        method: 'GET',
        url: '{{baseUrl}}/pedidos',
        headers: [{ key: 'Authorization', value: 'Bearer abc' }],
        response: {
          status: 200,
          statusText: 'OK',
          timeMs: 41.6,
          contentType: 'application/json',
          body: '[]',
        },
      },
      {
        kind: 'table',
        id: '3',
        title: 'PEDIDOS',
        engine: 'firebird',
        table: { name: 'PEDIDOS', ref: 'PEDIDOS', kind: 'table', columns: [] },
      },
    ]);
    expect(md.indexOf('## Objetivo')).toBeLessThan(md.indexOf('## Requisição: Listar pedidos'));
    expect(md).toContain('```\nGET {{baseUrl}}/pedidos\n```');
    expect(md).toContain('- `Authorization: Bearer ••••••`');
    expect(md).toContain('Resposta: 200 OK, 42 ms (application/json)');
    expect(md).toContain('## Tabela `PEDIDOS`');
    expect(md).toContain('(Banco Firebird.)');
  });

  it('usa cerca maior quando o conteúdo tem crases', () => {
    const md = renderContextPack([{ kind: 'webhook', id: '1', title: 'Evento', body: 'a ``` b' }]);
    expect(md).toContain('````\na ``` b\n````');
  });
});
