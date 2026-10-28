import { type AuthOwner, type EffectiveAuth, resolveEffectiveAuth } from '../http/auth';
import {
  type ExecuteOptions,
  executeRequest,
  HttpError,
  type HttpResponse,
  type ProxySettings,
} from '../http/execute';
import { jsonSyntaxError, lineColumnAt } from '../http/json-template';
import { type PreparedRequest, prepareRequest } from '../http/prepare';
import { applyUrlText, composeUrl } from '../http/url';
import { HTTP_METHODS, type HttpMethod, type RequestData, type Scripts } from '../model/schemas';
import { ancestorsOf, type ContainerNode, collectionOf, findNode } from '../model/tree';
import {
  type ConsoleEntry,
  runScript,
  type ScriptInput,
  type ScriptRequest,
  type ScriptResponse,
  type TestResult,
} from '../scripts/sandbox';
import { type ScriptScope, VariableState } from '../scripts/variable-state';
import type { VariableTarget, WorkspaceStore } from '../storage/workspace-store';
import { maskSecretValues, VariableScope } from '../variables/template';

export interface RunSettings {
  defaultTimeoutMs: number;
  proxy?: ProxySettings;
  userAgent?: string;
}

export interface RunContext {
  store: WorkspaceStore;
  /** Requisição salva (para herança de auth e variáveis da coleção). */
  requestId?: string | undefined;
  /** Para requisições novas ainda não salvas: onde elas "moram". */
  parentId?: string | undefined;
  environmentId: string | null;
  settings: RunSettings;
  signal?: AbortSignal;
  /** Nome exibido em pm.info.requestName. */
  requestName?: string | undefined;
  /** Executa scripts de pré-requisição e pós-resposta (padrão: true). */
  runScripts?: boolean;
  scriptTimeoutMs?: number;
  /**
   * Chamado depois dos pré-scripts e antes do envio, com a requisição final
   * (segredos mascarados). Se lançar, nada é enviado e o erro é repassado a
   * quem chamou runRequest — usado pelo MCP para confirmar DELETE/PUT/PATCH
   * mesmo quando um pré-script mudou o método.
   */
  beforeSend?: (request: PreparedRequest) => Promise<void>;
}

/** De qual script veio um teste/log (coleção, pasta ou a própria requisição). */
export interface ScriptOrigin {
  phase: 'pre' | 'post';
  sourceKind: 'collection' | 'folder' | 'request';
  source: string;
}

export interface RunTest extends TestResult, ScriptOrigin {}
export interface RunConsoleEntry extends ConsoleEntry, ScriptOrigin {}
export interface RunScriptError extends ScriptOrigin {
  message: string;
}

export interface RunError {
  code: string;
  message: string;
  detail?: string | undefined;
}

export interface RunResult {
  /** Requisição como enviada, com segredos mascarados (para exibir/histórico). */
  request: PreparedRequest | null;
  response: HttpResponse | null;
  error: RunError | null;
  startedAt: string;
  /** Resultados dos pm.test (ausente em entradas antigas do histórico). */
  tests?: RunTest[];
  console?: RunConsoleEntry[];
  scriptErrors?: RunScriptError[];
  /** Problemas que não impediram o envio (ex.: corpo JSON inválido depois das variáveis). */
  warnings?: string[];
}

/**
 * Resultado + valores secretos envolvidos. Os valores servem só para mascarar
 * textos (respostas, histórico, MCP) e NUNCA devem ser enviados ao renderer.
 */
export interface RunOutcome {
  result: RunResult;
  secretValues: string[];
}

/** Cadeia de autenticação do item até a coleção. */
export function authChain(
  store: WorkspaceStore,
  data: RequestData,
  ctx: Pick<RunContext, 'requestId' | 'parentId'>,
): AuthOwner[] {
  const snapshot = store.snapshot();
  const self: AuthOwner = {
    kind: 'request',
    id: ctx.requestId ?? 'nova',
    name: 'Esta requisição',
    auth: data.auth,
  };
  const anchor = ctx.requestId ?? ctx.parentId;
  if (!anchor) return [self];

  const ancestors = ctx.requestId ? ancestorsOf(snapshot, ctx.requestId) : [];
  if (!ctx.requestId && ctx.parentId) {
    const parent = findNode(snapshot, ctx.parentId);
    if (parent && parent.kind !== 'request') ancestors.push(parent, ...ancestorsOf(snapshot, ctx.parentId));
  }
  return [self, ...ancestors.map((a) => ({ kind: a.kind, id: a.id, name: a.name, auth: a.auth }))];
}

