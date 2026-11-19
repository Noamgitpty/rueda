/**
 * Parcours e2e du paiement du hold (US-223 partie 223b, ADR-142 ; 19 US-223 ; 10b S05, S06, UX-26,
 * UX-27 ; 16 PAY-034), sur le double de l'API (e2e/stub-api.mjs) : S03 → S05 → hold posé →
 * « Pagar {amount} » → page hébergée du PSP (adresse `https://psp.fake.invalid/…`, interceptée :
 * aucun réseau externe) → webhook FAKE joué par le double → S06.
 *
 * Attendus : 10b (textes `web.s06.verifying.*` de §4.3, lus dans `oracle.ts`), TA01 (total 128,40
 * rendu par l'API, jamais recalculé par le site) ; pour chaque état, le titre et le message attendus
 * de CET état dans la langue de la page (clés du catalogue officiel, quatre langues, pt-BR compris),
 * et le titre « confirmé » absent de tout autre état. S06 ne dit « confirmé » qu'une fois le hold
 * converti en trip (webhook SUCCEEDED) ; un webhook au montant différent (MISMATCH) ne confirme
 * rien ; un refus garde le hold et propose « Pagar de nuevo » ; une page de paiement non ouverte se
 * reprend ; un hold échu sans paiement sort vers la recherche (N-169) ; un ordre non prouvé à
 * l'échéance renvoie au support ; un paiement après la libération annonce le remboursement intégral.
 * Relecture toutes les 5 s, attente lente à 2 min et support à 10 min : horloge de Playwright
 * avancée (`clock.fastForward`), aucune attente réelle. Refus avant le paiement : capacité bloquante
 * du PSP (critère 6), aucun compte marchand ; la revue avant le débit n'offre aucun bouton
 * « Pagar » (US-209c, `checkout-review.spec.ts`).
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey, Translator } from '@rueda/i18n';
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
const PSP = /^https:\/\/psp\.fake\.invalid\/pay\/[0-9a-f-]{36}$/;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const S06_URL = /\/checkout\/hold\/[0-9a-f-]{36}\/payment$/;
/** TA01 (16 A.8.1) : total 128,40, rendu par l'API. */
const TA01_TOTAL = /128[.,]40/;
/** Page rendue (le repli de chargement porte aussi un `main`, `aria-busy`). */
const MAIN = 'main:not([aria-busy])';
const MARK = '\u0001';

const slot = (day: number) => ({
  start: `2036-12-${String(day).padStart(2, '0')}T10:00`,
  end: `2036-12-${String(day + 3).padStart(2, '0')}T10:00`,
});

const translator = (language: Language): Translator =>
  createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));

/** Partie fixe d'un message à paramètre (avant la valeur). */
const fixedPart = (t: Translator, key: MessageKey, param: string): string =>
  t.t(key, { [param]: MARK }).split(MARK)[0] ?? '';

/** Titre et message attendus de chaque état final ou d'attente (clés du catalogue officiel). */
function expectedOf(t: Translator, state: string): { title: string; body: string } {
  switch (state) {
    case 'VERIFYING':
      return { title: t.t('web.s06.verifying.title'), body: t.t('web.s06.verifying.body') };
    case 'INTERRUPTED':
      return { title: t.t('web.s06.interrupted.title'), body: t.t('web.s06.interrupted.body') };
    case 'CONFIRMED':
      return { title: t.t('web.s07.title'), body: t.t('web.s06.confirmed.body') };
    case 'DECLINED':
      return {
        title: t.t('web.s06.declined.title'),
        body: fixedPart(t, 'web.error.paymentDeclined', 'hold_end_time'),
      };
    case 'ENDED':
      return { title: t.t('web.s06.ended.title'), body: t.t('web.s06.ended.body') };
    case 'UNPROVEN':
      return { title: t.t('web.s06.unproven.title'), body: t.t('web.s06.unproven.body') };
    default:
      return {
        title: t.t('web.s06.refund.title'),
        body: fixedPart(t, 'web.error.paidAfterRelease', 'amount'),
      };
  }
}

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

