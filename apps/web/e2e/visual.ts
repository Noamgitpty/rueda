/**
 * Régression visuelle (US-044) : captures natives de Playwright (`toHaveScreenshot`), références
 * dans le dépôt (`e2e/__screenshots__/<plateforme>/<projet>/`), aucun service ni compte externe.
 *
 * - Matrice (PROPOSÉ, ADR-112) : à 360 px, les quatre langues en clair et l'espagnol en sombre ;
 *   en tablette, es et en en clair (19 US-044, notes techniques). Le projet 390 px vérifie axe et
 *   le mobile d'abord sans capture. axe, lui, tourne partout en clair ET en sombre : la matrice des
 *   captures est bornée pour garder le dépôt léger (une capture pleine page pèse 20 à 200 Ko et
 *   chaque changement de jeton les réécrit toutes).
 * - Stabilité : horloge du navigateur figée (fixtures.ts), mouvement réduit, animations et curseur
 *   coupés par Playwright, polices du système du runner de la CI (aucune police téléchargée),
 *   données du double de l'API ou des routes interceptées, toujours les mêmes.
 * - Références faisant foi : celles du runner Linux de la CI (`linux/`). Celles d'un poste local
 *   (`win32/`, `darwin/`) sont ignorées par git.
 * - Écart : le test échoue, la CI publie l'artefact « regression-visuelle » (attendu, obtenu,
 *   différence et références proposées) ; approuver = commiter les références proposées, dont le
 *   diff d'image est relu dans la demande de fusion (docs/qa/REGRESSION_VISUELLE.md).
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Language } from './fixtures.ts';

export type Scheme = 'light' | 'dark';

/** La capture de cet écran est-elle dans la matrice pour ce projet, cette langue, ce thème ? */
export function captured(info: TestInfo, language: Language, scheme: Scheme): boolean {
  const project = info.project.name;
  if (project.endsWith('-360')) return scheme === 'light' || language === 'es';
  if (project === 'tablette') return scheme === 'light' && (language === 'es' || language === 'en');
  return false;
}

/** Capture pleine page comparée à la référence ; un écart n'arrête pas les autres contrôles. */
export async function expectScreen(
  page: Page,
  screen: string,
  language: Language,
  scheme: Scheme,
): Promise<void> {
  await expect
    .soft(page)
    .toHaveScreenshot([screen, `${language}-${scheme}.png`], { fullPage: true });
}
