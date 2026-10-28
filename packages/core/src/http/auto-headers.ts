import type { Auth, RawLanguage, RequestData } from '../model/schemas';

/**
 * Headers que o Rota acrescenta sozinho, como os "headers ocultos" do Postman.
 * Funções puras: o envio (prepare.ts) e a aba Headers usam a mesma lista.
 */

/** Headers automáticos que podem ser desligados por requisição (`settings.disabledAutoHeaders`). */
export const TOGGLEABLE_AUTO_HEADERS = ['content-type', 'user-agent', 'accept', 'accept-encoding'] as const;
export type ToggleableAutoHeader = (typeof TOGGLEABLE_AUTO_HEADERS)[number];

export const DEFAULT_USER_AGENT = 'Rota';

export const DEFAULT_AUTO_HEADERS: readonly [ToggleableAutoHeader, string, string][] = [
  ['user-agent', 'User-Agent', DEFAULT_USER_AGENT],
  ['accept', 'Accept', '*/*'],
  ['accept-encoding', 'Accept-Encoding', 'gzip, deflate, br'],
];

const RAW_CONTENT_TYPES: Record<RawLanguage, string> = {
  text: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
};

/** Content-Type padrão do corpo (formdata fica com o cliente HTTP, por causa do boundary). */
export function bodyContentType(body: RequestData['body']): string | undefined {
  switch (body.mode) {
    case 'json':
      return 'application/json';
    case 'raw':
      return RAW_CONTENT_TYPES[body.language];
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    default:
      return undefined;
  }
}

export function isAutoHeaderDisabled(data: RequestData, name: ToggleableAutoHeader): boolean {
  return data.settings.disabledAutoHeaders?.includes(name) ?? false;
}

export interface AutoHeader {
  key: string;
  /** Valor como será enviado (com `{{variáveis}}` ainda por resolver) ou uma descrição do que é calculado. */
  value: string;
  /** O valor só é conhecido no envio (Host, Content-Length, boundary...). */
  calculated: boolean;
  source: 'body' | 'auth' | 'default' | 'connection';
  /** Nome para `settings.disabledAutoHeaders`; ausente quando não dá para desligar. */
  toggle?: ToggleableAutoHeader;
  disabled: boolean;
  /** Um header da tabela com o mesmo nome toma o lugar deste. */
  overridden: boolean;
}

/**
 * Headers que o envio acrescenta além da tabela, na ordem em que aparecem.
 * `auth` é a autenticação efetiva (com a herança resolvida).
 */
export function automaticHeaders(
  data: RequestData,
  auth: Exclude<Auth, { type: 'inherit' }>,
  options: { userAgent?: string } = {},
): AutoHeader[] {
  const own = new Set(
    data.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => h.key.trim().toLowerCase()),
  );
  const result: AutoHeader[] = [];
  const add = (
    header: Omit<AutoHeader, 'disabled' | 'overridden' | 'calculated'> & { calculated?: boolean },
  ) =>
    result.push({
      calculated: false,
      ...header,
      disabled: header.toggle ? isAutoHeaderDisabled(data, header.toggle) : false,
      overridden: own.has(header.key.toLowerCase()),
    });

  if (auth.type === 'bearer') {
    add({ key: 'Authorization', value: `Bearer ${auth.token.trim()}`, source: 'auth' });
  } else if (auth.type === 'basic') {
    add({ key: 'Authorization', value: 'Basic <usuário:senha em base64>', calculated: true, source: 'auth' });
  } else if (auth.type === 'apikey' && auth.in === 'header' && auth.key.trim() !== '') {
    add({ key: auth.key.trim(), value: auth.value.trim(), source: 'auth' });
  }

  const contentType = bodyContentType(data.body);
  if (contentType) add({ key: 'Content-Type', value: contentType, source: 'body', toggle: 'content-type' });
  else if (data.body.mode === 'formdata') {
    add({
      key: 'Content-Type',
      value: 'multipart/form-data; boundary=<calculado no envio>',
      calculated: true,
      source: 'body',
    });
  }

  for (const [toggle, key, value] of DEFAULT_AUTO_HEADERS) {
    add({
      key,
      value: toggle === 'user-agent' ? (options.userAgent ?? value) : value,
      source: 'default',
      toggle,
    });
  }

  add({ key: 'Host', value: '<calculado no envio>', calculated: true, source: 'connection' });
  if (data.body.mode !== 'none') {
    add({ key: 'Content-Length', value: '<calculado no envio>', calculated: true, source: 'connection' });
  }
  add({ key: 'Connection', value: 'keep-alive', source: 'connection' });
  return result;
}
