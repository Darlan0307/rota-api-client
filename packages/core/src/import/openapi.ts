import type { Auth, Body, ExampleFile, KeyValue, RequestData } from '../model/schemas';
import { HTTP_METHODS, RequestDataSchema } from '../model/schemas';
import type { ImportedChild, ImportedCollection } from '../storage/workspace-store';
import type { VariableInput } from '../variables/persist';
import type { ImportCounts, ImportWarning } from './postman';

/**
 * Conversor de OpenAPI 3.x e Swagger 2.0 para uma coleção do Rota:
 * - uma pasta por tag (operações sem tag ficam na raiz);
 * - URL base na variável de coleção {{baseUrl}};
 * - parâmetros de caminho viram {{variáveis}} da coleção (/users/{id} → /users/{{id}});
 * - corpo e respostas de exemplo gerados dos exemplos ou, na falta deles, do schema;
 * - esquemas de segurança viram a auth da coleção com variáveis secretas.
 */

type Json = Record<string, unknown>;

export interface OpenApiDetection {
  version: '2.0' | '3.0' | '3.1';
  title: string;
}

export function detectOpenApi(json: unknown): OpenApiDetection | undefined {
  if (!isObject(json)) return undefined;
  const info = isObject(json.info) ? json.info : {};
  const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'API importada';
  if (typeof json.openapi === 'string' && /^3\.[01]/.test(json.openapi) && isObject(json.paths)) {
    return { version: json.openapi.startsWith('3.1') ? '3.1' : '3.0', title };
  }
  if (json.swagger === '2.0' && isObject(json.paths)) return { version: '2.0', title };
  return undefined;
}

export interface OpenApiConversion {
  collection: ImportedCollection;
  warnings: ImportWarning[];
  counts: ImportCounts;
}

const METHODS = HTTP_METHODS.map((m) => m.toLowerCase());
const SKIPPED_HEADERS = new Set(['accept', 'content-type', 'authorization']);
const MAX_SAMPLE_DEPTH = 8;

