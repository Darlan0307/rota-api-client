import { type AuthOwner, type EffectiveAuth, resolveEffectiveAuth } from '../http/auth';
import {
  type ExecuteOptions,
  executeRequest,
  HttpError,
  type HttpResponse,
  type ProxySettings,
} from '../http/execute';
import { type PreparedRequest, prepareRequest } from '../http/prepare';
import type { RequestData } from '../model/schemas';
import { ancestorsOf, collectionOf, findNode } from '../model/tree';
import type { WorkspaceStore } from '../storage/workspace-store';
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

/**
 * Executa uma requisição como o app faria: resolve variáveis e auth herdada,
 * envia e devolve a resposta. Nunca lança — erros vêm em `error`.
 */
export async function runRequest(data: RequestData, ctx: RunContext): Promise<RunOutcome> {
  const startedAt = new Date().toISOString();
  const scope = variableScopeFor(ctx.store, ctx);
  const secretValues = scope.secretValues();
  const { auth } = effectiveAuth(ctx.store, data, ctx);
  const prepareOpts = {
    scope,
    auth,
    defaultTimeoutMs: ctx.settings.defaultTimeoutMs,
    ...(ctx.settings.userAgent ? { userAgent: ctx.settings.userAgent } : {}),
  };

  let masked: PreparedRequest | null = null;
  try {
    masked = prepareRequest(data, { ...prepareOpts, maskSecrets: true });
    const prepared = prepareRequest(data, prepareOpts);
    const execOptions: ExecuteOptions = {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      ...(ctx.settings.proxy ? { proxy: ctx.settings.proxy } : {}),
    };
    const response = await executeRequest(prepared, execOptions);
    return { result: { request: masked, response, error: null, startedAt }, secretValues };
  } catch (error) {
    const runError: RunError =
      error instanceof HttpError
        ? { code: error.code, message: error.message, detail: error.detail }
        : { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
    // Mensagens de erro podem conter a URL resolvida: mascara segredos.
    runError.message = maskSecretValues(runError.message, secretValues);
    if (runError.detail) runError.detail = maskSecretValues(runError.detail, secretValues);
    return { result: { request: masked, response: null, error: runError, startedAt }, secretValues };
  }
}