/** Textes de l'état dans la langue de la page ; « confirmé » absent de tout autre état. */
async function expectStateTexts(page: Page, language: Language, state: string): Promise<void> {
  const t = translator(language);
  const { title, body } = expectedOf(t, state);
  await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute('data-state', state);
  await expect(page.locator('[data-testid="s06-title"]')).toHaveText(title);
  await expect(page.locator(MAIN)).toContainText(body);
  if (state !== 'CONFIRMED') {
    await expect(page.locator(MAIN)).not.toContainText(t.t('web.s07.title'));
  }
}

async function openS06(page: Page, language: Language, holdId: string, state: string) {
  await page.goto(`/checkout/hold/${holdId}/payment`);
  await expectStateTexts(page, language, state);
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
      await openS06(page, language, holdId, 'VERIFYING');
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
      await openS06(page, language, holdId, 'VERIFYING');

      // webhook signé SUCCEEDED, conversion : trip né, S06 confirmé
      await webhook(holdId, 'SUCCEEDED');
      await openS06(page, language, holdId, 'CONFIRMED');
      await expect(page.locator(`${MAIN} a[href="/listings/${PUBLIC_ID}"]`)).toBeVisible();
      // US-213 (10b S07) : numéro du TRIP né (préfixe fixe du double), pièces à présenter,
      // conseils de sécurité ; jamais un numéro de téléphone de l'hôte
      const tc = translator(language);
      await expect(page.locator('[data-testid="s06-reference"]')).toContainText('21300000');
      await expect(page.locator('[data-testid="s07-documents"]')).toHaveText(
        tc.t('web.s07.documents'),
      );
      await expect(page.locator('[data-testid="s07-safety"]')).toContainText(
        fixedPart(tc, 'web.s07.safety', 'brand'),
      );
      await expect(page.locator(MAIN)).not.toContainText(/\+\d{7,}/);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // S05 du hold payé : l'état fait foi (S06), aucun second paiement
      await page.goto(`/checkout/hold/${holdId}`);
      await expect(page).toHaveURL(S06_URL);
      await expectStateTexts(page, language, 'CONFIRMED');
    });

    test('UX-27 : relecture toutes les 5 s sans action du voyageur ; passage à « confirmé » annoncé par la région vive, focus sur le titre', async ({
      page,
      context,
    }) => {
      await page.clock.install({ time: FROZEN_AT });
      await signInGuest(context, language);
      const holdId = await placeHold(page, 10);
      await webhook(holdId, 'PAY');
      await openS06(page, language, holdId, 'VERIFYING');
      await expect(page.locator('[data-testid="s06-live"]')).toHaveText('');
      await expect(page.locator('[data-testid="s06-watch"]')).toHaveAttribute('data-armed', 'true');
      await webhook(holdId, 'SUCCEEDED');
      await page.clock.fastForward(5_100);
      await expectStateTexts(page, language, 'CONFIRMED');
      await expect(page).toHaveURL(S06_URL);
      const t = translator(language);
      await expect(page.locator('[data-testid="s06-live"]')).toContainText(t.t('web.s07.title'));
      await expect(page.locator('[data-testid="s06-title"]')).toBeFocused();
    });

    test('UX-27 : attente lente après 2 min, sortie vers le support après 10 min (horloge avancée, aucune attente réelle)', async ({
      page,
      context,
    }) => {
      await page.clock.install({ time: FROZEN_AT });
      await signInGuest(context, language);
      const holdId = await placeHold(page, 10);
      await webhook(holdId, 'PAY');
      await openS06(page, language, holdId, 'VERIFYING');
      await expect(page.locator('[data-testid="s06-watch"]')).toHaveAttribute('data-armed', 'true');
      const t = translator(language);
      await expect(page.locator('[data-testid="s06-slow"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="s06-support-late"]')).toHaveCount(0);
      await page.clock.fastForward('02:01');
      await expect(page.locator('[data-testid="s06-slow"]')).toContainText(
        t.t('web.s06.verifying.slow'),
      );
      await expect(page.locator('[data-testid="s06-support-late"]')).toHaveCount(0);
      await page.clock.fastForward('08:05');
      await expect(page.locator('[data-testid="s06-support-late"]')).toContainText(
        t.t('web.s06.support'),
      );
      await expect(page.locator('[data-testid="s06-support-late"]')).toContainText(
        t.t('web.s06.supportBody'),
      );
      await expectStateTexts(page, language, 'VERIFYING');
      await expectAccessible(page);
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
      await openS06(page, language, holdId, 'DECLINED');
      await expectAccessible(page);
      await expectMobileFriendly(page);

      await payAt(page, offsite, 's06-pay-again');
      // aucune preuve avant l'échéance du hold : ni confirmé ni « payer de nouveau »
      await webhook(holdId, 'EXPIRE');
      await openS06(page, language, holdId, 'UNPROVEN');
      await expect(page.locator('section[aria-labelledby="s06-support"]')).toContainText(
        translator(language).t('web.s06.supportBody'),
      );
      await expect(page.locator(`${MAIN} form`)).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('N-108 : page de paiement non ouverte (PSP sans réponse après T1) ⇒ « Reintentar el pago » repasse par la clé et ouvre la page du PSP', async ({
      page,
      context,
      offsite,
    }) => {
      await signInGuest(context, language);
      const holdId = await placeHold(page, 10);
      await webhook(holdId, 'INTERRUPT');
      await openS06(page, language, holdId, 'INTERRUPTED');
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await payAt(page, offsite, 's06-retry');
      await openS06(page, language, holdId, 'VERIFYING');
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
      await expectStateTexts(page, language, 'ENDED');
      await expect(page.locator(`${MAIN} a[href="/"]`)).toBeVisible();
      await expectAccessible(page);

      const late = await placeHold(page, 2);
      await payAt(page, offsite, 's05-pay');
      await webhook(late, 'EXPIRE');
      await webhook(late, 'SUCCEEDED');
      await openS06(page, language, late, 'REFUND_DUE');
      await expect(page.locator(MAIN)).toContainText(TA01_TOTAL);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('US-701 : caution impossible pour ces dates (T59) ⇒ S05 l’annonce avant le paiement, avec les jours possibles et une sortie ; aucun bouton « Pagar »', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      await placeHold(page, 12);
      const t = translator(language);
      const section = page.locator('[data-testid="s05-deposit"]');
      await expect(section).toHaveAttribute('data-state', 'UNAVAILABLE');
      await expect(section.locator('[role="alert"]')).toHaveText(
        t.t('web.deposit.unavailable', { count: 3 }),
      );
      // US-702 (revue ux d'US-701) : la sortie mène à la recherche elle-même
      await expect(section.getByRole('link', { name: t.t('web.listing.search') })).toHaveAttribute(
        'href',
        '/search',
      );
      await expect(page.locator('[data-testid="s05-pay-submit"]')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('US-701 : caution exigée ⇒ montant, blocage temporaire et libération au plus tard sur S05 ; « Pagar » reste offert', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      await placeHold(page, 13);
      const t = translator(language);
      const section = page.locator('[data-testid="s05-deposit"]');
      await expect(section).toHaveAttribute('data-state', 'REQUIRED');
      await expect(section.locator('[data-testid="s05-deposit-amount"]')).toHaveText(/300[.,]00/);
      await expect(section).toContainText(t.t('web.deposit.how.preauth'));
      await expect(section).toContainText(fixedPart(t, 'web.deposit.releaseBy', 'date'));
      await expect(page.locator('[data-testid="s05-pay-submit"]')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    for (const [day, key] of [
      [18, 'common.payment.payoutRailUnavailable'],
      // le 19 (réservation en revue) : aucun bouton « Pagar » (US-209c, checkout-review.spec.ts)
      [21, 'common.payment.unavailable'],
    ] as const) {
      test(`refus avant le paiement (${key}) : son message sur S05, aucune sortie vers le PSP, bouton toujours actif`, async ({
        page,
        context,
      }) => {
        await signInGuest(context, language);
        const holdId = await placeHold(page, day);
        const button = page.locator('[data-testid="s05-pay-submit"]');
        await submitAndSettle(page, button);
        await expect(page).toHaveURL(new RegExp(`/checkout/hold/${holdId}$`));
        await expect(page.locator('[data-testid="s05-pay"] [role="alert"]')).toHaveText(
          translator(language).t(key),
        );
        await expect(button).toBeEnabled();
        await expect(button).not.toHaveAttribute('aria-disabled', 'true');
        await expectAccessible(page);
        await expectMobileFriendly(page);
      });
    }
  });
}