export function convertOpenApi(json: unknown): OpenApiConversion {
  const detected = detectOpenApi(json);
  if (!detected || !isObject(json)) throw new Error('Não é um documento OpenAPI 3.x ou Swagger 2.0.');
  const doc = json;
  const swagger2 = detected.version === '2.0';
  const warnings: ImportWarning[] = [];
  const counts: ImportCounts = { folders: 0, requests: 0, examples: 0, variables: 0, secrets: 0 };
  const resolve = makeResolver(doc);

  // ---- Variáveis e auth da coleção ----------------------------------------
  const variables: VariableInput[] = [];
  const addVariable = (key: string, value: string, secret: boolean, description: string) => {
    if (variables.some((v) => v.key === key)) return;
    variables.push(
      secret
        ? { key, type: 'secret', enabled: true, value, description }
        : { key, type: 'default', enabled: true, value, description },
    );
  };
  addVariable('baseUrl', baseUrlOf(doc, swagger2, detected.title, warnings), false, 'URL base da API');

  const schemes = securitySchemes(doc, swagger2, resolve);
  const authFor = (requirement: unknown): Auth | undefined => {
    if (!Array.isArray(requirement)) return undefined;
    if (requirement.length === 0) return { type: 'none' };
    for (const req of requirement) {
      if (!isObject(req)) continue;
      for (const name of Object.keys(req)) {
        const scheme = schemes.get(name);
        if (scheme) return scheme.auth;
      }
    }
    return undefined;
  };
  const collectionAuth = authFor(doc.security) ?? { type: 'none' };
  for (const scheme of schemes.values()) {
    for (const v of scheme.variables) addVariable(v.key, '', v.secret, v.description);
  }

  // ---- Pastas por tag e requisições ----------------------------------------
  const tagDescriptions = new Map<string, string>();
  if (Array.isArray(doc.tags)) {
    for (const tag of doc.tags) {
      if (isObject(tag) && typeof tag.name === 'string' && typeof tag.description === 'string')
        tagDescriptions.set(tag.name, tag.description);
    }
  }
  const folders = new Map<string, Extract<ImportedChild, { kind: 'folder' }>>();
  const root: ImportedChild[] = [];

  for (const [path, rawItem] of Object.entries(doc.paths as Json)) {
    const pathItem = resolve(rawItem);
    if (!isObject(pathItem)) continue;
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of METHODS) {
      const operation = resolve(pathItem[method]);
      if (!isObject(operation)) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const ctx = { resolve, warnings, where, swagger2, doc };
      const parameters = mergeParameters(shared, operation.parameters, resolve);

      // URL: {param} → {{param}} (com variável na coleção).
      for (const p of parameters.filter((p) => p.in === 'path')) {
        addVariable(
          p.name,
          sampleParam(p, ctx),
          false,
          `Parâmetro de caminho${p.description ? `: ${p.description}` : ''}`,
        );
      }
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`;
      const query: KeyValue[] = parameters
        .filter((p) => p.in === 'query')
        .map((p) => ({
          key: p.name,
          value: sampleParam(p, ctx),
          enabled: p.required,
          ...desc(p.description),
        }));
      const headers: KeyValue[] = parameters
        .filter((p) => p.in === 'header' && !SKIPPED_HEADERS.has(p.name.toLowerCase()))
        .map((p) => ({
          key: p.name,
          value: sampleParam(p, ctx),
          enabled: p.required,
          ...desc(p.description),
        }));
      if (parameters.some((p) => p.in === 'cookie')) {
        warnings.push({ path: where, message: 'Parâmetros de cookie não foram importados.' });
      }

      const opAuth = authFor(operation.security);
      const data: RequestData = RequestDataSchema.parse({
        method: method.toUpperCase(),
        url,
        query,
        headers,
        auth:
          opAuth && JSON.stringify(opAuth) !== JSON.stringify(collectionAuth) ? opAuth : { type: 'inherit' },
        body: requestBody(operation, parameters, ctx),
        description:
          [operation.summary, operation.description]
            .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
            .join('\n\n') || undefined,
      });

      const examples = responseExamples(operation, ctx, method.toUpperCase(), url);
      counts.examples += examples.length;
      counts.requests += 1;
      const name =
        (typeof operation.summary === 'string' && operation.summary.trim()) ||
        (typeof operation.operationId === 'string' && operation.operationId) ||
        where;
      const request: ImportedChild = { kind: 'request', name: name.slice(0, 120), data, examples };

      const tag =
        Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : null;
      if (!tag) {
        root.push(request);
        continue;
      }
      let folder = folders.get(tag);
      if (!folder) {
        folder = {
          kind: 'folder',
          name: tag,
          auth: { type: 'inherit' },
          scripts: { preRequest: '', postResponse: '' },
          description: tagDescriptions.get(tag),
          children: [],
        };
        folders.set(tag, folder);
        counts.folders += 1;
      }
      folder.children.push(request);
    }
  }

  counts.variables = variables.length;
  counts.secrets = variables.filter((v) => v.type === 'secret').length;
  const info = isObject(doc.info) ? doc.info : {};
  const version = typeof info.version === 'string' ? info.version : undefined;
  return {
    collection: {
      name: detected.title,
      auth: collectionAuth,
      variables,
      scripts: { preRequest: '', postResponse: '' },
      description:
        [
          typeof info.description === 'string' ? info.description : '',
          version ? `Versão da API: ${version}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
      children: [...folders.values(), ...root],
    },
    warnings,
    counts,
  };
}

// ---------------------------------------------------------------------------
// $ref

type Resolve = (value: unknown) => unknown;

/** Resolve $ref locais ("#/components/schemas/X"); referências externas ficam sem resolver. */
function makeResolver(doc: Json): Resolve {
  return function resolve(value: unknown, seen = new Set<string>()): unknown {
    if (!isObject(value) || typeof value.$ref !== 'string') return value;
    const ref = value.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    const target = ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), doc);
    seen.add(ref);
    return resolve(target, seen) ?? {};
  };
}

// ---------------------------------------------------------------------------
// Servidor, segurança e parâmetros

