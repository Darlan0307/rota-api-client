import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_EDITOR_FONT_SIZE,
  type Density,
  type EditorFontId,
  isDensity,
  isEditorFont,
  isEditorFontSize,
} from '../theme/display';
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from '../theme/palettes';

export type SidebarSection = 'collections' | 'environments' | 'history' | 'trash' | 'tunnels' | 'databases';
export type PaneLayout = 'horizontal' | 'vertical';
export type SettingsSection = 'appearance' | 'requests' | 'network' | 'mcp' | 'about';

interface UiState {
  paletteId: PaletteId;
  density: Density;
  editorFont: EditorFontId;
  editorFontSize: number;
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
  setDensity(density: Density): void;
  setEditorFont(font: EditorFontId): void;
  setEditorFontSize(size: number): void;
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
      density: 'normal',
      editorFont: 'jetbrains',
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      sidebarCollapsed: false,
      sidebarSection: 'collections',
      paneLayout: 'horizontal',
      expanded: {},
      searchOpen: false,
      settingsOpen: false,
      settingsSection: 'appearance',
      saveAsTabId: null,

      setPalette: (paletteId) => set({ paletteId }),
      setDensity: (density) => set({ density }),
      setEditorFont: (editorFont) => set({ editorFont }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
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
      // Só preferências de layout persistem; diálogos não. O app sempre abre em
      // Coleções, com a sidebar visível.
      partialize: (s) => ({
        paletteId: s.paletteId,
        density: s.density,
        editorFont: s.editorFont,
        editorFontSize: s.editorFontSize,
        paneLayout: s.paneLayout,
        expanded: s.expanded,
      }),
      migrate: (persisted) => persisted as UiState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          // Versões antigas gravavam a seção e a sidebar recolhida.
          sidebarSection: current.sidebarSection,
          sidebarCollapsed: current.sidebarCollapsed,
          paletteId: isPaletteId(p.paletteId) ? p.paletteId : current.paletteId,
          density: isDensity(p.density) ? p.density : current.density,
          editorFont: isEditorFont(p.editorFont) ? p.editorFont : current.editorFont,
          editorFontSize: isEditorFontSize(p.editorFontSize) ? p.editorFontSize : current.editorFontSize,
        };
      },
    },
  ),
);
