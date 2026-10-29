import type { HistorySummary } from '@rota/core/shared';
import { Bot, FileText, History, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContextActions, type MenuEntry } from '../../components/ActionMenu';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { MethodBadge } from '../../components/MethodBadge';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatBytes, formatDuration, statusTone } from '../../lib/format';
import { confirmDialog } from '../../state/dialogs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { openEvidenceDialog } from '../evidence/EvidenceDialog';

/** Reabre uma entrada do histórico numa aba nova, já com a resposta. */
export async function reopenHistory(id: string): Promise<void> {
  try {
    const entry = await api.invoke('history:get', id);
    if (!entry) {
      toast.error('Esta entrada não existe mais no histórico.');
      return;
    }
    useTabs.getState().openNewRequest({
      title: entry.name,
      parentId: entry.parentId ?? entry.requestId,
      data: entry.data,
      run: { runId: entry.id, status: 'done', startedAt: Date.parse(entry.at), result: entry.result },
    });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export async function clearHistory(): Promise<void> {
  const choice = await confirmDialog({
    title: 'Limpar o histórico?',
    description: 'Todas as requisições enviadas neste workspace serão removidas do histórico.',
    confirmLabel: 'Limpar',
    danger: true,
  });
  if (choice === 'confirm') await api.invoke('history:clear');
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export function HistoryPanel({ filter }: { filter: string }) {
  const [items, setItems] = useState<HistorySummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(150);

  const load = useCallback(async () => {
    try {
      const result = await api.invoke('history:list', filter, limit);
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [filter, limit]);

  useEffect(() => {
    void load();
    return api.on('history:changed', () => void load());
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, HistorySummary[]>();
    for (const item of items ?? []) {
      const label = dayLabel(item.at);
      map.set(label, [...(map.get(label) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  if (items === null) return null;
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title={filter ? 'Nada encontrado' : 'Nenhuma requisição enviada'}
        description={
          filter
            ? `Nenhuma entrada do histórico casa com "${filter}".`
            : 'As requisições que você enviar aparecem aqui, com busca e opção de reabrir.'
        }
      />
    );
  }

  return (
    <div className="px-2">
      {groups.map(([label, entries]) => (
        <section key={label} className="mb-2">
          <h3 className="sticky top-0 z-10 bg-surface px-2 py-1 text-2xs font-medium capitalize text-fg-subtle">
            {label}
          </h3>
          <ul>
            {entries.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {total > items.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 150)}
          className="w-full py-2 text-center text-xs text-primary hover:underline"
        >
          Mostrar mais ({total - items.length})
        </button>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: HistorySummary }) {
  const tone = item.status !== null ? statusTone(item.status) : 'danger';
  const time = new Date(item.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const entries: MenuEntry[] = [
    { label: 'Reabrir', icon: RotateCcw, onSelect: () => void reopenHistory(item.id) },
    {
      label: 'Relatório de evidências',
      icon: FileText,
      onSelect: () => openEvidenceDialog({ historyId: item.id }),
    },
    'separator',
    {
      label: 'Remover do histórico',
      icon: Trash2,
      danger: true,
      onSelect: () => void api.invoke('history:remove', item.id),
    },
  ];

  return (
    <li>
      <ContextActions entries={entries}>
        <button
          type="button"
          onClick={() => void reopenHistory(item.id)}
          title={`${item.method} ${item.url}`}
          className="group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
        >
          <span className="flex w-full items-center gap-1.5">
            <MethodBadge method={item.method} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{item.name}</span>
            {item.source === 'mcp' && (
              <Bot className="size-3 shrink-0 text-fg-subtle" aria-label="Enviada pelo Claude" />
            )}
            <span className="shrink-0 text-2xs text-fg-subtle">{time}</span>
          </span>
          <span className="flex w-full items-center gap-2 pl-[46px] text-2xs">
            <span className="min-w-0 flex-1 truncate font-mono text-fg-subtle">{item.url}</span>
            <span
              className={cn(
                'shrink-0 font-mono font-semibold',
                tone === 'success' && 'text-success',
                tone === 'warning' && 'text-warning',
                tone === 'danger' && 'text-danger',
                tone === 'muted' && 'text-fg-muted',
              )}
            >
              {item.status ?? 'erro'}
            </span>
          </span>
          {item.timeMs !== null && (
            <span className="hidden pl-[46px] text-2xs text-fg-subtle group-hover:block">
              {formatDuration(item.timeMs)} · {formatBytes(item.sizeBytes ?? 0)}
            </span>
          )}
        </button>
      </ContextActions>
    </li>
  );
}

export function HistoryActions() {
  return (
    <>
      <IconButton
        icon={FileText}
        label="Relatório de evidências"
        size="sm"
        onClick={() => openEvidenceDialog()}
      />
      <IconButton icon={Trash2} label="Limpar histórico" size="sm" onClick={() => void clearHistory()} />
    </>
  );
}