function baseUrlOf(doc: Json, swagger2: boolean, title: string, warnings: ImportWarning[]): string {
  if (swagger2) {
    const host = typeof doc.host === 'string' ? doc.host : '';
    const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
    const scheme =
      Array.isArray(doc.schemes) && typeof doc.schemes[0] === 'string' ? doc.schemes[0] : 'https';
    if (!host)
      warnings.push({ path: title, message: 'O documento não informa o host: preencha a variável baseUrl.' });
    return host ? `${scheme}://${host}${basePath}`.replace(/\/$/, '') : basePath;
  }
  const server = Array.isArray(doc.servers) ? doc.servers.find(isObject) : undefined;
  if (!server || typeof server.url !== 'string') {
    warnings.push({
      path: title,
      message: 'O documento não informa servidores: preencha a variável baseUrl.',
    });
    return '';
  }
  let url = server.url;
  if (isObject(server.variables)) {
    for (const [key, v] of Object.entries(server.variables)) {
      const fallback = isObject(v) && v.default !== undefined ? String(v.default) : '';
      url = url.replaceAll(`{${key}}`, fallback);
    }
  }
  if (url.startsWith('/')) {
    warnings.push({
      path: title,
      message: `O servidor é relativo (${url}): complete a variável baseUrl com o domínio.`,
    });
  }
  return url.replace(/\/$/, '');
}

interface SchemeInfo {
  auth: Auth;
  variables: { key: string; secret: boolean; description: string }[];
}

