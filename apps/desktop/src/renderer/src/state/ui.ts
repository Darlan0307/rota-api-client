import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from '../theme/palettes';

export type SidebarSection = 'collections' | 'environments' | 'history' | 'trash' | 'tunnels' | 'databases';
export type PaneLayout = 'horizontal' | 'vertical';
export type SettingsSection = 'appearance' | 'requests' | 'network' | 'mcp' | 'about';

interface UiState {
  paletteId: PaletteId;
  sidebarCollapsed: boolean;
  sidebarSection: SidebarSection;
  paneLayout: PaneLayout;
  /** Pastas/coleções expandidas na árvore. */
  expanded: Record<string, boolean>;

  searchOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  /** Aba de requisição nova sendo salva ("Salvar como"). */
  saveAsTabId: string | null;

  setPalette(id: PaletteId): void;
  toggleSidebar(): void;
  /** Clicar na seção já ativa recolhe a sidebar (como no VS Code). */
  selectSection(section: SidebarSection): void;
  showSection(section: SidebarSection): void;
  togglePaneLayout(): void;
  setExpanded(id: string, expanded: boolean): void;
  expandMany(ids: string[]): void;

  setSearchOpen(open: boolean): void;
  openSettings(section?: SettingsSection): void;
  setSettingsOpen(open: boolean): void;
  setSaveAsTabId(id: string | null): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      paletteId: DEFAULT_PALETTE,
      sidebarCollapsed: false,
      sidebarSection: 'collections',
      paneLayout: 'horizontal',
      expanded: {},
      searchOpen: false,
      settingsOpen: false,
      settingsSection: 'appearance',
      saveAsTabId: null,

      setPalette: (paletteId) => set({ paletteId }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectSection: (section) =>
        set((s) =>
          s.sidebarSection === section && !s.sidebarCollapsed
            ? { sidebarCollapsed: true }
            : { sidebarSection: section, sidebarCollapsed: false },
        ),
      showSection: (section) => set({ sidebarSection: section, sidebarCollapsed: false }),
      togglePaneLayout: () =>
        set((s) => ({ paneLayout: s.paneLayout === 'horizontal' ? 'vertical' : 'horizontal' })),
      setExpanded: (id, expanded) => set((s) => ({ expanded: { ...s.expanded, [id]: expanded } })),
      expandMany: (ids) =>
        set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(ids.map((id) => [id, true])) } })),

      setSearchOpen: (searchOpen) => set({ searchOpen }),
      openSettings: (section) =>
        set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSaveAsTabId: (saveAsTabId) => set({ saveAsTabId }),
    }),
    {
      name: 'rota:ui',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Só preferências de layout persistem; diálogos não.
      partialize: (s) => ({
        paletteId: s.paletteId,
        sidebarCollapsed: s.sidebarCollapsed,
        sidebarSection: s.sidebarSection,
        paneLayout: s.paneLayout,
        expanded: s.expanded,
      }),
      migrate: (persisted) => persisted as UiState,
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
