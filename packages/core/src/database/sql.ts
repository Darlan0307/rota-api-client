import type { DbEngine, DbValue } from './types';

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

/**
 * Tira comentários e textos entre aspas para procurar palavras do comando.
 * Percorre o texto uma vez só: o que vem primeiro (comentário ou texto) manda,
 * senão '--' dentro de um texto esconderia o resto do comando. Com `mysql`,
 * segue as regras dele: \' dentro de textos, # como comentário, "-- " só com
 * espaço e /*! ... *\/ executado como código.
 */
export function stripSqlLiterals(sql: string, mysql = false): string {
  let out = '';
  let i = 0;
  const skipLine = () => {
    while (i < sql.length && sql[i] !== '\n') i++;
    out += ' ';
  };
  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    if (ch === '-' && next === '-' && (!mysql || /^\s?$/.test(sql[i + 2] ?? ''))) skipLine();
    else if (mysql && ch === '#') skipLine();
    else if (ch === '/' && next === '*' && !(mysql && sql[i + 2] === '!')) {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 2;
      out += ' ';
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (mysql && ch !== '`' && sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j++;
      }
      out += ch + ch;
      i = j + 1;
    } else if (ch === '[') {
      const close = sql.indexOf(']', i + 1);
      out += '[]';
      i = close < 0 ? sql.length : close + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const READ_START = /^\s*\(*\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|VALUES|TABLE)\b/i;

/** Palavras que alteram dados, estrutura ou permissões (ou executam código). */
const WRITE_WORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE\s+INTO|DROP|ALTER|CREATE|TRUNCATE|RENAME|GRANT|REVOKE|DENY|EXEC|EXECUTE|CALL|DO|COPY|LOAD|IMPORT|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL|VACUUM|REINDEX|CLUSTER|LOCK|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|SET\s+TRANSACTION|COMMIT|ROLLBACK|BEGIN|SAVEPOINT|nextval|setval)\b|\b(sp|xp)_\w+/i;

/**
 * Motivo para recusar um comando numa conexão somente leitura (null = pode).
 * Camada extra além da transação READ ONLY do banco, e a única proteção do
 * lado do Rota no SQL Server, que não tem transação somente leitura.
 */
export function readOnlyViolation(sql: string): string | null {
  // Lido como SQL padrão e como MySQL: o que um trata como texto ou comentário
  // o outro pode executar (ex.: '\'' ou #), então os dois precisam passar.
  for (const text of [stripSqlLiterals(sql), stripSqlLiterals(sql, true)]) {
    if (!READ_START.test(text))
      return 'Esta conexão é somente leitura: só consultas (SELECT, WITH, SHOW, EXPLAIN) são permitidas.';
    const word = WRITE_WORDS.exec(text)?.[0];
    if (word)
      return `Esta conexão é somente leitura: "${word.toUpperCase()}" não é permitido aqui (pode alterar o banco).`;
  }
  return null;
}

/** O comando é uma consulta (não altera dados nem estrutura)? */
export function isReadQuery(sql: string): boolean {
  return readOnlyViolation(sql) === null;
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

// ---------------------------------------------------------------------------
// Copiar resultados

/** Tabela do primeiro FROM do comando (para montar INSERTs a partir de um SELECT). */
export function tableFromSql(sql: string): string | undefined {
  const match = new RegExp(`\\bFROM\\s+(${IDENT}(?:\\.${IDENT})*)`, 'i').exec(sql);
  return match?.[1];
}

/** Nomes repetidos (JOIN) ganham sufixo: ID, ID_2. */
function uniqueNames(columns: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

export function resultToJson(columns: readonly string[], rows: readonly DbValue[][]): string {
  const names = uniqueNames(columns);
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(names.map((name, i) => [name, row[i] ?? null]))),
    null,
    2,
  );
}

/** Separado por tabulação: cola direto em colunas no Excel ou no Google Planilhas. */
export function resultToTsv(columns: readonly string[], rows: readonly DbValue[][]): string {
  const cell = (v: DbValue) => (v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
  return [columns.map((c) => cell(c)).join('\t'), ...rows.map((row) => row.map(cell).join('\t'))].join('\n');
}

/** Valor pronto para o SQL do motor (texto entre aspas, N prefixado no SQL Server). */
export function sqlLiteral(engine: DbEngine, value: DbValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean')
    return engine === 'postgres' ? String(value).toUpperCase() : value ? '1' : '0';
  const text = String(value);
  // Binário vem como 0x...; no Postgres o literal é '\x...'.
  if (/^0x[0-9A-F]+$/.test(text)) return engine === 'postgres' ? `'\\x${text.slice(2)}'` : text;
  // Texto com acento no SQL Server precisa do prefixo N (Unicode).
  const unicode = engine === 'sqlserver' && [...text].some((ch) => (ch.codePointAt(0) ?? 0) > 127);
  return `${unicode ? 'N' : ''}'${text.replaceAll("'", "''")}'`;
}

/** Um INSERT por linha, na sintaxe do motor. */
export function resultToInserts(
  engine: DbEngine,
  table: string,
  columns: readonly string[],
  rows: readonly DbValue[][],
): string {
  const cols = columns.map((c) => quoteIdentifier(engine, c)).join(', ');
  return rows
    .map(
      (row) => `INSERT INTO ${table} (${cols}) VALUES (${row.map((v) => sqlLiteral(engine, v)).join(', ')});`,
    )
    .join('\n');
}
