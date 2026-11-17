/**
 * Remboursement d'un trip — S10 · remboursement (voyageur) et A05 (hôte), US-224 partie 224d, comme
 * un utilisateur réel, à 360 px (ses écrans passent aussi par `screens.spec.ts`), dans les quatre
 * langues, contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`, appelé
 * par le SERVEUR du site).
 *
 * - avant toute annulation : « aucun remboursement » et ce qui s'affichera (montant, date
 *   d'émission) ;
 * - remboursement émis : montant tel que l'API le rend (−TJ02b, 187,44 dans la devise fictive),
 *   « Émis le {date} » à la date du fuseau du trip (BR-PAY-08 : jamais une date de réception),
 *   délai de la banque, moyen d'origine ; Kmino rembourse, sans attendre l'hôte ;
 * - hôte (A05) : la seule part de la jambe HOST (86,25), « en préparation », jamais le montant du
 *   voyageur ;
 * - IDOR : le remboursement d'un autre ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-224 critère 1, 08 E7 / SM-8 / BR-PAY-08, 10b S10 / UX-31 ; textes : catalogue
 * officiel (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
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
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const CONTRACT_URL = /\/trips\/([0-9a-f-]{36})\/contract$/;
const MAIN = 'main:not([aria-busy])';
/** Montants du double : −TJ02b (08 E7) dans la devise fictive du marché (exposant 2). */
const MARKET = { currency: 'XTS', exponent: 2 } as const;
const ISSUED_AT = '2036-12-05T14:00:10.000Z';

const translator = (language: Language): Translator =>
  createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
const money = (t: Translator, minor: bigint): string =>
  t.money({ amountMinor: minor, currency: MARKET.currency, exponent: MARKET.exponent });

async function cookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

const guestToken = (language: Language): string =>
  `G0st${language}${randomBytes(30).toString('base64url').slice(0, 37)}`;

/** S03 → S05 → hold → paiement confirmé (webhooks FAKE du double) → S06 → trip né. */
async function bookTrip(page: Page): Promise<string> {
  const q = new URLSearchParams({ start: '2036-12-10T10:00', end: '2036-12-13T10:00' });
  await page.goto(`/listings/${PUBLIC_ID}?${q.toString()}`);
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
  for (const event of ['PAY', 'SUCCEEDED']) {
    const r = await fetch(`${API}/__e2e/payment/webhook?hold=${holdId}&event=${event}`);
    expect(r.status).toBe(200);
  }
  await page.goto(`/checkout/hold/${holdId}/payment`);
  await page.locator('[data-testid="s06-contract"]').click();
  await expect(page).toHaveURL(CONTRACT_URL);
  const tripId = CONTRACT_URL.exec(new URL(page.url()).pathname)?.[1];
  if (tripId === undefined) throw new Error('trip absent');
  return tripId;
}

for (const language of LANGUAGES) {
  test.describe(`remboursement S10 / A05 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('S10 : aucun remboursement avant l’annulation ; émis ⇒ montant, date d’émission, délai de la banque, moyen d’origine ; remboursement d’un autre ⇒ introuvable', async ({
      page,
      context,
    }) => {
      const t = translator(language);
      await cookie(context, guestToken(language));
      const tripId = await bookTrip(page);
      const main = page.locator(MAIN);

      await page.goto(`/trips/${tripId}/refund`);
      await expect(page).toHaveTitle(t.t('web.s10.refund.title'));
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(main).toContainText(t.t('web.s10.refund.none'));
      await expect(main).toContainText(t.t('web.s10.refund.noneHint'));
      await expectAccessible(page);

      expect((await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=issued`)).status).toBe(
        200,
      );
      await page.reload();
      await expect(page.locator('[data-testid="s10-refund-title"]')).toHaveText(
        t.t('web.s10.refund.title'),
      );
      await expect(main).toContainText(t.t('web.s10.refund.lead'));
      await expect(page.locator('[data-testid="s10-refund-amount"]')).toHaveText(money(t, 18744n));
      await expect(main).toContainText(t.t('web.refund.status.ISSUED'));
      await expect(page.locator('[data-testid="refund-issued"]')).toHaveText(
        t.t('web.refund.issuedOn', { date: t.date(ISSUED_AT, 'UTC') }),
      );
      await expect(main).toContainText(t.t('web.refund.bankDelay'));
      await expect(main).toContainText(t.t('web.s10.refund.rail.NATIVE_PARTIAL'));
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // un autre voyageur : même message que l'inconnu, aucun montant
      await context.clearCookies();
      await cookie(context, guestToken(language));
      for (const id of [tripId, '22400000-0000-4000-8000-000000000099']) {
        await page.goto(`/trips/${id}/refund`);
        await expect(page.locator(MAIN)).toContainText(t.t('common.refund.notFound'));
        await expect(page.locator('[data-testid="s10-refunds"]')).toHaveCount(0);
      }
      await expectAccessible(page);
    });

    test('A05 : l’hôte lit la seule part de sa jambe (en préparation), jamais le montant du voyageur', async ({
      page,
      context,
    }) => {
      const t = translator(language);
      await cookie(context, `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`);
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
      await page.goto('/host');
      await page
        .locator('section[aria-labelledby="a02-upcoming"] li a[href^="/host/trips/"]')
        .first()
        .click();
      await expect(page).toHaveURL(/\/host\/trips\/[0-9a-f-]{36}\?org=/);
      // aucun remboursement : aucune section
      await expect(page.locator('[data-testid="a05-refunds"]')).toHaveCount(0);
      await expect(page.locator(MAIN)).not.toContainText(t.t('web.a05.refund.title'));

      const tripId = /\/host\/trips\/([0-9a-f-]{36})\?/.exec(page.url())?.[1] ?? '';
      expect(
        (await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=preparing`)).status,
      ).toBe(200);
      await page.reload();
      const section = page.locator('section[aria-labelledby="a05-refund-title"]');
      await expect(section.locator('h2')).toHaveText(t.t('web.a05.refund.title'));
      await expect(section).toContainText(t.t('web.a05.refund.lead'));
      await expect(page.locator('[data-testid="a05-refund-host-leg"]')).toHaveText(
        t.t('web.a05.refund.hostLeg', { amount: money(t, 8625n) }),
      );
      await expect(section).toContainText(t.t('web.refund.status.PREPARING'));
      await expect(section).toContainText(t.t('web.refund.preparing'));
      // jambe HOST seulement : ni le montant du voyageur, ni son moyen de paiement
      await expect(page.locator(MAIN)).not.toContainText(money(t, 18744n));
      await expect(section).not.toContainText(t.t('web.s10.refund.rail.NATIVE_PARTIAL'));
      await expect(section).not.toContainText(t.t('web.refund.bankDelay'));
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
