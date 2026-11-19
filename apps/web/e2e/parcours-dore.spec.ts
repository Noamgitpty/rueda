/**
 * Parcours doré « réservation » du voyageur, de bout en bout sur le site (US-221 ; 19 US-221, §1.8
 * « Parcours dorés inter-modules ») : S01 → résultats → S03 (dates reprises de la recherche) → S05
 * → hold posé → « Pagar {total} » → page hébergée du PSP (interceptée : aucun réseau externe) →
 * webhook FAKE signé joué par le double (e2e/stub-api.mjs) → S06 « confirmé ».
 *
 * Minimal par construction (job e2e limité à 30 min) : téléphone 360 px, espagnol (langue
 * faisant foi), un seul test ; chaque écran est déjà éprouvé en quatre langues par sa spec propre
 * (search, listing, checkout, checkout-payment). Textes attendus lus dans le catalogue officiel
 * (`@rueda/i18n`), total TA01 (16 A.8.1 : 40,00 × 3 j + 7 % = 128,40) rendu par l'API, jamais
 * recalculé par le site. Aucune capture d'écran : références et seuils inchangés.
 *
 * Marché sans décimale : le double ne sert la réservation que dans son marché à deux décimales
 * (XTS) ; la variante PYG du parcours est prouvée de bout en bout par
 * apps/api/test/int/parcours-dores-reservation.int.test.ts (trou du double, passation US-221).
 */
import { randomBytes } from 'node:crypto';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey, Translator } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expect, submitAndSettle, tagOf, test } from './fixtures.ts';
import { AREA, CITY, place, PUBLIC_ID, START } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const PSP = /^https:\/\/psp\.fake\.invalid\/pay\/[0-9a-f-]{36}$/;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
/** TA01 (16 A.8.1) : total 128,40, rendu par l'API. */
const TA01_TOTAL = /128[.,]40/;
/** Trois jours facturés (TA01) : départ de la recherche, retour trois jours plus tard. */
const END = { date: '2036-12-13', time: START.time } as const;
const MAIN = 'main:not([aria-busy])';
const LANGUAGE = 'es' as const;
const MARK = '\u0001';

const translator = (): Translator => createTranslator(getProfile(LOCALE_CONFIG, tagOf(LANGUAGE)));
const fixedPart = (t: Translator, key: MessageKey, param: string): string =>
  t.t(key, { [param]: MARK }).split(MARK)[0] ?? '';

test.describe(`parcours doré « réservation » · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('S01 → résultats → S03 → S05 → hold → « Pagar 128,40 » → PSP → webhook signé → S06 confirmé', async ({
    page,
    context,
    offsite,
  }) => {
    const t = translator();
    await context.addCookies([
      {
        name: '__Host-session',
        value: `G0st${LANGUAGE}${randomBytes(30).toString('base64url').slice(0, 37)}`,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    // S01 : lieu et dates, heures locales du pays du double
    await page.goto('/');
    const form = page.locator('form[role="search"]');
    await page.locator('#s01-search-place').selectOption(place(CITY, AREA));
    await page.locator('#s01-search-startDate').fill(START.date);
    await page.locator('#s01-search-startTime').selectOption(START.time);
    await page.locator('#s01-search-endDate').fill(END.date);
    await page.locator('#s01-search-endTime').selectOption(END.time);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/search\?/);

    // résultats → S03 de l'annonce, dates reprises de la recherche
    await page
      .locator('[data-testid="search-card"]')
      .locator(`a[href^="/listings/${PUBLIC_ID}?"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/listings/${PUBLIC_ID}\\?`));
    const fiche = new URL(page.url());
    expect(fiche.searchParams.get('start')).toBe(`${START.date}T${START.time}`);
    expect(fiche.searchParams.get('end')).toBe(`${END.date}T${END.time}`);

    // S03 → S05 : devis figé de la base, conducteur titulaire, documents acceptés → hold posé
    await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
    await page.locator('#s05-driver-first').fill('Lucía');
    await page.locator('#s05-driver-last').fill('Gómez');
    for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
      await page.locator(`#s05-doc-${kind}`).check();
    }
    await submitAndSettle(page, page.locator('[data-testid="s05-submit"]'), HOLD_URL);
    const holdId = HOLD_URL.exec(new URL(page.url()).pathname)?.[1];
    if (holdId === undefined) throw new Error('hold non posé');

    // « Pagar {amount} » : total de l'API ; la page hébergée du PSP est la seule sortie du site
    const pay = page.locator('[data-testid="s05-pay-submit"]');
    await expect(pay).toContainText(TA01_TOTAL);
    let hosted = '';
    await page.route(/^https:\/\/psp\.fake\.invalid\//, (route) => {
      hosted = route.request().url();
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>psp</title><main>psp</main>',
      });
    });
    await pay.click();
    await expect(page).toHaveURL(PSP);
    expect(offsite).toEqual([hosted]);
    offsite.splice(0);
    await page.unroute(/^https:\/\/psp\.fake\.invalid\//);

    // retour du PSP : en vérification, jamais « confirmé » avant la preuve signée (UX-27)
    await page.goto(`/checkout/hold/${holdId}/payment`);
    const title = page.locator('[data-testid="s06-title"]');
    await expect(title).toHaveAttribute('data-state', 'VERIFYING');
    await expect(title).toHaveText(t.t('web.s06.verifying.title'));
    await expect(page.locator(MAIN)).not.toContainText(t.t('web.s07.title'));

    // webhook FAKE signé et conversion (double) : trip né, S06 confirmé
    const r = await fetch(`${API}/__e2e/payment/webhook?hold=${holdId}&event=SUCCEEDED`);
    expect(r.status).toBe(200);
    await page.goto(`/checkout/hold/${holdId}/payment`);
    await expect(title).toHaveAttribute('data-state', 'CONFIRMED');
    await expect(title).toHaveText(t.t('web.s07.title'));
    await expect(page.locator(MAIN)).toContainText(t.t('web.s06.confirmed.body'));
    await expect(page.locator('[data-testid="s07-documents"]')).toHaveText(
      t.t('web.s07.documents'),
    );
    await expect(page.locator('[data-testid="s07-safety"]')).toContainText(
      fixedPart(t, 'web.s07.safety', 'brand'),
    );
  });
});
