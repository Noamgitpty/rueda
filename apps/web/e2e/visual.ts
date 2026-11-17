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
 *   coupés par Playwright, texte en niveaux de gris (`--disable-lcd-text`, playwright.config.ts),
 *   polices du système du runner de la CI (aucune police téléchargée),
 *   données du double de l'API ou des routes interceptées, toujours les mêmes.
 * - Références faisant foi : celles du runner Linux de la CI (`linux/`). Celles d'un poste local
 *   (`win32/`, `darwin/`) sont ignorées par git.
 * - Écart : le test échoue, la CI publie l'artefact « regression-visuelle » (attendu, obtenu,
 *   différence et références proposées) ; approuver = commiter les références proposées, dont le
 *   diff d'image est relu dans la demande de fusion (docs/qa/REGRESSION_VISUELLE.md).
 */
import { fileURLToPath } from 'node:url';
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

/**
 * Feuille de capture qui neutralise les calques composés (`backdrop-filter`, `isolation`,
 * `will-change`) : appliquée par Playwright pendant la capture seulement, pour les
 * écrans dont le tramage du texte variait d'une exécution à l'autre (voir la feuille).
 */
export const STABLE_CAPTURE_STYLE = fileURLToPath(
  new URL('./capture-sans-calques.css', import.meta.url),
);

/**
 * Polices re-résolues à l'échelle d'écran courante avant la capture (N-180,
 * docs/qa/REGRESSION_VISUELLE.md, « Polices résolues avant la première mise en page »).
 *
 * Sous Linux, Blink choisit le tramage d'une police (ajustement des glyphes, positionnement
 * sous-pixel) en interrogeant le système avec `FontCache::DeviceScaleFactor()`, valeur propre au
 * processus de rendu, à 1 au départ et mise à jour par `LayoutView::LayoutRoot()` seulement, donc
 * à la première mise en page. Une police demandée par le calcul de style AVANT cette première mise
 * en page (unité `ch` du chapeau de l'accueil, par exemple) est créée à l'échelle 1 ; sa liste de
 * polices reste en cache dans le document et sert tout le texte de même description (16 px,
 * graisse normale), alors que les polices demandées ensuite (gras, 14 px) le sont à l'échelle 2.
 * La course dépend du minutage du rendu : capture instable au hasard.
 *
 * Ajouter puis retirer une police inutilisée à `document.fonts` invalide toutes les listes de
 * polices du document (`FontInvalidationReason::kGeneralInvalidation`) : elles sont recréées à
 * l'échelle courante (la clé du cache des polices la contient). Sans effet quand la course a été
 * gagnée (mêmes polices, mêmes références) ; la page servie ne change pas.
 */
export async function resolveFontsAtCurrentScale(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const face = new FontFace('rueda-capture-invalidation', 'local("rueda-capture-absente")');
    document.fonts.add(face);
    document.fonts.delete(face);
    await document.fonts.ready;
    // deux images : style, mise en page et peinture refaits avec les polices recréées
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

/** Capture pleine page comparée à la référence ; un écart n'arrête pas les autres contrôles. */
export async function expectScreen(
  page: Page,
  screen: string,
  language: Language,
  scheme: Scheme,
  options: { readonly stableCompositing?: boolean } = {},
): Promise<void> {
  await resolveFontsAtCurrentScale(page);
  await expect.soft(page).toHaveScreenshot([screen, `${language}-${scheme}.png`], {
    fullPage: true,
    ...(options.stableCompositing === true ? { stylePath: STABLE_CAPTURE_STYLE } : {}),
  });
}
