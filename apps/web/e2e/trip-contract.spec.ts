/**
 * Contrat de location d'un trip — S09 · contrat (voyageur) et A03 · contrat (hôte), US-211 partie
 * 211b, comme un utilisateur réel, à 360 px (ses écrans passent aussi à 390 px par `screens.spec.ts`), dans les quatre langues, contre le build de
 * production du site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site).
 *
 * - S06 confirmé ⇒ lien vers le contrat ; S09 : relation entre particuliers rappelée, BROUILLON,
 *   résumé en tête (période à l'heure locale avec le NOM du pays, jamais un fuseau IANA), PDF,
 *   texte complet dans la langue de chaque partie (`lang`), puis la signature : case non cochée ⇒
 *   erreur, aucune signature ; case cochée ⇒ contrat signé (heure, sceau), plus de formulaire ;
 * - critère 2 : une nouvelle version pendant la lecture ⇒ la signature de l'ancienne est refusée
 *   (« versión más reciente »), l'ancienne reste consultable (`?version=1`) et n'est plus signable ;
 * - PDF : servi par le site, sans cache, empreinte en en-tête ;
 * - A03 : l'hôte lit le contrat du trip depuis A05, état « pas encore signé » puis « signé » ;
 * - IDOR : le contrat d'un autre ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-211, 16 BKG-018 / BKG-019, 10b S09 / A03 / UX-51 ; textes : catalogue officiel
 * (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** Premier pays de la configuration du dépôt (celui du double) : aucune constante de pays ici. */
const FIRST_COUNTRY = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { code: string }[] }
).countries[0]?.code as string;

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const CONTRACT_URL = /\/trips\/([0-9a-f-]{36})\/contract$/;
const MAIN = 'main:not([aria-busy])';

const translator = (language: Language): Translator =>
  createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));

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

/** S03 → S05 → hold → paiement confirmé (webhooks FAKE du double) → S06 → S09 · contrat. */
async function openContract(page: Page, language: Language): Promise<string> {
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
  const t = translator(language);
  const link = page.locator('[data-testid="s06-contract"]');
  await expect(link).toHaveText(t.t('web.s06.confirmed.contract'));
  await link.click();
  await expect(page).toHaveURL(CONTRACT_URL);
  const tripId = CONTRACT_URL.exec(new URL(page.url()).pathname)?.[1];
  if (tripId === undefined) throw new Error('trip absent');
  await expect(page.locator('[data-testid="s09-contract-title"]')).toBeVisible();
  return tripId;
}

