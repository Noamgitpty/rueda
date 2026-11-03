import { describe, expect, it } from 'vitest';
import { loadTheme, themeStyleSheet } from '../src/index.ts';

const css = themeStyleSheet(loadTheme('lienzo-tinta'));

describe('feuille de style du thème', () => {
  it('déclare le clair à la racine et le sombre par préférence ou par data-theme', () => {
    expect(css).toMatch(/^:root\{color-scheme:light dark;/m);
    expect(css).toContain(
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;',
    );
    expect(css).toMatch(
      /:root\[data-theme="dark"\]\{color-scheme:dark;[^}]*--color-surface:#111214;/,
    );
    expect(css).toMatch(/--shadow-card:0 1px 2px rgba\(0,0,0,\.04\)/);
  });

  it('coupe toutes les durées avec prefers-reduced-motion (UX-69)', () => {
    const block =
      /@media \(prefers-reduced-motion:reduce\)\{:root\{([^}]*)\}\}/.exec(css)?.[1] ?? '';
    for (const name of ['fast', 'base', 'slow', 'enter', 'page', 'signature', 'skeleton']) {
      expect(block).toContain(`--motion-duration-${name}:0s;`);
    }
  });

  it('remplace le verre par une surface opaque si la transparence est réduite ou absente (UX-49)', () => {
    expect(css).toContain(
      '--glass-bg:color-mix(in srgb,var(--color-surface-raised) 86%,transparent);',
    );
    expect(css).toContain(
      '@media (prefers-reduced-transparency:reduce){:root{--glass-bg:var(--color-surface-raised);--glass-backdrop:none;}}',
    );
    expect(css).toMatch(/@supports not \(\(backdrop-filter:blur\(1px\)\)/);
  });

  it('ne contient aucun caractère capable de fermer la balise <style>', () => {
    expect(css).not.toContain('<');
  });

  it('les règles de base ne lisent que des variables', () => {
    const base = css.slice(css.indexOf('*,*::before'));
    expect(base).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(base).toContain('font-family:var(--font-family-body)');
    expect(base).toContain('outline:var(--size-focus-ring) solid var(--color-focus)');
  });
});
