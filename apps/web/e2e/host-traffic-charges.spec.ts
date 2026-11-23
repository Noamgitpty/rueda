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
 * - récapitulatif AVANT la déclaration (revue ux n° 1) : montants calculés par l'API, « Corregir »
 *   revient à la saisie conservée, « Confirmar » déclare ; date dans l'ordre de la langue (n° 6) ;
 * - plainte pré-remplie : où la trouver, que faire, si la voiture revient (revue ux n° 2) ;
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
import { dateOrder } from '../account/trip-claims.ts';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const MAIN = 'main:not([aria-busy])';
/** Délai du double : fin du trip + 120 j (08 BR-TT-02 [NOUS]). */
const DEADLINE = '2037-04-12T14:00:00.000Z';
/** Échéance du voyageur du double : déclaration + 48 h (08 BR-TT-02 ; suite d'US-318). */
const DUE = '2036-12-16T09:30:00.000Z';
/** Fuseau du marché du double : premier pays de la configuration (comme e2e/stub-api.mjs). */
const ZONE = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]!.timeZone;

/** Date murale du trip saisie dans l'ordre de la langue de la vue (jour, mois, année). */
function localDate(tag: string, y: string, m: string, d: string): string {
  const v = { day: d, month: m, year: y };
  return dateOrder(tag)
    .map((p) => v[p])
    .join('/');
}

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
      const report = page.locator('[data-testid="a09-theft-report"] li');
      await expect(report).toHaveCount(3);
      // marque de la coquille (donnée de thème) : la phrase est comparée après la marque
      const where = t('web.theft.report.where', { brand: 'BRAND' });
      await expect(report.nth(0)).toContainText(where.slice(where.indexOf('BRAND') + 5));
      await expect(report.nth(1)).toHaveText(t('web.theft.report.file'));
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
      await expect(main).toContainText(t('web.traffic.dateInvalid'));
      await expect(main).toContainText(t('web.traffic.amountInvalid'));
      await expect(main).toContainText(t('common.tripClaims.trafficReferenceRequired'));
      // plafond du pays dans l'aide du montant (suite d'US-318, 0181)
      await expect(main).toContainText(t('web.traffic.amountCap', { amount: money(50000n) }));

      // fait hors du trip : refus annoncé sur le champ, saisie conservée
      const amount = `12${profile.number.decimal}30`;
      await page.locator('[data-testid="a09-traffic-kind-1"]').check();
      await page.locator('#a09-traffic-reference').fill('PV-2036/4471');
      const tag = tagOf(language);
      await page.locator('#a09-traffic-at').fill(localDate(tag, '2036', '12', '20'));
      await page.locator('#a09-traffic-time').fill('10:00');
      await page.locator('#a09-traffic-amount').fill(amount);
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      await expect(main).toContainText(t('common.tripClaims.trafficOutsideTrip'));
      await expect(page.locator('#a09-traffic-amount')).toHaveValue(amount);
      await expect(page.locator('[data-testid="a09-charges"] li')).toHaveCount(0);

      // pendant le trip : récapitulatif calculé par l'API, AUCUNE déclaration encore
      await page.locator('#a09-traffic-at').fill(localDate(tag, '2036', '12', '11'));
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      const review = page.locator('[data-testid="a09-traffic-review"]');
      await expect(review).toContainText(t('web.traffic.review.title'));
      await expect(page.locator('[data-testid="a09-traffic-review-amount"]')).toHaveText(
        t('web.traffic.sent.amount', { amount: money(1230n) }),
      );
      await expect(page.locator('[data-testid="a09-traffic-review-fee"]')).toHaveText(
        t('web.traffic.sent.fee', { amount: money(62n) }),
      );
      await expect(page.locator('[data-testid="a09-traffic-review-total"]')).toHaveText(
        t('web.traffic.review.total', { amount: money(1292n) }),
      );
      await expect(review).toContainText(t('web.traffic.review.card'));
      await expect(page.locator('[data-testid="a09-traffic-review-reference"]')).toHaveText(
        t('web.traffic.review.reference', { reference: 'PV-2036/4471' }),
      );
      await expect(page.locator('[data-testid="a09-charges"] li')).toHaveCount(0);
      await expectAccessible(page, { include: null });
      // « Corregir » : retour à la saisie conservée, rien de déclaré
      await page.locator('[data-testid="a09-traffic-correct"]').click();
      await expect(page.locator('#a09-traffic-amount')).toHaveValue(amount);
      await expect(page.locator('#a09-traffic-time')).toHaveValue('10:00');
      await expect(page.locator('[data-testid="a09-charges"] li')).toHaveCount(0);
      // « Revisar » puis « Confirmar » : déclaré avec la même saisie
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      await page.locator('[data-testid="a09-traffic-confirm"]').click();
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
      // référence et échéance du voyageur (déclaration + 48 h) listées (suite d'US-318)
      await expect(page.locator('[data-testid="a09-charge-reference"]')).toHaveText(
        t('web.traffic.review.reference', { reference: 'PV-2036/4471' }),
      );
      await expect(page.locator('[data-testid="a09-traffic-sent-due"]')).toHaveText(
        t('web.traffic.sent.due', { time: i18n.dateTime(DUE, ZONE) }),
      );
      await expectAccessible(page, { include: null });

      // même référence sur ce trip : refusée sur le champ (TRAFFIC_DUPLICATE), rien de déclaré
      const second = await fetch(`${API}/__e2e/p2p/photo?trip=${tripId}&kind=traffic`);
      expect(second.status).toBe(200);
      await page.goto(`/host/trips/${tripId}/claims`);
      await page.locator('[data-testid="a09-traffic-kind-0"]').check();
      await page.locator('#a09-traffic-reference').fill('pv 2036/4471');
      await page.locator('#a09-traffic-at').fill(localDate(tag, '2036', '12', '11'));
      await page.locator('#a09-traffic-time').fill('11:00');
      await page.locator('#a09-traffic-amount').fill(`3${profile.number.decimal}00`);
      await page.locator('[data-testid="a09-traffic-submit"]').click();
      await expect(main).toContainText(t('common.tripClaims.trafficDuplicate'));
      await expect(page.locator('#a09-traffic-reference')).toHaveValue('pv 2036/4471');
      await expect(page.locator('[data-testid="a09-charges"] li')).toHaveCount(1);
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
