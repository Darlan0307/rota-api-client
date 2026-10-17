import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MemorySecretStore } from '@rota/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './index';
import { McpSession } from './session';

let http: Server;
let base: string;
beforeAll(async () => {
  http = createHttpServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: '7', nome: 'Ana' }));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => http.close(r)));

let dataDir: string;
let client: Client;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'rota-mcp-docs-'));
  const secrets = new MemorySecretStore();
  const server = createServer(new McpSession({ dataDir, secretsFactory: () => secrets }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content[0]?.text ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // texto puro
  }
  return { data: data as Record<string, unknown>, text, isError: res.isError === true };
}

describe('coleção a partir de documentação', () => {
  it('cria a coleção inteira numa chamada e acrescenta depois', async () => {
    const created = await call('criar_colecao_completa', {
      nome: 'Loja',
      auth: { type: 'bearer', token: '{{token}}' },
      variaveis: [
        { chave: 'baseUrl', valor: base },
        { chave: 'token', secreta: true },
      ],
      pastas: [{ caminho: 'Clientes', descricao: 'Cadastro de clientes' }],
      requisicoes: [
        {
          pasta: 'Clientes',
          nome: 'Buscar cliente',
          metodo: 'GET',
          url: '{{baseUrl}}/clientes/{{id}}',
          exemplos: [{ nome: 'Sucesso', status: 200, corpo: { id: 7, nome: 'Ana', email: 'a@x' } }],
        },
        { pasta: 'Clientes/Endereços', nome: 'Listar endereços', url: '{{baseUrl}}/enderecos' },
        { nome: 'Saúde', url: '{{baseUrl}}/saude' },
      ],
    });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({ nome: 'Loja', requisicoes: 3, pastas: 2, exemplos: 1 });

    const more = await call('criar_colecao_completa', {
      adicionarEm: created.data.id,
      requisicoes: [
        { pasta: 'Clientes', nome: 'Criar cliente', metodo: 'POST', url: '{{baseUrl}}/clientes' },
      ],
    });
    expect(more.data).toMatchObject({ requisicoes: 1, pastasNovas: 0 });

    const tree = await call('listar_colecoes');
    expect(tree.text).toContain('Criar cliente');
    expect(tree.text).toContain('Endereços');

    // Envio com exemplo salvo: o resultado traz a verificação de contrato.
    const found = await call('buscar', { termo: 'Buscar cliente' });
    const requestId =
      (found.data as unknown as { id: string; titulo: string }[]).find((r) => r.titulo === 'Buscar cliente')
        ?.id ?? '';
    const env = await call('criar_ambiente', { nome: 'Dev', variaveis: [{ chave: 'id', valor: '7' }] });
    await call('definir_ambiente_ativo', { id: env.data.id });
    const sent = await call('enviar_requisicao', { id: requestId });
    expect(sent.data.contrato).toEqual({
      exemploDeReferencia: 'Sucesso',
      ok: false,
      quebras: [
        'O campo "id" mudou de tipo: era number, veio string.',
        'O campo "email" não veio na resposta (era string).',
      ],
      camposNovos: [],
    });

    const doc = await call('gerar_documentacao', { colecaoId: created.data.id });
    expect(doc.text).toContain('# Loja');
    expect(doc.text).toContain('### GET Buscar cliente');
  });

  it('importa arquivos OpenAPI do disco', async () => {
    const file = join(dataDir, 'api.yaml');
    await writeFile(
      file,
      [
        'openapi: 3.0.0',
        'info: { title: Pets, version: "1" }',
        'servers: [{ url: "https://pets.exemplo.com" }]',
        'paths:',
        '  /pets:',
        '    get:',
        '      summary: Listar pets',
        '      responses: { "200": { description: OK } }',
      ].join('\n'),
    );
    const imported = await call('importar_arquivo', { caminho: file });
    expect(imported.data).toMatchObject({ tipo: 'openapi', nome: 'Pets', contagem: { requests: 1 } });
    expect((await call('importar_arquivo', { caminho: join(dataDir, 'nao-existe.json') })).isError).toBe(
      true,
    );
  });

  it('oferece prompts prontos', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'colecao_a_partir_de_documentacao',
      'documentar_colecao',
      'explicar_erro',
      'gerar_testes',
    ]);
    const p = await client.getPrompt({
      name: 'colecao_a_partir_de_documentacao',
      arguments: { nome: 'Fiscal' },
    });
    const first = p.messages[0]?.content;
    expect(first?.type === 'text' && first.text).toContain('criar_colecao_completa');
  });
});
