import { type DbEngine, type DbQueryResult, type DbTable, type DbValue, engineInfo } from './types';

/** Texto longo numa célula atrapalha a leitura (e gasta contexto da IA à toa). */
const MAX_CELL_CHARS = 80;

function cell(value: DbValue | string | undefined, max = MAX_CELL_CHARS): string {
  if (value === null || value === undefined) return '';
  let text = String(value).replace(/\r?\n|\r/g, ' ');
  if (text.length > max) text = `${text.slice(0, max)}…`;
  return text.replaceAll('|', '\\|');
}

export function resultToMarkdown(
  columns: readonly string[],
  rows: readonly DbValue[][],
  maxCellChars = MAX_CELL_CHARS,
): string {
  if (columns.length === 0) return '';
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(columns.map((c) => cell(c))),
    line(columns.map(() => '---')),
    ...rows.map((row) => line(columns.map((_, i) => cell(row[i], maxCellChars)))),
  ].join('\n');
}

function keyOf(column: DbTable['columns'][number]): string {
  const parts: string[] = [];
  if (column.primaryKey) parts.push('PK');
  if (column.references) parts.push(`FK → ${column.references}`);
  return parts.join(', ');
}

export interface TableMarkdownOptions {
  /** Linhas de exemplo (consulta à própria tabela). */
  sample?: DbQueryResult | null;
}

/** Estrutura de uma tabela (colunas, tipos, chaves) em Markdown. */
export function tableToMarkdown(table: DbTable, options: TableMarkdownOptions = {}): string {
  const out = [`## ${table.kind === 'view' ? 'View' : 'Tabela'} \`${table.name}\``, ''];
  out.push(
    '| Coluna | Tipo | Nulo | Chave | Padrão |',
    '| --- | --- | --- | --- | --- |',
    ...table.columns.map(
      (c) =>
        `| ${cell(c.name)} | ${cell(c.type)} | ${c.nullable ? 'sim' : 'não'} | ${cell(keyOf(c))} | ${cell(c.defaultValue)} |`,
    ),
  );
  const sample = options.sample;
  if (sample && sample.columns.length > 0) {
    const count = sample.rows.length;
    out.push(
      '',
      count === 0
        ? 'Amostra: a tabela está vazia.'
        : `Amostra (${count} ${count === 1 ? 'linha' : 'linhas'}):`,
    );
    if (count > 0)
      out.push(
        '',
        resultToMarkdown(
          sample.columns.map((c) => c.name),
          sample.rows,
        ),
      );
  }
  return out.join('\n');
}

/** Várias tabelas, com uma linha de contexto sobre o banco. */
export function tablesToMarkdown(
  engine: DbEngine,
  tables: readonly DbTable[],
  samples: Readonly<Record<string, DbQueryResult | null>> = {},
): string {
  const header = `Banco ${engineInfo(engine).label} (${tables.length === 1 ? '1 tabela' : `${tables.length} tabelas`}).`;
  return [header, ...tables.map((t) => tableToMarkdown(t, { sample: samples[t.name] ?? null }))].join('\n\n');
}
