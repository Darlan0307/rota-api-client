import { formatJsonPath, type JsonPath } from './json-path';

/**
 * Visualização em tabela de listas JSON: encontra as listas de objetos da
 * resposta (na raiz ou em campos como `data.items`) e monta colunas e linhas.
 */

export interface JsonTableCandidate {
  path: JsonPath;
  label: string;
  count: number;
}

/** Coluna usada quando os itens da lista não são objetos. */
export const VALUE_COLUMN = '(valor)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Lista que vale mostrar como tabela: não vazia e com maioria de objetos. */
function isTableLike(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const sample = value.slice(0, 50);
  return sample.filter(isRecord).length >= sample.length / 2;
}

export function findJsonTables(value: unknown, maxDepth = 3): JsonTableCandidate[] {
  const found: JsonTableCandidate[] = [];
  function visit(node: unknown, path: JsonPath, depth: number) {
    if (isTableLike(node)) {
      found.push({ path, label: formatJsonPath(path), count: node.length });
      return;
    }
    if (depth >= maxDepth || !isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) visit(child, [...path, key], depth + 1);
  }
  visit(value, [], 0);
  // As maiores primeiro (normalmente a lista principal da resposta).
  return found.sort((a, b) => b.count - a.count);
}

export interface JsonTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function buildJsonTable(items: readonly unknown[]): JsonTable {
  const columns = new Set<string>();
  const rows = items.map((item) => {
    if (isRecord(item)) {
      for (const key of Object.keys(item)) columns.add(key);
      return item;
    }
    columns.add(VALUE_COLUMN);
    return { [VALUE_COLUMN]: item };
  });
  return { columns: [...columns], rows };
}

/** Texto curto de uma célula: objetos e listas em JSON compacto. */
export function cellText(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Ordenação de células: números como números, vazios sempre no fim. */
export function compareCells(a: unknown, b: unknown): number {
  const emptyA = a === undefined || a === null || a === '';
  const emptyB = b === undefined || b === null || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(cellText(a), cellText(b));
}

/**
 * CSV com ";" (o Excel em português usa a vírgula como separador decimal).
 * O BOM fica a cargo de quem grava o arquivo.
 */
export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
  separator = ';',
): string {
  const quote = (text: string) =>
    text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  const lines = [columns.map(quote).join(separator)];
  for (const row of rows) lines.push(columns.map((c) => quote(cellText(row[c]))).join(separator));
  return `${lines.join('\r\n')}\r\n`;
}
