import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AuthSchema,
  collectionToMarkdown,
  type ExampleFile,
  findNode,
  type ImportedChild,
  importPostmanFiles,
  KeyValueSchema,
  type RequestData,
  RequestDataSchema,
  type WorkspaceStore,
} from '@rota/core';
import { z } from 'zod';
import { type McpSession, ToolError } from './session';
import { requestFields, requestPatch, toolRegistrar, toVariableInputs, variableInput } from './tools';

/**
 * Ferramentas e prompts para montar coleções a partir de documentação:
 * criar uma coleção inteira numa chamada, importar arquivos Postman/OpenAPI
 * e gerar a documentação de uma coleção.
 */

const MAX_REQUESTS_PER_CALL = 300;

const exampleInput = z.object({
  nome: z.string(),
  status: z.number().int(),
  statusText: z.string().optional(),
  corpo: z.unknown().optional().describe('Corpo da resposta: texto ou JSON (objeto/array)'),
  headers: z.array(KeyValueSchema).optional(),
});

const requestInput = z.object({
  pasta: z
    .string()
    .optional()
    .describe('Caminho da pasta, com "/" para subpastas (ex.: "Pedidos/Itens"). Vazio = raiz da coleção'),
  nome: z.string(),
  ...requestFields,
  exemplos: z
    .array(exampleInput)
    .optional()
    .describe('Respostas de exemplo (viram base da verificação de contrato)'),
});

const folderInput = z.object({
  caminho: z.string().describe('Mesmo formato de "pasta" das requisições'),
  descricao: z.string().optional(),
  auth: AuthSchema.optional(),
});

type RequestArg = z.infer<typeof requestInput>;
type ExampleArg = z.infer<typeof exampleInput>;
type FolderArg = z.infer<typeof folderInput>;

function toExample(e: ExampleArg, data: RequestData): Omit<ExampleFile, 'schemaVersion' | 'id'> {
  const json = e.corpo !== undefined && typeof e.corpo !== 'string';
  const headers = (e.headers ?? []).map((h) => ({ ...h, enabled: h.enabled ?? true, value: h.value ?? '' }));
  // Corpo enviado como objeto/array: o exemplo é JSON.
  if (json && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
  }
  return {
    name: e.nome,
    request: { method: data.method, url: data.url, headers: [] },
    response: {
      status: e.status,
      statusText: e.statusText ?? '',
      headers,
      body: json ? JSON.stringify(e.corpo, null, 2) : ((e.corpo as string | undefined) ?? ''),
    },
    savedAt: new Date().toISOString(),
  };
}

function splitPath(path: string | undefined): string[] {
  return (path ?? '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
}

function toRequestData(r: RequestArg): RequestData {
  return RequestDataSchema.parse(requestPatch(r as Record<string, unknown>));
}

/** Monta a árvore de uma coleção nova a partir da lista plana de requisições. */
function buildTree(requests: RequestArg[], folders: FolderArg[]) {
  const root: ImportedChild[] = [];
  const byPath = new Map<string, Extract<ImportedChild, { kind: 'folder' }>>();
  const meta = new Map(folders.map((f) => [splitPath(f.caminho).join('/'), f]));
  const folderAt = (parts: string[]): ImportedChild[] => {
    let children = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join('/');
      let folder = byPath.get(key);
      if (!folder) {
        const info = meta.get(key);
        folder = {
          kind: 'folder',
          name: parts[i] as string,
          auth: info?.auth ?? { type: 'inherit' },
          scripts: { preRequest: '', postResponse: '' },
          description: info?.descricao,
          children: [],
        };
        byPath.set(key, folder);
        children.push(folder);
      }
      children = folder.children;
    }
    return children;
  };
  // Pastas declaradas sem requisições também são criadas.
  for (const f of folders) folderAt(splitPath(f.caminho));
  let examples = 0;
  for (const r of requests) {
    const data = toRequestData(r);
    const ex = (r.exemplos ?? []).map((e) => toExample(e, data));
    examples += ex.length;
    folderAt(splitPath(r.pasta)).push({ kind: 'request', name: r.nome, data, examples: ex });
  }
  return { children: root, folders: byPath.size, examples };
}