export function effectiveAuth(
  store: WorkspaceStore,
  data: RequestData,
  ctx: Pick<RunContext, 'requestId' | 'parentId'>,
): EffectiveAuth {
  return resolveEffectiveAuth(authChain(store, data, ctx));
}

/** Escopo de variáveis da requisição (com segredos, só para uso interno). */
export function variableScopeFor(
  store: WorkspaceStore,
  ctx: Pick<RunContext, 'requestId' | 'parentId' | 'environmentId'>,
): VariableScope {
  const anchor = ctx.requestId ?? ctx.parentId;
  const collection = anchor ? collectionOf(store.snapshot(), anchor) : undefined;
  return new VariableScope(store.variableLayers(collection?.id, ctx.environmentId));
}

/**
 * Requisição resolvida para exibir/gerar código (sem enviar). Por padrão os
 * segredos aparecem como ••••••; `reveal` mostra os valores reais.
 */
export function prepareForDisplay(
  data: RequestData,
  ctx: Pick<RunContext, 'store' | 'requestId' | 'parentId' | 'environmentId'> & {
    defaultTimeoutMs: number;
    reveal?: boolean;
  },
): PreparedRequest {
  const scope = variableScopeFor(ctx.store, ctx);
  return prepareRequest(data, {
    scope,
    auth: effectiveAuth(ctx.store, data, ctx).auth,
    defaultTimeoutMs: ctx.defaultTimeoutMs,
    maskSecrets: !ctx.reveal,
    defaultHeaders: false,
  });
}

/** Scripts a executar, de cima para baixo: coleção → pastas → requisição. */
function scriptChain(
  store: WorkspaceStore,
  data: RequestData,
  ctx: Pick<RunContext, 'requestId' | 'parentId' | 'requestName'>,
): { kind: ScriptOrigin['sourceKind']; name: string; scripts: Scripts }[] {
  const snapshot = store.snapshot();
  let ancestors: ContainerNode[] = [];
  if (ctx.requestId) ancestors = ancestorsOf(snapshot, ctx.requestId);
  else if (ctx.parentId) {
    const parent = findNode(snapshot, ctx.parentId);
    if (parent && parent.kind !== 'request') ancestors = [parent, ...ancestorsOf(snapshot, ctx.parentId)];
  }
  return [
    ...ancestors.reverse().map((a) => ({ kind: a.kind, name: a.name, scripts: a.scripts })),
    { kind: 'request' as const, name: ctx.requestName ?? 'Requisição', scripts: data.scripts },
  ];
}

function bodyText(data: RequestData): string | undefined {
  switch (data.body.mode) {
    case 'json':
    case 'raw':
      return data.body.text;
    case 'urlencoded':
      return data.body.fields
        .filter((f) => f.enabled)
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
        .join('&');
    default:
      return undefined;
  }
}

function toScriptRequest(data: RequestData): ScriptRequest {
  return {
    method: data.method,
    url: composeUrl(data.url, data.query),
    headers: data.headers.filter((h) => h.enabled && h.key).map((h) => ({ key: h.key, value: h.value })),
    body: bodyText(data),
  };
}

/** Aplica as alterações que o pré-script fez em pm.request. */
function applyScriptRequest(data: RequestData, before: ScriptRequest, after: ScriptRequest): RequestData {
  if (JSON.stringify(before) === JSON.stringify(after)) return data;
  const next = structuredClone(data);
  if ((HTTP_METHODS as readonly string[]).includes(after.method)) next.method = after.method as HttpMethod;
  if (after.url !== before.url) Object.assign(next, applyUrlText(after.url, data.query));
  if (JSON.stringify(after.headers) !== JSON.stringify(before.headers)) {
    next.headers = [
      ...after.headers.map((h) => ({ key: h.key, value: h.value, enabled: true })),
      ...data.headers.filter((h) => !h.enabled),
    ];
  }
  if (after.body !== before.body && after.body !== undefined) {
    // Formulário reescrito pelo script vira texto, mas a API continua esperando o mesmo Content-Type.
    const keepType = next.body.mode === 'urlencoded' ? 'application/x-www-form-urlencoded' : undefined;
    next.body =
      next.body.mode === 'json' || next.body.mode === 'raw'
        ? { ...next.body, text: after.body }
        : { mode: 'raw', language: 'text', text: after.body };
    if (keepType && !next.headers.some((h) => h.enabled && h.key.toLowerCase() === 'content-type')) {
      next.headers.push({ key: 'Content-Type', value: keepType, enabled: true });
    }
  }
  return next;
}

