/**
 * Preferências de exibição desta máquina: densidade das listas laterais e
 * fonte dos editores de código (Monaco).
 */

export type Density = 'compact' | 'normal' | 'comfortable';

export const DENSITIES: { id: Density; label: string; description: string }[] = [
  { id: 'compact', label: 'Compacta', description: 'Mais itens na tela' },
  { id: 'normal', label: 'Normal', description: 'Padrão' },
  { id: 'comfortable', label: 'Confortável', description: 'Mais espaço entre os itens' },
];

export const isDensity = (value: unknown): value is Density => DENSITIES.some((d) => d.id === value);

/** Altura das linhas pela variável CSS (styles.css), sem mexer em cada componente. */
export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}

export type EditorFontId = 'jetbrains' | 'cascadia' | 'consolas' | 'courier';

// A JetBrains Mono vem embutida; as outras são do Windows e caem nela se faltarem.
export const EDITOR_FONTS: { id: EditorFontId; label: string; family: string }[] = [
  { id: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono Variable', Consolas, monospace" },
  {
    id: 'cascadia',
    label: 'Cascadia Mono',
    family: "'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono Variable', monospace",
  },
  { id: 'consolas', label: 'Consolas', family: "Consolas, 'JetBrains Mono Variable', monospace" },
  { id: 'courier', label: 'Courier New', family: "'Courier New', 'JetBrains Mono Variable', monospace" },
];

export const isEditorFont = (value: unknown): value is EditorFontId =>
  EDITOR_FONTS.some((f) => f.id === value);

export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18] as const;
export const DEFAULT_EDITOR_FONT_SIZE = 13;

export const isEditorFontSize = (value: unknown): value is number =>
  typeof value === 'number' && (EDITOR_FONT_SIZES as readonly number[]).includes(value);

/** Opções do Monaco para a fonte escolhida (altura da linha acompanha o tamanho). */
export function editorFontOptions(font: EditorFontId, size: number) {
  return {
    fontFamily: EDITOR_FONTS.find((f) => f.id === font)?.family ?? (EDITOR_FONTS[0]?.family as string),
    fontSize: size,
    lineHeight: Math.round(size * 1.54),
  };
}
