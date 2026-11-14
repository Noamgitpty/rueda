/**
 * Balayage systématique des écrans du site (US-044, 10b §3.10 UX-46 / UX-49 ; 19 §1.8) : chaque
 * écran livré, dans son état d'arrivée, dans les quatre langues, en clair puis en sombre.
 *
 * - axe-core (WCAG 2.2 A / AA) sur la **page entière**, coquille comprise : 0 violation bloquante,
 *   contraste mesuré dans chaque thème (le thème suit l'appareil : `emulateMedia`).
 * - Mobile d'abord : aucun défilement horizontal, cibles ≥ 44 px (fixtures.ts).
 * - Régression visuelle selon la matrice de `visual.ts` ; la tablette ne rejoue que es et en
 *   (`grep` du projet, playwright.config.ts).
 *
 * Les états profonds (erreurs de formulaire, OTP, calendrier, annonces…) restent dans les parcours
 * de chaque story, qui appellent le même `expectAccessible` (axe.ts) ; ce fichier garantit qu'aucun
 * écran n'échappe à axe ni à la capture. Un nouvel écran s'ajoute à `SCREENS`.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { captured, expectScreen } from './visual.ts';

/** Fiche publiée du double de l'API (e2e/stub-api.mjs, données fictives). */
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';

/** Session d'hôte neuf du double (`H0st…`, un compte par parcours). */
async function signInHost(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

interface Screen {
  /** Nom stable de la capture (dossier de références). */
  readonly name: string;
  /** Écran de 10b ou story qui le livre (lecture humaine seulement). */
  readonly source: string;
  readonly open: (page: Page, context: BrowserContext) => Promise<void>;
}

const at =
  (path: string) =>
  async (page: Page): Promise<void> => {
    await page.goto(path);
  };

export const SCREENS: readonly Screen[] = [
  { name: 'accueil', source: 'S01, US-048', open: at('/') },
  { name: 'hors-ligne', source: 'US-048', open: at('/offline') },
  { name: 'inscription', source: 'S15, US-102', open: at('/signup') },
  { name: 'inscription-envoyee', source: 'S15, US-102', open: at('/signup/sent') },
  { name: 'connexion', source: 'S15, US-102', open: at('/login') },
  { name: 'connexion-faite', source: 'S15, US-102', open: at('/login/done') },
  { name: 'cgu-reacceptation', source: 'S15, US-102', open: at('/terms/update') },
  { name: 'verification-email', source: 'S15, US-102', open: at('/verify-email') },
  { name: 'document-cgu', source: 'S15, US-102', open: at('/legal/TOS_GUEST') },
  { name: 'document-confidentialite', source: 'S15, US-102', open: at('/legal/PRIVACY') },
  { name: 'telephone', source: 'S15, US-104', open: at('/verify-phone') },
  { name: 'identite', source: 'S04, US-105', open: at('/verify-identity') },
  { name: 'fiche-publique', source: 'S03, US-115', open: at(`/listings/${PUBLIC_ID}`) },
  { name: 'hote-sans-session', source: 'A10, US-115', open: at('/host') },
  {
    name: 'hote-espace',
    source: 'A10, US-115',
    open: async (page, context) => {
      await signInHost(context);
      await page.goto('/host');
    },
  },
  {
    name: 'hote-verification',
    source: 'A07, US-123',
    open: async (page, context) => {
      await signInHost(context);
      await page.goto('/host');
      await page.locator('main a[href^="/host/verification?org="]').click();
      await expect(page).toHaveURL(/\/host\/verification\?org=/);
      await expect(page.locator('#a07-tasks')).toBeVisible();
    },
  },
  { name: 'vitrine-composants', source: 'US-032', open: at('/ui?width=mobile') },
];

for (const screen of SCREENS) {
  for (const language of LANGUAGES) {
    test.describe(`écran ${screen.name} · ${language}`, () => {
      test.use({ locale: tagOf(language) });

      test(`axe, mobile d'abord et capture (${screen.source})`, async ({ page, context }, info) => {
        await screen.open(page, context);
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        await expect(page.locator('h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectMobileFriendly(page);
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await expectAccessible(page, { include: null });
          if (captured(info, language, scheme))
            await expectScreen(page, screen.name, language, scheme);
        }
      });
    });
  }
}
