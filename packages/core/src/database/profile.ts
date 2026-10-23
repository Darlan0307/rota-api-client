/**
 * Perfil de uma tabela: por coluna, quanto está preenchido, quantos valores
 * distintos, mínimo/máximo e os valores mais comuns. Só gera o SQL (somente
 * leitura) e interpreta os resultados; quem executa é a sessão do banco.
 */

import { resultToMarkdown } from './describe';
import { quoteIdentifier } from './sql';
import type { DbColumn, DbEngine, DbQueryResult, DbTable, DbValue } from './types';

/** Acima disso o perfil usa as primeiras linhas (contar e agrupar tudo pode pesar no servidor). */
export const PROFILE_SAMPLE = 10_000;
/** Colunas por consulta de agregação (consultas muito largas esbarram em limites de alguns bancos). */
export const PROFILE_BATCH = 20;
export const PROFILE_TOP = 5;

/**
 * "large": só dá para contar preenchidos (BLOB, JSON, XML...: sem DISTINCT
 * nem MIN/MAX em alguns bancos, e valores enormes). "unordered": sem MIN/MAX
 * (booleano, uuid no PostgreSQL).
 */
export type ProfileKind = 'normal' | 'unordered' | 'large';

const LARGE: Record<DbEngine, RegExp> = {
  firebird: /BLOB/i,
  postgres: /^(json|jsonb|xml|bytea|point|line|lseg|box|path|polygon|circle|tsvector|tsquery)\b/i,
  mysql: /blob|binary|json|geometry|point|polygon/i,
  sqlserver: /^(n?text|image|xml|varbinary|binary|geography|geometry|sql_variant|hierarchyid)\b/i,
};

export function profileKind(engine: DbEngine, type: string): ProfileKind {
  if (LARGE[engine].test(type)) return 'large';
  if (/^(bool|boolean|bit)\b/i.test(type) || (engine === 'postgres' && /^uuid\b/i.test(type)))
    return 'unordered';
  return 'normal';
}

export interface ColumnProfile {
  name: string;
  type: string;
  kind: ProfileKind;
  primaryKey: boolean;
  /** Linhas com valor (não nulo). */
  filled: number;
  /** null quando não dá para contar (coluna "large"). */
  distinct: number | null;
  min: DbValue;
  max: DbValue;
  top: { value: DbValue; count: number }[];
}

export interface TableProfile {
  table: string;
  /** Total de linhas da tabela. */
  total: number;
  /** Linhas analisadas (= total, ou a amostra). */
  analyzed: number;
  sampled: boolean;
  columns: ColumnProfile[];
}

export function profileCountSql(table: DbTable): string {
  return `SELECT COUNT(*) AS TOTAL FROM ${table.ref}`;
}

/** Origem das consultas: a tabela inteira ou as primeiras linhas dela. */
export function profileSource(engine: DbEngine, table: DbTable, total: number): string {
  if (total <= PROFILE_SAMPLE) return `${table.ref} p`;
  switch (engine) {
    case 'firebird':
      return `(SELECT FIRST ${PROFILE_SAMPLE} * FROM ${table.ref}) p`;
    case 'sqlserver':
      return `(SELECT TOP ${PROFILE_SAMPLE} * FROM ${table.ref}) p`;
    default:
      return `(SELECT * FROM ${table.ref} LIMIT ${PROFILE_SAMPLE}) p`;
  }
}

/** Uma consulta com os agregados de várias colunas (preenchidos, distintos, mínimo e máximo). */
export function profileAggregateSql(engine: DbEngine, columns: readonly DbColumn[], source: string): string {
  const parts: string[] = [];
  columns.forEach((column, i) => {
    const c = `p.${quoteIdentifier(engine, column.name)}`;
    const kind = profileKind(engine, column.type);
    parts.push(`COUNT(${c}) AS F${i}`);
    if (kind !== 'large') parts.push(`COUNT(DISTINCT ${c}) AS D${i}`);
    if (kind === 'normal') parts.push(`MIN(${c}) AS MN${i}`, `MAX(${c}) AS MX${i}`);
  });
  return `SELECT ${parts.join(', ')} FROM ${source}`;
}

const toCount = (v: DbValue | undefined): number => (v === null || v === undefined ? 0 : Number(v));

/** Lê a linha de agregados na mesma ordem em que `profileAggregateSql` montou as colunas. */
export function parseAggregateRow(
  engine: DbEngine,
  columns: readonly DbColumn[],
  row: readonly DbValue[],
): ColumnProfile[] {
  let at = 0;
  return columns.map((column) => {
    const kind = profileKind(engine, column.type);
    const filled = toCount(row[at++]);
    const distinct = kind === 'large' ? null : toCount(row[at++]);
    const min = kind === 'normal' ? (row[at++] ?? null) : null;
    const max = kind === 'normal' ? (row[at++] ?? null) : null;
    return {
      name: column.name,
      type: column.type,
      kind,
      primaryKey: column.primaryKey,
      filled,
      distinct,
      min,
      max,
      top: [],
    };
  });
}

export function profileTopSql(engine: DbEngine, column: DbColumn, source: string, n = PROFILE_TOP): string {
  const c = `p.${quoteIdentifier(engine, column.name)}`;
  const body = `${c} AS VALOR, COUNT(*) AS QTD FROM ${source} WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY 2 DESC`;
  switch (engine) {
    case 'firebird':
      return `SELECT FIRST ${n} ${body}`;
    case 'sqlserver':
      return `SELECT TOP ${n} ${body}`;
    default:
      return `SELECT ${body} LIMIT ${n}`;
  }
}

