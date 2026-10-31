import { quoteIdentifier, sqlLiteral, stripSqlLiterals, tableFromSql } from './sql';
import type { DbColumn, DbEngine, DbTable, DbValue } from './types';

/**
 * Monta SELECT, INSERT, UPDATE e DELETE a partir de um formulário, na sintaxe
 * de cada motor. Só gera texto: quem executa é o editor, com as mesmas travas
 * de somente leitura e confirmação de produção de qualquer outro comando.
 */

export type SqlCommandKind = 'select' | 'insert' | 'update' | 'delete';

/** auto: converte pelo tipo da coluna; null: NULL; sql: expressão escrita como está. */
export type SqlValueMode = 'auto' | 'null' | 'sql';

export interface SqlInputValue {
  mode: SqlValueMode;
  text: string;
}

export type SqlOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'contains'
  | 'starts'
  | 'isnull'
  | 'notnull';

export const SQL_OPERATORS: readonly { id: SqlOperator; label: string; needsValue: boolean }[] = [
  { id: 'eq', label: '=', needsValue: true },
  { id: 'ne', label: '≠ (diferente)', needsValue: true },
  { id: 'gt', label: '>', needsValue: true },
  { id: 'ge', label: '≥', needsValue: true },
  { id: 'lt', label: '<', needsValue: true },
  { id: 'le', label: '≤', needsValue: true },
  { id: 'contains', label: 'contém', needsValue: true },
  { id: 'starts', label: 'começa com', needsValue: true },
  { id: 'isnull', label: 'está vazio (NULL)', needsValue: false },
  { id: 'notnull', label: 'não está vazio', needsValue: false },
];

export interface SqlCondition {
  column: string;
  operator: SqlOperator;
  value: string;
}

export interface SqlAssignment {
  column: string;
  value: SqlInputValue;
}

export interface SqlCommandSpec {
  kind: SqlCommandKind;
  table: DbTable;
  /** SELECT: colunas escolhidas (vazio = todas). */
  columns?: readonly string[];
  /** INSERT e UPDATE: valores de cada coluna incluída. */
  values?: readonly SqlAssignment[];
  where?: readonly SqlCondition[];
  orderBy?: { column: string; desc: boolean } | null;
  /** SELECT: limite de linhas (null = sem limite). */
  limit?: number | null;
  /** UPDATE e DELETE: põe antes um SELECT com o mesmo WHERE, para conferir as linhas. */
  withCheck?: boolean;
}

export interface BuiltSql {
  sql: string;
  /** O que o comando faz, em português. */
  explanation: string;
  /** Avisos que não impedem o uso (ex.: coluna obrigatória sem valor). */
  warnings: string[];
  /** Erros que impedem gerar um comando válido (ex.: texto numa coluna numérica). */
  problems: string[];
  /** UPDATE/DELETE sem condição: vale para a tabela inteira. */
  affectsAll: boolean;
}

type ColumnKind = 'number' | 'boolean' | 'other';

const NUMBER_TYPE =
  /^(tiny|small|medium|big)?int|^integer|^numeric|^decimal|^float|^double|^real|^money|^smallmoney|^(big|small)?serial|^number/i;
const BOOLEAN_TYPE = /^(bool|boolean|bit)\b/i;

function columnKind(column: DbColumn | undefined): ColumnKind {
  if (!column) return 'other';
  if (BOOLEAN_TYPE.test(column.type)) return 'boolean';
  if (NUMBER_TYPE.test(column.type)) return 'number';
  return 'other';
}

const TRUE_WORDS = new Set(['true', '1', 'sim', 's', 'verdadeiro']);
const FALSE_WORDS = new Set(['false', '0', 'não', 'nao', 'n', 'falso']);

