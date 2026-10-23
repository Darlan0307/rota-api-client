import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AuthSchema,
  BodySchema,
  type ChildNode,
  CODEGEN_TARGETS,
  type CollectionNode,
  checkContract,
  composeUrl,
  describeContractIssue,
  diffRequestData,
  effectiveAuth,
  findNode,
  generateCode,
  HttpMethodSchema,
  type HttpResponse,
  KeyValueSchema,
  loadAppSettings,
  maskSecretValues,
  type PreparedRequest,
  prepareForDisplay,
  prepareRequest,
  type RequestData,
  RequestDataSchema,
  RequestSettingsSchema,
  runLoadTest,
  runRequest,
  ScriptsSchema,
  SECRET_MASK,
  saveAppSettings,
  saveWorkspaceState,
  searchWorkspace,
  type TreeNode,
  type VariableInput,
  type VariableTarget,
  type VariableView,
  validateLoadTestConfig,
  variableScopeFor,
  type WorkspaceStore,
  withRecentWorkspace,
} from '@rota/core';
import { z } from 'zod';
import { type McpSession, ToolError } from './session';

const MAX_BODY_CHARS = 60_000;
const DESTRUCTIVE_METHODS = new Set(['DELETE', 'PUT', 'PATCH']);

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

function isLoopback(host: string): boolean {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '::1' || /^127\.\d+\.\d+\.\d+$/.test(name);
}

/**
 * A requisição final leva algum segredo? Variáveis secretas chegam como ••••••;
 * um valor secreto copiado por script chega como texto e é achado pelo valor.
 */
function carriesSecret(request: PreparedRequest, secrets: readonly string[]): boolean {
  const body =
    request.body.kind === 'text'
      ? [request.body.text]
      : request.body.kind === 'formdata'
        ? request.body.fields.map((f) => f.value)
        : [];
  const text = [request.url, ...request.headers.flat(), ...body].join('\n');
  return text.includes(SECRET_MASK) || maskSecretValues(text, secrets) !== text;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function result(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

/** Troca valores secretos em todas as strings de um resultado (antes de virar JSON). */
export function maskDeep(value: unknown, secrets: readonly string[]): unknown {
  if (secrets.length === 0) return value;
  if (typeof value === 'string') return maskSecretValues(value, secrets);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [maskSecretValues(k, secrets), maskDeep(v, secrets)]),
    );
  }
  return value;
}

/**
 * Converte exceções em resultado de erro legível para o Claude (sem derrubar o
 * servidor) e mascara qualquer valor secreto do workspace na saída — inclusive
 * os que um script tenha copiado para variáveis comuns, nomes de teste etc.
 */
