import { composeUrl } from '../http/url';
import type { Auth, Body, ExampleFile, KeyValue, RequestData, Scripts } from '../model/schemas';
import type { ChildNode, CollectionNode, EnvironmentView, VariableView } from '../model/tree';

/**
 * Exporta coleções e ambientes no formato do Postman (coleção v2.1).
 * Valores de variáveis secretas NUNCA são exportados: vão vazios, com o tipo
 * "secret", para o arquivo poder ser compartilhado sem vazar tokens.
 */

const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

type Json = Record<string, unknown>;

export function exportCollectionToPostman(collection: CollectionNode): Json {
  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      ...(collection.description ? { description: collection.description } : {}),
      schema: SCHEMA_V21,
    },
    item: collection.children.map(exportChild),
    ...auth(collection.auth),
    ...events(collection.scripts),
    variable: collection.variables.map((v) => ({
      key: v.key,
      value: v.type === 'secret' ? '' : (v.value ?? ''),
      type: v.type === 'secret' ? 'secret' : 'string',
      ...(v.enabled ? {} : { disabled: true }),
      ...(v.description ? { description: v.description } : {}),
    })),
  };
}

export function exportEnvironmentToPostman(environment: EnvironmentView): Json {
  return {
    id: environment.id,
    name: environment.name,
    values: environment.variables.map(envValue),
    _postman_variable_scope: 'environment',
  };
}

export function exportGlobalsToPostman(variables: readonly VariableView[]): Json {
  return { name: 'Globals', values: variables.map(envValue), _postman_variable_scope: 'globals' };
}

function envValue(v: VariableView): Json {
  return {
    key: v.key,
    value: v.type === 'secret' ? '' : (v.value ?? ''),
    type: v.type === 'secret' ? 'secret' : 'default',
    enabled: v.enabled,
  };
}

function exportChild(node: ChildNode): Json {
  if (node.kind === 'folder') {
    return {
      name: node.name,
      ...(node.description ? { description: node.description } : {}),
      item: node.children.map(exportChild),
      ...(node.auth.type === 'inherit' ? {} : auth(node.auth)),
      ...events(node.scripts),
    };
  }
  return {
    name: node.name,
    ...events(node.data.scripts),
    request: request(node.data),
    response: node.examples.map((e) => example(e, node.data)),
  };
}

function request(data: RequestData): Json {
  return {
    method: data.method,
    header: data.headers.map(keyValue),
    ...(data.auth.type === 'inherit' ? {} : auth(data.auth)),
    ...body(data.body),
    url: url(data.url, data.query),
    ...(data.description ? { description: data.description } : {}),
  };
}

function url(base: string, query: readonly KeyValue[]): Json {
  const raw = composeUrl(base, query);
  const match = /^(?:(\w+):\/\/)?([^/?#]*)(\/[^?#]*)?/.exec(base);
  const host = match?.[2] ?? '';
  const path = (match?.[3] ?? '').split('/').filter(Boolean);
  return {
    raw,
    ...(match?.[1] ? { protocol: match[1] } : {}),
    ...(host ? { host: host.split('.') } : {}),
    ...(path.length ? { path } : {}),
    ...(query.length ? { query: query.map(keyValue) } : {}),
  };
}

function keyValue(kv: KeyValue): Json {
  return {
    key: kv.key,
    value: kv.value,
    ...(kv.enabled ? {} : { disabled: true }),
    ...(kv.description ? { description: kv.description } : {}),
  };
}

function body(b: Body): Json {
  switch (b.mode) {
    case 'none':
      return {};
    case 'json':
      return { body: { mode: 'raw', raw: b.text, options: { raw: { language: 'json' } } } };
    case 'raw':
      return { body: { mode: 'raw', raw: b.text, options: { raw: { language: b.language } } } };
    case 'urlencoded':
      return { body: { mode: 'urlencoded', urlencoded: b.fields.map(keyValue) } };
    case 'formdata':
      return {
        body: {
          mode: 'formdata',
          formdata: b.fields.map((f) => ({
            key: f.key,
            type: f.type,
            ...(f.type === 'file' ? { src: f.value } : { value: f.value }),
            ...(f.enabled ? {} : { disabled: true }),
            ...(f.description ? { description: f.description } : {}),
          })),
        },
      };
  }
}

function auth(a: Auth): Json {
  const entries = (pairs: Record<string, string>) =>
    Object.entries(pairs).map(([key, value]) => ({ key, value, type: 'string' }));
  switch (a.type) {
    case 'inherit':
      return { auth: { type: 'inherit' } };
    case 'none':
      return { auth: { type: 'noauth' } };
    case 'bearer':
      return { auth: { type: 'bearer', bearer: entries({ token: a.token }) } };
    case 'basic':
      return { auth: { type: 'basic', basic: entries({ username: a.username, password: a.password }) } };
    case 'apikey':
      return { auth: { type: 'apikey', apikey: entries({ key: a.key, value: a.value, in: a.in }) } };
  }
}

function events(scripts: Scripts): Json {
  const list: Json[] = [];
  const add = (listen: string, code: string) => {
    if (code.trim()) list.push({ listen, script: { type: 'text/javascript', exec: code.split(/\r?\n/) } });
  };
  add('prerequest', scripts.preRequest);
  add('test', scripts.postResponse);
  return list.length ? { event: list } : {};
}

function example(e: ExampleFile, data: RequestData): Json {
  const original = e.request
    ? {
        method: e.request.method,
        header: e.request.headers.map(keyValue),
        url: { raw: e.request.url },
        ...(e.request.body ? { body: { mode: 'raw', raw: e.request.body } } : {}),
      }
    : request(data);
  const contentType = e.response.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  return {
    name: e.name,
    originalRequest: original,
    status: e.response.statusText,
    code: e.response.status,
    _postman_previewlanguage: /json/i.test(contentType) ? 'json' : /xml/i.test(contentType) ? 'xml' : 'text',
    header: e.response.headers.map(keyValue),
    body: e.response.body,
    ...(e.response.timeMs !== undefined ? { responseTime: e.response.timeMs } : {}),
  };
}