function toScriptResponse(response: HttpResponse): ScriptResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.map(([key, value]) => ({ key, value })),
    body: response.body.encoding === 'utf8' ? response.body.data : '',
    timeMs: response.timings.total,
    size: response.sizeBytes,
  };
}

/**
 * Troca os valores reais dos headers que saíram na conexão pelos da versão
 * mascarada, casando pelo nome (a n-ésima ocorrência com a n-ésima): o Basic
 * em base64 não seria pego procurando o segredo no texto. Os que o undici
 * acrescentou (Host, Content-Length...) passam pela máscara comum.
 */
export function maskSentHeaders(
  sent: readonly [string, string][],
  masked: readonly [string, string][],
  secretValues: readonly string[],
): [string, string][] {
  const byName = new Map<string, string[]>();
  for (const [k, v] of masked) byName.set(k.toLowerCase(), [...(byName.get(k.toLowerCase()) ?? []), v]);
  const seen = new Map<string, number>();
  return sent.map(([key, value]) => {
    const name = key.toLowerCase();
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    return [key, byName.get(name)?.[nth] ?? maskSecretValues(value, secretValues)];
  });
}

/** Grava no workspace as variáveis que os scripts alteraram. */
async function persistChanges(
  store: WorkspaceStore,
  state: VariableState,
  targets: Partial<Record<Exclude<ScriptScope, 'local'>, VariableTarget>>,
): Promise<void> {
  for (const change of state.pendingChanges()) {
    const target = targets[change.scope];
    if (!target) continue;
    if (change.value === null) await store.unsetVariable(target, change.key);
    else await store.setVariable(target, change.key, change.value);
  }
}

/**
 * Executa uma requisição como o app faria: roda os scripts de pré-requisição
 * (coleção → pastas → requisição), resolve variáveis e auth herdada, envia,
 * roda os scripts de pós-resposta e grava as variáveis alteradas por eles.
 * Não lança — erros vêm em `error` / `scriptErrors` —, exceto quando
 * `beforeSend` recusa o envio.
 */
