import type { Palette } from './palettes';

function kebab(name: string): string {
  return name.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);
}

/** Aplica a paleta como variáveis CSS (`--c-*`), lidas pelo @theme do Tailwind. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  const { method, ...base } = palette.colors;
  for (const [name, value] of Object.entries(base)) {
    root.style.setProperty(`--c-${kebab(name)}`, value);
  }
  for (const [name, value] of Object.entries(method)) {
    root.style.setProperty(`--c-method-${name}`, value);
  }
  root.dataset.palette = palette.id;

  // Mantém os botões nativos do Windows (minimizar/maximizar/fechar) na mesma cor da barra.
  void window.api
    .invoke('window:setTitleBarColors', {
      color: palette.colors.surface,
      symbolColor: palette.colors.fgMuted,
    })
    .catch(() => undefined);
}
