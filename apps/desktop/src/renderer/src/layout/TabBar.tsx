import { Bookmark, Columns2, Folder, Globe, Library, PanelLeftOpen, Plus, Rows2, X } from 'lucide-react';
import { useState } from 'react';
import { ContextActions } from '../components/ActionMenu';
import { IconButton } from '../components/IconButton';
import { MethodBadge } from '../components/MethodBadge';
import { cn } from '../lib/cn';
import { closeTab } from '../state/actions';
import { isDirty, type Tab, useTabs } from '../state/tabs';
import { useUiStore } from '../state/ui';

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const setActive = useTabs((s) => s.setActive);
  const openNewRequest = useTabs((s) => s.openNewRequest);
  const moveTab = useTabs((s) => s.move);
  const paneLayout = useUiStore((s) => s.paneLayout);
  const togglePaneLayout = useUiStore((s) => s.togglePaneLayout);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-surface">
      {sidebarCollapsed && (
        <div className="flex items-center border-r border-border px-1.5">
          <IconButton icon={PanelLeftOpen} label="Expandir painel" size="sm" onClick={toggleSidebar} />
        </div>
      )}

      <div
        role="tablist"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:thin]"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const dirty = isDirty(tab);
          return (
            <ContextActions
              key={tab.id}
              entries={[
                { label: 'Fechar', onSelect: () => void closeTab(tab.id), shortcut: 'Ctrl+W' },
                { label: 'Fechar as outras', onSelect: () => closeOthers(tab.id) },
              ]}
            >
              <div
                role="tab"
                tabIndex={0}
                aria-selected={active}
                draggable
                onDragStart={() => setDragId(tab.id)}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={() => {
                  if (dragId) moveTab(dragId, index);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                onClick={() => setActive(tab.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActive(tab.id)}
                onAuxClick={(e) => e.button === 1 && void closeTab(tab.id)}
                title={tab.title}
                className={cn(
                  'group relative flex w-48 min-w-28 shrink cursor-pointer items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-[13px] transition-colors duration-100',
                  active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                  dragId === tab.id && 'opacity-50',
                )}
              >
                {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
                <TabIcon tab={tab} />
                <span className={cn('flex-1 truncate', tab.kind === 'request' && !tab.itemId && 'italic')}>
                  {tab.title}
                </span>
                {tab.conflict && (
                  <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Alterado fora do app" />
                )}
                <button
                  type="button"
                  aria-label={`Fechar ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTab(tab.id);
                  }}
                  className="relative flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  {/* Alterado: mostra um ponto; ao passar o mouse vira o "x". */}
                  {dirty && <span className="absolute size-2 rounded-full bg-fg-muted group-hover:hidden" />}
                  <X
                    className={cn(
                      'size-3.5',
                      dirty ? 'hidden group-hover:block' : active ? '' : 'opacity-0 group-hover:opacity-100',
                    )}
                  />
                </button>
              </div>
            </ContextActions>
          );
        })}
        <div className="flex items-center px-1.5">
          <IconButton
            icon={Plus}
            label="Nova requisição"
            shortcut="Ctrl+T"
            size="sm"
            onClick={() => openNewRequest()}
          />
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

async function closeOthers(id: string) {
  for (const tab of useTabs.getState().tabs) {
    if (tab.id !== id) await closeTab(tab.id);
  }
}

function TabIcon({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'request':
      return <MethodBadge method={tab.draft.method} />;
    case 'collection':
      return <Library className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />;
    case 'folder':
      return <Folder className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />;
    case 'example':
      return <Bookmark className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />;
    default:
      return <Globe className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />;
  }
}
