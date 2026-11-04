/**
 * Fixtures communes des parcours e2e (US-041).
 *
 * - `offsite` (automatique) : toute requête vers un autre hôte que le serveur testé fait échouer
 *   le test (aucune dépendance au réseau externe : polices, analytics, CDN).
 * - Horloge virtuelle : `Date` de la page figée à `FROZEN_AT` (19 US-041, notes techniques).
 * - `measure` : mêmes règles que `scripts/shell-check.mjs` (US-048) — défilement horizontal et
 *   cibles tactiles < 44 px (WCAG 2.5.8 renforcé, 10b UX-01), lien dans le texte exempté.
 */
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export { expect };

export const MIN_TARGET_PX = 44;
export const FROZEN_AT = new Date('2026-11-03T15:00:00.000Z');
export const LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;
export type Language = (typeof LANGUAGES)[number];

interface LocalesFile {
  readonly locales: ReadonlyArray<{ readonly tag: string; readonly language: string }>;
}
const LOCALES = JSON.parse(
  readFileSync(new URL('../../../packages/i18n/config/locales.json', import.meta.url), 'utf8'),
) as LocalesFile;

/** Toutes les locales proposées par la configuration (US-014). */
export const ALL_TAGS: readonly string[] = LOCALES.locales.map((l) => l.tag);

/** Locale de la configuration pour une langue (la première) : aucun pays écrit ici. */
export function tagOf(language: Language): string {
  const found = LOCALES.locales.find((l) => l.language === language);
  if (found === undefined) throw new Error(`langue absente de locales.json : ${language}`);
  return found.tag;
}

export interface Measure {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly small: readonly string[];
  readonly lang: string;
}

export async function measure(page: Page): Promise<Measure> {
  return page.evaluate((min) => {
    const small: string[] = [];
    const selector = 'a[href], button, summary, input, select, textarea, [role="button"]';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || style.visibility === 'hidden') continue;
      // lien dans le texte (WCAG 2.5.8, exception) ; lien d'évitement hors écran
      if (el.matches('a') && el.closest('p') && style.display === 'inline') continue;
      if (r.top < -r.height) continue;
      if (r.width < min || r.height < min) {
        const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim();
        small.push(`${label.slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      small,
      lang: document.documentElement.lang,
    };
  }, MIN_TARGET_PX);
}

/** Aucun défilement horizontal et aucune cible tactile sous 44 px. */
export async function expectMobileFriendly(page: Page): Promise<void> {
  const m = await measure(page);
  expect(m.scrollWidth, 'défilement horizontal').toBeLessThanOrEqual(m.clientWidth);
  expect(m.small, `cibles < ${MIN_TARGET_PX} px`).toEqual([]);
}

/** Luminance relative (WCAG) du fond effectif de la page : clair > 0,5, sombre < 0,5. */
export async function backgroundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    let el: Element | null = document.body;
    let color = 'transparent';
    while (el !== null) {
      color = getComputedStyle(el).backgroundColor;
      if (!/rgba\(.*,\s*0\)$/.test(color) && color !== 'transparent') break;
      el = el.parentElement;
    }
    const [r, g, b] = (color.match(/[\d.]+/g) ?? ['255', '255', '255'])
      .slice(0, 3)
      .map((c) => Number(c) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (r ?? 1) + 0.7152 * (g ?? 1) + 0.0722 * (b ?? 1);
  });
}

export const test = base.extend<{ offsite: string[] }>({
  offsite: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      const offsite: string[] = [];
      context.on('request', (request) => {
        const url = request.url();
        if (!/^(https?|wss?):/.test(url)) return; // réseau seulement
        if (new URL(url).origin !== origin) offsite.push(url);
      });
      await use(offsite);
      expect(offsite, 'requêtes hors du serveur testé').toEqual([]);
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    // Date.now() figé, minuteries réelles (l'hydratation de React n'est pas suspendue).
    await page.clock.setFixedTime(FROZEN_AT);
    await use(page);
  },
});
