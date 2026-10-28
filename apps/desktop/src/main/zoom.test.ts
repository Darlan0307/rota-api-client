import { describe, expect, it } from 'vitest';
import { stepZoom } from './zoom';

describe('stepZoom', () => {
  it('anda pelos níveis e para nas pontas', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.5, 1)).toBe(1.5);
    expect(stepZoom(0.8, -1)).toBe(0.8);
  });

  it('um valor fora da lista (editado no settings.json) vai para o nível vizinho', () => {
    expect(stepZoom(1.17, 1)).toBe(1.25);
    expect(stepZoom(1.17, -1)).toBe(1.1);
  });
});