/** Valor do formulário pronto para o SQL, conforme o tipo da coluna. */
export function literalFor(
  engine: DbEngine,
  column: DbColumn | undefined,
  input: SqlInputValue,
): { sql: string; problem?: string } {
  const name = column?.name ?? 'coluna';
  if (input.mode === 'null') return { sql: 'NULL' };
  if (input.mode === 'sql') {
    const expr = input.text.trim();
    return expr
      ? { sql: expr }
      : { sql: '', problem: `"${name}": escreva a expressão SQL ou troque o modo.` };
  }
  const text = input.text;
  switch (columnKind(column)) {
    case 'number': {
      // Aceita o jeito brasileiro: vírgula decimal ("12,50") e ponto de milhar ("1.234,50").
      const trimmed = text.trim();
      const normalized = /^-?\d{1,3}(\.\d{3})+,\d+$|^-?\d+,\d+$/.test(trimmed)
        ? trimmed.replaceAll('.', '').replace(',', '.')
        : trimmed;
      if (/^-?\d+(\.\d+)?$/.test(normalized)) return { sql: normalized };
      return {
        sql: '',
        problem: normalized
          ? `"${name}" é numérica: "${text}" não é um número.`
          : `"${name}" é numérica: informe um número, use NULL ou tire a coluna.`,
      };
    }
    case 'boolean': {
      const word = text.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { sql: engine === 'postgres' ? 'TRUE' : '1' };
      if (FALSE_WORDS.has(word)) return { sql: engine === 'postgres' ? 'FALSE' : '0' };
      return { sql: '', problem: `"${name}" é sim/não: use true ou false.` };
    }
    default:
      return { sql: sqlLiteral(engine, text) };
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function findColumn(table: DbTable, name: string): DbColumn | undefined {
  return table.columns.find((c) => c.name === name) ?? table.columns.find((c) => sameName(c.name, name));
}

function conditionSql(
  engine: DbEngine,
  table: DbTable,
  condition: SqlCondition,
): { sql: string; text: string; problem?: string } {
  const column = findColumn(table, condition.column);
  const col = quoteIdentifier(engine, condition.column);
  const label = condition.column;
  switch (condition.operator) {
    case 'isnull':
      return { sql: `${col} IS NULL`, text: `${label} está vazio` };
    case 'notnull':
      return { sql: `${col} IS NOT NULL`, text: `${label} não está vazio` };
    case 'contains': {
      const text = `${label} contém "${condition.value}"`;
      if (engine === 'firebird')
        return { sql: `${col} CONTAINING ${sqlLiteral(engine, condition.value)}`, text };
      // ILIKE no Postgres ignora maiúsculas, como o CONTAINING do Firebird e o LIKE dos outros.
      const like = engine === 'postgres' ? 'ILIKE' : 'LIKE';
      return { sql: `${col} ${like} ${sqlLiteral(engine, `%${condition.value}%`)}`, text };
    }
    case 'starts': {
      const text = `${label} começa com "${condition.value}"`;
      if (engine === 'firebird')
        return { sql: `${col} STARTING WITH ${sqlLiteral(engine, condition.value)}`, text };
      const like = engine === 'postgres' ? 'ILIKE' : 'LIKE';
      return { sql: `${col} ${like} ${sqlLiteral(engine, `${condition.value}%`)}`, text };
    }
    default: {
      const op = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }[condition.operator];
      const literal = literalFor(engine, column, { mode: 'auto', text: condition.value });
      return {
        sql: `${col} ${op} ${literal.sql}`,
        text: `${label} ${op === '<>' ? '≠' : op} ${literal.sql}`,
        ...(literal.problem ? { problem: literal.problem } : {}),
      };
    }
  }
}

function whereClause(
  engine: DbEngine,
  table: DbTable,
  conditions: readonly SqlCondition[],
  problems: string[],
): { sql: string; text: string } {
  const parts = conditions
    .filter((c) => c.column)
    .map((c) => {
      const built = conditionSql(engine, table, c);
      if (built.problem) problems.push(built.problem);
      return built;
    });
  if (parts.length === 0) return { sql: '', text: '' };
  return {
    sql: `WHERE ${parts.map((p) => p.sql).join('\n  AND ')}`,
    text: parts.map((p) => p.text).join(' e '),
  };
}

function joinLines(lines: (string | false | undefined)[]): string {
  return lines.filter((l): l is string => Boolean(l)).join('\n');
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Monta o comando do formulário, com explicação e o que impede ou merece atenção. */
export function buildSqlCommand(engine: DbEngine, spec: SqlCommandSpec): BuiltSql {
  const { table } = spec;
  const ref = table.ref;
  const warnings: string[] = [];
  const problems: string[] = [];
  const where = whereClause(engine, table, spec.where ?? [], problems);
  const q = (name: string) => quoteIdentifier(engine, name);

  if (spec.kind === 'select') {
    const columns = spec.columns?.length ? spec.columns.map(q).join(', ') : '*';
    const limit = spec.limit && spec.limit > 0 ? Math.floor(spec.limit) : null;
    const head =
      limit && engine === 'firebird'
        ? `SELECT FIRST ${limit} ${columns}`
        : limit && engine === 'sqlserver'
          ? `SELECT TOP ${limit} ${columns}`
          : `SELECT ${columns}`;
    const order = spec.orderBy?.column
      ? `ORDER BY ${q(spec.orderBy.column)}${spec.orderBy.desc ? ' DESC' : ''}`
      : '';
    const tail = limit && (engine === 'postgres' || engine === 'mysql') ? `LIMIT ${limit}` : '';
    const sql = `${joinLines([head, `FROM ${ref}`, where.sql, order, tail])};`;
    const what = spec.columns?.length ? plural(spec.columns.length, 'coluna', 'colunas') : 'todas as colunas';
    const explanation = joinLines([
      `Busca ${what} de ${table.name}`,
      where.text && ` onde ${where.text}`,
      spec.orderBy?.column &&
        `, em ordem ${spec.orderBy.desc ? 'decrescente' : 'crescente'} de ${spec.orderBy.column}`,
      limit ? `, até ${plural(limit, 'linha', 'linhas')}` : '',
    ]).replaceAll('\n', '');
    return { sql, explanation: `${explanation}.`, warnings, problems, affectsAll: false };
  }

  if (spec.kind === 'insert') {
    const values = (spec.values ?? []).filter((v) => v.column);
    if (values.length === 0) problems.push('Marque pelo menos uma coluna para preencher.');
    const literals = values.map((v) => {
      const built = literalFor(engine, findColumn(table, v.column), v.value);
      if (built.problem) problems.push(built.problem);
      return built.sql;
    });
    const filled = new Set(values.map((v) => v.column.toLowerCase()));
    const missing = table.columns.filter(
      (c) => !c.nullable && c.defaultValue === undefined && !filled.has(c.name.toLowerCase()),
    );
    if (missing.length > 0) {
      warnings.push(
        `${missing.length === 1 ? 'Coluna obrigatória' : 'Colunas obrigatórias'} sem valor: ${missing
          .map((c) => c.name)
          .join(', ')}. O banco recusa, a não ser que um gatilho (trigger) preencha.`,
      );
      if (engine === 'firebird' && missing.some((c) => c.primaryKey))
        warnings.push(
          'No Firebird a chave costuma vir de um generator: use o modo SQL com GEN_ID(NOME_DO_GENERATOR, 1).',
        );
    }
    const sql = joinLines([
      `INSERT INTO ${ref} (${values.map((v) => q(v.column)).join(', ')})`,
      `VALUES (${literals.join(', ')});`,
    ]);
    return {
      sql,
      explanation: `Cria uma linha em ${table.name} com ${plural(values.length, 'campo preenchido', 'campos preenchidos')}.`,
      warnings,
      problems,
      affectsAll: false,
    };
  }

  const affectsAll = where.sql === '';
  const check =
    spec.withCheck && !affectsAll
      ? [
          '-- 1) Confira antes as linhas atingidas (Ctrl+Enter com o cursor aqui):',
          `SELECT * FROM ${ref}`,
          `${where.sql};`,
          '',
          '-- 2) Depois rode o comando:',
        ].join('\n')
      : '';
  if (affectsAll)
    warnings.push(`Sem condição (WHERE): o comando vale para TODAS as linhas de ${table.name}.`);

  if (spec.kind === 'update') {
    const values = (spec.values ?? []).filter((v) => v.column);
    if (values.length === 0) problems.push('Marque pelo menos uma coluna para alterar.');
    const sets = values.map((v) => {
      const built = literalFor(engine, findColumn(table, v.column), v.value);
      if (built.problem) problems.push(built.problem);
      return `${q(v.column)} = ${built.sql}`;
    });
    const command = joinLines([`UPDATE ${ref}`, `SET ${sets.join(',\n    ')}`, where.sql]);
    const fields = values.map((v) => v.column).join(', ');
    return {
      sql: joinLines([check, `${command};`]),
      explanation: affectsAll
        ? `Altera ${fields || 'campos'} em TODAS as linhas de ${table.name}.`
        : `Altera ${fields || 'campos'} em ${table.name} nas linhas em que ${where.text}.`,
      warnings,
      problems,
      affectsAll,
    };
  }

  const command = joinLines([`DELETE FROM ${ref}`, where.sql]);
  return {
    sql: joinLines([check, `${command};`]),
    explanation: affectsAll
      ? `Apaga TODAS as linhas de ${table.name}.`
      : `Apaga de ${table.name} as linhas em que ${where.text}.`,
    warnings,
    problems,
    affectsAll,
  };
}

/** Valor de uma célula do resultado como entrada do formulário. */
export function inputFromValue(value: DbValue): SqlInputValue {
  if (value === null) return { mode: 'null', text: '' };
  if (typeof value === 'boolean') return { mode: 'auto', text: value ? 'true' : 'false' };
  return { mode: 'auto', text: String(value) };
}

/**
 * Condições que identificam uma linha do resultado: pela chave primária quando
 * ela veio na consulta; senão, por todas as colunas (pode pegar mais de uma linha).
 */
export function conditionsForRow(
  table: DbTable,
  resultColumns: readonly string[],
  row: readonly DbValue[],
): { conditions: SqlCondition[]; byPrimaryKey: boolean } {
  const cellOf = (name: string) => {
    const index = resultColumns.findIndex((c) => sameName(c, name));
    return index >= 0 ? { found: true, value: row[index] ?? null } : { found: false, value: null };
  };
  const toCondition = (column: string, value: DbValue): SqlCondition =>
    value === null
      ? { column, operator: 'isnull', value: '' }
      : { column, operator: 'eq', value: inputFromValue(value).text };

  const keys = table.columns.filter((c) => c.primaryKey);
  if (keys.length > 0 && keys.every((k) => cellOf(k.name).found))
    return { conditions: keys.map((k) => toCondition(k.name, cellOf(k.name).value)), byPrimaryKey: true };

  // Binários e textos longos não servem para comparar.
  const comparable = table.columns.filter((c) => !/blob|bytea|binary|image|text|json|xml/i.test(c.type));
  const conditions = comparable
    .filter((c) => cellOf(c.name).found)
    .map((c) => toCondition(c.name, cellOf(c.name).value));
  return { conditions, byPrimaryKey: false };
}

/**
 * Tabela de onde vieram as linhas de um SELECT simples (um FROM, sem JOIN nem
 * agrupamento): só aí faz sentido editar ou excluir uma linha do resultado.
 */
export function editableTableFor(sql: string, tables: readonly DbTable[]): DbTable | undefined {
  const plain = stripSqlLiterals(sql);
  if (/\b(JOIN|GROUP\s+BY|UNION|DISTINCT)\b/i.test(plain) || /\bFROM\s+[^;]*?,/i.test(plain))
    return undefined;
  // Do texto original: a limpeza acima também apaga nomes entre aspas.
  const ref = tableFromSql(sql);
  if (!ref) return undefined;
  const bare = ref.replace(/["`[\]]/g, '').toLowerCase();
  return tables.find(
    (t) => t.kind === 'table' && (t.ref.toLowerCase() === ref.toLowerCase() || t.name.toLowerCase() === bare),
  );
}
