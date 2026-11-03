import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, hexToRgb } from '../src/index.ts';
import { paletteFiles, readPalette } from './helpers.ts';

describe('formule de contraste WCAG 2.x', () => {
  // Valeurs de référence publiées (exemples WCAG / WebAIM), pas issues du code testé.
  it.each([
    ['#000000', '#FFFFFF', 21],
    ['#FFFFFF', '#FFFFFF', 1],
    ['#777777', '#FFFFFF', 4.48],
    ['#767676', '#FFFFFF', 4.54],
    ['#0000FF', '#FFFFFF', 8.59],
  ])('%s sur %s = %s:1', (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 2);
    expect(contrastRatio(bg, fg)).toBeCloseTo(expected, 2);
  });

  it('refuse une couleur mal écrite', () => {
    expect(() => hexToRgb('#FFF')).toThrow();
    expect(() => hexToRgb('red')).toThrow();
  });

  it('mélange alpha : 50 % de blanc sur noir', () => {
    expect(blend('#FFFFFF', 0.5, '#000000')).toBe('#808080');
    expect(blend('#123456', 1, '#000000')).toBe('#123456');
  });

  // Oracle indépendant : les ratios consignés par US-028 (script de l'agent design, hors de ce
  // paquet) dans `contrastChecks` de chaque palette doivent être retrouvés à 0,01 près.
  describe.each(paletteFiles())('ratios consignés dans %s', (file) => {
    const checks = readPalette(file)['contrastChecks'] as Record<
      string,
      { pair: string; fg: string; bg: string; ratio: number; min: number }[]
    >;
    const rows = Object.entries(checks).flatMap(([group, list]) =>
      list.map((c) => [group, c] as const),
    );
    it.each(rows)('%s : %j', (_group, c) => {
      expect(Math.abs(contrastRatio(c.fg, c.bg) - c.ratio)).toBeLessThanOrEqual(0.0101);
      expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(c.min);
    });
  });
});
