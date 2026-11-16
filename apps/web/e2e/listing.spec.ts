/**
 * Parcours de la fiche du véhicule S03 (US-204), comme un visiteur réel, à 360 et 390 px, dans les
 * quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement ; photos relayées par le site
 * depuis le bucket du double, `WEB_MEDIA_URL`) :
 *
 * - critère 1 : galerie dans l'ordre de l'hôte (ordre rendu par l'API, identifiants non triés) ;
 *   la photo introuvable au bucket est remplacée par une vignette, les deux autres s'affichent et
 *   la fiche reste entière (16 LST-002) ;
 * - critère 2 : départ dans le préavis de l'hôte ⇒ refus annoncé (`role="alert"`, préavis en
 *   heures) ; dates prises ⇒ refus sans détail ; dates libres ⇒ « disponible » (16 LST-006 ;
 *   LST-008 DIFFÉRÉ) ; le sélecteur de la fiche est un formulaire GET : l'URL garde les dates ;
 * - critère 3 : visiteur ⇒ zone approximative seulement, jamais l'adresse ; voyageur d'un trip
 *   confirmé (session du double) ⇒ libellé et adresse du lieu, retour au même lieu (16 LST-007) ;
 * - bloc de l'hôte : prénom, « identité vérifiée », note (16 LST-020 bêta) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) à chaque état, mobile d'abord.
 * Attendus : 19 US-204, 16 LST-002 / LST-006 / LST-007 / LST-020, 10b §4.3 (`oracle.ts`), jamais
 * le code testé ; préavis de 3 h : donnée du double (16 LST-006 « un préavis de 3 h »).
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';
import { PUBLIC_ID } from './search-data.ts';

/** Galerie du double, dans l'ordre de l'hôte ; la deuxième photo est introuvable au bucket. */
const GALLERY = [
  '20400000-0000-4000-8000-0000000000c3',
  '20400000-0000-4000-8000-0000000000a1',
  '20400000-0000-4000-8000-0000000000b2',
];
/** Adresse exacte du lieu du double : jamais montrée à un visiteur. */
const ADDRESS = 'Avenida Ficticia 123';
const PLACE = 'Entrada del centro comercial';

const fiche = (start: string, end: string): string =>
  `/listings/${PUBLIC_ID}?${new URLSearchParams({ start, end }).toString()}`;

/** Session du double : `B00k…` = voyageur d'un trip confirmé de la fiche. */
async function signIn(context: BrowserContext, prefix: 'B00k' | 'N0ho'): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

for (const language of LANGUAGES) {
  test.describe(`fiche du véhicule S03 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('critère 1 et bloc de l’hôte : galerie dans l’ordre de l’hôte, photo introuvable remplacée, le reste affiché ; zone seule, jamais l’adresse', async ({
      page,
    }) => {
      await page.goto(`/listings/${PUBLIC_ID}`);
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      const photos = page.locator('[data-testid="gallery-photo"]');
      await expect(photos).toHaveCount(3);
      expect(
        await photos.evaluateAll((els) => els.map((e) => e.getAttribute('data-photo'))),
      ).toEqual(GALLERY);
      // première et troisième chargées depuis le site (même origine), deuxième en vignette
      for (const i of [0, 2]) {
        const img = photos.nth(i).locator('img');
        await expect(img).toHaveAttribute('src', `/media/listing/${PUBLIC_ID}/${GALLERY[i]}`);
        await expect
          .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      }
      await expect(photos.nth(1).locator('img')).toHaveCount(0);
      await expect(photos.nth(1).locator('[role="img"]')).toBeVisible();
      const caption = SPEC_TEXT.photosBy[language];
      if (caption !== undefined)
        await expect(photos.first().locator('figcaption')).toHaveText(caption);
      // la fiche reste entière : en-tête, caractéristiques, hôte, lieu
      await expect(page.locator('h1')).toContainText('Toyota Yaris 2021');
      await expect(page.locator('section[aria-labelledby="s03-features"]')).toBeVisible();
      const host = page.locator('#s03-host');
      await expect(host).toContainText('Ana');
      const verified = SPEC_TEXT.hostVerified[language];
      if (verified !== undefined) await expect(host).toContainText(verified);
      // lieu : zone approximative, aucune adresse exacte (visiteur)
      const meet = page.locator('section[aria-labelledby="s03-meet"]');
      const meetTitle = SPEC_TEXT.meetTitle[language];
      if (meetTitle !== undefined) await expect(meet.locator('h2')).toHaveText(meetTitle);
      await expect(meet).toContainText('Barrio Norte, Ciudad Ficticia');
      await expect(page.locator('body')).not.toContainText(ADDRESS);
      await expect(page.locator('[data-testid="meeting-point"]')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('critère 2 : départ dans le préavis de l’hôte ⇒ refus annoncé ; dates prises ⇒ refus ; dates libres ⇒ disponible ; l’URL garde les dates choisies', async ({
      page,
    }) => {
      // dates reprises de la recherche, départ à 07:00 : préavis de 3 h non respecté
      await page.goto(fiche('2036-12-10T07:00', '2036-12-12T10:00'));
      const dates = page.locator('section[aria-labelledby="s03-dates"]');
      const refusal = dates.locator('[role="alert"]');
      await expect(refusal).toBeVisible();
      await expect(refusal).toContainText('3');
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // nouvelle heure choisie sur la fiche : formulaire GET, l'URL porte les champs
      await page.locator('#s03-slot-startTime').selectOption('11:00');
      await dates.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/startTime=11%3A00/);
      await expect(dates.locator('[role="alert"]')).toHaveCount(0);
      await expect(dates.locator('[role="status"]')).toBeVisible();
      await expect(page.locator('#s03-slot-startDate')).toHaveValue('2036-12-10');
      await expect(page.locator('#s03-slot-startTime')).toHaveValue('11:00');
      await expectAccessible(page);

      // créneau pris (24 décembre dans le double) : refus sans détail de l'occupation
      await page.locator('#s03-slot-startDate').fill('2036-12-24');
      await page.locator('#s03-slot-endDate').fill('2036-12-26');
      await dates.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/startDate=2036-12-24/);
      const busy = dates.locator('[role="alert"]');
      await expect(busy).toBeVisible();
      await expect(busy).not.toContainText('3');
      await expectAccessible(page);
    });

    test('critère 3 : voyageur d’un trip confirmé ⇒ libellé et adresse du lieu, retour au même lieu ; autre session ⇒ zone seule', async ({
      page,
      context,
    }) => {
      await signIn(context, 'N0ho');
      await page.goto(`/listings/${PUBLIC_ID}`);
      await expect(page.locator('section[aria-labelledby="s03-meet"]')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(ADDRESS);
      await context.clearCookies();
      await signIn(context, 'B00k');
      await page.goto(`/listings/${PUBLIC_ID}`);
      const exact = page.locator('[data-testid="meeting-point"]');
      await expect(exact).toBeVisible();
      await expect(exact.locator('address')).toContainText(PLACE);
      await expect(exact.locator('address')).toContainText(ADDRESS);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
