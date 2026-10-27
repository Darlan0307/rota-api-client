/**
 * Pacote de contexto: junta requisições (com a última resposta), estrutura de
 * tabelas, perfis, webhooks e notas num Markdown só, para entregar ao Claude
 * Code (copiando ou salvando na pasta do projeto). Montado à mão pelo usuário:
 * nada disso passa pelo MCP.
 */

import { tableToMarkdown } from '../database/describe';
import { profileToMarkdown, type TableProfile } from '../database/profile';
import { type DbEngine, type DbQueryResult, type DbTable, engineInfo } from '../database/types';
import type { HttpMethod } from '../model/schemas';
import { parseJsonLossless } from '../util/json-format';

export interface PackResponse {
  status: number;
  statusText: string;
  timeMs?: number;
  contentType?: string;
  body: string;
}

export type ContextItem =
  | {
      kind: 'request';
      id: string;
      title: string;
      method: HttpMethod;
      /** URL como no editor (com {{variáveis}}). */
      url: string;
      headers: { key: string; value: string }[];
      body?: string;
      response?: PackResponse;
      /** Para mascarar os segredos das variáveis desta requisição. */
      requestId?: string;
    }
  | {
      kind: 'table';
      id: string;
      title: string;
      engine: DbEngine;
      table: DbTable;
      sample?: DbQueryResult | null;
    }
  | { kind: 'profile'; id: string; title: string; profile: TableProfile }
  | { kind: 'webhook'; id: string; title: string; provider?: string; path?: string; body: string }
  | { kind: 'note'; id: string; title: string; text: string };

export type ContextItemKind = ContextItem['kind'];

export const CONTEXT_KIND_LABELS: Record<ContextItemKind, string> = {
  request: 'Requisição',
  table: 'Tabela',
  profile: 'Perfil',
  webhook: 'Webhook',
  note: 'Nota',
};

/** Corpo grande vira ruído para a IA: listas longas ficam com os primeiros itens. */
export const PACK_MAX_ITEMS = 3;
export const PACK_MAX_CHARS = 8000;

const SENSITIVE_HEADER = /authorization|token|api[-_]?key|secret|senha|password|cookie|signature|assinatura/i;
const ONLY_VARIABLE = /^\s*(Bearer\s+|Basic\s+)?\{\{[^{}]+\}\}\s*$/i;

/** Valor de header digitado direto (não {{variável}}) em header sensível vira "••••••". */
export function maskHeaderValue(key: string, value: string): string {
  if (!SENSITIVE_HEADER.test(key) || ONLY_VARIABLE.test(value)) return value;
  const scheme = /^(Bearer|Basic)\s+/i.exec(value)?.[0] ?? '';
  return `${scheme}••••••`;
}

/** Encurta listas dentro do JSON (mantém os primeiros itens e diz quantos ficaram de fora). */
export function trimJson(value: unknown, maxItems = PACK_MAX_ITEMS): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, maxItems).map((v) => trimJson(v, maxItems));
    return value.length > maxItems ? [...head, `… mais ${value.length - maxItems} itens`] : head;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimJson(v, maxItems)]));
  return value;
}

function fence(text: string, language = ''): string {
  // Cerca maior que qualquer sequência de crases do conteúdo.
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}${language}\n${text}\n${marks}`;
}

/** Corpo legível: JSON formatado e encurtado; texto cortado no limite. */
export function bodyForPack(text: string, contentType = ''): { text: string; language: string } {
  const trimmed = text.trim();
  if (/json/i.test(contentType) || /^[[{]/.test(trimmed)) {
    try {
      const pretty = JSON.stringify(trimJson(parseJsonLossless(trimmed)), null, 2);
      return { text: cut(pretty), language: 'json' };
    } catch {
      // Não é JSON de verdade (ou tem {{variáveis}} sem aspas): segue como texto.
      if (trimmed.includes('{{')) return { text: cut(trimmed), language: 'json' };
    }
  }
  if (/xml|html/i.test(contentType) || trimmed.startsWith('<'))
    return { text: cut(trimmed), language: 'xml' };
  return { text: cut(trimmed), language: '' };
}

function cut(text: string): string {
  return text.length > PACK_MAX_CHARS
    ? `${text.slice(0, PACK_MAX_CHARS)}\n… (cortado: ${text.length - PACK_MAX_CHARS} caracteres a mais)`
    : text;
}

function renderRequest(item: Extract<ContextItem, { kind: 'request' }>): string {
  const out = [`## Requisição: ${item.title}`, '', fence(`${item.method} ${item.url}`)];
  if (item.headers.length > 0) {
    out.push('', 'Headers:', '');
    for (const h of item.headers) out.push(`- \`${h.key}: ${maskHeaderValue(h.key, h.value)}\``);
  }
  if (item.body?.trim()) {
    const body = bodyForPack(item.body);
    out.push('', 'Corpo enviado:', '', fence(body.text, body.language));
  }
  const r = item.response;
  if (r) {
    const time = r.timeMs !== undefined ? `, ${Math.round(r.timeMs)} ms` : '';
    out.push('', `Resposta: ${r.status} ${r.statusText}${time}${r.contentType ? ` (${r.contentType})` : ''}`);
    if (r.body.trim()) {
      const body = bodyForPack(r.body, r.contentType);
      out.push('', fence(body.text, body.language));
    }
  }
  return out.join('\n');
}

function renderItem(item: ContextItem): string {
  switch (item.kind) {
    case 'request':
      return renderRequest(item);
    case 'table':
      return `${tableToMarkdown(item.table, { sample: item.sample ?? null })}\n\n(Banco ${engineInfo(item.engine).label}.)`;
    case 'profile':
      return profileToMarkdown(item.profile);
    case 'webhook': {
      const body = bodyForPack(item.body);
      const where = [item.provider, item.path].filter(Boolean).join(' · ');
      return [
        `## Webhook: ${item.title}`,
        ...(where ? ['', where] : []),
        '',
        fence(body.text, body.language),
      ].join('\n');
    }
    case 'note':
      return [`## ${item.title}`, '', item.text.trim()].join('\n');
  }
}

/** O Markdown final do pacote, na ordem dos itens. */
export function renderContextPack(items: readonly ContextItem[], title = 'Contexto do Rota'): string {
  const header = [
    `# ${title}`,
    '',
    'Gerado pelo Rota. Variáveis aparecem como {{nome}}; valores secretos foram trocados por ••••••.',
  ].join('\n');
  return `${[header, ...items.map(renderItem)].join('\n\n')}\n`;
}
