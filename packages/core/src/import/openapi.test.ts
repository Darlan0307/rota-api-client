import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { findNode, walkTree } from '../model/tree';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { importPostmanFiles, previewPostmanFiles } from './import-postman';
import { convertOpenApi } from './openapi';

const openapi3 = `
openapi: 3.0.3
info:
  title: Loja
  version: 1.2.0
  description: API da loja
servers:
  - url: https://{amb}.loja.com/v1
    variables:
      amb: { default: api }
tags:
  - name: Pedidos
    description: Operações de pedidos
security:
  - bearer: []
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
  schemas:
    Pedido:
      type: object
      properties:
        id: { type: integer }
        cliente: { $ref: '#/components/schemas/Cliente' }
        criadoEm: { type: string, format: date-time }
        itens:
          type: array
          items: { type: object, properties: { sku: { type: string }, qtd: { type: integer, minimum: 1 } } }
    Cliente:
      type: object
      properties:
        email: { type: string, format: email }
paths:
  /pedidos/{id}:
    parameters:
      - { name: id, in: path, required: true, schema: { type: integer, example: 42 } }
    get:
      tags: [Pedidos]
      summary: Buscar pedido
      parameters:
        - { name: expand, in: query, schema: { type: string, enum: [itens, cliente] } }
        - { name: X-Trace, in: header, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pedido' }
        '404': { description: Não encontrado }
  /pedidos:
    post:
      tags: [Pedidos]
      operationId: criarPedido
      requestBody:
        content:
          application/json:
            example: { cliente: 7 }
      responses:
        '201':
          description: Criado
          content:
            application/json:
              examples:
                simples: { value: { id: 1 } }
  /saude:
    get:
      summary: Saúde
      security: []
      responses: { '200': { description: OK } }
`;

describe('OpenAPI 3', () => {
  it('converte servidores, tags, parâmetros, corpo, exemplos e segurança', () => {
    const [preview] = previewPostmanFiles([{ fileName: 'loja.yaml', content: openapi3 }]);
    expect(preview).toMatchObject({ kind: 'openapi', name: 'Loja', version: '3.0' });
    expect(preview?.counts).toMatchObject({ folders: 1, requests: 3, examples: 2 });

    const { collection, warnings } = convertOpenApi(parseYaml(openapi3));
    expect(warnings).toEqual([]);
    expect(collection.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(collection.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'baseUrl', value: 'https://api.loja.com/v1' }),
        expect.objectContaining({ key: 'token', type: 'secret' }),
        expect.objectContaining({ key: 'id', value: '42' }),
      ]),
    );
    const [folder, saude] = collection.children;
    if (folder?.kind !== 'folder' || saude?.kind !== 'request') throw new Error('estrutura');
    expect(folder).toMatchObject({ name: 'Pedidos', description: 'Operações de pedidos' });
    expect(saude.data.auth).toEqual({ type: 'none' });

    const [buscar, criar] = folder.children;
    if (buscar?.kind !== 'request' || criar?.kind !== 'request') throw new Error('requisições');
    expect(buscar.name).toBe('Buscar pedido');
    expect(buscar.data).toMatchObject({
      method: 'GET',
      url: '{{baseUrl}}/pedidos/{{id}}',
      query: [{ key: 'expand', value: 'itens', enabled: false }],
      headers: [{ key: 'X-Trace', value: '', enabled: false }],
      auth: { type: 'inherit' },
    });
    // Exemplo gerado do schema (com $ref resolvido) para o 200; o 404 sem conteúdo é ignorado.
    expect(buscar.examples).toHaveLength(1);
    expect(JSON.parse(buscar.examples[0]?.response.body ?? '')).toEqual({
      id: 0,
      cliente: { email: 'usuario@exemplo.com' },
      criadoEm: '2026-01-01T12:00:00Z',
      itens: [{ sku: 'string', qtd: 1 }],
    });

    expect(criar.name).toBe('criarPedido');
    expect(criar.data.body).toEqual({ mode: 'json', text: '{\n  "cliente": 7\n}' });
    expect(criar.examples.map((e) => [e.name, e.response.status, e.response.body])).toEqual([
      ['201 – simples', 201, '{\n  "id": 1\n}'],
    ]);
  });
});

describe('Swagger 2.0', () => {
  it('converte host/basePath, body, formData e apiKey', () => {
    const { collection } = convertOpenApi({
      swagger: '2.0',
      info: { title: 'Antiga', version: '1' },
      host: 'api.antiga.com',
      basePath: '/v2',
      schemes: ['https'],
      securityDefinitions: { chave: { type: 'apiKey', name: 'X-API-Key', in: 'header' } },
      security: [{ chave: [] }],
      definitions: { Pet: { type: 'object', properties: { nome: { type: 'string', example: 'Rex' } } } },
      paths: {
        '/pets': {
          post: {
            parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Pet' } }],
            responses: { 200: { description: 'OK', schema: { $ref: '#/definitions/Pet' } } },
          },
        },
        '/upload': {
          post: {
            consumes: ['multipart/form-data'],
            parameters: [
              { name: 'arquivo', in: 'formData', type: 'file' },
              { name: 'titulo', in: 'formData', type: 'string', default: 'foto' },
            ],
            responses: {},
          },
        },
      },
    });
    expect(collection.variables[0]).toMatchObject({ key: 'baseUrl', value: 'https://api.antiga.com/v2' });
    expect(collection.auth).toEqual({ type: 'apikey', key: 'X-API-Key', value: '{{apiKey}}', in: 'header' });
    const [pets, upload] = collection.children;
    if (pets?.kind !== 'request' || upload?.kind !== 'request') throw new Error('estrutura');
    expect(pets.data.body).toEqual({ mode: 'json', text: '{\n  "nome": "Rex"\n}' });
    expect(pets.examples[0]?.response.body).toBe('{\n  "nome": "Rex"\n}');
    expect(upload.data.body).toEqual({
      mode: 'formdata',
      fields: [
        { key: 'arquivo', type: 'file', value: '', enabled: true },
        { key: 'titulo', type: 'text', value: 'foto', enabled: true },
      ],
    });
  });
});

describe('importação OpenAPI para o workspace', () => {
  let root: string | undefined;
  afterEach(() => (root ? rm(root, { recursive: true, force: true }) : undefined));

  it('grava a coleção com pastas, exemplos e variáveis secretas', async () => {
    root = await mkdtemp(join(tmpdir(), 'rota-openapi-'));
    const store = await WorkspaceStore.open(root, { secrets: new MemorySecretStore() });
    const report = await importPostmanFiles(store, [{ fileName: 'loja.yaml', content: openapi3 }]);
    expect(report.items[0]).toMatchObject({ kind: 'openapi', name: 'Loja' });
    const col = store.snapshot().collections[0];
    expect(col?.variables.find((v) => v.key === 'token')).toMatchObject({ type: 'secret' });
    const nodes = [...walkTree(store.snapshot().collections)];
    expect(nodes.map((n) => n.name)).toEqual(['Loja', 'Pedidos', 'Buscar pedido', 'criarPedido', 'Saúde']);
    const node = findNode(store.snapshot(), nodes.find((n) => n.name === 'Buscar pedido')?.id ?? '');
    expect(node?.kind === 'request' && node.examples.length).toBe(1);
  });
});
