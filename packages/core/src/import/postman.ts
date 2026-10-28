import { normalizeDisabledAutoHeaders, TOGGLEABLE_AUTO_HEADERS } from '../http/auto-headers';
import {
  type Auth,
  type Body,
  type ExampleFile,
  type FormDataField,
  HTTP_METHODS,
  type HttpMethod,
  type KeyValue,
  type RawLanguage,
  type RequestData,
  RequestDataSchema,
  type Scripts,
} from '../model/schemas';
import type { ImportedChild, ImportedCollection } from '../storage/workspace-store';
import { formatJson } from '../util/json-format';
import { DYNAMIC_VARIABLE_NAMES } from '../variables/dynamic';
import type { VariableInput } from '../variables/persist';

/**
 * Conversão de exportações do Postman (coleções v2.1/v2.0, ambientes e
 * variáveis globais) para o modelo do app. Tudo o que não puder ser
 * representado vira um aviso no relatório — nada é descartado em silêncio.
 */

// ---------------------------------------------------------------------------
// Tipos (parciais) do formato do Postman

type Dict = Record<string, unknown>;

interface PmKeyValue {
  key?: string | null;
  value?: unknown;
  disabled?: boolean;
  description?: unknown;
  type?: string;
  src?: unknown;
  contentType?: string;
  enabled?: boolean;
}

interface PmUrl {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  port?: string;
  path?: string | string[];
  query?: PmKeyValue[];
  variable?: PmKeyValue[];
  hash?: string;
}

interface PmEvent {
  listen?: string;
  disabled?: boolean;
  script?: { exec?: string | string[]; type?: string; src?: unknown };
}

interface PmRequest {
  method?: string;
  url?: string | PmUrl;
  header?: PmKeyValue[] | string;
  body?: Dict & { mode?: string; disabled?: boolean };
  auth?: Dict & { type?: string };
  description?: unknown;
}

interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest | string;
  response?: PmResponse[];
  event?: PmEvent[];
  auth?: Dict & { type?: string };
  description?: unknown;
  variable?: PmKeyValue[];
  protocolProfileBehavior?: Dict;
}

interface PmResponse {
  name?: string;
  originalRequest?: PmRequest;
  status?: string;
  code?: number;
  header?: PmKeyValue[] | string | null;
  body?: string | null;
  responseTime?: number | null;
}

// ---------------------------------------------------------------------------
// Resultado

export interface ImportWarning {
  /** Onde ocorreu: "Coleção › Pasta › Requisição". */
  path: string;
  message: string;
}

export type PostmanFileKind = 'collection' | 'environment' | 'globals' | 'unknown';

export interface ImportCounts {
  folders: number;
  requests: number;
  examples: number;
  variables: number;
  secrets: number;
}