/** Vale buscar os mais comuns? Não para colunas únicas, vazias ou que não agrupam. */
export function wantsTop(column: ColumnProfile): boolean {
  return (
    column.kind !== 'large' &&
    column.distinct !== null &&
    column.distinct > 0 &&
    column.distinct < column.filled
  );
}

export function parseTopRows(rows: readonly DbValue[][]): ColumnProfile['top'] {
  return rows.map((r) => ({ value: r[0] ?? null, count: toCount(r[1]) }));
}

// ---------------------------------------------------------------------------
// Texto

function percent(part: number, total: number): string {
  if (total === 0) return '—';
  const value = (part / total) * 100;
  return `${value === 100 || value === 0 ? value.toFixed(0) : value.toFixed(1).replace('.', ',')}%`;
}

export function fillPercent(column: ColumnProfile, analyzed: number): string {
  return percent(column.filled, analyzed);
}

/** Uma linha de resumo da coluna ("sem repetidos", "sempre vazia"...). */
export function columnNote(column: ColumnProfile, analyzed: number): string | null {
  if (analyzed === 0) return null;
  if (column.filled === 0) return 'sempre vazia';
  if (column.distinct !== null && column.distinct === column.filled && column.filled === analyzed)
    return 'sem repetidos';
  if (column.distinct === 1) return 'um valor só';
  return null;
}

function shortValue(value: DbValue): string {
  const text = value === null ? 'NULL' : String(value);
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

export function profileHeadline(profile: TableProfile): string {
  const total = profile.total.toLocaleString('pt-BR');
  return profile.sampled
    ? `amostra das primeiras ${profile.analyzed.toLocaleString('pt-BR')} de ${total} linhas`
    : `${total} ${profile.total === 1 ? 'linha' : 'linhas'}`;
}

export function profileToMarkdown(profile: TableProfile): string {
  const rows = profile.columns.map((c): DbValue[] => {
    const note = columnNote(c, profile.analyzed);
    return [
      `${c.name}${c.primaryKey ? ' (PK)' : ''}`,
      c.type,
      fillPercent(c, profile.analyzed),
      c.distinct === null ? '—' : `${c.distinct}${note ? ` (${note})` : ''}`,
      c.min === null ? '' : shortValue(c.min),
      c.max === null ? '' : shortValue(c.max),
      c.top.map((t) => `${shortValue(t.value)} (${t.count})`).join('; '),
    ];
  });
  return [
    `## Perfil de \`${profile.table}\` (${profileHeadline(profile)})`,
    '',
    resultToMarkdown(
      ['Coluna', 'Tipo', 'Preenchido', 'Distintos', 'Mínimo', 'Máximo', 'Mais comuns'],
      rows,
      200,
    ),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Execução

/** Executa uma consulta (somente leitura) e devolve o resultado. */
export type ProfileRunner = (sql: string, limit: number) => Promise<DbQueryResult>;

export class ProfileCancelled extends Error {
  constructor() {
    super('Perfil cancelado.');
  }
}

/**
 * Monta o perfil: conta as linhas, agrega as colunas em lotes e busca os
 * valores mais comuns de cada uma. Uma consulta por vez (a sessão é uma só).
 * Se um lote falhar (tipo que o banco não agrega), refaz coluna a coluna e,
 * no pior caso, só conta os preenchidos.
 */
export async function profileTable(
  run: ProfileRunner,
  engine: DbEngine,
  table: DbTable,
  options: { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean } = {},
): Promise<TableProfile> {
  const check = () => {
    if (options.isCancelled?.()) throw new ProfileCancelled();
  };
  const count = await run(profileCountSql(table), 1);
  const total = toCount(count.rows[0]?.[0]);
  const source = profileSource(engine, table, total);
  const analyzed = Math.min(total, PROFILE_SAMPLE);

  const batches: DbColumn[][] = [];
  for (let i = 0; i < table.columns.length; i += PROFILE_BATCH)
    batches.push(table.columns.slice(i, i + PROFILE_BATCH));
  const steps = batches.length + table.columns.length;
  let done = 0;
  const progress = () => options.onProgress?.(++done, steps);

  const columns: ColumnProfile[] = [];
  for (const batch of batches) {
    check();
    try {
      const result = await run(profileAggregateSql(engine, batch, source), 1);
      columns.push(...parseAggregateRow(engine, batch, result.rows[0] ?? []));
    } catch (error) {
      if (error instanceof ProfileCancelled) throw error;
      for (const column of batch) {
        check();
        columns.push(await profileOneColumn(run, engine, column, source));
      }
    }
    progress();
  }

  for (const column of columns) {
    check();
    if (wantsTop(column)) {
      const original = table.columns.find((c) => c.name === column.name);
      if (original) {
        const result = await run(profileTopSql(engine, original, source), PROFILE_TOP).catch(() => null);
        if (result) column.top = parseTopRows(result.rows);
      }
    }
    progress();
  }
  return { table: table.name, total, analyzed, sampled: total > PROFILE_SAMPLE, columns };
}

async function profileOneColumn(
  run: ProfileRunner,
  engine: DbEngine,
  column: DbColumn,
  source: string,
): Promise<ColumnProfile> {
  try {
    const result = await run(profileAggregateSql(engine, [column], source), 1);
    return parseAggregateRow(engine, [column], result.rows[0] ?? [])[0] as ColumnProfile;
  } catch {
    // Só a contagem de preenchidos (como uma coluna "large").
    const c = `p.${quoteIdentifier(engine, column.name)}`;
    const result = await run(`SELECT COUNT(${c}) AS F0 FROM ${source}`, 1).catch(() => null);
    return {
      name: column.name,
      type: column.type,
      kind: 'large',
      primaryKey: column.primaryKey,
      filled: toCount(result?.rows[0]?.[0]),
      distinct: null,
      min: null,
      max: null,
      top: [],
    };
  }
}
