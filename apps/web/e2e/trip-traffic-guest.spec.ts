/**
 * Amendes, péages et fourrière refacturés au voyageur (suite d'US-318, 0181, ADR-201 ; 08
 * BR-TT-02 : 48 h pour payer ou contester ; 10b S12), comme un utilisateur réel, à 360 px, dans
 * les quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`). Pas de capture de référence visuelle (écran absent de `screens.spec.ts`).
 *
 * - le voyageur voit nature, référence, montant payé par l'hôte, frais, total et échéance (fuseau
 *   du trip, format de la langue) ; payer (total au bouton) ⇒ état « accepté » ;
 * - contester : motif trop court refusé et dit, puis contestation envoyée avec une photo du trip ;
 * - IDOR : les refacturations d'un autre voyageur ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : ADR-201, 08 BR-TT-02 ; textes : catalogue officiel (`@rueda/i18n`).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
/** Échéance du double (déclaration + 48 h) et fuseau du premier pays (comme le double). */
const DUE = '2036-12-16T09:30:00.000Z';
const ZONE = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]!.timeZone;

const token = (prefix: 'H0st' | 'G0st') =>
  `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`;

async function setSession(context: BrowserContext, value: string): Promise<void> {
  await context.clearCookies();
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

async function newTrip(guest: string): Promise<string> {
  const r = await fetch(
    `${API}/__e2e/p2p/new?guest=${guest}&host=${token('H0st')}&status=COMPLETED&charge=yes`,
  );
  expect(r.status).toBe(200);
  return ((await r.json()) as { tripId: string }).tripId;
}

for (const language of LANGUAGES) {
  test.describe(`refacturations du voyageur · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('payer avec le total au bouton ; contester avec motif et photo ; IDOR', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      // marché fictif du double (`MARKET` de e2e/stub-api.mjs : XTS, deux décimales)
      const money = (minor: bigint) =>
        i18n.money({ amountMinor: minor, currency: 'XTS', exponent: 2 });

      const guest = token('G0st');
      const trip = await newTrip(guest);
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/traffic-charges`);
      await expect(page.locator('[data-testid="traffic-guest-title"]')).toHaveText(
        t('web.trafficGuest.title'),
      );
      await expect(page.locator('[data-testid="traffic-reference"]')).toHaveText(
        t('web.traffic.review.reference', { reference: 'PV-2036/4471' }),
      );
      await expect(page.locator('[data-testid="traffic-amount"]')).toHaveText(
        t('web.trafficGuest.amount', { amount: money(1230n) }),
      );
      await expect(page.locator('[data-testid="traffic-fee"]')).toHaveText(
        t('web.traffic.sent.fee', { amount: money(62n) }),
      );
      await expect(page.locator('[data-testid="traffic-total"]')).toHaveText(
        t('web.trafficGuest.total', { amount: money(1292n) }),
      );
      await expect(page.locator('[data-testid="traffic-status"]')).toHaveText(
        t('web.trafficGuest.due', { date: i18n.dateTime(DUE, ZONE) }),
      );
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });
      await expect(page.locator('[data-testid="traffic-accept"]')).toHaveText(
        t('web.s12.accept', { amount: money(1292n) }),
      );
      await page.locator('[data-testid="traffic-accept"]').click();
      await expect(page.locator('[data-testid="traffic-done"]')).toBeVisible();
      await expect(page.locator('[data-testid="traffic-accept"]')).toHaveCount(0);
      // marque de la coquille (donnée de thème) : la phrase est comparée après la marque
      const accepted = t('web.trafficGuest.status.ACCEPTED', { brand: 'BRAND' });
      await expect(page.locator('[data-testid="traffic-status"]')).toContainText(
        accepted.slice(accepted.indexOf('BRAND') + 5),
      );

      // contestation : motif trop court refusé et dit, puis envoyée avec une photo du retour
      const guest2 = token('G0st');
      const trip2 = await newTrip(guest2);
      await setSession(context, guest2);
      await page.goto(`/trips/${trip2}/traffic-charges`);
      await page.locator('[data-testid="traffic-contest"]').click();
      await page.locator('[data-testid="traffic-reason"]').fill('Pas d’accord');
      await page.locator('[data-testid="traffic-dispute-submit"]').click();
      await expect(page.getByText(t('web.trafficGuest.dispute.reasonInvalid'))).toBeVisible();
      const reason = 'Je n’étais plus en possession de la voiture à cette heure-là.';
      await page.locator('[data-testid="traffic-reason"]').fill(reason);
      await page.locator('[data-testid="traffic-photo-CHECKOUT-EXT_01-GUEST"]').check();
      await page.locator('[data-testid="traffic-dispute-submit"]').click();
      await expect(page.locator('[data-testid="traffic-done"]')).toBeVisible();
      await expect(page.locator('[data-testid="traffic-dispute-reason"]')).toHaveText(reason);
      await expect(page.locator('[data-testid="traffic-contest"]')).toHaveCount(0);
      await expectAccessible(page, { include: null });

      // IDOR : les refacturations d'un autre voyageur ⇒ même message que l'inconnu
      await page.goto(`/trips/${trip}/traffic-charges`);
      await expect(page.getByText(t('common.tripClaims.notFound'))).toBeVisible();
      await expect(page.locator('[data-testid="traffic-charge"]')).toHaveCount(0);
    });
  });
}