export interface ConvertOptions {
  /** Variáveis "default" que devem virar secretas na importação. */
  secretKeys?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Detecção

export function detectPostmanFile(json: unknown): {
  kind: PostmanFileKind;
  version?: '2.1' | '2.0';
  name?: string;
} {
  if (!isDict(json)) return { kind: 'unknown' };
  const info = json.info;
  if (isDict(info) && Array.isArray(json.item)) {
    const schema = String(info.schema ?? '');
    const version = schema.includes('v2.0') ? '2.0' : '2.1';
    return { kind: 'collection', version, name: String(info.name ?? 'Coleção importada') };
  }
  const scope = json._postman_variable_scope;
  if (Array.isArray(json.values)) {
    if (scope === 'globals') return { kind: 'globals', name: 'Variáveis globais' };
    if (scope === 'environment' || typeof json.name === 'string') {
      return { kind: 'environment', name: String(json.name ?? 'Ambiente importado') };
    }
  }
  return { kind: 'unknown' };
}

/** Nomes de variáveis que parecem guardar segredos (sugestão de marcar como secreta). */
const SENSITIVE =
  /(token|senha|password|passwd|pwd|secret|segredo|api[-_]?key|apikey|client[-_]?secret|credential|private|cookie|session)/i;

export function looksSensitive(key: string): boolean {
  return SENSITIVE.test(key);
}

// ---------------------------------------------------------------------------
// Coleção

export function convertCollection(
  json: unknown,
  options: ConvertOptions = {},
): { collection: ImportedCollection; warnings: ImportWarning[]; counts: ImportCounts } {
  const detected = detectPostmanFile(json);
  if (detected.kind !== 'collection' || !isDict(json))
    throw new Error('O arquivo não é uma coleção do Postman.');
  const info = json.info as Dict;
  const name = String(info.name ?? 'Coleção importada').trim() || 'Coleção importada';
  const ctx = new Context(name, options);
  if (detected.version === '2.0')
    ctx.warn(name, 'Coleção no formato v2.0: importada no modo compatível; revise o resultado.');

  const variables = convertVariables(asArray<PmKeyValue>(json.variable), ctx, name);
  const collection: ImportedCollection = {
    name,
    auth: json.auth ? convertAuth(json.auth as Dict, ctx, name) : { type: 'none' },
    variables,
    scripts: convertEvents(asArray<PmEvent>(json.event), ctx, name),
    description: describe(info.description),
    children: asArray<PmItem>(json.item).map((item) => convertItem(item, ctx, [name])),
  };
  ctx.counts.variables = variables.length;
  ctx.reportDynamicVariables();
  return { collection, warnings: ctx.warnings, counts: ctx.counts };
}

class Context {
  readonly warnings: ImportWarning[] = [];
  readonly counts: ImportCounts = { folders: 0, requests: 0, examples: 0, variables: 0, secrets: 0 };
  private readonly dynamicUsed = new Map<string, string>();

  constructor(
    readonly root: string,
    readonly options: ConvertOptions,
  ) {}

  warn(path: string, message: string): void {
    this.warnings.push({ path, message });
  }

  /** Registra variáveis dinâmicas ({{$...}}) que o app não gera. */
  scanDynamic(text: string, path: string): void {
    for (const match of text.matchAll(/\{\{\s*(\$[\w.]+)\s*\}\}/g)) {
      const name = match[1];
      if (name && !DYNAMIC_VARIABLE_NAMES.includes(name) && !this.dynamicUsed.has(name))
        this.dynamicUsed.set(name, path);
    }
  }

  reportDynamicVariables(): void {
    for (const [name, path] of this.dynamicUsed) {
      this.warn(
        path,
        `A variável dinâmica {{${name}}} não é gerada pelo app (veja as suportadas em "Dados de teste", no topo da requisição). Ela será enviada como texto literal.`,
      );
    }
  }
}

function convertItem(item: PmItem, ctx: Context, parents: string[]): ImportedChild {
  const name = String(item.name ?? 'Sem nome').trim() || 'Sem nome';
  const path = [...parents, name].join(' › ');

  if (Array.isArray(item.item)) {
    ctx.counts.folders++;
    if (item.variable?.length) ctx.warn(path, 'Variáveis de pasta não existem no app e foram ignoradas.');
    return {
      kind: 'folder',
      name,
      auth: item.auth ? convertAuth(item.auth, ctx, path) : { type: 'inherit' },
      scripts: convertEvents(asArray<PmEvent>(item.event), ctx, path),
      description: describe(item.description),
      children: item.item.map((child) => convertItem(child, ctx, [...parents, name])),
    };
  }

  ctx.counts.requests++;
  const request: PmRequest =
    typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request ?? {});
  const data = convertRequest(request, ctx, path);
  data.scripts = convertEvents(asArray<PmEvent>(item.event), ctx, path);
  applyProtocolBehavior(item.protocolProfileBehavior, data, ctx, path);
  if (item.variable?.length) ctx.warn(path, 'Variáveis de requisição não existem no app e foram ignoradas.');

  const examples = asArray<PmResponse>(item.response).map((r, i) => convertExample(r, i, ctx, path));
  ctx.counts.examples += examples.length;
  return { kind: 'request', name, data, examples };
}

