import { contrastRatio, WCAG } from '@rota/core';
import { describe, expect, it } from 'vitest';
import { contrastPairs, PALETTES } from './palettes';

describe.each(Object.values(PALETTES))('paleta $name', (palette) => {
  it.each(contrastPairs(palette))('$label passa no WCAG AA', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG.AA_TEXT);
  });

  it('a borda forte é distinguível do fundo (componentes de UI)', () => {
    expect(contrastRatio(palette.colors.borderStrong, palette.colors.bg)).toBeGreaterThan(1.5);
  });
});
