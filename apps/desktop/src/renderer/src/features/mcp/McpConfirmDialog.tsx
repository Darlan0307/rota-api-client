import * as RadixDialog from '@radix-ui/react-dialog';
import { isAutoApprovable, MCP_CATEGORY_INFO } from '@rota/core/shared';
import { AlertTriangle, Bot } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import type { McpConfirmRequest } from '../../../../shared/ipc';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/form';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';

/** Fila de confirmações pedidas pelo Claude (mostradas uma de cada vez). */
const useQueue = create<{ items: McpConfirmRequest[] }>()(() => ({ items: [] }));

function removeFromQueue(id: string) {
  useQueue.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

function answer(id: string, approved: boolean, rememberForSession = false) {
  removeFromQueue(id);
  void api.invoke('mcp:respond', id, approved, rememberForSession);
}

/** Assina os eventos do MCP (uma vez, na inicialização). */
export function subscribeMcpEvents(): void {
  api.on('mcp:confirm', (request) => useQueue.setState((s) => ({ items: [...s.items, request] })));
  api.on('mcp:confirm-timeout', ({ id }) => {
    removeFromQueue(id);
    toast.info('Uma solicitação do Claude expirou sem resposta e foi negada.');
  });
  api.on('mcp:confirm-closed', ({ id }) => removeFromQueue(id));
  api.on('mcp:auto-approved', ({ description }) => toast.info(`Permitido sem perguntar: ${description}`));
  api.on('mcp:notice', ({ message }) => toast.info(`Claude ${message}.`));
}

export function McpConfirmDialog() {
  const items = useQueue((s) => s.items);
  const current = items[0];
  if (!current) return null;
  // A chave zera o "não perguntar de novo" a cada solicitação.
  return <ConfirmContent key={current.id} current={current} waiting={items.length - 1} />;
}

function ConfirmContent({ current, waiting }: { current: McpConfirmRequest; waiting: number }) {
  const [remember, setRemember] = useState(false);
  const category = isAutoApprovable(current.category) ? current.category : null;

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && answer(current.id, false)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[70] bg-black/60 animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-[71] w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-elevated shadow-2xl shadow-black/60 outline-none animate-pop-in',
            current.danger ? 'border-danger/50' : 'border-primary/50',
          )}
        >
          <div className="flex items-start gap-3 p-5">
            <div
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                current.danger ? 'bg-danger/15 text-danger' : 'bg-primary-soft text-primary',
              )}
            >
              {current.danger ? <AlertTriangle className="size-5" /> : <Bot className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Solicitação do Claude (MCP)
              </p>
              <RadixDialog.Title className="mt-1 text-base font-semibold text-fg">
                O Claude quer: {current.title}
              </RadixDialog.Title>
              <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{current.description}</p>
              {current.details.length > 0 && (
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-md bg-bg p-3 font-mono text-xs text-fg">
                  {current.details.map((d, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
                    <li key={i} className="break-all">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {waiting > 0 && (
                <p className="mt-3 text-xs text-fg-subtle">+{waiting} solicitação(ões) aguardando.</p>
              )}
              {category && (
                <div className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
                  <Checkbox checked={remember} onChange={setRemember} label="Não perguntar de novo" />
                  {/* Fora da ordem do Tab: o checkbox ao lado já recebe o foco. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    className="text-left"
                    onClick={() => setRemember(!remember)}
                  >
                    Não perguntar de novo sobre <b className="text-fg">{MCP_CATEGORY_INFO[category].label}</b>{' '}
                    até fechar o Rota (muda em Configurações → Claude)
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            {/* Negar é o foco padrão: Enter não aprova nada por acidente. */}
            <Button autoFocus onClick={() => answer(current.id, false)}>
              Negar
            </Button>
            <Button
              variant={current.danger ? 'danger' : 'primary'}
              onClick={() => answer(current.id, true, remember)}
            >
              Permitir
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
