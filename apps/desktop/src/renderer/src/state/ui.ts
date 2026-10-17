import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HttpMethod } from '../lib/http-method';
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from '../theme/palettes';

export type SidebarSection = 'collections' | 'environments' | 'history' | 'trash';
export type PaneLayout = 'horizontal' | 'vertical';

export interface RequestTab {
  id: string;
  name: string;
  method: HttpMethod;
  /** Id do item salvo na coleção; ausente em requisições novas ainda não salvas. */
  itemId?: string;
}

interface UiState {
  paletteId: PaletteId;
  sidebarCollapsed: boolean;
  sidebarSection: SidebarSection;
  paneLayout: PaneLayout;
  activeEnvironmentId: string | null;

  tabs: RequestTab[];
  activeTabId: string | null;

  searchOpen: boolean;
  settingsOpen: boolean;

  setPalette(id: PaletteId): void;
  toggleSidebar(): void;
  /** Clicar na seção já ativa recolhe a sidebar (como no VS Code). */
  selectSection(section: SidebarSection): void;
  togglePaneLayout(): void;
  setActiveEnvironment(id: string | null): void;

  openTab(tab: Omit<RequestTab, 'id'> & { id?: string }): void;
  newTab(): void;
  closeTab(id: string): void;
  setActiveTab(id: string): void;

  setSearchOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      paletteId: DEFAULT_PALETTE,
      sidebarCollapsed: false,
      sidebarSection: 'collections',
      paneLayout: 'horizontal',
      activeEnvironmentId: null,
      tabs: [],
      activeTabId: null,
      searchOpen: false,
      settingsOpen: false,

      setPalette: (paletteId) => set({ paletteId }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectSection: (section) =>
        set((s) =>
          s.sidebarSection === section && !s.sidebarCollapsed
            ? { sidebarCollapsed: true }
            : { sidebarSection: section, sidebarCollapsed: false },
        ),
      togglePaneLayout: () =>
        set((s) => ({ paneLayout: s.paneLayout === 'horizontal' ? 'vertical' : 'horizontal' })),
      setActiveEnvironment: (activeEnvironmentId) => set({ activeEnvironmentId }),

      openTab: (tab) => {
        const existing = tab.itemId ? get().tabs.find((t) => t.itemId === tab.itemId) : undefined;
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const id = tab.id ?? crypto.randomUUID();
        set((s) => ({ tabs: [...s.tabs, { ...tab, id }], activeTabId: id }));
      },
      newTab: () => get().openTab({ name: 'Nova requisição', method: 'GET' }),
      closeTab: (id) =>
        set((s) => {
          const index = s.tabs.findIndex((t) => t.id === id);
          if (index === -1) return s;
          const tabs = s.tabs.filter((t) => t.id !== id);
          if (s.activeTabId !== id) return { tabs };
          // Ao fechar a aba ativa, ativa a vizinha (preferindo a da direita).
          const next = tabs[index] ?? tabs[index - 1] ?? null;
          return { tabs, activeTabId: next?.id ?? null };
        }),
      setActiveTab: (activeTabId) => set({ activeTabId }),

      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: 'rota:ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Só preferências de layout persistem; abas e diálogos não.
      partialize: (s) => ({
        paletteId: s.paletteId,
        sidebarCollapsed: s.sidebarCollapsed,
        sidebarSection: s.sidebarSection,
        paneLayout: s.paneLayout,
        activeEnvironmentId: s.activeEnvironmentId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          paletteId: isPaletteId(p.paletteId) ? p.paletteId : current.paletteId,
        };
      },
    },
  ),
);
