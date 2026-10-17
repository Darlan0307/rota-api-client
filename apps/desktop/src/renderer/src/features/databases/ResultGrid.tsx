import { compareCells, type DbQueryResult, type DbValue } from '@rota/core/shared';
import { ArrowDown, ArrowUp, Copy, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';

type Sort = { column: number; dir: 'asc' | 'desc' } | null;

const text = (value: DbValue) => (value === null ? 'NULL' : String(value));

/** BIGINT fora da faixa segura vem como texto, mas continua alinhado como número. */
const NUMERIC_TYPE = /^(SMALLINT|INTEGER|BIGINT|NUMERIC|FLOAT|DOUBLE)/;

/** CSV com ";" (Excel em português); colunas repetidas num JOIN continuam separadas. */
function toCsv(columns: readonly string[], rows: readonly DbValue[][]): string {
  const quote = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const lines = [columns.map(quote).join(';')];
  for (const row of rows) lines.push(row.map((v) => quote(v === null ? '' : String(v))).join(';'));
  return `${lines.join('\r\n')}\r\n`;
}

/** Resultado de uma consulta: ordenar, filtrar, ver o valor completo e exportar para CSV. */
export function ResultGrid({ result, name }: { result: DbQueryResult; name: string }) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = result.rows.map((row, index) => ({ row, index }));
    if (q) list = list.filter(({ row }) => row.some((v) => text(v).toLowerCase().includes(q)));
    if (sort) {
      const factor = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a.row[sort.column];
        const bv = b.row[sort.column];
        if (av === null || bv === null) return compareCells(av, bv);
        return compareCells(av, bv) * factor;
      });
    }
    return list;
  }, [result, filter, sort]);

  const toggleSort = (column: number) =>
    setSort((s) =>
      s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null,
    );

  async function exportCsv() {
    try {
      const path = await api.invoke(
        'export:csv',
        name,
        toCsv(
          result.columns.map((c) => c.name),
          rows.map((r) => r.row),
        ),
      );
      if (path) toast.success(`${rows.length} linhas exportadas para ${path}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const selectedValue = selected ? result.rows[selected.row]?.[selected.column] : undefined;
  const selectedColumn = selected ? result.columns[selected.column] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div className="relative min-w-36 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar linhas"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-primary"
          />
        </div>
        <span className="shrink-0 font-mono text-2xs text-fg-subtle">
          {rows.length === result.rows.length
            ? `${rows.length} linhas`
            : `${rows.length} de ${result.rows.length}`}
          {result.truncated && ' (limite atingido)'} · {result.durationMs} ms
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void exportCsv()}
          title="Exporta as linhas filtradas"
        >
          <Download className="size-3.5" /> CSV
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-right font-normal text-fg-subtle">
                #
              </th>
              {result.columns.map((column, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: colunas podem ter o mesmo nome (JOIN)
                <th key={i} className="border-b border-l border-border p-0 text-left font-medium">
                  <button
                    type="button"
                    title={column.type}
                    onClick={() => toggleSort(i)}
                    className="flex w-full items-center gap-1 px-2.5 py-1.5 text-fg-muted hover:text-fg"
                  >
                    <span className="font-mono">{column.name}</span>
                    {sort?.column === i &&
                      (sort.dir === 'asc' ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, index }) => (
              <tr key={index} className="hover:bg-surface/60">
                <td className="border-b border-border px-2 py-1 text-right font-mono text-2xs text-fg-subtle">
                  {index + 1}
                </td>
                {row.map((value, i) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: posição da coluna
                    key={i}
                    className={cn(
                      'max-w-[22rem] border-b border-l border-border p-0',
                      selected?.row === index &&
                        selected.column === i &&
                        'bg-primary-soft outline outline-1 -outline-offset-1 outline-primary',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected({ row: index, column: i })}
                      className={cn(
                        'block w-full truncate px-2.5 py-1 text-left font-mono',
                        value === null ? 'italic text-fg-subtle' : 'text-fg',
                        (typeof value === 'number' || NUMERIC_TYPE.test(result.columns[i]?.type ?? '')) &&
                          'text-right',
                      )}
                    >
                      {text(value)}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">
            {result.rows.length === 0 ? 'A consulta não retornou linhas.' : 'Nenhuma linha encontrada.'}
          </p>
        )}
      </div>

      {selected && selectedColumn && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-xs">
          <span className="shrink-0 font-mono text-fg-muted">
            {selectedColumn.name} <span className="text-fg-subtle">({selectedColumn.type})</span>
          </span>
          <code
            className="min-w-0 flex-1 select-text truncate font-mono text-fg"
            title={text(selectedValue ?? null)}
          >
            {text(selectedValue ?? null)}
          </code>
          <IconButton
            icon={Copy}
            label="Copiar valor"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(selectedValue === null ? '' : String(selectedValue));
              toast.success('Valor copiado.');
            }}
          />
        </div>
      )}
    </div>
  );
}