function handler<A>(
  fn: (args: A) => Promise<unknown>,
  secrets: () => Promise<string[]>,
): (args: A) => Promise<ToolResult> {
  const known = () => secrets().catch(() => [] as string[]);
  return async (args: A) => {
    try {
      const data = await fn(args);
      return result(maskDeep(data, await known()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: maskSecretValues(message, await known()) }],
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Representações para o Claude

function compactTree(nodes: readonly (CollectionNode | ChildNode)[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === 'request') {
      return {
        tipo: 'requisicao',
        id: node.id,
        nome: node.name,
        metodo: node.data.method,
        url: composeUrl(node.data.url, node.data.query),
        ...(node.examples.length ? { exemplos: node.examples.map((e) => ({ id: e.id, nome: e.name })) } : {}),
      };
    }
    return {
      tipo: node.kind === 'collection' ? 'colecao' : 'pasta',
      id: node.id,
      nome: node.name,
      filhos: compactTree(node.children),
    };
  });
}

/** Variáveis com segredos mascarados: o Claude vê o nome, nunca o valor. */
function viewVars(vars: readonly VariableView[]) {
  return vars.map((v) => ({
    chave: v.key,
    valor: v.type === 'secret' ? (v.hasValue ? SECRET_MASK : '(sem valor salvo)') : (v.value ?? ''),
    secreta: v.type === 'secret',
    habilitada: v.enabled,
    ...(v.description ? { descricao: v.description } : {}),
  }));
}

function describeNode(store: WorkspaceStore, node: TreeNode) {
  const crumbs = store.describeItem(node.id)?.breadcrumb ?? [];
  const path = [...crumbs, node.name].join(' › ');
  switch (node.kind) {
    case 'request':
      return {
        tipo: 'requisicao',
        id: node.id,
        caminho: path,
        paiId: node.parentId,
        ...node.data,
        authEfetiva: effectiveAuth(store, node.data, { requestId: node.id }).source
          ? { herdadaDe: effectiveAuth(store, node.data, { requestId: node.id }).source?.name }
          : undefined,
        exemplos: node.examples.map((e) => ({ id: e.id, nome: e.name, status: e.response.status })),
      };
    case 'folder':
      return {
        tipo: 'pasta',
        id: node.id,
        caminho: path,
        auth: node.auth,
        scripts: node.scripts,
        descricao: node.description,
        filhos: compactTree(node.children),
      };
    case 'collection':
      return {
        tipo: 'colecao',
        id: node.id,
        nome: node.name,
        auth: node.auth,
        variaveis: viewVars(node.variables),
        scripts: node.scripts,
        descricao: node.description,
        filhos: compactTree(node.children),
      };
  }
}

function getNode(store: WorkspaceStore, id: string): TreeNode {
  const node = findNode(store.snapshot(), id);
  if (!node)
    throw new ToolError(`Item não encontrado: ${id}. Use listar_colecoes ou buscar para obter os ids.`);
  return node;
}

function itemLabel(store: WorkspaceStore, id: string): string {
  const info = store.describeItem(id);
  if (!info) return id;
  const kind = {
    collection: 'coleção',
    folder: 'pasta',
    request: 'requisição',
    environment: 'ambiente',
    example: 'exemplo',
  }[info.kind];
  return `${kind} "${[...info.breadcrumb, info.name].join(' › ')}"`;
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}\n… (corpo truncado: ${text.length.toLocaleString('pt-BR')} caracteres no total)`
    : text;
}

// ---------------------------------------------------------------------------
// Esquemas reutilizados

const id = z.string().describe('Id do item (obtido em listar_colecoes, buscar ou obter_item)');
export const variableInput = z.object({
  chave: z.string(),
  valor: z.string().optional().describe('Para variáveis secretas, o valor vai cifrado para o cofre local'),
  secreta: z.boolean().optional(),
  habilitada: z.boolean().optional(),
  descricao: z.string().optional(),
});
type VariableArg = z.infer<typeof variableInput>;

export function toVariableInputs(vars: readonly VariableArg[] = []): VariableInput[] {
  return vars.map((v) => ({
    key: v.chave,
    type: v.secreta ? 'secret' : 'default',
    enabled: v.habilitada ?? true,
    value: v.valor ?? '',
    ...(v.descricao ? { description: v.descricao } : {}),
  }));
}

export const requestFields = {
  metodo: HttpMethodSchema.optional(),
  url: z.string().optional().describe('URL sem a query string; aceita {{variaveis}}'),
  query: z.array(KeyValueSchema).optional().describe('Parâmetros de query (inclusive desabilitados)'),
  headers: z.array(KeyValueSchema).optional(),
  auth: AuthSchema.optional().describe('Padrão: {"type":"inherit"} (herda da pasta/coleção)'),
  body: BodySchema.optional().describe('Ex.: {"mode":"json","text":"{...}"}'),
  scripts: ScriptsSchema.optional().describe('Scripts pm.* de pré-requisição e pós-resposta'),
  configuracoes: RequestSettingsSchema.optional(),
  descricao: z.string().optional(),
};

export function requestPatch(args: Partial<Record<keyof typeof requestFields, unknown>>) {
  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = {
    metodo: 'method',
    url: 'url',
    query: 'query',
    headers: 'headers',
    auth: 'auth',
    body: 'body',
    scripts: 'scripts',
    configuracoes: 'settings',
    descricao: 'description',
  };
  for (const [from, to] of Object.entries(map)) {
    const value = args[from as keyof typeof requestFields];
    if (value !== undefined) patch[to] = value;
  }
  return patch;
}

/** Compara a resposta com o exemplo salvo de mesmo status (campos removidos ou com tipo diferente). */
function contractSummary(
  store: WorkspaceStore,
  requestId: string | undefined,
  response: HttpResponse | null,
): { contrato?: unknown } {
  if (!requestId || !response || response.body.encoding !== 'utf8') return {};
  const node = findNode(store.snapshot(), requestId);
  if (node?.kind !== 'request') return {};
  const check = checkContract(node.examples, response.status, response.body.data);
  if (!check) return {};
  return {
    contrato: {
      exemploDeReferencia: check.example.name,
      ok: check.report.breaking.length === 0,
      quebras: check.report.breaking.map(describeContractIssue),
      camposNovos: check.report.added.map(describeContractIssue),
    },
  };
}

// ---------------------------------------------------------------------------

/** Registra uma ferramenta com tratamento de erros e máscara de segredos. */
export function toolRegistrar(server: McpServer, session: McpSession) {
  return <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    readOnly = false,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema, annotations: { readOnlyHint: readOnly } },
      // biome-ignore lint/suspicious/noExplicitAny: o SDK tipa os argumentos a partir do schema
      handler(fn, async () => session.secretValues()) as any,
    );
}

export function registerTools(server: McpServer, session: McpSession): void {
  const tool = toolRegistrar(server, session);

  // ---- Workspaces ----------------------------------------------------------

  tool(
    'listar_workspaces',
    'Lista o workspace em uso, o workspace padrão e os workspaces de projeto recentes.',
    {},
    async () => {
      await session.store();
      const settings = await loadAppSettings(session.dataDir);
      return {
        emUso: { caminho: session.rootPath, padrao: session.isDefault },
        appAberto: await session.bridge.isAvailable(),
        recentes: settings.recentWorkspaces,
      };
    },
    true,
  );

  tool(
    'usar_workspace',
    'Troca o workspace usado por este servidor MCP (não muda o que está aberto no app). Sem caminho = workspace padrão. Uma pasta nova vira workspace.',
    {
      caminho: z
        .string()
        .nullable()
        .optional()
        .describe('Pasta do workspace de projeto; vazio/null = padrão'),
    },
    async ({ caminho }) => {
      const store = await session.open(caminho ?? null);
      if (caminho) {
        const settings = await loadAppSettings(session.dataDir);
        await saveAppSettings(withRecentWorkspace(settings, caminho), session.dataDir);
      }
      return { workspace: store.snapshot().name, caminho: store.root };
    },
  );

  // ---- Leitura -------------------------------------------------------------

  tool(
    'listar_colecoes',
    'Lista coleções, pastas e requisições (com ids, métodos e URLs) do workspace.',
    {},
    async () => {
      const store = await session.store();
      const snap = store.snapshot();
      return { workspace: snap.name, colecoes: compactTree(snap.collections) };
    },
    true,
  );

  tool(
    'obter_item',
    'Detalhes completos de uma coleção, pasta ou requisição (URL, headers, body, auth, scripts, variáveis da coleção com segredos mascarados).',
    { id },
    async ({ id }) => {
      const store = await session.store();
      return describeNode(store, getNode(store, id));
    },
    true,
  );

  tool(
    'buscar',
    'Busca coleções, pastas, requisições, exemplos e ambientes por nome, URL ou conteúdo.',
    { termo: z.string() },
    async ({ termo }) => {
      const store = await session.store();
      return searchWorkspace(store.snapshot(), termo, 30).map((r) => ({
        tipo: r.kind,
        id: r.id,
        titulo: r.title,
        caminho: r.path,
        ...(r.method ? { metodo: r.method, url: r.url } : {}),
        ...(r.match.snippet ? { trecho: `${r.match.field}: ${r.match.snippet}` } : {}),
      }));
    },
    true,
  );

  // ---- Criação (não exige confirmação) ------------------------------------

  tool(
    'criar_colecao',
    'Cria uma coleção. Variáveis "secreta: true" têm o valor cifrado localmente e não vão para os arquivos.',
    {
      nome: z.string(),
      descricao: z.string().optional(),
      auth: AuthSchema.optional().describe('Auth padrão herdada pelas requisições'),
      variaveis: z.array(variableInput).optional(),
    },
    async ({ nome, descricao, auth, variaveis }) => {
      const store = await session.store();
      const newId = await store.createCollection(nome, {
        ...(auth ? { auth } : {}),
        ...(descricao ? { description: descricao } : {}),
        variables: toVariableInputs(variaveis),
      });
      await session.notifyChanged(`criou a coleção "${nome}"`);
      return { id: newId, nome };
    },
  );

  tool(
    'criar_pasta',
    'Cria uma pasta dentro de uma coleção ou pasta.',
    { paiId: id, nome: z.string(), auth: AuthSchema.optional() },
    async ({ paiId, nome, auth }) => {
      const store = await session.store();
      const newId = await store.createFolder(paiId, nome, auth ? { auth } : {});
      await session.notifyChanged(`criou a pasta "${nome}"`);
      return { id: newId, nome };
    },
  );

  tool(
    'criar_requisicao',
    'Cria uma requisição numa coleção/pasta. Use {{variaveis}} para URL base e tokens (não coloque segredos literais).',
    { paiId: id, nome: z.string(), ...requestFields },
    async (args) => {
      const store = await session.store();
      const data = RequestDataSchema.parse(requestPatch(args));
      const newId = await store.createRequest(args.paiId, args.nome, data);
      await session.notifyChanged(`criou a requisição "${args.nome}"`);
      return { id: newId, nome: args.nome };
    },
  );

  tool(
    'duplicar',
    'Duplica uma coleção, pasta, requisição ou ambiente. Os exemplos salvos só são copiados com incluirExemplos.',
    { id, incluirExemplos: z.boolean().optional() },
    async ({ id, incluirExemplos }) => {
      const store = await session.store();
      const label = itemLabel(store, id);
      const newId = await store.duplicate(id, { includeExamples: incluirExemplos ?? false });
      await session.notifyChanged(`duplicou ${label}`);
      return { id: newId };
    },
  );

  // ---- Edição (pode pedir confirmação no app) ----------------------------------

  tool(
    'atualizar_requisicao',
    'Altera campos de uma requisição existente (só os informados). Pode pedir confirmação no app, conforme as configurações do usuário.',
    { id, ...requestFields },
    async (args) => {
      const store = await session.store();
      const node = getNode(store, args.id);
      if (node.kind !== 'request') throw new ToolError('O id não é de uma requisição.');
      const next = RequestDataSchema.parse({ ...node.data, ...requestPatch(args) });
      const changes = diffRequestData(node.data, next);
      if (changes.length === 0) return { mensagem: 'Nada mudou.' };
      await session.confirm({
        title: 'Editar requisição',
        description: `O Claude quer alterar ${itemLabel(store, args.id)}.`,
        details: changes.map((c) =>
          c.lines ? `${c.field}: alterado` : `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`,
        ),
        danger: false,
        category: 'edit',
      });
      await store.updateRequest(args.id, next);
      await session.notifyChanged(`alterou a requisição "${node.name}"`);
      return { atualizado: true, alteracoes: changes.map((c) => c.field) };
    },
  );

  tool(
    'atualizar_pasta_ou_colecao',
    'Altera auth, scripts ou descrição de uma pasta ou coleção. Pode pedir confirmação no app.',
    { id, auth: AuthSchema.optional(), scripts: ScriptsSchema.optional(), descricao: z.string().optional() },
    async ({ id, auth, scripts, descricao }) => {
      const store = await session.store();
      const node = getNode(store, id);
      if (node.kind === 'request') throw new ToolError('Use atualizar_requisicao para requisições.');
      const details = [
        ...(auth ? [`Autenticação: ${auth.type}`] : []),
        ...(scripts ? ['Scripts: alterados'] : []),
        ...(descricao !== undefined ? ['Descrição: alterada'] : []),
      ];
      if (details.length === 0) return { mensagem: 'Nada para alterar.' };
      await session.confirm({
        title: `Editar ${node.kind === 'collection' ? 'coleção' : 'pasta'}`,
        description: `O Claude quer alterar ${itemLabel(store, id)}.`,
        details,
        danger: false,
        category: 'edit',
      });
      const patch = {
        ...(auth ? { auth } : {}),
        ...(scripts ? { scripts } : {}),
        ...(descricao !== undefined ? { description: descricao } : {}),
      };
      if (node.kind === 'collection') await store.updateCollection(id, patch);
      else await store.updateFolder(id, patch);
      await session.notifyChanged(`alterou "${node.name}"`);
      return { atualizado: true };
    },
  );

  tool(
    'renomear',
    'Renomeia coleção, pasta, requisição, ambiente ou exemplo. Pode pedir confirmação no app.',
    { id, nome: z.string() },
    async ({ id, nome }) => {
      const store = await session.store();
      const label = itemLabel(store, id);
      await session.confirm({
        title: 'Renomear',
        description: `O Claude quer renomear ${label} para "${nome}".`,
        details: [],
        danger: false,
        category: 'organize',
      });
      await store.rename(id, nome);
      await session.notifyChanged(`renomeou ${label} para "${nome}"`);
      return { renomeado: true };
    },
  );

  tool(
    'mover',
    'Move uma pasta/requisição para outra coleção/pasta (ou muda a posição). Pode pedir confirmação no app.',
    { id, paiId: id, posicao: z.number().int().min(0).optional() },
    async ({ id, paiId, posicao }) => {
      const store = await session.store();
      const label = itemLabel(store, id);
      await session.confirm({
        title: 'Mover',
        description: `O Claude quer mover ${label} para ${itemLabel(store, paiId)}.`,
        details: [],
        danger: false,
        category: 'organize',
      });
      await store.move(id, paiId, posicao);
      await session.notifyChanged(`moveu ${label}`);
      return { movido: true };
    },
  );

  tool(
    'excluir',
    'Exclui um item (vai para a lixeira do app e pode ser restaurado). Pode pedir confirmação no app.',
    { id },
    async ({ id }) => {
      const store = await session.store();
      const label = itemLabel(store, id);
      await session.confirm({
        title: 'Excluir',
        description: `O Claude quer excluir ${label}.`,
        details: ['O item vai para a lixeira e pode ser restaurado.'],
        danger: true,
        category: 'delete',
      });
      await (await session.trash()).moveToTrash(id);
      await session.bridge.notify({ kind: 'trash' });
      await session.notifyChanged(`excluiu ${label}`);
      return { excluido: true, lixeira: true };
    },
  );

  // ---- Ambientes e variáveis ------------------------------------------------

  tool(
    'listar_ambientes',
    'Lista os ambientes (e qual está ativo) e quantas variáveis globais existem.',
    {},
    async () => {
      const store = await session.store();
      const snap = store.snapshot();
      const active = await session.activeEnvironmentId();
      return {
        ambienteAtivo: active,
        ambientes: snap.environments.map((e) => ({
          id: e.id,
          nome: e.name,
          ativo: e.id === active,
          variaveis: e.variables.length,
        })),
        variaveisGlobais: snap.globals.length,
      };
    },
    true,
  );

  tool(
    'obter_ambiente',
    'Variáveis de um ambiente, ou das globais (id "globais"). Valores secretos aparecem como ••••••.',
    { id: z.string().describe('Id do ambiente ou "globais"') },
    async ({ id }) => {
      const store = await session.store();
      const snap = store.snapshot();
      if (id === 'globais') return { nome: 'Variáveis globais', variaveis: viewVars(snap.globals) };
      const env = snap.environments.find((e) => e.id === id);
      if (!env) throw new ToolError('Ambiente não encontrado.');
      return { id: env.id, nome: env.name, variaveis: viewVars(env.variables) };
    },
    true,
  );

  tool(
    'criar_ambiente',
    'Cria um ambiente com variáveis (use "secreta: true" para tokens e senhas).',
    { nome: z.string(), variaveis: z.array(variableInput).optional() },
    async ({ nome, variaveis }) => {
      const store = await session.store();
      const newId = await store.createEnvironment(nome, toVariableInputs(variaveis));
      await session.notifyChanged(`criou o ambiente "${nome}"`);
      return { id: newId, nome };
    },
  );

  const scopeSchema = {
    escopo: z.enum(['ambiente', 'colecao', 'global']),
    escopoId: z.string().optional().describe('Id do ambiente ou da coleção (não precisa para "global")'),
  };
  const targetOf = (escopo: 'ambiente' | 'colecao' | 'global', escopoId?: string): VariableTarget => {
    if (escopo === 'global') return { kind: 'global' };
    if (!escopoId) throw new ToolError('Informe escopoId (id do ambiente ou da coleção).');
    return escopo === 'ambiente'
      ? { kind: 'environment', id: escopoId }
      : { kind: 'collection', id: escopoId };
  };
  const varsOf = (store: WorkspaceStore, target: VariableTarget): VariableView[] => {
    const snap = store.snapshot();
    if (target.kind === 'global') return snap.globals;
    if (target.kind === 'environment') {
      const env = snap.environments.find((e) => e.id === target.id);
      if (!env) throw new ToolError('Ambiente não encontrado.');
      return env.variables;
    }
    const col = findNode(snap, target.id);
    if (col?.kind !== 'collection') throw new ToolError('Coleção não encontrada.');
    return col.variables;
  };

  tool(
    'definir_variavel',
    'Cria ou altera uma variável (ambiente, coleção ou global). Alterar uma existente pode pedir confirmação no app. Variáveis secretas guardam o valor cifrado localmente.',
    { ...scopeSchema, chave: z.string(), valor: z.string(), secreta: z.boolean().optional() },
    async ({ escopo, escopoId, chave, valor, secreta }) => {
      const store = await session.store();
      const target = targetOf(escopo, escopoId);
      const current = varsOf(store, target);
      const existing = current.find((v) => v.key === chave);
      if (existing) {
        await session.confirm({
          title: 'Alterar variável',
          description: `O Claude quer alterar a variável "${chave}" (${escopo}).`,
          details: [
            existing.type === 'secret'
              ? 'Variável secreta: o valor não é exibido.'
              : `Valor atual: ${existing.value ?? ''}`,
          ],
          danger: false,
          // Trocar um segredo perde o valor antigo (ele não aparece em lugar nenhum).
          category: existing.type === 'secret' ? 'delete' : 'edit',
        });
      }
      if (existing || !secreta) await store.setVariable(target, chave, valor);
      if (!existing && secreta) {
        // Variável nova e secreta: precisa entrar como "secret" na lista.
        const inputs: VariableInput[] = [
          ...current.map((v) => ({
            key: v.key,
            type: v.type,
            enabled: v.enabled,
            value: v.type === 'secret' ? undefined : v.value,
          })),
          { key: chave, type: 'secret', enabled: true, value: valor },
        ];
        if (target.kind === 'global') await store.updateGlobals(inputs);
        else if (target.kind === 'environment') await store.updateEnvironment(target.id, inputs);
        else await store.updateCollection(target.id, { variables: inputs });
      }
      await session.notifyChanged(`${existing ? 'alterou' : 'criou'} a variável "${chave}"`);
      return { ok: true, secreta: existing ? existing.type === 'secret' : Boolean(secreta) };
    },
  );

  tool(
    'remover_variavel',
    'Remove uma variável. Pode pedir confirmação no app.',
    { ...scopeSchema, chave: z.string() },
    async ({ escopo, escopoId, chave }) => {
      const store = await session.store();
      const target = targetOf(escopo, escopoId);
      if (!varsOf(store, target).some((v) => v.key === chave))
        throw new ToolError('Variável não encontrada.');
      await session.confirm({
        title: 'Remover variável',
        description: `O Claude quer remover a variável "${chave}" (${escopo}).`,
        details: [],
        danger: true,
        category: 'delete',
      });
      await store.unsetVariable(target, chave);
      await session.notifyChanged(`removeu a variável "${chave}"`);
      return { removida: true };
    },
  );

  tool(
    'definir_ambiente_ativo',
    'Troca o ambiente ativo (o mesmo que o seletor do app). null = sem ambiente.',
    { id: z.string().nullable() },
    async ({ id }) => {
      const store = await session.store();
      if (id && !store.snapshot().environments.some((e) => e.id === id))
        throw new ToolError('Ambiente não encontrado.');
      await saveWorkspaceState(session.rootPath, { activeEnvironmentId: id }, session.dataDir);
      await session.bridge.notify({ kind: 'state' });
      return { ambienteAtivo: id };
    },
  );

  // ---- Envio ---------------------------------------------------------------

  /** Hosts liberados nesta sessão para receber segredos. */
  const approvedHosts = new Set<string>();

  /**
   * Endereço em que o usuário confia: a própria máquina, um host para o qual ele
   * já enviou pelo app ou um que ele aprovou nesta sessão. Requisição salva não
   * conta, porque o Claude pode criá-la sem confirmação.
   */
  async function isKnownHost(host: string): Promise<boolean> {
    if (isLoopback(host) || approvedHosts.has(host)) return true;
    const { items } = await (await session.history()).list({ limit: 500 });
    return items.some((e) => e.source === 'app' && hostOf(e.url) === host);
  }

  tool(
    'enviar_requisicao',
    'Envia uma requisição salva (id) ou avulsa (requisicao), com o ambiente ativo, auth herdada e scripts. DELETE, PUT e PATCH podem pedir confirmação no app; enviar valores secretos para um endereço que o usuário ainda não usou sempre pede. Valores secretos aparecem mascarados na resposta.',
    {
      id: z.string().optional().describe('Requisição salva'),
      requisicao: z
        .object({
          metodo: HttpMethodSchema,
          ...Object.fromEntries(Object.entries(requestFields).filter(([k]) => k !== 'metodo')),
        })
        .partial()
        .optional()
        .describe('Requisição avulsa (sem salvar)'),
      paiId: z
        .string()
        .optional()
        .describe('Para requisição avulsa: coleção/pasta cujas variáveis e auth usar'),
    },
    async ({ id: requestId, requisicao, paiId }) => {
      const store = await session.store();
      let data: RequestData;
      let name = 'Requisição do Claude';
      if (requestId) {
        const node = getNode(store, requestId);
        if (node.kind !== 'request') throw new ToolError('O id não é de uma requisição.');
        data = node.data;
        name = node.name;
      } else if (requisicao) {
        data = RequestDataSchema.parse(requestPatch(requisicao as Record<string, unknown>));
      } else {
        throw new ToolError('Informe id (requisição salva) ou requisicao (avulsa).');
      }
      const environmentId = await session.activeEnvironmentId();
      const settings = await loadAppSettings(session.dataDir);
      const { result: run, secretValues } = await runRequest(data, {
        store,
        requestId,
        parentId: paiId,
        environmentId,
        requestName: name,
        // Confere a requisição final, depois dos pré-scripts (que podem trocar método e URL).
        beforeSend: async (final) => {
          const destructive = DESTRUCTIVE_METHODS.has(final.method);
          const host = hostOf(final.url);
          // Segredo indo para um endereço que o usuário nunca usou: pode ser o
          // Claude seguindo instruções escondidas numa resposta de API.
          const unknownHost = carriesSecret(final, session.secretValues()) && !(await isKnownHost(host));
          if (!destructive && !unknownHost) return;
          await session.confirm({
            title: destructive ? `Enviar ${final.method}` : 'Enviar segredo para outro endereço',
            description: `O Claude quer enviar ${final.method} ${final.url}.`,
            details: [
              `Requisição: ${name}`,
              `Ambiente: ${store.snapshot().environments.find((e) => e.id === environmentId)?.name ?? 'nenhum'}`,
              ...(final.method !== data.method
                ? [`Atenção: o método salvo é ${data.method}; um pré-script o mudou para ${final.method}.`]
                : []),
              ...(unknownHost
                ? [`Atenção: leva valores secretos para ${host}, endereço que você ainda não usou no Rota.`]
                : []),
            ],
            danger: final.method === 'DELETE' || unknownHost,
            category: unknownHost ? 'critical' : 'send',
          });
          if (unknownHost) approvedHosts.add(host);
        },
        settings: {
          defaultTimeoutMs: settings.defaultTimeoutMs,
          proxy: settings.proxy,
          userAgent: 'Rota-MCP',
        },
      });
      const history = await session.history();
      const entry = await history.add(
        { name, requestId: requestId ?? null, parentId: paiId ?? null, data, source: 'mcp' },
        run,
        secretValues,
      );
      await session.bridge.notify({ kind: 'history' });
      const mask = (t: string) => maskSecretValues(t, secretValues);
      const res = run.response;
      return {
        historicoId: entry.id,
        requisicao: run.request ? { metodo: run.request.method, url: mask(run.request.url) } : null,
        ...(run.error ? { erro: mask(run.error.message) } : {}),
        ...(res
          ? {
              status: res.status,
              statusText: res.statusText,
              tempoMs: res.timings.total,
              tamanhoBytes: res.sizeBytes,
              headers: Object.fromEntries(res.headers.map(([k, v]) => [k, mask(v)])),
              body:
                res.body.encoding === 'utf8'
                  ? truncate(mask(res.body.data))
                  : `(binário, ${res.sizeBytes} bytes)`,
            }
          : {}),
        ...(run.tests?.length
          ? { testes: run.tests.map((t) => ({ nome: t.name, status: t.status, mensagem: t.message })) }
          : {}),
        ...(run.console?.length
          ? { console: run.console.map((c) => `[${c.level}] ${mask(c.message)}`) }
          : {}),
        ...(run.scriptErrors?.length ? { errosDeScript: run.scriptErrors.map((e) => mask(e.message)) } : {}),
        ...contractSummary(store, requestId, res),
      };
    },
  );

  tool(
    'gerar_codigo',
    'Gera cURL, fetch ou axios para uma requisição salva (segredos mascarados).',
    { id, alvo: z.enum(CODEGEN_TARGETS) },
    async ({ id, alvo }) => {
      const store = await session.store();
      const node = getNode(store, id);
      if (node.kind !== 'request') throw new ToolError('O id não é de uma requisição.');
      const settings = await loadAppSettings(session.dataDir);
      return generateCode(
        prepareForDisplay(node.data, {
          store,
          requestId: id,
          environmentId: await session.activeEnvironmentId(),
          defaultTimeoutMs: settings.defaultTimeoutMs,
        }),
        alvo,
      );
    },
    true,
  );

  // ---- Histórico e exemplos ------------------------------------------------

  tool(
    'listar_historico',
    'Requisições enviadas (pelo app e pelo Claude), mais recentes primeiro.',
    { termo: z.string().optional(), limite: z.number().int().min(1).max(200).optional() },
    async ({ termo, limite }) => {
      const history = await session.history();
      const { items, total } = await history.list({
        ...(termo ? { query: termo } : {}),
        limit: limite ?? 30,
      });
      return { total, itens: items };
    },
    true,
  );

  tool(
    'obter_historico',
    'Detalhes de uma entrada do histórico (requisição enviada e resposta, com segredos mascarados).',
    { id: z.string() },
    async ({ id }) => {
      const entry = await (await session.history()).get(id);
      if (!entry) throw new ToolError('Entrada não encontrada no histórico.');
      const res = entry.result.response;
      return {
        ...entry,
        result: {
          ...entry.result,
          response: res
            ? {
                ...res,
                body:
                  res.body.encoding === 'utf8' ? { ...res.body, data: truncate(res.body.data) } : res.body,
              }
            : null,
        },
      };
    },
    true,
  );

  tool(
    'salvar_exemplo',
    'Salva a resposta de uma entrada do histórico como exemplo nomeado de uma requisição.',
    { requisicaoId: id, historicoId: z.string(), nome: z.string() },
    async ({ requisicaoId, historicoId, nome }) => {
      const store = await session.store();
      const entry = await (await session.history()).get(historicoId);
      const res = entry?.result.response;
      if (!entry || !res) throw new ToolError('Entrada do histórico sem resposta.');
      const exampleId = await store.saveExample(requisicaoId, {
        name: nome,
        ...(entry.result.request
          ? {
              request: {
                method: entry.result.request.method,
                url: entry.result.request.url,
                headers: entry.result.request.headers.map(([key, value]) => ({ key, value, enabled: true })),
                ...(entry.result.request.body.kind === 'text'
                  ? { body: entry.result.request.body.text }
                  : {}),
              },
            }
          : {}),
        response: {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers.map(([key, value]) => ({ key, value, enabled: true })),
          body: res.body.encoding === 'utf8' ? res.body.data : '(binário)',
          timeMs: res.timings.total,
        },
        savedAt: new Date().toISOString(),
      });
      await session.notifyChanged(`salvou o exemplo "${nome}"`);
      return { id: exampleId };
    },
  );

  // ---- Teste de carga ------------------------------------------------------

  tool(
    'executar_teste_carga',
    'Roda um teste de carga numa requisição salva. Requer confirmação no app.',
    {
      id,
      modo: z.enum(['quantidade', 'duracao']),
      total: z.number().int().optional().describe('Para modo quantidade'),
      duracaoSegundos: z.number().int().optional().describe('Para modo duração'),
      concorrencia: z.number().int().min(1),
    },
    async ({ id, modo, total, duracaoSegundos, concorrencia }) => {
      const store = await session.store();
      const node = getNode(store, id);
      if (node.kind !== 'request') throw new ToolError('O id não é de uma requisição.');
      const config = {
        mode: modo === 'quantidade' ? ('count' as const) : ('duration' as const),
        total: total ?? 0,
        durationSec: duracaoSegundos ?? 0,
        concurrency: concorrencia,
      };
      const problem = validateLoadTestConfig(config);
      if (problem) throw new ToolError(problem);
      const environmentId = await session.activeEnvironmentId();
      const settings = await loadAppSettings(session.dataDir);
      const ctx = { requestId: id, environmentId };
      const prepared = prepareRequest(node.data, {
        scope: variableScopeFor(store, ctx),
        auth: effectiveAuth(store, node.data, ctx).auth,
        defaultTimeoutMs: settings.defaultTimeoutMs,
        userAgent: 'Rota-MCP',
      });
      await session.confirm({
        title: 'Teste de carga',
        description: `O Claude quer rodar um teste de carga em ${node.data.method} ${composeUrl(node.data.url, node.data.query)}.`,
        details: [
          modo === 'quantidade' ? `${total} requisições` : `${duracaoSegundos} segundos`,
          `Concorrência: ${concorrencia}`,
          `Requisição: ${node.name}`,
        ],
        danger: true,
        category: 'critical',
      });
      const r = await runLoadTest(prepared, config, { proxy: settings.proxy });
      return {
        requisicoes: r.completed,
        duracaoMs: r.elapsedMs,
        requisicoesPorSegundo: r.rps,
        taxaDeErro: r.errorRate,
        latenciaMs: r.latency,
        status: r.statusCounts,
        errosDeConexao: r.errors,
      };
    },
  );

  // ---- Lixeira -------------------------------------------------------------

  tool(
    'listar_lixeira',
    'Itens excluídos que podem ser restaurados.',
    {},
    async () =>
      (await (await session.trash()).list()).map((e) => ({
        id: e.id,
        tipo: e.kind,
        nome: e.name,
        local: e.breadcrumb.join(' › '),
        excluidoEm: e.deletedAt,
      })),
    true,
  );

  tool(
    'restaurar_da_lixeira',
    'Restaura um item da lixeira para o lugar de origem.',
    { id: z.string().describe('Id da entrada da lixeira (listar_lixeira)') },
    async ({ id }) => {
      const entry = await (await session.trash()).restore(id);
      await session.bridge.notify({ kind: 'trash' });
      await session.notifyChanged(`restaurou "${entry.name}" da lixeira`);
      return { restaurado: entry.name };
    },
  );

  tool(
    'esvaziar_lixeira',
    'Apaga definitivamente tudo que está na lixeira. Requer confirmação no app.',
    {},
    async () => {
      const trash = await session.trash();
      const entries = await trash.list();
      if (entries.length === 0) return { mensagem: 'A lixeira já está vazia.' };
      await session.confirm({
        title: 'Esvaziar a lixeira',
        description: `O Claude quer apagar definitivamente ${entries.length} ${entries.length === 1 ? 'item' : 'itens'} da lixeira.`,
        details: entries
          .slice(0, 10)
          .map((e) => `${e.name}${e.breadcrumb.length ? ` (${e.breadcrumb.join(' › ')})` : ''}`),
        danger: true,
        category: 'critical',
      });
      const count = await trash.empty();
      await session.bridge.notify({ kind: 'trash' });
      return { apagados: count };
    },
  );
}
