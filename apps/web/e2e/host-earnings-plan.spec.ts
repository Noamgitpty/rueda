/**
 * Parcours A10 / A11 (plan de gains d'un véhicule) — US-226 partie 226b, comme un utilisateur réel,
 * à 360 et 390 px, dans les quatre langues, contre le build de production du site et le double de
 * l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - A10 : chaque auto montre son plan en vigueur et le lien vers A11 ;
 * - A11, pays à un seul plan : `ESTÁNDAR` 75 % attribué par défaut et expliqué, aucun sélecteur ;
 * - A11, pays à deux plans : plan en vigueur présélectionné, `PRO` jamais proposé, changement
 *   enregistré avec la confirmation (effet sur les nouveaux trips seulement) ;
 * - sans session ⇒ connexion ; auto inconnue (ou d'un autre hôte : 404 de l'API) ⇒ message ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) à chaque état ; mobile d'abord.
 * Attendus : 19 US-226 (critère 2 : `ESTÁNDAR` 75 %, aucun `PRO`), 16 PRT-007 / PRT-008, jamais le
 * code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import {
  expect,
  expectMobileFriendly,
  LANGUAGES,
  submitAndSettle,
  tagOf,
  test,
} from './fixtures.ts';
import type { Language } from './fixtures.ts';

/** Plan par défaut (16 PRT-007 : `ESTÁNDAR`, part de 75 %) nommé dans chaque langue. */
const DEFAULT_PLAN: Readonly<Record<Language, RegExp>> = {
  es: /Estándar · recibes el 75\s%/,
  en: /Standard · you receive 75%/,
  fr: /Standard · tu reçois 75\s%/,
  pt: /Padrão · você recebe 75%/,
};
/** Second plan du double (17/20 = 85 %), nommé par sa part. */
const OTHER_PLAN: Readonly<Record<Language, RegExp>> = {
  es: /Plan del 85\s%/,
  en: /85% plan/,
  fr: /Plan à 85\s%/,
  pt: /Plano de 85%/,
};

async function signIn(context: BrowserContext): Promise<void> {
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

/** Lieu de remise et auto saisis sur le compte affiché (A10). */
async function placeAndCar(page: Page): Promise<void> {
  await page.locator('#a10-place-label').fill('Casa');
  await page.locator('#a10-place-address').fill('Calle Secreta 123');
  await page.locator('#a10-place-city').fill('Ciudad Ficticia');
  await page.locator('#a10-place-form button[type="submit"]').click();
  await expect(page).toHaveURL(/saved=1/);
  await page.locator('#a10-car-plate').fill(`e2e-${randomBytes(3).toString('hex')}`);
  await page.locator('#a10-car-make').fill('Toyota');
  await page.locator('#a10-car-model').fill('Yaris');
  await page.locator('#a10-car-year').fill('2021');
  await page.locator('#a10-car-form button[type="submit"]').click();
  await expect(page.locator('#a10-new')).toBeVisible();
}

const planLink = (page: Page) => page.locator('main a[href*="/earnings-plan?org="]');

for (const language of LANGUAGES) {
  test.describe(`A11 plan de gains · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('A11 : sans session ⇒ connexion ; auto inconnue ⇒ message', async ({ page, context }) => {
      const unknown = '/host/vehicles/22600000-0000-4000-8000-000000000001/earnings-plan';
      await page.goto(unknown);
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await signIn(context);
      await page.goto(unknown);
      await expect(page.locator('main h2')).toBeVisible();
      await expect(page.locator('main form')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('critère 2 : auto sans choix ⇒ ESTÁNDAR 75 % attribué et expliqué sur A10 et A11 ; un seul plan vendu ⇒ aucun sélecteur', async ({
      page,
      context,
    }) => {
      await signIn(context);
      await page.goto('/host');
      await placeAndCar(page);
      const card = page.locator('section[aria-labelledby="a10-cars"] li').first();
      await expect(card).toContainText(DEFAULT_PLAN[language]);
      await planLink(page).first().click();
      await expect(page).toHaveURL(/\/host\/vehicles\/[0-9a-f-]{36}\/earnings-plan\?org=/);
      await expect(page.locator('#a11-current')).toContainText(DEFAULT_PLAN[language]);
      await expect(page.locator('#a11-plan')).toHaveCount(0);
      await expect(page.locator('section[aria-labelledby="a11-coverage"]')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('critère 3 : deux plans vendus ⇒ plan en vigueur présélectionné, aucun PRO ; changement enregistré et confirmé, plan choisi affiché', async ({
      page,
      context,
    }) => {
      await signIn(context);
      await page.goto('/host');
      const accounts = page.locator('nav[aria-labelledby="a10-accounts"] a');
      await accounts.nth(1).click();
      await expect(accounts.nth(1)).toHaveAttribute('aria-current', 'page');
      await placeAndCar(page);
      await planLink(page).first().click();
      const form = page.locator('#a11-plan');
      const radios = form.locator('input[type="radio"]');
      await expect(radios).toHaveCount(2);
      await expect(form.locator('input[value="PRO"]')).toHaveCount(0);
      await expect(form.locator('input[value="ESTÁNDAR"]')).toBeChecked();
      await expect(form).toContainText(OTHER_PLAN[language]);
      await expectAccessible(page);
      await form.locator('input[value="ALTO"]').check();
      await submitAndSettle(
        page,
        page.locator('[data-testid="a11-plan-save"]'),
        /\/earnings-plan\?org=[0-9a-f-]{36}&saved=1$/,
      );
      await expect(page.locator('main [role="status"]').first()).toBeVisible();
      await expect(page.locator('#a11-current')).toContainText(OTHER_PLAN[language]);
      await expect(page.locator('#a11-plan input[value="ALTO"]')).toBeChecked();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
