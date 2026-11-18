/**
 * « Mis viajes » (S08) et détail du trip (S09) du voyageur — US-214, comme un utilisateur réel, à
 * 360 px seulement (ses deux écrans passent aussi par `screens.spec.ts` dans les quatre langues et à
 * 390 px), contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`, appelé
 * par le SERVEUR du site). Une seule langue ici (job e2e proche de sa limite) :
 *
 * - après la réservation : le trip à venir dans S08, son détail (S09) : lieu de remise et adresse,
 *   hôte en prénom et initiale, total tel que l'API le rend, contrat « à signer » qui mène à
 *   S09 · contrat, constancia et reçu annoncés, modification par le support (BR-MOD-01) ;
 * - après l'annulation : section « annulés », adresse retirée, lien vers le remboursement (S10) ;
 * - IDOR : un autre voyageur voit une liste vide et le même message qu'un trip inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-214, 16 BKG-027, 10b S08 / S09 ; textes : catalogue officiel (`@rueda/i18n`),
 * jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, submitAndSettle, tagOf, test } from './fixtures.ts';
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const CONTRACT_URL = /\/trips\/([0-9a-f-]{36})\/contract$/;
const MAIN = 'main:not([aria-busy])';
const LANGUAGE = 'es' as const;
/** Total du double dans la devise fictive du marché (exposant 2). */
const MARKET = { currency: 'XTS', exponent: 2 } as const;

const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(LANGUAGE)));

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

const guestToken = (): string =>
  `G0st${LANGUAGE}${randomBytes(30).toString('base64url').slice(0, 37)}`;

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
  const href = await page.locator('[data-testid="s06-contract"]').getAttribute('href');
  const tripId = CONTRACT_URL.exec(href ?? '')?.[1];
  if (tripId === undefined) throw new Error('trip absent');
  return tripId;
}

test.describe(`Mis viajes S08 / détail du trip S09 · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('S08 → S09 : trip à venir, lieu, hôte minimisé, total, contrat ; annulé ⇒ remboursement ; trip d’un autre ⇒ introuvable', async ({
    page,
    context,
  }) => {
    await cookie(context, guestToken());
    const tripId = await bookTrip(page);
    const main = page.locator(MAIN);

    await page.goto('/trips');
    await expect(page).toHaveTitle(t.t('web.s08.heading'));
    const upcoming = page.locator('[data-testid="s08-upcoming"]');
    await expect(upcoming.locator('h2')).toHaveText(t.t('web.s08.section.UPCOMING'));
    await expect(upcoming).toContainText(t.t('web.s08.host', { name: 'María G.' }));
    await expectAccessible(page);
    await upcoming.locator(`a[href="/trips/${tripId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));

    await expect(page).toHaveTitle(t.t('web.s09.heading'));
    await expect(page.locator('[data-testid="s09-address"]')).toBeVisible();
    await expect(page.locator('[data-testid="s09-total"]')).toHaveText(
      t.money({ amountMinor: 12840n, currency: MARKET.currency, exponent: MARKET.exponent }),
    );
    const documents = page.locator('[data-testid="s09-documents"]');
    await expect(documents).toContainText(t.t('web.s09.documents.contract.TO_SIGN'));
    await expect(documents).toContainText(t.t('web.s09.documents.constancia'));
    await expect(documents).toContainText(t.t('web.s09.documents.receipt'));
    await expect(main).toContainText(t.t('web.s09.changes'));
    // aucune plaque ni nom complet de l'hôte
    await expect(main).not.toContainText('Gómez');
    await expect(page.locator('[data-testid="s09-refund"]')).toHaveCount(0);
    await expectAccessible(page);
    await expectMobileFriendly(page);
    await page.locator('[data-testid="s09-contract"]').click();
    await expect(page).toHaveURL(CONTRACT_URL);

    // annulation réglée par le double : section « annulés », adresse retirée, lien vers S10
    expect((await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=issued`)).status).toBe(
      200,
    );
    await page.goto('/trips');
    await expect(page.locator('[data-testid="s08-cancelled"]')).toBeVisible();
    await expect(page.locator('[data-testid="s08-upcoming"]')).toHaveCount(0);
    await page.goto(`/trips/${tripId}`);
    await expect(page.locator('[data-testid="s09-address"]')).toHaveCount(0);
    await expect(main).toContainText(t.t('web.s09.place.hidden'));
    await page.locator('[data-testid="s09-refund"]').click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/refund$`));

    // un autre voyageur : liste vide, même message que l'inconnu
    await context.clearCookies();
    await cookie(context, guestToken());
    await page.goto('/trips');
    await expect(page.locator(MAIN)).toContainText(t.t('web.s08.none'));
    for (const id of [tripId, '21400000-0000-4000-8000-000000000099']) {
      await page.goto(`/trips/${id}`);
      await expect(page.locator(MAIN)).toContainText(t.t('common.trips.notFound'));
      await expect(page.locator('[data-testid="s09-documents"]')).toHaveCount(0);
    }
    await expectAccessible(page);
  });
});
