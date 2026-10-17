import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Construction, Send } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Kbd } from '../components/Kbd';
import { Tooltip } from '../components/Tooltip';
import { cn } from '../lib/cn';
import { HTTP_METHODS, type HttpMethod, methodTextClass } from '../lib/http-method';
import type { RequestTab } from '../state/ui';

const SUB_TABS = ['Params', 'Autenticação', 'Headers', 'Body', 'Scripts', 'Configurações'] as const;
type SubTab = (typeof SUB_TABS)[number];

export function RequestPane({ tab }: { tab: RequestTab }) {
  const [method, setMethod] = useState<HttpMethod>(tab.method);
  const [subTab, setSubTab] = useState<SubTab>('Params');

  return (
    <section className="flex h-full min-w-0 flex-col bg-bg" aria-label="Requisição">
      <div className="flex items-center gap-2 p-3">
        <div className="flex h-9 min-w-0 flex-1 items-stretch rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-border-strong">
          <MethodSelect value={method} onChange={setMethod} />
          <div className="w-px bg-border" />
          <input
            aria-label="URL"
            spellCheck={false}
            placeholder="Digite a URL ou cole um comando cURL"
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle"
          />
        </div>
        <Tooltip label="Envio disponível na Fase 2" shortcut="Ctrl+Enter">
          <span>
            <Button variant="primary" className="h-9 px-4" disabled>
              <Send className="size-3.5" strokeWidth={2} />
              Enviar
            </Button>
          </span>
        </Tooltip>
      </div>

      <div role="tablist" className="flex gap-4 border-b border-border px-4">
        {SUB_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={subTab === name}
            onClick={() => setSubTab(name)}
            className={cn(
              'relative pb-2 pt-1 text-[13px] transition-colors',
              subTab === name ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {name}
            <span
              className={cn(
                'absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary transition-opacity duration-150',
                subTab === name ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyState
          compact
          icon={Construction}
          title={`${subTab}: em construção`}
          description="Edição de requisições chega na Fase 2."
        />
      </div>
    </section>
  );
}

function MethodSelect({ value, onChange }: { value: HttpMethod; onChange: (m: HttpMethod) => void }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label="Método HTTP"
          className={cn(
            'flex w-[6.5rem] items-center justify-between gap-1 rounded-l-lg pl-3 pr-2 font-mono text-xs font-semibold outline-none hover:bg-surface',
            methodTextClass(value),
          )}
        >
          {value}
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-36 rounded-lg border border-border bg-elevated p-1 shadow-xl shadow-black/40 animate-pop-in"
        >
          {HTTP_METHODS.map((m) => (
            <Dropdown.Item
              key={m}
              onSelect={() => onChange(m)}
              className={cn(
                'cursor-default rounded-md px-2 py-1.5 font-mono text-xs font-semibold outline-none data-[highlighted]:bg-surface-2',
                methodTextClass(m),
              )}
            >
              {m}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function ResponsePane() {
  return (
    <section className="flex h-full min-w-0 flex-col bg-bg" aria-label="Resposta">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">Resposta</h3>
      </div>
      <div className="min-h-0 flex-1">
        <EmptyState
          icon={Send}
          title="Nenhuma resposta ainda"
          description={
            <span className="inline-flex flex-wrap items-center justify-center gap-1">
              Envie a requisição com <Kbd keys="Ctrl+Enter" /> para ver status, tempo, headers e body.
            </span>
          }
        />
      </div>
    </section>
  );
}