/** Acrescenta pastas/requisições a uma coleção existente (reaproveitando pastas de mesmo nome). */
async function appendToCollection(
  store: WorkspaceStore,
  collectionId: string,
  requests: RequestArg[],
  folders: FolderArg[],
) {
  let createdFolders = 0;
  let examples = 0;
  const ensureFolder = async (parts: string[]): Promise<string> => {
    let parentId = collectionId;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i] as string;
      const parent = findNode(store.snapshot(), parentId);
      if (!parent || parent.kind === 'request') throw new ToolError('Pasta de destino inválida.');
      const existing = parent.children.find((c) => c.kind === 'folder' && c.name === name);
      if (existing) parentId = existing.id;
      else {
        const info = folders.find((f) => splitPath(f.caminho).join('/') === parts.slice(0, i + 1).join('/'));
        parentId = await store.createFolder(parentId, name, {
          ...(info?.auth ? { auth: info.auth } : {}),
          ...(info?.descricao ? { description: info.descricao } : {}),
        });
        createdFolders++;
      }
    }
    return parentId;
  };
  for (const f of folders) await ensureFolder(splitPath(f.caminho));
  for (const r of requests) {
    const parentId = await ensureFolder(splitPath(r.pasta));
    const data = toRequestData(r);
    const requestId = await store.createRequest(parentId, r.nome, data);
    for (const e of r.exemplos ?? []) {
      await store.saveExample(requestId, toExample(e, data));
      examples++;
    }
  }
  return { folders: createdFolders, examples };
}

