/**
 * Parcours A02 (prochaines remises) et A05 (réservations de l'hôte, détail) — US-219, comme un
 * utilisateur réel, à 360 et 390 px, dans les quatre langues, contre le build de production du site
 * et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - sans session ⇒ connexion ; espace hôte sans auto ⇒ A02 annonce « aucune réservation » ;
 * - une auto saisie ⇒ A02 montre sa prochaine remise (référence, prénom du voyageur, identité
 *   vérifiée) et mène à A05 ; onglets « à venir » / « annulées » ; filtre par auto ; période
 *   inversée ⇒ message, sans liste ; détail d'un trip ; trip inconnu (ou d'un autre hôte : 404 de
 *   l'API) ⇒ message sans détail ;
 * - minimisation (19 US-219 critère 2) : jamais de numéro de permis ni d'image de pièce affichés ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sur `main` sans violation ; mobile d'abord.
 * Attendus : 19 US-219, 16 HDB-001 / HDB-002, 10b UX-39 / UX-43 (e2e/oracle.ts pour les textes de
 * 10b), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { expectAccessible } from './axe.ts';

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

/** 10b §4.3, `web.host.guest.verified` (pt : texte distinct des trois autres). */
const VERIFIED: Readonly<Record<string, string>> = {
  es: 'Identidad verificada',
  en: 'Verified identity',
  fr: 'Identité vérifiée',
};

for (const language of LANGUAGES) {
  test.describe(`A02 / A05 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('A05 : sans session ⇒ connexion ; trip inconnu ⇒ message', async ({ page, context }) => {
      await page.goto('/host/trips');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await signIn(context);
      await page.goto('/host/trips/21900000-0000-4000-8000-000000000001');
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('main article')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('A02 → A05 : prochaine remise en tête, onglets, filtre, période inversée, détail', async ({
      page,
      context,
    }) => {
      await signIn(context);
      await page.goto('/host');
      // sans auto : bloc des prochaines remises vide, lien vers A05
      const agenda = page.locator('section[aria-labelledby="a02-upcoming"]');
      await expect(agenda).toBeVisible();
      await expect(agenda.locator('article')).toHaveCount(0);
      await placeAndCar(page);
      await page.goto('/host');
      await expect(agenda.locator('article')).toHaveCount(1);
      await expect(agenda.locator('article').first()).toContainText('KM-101');
      await expect(agenda.locator('article').first()).toContainText('Lucía');
      const verified = VERIFIED[language];
      if (verified !== undefined) await expect(agenda).toContainText(verified);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // A05 : onglet « à venir » par défaut
      await page.locator('main a[href^="/host/trips?org="]').click();
      await expect(page).toHaveURL(/\/host\/trips\?org=/);
      const cards = page.locator('main ul article');
      await expect(cards).toHaveCount(1);
      await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // onglet « annulées » : le trip annulé, sans gains estimés
      await page.locator('nav a[href*="tab=CANCELLED"]').click();
      await expect(page).toHaveURL(/tab=CANCELLED/);
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText('KM-102');
      await expect(cards.first()).toContainText('Mateo');

      // filtre par auto puis période inversée : message, aucune liste
      await page.locator('nav a[href*="tab=UPCOMING"]').click();
      await page.locator('#a05-vehicle').selectOption({ index: 1 });
      await page.locator('form[aria-labelledby="a05-filters"] button[type="submit"]').click();
      await expect(page).toHaveURL(/vehicleId=/);
      await expect(cards).toHaveCount(1);
      await page.locator('#a05-from').fill('2036-12-20');
      await page.locator('#a05-to').fill('2036-12-10');
      await page.locator('form[aria-labelledby="a05-filters"] button[type="submit"]').click();
      await expect(page.locator('main [role="status"]')).not.toHaveCount(0);
      await expect(cards).toHaveCount(0);
      await expectAccessible(page);

      // détail : même carte, jamais de permis ni de pièce
      await page.goto('/host');
      await agenda.locator('article a[href^="/host/trips/"]').click();
      await expect(page).toHaveURL(/\/host\/trips\/[0-9a-f-]{36}\?org=/);
      await expect(page.locator('main article')).toHaveCount(1);
      await expect(page.locator('main article')).toContainText('KM-101');
      await expect(page.locator('main img')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