function convertRequest(request: PmRequest, ctx: Context, path: string): RequestData {
  const method = String(request.method ?? 'GET').toUpperCase();
  const knownMethod = (HTTP_METHODS as readonly string[]).includes(method);
  if (!knownMethod) ctx.warn(path, `Método ${method} não suportado; importado como GET.`);

  const { url, query } = convertUrl(request.url, ctx, path);
  const headers = convertHeaders(request.header);
  const body = convertBody(request.body, ctx, path);
  for (const text of [
    url,
    ...query.map((q) => `${q.key}${q.value}`),
    ...headers.map((h) => `${h.key}${h.value}`),
  ]) {
    ctx.scanDynamic(text, path);
  }
  if (body.mode === 'json' || body.mode === 'raw') ctx.scanDynamic(body.text, path);

  return RequestDataSchema.parse({
    method: knownMethod ? (method as HttpMethod) : 'GET',
    url,
    query,
    headers,
    // Sem "auth" no Postman = herdar.
    auth: request.auth ? convertAuth(request.auth, ctx, path) : { type: 'inherit' },
    body,
    description: describe(request.description),
  });
}

// ---------------------------------------------------------------------------
// URL, headers e body

function convertUrl(url: PmRequest['url'], ctx: Context, path: string): { url: string; query: KeyValue[] } {
  if (url === undefined || url === null) return { url: '', query: [] };
  if (typeof url === 'string') return splitRaw(url);

  let base: string;
  if (typeof url.raw === 'string') {
    base = splitRaw(url.raw).url;
  } else {
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
    const pathPart = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '');
    base = `${url.protocol ? `${url.protocol}://` : ''}${host}${url.port ? `:${url.port}` : ''}${pathPart ? `/${pathPart}` : ''}`;
  }

  // Variáveis de caminho (:id): o app não tem; substitui pelo valor definido.
  const pathVars = asArray<PmKeyValue>(url.variable).filter((v) => v.key);
  if (pathVars.length) {
    const replaced: string[] = [];
    for (const v of pathVars) {
      const value = toText(v.value);
      const pattern = new RegExp(`:${escapeRegex(String(v.key))}(?=/|$|\\?)`);
      if (value !== '' && pattern.test(base)) {
        base = base.replace(pattern, value);
        replaced.push(`:${v.key}`);
      }
    }
    const pending = pathVars.filter((v) => !replaced.includes(`:${v.key}`)).map((v) => `:${v.key}`);
    if (replaced.length) {
      ctx.warn(
        path,
        `Variáveis de caminho (${replaced.join(', ')}) foram substituídas pelos valores salvos no Postman.`,
      );
    }
    if (pending.length) {
      ctx.warn(
        path,
        `Variáveis de caminho sem valor (${pending.join(', ')}) ficaram literais na URL; use {{variavel}}.`,
      );
    }
  }

  const query = Array.isArray(url.query)
    ? url.query
        .filter((q) => q.key !== undefined && q.key !== null)
        .map(
          (q): KeyValue => ({
            key: String(q.key),
            value: toText(q.value),
            enabled: !q.disabled,
            ...(describe(q.description) ? { description: describe(q.description) } : {}),
          }),
        )
    : typeof url.raw === 'string'
      ? splitRaw(url.raw).query
      : [];
  return { url: base, query };
}

function splitRaw(raw: string): { url: string; query: KeyValue[] } {
  const noHash = raw.split('#')[0] ?? '';
  const q = noHash.indexOf('?');
  if (q < 0) return { url: noHash, query: [] };
  const query = noHash
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((part): KeyValue => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { key: part, value: '', enabled: true }
        : { key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true };
    });
  return { url: noHash.slice(0, q), query };
}

function convertHeaders(header: PmRequest['header']): KeyValue[] {
  if (typeof header === 'string') {
    // v2.0 às vezes guarda "Chave: valor\nOutra: valor".
    return header
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const disabled = line.startsWith('//');
        const clean = disabled ? line.slice(2).trim() : line;
        const i = clean.indexOf(':');
        return {
          key: (i < 0 ? clean : clean.slice(0, i)).trim(),
          value: i < 0 ? '' : clean.slice(i + 1).trim(),
          enabled: !disabled,
        };
      });
  }
  return asArray<PmKeyValue>(header)
    .filter((h) => h.key)
    .map((h) => ({
      key: String(h.key),
      value: toText(h.value),
      enabled: !h.disabled,
      ...(describe(h.description) ? { description: describe(h.description) } : {}),
    }));
}

