/**
 * Sinistres du trip vus par l'hôte (US-318) : vol présumé, amendes, péages et fourrière, comme un
 * utilisateur réel, à 360 px (l'écran passe aussi à 390 px, en tablette et en sombre par
 * `screens.spec.ts`), dans les quatre langues, contre le build de production du site et le double
 * de l'API (`e2e/stub-api.mjs`).
 *
 * - A05 (trip rendu) → « Multas, peajes y grúa » ;
 * - vol présumé : dossier ouvert, déclaration à l'assureur ENREGISTRÉE et non envoyée (contrat de
 *   l'assureur inactif), versement retenu ; jamais de récupération ni d'immobilisation (OQ-BR-17) ;
 * - délai et règle des frais (pourcentage du pays seulement : aucun calcul dans le client) ;
 * - saisie obligatoire ; fait hors du trip ⇒ refus de l'API annoncé sur le champ, saisie conservée ;
 * - déclaration acceptée : montants RENDUS par l'API (12,30 + frais de 5 % arrondis par 08
 *   BR-PRICE-14 = 0,62 ; total 12,92 au voyageur) ; refacturation listée ; jamais un transfert de
 *   l'amende (OQ-BR-19), parking de récupération non refacturable (BR-TT-05) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-318 critères 1 et 3, 08 BR-TT-02 à 05, BR-PRICE-15 ; textes : catalogue officiel.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const MAIN = 'main:not([aria-busy])';
/** Délai du double : fin du trip + 120 j (08 BR-TT-02 [NOUS]). */
const DEADLINE = '2037-04-12T14:00:00.000Z';
/** Fuseau du marché du double : premier pays de la configuration (comme e2e/stub-api.mjs). */
const ZONE = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]!.timeZone;

async function signInHost(context: BrowserContext): Promise<string> {
  const value = `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;
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
  return value;
}

for (const language of LANGUAGES) {
  test.describe(`amendes, péages et fourrière de l'hôte · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('vol présumé annoncé, refacturation refusée hors du trip puis acceptée avec les montants de l’API', async ({
      page,
      context,
    }) => {
      const profile = getProfile(LOCALE_CONFIG, tagOf(language));
      const i18n = createTranslator(profile);
      const t = i18n.t.bind(i18n);
      const money = (minor: bigint) =>
        i18n.money({ amountMinor: minor, currency: 'XTS', exponent: 2 });
      const host = await signInHost(context);
      // la session crée les comptes d'hôte du double
      await page.goto('/host');
      const r = await fetch(`${API}/__e2e/p2p/new?guest=&host=${host}&status=COMPLETED&theft=yes`);
      expect(r.status).toBe(200);
      const { tripId } = (await r.json()) as { tripId: string };
      const photo = await fetch(`${API}/__e2e/p2p/photo?trip=${tripId}&kind=traffic`);
      expect(photo.status).toBe(200);

      await page.goto(`/host/trips/${tripId}`);
      await page.locator('[data-testid="a05-claims"]').click();
      await expect(page.locator('[data-testid="a09-claims-title"]')).toHaveText(
        t('web.traffic.title'),
      );
      const main = page.locator(MAIN);
      // vol présumé : déclaration enregistrée, non envoyée ; versement retenu
      await expect(page.locator('[data-testid="a09-theft-insurer"]')).toHaveText(
        t('web.theft.insurer.PENDING'),
      );
      await expect(main).toContainText(t('web.theft.payoutHeld'));
      // délai et règle des frais (pourcentage du pays)
      await expect(page.locator('[data-testid="a09-traffic-deadline"]')).toHaveText(
        t('web.traffic.deadline', { time: i18n.dateTime(DEADLINE, ZONE) }),
      );
      await expect(page.locator('[data-testid="a09-traffic-fee"]')).toHaveText(
        t('web.traffic.feeRule', { pct: '5' }),
      );
      await expect(main).toContainText(t('web.traffic.notTransferred'));
      await expect(main).toContainText(t('web.traffic.noParking'));
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // saisie obligatoire
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      await expect(main).toContainText(t('web.traffic.kindRequired'));
      await expect(main).toContainText(t('web.traffic.atRequired'));
      await expect(main).toContainText(t('web.traffic.amountInvalid'));

      // fait hors du trip : refus annoncé sur le champ, saisie conservée
      const amount = `12${profile.number.decimal}30`;
      await page.locator('[data-testid="a09-traffic-kind-1"]').check();
      await page.locator('#a09-traffic-at').fill('2036-12-20T10:00');
      await page.locator('#a09-traffic-amount').fill(amount);
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      await expect(main).toContainText(t('common.tripClaims.trafficOutsideTrip'));
      await expect(page.locator('#a09-traffic-amount')).toHaveValue(amount);

      // pendant le trip : enregistré, montants rendus par l'API
      await page.locator('#a09-traffic-at').fill('2036-12-11T10:00');
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      const sent = page.locator('[data-testid="a09-traffic-sent"]');
      await expect(sent).toContainText(t('web.traffic.sent'));
      await expect(sent).toContainText(t('web.traffic.sent.amount', { amount: money(1230n) }));
      await expect(sent).toContainText(t('web.traffic.sent.fee', { amount: money(62n) }));
      await expect(page.locator('[data-testid="a09-traffic-sent-total"]')).toHaveText(
        t('web.traffic.sent.total', { amount: money(1292n) }),
      );
      await expect(page.locator('[data-testid="a09-charges"] li')).toHaveCount(1);
      await expect(page.locator('[data-testid="a09-charges"]')).toContainText(
        t('web.traffic.kind.FINE'),
      );
      await expectAccessible(page, { include: null });
    });

    test('trip d’un autre hôte : même message que l’inconnu', async ({ page, context }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      await signInHost(context);
      await page.goto('/host');
      const other = `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;
      const r = await fetch(`${API}/__e2e/p2p/new?guest=&host=${other}&status=COMPLETED`);
      const { tripId } = (await r.json()) as { tripId: string };
      await page.goto(`/host/trips/${tripId}/claims`);
      await expect(page.getByText(i18n.t('common.tripClaims.notFound'))).toBeVisible();
    });
  });
}
