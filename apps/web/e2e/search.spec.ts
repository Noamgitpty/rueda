/**
 * Parcours de la recherche publique (US-201), comme un visiteur réel, à 360 et 390 px, dans les
 * quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement) :
 *
 * - S01 : lieu choisi dans la liste des zones, départ et retour (date et heure au pas de 30 min),
 *   formulaire GET ⇒ page de résultats, l'URL garde la recherche (16 SRC-001) ;
 * - résultat ⇒ fiche S03 avec les dates reprises (`?start=&end=`, 19 US-201 critère 2), bloc des
 *   dates et lien « modifier la recherche » ⇒ retour à la même recherche, formulaire prérempli ;
 * - fin avant le début le même jour (10:00 puis 09:30) ⇒ refus annoncé, aucun résultat
 *   (critère 1) ;
 * - zone approximative seulement, jamais d'adresse (critère 4 : le double n'en a pas ; le résultat
 *   ne montre que la zone et la ville) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) à chaque état, mobile d'abord.
 * Attendus : 19 US-201, 16 SRC-001 / LST-006, jamais le code testé.
 */
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { AREA, CITY, END, place, PUBLIC_ID, START } from './search-data.ts';

for (const language of LANGUAGES) {
  test.describe(`recherche S01 → S02 → S03 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('S01 → résultats → fiche (dates reprises) → retour à la même recherche', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      const form = page.locator('form[role="search"]');
      await expect(form).toBeVisible();
      await page.locator('#s01-search-place').selectOption(place(CITY, AREA));
      await page.locator('#s01-search-startDate').fill(START.date);
      await page.locator('#s01-search-startTime').selectOption(START.time);
      await page.locator('#s01-search-endDate').fill(END.date);
      await page.locator('#s01-search-endTime').selectOption(END.time);
      await form.locator('button[type="submit"]').click();

      // page de résultats : la recherche est dans l'URL, un résultat, zone approximative seule
      await expect(page).toHaveURL(/\/search\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get('place')).toBe(place(CITY, AREA));
      expect(url.searchParams.get('startDate')).toBe(START.date);
      expect(url.searchParams.get('endTime')).toBe(END.time);
      const results = page.locator('main section[aria-labelledby="s02-results"] li');
      await expect(results).toHaveCount(1);
      await expect(results.first()).toContainText('Toyota Yaris 2021');
      await expect(results.first()).toContainText(`${AREA}, ${CITY}`);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // résultat ⇒ fiche avec les dates reprises
      const open = results.first().locator(`a[href^="/listings/${PUBLIC_ID}?"]`);
      await open.click();
      await expect(page).toHaveURL(new RegExp(`/listings/${PUBLIC_ID}\\?`));
      const fiche = new URL(page.url());
      expect(fiche.searchParams.get('start')).toBe(`${START.date}T${START.time}`);
      expect(fiche.searchParams.get('end')).toBe(`${END.date}T${END.time}`);
      const dates = page.locator('section[aria-labelledby="s03-dates"]');
      await expect(dates).toBeVisible();
      await expect(dates.locator('h2')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // « modifier la recherche » ⇒ même recherche, formulaire prérempli, même résultat
      await dates.locator('a[href^="/search?"]').click();
      await expect(page).toHaveURL(/\/search\?/);
      await expect(page.locator('#s02-search-place')).toHaveValue(place(CITY, AREA));
      await expect(page.locator('#s02-search-startDate')).toHaveValue(START.date);
      await expect(page.locator('#s02-search-startTime')).toHaveValue(START.time);
      await expect(page.locator('#s02-search-endDate')).toHaveValue(END.date);
      await expect(page.locator('#s02-search-endTime')).toHaveValue(END.time);
      await expect(page.locator('main section[aria-labelledby="s02-results"] li')).toHaveCount(1);
      await expectAccessible(page);
    });

    test('critère 1 : départ 10:00 et retour 09:30 le même jour ⇒ refus annoncé, aucun résultat', async ({
      page,
    }) => {
      await page.goto('/');
      const form = page.locator('form[role="search"]');
      await page.locator('#s01-search-place').selectOption(place(CITY, AREA));
      await page.locator('#s01-search-startDate').fill(START.date);
      await page.locator('#s01-search-startTime').selectOption('10:00');
      await page.locator('#s01-search-endDate').fill(START.date);
      await page.locator('#s01-search-endTime').selectOption('09:30');
      await form.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/search\?/);
      const alert = page.locator('#s02-search-error');
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).not.toBeEmpty();
      await expect(page.locator('form[role="search"]')).toHaveAttribute(
        'aria-describedby',
        /s02-search-error/,
      );
      await expect(page.locator('main section[aria-labelledby="s02-results"] li')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
