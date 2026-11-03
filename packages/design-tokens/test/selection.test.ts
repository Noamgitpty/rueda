import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECTION,
  getActiveTheme,
  resolveSelection,
  UnknownPaletteError,
} from '../src/index.ts';

describe('choix du thème par configuration', () => {
  it('config/theme.json : Lienzo · Tinta, automatique', () => {
    expect(DEFAULT_SELECTION).toEqual({ palette: 'lienzo-tinta', colorScheme: 'auto' });
  });

  it('THEME_PALETTE change de palette sans toucher au code', () => {
    expect(getActiveTheme({ THEME_PALETTE: 'lienzo-azur' }).theme.id).toBe('lienzo-azur');
    expect(getActiveTheme({ THEME_PALETTE: 'marina' }).css).toContain('/* thème marina ');
  });

  it('THEME_COLOR_SCHEME impose un mode via data-theme', () => {
    expect(getActiveTheme({ THEME_COLOR_SCHEME: 'dark' }).dataTheme).toBe('dark');
    expect(getActiveTheme({ THEME_COLOR_SCHEME: 'light' }).dataTheme).toBe('light');
  });

  it('une palette inconnue ou un mode inconnu font échouer (fail-closed)', () => {
    expect(() => resolveSelection({ THEME_PALETTE: 'turo' })).toThrow(UnknownPaletteError);
    expect(() => resolveSelection({ THEME_COLOR_SCHEME: 'sepia' })).toThrow(/THEME_COLOR_SCHEME/);
    expect(() => resolveSelection({ THEME_PALETTE: '__proto__' })).toThrow(UnknownPaletteError);
  });
});
