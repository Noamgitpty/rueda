/**
 * Parcours e2e du voyageur d'une réservation signalée (US-209 partie 209c, ADR-144 ; 19 US-209
 * critères 2 et 4 ; 16 BKG-014, VER-007 ; 10b S05, UX-35, UXQ-08 ; N-203), sur le double de l'API
 * (e2e/stub-api.mjs) : départ le 19 décembre ⇒ hold de revue avant le débit, décision de l'ops jouée
 * par `GET /__e2e/review`.
 *
 * Attendus : 10b §4.3 (`web.s05.review.title`, e2e/oracle.ts) et, pour chaque langue (pt-BR
 * compris), les textes du catalogue officiel ; heures limites rendues par l'API du double (échéance
 * de la revue, puis fenêtre de paiement après l'approbation), jamais une durée écrite :
 * - en revue : « Reserva en revisión: no se te cobró nada », heure de la réponse, AUCUN bouton
 *   « Pagar » (N-203) ; relecture toutes les 30 s (horloge de Playwright avancée) ;
 * - approuvée : la région vive annonce l'approbation, le focus passe au titre de la revue, « Pagar »
 *   revient avec le total rendu par l'API (TA01) et l'heure limite réelle ;
 * - refusée ou non revue dans le délai : S05 ouvre S06 « Reserva no aprobada », sans paiement ;
 * - déclaration d'entrée (statut, date mise en forme par langue) depuis S04.
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
  FROZEN_AT,
  LANGUAGES,
  submitAndSettle,
  tagOf,
  test,
} from './fixtures.ts';
import type { Language } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const S06_URL = /\/checkout\/hold\/[0-9a-f-]{36}\/payment$/;
/** Données du double : échéance de la revue, puis fin de la fenêtre de paiement après l'approbation. */
const REVIEW_UNTIL = '2036-11-30T17:00:00.000Z';
const APPROVED_UNTIL = '2036-11-30T15:40:00.000Z';
/** Fuseau de la fiche du double (données fictives). */
const LISTING_TZ = 'UTC';
/** TA01 (16 A.8.1) : total 128,40, rendu par l'API. */
const TA01_TOTAL = /128[.,]40/;
const MAIN = 'main:not([aria-busy])';
const PASSWORD = 'Correct-Horse-9';

const translator = (language: Language): Translator =>
  createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));

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