const RAW_LANGUAGE_MAP: Record<string, RawLanguage> = {
  text: 'text',
  javascript: 'javascript',
  json: 'json',
  html: 'html',
  xml: 'xml',
};

function convertBody(body: PmRequest['body'], ctx: Context, path: string): Body {
  if (!body?.mode) return { mode: 'none' };
  if (body.disabled) {
    ctx.warn(path, 'O body estava desabilitado no Postman e não foi importado.');
    return { mode: 'none' };
  }
  switch (body.mode) {
    case 'raw': {
      const text = normalizeNewlines(toText(body.raw));
      const options = isDict(body.options) && isDict(body.options.raw) ? body.options.raw : {};
      const language = RAW_LANGUAGE_MAP[String(options.language ?? 'text')] ?? 'text';
      if (language === 'json') return { mode: 'json', text };
      return { mode: 'raw', language, text };
    }
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        fields: asArray<PmKeyValue>(body.urlencoded)
          .filter((f) => f.key)
          .map((f) => ({
            key: String(f.key),
            value: toText(f.value),
            enabled: !f.disabled,
            ...(describe(f.description) ? { description: describe(f.description) } : {}),
          })),
      };
    case 'formdata': {
      const fields: FormDataField[] = [];
      for (const f of asArray<PmKeyValue>(body.formdata)) {
        if (!f.key) continue;
        if (f.contentType)
          ctx.warn(path, `O Content-Type específico do campo "${f.key}" (${f.contentType}) não é suportado.`);
        if (f.type === 'file') {
          const src = Array.isArray(f.src) ? f.src : f.src ? [f.src] : [];
          if (src.length > 1)
            ctx.warn(path, `O campo "${f.key}" tinha ${src.length} arquivos; só o primeiro foi importado.`);
          if (src.length === 0)
            ctx.warn(path, `O campo de arquivo "${f.key}" não tinha arquivo selecionado.`);
          fields.push({
            key: String(f.key),
            type: 'file',
            value: String(src[0] ?? ''),
            enabled: !f.disabled,
          });
        } else {
          fields.push({ key: String(f.key), type: 'text', value: toText(f.value), enabled: !f.disabled });
        }
      }
      return { mode: 'formdata', fields };
    }
    case 'graphql': {
      const gql = isDict(body.graphql) ? body.graphql : {};
      // O texto das variáveis entra como está: JSON.parse arredondaria IDs grandes.
      const rawVariables =
        typeof gql.variables === 'string'
          ? gql.variables.trim()
          : gql.variables
            ? JSON.stringify(gql.variables)
            : '';
      let variables = '{}';
      if (rawVariables !== '') {
        if (formatJson(rawVariables) !== null) variables = rawVariables;
        else ctx.warn(path, 'As variáveis GraphQL não eram JSON válido e foram descartadas.');
      }
      ctx.warn(
        path,
        'Body GraphQL convertido para JSON ({ "query", "variables" }), que é o que o Postman envia.',
      );
      const text = `{"query":${JSON.stringify(toText(gql.query))},"variables":${variables}}`;
      return { mode: 'json', text: formatJson(text) ?? text };
    }
    case 'file':
      ctx.warn(path, 'Body do tipo "binary/arquivo" não é suportado; use form-data.');
      return { mode: 'none' };
    default:
      ctx.warn(path, `Tipo de body "${body.mode}" não suportado.`);
      return { mode: 'none' };
  }
}

// ---------------------------------------------------------------------------
// Auth, scripts e variáveis

/** O Postman v2.1 guarda parâmetros como lista [{key, value}]; o v2.0, como objeto. */
function authParams(auth: Dict, type: string): Record<string, string> {
  const raw = auth[type];
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      (raw as PmKeyValue[]).filter((p) => p.key).map((p) => [String(p.key), toText(p.value)]),
    );
  }
  if (isDict(raw)) return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, toText(v)]));
  return {};
}

