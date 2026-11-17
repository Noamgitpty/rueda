/**
 * Parcours e2e du mode sur demande (US-223 partie 223d, ADR-152 ; serveur de 223c, ADR-146 ; 19
 * US-219 critères 4 à 6 et US-223 critères US-060 ; 10b S05 `web.s05.ctaRequest`, S07 « Mode
 * REQUEST : `web.s07.request.pending` », S06, A05 `web.a05.accept` / `web.a05.decline`, §4.3), sur
 * le double de l'API (e2e/stub-api.mjs) : le 23 décembre, le double pose un hold de DEMANDE ;
 * l'autorisation et la capture sont jouées par `GET /__e2e/payment/webhook` (aucune sortie vers le
 * PSP ici : la page hébergée est éprouvée par `checkout-payment.spec.ts`), la demande est
 * rattachée à un hôte par `GET /__e2e/request/assign`.
 *
 * Attendus (textes du catalogue officiel dans la langue de la page, pt-BR compris ; montant TA01
 * 128,40 rendu par l'API, jamais recalculé ; heure limite 19:10 rendue par l'API, au fuseau du
 * véhicule) :
 * - S05 d'une demande : « Enviar solicitud », jamais « Pagar {amount} » ;
 * - autorisation prouvée ⇒ « Solicitud enviada », l'hôte a jusqu'à l'heure limite, jamais
 *   « confirmé » ; l'hôte voit la demande dans A05 (heure limite, voyageur minimisé, jamais de
 *   permis), l'ouvre, confirme « Aceptar la solicitud » (le montant débité est dit avant) ⇒ A05
 *   annonce l'acceptation, le voyageur voit « Solicitud aceptada » (capture en attente de sa
 *   preuve), puis « confirmé » après le webhook de la capture ;
 * - refus confirmé par l'hôte ⇒ `web.error.requestDeclined`, recherche aux mêmes dates ;
 *   expiration ⇒ `web.error.requestExpired` ; capture refusée ⇒ « No pudimos completar tu
 *   reserva » ; acceptation après l'heure limite ⇒ `common.request.expired`, la demande n'est pas
 *   dite traitée.
 * Projet mobile-360 seulement (durée du job e2e, BOARD : limite de 20 min) ; axe et mobile d'abord
 * sur chaque nouvel écran.
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
/** TA01 (16 A.8.1) : total 128,40 rendu par l'API. */
const TA01_TOTAL = /128[.,]40/;
/** Heure limite rendue par le double (base), fuseau du véhicule du double : UTC. */
const RESPOND_BY = '2036-11-30T19:10:00.000Z';
const HOST_NAME = 'Ana';
const MAIN = 'main:not([aria-busy])';

const translator = (language: Language): Translator =>
  createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));

