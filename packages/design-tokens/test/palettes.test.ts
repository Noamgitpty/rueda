import { describe, expect, it } from 'vitest';
import {
  getActiveTheme,
  listPalettes,
  loadTheme,
  PALETTE_IDS,
  REQUIRED_PATHS,
  SEMANTIC_COLORS,
  themeStyleSheet,
} from '../src/index.ts';
import { paletteFiles, readPalette } from './helpers.ts';

describe('registre des palettes (source unique : docs/design/US-028)', () => {
  it('charge toutes les palettes présentes sur disque, ni plus ni moins', () => {
    const onDisk = paletteFiles().map((f) => f.replace(/^tokens-|\.json$/g, ''));
    expect([...PALETTE_IDS].sort()).toEqual(onDisk);
  });

  it.each(paletteFiles())('%s : identifiant = nom du fichier', (file) => {
    const meta = readPalette(file)['meta'] as { direction: string };
    expect(`tokens-${meta.direction}.json`).toBe(file);
  });

  it('chaque palette est valide et conforme au contraste AA, en clair et en sombre', () => {
    const report = listPalettes();
    expect(report.filter((p) => !p.accepted)).toEqual([]);
    expect(report).toHaveLength(paletteFiles().length);
  });

  it('toutes les palettes produisent exactement les mêmes variables CSS (interchangeables)', () => {
    const names = (id: string): string[] => loadTheme(id).tokens.map((t) => t.name);
    const reference = names('lienzo-tinta');
    for (const id of PALETTE_IDS) expect(names(id), id).toEqual(reference);
    expect(reference).toHaveLength(SEMANTIC_COLORS.length + REQUIRED_PATHS.length);
  });
});

describe('Lienzo · Tinta, thème par défaut', () => {
  it('est le thème actif sans configuration', () => {
    const active = getActiveTheme({});
    expect(active.theme.id).toBe('lienzo-tinta');
    expect(active.colorScheme).toBe('auto');
    expect(active.dataTheme).toBeUndefined();
  });

  // Valeurs attendues recopiées de 10b UX-67 et de PROPOSITIONS (H1, « Langage visuel »).
  it('expose les valeurs qui font foi (10b UX-67)', () => {
    const css = themeStyleSheet(loadTheme('lienzo-tinta'), { base: false });
    for (const decl of [
      '--color-primary:#1D3461;',
      '--color-surface:#FFFFFF;',
      '--color-text:#17181B;',
      '--font-family-heading:"Bricolage Grotesque", system-ui, sans-serif;',
      '--font-family-body:"Manrope", system-ui, sans-serif;',
      '--radius-sm:8px;',
      '--radius-md:12px;',
      '--radius-lg:16px;',
      '--radius-card:20px;',
      '--motion-duration-fast:150ms;',
      '--motion-duration-base:180ms;',
      '--motion-duration-slow:240ms;',
      '--motion-duration-enter:280ms;',
      '--motion-duration-page:300ms;',
      '--motion-duration-signature:700ms;',
      '--motion-easing-standard:cubic-bezier(0.2, 0.6, 0.2, 1);',
      '--motion-easing-emphasis:cubic-bezier(0.2, 0.7, 0.2, 1);',
      '--motion-iterations-skeleton:3;',
      '--size-touch-target:48px;',
      '--glass-blur:18px;',
      '--camino-stroke-width:2.5px;',
      '--camino-dash-array:0.006 0.018;',
    ]) {
      expect(css).toContain(decl);
    }
  });

  it('a un mode sombre complet (PROPOSITIONS, H1, tableau sombre)', () => {
    const dark = loadTheme('lienzo-tinta').colors.dark;
    expect(dark.primary).toBe('#A9C1EA');
    expect(dark.surface).toBe('#111214');
    expect(dark['surface-raised']).toBe('#191A1D');
    expect(dark.text).toBe('#EDEEF0');
  });
});
