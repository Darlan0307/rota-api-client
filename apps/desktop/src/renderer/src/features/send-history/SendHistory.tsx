import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { HistorySummary } from '@rota/core/shared';
import { ArrowLeft, GitCompare, History, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { ToolbarLabel } from '../../components/ToolbarLabel';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatBytes, formatDateTime, formatDuration, formatRelative, statusTone } from '../../lib/format';
import { type RequestTab, useTabs } from '../../state/tabs';
import { toast, useToasts } from '../../state/toasts';
import { setCompareSource } from '../compare/ResponseCompare';

const LIMIT = 20;

function getRequestTab(tabId: string): RequestTab | undefined {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  return tab?.kind === 'request' ? tab : undefined;
}

/** Mostra um envio anterior na resposta (testes, console e contrato vão junto). */
async function viewEntry(tabId: string, historyId: string): Promise<void> {
  try {
    const entry = await api.invoke('history:get', historyId);
    if (!entry) {
      toast.info('Esse envio não está mais no histórico.');
      return;
    }
    useTabs.getState().update<RequestTab>(tabId, (t) => {
      if (t.run?.status === 'sending') return t;
      const latest = t.run?.viewing ? t.run.viewing.latest : t.run?.result;
      return {
        ...t,
        run: {
          runId: t.run?.runId ?? crypto.randomUUID(),
          status: 'done',
          startedAt: Date.parse(entry.at),
          result: entry.result,
          viewing: {
            historyId: entry.id,
            at: entry.at,
            source: entry.source,
            data: entry.data,
            ...(latest ? { latest } : {}),
          },
        },
      };
    });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

/** Volta para a resposta mais recente (ou limpa, se não havia nenhuma). */
function backToLatest(tabId: string): void {
  useTabs.getState().update<RequestTab>(tabId, (t) => {
    const latest = t.run?.viewing?.latest;
    if (!t.run?.viewing) return t;
    return {
      ...t,
      run: latest ? { runId: t.run.runId, status: 'done', startedAt: Date.now(), result: latest } : null,
    };
  });
}

function restoreRequest(tabId: string): void {
  const tab = getRequestTab(tabId);
  const viewing = tab?.run?.viewing;
  if (!tab || !viewing) return;
  const previous = tab.draft;
  useTabs.getState().update<RequestTab>(tabId, (t) => ({ ...t, draft: viewing.data }));
  useToasts
    .getState()
    .push('success', `Requisição restaurada como estava em ${formatDateTime(viewing.at)}.`, {
      action: {
        label: 'Desfazer',
        run: () => useTabs.getState().update<RequestTab>(tabId, (t) => ({ ...t, draft: previous })),
      },
      duration: 8000,
    });
}

function compareWithLatest(tabId: string): void {
  const historyId = getRequestTab(tabId)?.run?.viewing?.historyId;
  if (!historyId) return;
  backToLatest(tabId);
  setCompareSource(tabId, `history:${historyId}`);
  useTabs.getState().update<RequestTab>(tabId, (t) => ({ ...t, responseSection: 'compare' }));
}

/** Botão "Envios" no cabeçalho da resposta: os últimos envios desta requisição. */
export function SendHistoryButton({ tab }: { tab: RequestTab }) {
  const [items, setItems] = useState<HistorySummary[] | null>(null);
  if (!tab.itemId) return null;
  const itemId = tab.itemId;
  const viewingId = tab.run?.viewing?.historyId;

  const load = () => {
    setItems(null);
    api
      .invoke('history:list', '', LIMIT, itemId)
      .then(({ items: list }) => setItems(list))
      .catch(() => setItems([]));
  };

  return (
    <Dropdown.Root onOpenChange={(open) => open && load()}>
      <Dropdown.Trigger asChild>
        <Button size="sm" variant="ghost" title="Envios anteriores desta requisição">
          <History className="size-3.5" />
          <ToolbarLabel bar="resposta">Envios</ToolbarLabel>
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={4}
          className="z-50 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-xl shadow-black/40 animate-pop-in"
        >
          <p className="px-2 pt-1 pb-1.5 text-2xs text-fg-subtle">
            Últimos {LIMIT} envios desta requisição (o histórico guarda os 500 mais recentes do workspace).
          </p>
          {items === null ? (
            <div className="flex justify-center py-4">
              <LoaderCircle className="size-4 animate-spin text-fg-muted" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-muted">Nenhum envio registrado ainda.</p>
          ) : (
            items.map((h) => {
              const tone = h.status === null ? 'danger' : statusTone(h.status);
              return (
                <Dropdown.Item
                  key={h.id}
                  onSelect={() => void viewEntry(tab.id, h.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2',
                    viewingId === h.id && 'bg-primary-soft',
                  )}
                >
                  <span
                    className={cn(
                      'w-9 shrink-0 font-mono text-xs font-semibold',
                      tone === 'success' && 'text-success',
                      tone === 'warning' && 'text-warning',
                      tone === 'danger' && 'text-danger',
                      tone === 'muted' && 'text-fg-muted',
                    )}
                  >
                    {h.status ?? 'erro'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg" title={formatDateTime(h.at)}>
                    {formatRelative(h.at)}
                  </span>
                  {h.source === 'mcp' && (
                    <span title="Enviado pelo Claude">
                      <Sparkles className="size-3 text-primary" />
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-2xs text-fg-muted">
                    {h.timeMs !== null ? formatDuration(h.timeMs) : ''}
                    {h.sizeBytes !== null ? ` · ${formatBytes(h.sizeBytes)}` : ''}
                  </span>
                </Dropdown.Item>
              );
            })
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Faixa acima da resposta enquanto um envio anterior está sendo exibido. */
export function SendHistoryBanner({ tab }: { tab: RequestTab }) {
  const viewing = tab.run?.viewing;
  if (!viewing || tab.run?.status === 'sending') return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary/30 bg-primary-soft px-4 py-1.5 text-xs">
      <History className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-fg" title={formatDateTime(viewing.at)}>
        Envio de <strong className="font-medium">{formatRelative(viewing.at)}</strong>
        {viewing.source === 'mcp' ? ' (pelo Claude)' : ''}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => restoreRequest(tab.id)}
        title="Restaurar requisição: coloca no editor a URL, headers e corpo usados nesse envio"
      >
        <RotateCcw className="size-3.5" /> Restaurar
      </Button>
      {viewing.latest?.response && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => compareWithLatest(tab.id)}
          title="Comparar este envio com a resposta mais recente"
        >
          <GitCompare className="size-3.5" /> Comparar
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => backToLatest(tab.id)}
        title={viewing.latest ? 'Voltar à resposta mais recente' : 'Fechar este envio'}
      >
        <ArrowLeft className="size-3.5" /> {viewing.latest ? 'Voltar' : 'Fechar'}
      </Button>
    </div>
  );
}
