import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

describe('contrast', () => {
  it('calcula os extremos', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777', '#777')).toBe(1);
  });

  it('é simétrico', () => {
    expect(contrastRatio('#1C1E33', '#E7E8F3')).toBeCloseTo(contrastRatio('#E7E8F3', '#1C1E33'), 10);
  });

  it('bate com um valor de referência conhecido', () => {
    // #767676 sobre branco é o cinza mais claro que passa AA (4.54:1).
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('rejeita cores inválidas', () => {
    expect(() => contrastRatio('azul', '#fff')).toThrow(/inválida/);
  });
});
