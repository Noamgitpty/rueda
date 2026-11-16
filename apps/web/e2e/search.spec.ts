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
 * - US-203 : résultats en liste de cartes ET sur une carte de marqueurs de prix ; liste et carte
 *   montrent les mêmes annonces et les mêmes totaux (19 US-203 critère 1) ; une annonce sans point
 *   est listée sous la carte, jamais omise ; caution de la plateforme affichée quand la base en
 *   rend une, sinon mention générique ; badge « Nuevo » sans avis (critère 3, 16 SRC-011) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) à chaque état, mobile d'abord.
 * Attendus : 19 US-201, US-203, 16 SRC-001 / LST-006 / SRC-008 / SRC-011, jamais le code testé ;
 * badge « Nuevo » : 10b §4.3 `web.s02.new` (`oracle.ts`) ; caution de 300,00 : valeur de test de
 * 08 T70 rendue par le double.
 */
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import type { Language } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';
import { AREA, CITY, END, place, PUBLIC_ID, searchUrl, START } from './search-data.ts';

/**
 * US-226b : le total de chaque carte comprend la protection minimale du pays (16 SRC-042, N-141),
 * mention affichée près du total (revue ux de 226a, n° 7).
 */
const PROTECTION_INCLUDED: Readonly<Record<Language, string>> = {
  es: 'Protección básica incluida',
  en: 'Basic protection included',
  fr: 'Protection de base incluse',
  pt: 'Proteção básica incluída',
};

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
      const results = page.locator('[data-testid="search-card"]');
      await expect(results).toHaveCount(3);
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
      await expect(page.locator('[data-testid="search-card"]')).toHaveCount(3);
      await expectAccessible(page);
    });

    test('US-203 : liste et carte montrent les mêmes annonces et les mêmes totaux ; caution ou mention générique ; « Nuevo » sans avis', async ({
      page,
    }) => {
      await page.goto(searchUrl(CITY, AREA));
      const cards = page.locator('[data-testid="search-card"]');
      await expect(cards).toHaveCount(3);
      await expect(page.locator('[data-testid="search-count"]')).toContainText('3');
      const markers = page.locator('[data-testid="search-map-marker"]');
      await expect(markers).toHaveCount(3);
      // deux annonces placées sur la carte, la troisième (sans point) listée sous la carte
      await expect(
        page.locator('[data-testid="search-map"] [data-testid="search-map-marker"]'),
      ).toHaveCount(2);
      // mêmes annonces (même lien vers la fiche, dates reprises) et même total, carte par carte
      const hrefs = await cards.evaluateAll((els) =>
        els.map((e) => e.querySelector('h3 a')?.getAttribute('href') ?? ''),
      );
      const markerHrefs = await markers.evaluateAll((els) =>
        els.map((e) => e.getAttribute('href') ?? ''),
      );
      expect([...markerHrefs].sort()).toEqual([...hrefs].sort());
      for (const m of await markers.all()) {
        const href = (await m.getAttribute('href')) ?? '';
        const total = ((await m.textContent()) ?? '').trim();
        expect(total).not.toBe('');
        const card = cards.filter({ has: page.locator(`h3 a[href="${href}"]`) });
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(total);
      }
      // caution : montant de la plateforme quand la base en rend un (300,00), sinon mention
      // générique, sans montant (16 SRC-011, 08 T70 c)
      const luxe = cards.filter({ hasText: 'Audi A4 2022' });
      const toyota = cards.filter({ hasText: 'Toyota Yaris 2021' });
      const swift = cards.filter({ hasText: 'Suzuki Swift 2020' });
      await expect(luxe).toContainText(/300[.,]00/);
      await expect(toyota).not.toContainText(/300[.,]00/);
      const generic = ((await toyota.locator('p').last().textContent()) ?? '').trim();
      expect(generic).not.toBe('');
      await expect(swift).toContainText(generic);
      await expect(luxe).not.toContainText(generic);
      // US-226b : « protection de base incluse » près du total, sur chaque carte
      await expect(cards.filter({ hasText: PROTECTION_INCLUDED[language] })).toHaveCount(3);
      // sans avis : badge « Nuevo » (10b §4.3 `web.s02.new`) ; avec avis : note, pas de badge
      const nuevo = SPEC_TEXT.newBadge[language];
      if (nuevo !== undefined) {
        await expect(toyota).toContainText(nuevo);
        await expect(luxe).not.toContainText(nuevo);
      }
      await expectAccessible(page);
      await expectMobileFriendly(page);
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
