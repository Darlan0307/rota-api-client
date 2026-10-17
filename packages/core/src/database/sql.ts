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

/**
 * Tabela correspondente a um qualificador ("P" em P.ID): o próprio nome da
 * tabela ou um alias declarado em FROM/JOIN.
 */
export function tableForQualifier(
  sql: string,
  qualifier: string,
  tables: readonly string[],
): string | undefined {
  const wanted = qualifier.toUpperCase();
  const byName = tables.find((t) => t.toUpperCase() === wanted);
  if (byName) return byName;
  const pattern = /\b(?:FROM|JOIN)\s+("?[\w$]+"?)(?:\s+(?:AS\s+)?("?[\w$]+"?))?/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = match[1]?.replaceAll('"', '');
    const alias = match[2]?.replaceAll('"', '');
    if (alias && alias.toUpperCase() === wanted && table) {
      return tables.find((t) => t.toUpperCase() === table.toUpperCase()) ?? table;
    }
  }
  return undefined;
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
