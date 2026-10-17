import { Columns2, PanelLeftOpen, Plus, Rows2, X } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { MethodBadge } from '../components/MethodBadge';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/ui';

export function TabBar() {
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const newTab = useUiStore((s) => s.newTab);
  const paneLayout = useUiStore((s) => s.paneLayout);
  const togglePaneLayout = useUiStore((s) => s.togglePaneLayout);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-surface">
      {sidebarCollapsed && (
        <div className="flex items-center border-r border-border px-1.5">
          <IconButton icon={PanelLeftOpen} label="Expandir painel" size="sm" onClick={toggleSidebar} />
        </div>
      )}

      <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActiveTab(tab.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
              title={tab.name}
              className={cn(
                'group relative flex w-48 min-w-28 shrink cursor-default items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-[13px] transition-colors duration-100',
                active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
              <MethodBadge method={tab.method} />
              <span className="flex-1 truncate">{tab.name}</span>
              <button
                type="button"
                aria-label={`Fechar ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-opacity hover:bg-surface-2 hover:text-fg',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center px-1.5">
          <IconButton icon={Plus} label="Nova requisição" size="sm" onClick={newTab} />
        </div>
      </div>

      <div className="flex items-center px-1.5">
        <IconButton
          icon={paneLayout === 'horizontal' ? Rows2 : Columns2}
          label={paneLayout === 'horizontal' ? 'Empilhar requisição e resposta' : 'Colocar lado a lado'}
          size="sm"
          onClick={togglePaneLayout}
        />
      </div>
    </div>
  );
}