function convertAuth(auth: Dict, ctx: Context, path: string): Auth {
  const type = String(auth.type ?? 'noauth');
  const p = authParams(auth, type);
  switch (type) {
    case 'noauth':
      return { type: 'none' };
    case 'inherit':
      return { type: 'inherit' };
    case 'bearer':
      return { type: 'bearer', token: p.token ?? '' };
    case 'basic':
      return { type: 'basic', username: p.username ?? '', password: p.password ?? '' };
    case 'apikey':
      return {
        type: 'apikey',
        key: p.key ?? '',
        value: p.value ?? '',
        in: p.in === 'query' ? 'query' : 'header',
      };
    default:
      ctx.warn(
        path,
        `Autenticação "${type}" não é suportada (só Bearer, Basic e API Key); ficou como "sem autenticação".`,
      );
      return { type: 'none' };
  }
}

/** APIs pm.* que o app suporta nos scripts. */
const SUPPORTED_PM = new Set([
  'environment',
  'collectionVariables',
  'globals',
  'variables',
  'request',
  'response',
  'test',
  'expect',
  'info',
  'iterationData',
]);

function convertEvents(events: PmEvent[], ctx: Context, path: string): Scripts {
  const scripts: Scripts = { preRequest: '', postResponse: '' };
  for (const event of events) {
    const exec = event.script?.exec;
    const code = normalizeNewlines(Array.isArray(exec) ? exec.join('\n') : (exec ?? '')).trim();
    if (code === '') continue;
    if (event.disabled) {
      ctx.warn(path, `Script "${event.listen}" estava desabilitado no Postman e não foi importado.`);
      continue;
    }
    if (event.listen === 'prerequest') scripts.preRequest = joinScripts(scripts.preRequest, code);
    else if (event.listen === 'test') scripts.postResponse = joinScripts(scripts.postResponse, code);
    else {
      ctx.warn(path, `Script do tipo "${event.listen}" não é suportado.`);
      continue;
    }
    reportScriptApis(code, ctx, path);
  }
  return scripts;
}

