import { describe, expect, it } from 'vitest';
import type { CollectionNode } from '../model/tree';
import { collectionToMarkdown } from './markdown';

describe('documentação em Markdown', () => {
  it('documenta pastas, requisições e exemplos sem expor segredos', () => {
    const collection: CollectionNode = {
      kind: 'collection',
      id: 'c',
      name: 'Loja',
      description: 'API da loja.',
      auth: { type: 'bearer', token: '{{token}}' },
      scripts: { preRequest: '', postResponse: '' },
      variables: [
        { key: 'base', type: 'default', enabled: true, value: 'https://x' },
        { key: 'token', type: 'secret', enabled: true, hasValue: true },
      ],
      children: [
        {
          kind: 'folder',
          id: 'f',
          name: 'Pedidos',
          parentId: 'c',
          auth: { type: 'inherit' },
          scripts: { preRequest: '', postResponse: '' },
          children: [
            {
              kind: 'request',
              id: 'r',
              name: 'Buscar pedido',
              parentId: 'f',
              data: {
                method: 'GET',
                url: '{{base}}/pedidos/1',
                query: [{ key: 'expand', value: 'itens', enabled: true, description: 'Inclui | itens' }],
                headers: [],
                auth: { type: 'inherit' },
                body: { mode: 'none' },
                scripts: { preRequest: '', postResponse: '' },
                settings: { followRedirects: true, verifySsl: true },
                description: 'Busca um pedido.',
              },
              examples: [
                {
                  schemaVersion: 1,
                  id: 'e',
                  name: 'Sucesso',
                  response: { status: 200, statusText: 'OK', headers: [], body: '{"id":1}' },
                },
              ],
            },
          ],
        },
      ],
    };
    const md = collectionToMarkdown(collection);
    expect(md).toContain('# Loja');
    expect(md).toContain('- [Pedidos](#pedidos)');
    expect(md).toContain('  - [GET Buscar pedido](#get-buscar-pedido)');
    expect(md).toContain('## Pedidos');
    expect(md).toContain('### GET Buscar pedido');
    expect(md).toContain('GET {{base}}/pedidos/1?expand=itens');
    expect(md).toContain('| `expand` | `itens` | sim | Inclui \\| itens |');
    expect(md).toContain('**Exemplo de resposta – Sucesso** (200 OK)');
    expect(md).toContain('| `token` | _(secreta)_ |');
  });
});
