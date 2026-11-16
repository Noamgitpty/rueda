/**
 * Parcours e2e du paiement du hold (US-223 partie 223b, ADR-142 ; 19 US-223 ; 10b S05, S06, UX-26,
 * UX-27 ; 16 PAY-034), sur le double de l'API (e2e/stub-api.mjs) : S03 → S05 → hold posé →
 * « Pagar {amount} » → page hébergée du PSP (adresse `https://psp.fake.invalid/…`, interceptée :
 * aucun réseau externe) → webhook FAKE joué par le double → S06.
 *
 * Attendus : 10b (textes `web.s06.verifying.*` de §4.3, lus dans `oracle.ts`), TA01 (total 128,40
 * rendu par l'API, jamais recalculé par le site) ; S06 ne dit « confirmé » qu'une fois le hold
 * converti en trip (webhook SUCCEEDED) ; un webhook au montant différent (MISMATCH) ne confirme
 * rien ; un refus garde le hold et propose « Pagar de nuevo » ; un hold échu sans paiement sort vers
 * la recherche (N-169) ; un ordre non prouvé à l'échéance renvoie au support ; un paiement après la
 * libération annonce le remboursement intégral du montant rendu par l'API. Refus avant le paiement :
 * capacité bloquante du PSP (critère 6), revue avant débit, aucun compte marchand.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
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
import { SPEC_TEXT } from './oracle.ts';
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const PSP = /^https:\/\/psp\.fake\.invalid\/pay\/[0-9a-f-]{36}$/;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const S06_URL = /\/checkout\/hold\/[0-9a-f-]{36}\/payment$/;
/** TA01 (16 A.8.1) : total 128,40, rendu par l'API. */
const TA01_TOTAL = /128[.,]40/;
/** Page rendue (le repli de chargement porte aussi un `main`, `aria-busy`). */
const MAIN = 'main:not([aria-busy])';

const slot = (day: number) => ({
  start: `2036-12-${String(day).padStart(2, '0')}T10:00`,
  end: `2036-12-${String(day + 3).padStart(2, '0')}T10:00`,
});

async function signInGuest(context: BrowserContext, language: Language): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `G0st${language}${randomBytes(30).toString('base64url').slice(0, 37)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/** S03 → S05 → hold posé ; rend l'identifiant du hold. */
async function placeHold(page: Page, day: number): Promise<string> {
  await page.goto(`/listings/${PUBLIC_ID}?${new URLSearchParams(slot(day)).toString()}`);
  await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await page.locator('#s05-driver-first').fill('Lucía');
  await page.locator('#s05-driver-last').fill('Gómez');
  for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
    await page.locator(`#s05-doc-${kind}`).check();
  }
  await submitAndSettle(page, page.locator('[data-testid="s05-submit"]'), HOLD_URL);
  const id = HOLD_URL.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error('hold non posé');
  return id;
}

/** « Pagar » : la page hébergée du PSP (interceptée) est la seule sortie du site. */
async function payAt(page: Page, offsite: string[], button: string): Promise<void> {
  let hosted = '';
  await page.route(/^https:\/\/psp\.fake\.invalid\//, (route) => {
    hosted = route.request().url();
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>psp</title><main>psp</main>',
    });
  });
  await page.locator(`[data-testid="${button}-submit"]`).click();
  await expect(page).toHaveURL(PSP);
  expect(hosted).toMatch(PSP);
  expect(offsite).toEqual([hosted]);
  offsite.splice(0);
  await page.unroute(/^https:\/\/psp\.fake\.invalid\//);
}

/** Webhook FAKE signé et conversion, joués par le double. */
async function webhook(holdId: string, event: string): Promise<void> {
  const r = await fetch(`${API}/__e2e/payment/webhook?hold=${holdId}&event=${event}`);
  expect(r.status).toBe(200);
}

async function openS06(page: Page, holdId: string, state: string): Promise<void> {
  await page.goto(`/checkout/hold/${holdId}/payment`);
  await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute('data-state', state);
}

