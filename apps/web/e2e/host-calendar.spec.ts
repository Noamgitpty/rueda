/**
 * Parcours A06 (calendrier d'un véhicule de l'hôte) — US-119, comme un utilisateur réel, à 360 et
 * 390 px, dans les quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - depuis A10, le lien « calendrier » d'une auto ouvre A06 ; auto sans annonce publiée ⇒ blocage
 *   indisponible annoncé ; annonce créée (vaut publiée dans le double) ⇒ blocage du 10 au 12 ⇒
 *   « Guardado » et une ligne « bloqué » ; même créneau ⇒ refus annoncé (aucun détail) ; levée ⇒
 *   vide ; blocage par heures ; préavis de 3 h enregistré ;
 * - auto inconnue (ou d'un autre hôte : 404 de l'API) ⇒ message ; sans session ⇒ connexion ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sur `main` sans violation ; mobile d'abord.
 * Attendus : 19 US-119, 16 CAL-001 / CAL-002 / CAL-003 (e2e/oracle.ts pour les textes de 10b),
 * jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { expectAccessible } from './axe.ts';
import { SPEC_TEXT } from './oracle.ts';

async function signIn(context: BrowserContext): Promise<void> {
  const token = `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;
  await context.addCookies([
    {
      name: '__Host-session',
      value: token,
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
  await page.goto('/host');
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

for (const language of LANGUAGES) {
  test.describe(`A06 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('A06 : sans session ⇒ connexion ; auto inconnue ⇒ message', async ({ page, context }) => {
      await page.goto('/host/vehicles/11900000-0000-4000-8000-000000000001');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await signIn(context);
      await page.goto('/host/vehicles/11900000-0000-4000-8000-000000000001');
      await expect(page.locator('main h2')).toBeVisible();
      await expect(page.locator('main form')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('A06 : blocage du 10 au 12 ⇒ « Guardado » ; même créneau refusé ; levée ; heures ; préavis', async ({
      page,
      context,
    }) => {
      await signIn(context);
      await placeAndCar(page);
      // A10 → A06 : avant l'annonce, le blocage est annoncé indisponible
      await page.locator('main a[href^="/host/vehicles/"]').first().click();
      await expect(page).toHaveURL(/\/host\/vehicles\/[0-9a-f-]{36}\?org=/);
      await expect(page.locator('#a06-days')).toHaveCount(0);
      await expect(
        page.locator('section[aria-labelledby="a06-block"] [role="status"]'),
      ).not.toBeEmpty();
      await expectAccessible(page);
      await expectMobileFriendly(page);
      const calendarUrl = page.url().replace(/&saved=1$/, '');

      // annonce créée (le double la tient pour publiée)
      await page.goto('/host');
      await page.locator('#a10-new-price').fill(language === 'en' ? '40.00' : '40,00');
      await page.locator('#a10-new button[type="submit"]').click();
      await expect(page.locator('main article')).toHaveCount(1);
      await page.goto(calendarUrl);
      await expect(page.locator('#a06-days')).toBeVisible();

      // jours du 10 au 12 : une ligne « bloqué », levée possible
      await page.locator('#a06-days-from').fill('2036-12-10');
      await page.locator('#a06-days-to').fill('2036-12-12');
      await page.locator('#a06-days button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      const saved = SPEC_TEXT.hostSaved[language];
      if (saved !== undefined) {
        await expect(page.locator('main [role="status"]').first()).toContainText(saved);
      }
      const rows = page.locator('section[aria-labelledby="a06-upcoming"] li');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('form[id^="a06-block-"]')).toHaveCount(1);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // même créneau : refus annoncé sur le formulaire, rien d'ajouté
      await page.locator('#a06-days-from').fill('2036-12-11');
      await page.locator('#a06-days-to').fill('2036-12-11');
      await page.locator('#a06-days button[type="submit"]').click();
      await expect(page.locator('#a06-days [role="alert"]')).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expectAccessible(page);

      // levée : plus aucune ligne
      await rows.first().locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(rows).toHaveCount(0);

      // quelques heures, au pas de 30 min
      await page.locator('#a06-hours-day').fill('2036-12-14');
      await page.locator('#a06-hours-start').fill('08:30');
      await page.locator('#a06-hours-end').fill('12:00');
      await page.locator('#a06-hours button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(rows).toHaveCount(1);

      // préavis de 3 h pour le lieu de remise, relu
      await page.locator('#a06-notice-minutes').selectOption('180');
      await page.locator('#a06-notice button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(page.locator('#a06-notice-minutes')).toHaveValue('180');
      await expectAccessible(page);
      await expectMobileFriendly(page);
      // l'adresse exacte du lieu n'apparaît jamais sur l'écran du calendrier
      await expect(page.locator('main')).not.toContainText('Calle Secreta');
    });
  });
}
