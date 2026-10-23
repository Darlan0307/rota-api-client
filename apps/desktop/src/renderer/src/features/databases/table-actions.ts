import {
  type DbEngine,
  type DbQueryResult,
  type DbTable,
  previewSql,
  tablesToMarkdown,
} from '@rota/core/shared';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../state/toasts';

/** Linhas de exemplo de cada tabela, sem entrar no histórico de consultas. */
export async function sampleTables(
  connectionId: string,
  engine: DbEngine,
  tables: readonly DbTable[],
  rows: number,
): Promise<Record<string, DbQueryResult | null>> {
  const samples: Record<string, DbQueryResult | null> = {};
  // Uma de cada vez: a sessão do banco é uma só.
  for (const table of tables)
    samples[table.name] = await api.invoke(
      'db:run',
      connectionId,
      previewSql(engine, table.ref, rows),
      rows,
      {
        history: false,
      },
    );
  return samples;
}

/** Copia a estrutura (e, se pedido, uma amostra) das tabelas em Markdown, para colar no Claude. */
export async function copyTablesMarkdown(
  connectionId: string,
  engine: DbEngine,
  tables: readonly DbTable[],
  sampleRows = 0,
): Promise<void> {
  try {
    const samples = sampleRows > 0 ? await sampleTables(connectionId, engine, tables, sampleRows) : {};
    await navigator.clipboard.writeText(tablesToMarkdown(engine, tables, samples));
    const what = tables.length === 1 ? `"${tables[0]?.name}"` : `${tables.length} tabelas`;
    toast.success(`Estrutura de ${what} copiada${sampleRows > 0 ? ' com amostra' : ''} em Markdown.`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
