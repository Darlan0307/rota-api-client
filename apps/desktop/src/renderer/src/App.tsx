import { useEffect } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { TooltipProvider } from './components/Tooltip';
import { ActivityBar } from './layout/ActivityBar';
import { MainArea, ResizeHandle } from './layout/MainArea';
import { SearchDialog } from './layout/SearchDialog';
import { SettingsDialog } from './layout/SettingsDialog';
import { Sidebar } from './layout/Sidebar';
import { TitleBar } from './layout/TitleBar';
import { useHotkeys } from './lib/hotkeys';
import { useUiStore } from './state/ui';

export function App() {
  useGlobalHotkeys();

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          <SidebarLayout />
        </div>
      </div>
      <SearchDialog />
      <SettingsDialog />
    </TooltipProvider>
  );
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
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  useHotkeys({
    'mod+p': () => setSearchOpen(true),
    'mod+w': () => {
      const { activeTabId, closeTab } = useUiStore.getState();
      if (activeTabId) closeTab(activeTabId);
    },
    // Envio e salvamento são implementados na Fase 2.
    'mod+enter': () => undefined,
    'mod+s': () => undefined,
  });
}
