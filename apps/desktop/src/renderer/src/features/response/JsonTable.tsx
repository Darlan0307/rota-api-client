import {
  buildJsonTable,
  cellText,
  compareCells,
  type JsonPath,
  type JsonTableCandidate,
  toCsv,
  VALUE_COLUMN,
  valueAtPath,
} from '@rota/core/shared';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';

/** Acima disso a tabela mostra só as primeiras linhas (o CSV leva todas). */
const MAX_ROWS = 500;

type Sort = { column: string; dir: 'asc' | 'desc' } | null;

/**
 * Lista JSON da resposta como tabela: ordenar pela coluna, filtrar e exportar
 * para CSV. Clicar numa célula seleciona o campo (para copiar ou salvar em variável).
 */
export function JsonTable({
  value,
  tables,
  name,
  selectedPath,
  onSelect,
}: {
  value: unknown;
  tables: JsonTableCandidate[];
  /** Base do nome do arquivo CSV. */
  name: string;
  selectedPath: JsonPath | null;
  onSelect: (path: JsonPath, value: unknown) => void;
}) {
  const [tableIndex, setTableIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  const candidate = tables[tableIndex] ?? tables[0];

  const table = useMemo(() => {
    const items = candidate ? valueAtPath(value, candidate.path) : undefined;
    return buildJsonTable(Array.isArray(items) ? items : []);
  }, [value, candidate]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = table.rows.map((row, index) => ({ row, index }));
    if (q)
      list = list.filter(({ row }) => table.columns.some((c) => cellText(row[c]).toLowerCase().includes(q)));
    if (sort) {
      const factor = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a.row[sort.column];
        const bv = b.row[sort.column];
        // Vazios ficam no fim nas duas direções.
        const empty = (v: unknown) => v === undefined || v === null || v === '';
        if (empty(av) || empty(bv)) return compareCells(av, bv);
        return compareCells(av, bv) * factor;
      });
    }
    return list;
  }, [table, filter, sort]);

  if (!candidate) return null;

  function toggleSort(column: string) {
    setSort((s) =>
      s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null,
    );
  }

  async function exportCsv() {
    try {
      const path = await api.invoke(
        'export:csv',
        name,
        toCsv(
          table.columns,
          rows.map((r) => r.row),
        ),
      );
      if (path) toast.success(`${rows.length} linhas exportadas para ${path}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const cellPath = (index: number, column: string): JsonPath =>
    column === VALUE_COLUMN ? [...candidate.path, index] : [...candidate.path, index, column];
  const isSelected = (index: number, column: string) =>
    selectedPath !== null && cellPath(index, column).join('\u0000') === selectedPath.join('\u0000');
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        {tables.length > 1 && (
          <Select
            ariaLabel="Lista exibida"
            value={String(tableIndex)}
            options={tables.map((t, i) => ({ value: String(i), label: t.label, hint: String(t.count) }))}
            onChange={(v) => {
              setTableIndex(Number(v));
              setSort(null);
            }}
            triggerClassName="max-w-56 font-mono"
          />
        )}
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
          {rows.length === table.rows.length
            ? `${rows.length} linhas`
            : `${rows.length} de ${table.rows.length}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void exportCsv()}
          title="Exporta as linhas filtradas, na ordem atual"
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
              {table.columns.map((column) => (
                <th key={column} className="border-b border-l border-border p-0 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className="flex w-full items-center gap-1 px-2.5 py-1.5 text-fg-muted hover:text-fg"
                  >
                    <span className="font-mono">{column}</span>
                    {sort?.column === column &&
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
            {shown.map(({ row, index }) => (
              <tr key={index} className="hover:bg-surface/60">
                <td className="border-b border-border px-2 py-1 text-right font-mono text-2xs text-fg-subtle">
                  {index}
                </td>
                {table.columns.map((column) => {
                  const cell = row[column];
                  const text = cellText(cell);
                  const nested = cell !== null && typeof cell === 'object';
                  return (
                    <td
                      key={column}
                      className={cn(
                        'max-w-[22rem] border-b border-l border-border p-0',
                        isSelected(index, column) &&
                          'bg-primary-soft outline outline-1 -outline-offset-1 outline-primary',
                      )}
                    >
                      <button
                        type="button"
                        title={text.length > 60 ? text : undefined}
                        onClick={() => onSelect(cellPath(index, column), cell)}
                        className={cn(
                          'block w-full truncate px-2.5 py-1 text-left font-mono',
                          nested || cell === null || cell === undefined ? 'text-fg-subtle' : 'text-fg',
                          typeof cell === 'number' && 'text-right',
                        )}
                      >
                        {text}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > MAX_ROWS && (
          <p className="px-3 py-2 text-2xs text-fg-subtle">
            Mostrando as primeiras {MAX_ROWS} de {rows.length} linhas. Use o filtro ou exporte o CSV para ver
            todas.
          </p>
        )}
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">Nenhuma linha encontrada.</p>
        )}
      </div>
    </div>
  );
}
