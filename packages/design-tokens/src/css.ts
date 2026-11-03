/**
 * Génération de la feuille de style d'un thème : variables CSS (`--color-primary`, `--radius-card`…)
 * en clair, en sombre (préférence système ou `data-theme` sur `<html>`), mouvement réduit et
 * transparence réduite, plus quelques règles de base qui ne lisent que ces variables.
 * Les valeurs viennent de `buildTheme`, qui les a validées : aucune ne peut fermer un bloc CSS.
 */
import type { Theme, ThemeToken } from './build.ts';

const decls = (tokens: readonly ThemeToken[], pick: (t: ThemeToken) => string): string =>
  tokens.map((t) => `--${t.name}:${pick(t)};`).join('');

/** Déclarations dérivées : le verre et son repli opaque (UX-49). */
function glassDecls(theme: Theme): { on: string; off: string } {
  const pct = Math.round(theme.glassOpacity * 1000) / 10;
  return {
    on:
      `--glass-bg:color-mix(in srgb,var(--color-surface-raised) ${pct}%,transparent);` +
      '--glass-backdrop:blur(var(--glass-blur)) saturate(var(--glass-saturate));',
    off: '--glass-bg:var(--color-surface-raised);--glass-backdrop:none;',
  };
}

/** Règles de base : uniquement des variables du thème (aucune valeur codée en dur). */
export const BASE_CSS = [
  '*,*::before,*::after{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
  'body{margin:0;background:var(--color-surface);color:var(--color-text);' +
    'font-family:var(--font-family-body);font-size:var(--font-size-md);' +
    'font-weight:var(--font-weight-body);line-height:var(--font-line-height-body)}',
  'h1,h2,h3,h4{font-family:var(--font-family-heading);font-weight:var(--font-weight-heading);' +
    'line-height:var(--font-line-height-heading)}',
  'a{color:var(--color-primary)}',
  ':focus-visible{outline:var(--size-focus-ring) solid var(--color-focus);' +
    'outline-offset:var(--size-focus-offset)}',
  // UX-69 : tout s'arrête, exceptions comprises ; les durées des jetons tombent aussi à 0.
  '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0s!important;' +
    'animation-iteration-count:1!important;transition-duration:0s!important;scroll-behavior:auto!important}}',
].join('\n');

export interface StyleSheetOptions {
  /** Ajoute `BASE_CSS` (vrai par défaut). */
  readonly base?: boolean;
}

/** Feuille de style complète du thème, prête pour une balise `<style>`. */
export function themeStyleSheet(theme: Theme, options: StyleSheetOptions = {}): string {
  const darkOnly = theme.tokens.filter((t) => t.dark !== t.light);
  const durations = theme.tokens.filter((t) => t.type === 'duration');
  // US-031 : un élément pressé ne change plus d'échelle (aucun mouvement, même instantané).
  const scales = theme.tokens.filter((t) => t.name.startsWith('motion-scale-'));
  const glass = glassDecls(theme);
  const dark = `color-scheme:dark;${decls(darkOnly, (t) => t.dark)}`;
  const css = [
    `/* thème ${theme.id} ${theme.version} (format ${theme.schemaVersion}) */`,
    `:root{color-scheme:light dark;${decls(theme.tokens, (t) => t.light)}${glass.on}}`,
    ':root[data-theme="light"]{color-scheme:light}',
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
    `@media (prefers-reduced-motion:reduce){:root{${decls(durations, () => '0s')}${decls(scales, () => '1')}}}`,
    `@media (prefers-reduced-transparency:reduce){:root{${glass.off}}}`,
    `@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){:root{${glass.off}}}`,
  ];
  if (options.base !== false) css.push(BASE_CSS);
  return css.join('\n');
}