export function registerDocumentationTools(server: McpServer, session: McpSession): void {
  const tool = toolRegistrar(server, session);

  tool(
    'criar_colecao_completa',
    [
      'Cria uma coleção inteira numa chamada (ou acrescenta a uma existente com adicionarEm): pastas, requisições e exemplos.',
      'Ideal para montar a coleção a partir de uma documentação. Use {{baseUrl}} e outras {{variaveis}} nas URLs;',
      'tokens e senhas como variáveis "secreta: true" (o usuário preenche o valor no app).',
      `Até ${MAX_REQUESTS_PER_CALL} requisições por chamada: para documentações maiores, crie a coleção e depois chame de novo com adicionarEm.`,
    ].join(' '),
    {
      nome: z.string().optional().describe('Nome da coleção nova (obrigatório sem adicionarEm)'),
      adicionarEm: z.string().optional().describe('Id de uma coleção existente para acrescentar os itens'),
      descricao: z.string().optional().describe('Descrição da coleção (Markdown)'),
      auth: AuthSchema.optional().describe('Auth da coleção, herdada pelas requisições'),
      variaveis: z.array(variableInput).optional(),
      pastas: z.array(folderInput).optional().describe('Descrição/auth de pastas (opcional)'),
      requisicoes: z.array(requestInput),
    },
    async ({ nome, adicionarEm, descricao, auth, variaveis, pastas = [], requisicoes }) => {
      if (requisicoes.length > MAX_REQUESTS_PER_CALL) {
        throw new ToolError(
          `Máximo de ${MAX_REQUESTS_PER_CALL} requisições por chamada. Divida em partes usando adicionarEm.`,
        );
      }
      const store = await session.store();

      if (adicionarEm) {
        const target = findNode(store.snapshot(), adicionarEm);
        if (target?.kind !== 'collection') throw new ToolError('adicionarEm deve ser o id de uma coleção.');
        const { folders, examples } = await appendToCollection(store, adicionarEm, requisicoes, pastas);
        await session.notifyChanged(`acrescentou ${requisicoes.length} requisições em "${target.name}"`);
        return {
          id: adicionarEm,
          nome: target.name,
          requisicoes: requisicoes.length,
          pastasNovas: folders,
          exemplos: examples,
        };
      }

      if (!nome?.trim()) throw new ToolError('Informe o nome da coleção (ou adicionarEm).');
      const tree = buildTree(requisicoes, pastas);
      const newId = await store.importCollection({
        name: nome.trim(),
        auth: auth ?? { type: 'none' },
        variables: toVariableInputs(variaveis),
        scripts: { preRequest: '', postResponse: '' },
        description: descricao,
        children: tree.children,
      });
      await session.notifyChanged(`criou a coleção "${nome}" com ${requisicoes.length} requisições`);
      return {
        id: newId,
        nome,
        requisicoes: requisicoes.length,
        pastas: tree.folders,
        exemplos: tree.examples,
      };
    },
  );

  tool(
    'importar_arquivo',
    'Importa um arquivo do computador do usuário: coleção/ambiente/globais do Postman (JSON) ou documento OpenAPI 3 / Swagger 2.0 (JSON ou YAML).',
    { caminho: z.string().describe('Caminho completo do arquivo') },
    async ({ caminho }) => {
      const store = await session.store();
      let content: string;
      try {
        content = await readFile(caminho, 'utf8');
      } catch (error) {
        throw new ToolError(
          `Não foi possível ler o arquivo: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const report = await importPostmanFiles(store, [{ fileName: basename(caminho), content }]);
      const item = report.items[0];
      if (!item || item.error) throw new ToolError(item?.error ?? 'Nada foi importado.');
      await session.notifyChanged(`importou "${item.name}"`);
      return {
        tipo: item.kind,
        id: item.id ?? null,
        nome: item.name,
        contagem: item.counts,
        avisos: item.warnings.map((w) => `${w.path}: ${w.message}`),
      };
    },
  );

  tool(
    'gerar_documentacao',
    'Gera a documentação Markdown de uma coleção a partir do que está salvo (parâmetros, corpos, exemplos). Útil como base para revisar ou completar.',
    { colecaoId: z.string() },
    async ({ colecaoId }) => {
      const store = await session.store();
      const collection = store.snapshot().collections.find((c) => c.id === colecaoId);
      if (!collection) throw new ToolError('Coleção não encontrada.');
      return collectionToMarkdown(collection);
    },
    true,
  );

  // ---- Prompts (aparecem como atalhos no Claude Desktop / Claude Code) ------

  const prompt = (
    name: string,
    title: string,
    description: string,
    argsSchema: z.ZodRawShape,
    text: (args: Record<string, string>) => string,
  ) =>
    server.registerPrompt(name, { title, description, argsSchema }, (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: text(args as Record<string, string>) } }],
    }));

  prompt(
    'colecao_a_partir_de_documentacao',
    'Criar coleção a partir de documentação',
    'Estuda uma documentação de API (JSON, OpenAPI, texto) anexada à conversa e cria a coleção no Rota.',
    { nome: z.string().optional().describe('Nome da coleção (opcional)') },
    ({ nome }) =>
      [
        'Estude a documentação de API que anexei (ou colei) nesta conversa e crie a coleção correspondente no Rota.',
        nome ? `Nome da coleção: "${nome}".` : 'Escolha um nome claro para a coleção.',
        'Passos:',
        '1. Se for um documento OpenAPI/Swagger salvo em arquivo, prefira importar_arquivo. Caso contrário, monte você mesmo.',
        '2. Use criar_colecao_completa: uma pasta por recurso/assunto, requisições com nomes em português, {{baseUrl}} na URL,',
        '   parâmetros de caminho como {{variaveis}}, query e headers documentados (os opcionais desabilitados), corpo de exemplo',
        '   e as respostas documentadas como exemplos (status + corpo).',
        '3. Autenticação na coleção com variáveis secretas vazias (ex.: token) para eu preencher no app; nunca invente valores reais.',
        '4. Se houver mais de 300 endpoints, crie em partes com adicionarEm.',
        '5. No fim, liste o que foi criado, o que ficou ambíguo na documentação e quais variáveis eu preciso preencher.',
      ].join('\n'),
  );

  prompt(
    'gerar_testes',
    'Gerar testes de uma requisição',
    'Escreve testes pm.test no script de pós-resposta de uma requisição.',
    { requisicaoId: z.string() },
    ({ requisicaoId }) =>
      `Use o Rota. Leia a requisição ${requisicaoId} (obter_item), os exemplos salvos e o envio mais recente (listar_historico/obter_historico). Escreva testes pm.test no script de pós-resposta: status, tempo de resposta, campos obrigatórios e tipos, regras de negócio que dê para inferir. Mantenha o que já existe e grave com atualizar_requisicao.`,
  );

  prompt(
    'explicar_erro',
    'Explicar o erro de uma requisição',
    'Analisa o envio mais recente de uma requisição e explica o que deu errado.',
    { requisicaoId: z.string() },
    ({ requisicaoId }) =>
      `Use o Rota. Pegue o envio mais recente da requisição ${requisicaoId} (listar_historico / obter_historico) e explique em português o que deu errado, as causas prováveis e como corrigir. Não altere nada sem me perguntar.`,
  );

  prompt(
    'documentar_colecao',
    'Documentar uma coleção',
    'Escreve a documentação Markdown de uma coleção e grava na descrição dela.',
    { colecaoId: z.string() },
    ({ colecaoId }) =>
      `Use o Rota. Gere a base com gerar_documentacao para a coleção ${colecaoId}, complete com o objetivo de cada endpoint, autenticação, variáveis necessárias e erros comuns, e grave na descrição da coleção com atualizar_pasta_ou_colecao.`,
  );
}