/** S03 → S05 → hold posé (départ le 19 : réservation signalée) ; rend l'identifiant du hold. */
async function placeFlaggedHold(page: Page): Promise<string> {
  const q = new URLSearchParams({ start: '2036-12-19T10:00', end: '2036-12-22T10:00' });
  await page.goto(`/listings/${PUBLIC_ID}?${q.toString()}`);
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

/** Décision de l'ops jouée par le double. */
async function decide(holdId: string, decision: 'APPROVED' | 'REJECTED' | 'LAPSE') {
  const r = await fetch(`${API}/__e2e/review?hold=${holdId}&decision=${decision}`);
  expect(r.status).toBe(200);
}

for (const language of LANGUAGES) {
  test.describe(`réservation signalée S05 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('N-203 : en revue ⇒ « Reserva en revisión », heure de la réponse lue dans l’API, aucun « Pagar » ; approuvée ⇒ annoncée (région vive, focus), « Pagar 128,40 » et fenêtre de paiement réelle', async ({
      page,
      context,
    }) => {
      await page.clock.install({ time: FROZEN_AT });
      await signInGuest(context, language);
      const holdId = await placeFlaggedHold(page);
      const t = translator(language);
      await expect(page).toHaveTitle(/\S/);
      const review = page.locator('[data-testid="s05-review"]');
      await expect(review).toHaveAttribute('data-state', 'PENDING');
      const spec = SPEC_TEXT.reviewTitle[language];
      if (spec !== undefined) await expect(page.locator('#s05-review-title')).toHaveText(spec);
      await expect(page.locator('#s05-review-title')).toHaveText(t.t('web.s05.review.title'));
      await expect(review).toContainText(
        t.t('web.s05.review.until', { time: t.time(REVIEW_UNTIL, LISTING_TZ) }),
      );
      await expect(review).toContainText(t.t('web.s05.review.comeBack'));
      // aucun bouton de paiement pendant la revue (UXQ-08, N-203)
      await expect(page.locator('[data-testid="s05-pay"]')).toHaveCount(0);
      await expect(page.locator(`${MAIN} section[aria-labelledby="s05-pay-title"]`)).toHaveCount(0);
      await expect(page.locator(MAIN)).not.toContainText(t.t('web.s05.pay.title'));
      // aide vers la déclaration d'entrée
      await expect(review.locator('a[href="/verify-identity/entry"]')).toHaveText(
        t.t('web.s04.entry.open'),
      );
      await expect(page.locator('[data-testid="s05-live"]')).toHaveText('');
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // approbation de l'ops : relecture automatique (30 s), sans action du voyageur
      await expect(page.locator('[data-testid="s05-review-watch"]')).toHaveAttribute(
        'data-armed',
        'true',
      );
      await decide(holdId, 'APPROVED');
      await page.clock.fastForward(30_100);
      await expect(review).toHaveAttribute('data-state', 'APPROVED');
      await expect(page).toHaveURL(HOLD_URL);
      await expect(page.locator('#s05-review-title')).toHaveText(
        t.t('web.s05.review.approvedTitle'),
      );
      const approved = t.t('web.s05.review.approvedBody', {
        time: t.time(APPROVED_UNTIL, LISTING_TZ),
      });
      await expect(review).toContainText(approved);
      await expect(page.locator('[data-testid="s05-live"]')).toContainText(
        t.t('web.s05.review.approvedTitle'),
      );
      await expect(page.locator('#s05-review-title')).toBeFocused();
      const pay = page.locator('[data-testid="s05-pay-submit"]');
      await expect(pay).toContainText(TA01_TOTAL);
      await expect(pay).toBeEnabled();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('revue refusée ⇒ S05 ouvre S06 « Reserva no aprobada », aucun débit ni paiement ; revue non faite dans le délai ⇒ même écran', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      const t = translator(language);
      for (const decision of ['REJECTED', 'LAPSE'] as const) {
        const holdId = await placeFlaggedHold(page);
        await decide(holdId, decision);
        await page.goto(`/checkout/hold/${holdId}`);
        await expect(page).toHaveURL(S06_URL);
        await expect(page).toHaveTitle(/\S/);
        const title = page.locator('[data-testid="s06-title"]');
        await expect(title).toHaveAttribute('data-state', 'ENDED');
        await expect(title).toHaveText(t.t('web.s06.reviewRejected.title'));
        await expect(page.locator(MAIN)).toContainText(t.t('web.s06.reviewRejected.body'));
        await expect(page.locator(`${MAIN} form`)).toHaveCount(0);
        await expect(page.locator(`${MAIN} a[href="/"]`)).toBeVisible();
        await expectAccessible(page);
        await expectMobileFriendly(page);
      }
    });
  });

  test.describe(`déclaration d’entrée S04 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('16 VER-007 : statut et date d’entrée ⇒ enregistrés, date dans la langue de la vue ; touriste sans date ⇒ erreur sur le champ ; date future ⇒ KYC_ENTRY_DATE_INVALID ; résident sans date ⇒ enregistré', async ({
      page,
    }, info) => {
      const t = translator(language);
      const email = `identity-${language}-entry-${info.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@example.test`;
      await page.goto('/login');
      await page.locator('#s15-login-email').fill(email);
      await page.locator('#s15-login-password').fill(PASSWORD);
      await page.locator('main form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/login\/done$/);

      // S04 propose la déclaration
      await page.goto('/verify-identity');
      await page.locator('main a[href="/verify-identity/entry"]').click();
      await expect(page).toHaveURL(/\/verify-identity\/entry$/);
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('h1')).toHaveText(t.t('web.s04.entry.title'));
      // aucun statut pré-coché
      await expect(page.locator('[data-testid="s04-entry-TOURIST"]')).not.toBeChecked();
      await expect(page.locator('[data-testid="s04-entry-RESIDENT"]')).not.toBeChecked();
      await expectAccessible(page);
      await expectMobileFriendly(page);
      const submit = page.locator('[data-testid="s04-entry-submit"]');

      // touriste sans date : erreur sur le champ, rien d'envoyé
      await page.locator('[data-testid="s04-entry-TOURIST"]').check();
      await submitAndSettle(page, submit);
      await expect(page.locator('#s04-entry-date-error')).toContainText(
        t.t('web.s04.entry.dateRequired'),
      );
      await expectAccessible(page);

      // date future (après le jour du double) : refus de l'API sur le champ
      await page.locator('[data-testid="s04-entry-TOURIST"]').check();
      await page.locator('#s04-entry-date').fill('2026-12-01');
      await submitAndSettle(page, submit);
      await expect(page.locator('#s04-entry-date-error')).toContainText(
        t.t('common.kyc.entryDateInvalid'),
      );

      // touriste avec la date d'entrée : enregistré, date dans la langue de la vue
      await page.locator('[data-testid="s04-entry-TOURIST"]').check();
      await page.locator('#s04-entry-date').fill('2026-11-01');
      await submitAndSettle(page, submit);
      const live = page.locator('[data-testid="s04-entry-live"]');
      await expect(live).toContainText(t.t('common.kyc.entryDeclared'));
      await expect(live).toContainText(
        t.t('web.s04.entry.savedTourist', { date: t.date('2026-11-01T12:00:00Z', 'UTC') }),
      );
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // résident sans date : enregistré
      await page.locator('[data-testid="s04-entry-RESIDENT"]').check();
      await page.locator('#s04-entry-date').fill('');
      await submitAndSettle(page, submit);
      await expect(live).toContainText(t.t('web.s04.entry.savedResident'));
    });
  });
}
