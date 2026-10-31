import { describe, expect, it } from 'vitest';
import { applyAppearanceChange, ICON_CATALOG, ITEM_COLORS, resolveItemColor } from './appearance-catalog';
import { AppearanceSchema } from './schemas';

describe('catálogo de aparência', () => {
  it('não repete ids e cabe no schema gravado', () => {
    const ids = ICON_CATALOG.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(AppearanceSchema.safeParse({ icon: id }).success).toBe(true);
    for (const c of ITEM_COLORS) expect(AppearanceSchema.safeParse({ color: c.value }).success).toBe(true);
  });

  it('acha a cor pelo nome (sem acento ou maiúscula) ou pelo hex', () => {
    expect(resolveItemColor('indigo')).toBe('#818CF8');
    expect(resolveItemColor(' VERDE ')).toBe('#34D399');
    expect(resolveItemColor('#f87171')).toBe('#F87171');
    expect(resolveItemColor('#123456')).toBeUndefined();
  });

  it('aplica só o que foi informado e volta ao padrão sem ícone nem cor', () => {
    const current = { icon: 'store', color: '#34D399' };
    expect(applyAppearanceChange(current, { color: 'Azul' })).toEqual({ icon: 'store', color: '#38BDF8' });
    expect(applyAppearanceChange(current, { icon: null })).toEqual({ color: '#34D399' });
    expect(applyAppearanceChange(current, { icon: null, color: null })).toBeNull();
    expect(() => applyAppearanceChange(undefined, { icon: 'nao-existe' })).toThrow(/catálogo/);
    expect(() => applyAppearanceChange(undefined, { color: 'magenta' })).toThrow(/paleta/);
  });
});
