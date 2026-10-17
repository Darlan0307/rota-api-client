/** Níveis mínimos de contraste da WCAG 2.x. */
export const WCAG = {
  /** Texto normal, nível AA. */
  AA_TEXT: 4.5,
  /** Texto grande (>= 18pt ou 14pt negrito) e componentes de UI, nível AA. */
  AA_LARGE: 3,
  /** Texto normal, nível AAA. */
  AAA_TEXT: 7,
} as const;

function parseHex(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Cor hexadecimal inválida: "${hex}"`);
  const digits = match[1].length === 3 ? Array.from(match[1], (c) => c + c).join('') : match[1];
  return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** Luminância relativa conforme a definição da WCAG. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores (de 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