function reportScriptApis(code: string, ctx: Context, path: string): void {
  const unsupported = new Set<string>();
  for (const match of code.matchAll(/\bpm\.([A-Za-z_]\w*)/g)) {
    const api = match[1];
    if (api && !SUPPORTED_PM.has(api)) unsupported.add(`pm.${api}`);
  }
  if (/\brequire\s*\(/.test(code)) unsupported.add('require()');
  if (unsupported.size) {
    ctx.warn(
      path,
      `O script usa recursos não suportados: ${[...unsupported].join(', ')}. O restante funciona normalmente.`,
    );
  }
}

function convertVariables(vars: PmKeyValue[], ctx: Context, path: string): VariableInput[] {
  const result: VariableInput[] = [];
  for (const v of vars) {
    if (!v.key) continue;
    const key = String(v.key);
    const secret = v.type === 'secret' || (ctx.options.secretKeys?.has(key) ?? false);
    if (secret) ctx.counts.secrets++;
    result.push({
      key,
      type: secret ? 'secret' : 'default',
      enabled: v.disabled !== true && v.enabled !== false,
      value: toText(v.value),
      ...(describe(v.description) ? { description: describe(v.description) } : {}),
    });
  }
  if (result.length !== vars.length) ctx.warn(path, 'Variáveis sem nome foram ignoradas.');
  return result;
}

function applyProtocolBehavior(
  behavior: Dict | undefined,
  data: RequestData,
  ctx: Context,
  path: string,
): void {
  if (!behavior) return;
  for (const [key, value] of Object.entries(behavior)) {
    if (key === 'followRedirects' && typeof value === 'boolean') data.settings.followRedirects = value;
    else if (key === 'strictSSL' && typeof value === 'boolean') data.settings.verifySsl = value;
    else if (key === 'disabledSystemHeaders') applyDisabledSystemHeaders(value, data, ctx, path);
    else if (key === 'disableBodyPruning') continue;
    else ctx.warn(path, `Configuração "${key}" do Postman não é suportada.`);
  }
}

/** Headers que o Rota não manda sozinho: desligá-los no Postman não muda nada aqui. */
const NEVER_SENT_HEADERS = new Set(['cache-control', 'postman-token']);

function applyDisabledSystemHeaders(value: unknown, data: RequestData, ctx: Context, path: string): void {
  if (!value || typeof value !== 'object') return;
  const disabled: string[] = [];
  const unsupported: string[] = [];
  for (const [name, off] of Object.entries(value as Dict)) {
    if (off !== true) continue;
    const lower = name.toLowerCase();
    if ((TOGGLEABLE_AUTO_HEADERS as readonly string[]).includes(lower)) disabled.push(lower);
    else if (!NEVER_SENT_HEADERS.has(lower)) unsupported.push(name);
  }
  if (disabled.length) data.settings.disabledAutoHeaders = normalizeDisabledAutoHeaders(disabled);
  if (unsupported.length) {
    ctx.warn(
      path,
      `Headers automáticos desligados no Postman que o Rota sempre envia: ${unsupported.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Exemplos

function convertExample(
  response: PmResponse,
  index: number,
  ctx: Context,
  path: string,
): Omit<ExampleFile, 'schemaVersion' | 'id'> {
  const original = response.originalRequest;
  let request: ExampleFile['request'];
  if (original) {
    const { url, query } = convertUrl(original.url, ctx, path);
    const method = String(original.method ?? 'GET').toUpperCase();
    const bodyText =
      isDict(original.body) && typeof original.body.raw === 'string'
        ? normalizeNewlines(original.body.raw)
        : undefined;
    request = {
      method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET',
      url: query.length
        ? `${url}?${query
            .filter((q) => q.enabled)
            .map((q) => (q.value ? `${q.key}=${q.value}` : q.key))
            .join('&')}`
        : url,
      headers: convertHeaders(original.header),
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    };
  }
  return {
    name: String(response.name ?? `Exemplo ${index + 1}`).trim() || `Exemplo ${index + 1}`,
    ...(request ? { request } : {}),
    response: {
      status: typeof response.code === 'number' ? response.code : 0,
      statusText: response.status ?? '',
      headers: convertHeaders(response.header ?? []),
      body: normalizeNewlines(response.body ?? ''),
      ...(typeof response.responseTime === 'number' ? { timeMs: response.responseTime } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Ambientes e globais

export function convertEnvironment(
  json: unknown,
  options: ConvertOptions = {},
): { name: string; variables: VariableInput[]; warnings: ImportWarning[]; counts: ImportCounts } {
  if (!isDict(json) || !Array.isArray(json.values))
    throw new Error('O arquivo não é um ambiente do Postman.');
  const name = String(json.name ?? 'Ambiente importado').trim() || 'Ambiente importado';
  const ctx = new Context(name, options);
  const variables = convertVariables(json.values as PmKeyValue[], ctx, name);
  ctx.counts.variables = variables.length;
  return { name, variables, warnings: ctx.warnings, counts: ctx.counts };
}

export function convertGlobals(
  json: unknown,
  options: ConvertOptions = {},
): { variables: VariableInput[]; warnings: ImportWarning[]; counts: ImportCounts } {
  if (!isDict(json) || !Array.isArray(json.values))
    throw new Error('O arquivo não contém variáveis globais do Postman.');
  const ctx = new Context('Variáveis globais', options);
  const variables = convertVariables(json.values as PmKeyValue[], ctx, 'Variáveis globais');
  ctx.counts.variables = variables.length;
  return { variables, warnings: ctx.warnings, counts: ctx.counts };
}

/** Variáveis com valor que parecem sensíveis e ainda não são secretas. */
export function sensitiveVariableKeys(json: unknown): string[] {
  if (!isDict(json)) return [];
  const vars: PmKeyValue[] = Array.isArray(json.values)
    ? (json.values as PmKeyValue[])
    : Array.isArray(json.variable)
      ? (json.variable as PmKeyValue[])
      : [];
  return vars
    .filter((v) => v.key && v.type !== 'secret' && looksSensitive(String(v.key)))
    .map((v) => String(v.key));
}

// ---------------------------------------------------------------------------
// Utilitários

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function describe(value: unknown): string | undefined {
  const text = isDict(value) ? toText(value.content) : toText(value);
  return text.trim() === '' ? undefined : normalizeNewlines(text);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function joinScripts(a: string, b: string): string {
  return a ? `${a}\n\n${b}` : b;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
