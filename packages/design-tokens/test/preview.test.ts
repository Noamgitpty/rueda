/**
 * Feuille d'aperçu portée par un conteneur (US-120, écran O02) : un brouillon se rend dans la
 * console sans toucher au thème de la page. Valeurs attendues : fichier de palette US-028
 * (`docs/design/US-028/tokens-lienzo-tinta.json`), jamais la sortie de la fonction testée.
 */
import { describe, expect, it } from 'vitest';
import { loadTheme, previewStyleSheet, ThemeFormatError } from '../src/index.ts';

const ATTR = 'data-brand-preview';
const css = previewStyleSheet(loadTheme('lienzo-tinta'), ATTR);
const block = (mode: 'light' | 'dark'): string =>
  new RegExp(`^\\[${ATTR}="${mode}"\\]\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

describe("feuille d'aperçu d'un thème", () => {
  it('ne déclare rien sur :root ni sur html : la page garde son thème', () => {
    expect(css).not.toContain(':root');
    expect(css).not.toMatch(/(^|[\s,{}])html\b/);
    expect(css).not.toContain('data-theme=');
  });

  it('chaque mode reçoit toutes ses valeurs (palette Lienzo · Tinta)', () => {
    expect(block('light')).toMatch(/^color-scheme:light;/);
    expect(block('light')).toContain('--color-primary:#1D3461;');
    expect(block('light')).toContain('--color-surface:#FFFFFF;');
    expect(block('dark')).toMatch(/^color-scheme:dark;/);
    expect(block('dark')).toContain('--color-surface:#111214;');
    // un jeton non coloré (identique dans les deux modes) est aussi posé en sombre
    expect(block('dark')).toContain('--radius-card:');
    expect(block('dark')).toContain('--glass-bg:');
  });

  it('coupe les durées avec prefers-reduced-motion, dans la portée (UX-69)', () => {
    const reduced =
      /@media \(prefers-reduced-motion:reduce\)\{[^{]*\{([^}]*)\}\}/.exec(css)?.[1] ?? '';
    expect(reduced).toContain('--motion-duration-fast:0s;');
    expect(reduced).toContain('--motion-scale-press:1;');
  });

  it("refuse un attribut qui n'est pas un simple data-* (aucune injection de sélecteur)", () => {
    const theme = loadTheme('lienzo-tinta');
    for (const bad of ['style', 'data-x"]{}', 'data-', 'data-A', ':root', 'data-x y']) {
      expect(() => previewStyleSheet(theme, bad)).toThrow(ThemeFormatError);
    }
  });

  it('ne contient aucun caractère capable de fermer la balise <style>', () => {
    expect(css).not.toContain('<');
  });
});
