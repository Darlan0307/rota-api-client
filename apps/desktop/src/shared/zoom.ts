/** Níveis de zoom da interface (atalhos e Configurações → Aparência). */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5] as const;

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