for (const language of LANGUAGES) {
  test.describe(`paiement S05 → S06 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('bout en bout : « Pagar 128,40 » → page du PSP → MISMATCH ne confirme rien → webhook SUCCEEDED → S06 confirmé ; le hold payé ne repart pas', async ({
      page,
      context,
      offsite,
    }) => {
      await signInGuest(context, language);
      const holdId = await placeHold(page, 10);
      // S05 : bouton de paiement avec le total rendu par l'API (10b S05 « Pagar {amount} »)
      const pay = page.locator('[data-testid="s05-pay-submit"]');
      await expect(pay).toContainText(TA01_TOTAL);
      await expect(page.locator('section[aria-labelledby="s05-pay-title"]')).toContainText(
        TA01_TOTAL,
      );
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await payAt(page, offsite, 's05-pay');

      // retour du PSP : « Pago en verificación », jamais « confirmé » avant le webhook (UX-27)
      await openS06(page, holdId, 'VERIFYING');
      await expect(page).toHaveTitle(/\S/);
      const title = SPEC_TEXT.verifyingTitle[language];
      if (title !== undefined) await expect(page.locator('h1')).toHaveText(title);
      const body = SPEC_TEXT.verifyingBody[language];
      if (body !== undefined) await expect(page.locator(MAIN)).toContainText(body);
      await expect(page.locator(`${MAIN} button[disabled]`)).toHaveCount(1);
      await expect(page.locator('[data-testid="s06-reference"]')).toContainText(
        holdId.slice(0, 8).toUpperCase(),
      );
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // montant reçu différent (MISMATCH) : rien n'est appliqué, toujours en vérification
      await webhook(holdId, 'MISMATCH');
      await openS06(page, holdId, 'VERIFYING');

      // webhook signé SUCCEEDED, conversion : trip né, S06 confirmé
      await webhook(holdId, 'SUCCEEDED');
      await openS06(page, holdId, 'CONFIRMED');
      await expect(page.locator(`${MAIN} [role="status"]`).first()).toBeVisible();
      await expect(page.locator(`${MAIN} a[href="/listings/${PUBLIC_ID}"]`)).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // S05 du hold payé : l'état fait foi (S06), aucun second paiement
      await page.goto(`/checkout/hold/${holdId}`);
      await expect(page).toHaveURL(S06_URL);
      await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute(
        'data-state',
        'CONFIRMED',
      );
    });

    test('refus du PSP : aucun débit, hold gardé, « Pagar de nuevo » crée un nouvel ordre ; ordre non prouvé à l’échéance ⇒ support', async ({
      page,
      context,
      offsite,
    }) => {
      await signInGuest(context, language);
      const holdId = await placeHold(page, 10);
      await payAt(page, offsite, 's05-pay');
      await webhook(holdId, 'FAILED');
      await openS06(page, holdId, 'DECLINED');
      await expect(page.locator(`${MAIN} [role="alert"]`).first()).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      await payAt(page, offsite, 's06-pay-again');
      // aucune preuve avant l'échéance du hold : ni confirmé ni « payer de nouveau »
      await webhook(holdId, 'EXPIRE');
      await openS06(page, holdId, 'UNPROVEN');
      await expect(page.locator('section[aria-labelledby="s06-support"]')).toBeVisible();
      await expect(page.locator(`${MAIN} form`)).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('N-169 : hold échu sans paiement ⇒ S05 renvoie à S06 « expirée », sortie vers la recherche ; payé après la libération ⇒ remboursement intégral de 128,40', async ({
      page,
      context,
      offsite,
    }) => {
      await signInGuest(context, language);
      const ended = await placeHold(page, 10);
      await webhook(ended, 'EXPIRE');
      await page.goto(`/checkout/hold/${ended}`);
      await expect(page).toHaveURL(S06_URL);
      await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute(
        'data-state',
        'ENDED',
      );
      await expect(page.locator(`${MAIN} a[href="/"]`)).toBeVisible();
      await expectAccessible(page);

      const late = await placeHold(page, 2);
      await payAt(page, offsite, 's05-pay');
      await webhook(late, 'EXPIRE');
      await webhook(late, 'SUCCEEDED');
      await openS06(page, late, 'REFUND_DUE');
      await expect(page.locator(`${MAIN} [role="status"]`).first()).toContainText(TA01_TOTAL);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    for (const [day, code] of [
      [18, 'HOST_PAYOUT_RAIL_UNAVAILABLE'],
      [19, 'BOOKING_UNDER_REVIEW'],
      [21, 'PAYMENT_UNAVAILABLE'],
    ] as const) {
      test(`refus avant le paiement (${code}) : message sur S05, aucune sortie vers le PSP, hold gardé`, async ({
        page,
        context,
      }) => {
        await signInGuest(context, language);
        const holdId = await placeHold(page, day);
        await submitAndSettle(page, page.locator('[data-testid="s05-pay-submit"]'));
        await expect(page).toHaveURL(new RegExp(`/checkout/hold/${holdId}$`));
        await expect(page.locator('[data-testid="s05-pay"] [role="alert"]')).toBeVisible();
        await expectAccessible(page);
        await expectMobileFriendly(page);
      });
    }
  });
}
