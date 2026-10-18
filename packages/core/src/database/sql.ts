import type { DbEngine } from './types';

/**
 * Utilidades de texto SQL para o editor (sem depender do banco): separar
 * comandos por ";" e descobrir a tabela por trás de um alias.
 */

export interface SqlStatement {
  text: string;
  start: number;
  end: number;
}

/** Comandos separados por ";", ignorando os que estão dentro de textos e comentários. */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const result: SqlStatement[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const text = raw.trim();
    if (text) {
      const offset = raw.indexOf(text);
      result.push({ text, start: start + offset, end: start + offset + text.length });
    }
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      i++;
      while (i < sql.length && !(sql[i] === ch && sql[i + 1] !== ch)) i += sql[i] === ch ? 2 : 1;
      i++;
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 2;
    } else if (ch === ';') {
      push(i);
      start = i + 1;
      i++;
    } else i++;
  }
  push(sql.length);
  return result;
}

/** Comando onde o cursor está (ou o último antes dele, se o cursor estiver depois de um ";"). */
export function statementAt(sql: string, offset: number): SqlStatement | undefined {
  const statements = splitSqlStatements(sql);
  return (
    statements.find((s) => offset >= s.start && offset <= s.end) ??
    [...statements].reverse().find((s) => s.end <= offset) ??
    statements[0]
  );
}

/** Identificador com ou sem aspas: nome, "nome", [nome] ou `nome`. */
const IDENT = '(?:[\\w$#@]+|"[^"]+"|\\[[^\\]]+\\]|`[^`]+`)';
const unquote = (part: string) => part.replace(/^["[`]|["\]`]$/g, '');

/** "vendas"."Pedidos" → vendas.Pedidos (para comparar com os nomes da árvore). */
function plainName(ref: string): string {
  return (ref.match(new RegExp(IDENT, 'g')) ?? []).map(unquote).join('.');
}

const lastPart = (name: string) => name.toUpperCase().split('.').pop() ?? '';

/**
 * Tabela correspondente a um qualificador ("P" em P.ID): o próprio nome da
 * tabela (com ou sem schema) ou um alias declarado em FROM/JOIN.
 */
export function tableForQualifier(
  sql: string,
  qualifier: string,
  tables: readonly string[],
): string | undefined {
  const wanted = qualifier.toUpperCase();
  const byName = tables.find((t) => t.toUpperCase() === wanted) ?? tables.find((t) => lastPart(t) === wanted);
  if (byName) return byName;
  const pattern = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(${IDENT}(?:\\.${IDENT})*)(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
    'gi',
  );
  for (const m of sql.matchAll(pattern)) {
    const table = m[1] ? plainName(m[1]) : '';
    const alias = m[2] ? unquote(m[2]) : '';
    if (!alias || alias.toUpperCase() !== wanted || !table) continue;
    return (
      tables.find((t) => t.toUpperCase() === table.toUpperCase()) ??
      tables.find((t) => lastPart(t) === lastPart(table)) ??
      table
    );
  }
  return undefined;
}

const RESERVED = new Set(
  'ALL AND ANY AS ASC BETWEEN BY CASE CHECK COLUMN CONSTRAINT CREATE CROSS CURRENT DATE DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FOR FOREIGN FROM FULL GROUP HAVING IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OF ON OR ORDER OUTER POSITION PRIMARY REFERENCES RIGHT ROWS SELECT SET TABLE THEN TIME TIMESTAMP TO TOP UNION UNIQUE UPDATE USER USING VALUE VALUES VIEW WHEN WHERE WITH'.split(
    ' ',
  ),
);

/** Nome pronto para o SQL do motor, com aspas só quando precisa. */
export function quoteIdentifier(engine: DbEngine, name: string): string {
  const reserved = RESERVED.has(name.toUpperCase());
  switch (engine) {
    case 'firebird':
      return /^[A-Z][A-Z0-9_$]*$/.test(name) && !reserved ? name : `"${name.replaceAll('"', '""')}"`;
    case 'postgres':
      return /^[a-z_][a-z0-9_$]*$/.test(name) && !reserved ? name : `"${name.replaceAll('"', '""')}"`;
    case 'mysql':
      return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) && !reserved ? name : `\`${name.replaceAll('`', '``')}\``;
    case 'sqlserver':
      return /^[A-Za-z_][A-Za-z0-9_@#$]*$/.test(name) && !reserved ? name : `[${name.replaceAll(']', ']]')}]`;
  }
}

/** Consulta das primeiras linhas de uma tabela, na sintaxe do motor. */
export function previewSql(engine: DbEngine, ref: string, rows = 100): string {
  switch (engine) {
    case 'firebird':
      return `SELECT FIRST ${rows} * FROM ${ref}`;
    case 'sqlserver':
      return `SELECT TOP ${rows} * FROM ${ref}`;
    default:
      return `SELECT * FROM ${ref} LIMIT ${rows}`;
  }
}

/** O comando é uma consulta (não altera dados nem estrutura)? */
export function isReadQuery(sql: string): boolean {
  const text = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  return /^(SELECT|WITH)\b/i.test(text);
}

export const SQL_KEYWORDS = [
  'SELECT',
  'FIRST',
  'SKIP',
  'DISTINCT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'CONTAINING',
  'STARTING WITH',
  'IS NULL',
  'IS NOT NULL',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'ON',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'ASC',
  'DESC',
  'ROWS',
  'LIMIT',
  'OFFSET',
  'TOP',
  'UNION ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'CAST',
  'COALESCE',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'UPPER',
  'LOWER',
  'TRIM',
  'SUBSTRING',
  'EXTRACT',
  'CURRENT_DATE',
  'CURRENT_TIMESTAMP',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
] as const;
