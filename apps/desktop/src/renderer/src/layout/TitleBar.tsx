import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, FolderOpen, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_NAME, TITLE_BAR_HEIGHT } from '../../../shared/constants';
import { Kbd } from '../components/Kbd';
import { Logo } from '../components/Logo';
import { Tooltip } from '../components/Tooltip';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useTabs } from '../state/tabs';
import { useUiStore } from '../state/ui';
import { useActiveEnvironmentId, useSnapshot, useWorkspace } from '../state/workspace';

// Reserva o espaço dos botões nativos do Windows (Window Controls Overlay).
const RIGHT_INSET =
  'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)) + 8px)';

/** O seletor de workspace é preenchido na Fase 6 (workspaces de projeto). */
let workspaceMenu: (() => ReactNode) | undefined;
export function registerWorkspaceMenu(render: () => ReactNode): void {
  workspaceMenu = render;
}

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
        {workspaceMenu ? workspaceMenu() : <WorkspaceName />}
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

function WorkspaceName() {
  const name = useWorkspace((s) => s.state?.snapshot.name ?? '');
  return (
    <Tooltip label="Mostrar a pasta do workspace">
      <button
        type="button"
        onClick={() => void api.invoke('workspace:revealInExplorer')}
        className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <FolderOpen className="size-3.5" strokeWidth={1.75} />
        {name}
      </button>
    </Tooltip>
  );
}

function EnvironmentSelector() {
  const snapshot = useSnapshot();
  const activeId = useActiveEnvironmentId();
  const showSection = useUiStore((s) => s.showSection);
  const active = snapshot.environments.find((e) => e.id === activeId);
  const setActive = (id: string | null) => void api.invoke('workspace:setActiveEnvironment', id);

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label="Ambiente ativo"
          className="no-drag flex h-7 min-w-44 max-w-64 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-xs transition-colors hover:border-border-strong data-[state=open]:border-border-strong"
        >
          <span
            className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-fg-subtle')}
            aria-hidden="true"
          />
          <span className={cn('flex-1 truncate text-left', active ? 'text-fg' : 'text-fg-muted')}>
            {active?.name ?? 'Sem ambiente'}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={6}
          className="z-50 max-h-[70vh] min-w-56 overflow-auto rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-xl shadow-black/40 animate-pop-in"
        >
          <Dropdown.Label className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
            Ambiente ativo
          </Dropdown.Label>
          {[{ id: null, name: 'Sem ambiente' }, ...snapshot.environments].map((env) => (
            <Dropdown.Item
              key={env.id ?? 'none'}
              onSelect={() => setActive(env.id)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
            >
              <Check
                className={cn('size-3.5 text-primary', env.id !== activeId && 'invisible')}
                strokeWidth={2}
              />
              <span className={env.id ? 'text-fg' : 'text-fg-muted'}>{env.name}</span>
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-border" />
          {active && (
            <Dropdown.Item
              onSelect={() => useTabs.getState().openItem('environment', active.id, snapshot)}
              className="cursor-pointer rounded-md px-2 py-1.5 pl-[30px] text-fg-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg"
            >
              Editar "{active.name}"
            </Dropdown.Item>
          )}
          <Dropdown.Item
            onSelect={() => showSection('environments')}
            className="cursor-pointer rounded-md px-2 py-1.5 pl-[30px] text-fg-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg"
          >
            Gerenciar ambientes
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