function securitySchemes(doc: Json, swagger2: boolean, resolve: Resolve): Map<string, SchemeInfo> {
  const raw = swagger2
    ? doc.securityDefinitions
    : isObject(doc.components)
      ? doc.components.securitySchemes
      : undefined;
  const result = new Map<string, SchemeInfo>();
  if (!isObject(raw)) return result;
  for (const [name, value] of Object.entries(raw)) {
    const s = resolve(value);
    if (!isObject(s)) continue;
    const type = String(s.type ?? '').toLowerCase();
    const scheme = String(s.scheme ?? '').toLowerCase();
    if (type === 'apikey' && typeof s.name === 'string') {
      result.set(name, {
        auth: { type: 'apikey', key: s.name, value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' },
        variables: [{ key: 'apiKey', secret: true, description: `Chave de API (${s.name})` }],
      });
    } else if (type === 'basic' || (type === 'http' && scheme === 'basic')) {
      result.set(name, {
        auth: { type: 'basic', username: '{{username}}', password: '{{password}}' },
        variables: [
          { key: 'username', secret: false, description: 'Usuário' },
          { key: 'password', secret: true, description: 'Senha' },
        ],
      });
    } else if ((type === 'http' && scheme === 'bearer') || type === 'oauth2' || type === 'openidconnect') {
      result.set(name, {
        auth: { type: 'bearer', token: '{{token}}' },
        variables: [
          {
            key: 'token',
            secret: true,
            description:
              type === 'http' ? 'Token de acesso' : 'Token de acesso (obtenha pelo fluxo OAuth e cole aqui)',
          },
        ],
      });
    }
  }
  return result;
}

interface Param {
  name: string;
  in: string;
  required: boolean;
  description?: string | undefined;
  schema?: unknown;
  example?: unknown;
  raw: Json;
}

function mergeParameters(shared: unknown[], own: unknown, resolve: Resolve): Param[] {
  const map = new Map<string, Param>();
  for (const value of [...shared, ...(Array.isArray(own) ? own : [])]) {
    const p = resolve(value);
    if (!isObject(p) || typeof p.name !== 'string' || typeof p.in !== 'string') continue;
    map.set(`${p.in}:${p.name}`, {
      name: p.name,
      in: p.in,
      required: p.required === true || p.in === 'path',
      description: typeof p.description === 'string' ? p.description : undefined,
      // Swagger 2.0 tem type/format no próprio parâmetro.
      schema: p.schema ?? p,
      example: p.example ?? (isObject(p.examples) ? firstExampleValue(p.examples, resolve) : undefined),
      raw: p,
    });
  }
  return [...map.values()];
}

interface Ctx {
  resolve: Resolve;
  warnings: ImportWarning[];
  where: string;
  swagger2: boolean;
  doc: Json;
}

function sampleParam(p: Param, ctx: Ctx): string {
  if (p.example !== undefined) return stringify(p.example);
  const schema = ctx.resolve(p.schema);
  if (isObject(schema)) {
    if (schema.example !== undefined) return stringify(schema.example);
    if (schema.default !== undefined) return stringify(schema.default);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return stringify(schema.enum[0]);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Corpo da requisição

function requestBody(operation: Json, parameters: Param[], ctx: Ctx): Body {
  if (ctx.swagger2) {
    const bodyParam = parameters.find((p) => p.in === 'body');
    if (bodyParam) {
      const value = bodyParam.raw['x-example'] ?? sampleFromSchema(bodyParam.raw.schema, ctx);
      return { mode: 'json', text: pretty(value) };
    }
    const formParams = parameters.filter((p) => p.in === 'formData');
    if (formParams.length === 0) return { mode: 'none' };
    const consumes = Array.isArray(operation.consumes) ? operation.consumes : ctx.doc.consumes;
    const multipart =
      formParams.some((p) => p.raw.type === 'file') ||
      (Array.isArray(consumes) && consumes.includes('multipart/form-data'));
    return multipart
      ? {
          mode: 'formdata',
          fields: formParams.map((p) => ({
            key: p.name,
            type: p.raw.type === 'file' ? 'file' : 'text',
            value: p.raw.type === 'file' ? '' : sampleParam(p, ctx),
            enabled: true,
            ...desc(p.description),
          })),
        }
      : {
          mode: 'urlencoded',
          fields: formParams.map((p) => ({
            key: p.name,
            value: sampleParam(p, ctx),
            enabled: true,
            ...desc(p.description),
          })),
        };
  }

  const body = ctx.resolve(operation.requestBody);
  if (!isObject(body) || !isObject(body.content)) return { mode: 'none' };
  const content = body.content;
  const types = Object.keys(content);
  const json = types.find((t) => /json/i.test(t));
  if (json) return { mode: 'json', text: pretty(mediaSample(content[json], ctx)) };

  const form = types.find((t) => t === 'application/x-www-form-urlencoded' || t === 'multipart/form-data');
  if (form) {
    const media = isObject(content[form]) ? content[form] : {};
    const schema = ctx.resolve(media.schema);
    const props = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
    const sample = mediaSample(media, ctx);
    const entries = Object.entries(props).map(([key, prop]) => {
      const p = ctx.resolve(prop);
      const binary = isObject(p) && (p.format === 'binary' || p.format === 'base64') && p.type === 'string';
      return {
        key,
        binary,
        value: isObject(sample) && sample[key] !== undefined ? stringify(sample[key]) : '',
      };
    });
    if (form === 'multipart/form-data') {
      return {
        mode: 'formdata',
        fields: entries.map((e) => ({
          key: e.key,
          type: e.binary ? ('file' as const) : ('text' as const),
          value: e.binary ? '' : e.value,
          enabled: true,
        })),
      };
    }
    return {
      mode: 'urlencoded',
      fields: entries.map((e) => ({ key: e.key, value: e.value, enabled: true })),
    };
  }

  const other = types[0];
  if (!other) return { mode: 'none' };
  const sample = mediaSample(content[other], ctx);
  const language = /xml/i.test(other) ? 'xml' : /html/i.test(other) ? 'html' : 'text';
  return { mode: 'raw', language, text: typeof sample === 'string' ? sample : pretty(sample) };
}

// ---------------------------------------------------------------------------
// Respostas de exemplo

function responseExamples(operation: Json, ctx: Ctx, method: string, url: string) {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const examples: Omit<ExampleFile, 'schemaVersion' | 'id'>[] = [];
  for (const [code, raw] of Object.entries(responses)) {
    const status = Number(code);
    if (!Number.isInteger(status)) continue; // "default" e afins
    const response = ctx.resolve(raw);
    if (!isObject(response)) continue;
    const description = typeof response.description === 'string' ? response.description : '';

    let contentType: string | undefined;
    let body: unknown;
    let named: { name: string; value: unknown }[] = [];
    if (ctx.swagger2) {
      const ex = isObject(response.examples) ? response.examples : {};
      contentType = Object.keys(ex).find((t) => /json/i.test(t)) ?? Object.keys(ex)[0];
      if (contentType) body = ex[contentType];
      else if (response.schema !== undefined) {
        contentType = 'application/json';
        body = sampleFromSchema(response.schema, ctx);
      }
    } else if (isObject(response.content)) {
      const types = Object.keys(response.content);
      contentType = types.find((t) => /json/i.test(t)) ?? types[0];
      const media = contentType ? response.content[contentType] : undefined;
      if (isObject(media) && isObject(media.examples)) {
        named = Object.entries(media.examples).map(([name, ex]) => {
          const resolved = ctx.resolve(ex);
          return { name, value: isObject(resolved) ? resolved.value : undefined };
        });
      }
      if (contentType) body = mediaSample(media, ctx);
    }
    if (contentType === undefined) continue;

    const variants = named.filter((n) => n.value !== undefined);
    const list = variants.length > 0 ? variants : [{ name: '', value: body }];
    for (const variant of list) {
      examples.push({
        name: [code, variant.name || description].filter(Boolean).join(' – ').slice(0, 120),
        request: { method: method as RequestData['method'], url, headers: [] },
        response: {
          status,
          statusText: description.slice(0, 120),
          headers: [{ key: 'Content-Type', value: contentType, enabled: true }],
          body: typeof variant.value === 'string' ? variant.value : pretty(variant.value),
        },
      });
    }
  }
  return examples;
}

// ---------------------------------------------------------------------------
// Amostras a partir de exemplos e schemas

function mediaSample(media: unknown, ctx: Ctx): unknown {
  if (!isObject(media)) return undefined;
  if (media.example !== undefined) return media.example;
  if (isObject(media.examples)) {
    const first = firstExampleValue(media.examples, ctx.resolve);
    if (first !== undefined) return first;
  }
  return sampleFromSchema(media.schema, ctx);
}

function firstExampleValue(examples: Json, resolve: Resolve): unknown {
  for (const ex of Object.values(examples)) {
    const resolved = resolve(ex);
    if (isObject(resolved) && resolved.value !== undefined) return resolved.value;
  }
  return undefined;
}

/** Gera um valor de exemplo seguindo o schema (tipos, formatos, enums, allOf/oneOf). */
export function sampleFromSchema(schema: unknown, ctx: Pick<Ctx, 'resolve'>, depth = 0): unknown {
  const s = ctx.resolve(schema);
  if (!isObject(s) || depth > MAX_SAMPLE_DEPTH) return null;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  if (Array.isArray(s.allOf)) {
    const merged: Json = {};
    for (const part of s.allOf) {
      const value = sampleFromSchema(part, ctx, depth + 1);
      if (isObject(value)) Object.assign(merged, value);
    }
    return merged;
  }
  const variant = Array.isArray(s.oneOf) ? s.oneOf[0] : Array.isArray(s.anyOf) ? s.anyOf[0] : undefined;
  if (variant !== undefined) return sampleFromSchema(variant, ctx, depth + 1);

  // OpenAPI 3.1 permite type: ["string", "null"].
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type ?? (isObject(s.properties) ? 'object' : s.items ? 'array' : undefined)) {
    case 'object': {
      const out: Json = {};
      if (isObject(s.properties)) {
        for (const [key, prop] of Object.entries(s.properties))
          out[key] = sampleFromSchema(prop, ctx, depth + 1);
      }
      return out;
    }
    case 'array':
      return s.items === undefined ? [] : [sampleFromSchema(s.items, ctx, depth + 1)];
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return true;
    case 'string':
      return sampleString(typeof s.format === 'string' ? s.format : '');
    default:
      return null;
  }
}

function sampleString(format: string): string {
  switch (format) {
    case 'date':
      return '2026-01-01';
    case 'date-time':
      return '2026-01-01T12:00:00Z';
    case 'email':
      return 'usuario@exemplo.com';
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000';
    case 'uri':
    case 'url':
      return 'https://exemplo.com';
    case 'ipv4':
      return '192.168.0.1';
    case 'password':
      return '';
    default:
      return 'string';
  }
}

// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function pretty(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function desc(description: string | undefined): { description?: string } {
  return description ? { description } : {};
}
