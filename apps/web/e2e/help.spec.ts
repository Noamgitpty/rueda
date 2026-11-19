/**
 * Aide et urgence (S17) — US-310, comme un utilisateur réel, à 360 px seulement, contre le build de
 * production du site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site).
 * Une seule langue ici (job e2e proche de sa limite ; les quatre langues sont prouvées par les
 * catalogues et les tests de rendu) :
 *
 * - l'aide est dans l'en-tête de chaque écran et ouvre S17 : numéro d'urgence du pays (lien
 *   d'appel), autorité de circulation, et, numéros de l'assureur et du support ABSENTS (donnée du
 *   fondateur), le renvoi à l'aide dans l'appli : aucun numéro inventé, aucun horaire promis ;
 * - depuis S09 : l'aide du trip, puis la demande d'aide à motif fermé ; « Recibimos tu solicitud »
 *   et la réponse automatique hors plage annoncée ; aucun téléphone de l'hôte à l'écran ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-310, 16 SUP-004 / SUP-020, 10b S17 ; textes : catalogue officiel
 * (`@rueda/i18n`), jamais le code testé.
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

test.describe(`Aide et urgence S17 · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('en-tête → S17 : urgence du pays, renvoi à l’appli sans numéro inventé ; S09 → aide du trip → demande enregistrée, réponse hors plage annoncée', async ({
    page,
    context,
  }) => {
    // l'aide depuis l'en-tête de l'accueil (UX-05, WCAG 3.2.6)
    await page.goto('/');
    await page.locator('[data-testid="shell-help"]').click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page).toHaveTitle(t.t('web.help.title'));
    const main = page.locator(MAIN);
    const emergency = main.locator('a[href="tel:911"]');
    await expect(emergency).toHaveText(t.t('web.help.emergency.call', { number: '911' }));
    await expect(main).toContainText(
      t.t('web.help.emergency.accident', { authority: t.t('common.help.authority.attt') }),
    );
    // numéros de l'assureur et du support absents : renvoi à l'aide dans l'appli
    await expect(main).toContainText(t.t('web.help.roadside.inApp'));
    await expect(main).toContainText(t.t('web.help.support.inApp'));
    await expect(main).toContainText(t.t('web.help.support.noHours'));
    // aucun autre lien d'appel que celui des urgences ; aucun numéro E.164 inventé
    await expect(main.locator('a[href^="tel:"]')).toHaveCount(1);
    await expect(main).not.toContainText(/\+[0-9]{7,}/);
    await expectAccessible(page);
    await expectMobileFriendly(page);

    // depuis le trip : S09 → aide du trip → demande d'aide
    await cookie(context, guestToken());
    const tripId = await bookTrip(page);
    await page.goto(`/trips/${tripId}`);
    await page.locator('[data-testid="s09-help-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/help$`));
    await expect(page).toHaveTitle(t.t('web.help.trip.title'));
    await expect(page.locator('[data-testid="s17-trip-emergencyCall"]')).toHaveAttribute(
      'href',
      'tel:911',
    );
    await expectAccessible(page);
    // motif obligatoire : rien n'est envoyé sans choix
    await page.locator('[data-testid="s17-request-submit"]').click();
    await expect(page.locator(MAIN)).toContainText(t.t('web.help.request.topicRequired'));
    await page.locator('[data-testid="s17-topic-BREAKDOWN"]').check();
    await page.locator('[data-testid="s17-request-submit"]').click();
    const sent = page.locator('[data-testid="s17-request-sent"]');
    await expect(sent).toContainText(t.t('web.help.request.sent'));
    await expect(sent).toContainText(t.t('web.help.request.offHours'));
    // jamais le téléphone de l'hôte, ni aucun numéro E.164
    await expect(page.locator(MAIN)).not.toContainText(/\+[0-9]{7,}/);
    await expectAccessible(page);
    await expectMobileFriendly(page);
  });
});
