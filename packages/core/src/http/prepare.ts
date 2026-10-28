import type { Auth, HttpMethod, RequestData } from '../model/schemas';
import { resolveTemplate, SECRET_MASK, type VariableScope } from '../variables/template';
import { bodyContentType, DEFAULT_AUTO_HEADERS, isAutoHeaderDisabled } from './auto-headers';
import { composeUrl, ensureProtocol } from './url';

/** Requisição pronta para envio: variáveis resolvidas e auth aplicada. */
export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body: PreparedBody;
  settings: { timeoutMs: number; followRedirects: boolean; verifySsl: boolean };
}

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'formdata'; fields: { key: string; type: 'text' | 'file'; value: string }[] };

export interface PrepareOptions {
  scope: VariableScope;
  /** Auth efetiva (já com a herança resolvida). */
  auth: Exclude<Auth, { type: 'inherit' }>;
  defaultTimeoutMs: number;
  /** Gera a versão "para exibir": segredos viram ••••••. */
  maskSecrets?: boolean;
  userAgent?: string;
  /** Headers automáticos (User-Agent, Accept...). Padrão: true. */
  defaultHeaders?: boolean;
}

export function findHeader(headers: readonly [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1];
}

export function prepareRequest(data: RequestData, options: PrepareOptions): PreparedRequest {
  const resolveOpts = options.maskSecrets ? { maskSecrets: true } : {};
  const r = (text: string) => resolveTemplate(text, options.scope, resolveOpts);

  // Um "#" vindo de variável cortaria a URL ali: o resto viraria fragmento e não seria enviado.
  const q = (text: string) => r(text).replaceAll('#', '%23');
  const query = data.query.map((p) => ({ ...p, key: q(p.key), value: q(p.value) }));
  // Espaços e quebras nas pontas não contam no HTTP, mas um token colado com "\n" no fim impede o envio.
  const headers: [string, string][] = data.headers
    .filter((h) => h.enabled && h.key.trim() !== '')
    .map((h) => [r(h.key).trim(), r(h.value).trim()]);

  // Autenticação. Um header Authorization definido manualmente tem precedência.
  const auth = options.auth;
  if (auth.type === 'bearer' && !findHeader(headers, 'authorization')) {
    headers.push(['Authorization', `Bearer ${r(auth.token).trim()}`]);
  } else if (auth.type === 'basic' && !findHeader(headers, 'authorization')) {
    const user = r(auth.username);
    const pass = r(auth.password);
    const masked = user.includes(SECRET_MASK) || pass.includes(SECRET_MASK);
    const encoded = masked ? SECRET_MASK : Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    headers.push(['Authorization', `Basic ${encoded}`]);
  } else if (auth.type === 'apikey' && auth.key.trim() !== '') {
    if (auth.in === 'header') {
      const key = r(auth.key).trim();
      if (!findHeader(headers, key)) headers.push([key, r(auth.value).trim()]);
    } else query.push({ key: q(auth.key), value: q(auth.value), enabled: true });
  }

  const base = r(data.url).trim();
  const url = composeUrl(base === '' ? base : ensureProtocol(base), query);

  // Body e Content-Type padrão.
  let body: PreparedBody = { kind: 'none' };
  switch (data.body.mode) {
    case 'json':
    case 'raw':
      body = { kind: 'text', text: r(data.body.text) };
      break;
    case 'urlencoded': {
      const text = data.body.fields
        .filter((f) => f.enabled && f.key !== '')
        .map((f) => `${encodeURIComponent(r(f.key))}=${encodeURIComponent(r(f.value))}`)
        .join('&');
      body = { kind: 'text', text };
      break;
    }
    case 'formdata':
      // O Content-Type (com boundary) é definido pelo cliente HTTP.
      body = {
        kind: 'formdata',
        fields: data.body.fields
          .filter((f) => f.enabled && f.key !== '')
          .map((f) => ({ key: r(f.key), type: f.type, value: f.type === 'text' ? r(f.value) : f.value })),
      };
      break;
    case 'none':
      break;
  }
  const contentType = bodyContentType(data.body);
  if (contentType && !isAutoHeaderDisabled(data, 'content-type') && !findHeader(headers, 'content-type')) {
    headers.push(['Content-Type', contentType]);
  }

  // Headers padrão: um header da tabela com o mesmo nome toma o lugar, e cada um pode ser desligado.
  if (options.defaultHeaders !== false) {
    for (const [name, key, value] of DEFAULT_AUTO_HEADERS) {
      if (isAutoHeaderDisabled(data, name) || findHeader(headers, key)) continue;
      headers.push([key, name === 'user-agent' ? (options.userAgent ?? value) : value]);
    }
  }

  return {
    method: data.method,
    url,
    headers,
    body,
    settings: {
      timeoutMs: data.settings.timeoutMs ?? options.defaultTimeoutMs,
      followRedirects: data.settings.followRedirects,
      verifySsl: data.settings.verifySsl,
    },
  };
}
