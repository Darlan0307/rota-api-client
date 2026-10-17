import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, FolderOpen, Search } from 'lucide-react';
import { APP_NAME, TITLE_BAR_HEIGHT } from '../../../shared/constants';
import { Kbd } from '../components/Kbd';
import { Logo } from '../components/Logo';
import { Tooltip } from '../components/Tooltip';
import { DEMO_ENVIRONMENTS } from '../demo';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/ui';

// Reserva o espaço dos botões nativos do Windows (Window Controls Overlay).
const RIGHT_INSET =
  'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)) + 8px)';

export function TitleBar() {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  return (
    <header
      className="drag-region flex shrink-0 items-center gap-3 border-b border-border bg-surface pl-3"
      style={{ height: TITLE_BAR_HEIGHT, paddingRight: RIGHT_INSET }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Logo size={22} />
        <span className="text-[13px] font-semibold tracking-tight">{APP_NAME}</span>
        <span className="text-fg-subtle">/</span>
        <Tooltip label="Trocar de workspace (Fase 6)">
          <button
            type="button"
            className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <FolderOpen className="size-3.5" strokeWidth={1.75} />
            Workspace padrão
            <ChevronDown className="size-3.5 text-fg-subtle" />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="no-drag flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-xs text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted"
        >
          <Search className="size-3.5" strokeWidth={1.75} />
          <span className="flex-1 text-left">Buscar coleções, requisições e ambientes</span>
          <Kbd keys="Ctrl+P" />
        </button>
      </div>

      <EnvironmentSelector />
    </header>
  );
}

function EnvironmentSelector() {
  const activeId = useUiStore((s) => s.activeEnvironmentId);
  const setActive = useUiStore((s) => s.setActiveEnvironment);
  const selectSection = useUiStore((s) => s.selectSection);
  const active = DEMO_ENVIRONMENTS.find((e) => e.id === activeId);

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="no-drag flex h-7 min-w-44 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-xs transition-colors hover:border-border-strong data-[state=open]:border-border-strong"
        >
          <span
            className={cn('size-1.5 rounded-full', active ? 'bg-primary' : 'bg-fg-subtle')}
            aria-hidden="true"
          />
          <span className={cn('flex-1 truncate text-left', active ? 'text-fg' : 'text-fg-muted')}>
            {active?.name ?? 'Sem ambiente'}
          </span>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-xl shadow-black/40 animate-pop-in"
        >
          <Dropdown.Label className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
            Ambiente ativo
          </Dropdown.Label>
          {[{ id: null, name: 'Sem ambiente' }, ...DEMO_ENVIRONMENTS].map((env) => (
            <Dropdown.Item
              key={env.id ?? 'none'}
              onSelect={() => setActive(env.id)}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
            >
              <Check
                className={cn('size-3.5 text-primary', env.id !== activeId && 'invisible')}
                strokeWidth={2}
              />
              <span className={env.id ? 'text-fg' : 'text-fg-muted'}>{env.name}</span>
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-border" />
          <Dropdown.Item
            onSelect={() => selectSection('environments')}
            className="cursor-default rounded-md px-2 py-1.5 pl-[30px] text-fg-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg"
          >
            Gerenciar ambientes
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