for (const language of LANGUAGES) {
  test.describe(`contrat S09 / A03 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('S09 : résumé en tête, BROUILLON, texte par langue, PDF ; case non cochée ⇒ refus ; signé ⇒ heure et sceau', async ({
      page,
      context,
    }) => {
      await cookie(context, guestToken(language));
      const tripId = await openContract(page, language);
      const t = translator(language);
      const tag = tagOf(language);
      await expect(page).toHaveTitle(t.t('web.s09.contract.title'));
      await expect(page.locator('html')).toHaveAttribute('lang', tag);
      const main = page.locator(MAIN);
      await expect(main).toContainText(t.t('web.s09.contract.lead'));
      await expect(main).toContainText(t.t('web.contract.draft'));
      // résumé en tête : huit faits, période avec le nom du pays dans la langue de la vue
      const summary = page.locator('[data-testid="contract-summary"]');
      await expect(summary.locator('dt')).toHaveCount(8);
      await expect(summary.locator('dt').first()).toHaveText(t.t('web.contract.label.period'));
      // période : heures locales du contrat (double : 10 → 13 décembre, 10:00) et nom du pays de la
      // configuration du dépôt dans la langue de la vue (jamais un fuseau IANA)
      const country = new Intl.DisplayNames([tag], { type: 'region' }).of(FIRST_COUNTRY) ?? '';
      await expect(summary.locator('dd').first()).toHaveText(
        t.t('web.contract.period', {
          start: t.dateTime('2036-12-10T10:00:00.000Z', 'UTC'),
          end: t.dateTime('2036-12-13T10:00:00.000Z', 'UTC'),
          country,
        }),
      );
      // aucun fuseau IANA (« Région/Ville ») dans la période
      await expect(summary.locator('dd').first()).not.toContainText(/[A-Z][a-z]+\/[A-Z][A-Za-z_]+/);
      await expect(summary).toContainText(t.t('web.contract.oneDay'));
      // texte complet : partie espagnole (fait foi) puis courtoisie, chacune dans sa langue
      await expect(page.locator('[data-testid="contract-text-es"]')).toHaveAttribute('lang', 'es');
      const courtesy = language === 'es' ? 'en' : language;
      await expect(page.locator('[data-testid="contract-text-courtesy"]')).toHaveAttribute(
        'lang',
        courtesy,
      );
      await expect(main).toContainText(t.t('web.contract.authoritative'));
      // PDF servi par le site : sans cache, empreinte en en-tête
      const href = await page.locator('[data-testid="contract-pdf"]').getAttribute('href');
      expect(href).toBe(`/trips/${tripId}/contract/pdf`);
      const pdf = await page.request.get(href ?? '');
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toBe('application/pdf');
      expect(pdf.headers()['cache-control']).toBe('no-store');
      expect(pdf.headers()['x-contract-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // case non cochée : erreur, rien n'est signé
      const sign = page.locator('[data-testid="s09-contract-sign"]');
      await expect(sign).toHaveText(t.t('web.s09.contract.sign.cta'));
      await submitAndSettle(page, sign);
      await expect(main).toContainText(t.t('web.s09.contract.sign.required'));
      await expect(page.locator('[data-testid="s09-contract-signed"]')).toHaveCount(0);
      await expectAccessible(page);

      // case cochée : signé (heure du serveur à l'heure locale du trip, sceau), plus de formulaire
      await page.locator('#s09-contract-accept').check();
      await submitAndSettle(page, sign, /\/contract\?signed=1$/);
      const signed = page.locator('[data-testid="s09-contract-signed"]');
      await expect(signed).toContainText(
        t.t('web.contract.signedOn', { date: t.dateTime('2036-11-30T15:20:00.000Z', 'UTC') }),
      );
      await expect(signed).toContainText(t.t('web.contract.seal', { seal: 'c'.repeat(64) }));
      await expect(main).toContainText(t.t('web.s09.contract.signed'));
      await expect(page.locator('[data-testid="s09-contract-sign"]')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('critère 2 : nouvelle version pendant la lecture ⇒ signature refusée, ancienne consultable et non signable ; contrat d’un autre ⇒ introuvable', async ({
      page,
      context,
    }) => {
      await cookie(context, guestToken(language));
      const tripId = await openContract(page, language);
      const t = translator(language);
      const r = await fetch(`${API}/__e2e/contract/regenerate?trip=${tripId}`);
      expect(r.status).toBe(200);
      await page.locator('#s09-contract-accept').check();
      const sign = page.locator('[data-testid="s09-contract-sign"]');
      await submitAndSettle(page, sign);
      await expect(page.locator(MAIN)).toContainText(t.t('common.contract.superseded'));
      // la version en vigueur est la 2 ; la 1 reste lisible, sans formulaire
      await page.goto(`/trips/${tripId}/contract?version=1`);
      await expect(page.locator('[data-testid="contract-older"]')).toContainText(
        t.t('web.contract.older', { version: 1 }),
      );
      await expect(page.locator('[data-testid="s09-contract-sign"]')).toHaveCount(0);
      await expectAccessible(page);
      await page.locator('[data-testid="contract-older"] a').click();
      await expect(page).toHaveURL(CONTRACT_URL);
      await expect(page.locator('[data-testid="s09-contract-sign"]')).toBeVisible();

      // un autre voyageur : même message que l'inconnu, aucune donnée du contrat
      await context.clearCookies();
      await cookie(context, guestToken(language));
      for (const id of [tripId, '21100000-0000-4000-8000-000000000099']) {
        await page.goto(`/trips/${id}/contract`);
        await expect(page.locator(MAIN)).toContainText(t.t('common.contract.notFound'));
        await expect(page.locator('[data-testid="contract-summary"]')).toHaveCount(0);
      }
      expect((await page.request.get(`/trips/${tripId}/contract/pdf`)).status()).toBe(404);
      await expectAccessible(page);
    });

    test('A03 : l’hôte lit le contrat depuis A05 ; « pas encore signé » puis « signé »', async ({
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
      const link = page.locator('[data-testid="a05-contract"]');
      await expect(link).toHaveText(t.t('web.a05.contract'));
      await link.click();
      await expect(page).toHaveURL(/\/host\/trips\/[0-9a-f-]{36}\/contract\?org=/);
      await expect(page).toHaveTitle(t.t('web.a03.contract.title'));
      const state = page.locator('[data-testid="a03-contract-state"]');
      await expect(state).toHaveAttribute('data-signed', 'false');
      await expect(state).toContainText(t.t('web.a03.contract.unsigned'));
      await expect(page.locator(MAIN)).toContainText(t.t('web.a03.contract.lead'));
      await expect(page.locator('[data-testid="contract-summary"] dt')).toHaveCount(8);
      // aucune signature côté hôte (lecture seule)
      await expect(page.locator('[data-testid="s09-contract-sign"]')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      const tripId = /\/host\/trips\/([0-9a-f-]{36})\/contract/.exec(page.url())?.[1] ?? '';
      expect((await fetch(`${API}/__e2e/contract/sign?trip=${tripId}`)).status).toBe(200);
      await page.reload();
      await expect(state).toHaveAttribute('data-signed', 'true');
      await expect(state).toContainText(t.t('web.a03.contract.signed'));
      await expect(state).toContainText(t.t('web.contract.seal', { seal: 'c'.repeat(64) }));
      await expectAccessible(page);
    });
  });
}