async function session(context: BrowserContext, token: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([
    {
      name: '__Host-session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

const guestToken = (language: Language) =>
  `G0st${language}${randomBytes(30).toString('base64url').slice(0, 37)}`;
const hostToken = () => `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;

async function call(path: string): Promise<void> {
  const r = await fetch(`${API}${path}`);
  expect(r.status, path).toBe(200);
}

/** S03 → S05 → hold de demande posé (le 23 dans le double) ; rend son identifiant. */
async function placeRequest(page: Page): Promise<string> {
  const slot = { start: '2036-12-23T10:00', end: '2036-12-26T10:00' };
  await page.goto(`/listings/${PUBLIC_ID}?${new URLSearchParams(slot).toString()}`);
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

/** Demande envoyée : autorisation en vol puis prouvée (webhook FAKE signé, joué par le double). */
async function authorize(holdId: string): Promise<void> {
  await call(`/__e2e/payment/webhook?hold=${holdId}&event=PAY`);
  await call(`/__e2e/payment/webhook?hold=${holdId}&event=SUCCEEDED`);
}

async function expectS06(page: Page, holdId: string, state: string, title: string, body: string) {
  await page.goto(`/checkout/hold/${holdId}/payment`);
  const h1 = page.locator('[data-testid="s06-title"]');
  await expect(h1).toHaveAttribute('data-state', state);
  await expect(h1).toHaveText(title);
  await expect(page.locator(MAIN)).toContainText(body);
  await expect(page).toHaveTitle(/\S/);
}

/** Hôte neuf (compte créé à la première lecture) ; la demande lui est rattachée. */
async function hostWith(
  page: Page,
  context: BrowserContext,
  holds: readonly string[],
  refuse = '',
) {
  const token = hostToken();
  await session(context, token);
  await page.goto('/host');
  await expect(page.locator('main h1').first()).toBeVisible();
  for (const hold of holds) {
    await call(
      `/__e2e/request/assign?hold=${hold}&host=${token}${refuse ? `&refuse=${refuse}` : ''}`,
    );
  }
  return token;
}

/** A05 → la demande → étape de confirmation de `verb`. */
async function openConfirm(page: Page, holdId: string, verb: 'accept' | 'decline') {
  await page.goto('/host/trips');
  const block = page.locator('[data-testid="a05-requests"]');
  await block.locator(`a[href*="/host/requests/${holdId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/host/requests/${holdId}\\?org=`));
  await page.locator(`[data-testid="a05-open-${verb}"]`).click();
  await expect(page.locator('[data-testid="a05-confirm"]')).toHaveAttribute('data-verb', verb);
}

for (const language of LANGUAGES) {
  test.describe(`mode sur demande · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('demande envoyée → l’hôte l’accepte après confirmation → capture en attente → confirmée', async ({
      page,
      context,
    }) => {
      const t = translator(language);
      const guest = guestToken(language);
      await session(context, guest);
      const holdId = await placeRequest(page);
      // S05 d'une demande : « Enviar solicitud », le montant est autorisé (jamais « Pagar »)
      const cta = page.locator('[data-testid="s05-pay-submit"]');
      await expect(cta).toHaveText(t.t('web.s05.ctaRequest'));
      await expect(page.locator('[data-testid="s05-request"]')).toContainText(TA01_TOTAL);
      await expect(page.locator('[data-testid="s05-pay"]')).toHaveCount(1);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // autorisation prouvée : 10b S07 « Solicitud enviada », heure limite de la base
      await authorize(holdId);
      const pending = t.t('web.s07.request.pending', {
        host_name: HOST_NAME,
        time: t.time(RESPOND_BY, 'UTC'),
      });
      await expectS06(page, holdId, 'REQUEST_SENT', t.t('web.s07.request.title'), pending);
      await expect(page.locator(MAIN)).not.toContainText(t.t('web.s06.confirmed.title'));
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // l'hôte : A05 montre la demande (heure limite, voyageur minimisé), confirmation explicite
      await hostWith(page, context, [holdId]);
      await page.goto('/host/trips');
      const card = page.locator('[data-testid="a05-requests"] [data-testid="a05-request"]');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(holdId.slice(0, 8).toUpperCase());
      await expect(card.locator('[data-testid="a05-request-respond-by"]')).toContainText(
        t.dateTime(RESPOND_BY, 'UTC'),
      );
      await expect(card).toContainText('Lucía');
      await expect(page.locator('main img')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await openConfirm(page, holdId, 'accept');
      const confirm = page.locator('[data-testid="a05-confirm"]');
      await expect(confirm).toContainText(t.t('web.a05.request.confirmAccept.title'));
      await expect(confirm).toContainText(TA01_TOTAL);
      await expect(page.locator('[data-testid="a05-accept-submit"]')).toHaveText(
        t.t('web.a05.accept'),
      );
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await submitAndSettle(
        page,
        page.locator('[data-testid="a05-accept-submit"]'),
        /\/host\/trips\?org=[0-9a-f-]{36}&request=CAPTURING$/,
      );
      await expect(page.locator('main [role="status"]').first()).toContainText(
        t.t('web.a05.request.done.CAPTURING'),
      );
      await expect(card).toContainText(t.t('web.a05.request.capturing'));

      // le voyageur : acceptée, capture en attente de sa preuve ; puis confirmée par le webhook
      await session(context, guest);
      await expectS06(
        page,
        holdId,
        'REQUEST_CAPTURING',
        t.t('web.s07.request.capturing.title'),
        t.t('web.s07.request.capturing.body', { host_name: HOST_NAME }),
      );
      await expect(page.locator(MAIN)).not.toContainText(t.t('web.s06.confirmed.title'));
      await expectAccessible(page);
      await call(`/__e2e/payment/webhook?hold=${holdId}&event=SUCCEEDED`);
      await expectS06(
        page,
        holdId,
        'CONFIRMED',
        t.t('web.s06.confirmed.title'),
        t.t('web.s06.confirmed.body'),
      );
    });

    test('refus confirmé, expiration, capture refusée : aucun débit, recherche aux mêmes dates ; acceptation tardive refusée', async ({
      page,
      context,
    }) => {
      const t = translator(language);
      const guest = guestToken(language);
      await session(context, guest);
      const declined = await placeRequest(page);
      const expired = await placeRequest(page);
      const failed = await placeRequest(page);
      const late = await placeRequest(page);
      for (const id of [declined, expired, failed, late]) await authorize(id);
      await call(`/__e2e/payment/webhook?hold=${expired}&event=EXPIRE`);

      // l'hôte refuse (confirmation : aucun débit, dates libérées) et accepte deux demandes
      await hostWith(page, context, [declined, failed]);
      await openConfirm(page, declined, 'decline');
      await expect(page.locator('[data-testid="a05-confirm"]')).toContainText(
        t.t('web.a05.request.confirmDecline.body'),
      );
      await submitAndSettle(
        page,
        page.locator('[data-testid="a05-decline-submit"]'),
        /&request=DECLINED$/,
      );
      await expect(page.locator('main [role="status"]').first()).toContainText(
        t.t('web.a05.request.done.DECLINED'),
      );
      await openConfirm(page, failed, 'accept');
      await submitAndSettle(
        page,
        page.locator('[data-testid="a05-accept-submit"]'),
        /&request=CAPTURING$/,
      );
      await call(`/__e2e/payment/webhook?hold=${failed}&event=FAILED`);

      // heure limite passée (refus de la base) : message, la demande n'est pas dite traitée
      await hostWith(page, context, [late], 'REQUEST_EXPIRED');
      await openConfirm(page, late, 'accept');
      const accept = page.locator('[data-testid="a05-accept-submit"]');
      await submitAndSettle(page, accept);
      await expect(page.locator('[data-testid="a05-accept"] [role="alert"]')).toHaveText(
        t.t('common.request.expired'),
      );
      await expect(page).toHaveURL(new RegExp(`/host/requests/${late}\\?`));
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // le voyageur : refus, expiration, capture refusée ; recherche aux dates de la demande
      await session(context, guest);
      await expectS06(
        page,
        declined,
        'REQUEST_DECLINED',
        t.t('web.s06.request.declined.title'),
        t.t('web.error.requestDeclined', { host_name: HOST_NAME }),
      );
      const again = page.locator(`${MAIN} a[href^="/search?"]`);
      await expect(again).toHaveText(t.t('web.s06.request.searchCta'));
      const href = new URL((await again.getAttribute('href')) ?? '', 'http://x');
      expect(href.searchParams.get('startDate')).toBe('2036-12-23');
      expect(href.searchParams.get('startTime')).toBe('10:00');
      expect(href.searchParams.get('endDate')).toBe('2036-12-26');
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await expectS06(
        page,
        expired,
        'REQUEST_EXPIRED',
        t.t('web.s06.request.expired.title'),
        t.t('web.error.requestExpired', { host_name: HOST_NAME }),
      );
      await expectAccessible(page);
      await expectS06(
        page,
        failed,
        'REQUEST_CAPTURE_FAILED',
        t.t('web.s06.request.captureFailed.title'),
        t.t('web.s06.request.captureFailed.body'),
      );
      await expectAccessible(page);
      for (const id of [declined, expired, failed]) {
        await page.goto(`/checkout/hold/${id}/payment`);
        await expect(page.locator(MAIN)).not.toContainText(t.t('web.s06.confirmed.title'));
        await expect(page.locator(`${MAIN} form`)).toHaveCount(0);
      }
    });
  });
}
