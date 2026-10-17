export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const METHOD_TEXT_CLASS: Record<HttpMethod, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

export function methodTextClass(method: HttpMethod): string {
  return METHOD_TEXT_CLASS[method];
}

/** Rótulo curto para espaços estreitos (sidebar, abas). */
export function methodShortLabel(method: HttpMethod): string {
  if (method === 'DELETE') return 'DEL';
  if (method === 'OPTIONS') return 'OPT';
  return method;
}
