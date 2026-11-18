/**
 * Reçu du voyageur (S09 · reçu) et gains de l'hôte (A08) — US-217 partie 217b, comme un utilisateur
 * réel, à 360 px et en espagnol seulement (job e2e proche de sa limite ; les deux écrans passent
 * aussi par `screens.spec.ts` : quatre langues, axe à 360 et 390 px, captures), contre le build de
 * production du site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site) :
 *
 * - voyageur : S09 → « Ver el recibo » → total payé, trip fee et sa taxe de ligne, mention
 *   d'intermédiaire avec l'hôte en prénom et initiale (US-212 critère 3), reçu sans valeur fiscale ;
 *   après l'annulation : remboursement DÛ avec un lien vers S10 (jamais « remboursé »), trip fee
 *   conservé sans taxe rendue (ADR-167) ; un autre voyageur : même message qu'un reçu inconnu ;
 * - hôte : A10 → « Mis ganancias » → A08 ; mois sans gains : état vide ; mois du double : acquis et
 *   à liquider tels que l'API les rend, pénalité sur une ligne à part, versements fermés ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-217, US-214 critère 2, US-212 critère 3 ; 10b S09, A08 (UX-45) ; montants du
 * double rendus par `formatMoney` ; textes : catalogue officiel (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, submitAndSettle, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const CONTRACT_URL = /\/trips\/([0-9a-f-]{36})\/contract$/;
const MAIN = 'main:not([aria-busy])';
const LANGUAGE = 'es' as const;
/** Devise fictive du marché du double (exposant 2). */
const MARKET = { currency: 'XTS', exponent: 2 } as const;
/** Mois du double qui porte des gains (e2e/stub-api.mjs, EARNINGS_MONTH). */
const EARNINGS_MONTH = '2036-12';

const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(LANGUAGE)));
const money = (amountMinor: bigint) =>
  t.money({ amountMinor, currency: MARKET.currency, exponent: MARKET.exponent });

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
const hostToken = (): string => `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;

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

test.describe(`Reçu S09 · reçu et gains A08 · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('voyageur : S09 → reçu (total, trip fee et taxe, intermédiaire, sans valeur fiscale) ; annulé ⇒ remboursement dû et lien S10 ; reçu d’un autre ⇒ introuvable', async ({
    page,
    context,
  }) => {
    await cookie(context, guestToken());
    const tripId = await bookTrip(page);
    const main = page.locator(MAIN);
    await page.goto(`/trips/${tripId}`);
    await page.locator('[data-testid="s09-receipt"]').click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/receipt$`));
    await expect(page).toHaveTitle(t.t('web.s09.receipt.title'));

    await expect(page.locator('[data-testid="s09r-total"]')).toHaveText(money(12840n));
    await expect(page.locator('[data-testid="s09r-fee-charged"]')).toHaveText(money(1200n));
    await expect(page.locator('[data-testid="s09r-fee-tax"]')).toHaveText(money(84n));
    await expect(main).toContainText(t.t('web.s09.receipt.fee.tax', { rate: '7' }));
    await expect(page.locator('[data-testid="s09r-refund"]')).toHaveCount(0);
    // US-212 critère 3 : intermédiaire entre particuliers, hôte en prénom et initiale
    const intermediary = page.locator('[data-testid="s09r-intermediary"]');
    // marque de la coquille (donnée de thème) : la phrase est comparée après la marque
    const sentence = t.t('web.s09.receipt.intermediary', { brand: 'BRAND', host: 'María G.' });
    await expect(intermediary).toContainText(sentence.slice(sentence.indexOf('BRAND') + 5));
    await expect(main).not.toContainText(/María (?!G\.)\p{L}{2,}/u);
    await expect(page.locator('[data-testid="s09r-fiscal"]')).toHaveText(
      t.t('web.s09.receipt.fiscal'),
    );
    await expectAccessible(page);
    await expectMobileFriendly(page);

    // annulation réglée par le double : remboursement DÛ, trip fee conservé, aucune taxe rendue
    expect((await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=issued`)).status).toBe(
      200,
    );
    await page.reload();
    await expect(page.locator('[data-testid="s09r-refund-due"]')).toHaveText(money(8640n));
    await expect(page.locator('[data-testid="s09r-fee-refunded"]')).toHaveText(money(800n));
    await expect(page.locator('[data-testid="s09r-fee-retained"]')).toHaveText(money(400n));
    await expect(page.locator('[data-testid="s09r-fee-tax"]')).toHaveCount(0);
    await expect(main).toContainText(t.t('web.s09.receipt.fee.taxElsewhere'));
    await expectAccessible(page);
    await page.locator('[data-testid="s09r-refund-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/refund$`));

    // un autre voyageur : même message qu'un reçu inconnu
    await context.clearCookies();
    await cookie(context, guestToken());
    for (const id of [tripId, '21700000-0000-4000-8000-000000000099']) {
      await page.goto(`/trips/${id}/receipt`);
      await expect(page.locator(MAIN)).toContainText(t.t('common.receipt.notFound'));
      await expect(page.locator('[data-testid="s09r-total"]')).toHaveCount(0);
    }
  });

  test('hôte : A10 → A08 ; mois vide ; mois du double : acquis et à liquider de l’API, pénalité en ligne séparée, versements fermés', async ({
    page,
    context,
  }) => {
    await cookie(context, hostToken());
    await page.goto('/host');
    await page.locator('[data-testid="a10-earnings"]').click();
    await expect(page).toHaveURL(/\/host\/earnings\?org=[0-9a-f-]{36}$/);
    await expect(page).toHaveTitle(t.t('web.a08.title'));
    const org = new URL(page.url()).searchParams.get('org') ?? '';

    await page.goto(`/host/earnings?org=${org}&month=2036-11`);
    // 10b §4.3 `web.a08.empty` (oracle de la spécification, jamais le code testé)
    await expect(page.locator(MAIN)).toContainText(SPEC_TEXT.earningsEmpty[LANGUAGE] ?? '');
    await page.locator('[data-testid="a08-next"]').click();
    await expect(page).toHaveURL(new RegExp(`month=${EARNINGS_MONTH}$`));

    await expect(page.locator('[data-testid="a08-earned"]')).toHaveText(money(2000n));
    await expect(page.locator('[data-testid="a08-pending"]')).toHaveText(money(13125n));
    const penalty = page.locator('[data-testid="a08-line-ADJUSTMENT"]');
    await expect(penalty).toHaveCount(1);
    await expect(penalty).toContainText(t.t('web.a08.line.HOST_CANCELLATION_PENALTY'));
    await expect(penalty.locator('[data-testid="a08-amount"]')).toHaveText(money(-2500n));
    await expect(page.locator('[data-testid="a08-line-CXL_EARNING"]')).toHaveCount(2);
    const pending = page.locator('[data-testid="a08-line-EARNING"]');
    await expect(pending).toContainText(t.t('web.a08.line.pending'));
    await expect(pending.locator('[data-testid="a08-fee"]')).toHaveText(money(4375n));
    await expect(pending.locator('[data-testid="a08-amount"]')).toHaveText(money(13125n));
    await expect(page.locator(MAIN)).toContainText(
      t.t('web.a08.line.share', { plan: t.t('web.a11.plan.name.ESTANDAR'), share: '75' }),
    );
    await expectAccessible(page);
    await expectMobileFriendly(page);
  });
});