export async function runRequest(original: RequestData, ctx: RunContext): Promise<RunOutcome> {
  const startedAt = new Date().toISOString();
  const store = ctx.store;
  const snapshot = store.snapshot();
  const anchor = ctx.requestId ?? ctx.parentId;
  const collection = anchor ? collectionOf(snapshot, anchor) : undefined;
  const environment = snapshot.environments.find((e) => e.id === ctx.environmentId);

  const available = new Set<ScriptScope>(['global', 'local']);
  const targets: Partial<Record<Exclude<ScriptScope, 'local'>, VariableTarget>> = {
    global: { kind: 'global' },
  };
  if (collection) {
    available.add('collection');
    targets.collection = { kind: 'collection', id: collection.id };
  }
  if (environment) {
    available.add('environment');
    targets.environment = { kind: 'environment', id: environment.id };
  }
  const state = new VariableState(store.variableLayers(collection?.id, environment?.id), available);

  const tests: RunTest[] = [];
  const consoleEntries: RunConsoleEntry[] = [];
  const scriptErrors: RunScriptError[] = [];
  const chain = ctx.runScripts === false ? [] : scriptChain(store, original, ctx);
  const runPhase = async (
    phase: 'pre' | 'post',
    base: Omit<ScriptInput, 'phase'>,
  ): Promise<ScriptRequest> => {
    let request = base.request;
    for (const item of chain) {
      const code = phase === 'pre' ? item.scripts.preRequest : item.scripts.postResponse;
      if (!code.trim()) continue;
      const origin: ScriptOrigin = { phase, sourceKind: item.kind, source: item.name };
      const out = await runScript(code, { ...base, request, phase }, state, {
        ...(ctx.scriptTimeoutMs ? { timeoutMs: ctx.scriptTimeoutMs } : {}),
      });
      tests.push(...out.tests.map((t) => ({ ...t, ...origin })));
      consoleEntries.push(...out.console.map((c) => ({ ...c, ...origin })));
      if (out.error) scriptErrors.push({ ...origin, message: out.error });
      if (phase === 'pre') request = out.request;
    }
    return request;
  };

  let data = original;
  let masked: PreparedRequest | null = null;
  let response: HttpResponse | null = null;
  let runError: RunError | null = null;
  let refused: unknown;
  const warnings: string[] = [];
  const requestName = ctx.requestName ?? 'Requisição';

  try {
    // O pré-script pode alterar variáveis e a própria requisição.
    const before = toScriptRequest(data);
    const after = await runPhase('pre', { request: before, requestName });
    data = applyScriptRequest(data, before, after);

    // Mesmos valores de {{$cpf}}, {{$guid}}... na enviada e na mascarada (tela e histórico).
    const [sendScope, maskScope] = state.scope().pairForReplay();
    const prepareOpts = {
      auth: effectiveAuth(store, data, ctx).auth,
      defaultTimeoutMs: ctx.settings.defaultTimeoutMs,
      ...(ctx.settings.userAgent ? { userAgent: ctx.settings.userAgent } : {}),
    };
    const prepared = prepareRequest(data, { ...prepareOpts, scope: sendScope });
    masked = prepareRequest(data, { ...prepareOpts, scope: maskScope, maskSecrets: true });
    if (ctx.beforeSend) {
      try {
        await ctx.beforeSend(masked);
      } catch (error) {
        refused = error;
        throw error;
      }
    }
    const isJson = data.body.mode === 'json' || (data.body.mode === 'raw' && data.body.language === 'json');
    if (isJson && prepared.body.kind === 'text') {
      // Como no Postman, envia assim mesmo; mas a API costuma tratar um JSON
      // quebrado como texto (ou recusar), então avisa onde está o problema.
      const syntax = jsonSyntaxError(prepared.body.text);
      if (syntax) {
        const { line, column } = lineColumnAt(prepared.body.text, syntax.offset);
        warnings.push(
          `O corpo enviado não é um JSON válido depois de trocar as variáveis (linha ${line}, coluna ${column}): ${syntax.message} Variáveis de texto precisam de aspas: "{{NOME}}".`,
        );
      }
    }
    const execOptions: ExecuteOptions = {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      ...(ctx.settings.proxy ? { proxy: ctx.settings.proxy } : {}),
    };
    response = await executeRequest(prepared, execOptions);

    await runPhase('post', {
      request: toScriptRequest(data),
      response: toScriptResponse(response),
      requestName,
    });
  } catch (error) {
    runError =
      error instanceof HttpError
        ? { code: error.code, message: error.message, detail: error.detail }
        : { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      await persistChanges(store, state, targets);
    } catch (error) {
      scriptErrors.push({
        phase: 'post',
        sourceKind: 'request',
        source: requestName,
        message: `Não foi possível gravar as variáveis alteradas pelos scripts: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (refused !== undefined) throw refused;

  const secretValues = [...new Set([...state.scope().secretValues(), ...state.secretValues()])];
  if (runError) {
    // Mensagens de erro podem conter a URL resolvida: mascara segredos.
    runError.message = maskSecretValues(runError.message, secretValues);
    if (runError.detail) runError.detail = maskSecretValues(runError.detail, secretValues);
  }
  if (response?.sentHeaders && masked) {
    response = {
      ...response,
      sentHeaders: maskSentHeaders(response.sentHeaders, masked.headers, secretValues),
    };
  }
  return {
    result: {
      request: masked,
      response,
      error: runError,
      startedAt,
      tests,
      console: consoleEntries,
      scriptErrors,
      // O aviso cita o trecho com erro, que pode ser um valor secreto.
      ...(warnings.length ? { warnings: warnings.map((w) => maskSecretValues(w, secretValues)) } : {}),
    },
    secretValues,
  };
}
