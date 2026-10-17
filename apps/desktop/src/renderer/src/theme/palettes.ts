/**
 * Paletas do tema escuro. Cada paleta define só tokens semânticos; os
 * componentes nunca usam cores literais, apenas estes tokens (via Tailwind:
 * `bg-surface`, `text-fg-muted`, `text-method-get`...).
 */

export type HttpMethodColor = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export interface Palette {
  id: PaletteId;
  name: string;
  description: string;
  colors: {
    /** Fundo da janela. */
    bg: string;
    /** Painéis (sidebar, barra de título). */
    surface: string;
    /** Elementos sobre painéis: inputs, abas ativas, hover. */
    surface2: string;
    /** Camada flutuante: menus, diálogos, tooltips. */
    elevated: string;
    border: string;
    borderStrong: string;
    fg: string;
    fgMuted: string;
    /** Texto terciário: dicas, placeholders, atalhos. */
    fgSubtle: string;
    primary: string;
    primaryHover: string;
    /** Texto sobre `primary`. */
    primaryFg: string;
    /** Fundo discreto para seleção/realce com a cor principal. */
    primarySoft: string;
    success: string;
    warning: string;
    danger: string;
    method: Record<HttpMethodColor, string>;
  };
}

export type PaletteId = 'indigo' | 'azul';

// Cores com função (status e métodos) são iguais nas duas propostas: só a
// cor principal e os neutros mudam.
const FUNCTIONAL = {
  success: '#4FD18B',
  warning: '#F0BE5A',
  danger: '#F47C74',
  method: {
    get: '#5CC99B',
    post: '#E3B95B',
    put: '#6AA8FF',
    patch: '#B79BFF',
    delete: '#F0807A',
    head: '#7FD3D8',
    options: '#C9A0DC',
  },
} as const;

export const PALETTES: Record<PaletteId, Palette> = {
  indigo: {
    id: 'indigo',
    name: 'Índigo noturno',
    description: 'Roxo escuro com neutros levemente arroxeados. Mais personalidade.',
    colors: {
      bg: '#0E0F1A',
      surface: '#151626',
      surface2: '#1C1E33',
      elevated: '#22253D',
      border: '#2B2E4A',
      borderStrong: '#3A3E60',
      fg: '#E7E8F3',
      fgMuted: '#A3A6C2',
      fgSubtle: '#8D90B0',
      primary: '#8B7CF6',
      primaryHover: '#9D90F8',
      primaryFg: '#0E0F1A',
      primarySoft: '#2A2550',
      ...FUNCTIONAL,
    },
  },
  azul: {
    id: 'azul',
    name: 'Azul profundo',
    description: 'Azul-marinho com neutros frios. Mais sóbrio e "ferramenta".',
    colors: {
      bg: '#0B111D',
      surface: '#111827',
      surface2: '#172136',
      elevated: '#1D2940',
      border: '#26324B',
      borderStrong: '#35445F',
      fg: '#E5EAF3',
      fgMuted: '#9AA6BD',
      fgSubtle: '#8693AB',
      primary: '#5B9BFF',
      primaryHover: '#76ACFF',
      primaryFg: '#0B111D',
      primarySoft: '#1B2D4D',
      ...FUNCTIONAL,
    },
  },
};

export const DEFAULT_PALETTE: PaletteId = 'indigo';

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && value in PALETTES;
}

/** Pares texto/fundo que precisam passar no AA (usados em testes e na tela da paleta). */
export function contrastPairs(p: Palette): { label: string; fg: string; bg: string }[] {
  const c = p.colors;
  const pairs: { label: string; fg: string; bg: string }[] = [];
  for (const [bgName, bg] of [
    ['fundo', c.bg],
    ['painel', c.surface],
    ['input', c.surface2],
    ['menu', c.elevated],
  ] as const) {
    pairs.push(
      { label: `Texto / ${bgName}`, fg: c.fg, bg },
      { label: `Texto secundário / ${bgName}`, fg: c.fgMuted, bg },
      { label: `Texto terciário / ${bgName}`, fg: c.fgSubtle, bg },
    );
  }
  pairs.push(
    { label: 'Botão principal', fg: c.primaryFg, bg: c.primary },
    { label: 'Botão principal (hover)', fg: c.primaryFg, bg: c.primaryHover },
    { label: 'Cor principal / seleção', fg: c.fg, bg: c.primarySoft },
    { label: 'Link / painel', fg: c.primary, bg: c.surface },
  );
  for (const name of ['success', 'warning', 'danger'] as const) {
    pairs.push({ label: `Status ${name} / input`, fg: c[name], bg: c.surface2 });
  }
  for (const [m, color] of Object.entries(c.method)) {
    pairs.push({ label: `${m.toUpperCase()} / input`, fg: color, bg: c.surface2 });
  }
  return pairs;
}
