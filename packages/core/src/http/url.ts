import type { KeyValue } from '../model/schemas';

/**
 * A requisição guarda a URL sem a query (`url`) e os parâmetros em `query`,
 * incluindo os desabilitados. Na UI o campo de URL mostra os dois juntos.
 */

export interface SplitUrl {
  url: string;
  query: KeyValue[];
}

/** Separa "https://x/y?a=1&b" em base + lista de parâmetros (sem decodificar). */
export function splitUrl(full: string): SplitUrl {
  const hashIndex = full.indexOf('#');
  const withoutHash = hashIndex >= 0 ? full.slice(0, hashIndex) : full;
  const qIndex = withoutHash.indexOf('?');
  if (qIndex < 0) return { url: withoutHash, query: [] };

  const query = withoutHash
    .slice(qIndex + 1)
    .split('&')
    .filter((part) => part !== '')
    .map((part): KeyValue => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { key: part, value: '', enabled: true }
        : { key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true };
    });
  return { url: withoutHash.slice(0, qIndex), query };
}

/** Monta a URL exibida/enviada: base + parâmetros habilitados. */
export function composeUrl(url: string, query: readonly KeyValue[]): string {
  const parts = query
    .filter((p) => p.enabled && p.key !== '')
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`));
  return parts.length ? `${url}?${parts.join('&')}` : url;
}

/**
 * Aplica um texto de URL digitado pelo usuário mantendo os parâmetros
 * desabilitados (que não aparecem no texto) e descrições existentes.
 */
export function applyUrlText(full: string, previous: readonly KeyValue[]): SplitUrl {
  const { url, query } = splitUrl(full);
  const disabled = previous.filter((p) => !p.enabled);
  const enabledPrev = previous.filter((p) => p.enabled);
  const merged = query.map((p, i) => {
    const prev = enabledPrev[i];
    return prev?.description && prev.key === p.key ? { ...p, description: prev.description } : p;
  });
  return { url, query: [...merged, ...disabled] };
}

/** Garante um protocolo: "api.com/x" vira "http://api.com/x" (como o Postman). */
export function ensureProtocol(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  return `http://${url}`;
}
