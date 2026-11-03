/**
 * Outils de test de `@rueda/ui` : traducteurs de chaque locale configurée, rendu serveur, et
 * analyse axe-core dans un DOM jsdom isolé (aucun environnement de navigateur global).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createTranslator, parseLocaleConfig } from '@rueda/i18n';
import type { LocaleProfile, Translator } from '@rueda/i18n';
import rawLocales from '@rueda/i18n/config/locales.json' with { type: 'json' };

export const LOCALE_CONFIG = parseLocaleConfig(rawLocales);

/** Une entrée par locale déclarée (es-PA, es-PY, en, fr) : `[tag, profil, traducteur]`. */
export const LOCALES: ReadonlyArray<readonly [string, LocaleProfile, Translator]> =
  LOCALE_CONFIG.locales.map((p) => [p.tag, p, createTranslator(p)] as const);

export const render = (element: ReactElement): string => renderToStaticMarkup(element);

/** Page complète autour d'un fragment rendu (langue, titre, repère principal). */
export function page(body: string, lang: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>US-032</title></head><body><main>${body}</main></body></html>`;
}

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * Règles WCAG 2.0 / 2.1 / 2.2 de niveaux A et AA (critère US-032 : « 0 violation WCAG 2.2 AA
 * bloquante »). `color-contrast` est écartée ici parce que jsdom ne calcule ni la mise en page ni
 * les styles des modules CSS : le contraste est garanti par construction (paires de jetons
 * contrôlées par `@rueda/design-tokens`, voir `tokens.test.ts`).
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: ReadonlyArray<{ readonly target: unknown; readonly html: string }>;
}

export async function axeViolations(html: string): Promise<AxeViolation[]> {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const win = dom.window as unknown as {
      eval(source: string): unknown;
      axe: { run(context: unknown, options: unknown): Promise<{ violations: AxeViolation[] }> };
      document: unknown;
    };
    win.eval(AXE_SOURCE);
    const result = await win.axe.run(win.document, {
      runOnly: { type: 'tag', values: AXE_TAGS },
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    return result.violations;
  } finally {
    dom.window.close();
  }
}

/** Résumé lisible d'une liste de violations (message d'échec). */
export const describeViolations = (violations: readonly AxeViolation[]): string[] =>
  violations.map(
    (v) => `${v.id} (${v.impact ?? '?'}) : ${v.help} — ${v.nodes.map((n) => n.html).join(' | ')}`,
  );

/** Texte visible et accessible d'un rendu (balises retirées, attributs `aria-label` gardés). */
export function textOf(html: string): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const labels = [...doc.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));
  return `${doc.body.textContent ?? ''} ${labels.join(' ')}`;
}
