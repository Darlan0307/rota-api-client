import * as Popover from '@radix-ui/react-popover';
import type { DbHistoryEntry } from '@rota/core/shared';
import { History, Play, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function outcome(e: DbHistoryEntry): string {
  if (e.error) return 'erro';
  if (e.affected !== undefined) return `${e.affected} afetada${e.affected === 1 ? '' : 's'}`;
  return `${e.rows ?? 0} linha${e.rows === 1 ? '' : 's'}`;
}

/** Consultas já executadas nesta conexão: clicar põe no editor; ▶ executa de novo. */
export function QueryHistory({
  connectionId,
  onPick,
  onRun,
}: {
  connectionId: string;
  onPick: (sql: string) => void;
  onRun: (sql: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DbHistoryEntry[] | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    try {
      setEntries(await api.invoke('db:history', connectionId));
    } catch (error) {
      toast.error(errorMessage(error));
      setEntries([]);
    }
  }

  async function clear() {
    const choice = await confirmDialog({
      title: 'Limpar o histórico desta conexão?',
      description: 'As consultas salvas aqui são apagadas. O banco não é alterado.',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (choice !== 'confirm') return;
    await api.invoke('db:clearHistory', connectionId).catch((e: unknown) => toast.error(errorMessage(e)));
    setEntries([]);
  }

  const q = filter.trim().toLowerCase();
  const list = (entries ?? []).filter((e) => !q || e.sql.toLowerCase().includes(q));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFilter('');
          void load();
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" title="Consultas já executadas nesta conexão">
          <History className="size-3.5" /> Histórico
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 flex max-h-[min(480px,70vh)] w-[min(560px,calc(100vw-32px))] flex-col rounded-lg border border-border bg-elevated text-xs shadow-xl shadow-black/40 animate-pop-in"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar no histórico"
                spellCheck={false}
                className="h-7 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary"
              />
            </div>
            {(entries?.length ?? 0) > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void clear()}>
                Limpar
              </Button>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {entries === null && <li className="px-3 py-4 text-center text-fg-subtle">Carregando…</li>}
            {entries !== null && list.length === 0 && (
              <li className="px-3 py-6 text-center text-fg-subtle">
                {entries.length === 0
                  ? 'Nenhuma consulta executada ainda nesta conexão.'
                  : 'Nada encontrado.'}
              </li>
            )}
            {list.map((entry) => (
              <li key={entry.id} className="group flex items-start gap-2 px-2 hover:bg-surface-2/60">
                <button
                  type="button"
                  title={`${entry.sql}${entry.error ? `\n\n${entry.error}` : ''}\n\nClique para colocar no editor`}
                  onClick={() => {
                    onPick(entry.sql);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 py-1.5 text-left"
                >
                  <span className="block truncate font-mono text-fg">{entry.sql.replace(/\s+/g, ' ')}</span>
                  <span className="flex gap-2 text-2xs text-fg-subtle">
                    <span>{when(entry.at)}</span>
                    <span className={cn(entry.error && 'text-danger')}>{outcome(entry)}</span>
                    <span>{entry.durationMs} ms</span>
                  </span>
                </button>
                <IconButton
                  icon={Play}
                  label="Executar de novo"
                  size="sm"
                  className="mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => {
                    onRun(entry.sql);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
