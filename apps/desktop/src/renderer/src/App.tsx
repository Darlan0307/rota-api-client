import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { TooltipProvider } from './components/Tooltip';
import { duplicateSelected, renameSelected } from './features/sidebar/item-actions';
import { ActivityBar } from './layout/ActivityBar';
import { DialogHost } from './layout/DialogHost';
import { MainArea } from './layout/MainArea';
import { ResizeHandle } from './layout/ResizeHandle';
import { SearchDialog } from './layout/SearchDialog';
import { SettingsDialog } from './layout/SettingsDialog';
import { Sidebar } from './layout/Sidebar';
import { StatusBar } from './layout/StatusBar';
import { TitleBar } from './layout/TitleBar';
import { useHotkeys } from './lib/hotkeys';
import { closeTab, saveTab, sendRequest } from './state/actions';
import { useTabs } from './state/tabs';
import { useUiStore } from './state/ui';
import { useWorkspace } from './state/workspace';

export function App() {
  const ready = useWorkspace((s) => s.state !== null);
  const error = useWorkspace((s) => s.error);
  useGlobalHotkeys();
  useWorkspaceSync();

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TitleBar />
        {ready ? (
          <div className="flex min-h-0 flex-1">
            <ActivityBar />
            <SidebarLayout />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-fg-muted">
            {error ? (
              <span className="text-danger">Não foi possível abrir o workspace: {error}</span>
            ) : (
              <>
                <LoaderCircle className="size-4 animate-spin" /> Abrindo workspace…
              </>
            )}
          </div>
        )}
        <StatusBar />
      </div>
      <SearchDialog />
      <SettingsDialog />
      <DialogHost />
    </TooltipProvider>
  );
}

/** Carrega o workspace e mantém as abas em sincronia com os arquivos. */
function useWorkspaceSync() {
  useEffect(() => {
    void useWorkspace.getState().init();
    return useWorkspace.subscribe((current, previous) => {
      const state = current.state;
      if (!state || state === previous.state) return;
      const tabs = useTabs.getState();
      if (tabs.workspaceRoot !== state.snapshot.root)
        tabs.loadForWorkspace(state.snapshot.root, state.snapshot);
      else tabs.reconcile(state.snapshot);
    });
  }, []);
}

function SidebarLayout() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarRef = usePanelRef();

  // O estado "recolhido" vive na store (persistido); o painel só o reflete.
  useEffect(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (collapsed && !panel.isCollapsed()) panel.collapse();
    if (!collapsed && panel.isCollapsed()) panel.expand();
  }, [collapsed, sidebarRef]);

  return (
    <Group orientation="horizontal" className="min-w-0 flex-1">
      <Panel
        id="sidebar"
        panelRef={sidebarRef}
        collapsible
        collapsedSize={0}
        defaultSize={collapsed ? 0 : 280}
        minSize={220}
        maxSize={480}
        onResize={(size) => {
          // Arrastar até recolher também atualiza a store.
          const isCollapsed = size.inPixels === 0;
          if (isCollapsed !== useUiStore.getState().sidebarCollapsed) {
            useUiStore.setState({ sidebarCollapsed: isCollapsed });
          }
        }}
      >
        <Sidebar />
      </Panel>
      <ResizeHandle />
      <Panel id="main" minSize={480}>
        <MainArea />
      </Panel>
    </Group>
  );
}

function useGlobalHotkeys() {
  const activeId = () => useTabs.getState().activeId;
  useHotkeys({
    'mod+p': () => useUiStore.getState().setSearchOpen(true),
    'mod+w': () => {
      const id = activeId();
      if (id) void closeTab(id);
    },
    'mod+enter': () => {
      const id = activeId();
      if (id) void sendRequest(id);
    },
    'mod+s': () => {
      const id = activeId();
      if (id) void saveTab(id);
    },
    'mod+t': () => useTabs.getState().openNewRequest(),
    'mod+b': () => useUiStore.getState().toggleSidebar(),
    'mod+tab': () => useTabs.getState().activateRelative(1),
    'mod+shift+tab': () => useTabs.getState().activateRelative(-1),
    'mod+,': () => useUiStore.getState().openSettings(),
    // No editor de código, Ctrl+D/Ctrl+E mantêm o comportamento do Monaco.
    'mod+e': () => (inCodeEditor() ? false : renameSelected()),
    'mod+d': () => (inCodeEditor() ? false : duplicateSelected()),
  });
}

function inCodeEditor(): boolean {
  return Boolean(document.activeElement?.closest('.monaco-editor'));
}
