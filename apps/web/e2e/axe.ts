/**
 * axe-core dans le navigateur réel (US-044, 10b §3.10 UX-46 / UX-49) : une seule implémentation,
 * partagée par tous les parcours e2e (auparavant recopiée dans chaque spécification).
 *
 * - Règles : WCAG 2.0 / 2.1 / 2.2, niveaux A et AA (`WCAG_TAGS`). Toute violation de ces règles est
 *   **bloquante** (19 §1.8 : « 0 violation axe bloquante »), quel que soit son impact.
 * - Contexte : `main` par défaut (l'écran d'une story) ; `null` = la page entière, coquille comprise
 *   (balayage systématique, `a11y.spec.ts`).
 * - En haut de page avant l'analyse : l'en-tête collant de la coquille ne recouvre aucune cible
 *   (axe compterait une cible cachée sous lui comme trop petite, WCAG 2.5.8).
 * - Le contraste (1.4.3, 1.4.11) n'est mesurable que dans un vrai navigateur : jsdom (tests de
 *   `@rueda/ui`) ne le calcule pas. Clair et sombre : `emulateMedia({ colorScheme })` puis une
 *   nouvelle analyse.
 */
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export interface AxeOptions {
  /** Sélecteurs analysés ; `null` = la page entière. Défaut : `['main']`. */
  readonly include?: readonly string[] | null;
}

/** Violations WCAG A / AA de la page, une ligne par règle : `règle cible1, cible2`. */
export async function axeViolations(page: Page, options: AxeOptions = {}): Promise<string[]> {
  const include = options.include === undefined ? ['main'] : options.include;
  await page.evaluate(() => window.scrollTo(0, 0));
  const loaded = await page.evaluate(() => 'axe' in window);
  if (!loaded) await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ include, tags }) => {
      const axe = (
        window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
      ).axe;
      const r = (await axe.run(include === null ? document : { include }, {
        runOnly: { type: 'tag', values: tags },
      })) as { violations: { id: string; nodes: { target: string[] }[] }[] };
      return r.violations.map(
        (v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
    },
    { include, tags: [...WCAG_TAGS] },
  );
}

/** Aucune violation axe bloquante (WCAG 2.2 A / AA). */
export async function expectAccessible(page: Page, options: AxeOptions = {}): Promise<void> {
  expect(await axeViolations(page, options), 'violations axe-core').toEqual([]);
}
