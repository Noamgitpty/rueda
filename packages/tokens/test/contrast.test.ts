import { describe, expect, it } from 'vitest';
import { assertContrast, buildTheme, checkContrast, ThemeContrastError } from '../src/index.ts';
import { patch, tinta } from './helpers.ts';

// Critère US-030 : « Given une palette, When elle est chargée, Then un contrôle de contraste
// refuse toute paire texte / fond sous WCAG 2.2 AA. »
describe('contrôle de contraste au chargement', () => {
  it('accepte Lienzo · Tinta', () => {
    expect(checkContrast(buildTheme(tinta()))).toEqual([]);
  });

  it('refuse un texte secondaire trop pâle et nomme la paire', () => {
    const pale = patch(tinta(), 'color.light.text-muted.$value', '#9A9A9A');
    const failures = checkContrast(buildTheme(pale));
    expect(failures.map((f) => `${f.mode} ${f.pair}`)).toEqual(
      expect.arrayContaining(['light text-muted / surface', 'light text-muted / surface-raised']),
    );
    expect(() => assertContrast(buildTheme(pale))).toThrow(ThemeContrastError);
    expect(() => assertContrast(buildTheme(pale))).toThrow(/text-muted \/ surface/);
  });

  it('contrôle aussi le mode sombre', () => {
    const failures = checkContrast(
      buildTheme(patch(tinta(), 'color.dark.on-primary.$value', '#5A6A80')),
    );
    expect(failures.some((f) => f.mode === 'dark' && f.pair === 'on-primary / primary')).toBe(true);
  });

  it('refuse un contour de champ sous 3:1 (composant, 1.4.11)', () => {
    const failures = checkContrast(
      buildTheme(patch(tinta(), 'color.light.border-strong.$value', '#C8C8C8')),
    );
    expect(failures.some((f) => f.pair === 'border-strong / surface-raised' && f.min === 3)).toBe(
      true,
    );
  });

  it("refuse un ton d'avatar illisible", () => {
    const failures = checkContrast(
      buildTheme(patch(tinta(), 'color.light.on-avatar-2.$value', '#E0D0C0')),
    );
    expect(failures.map((f) => f.pair)).toContain('on-avatar-2 / avatar-2');
  });

  it('évalue le verre au pire contenu dessous (UX-49)', () => {
    const thin = patch(tinta(), 'glass.opacity.$value', 0.3);
    const failures = checkContrast(buildTheme(thin));
    expect(failures.some((f) => f.pair === 'text / glass' || f.pair === 'text-muted / glass')).toBe(
      true,
    );
  });
});
