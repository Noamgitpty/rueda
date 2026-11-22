/**
 * Incident ou accident déclaré par le voyageur depuis S17 (US-318), comme un utilisateur réel, à
 * 360 px (l'écran passe aussi à 390 px, en tablette et en sombre par `screens.spec.ts`), dans les
 * quatre langues, contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`).
 *
 * - S17 du trip → demande d'aide « accident » → lien « Declarar el incidente con fotos » ;
 * - en tête : numéro d'urgence du pays du trip (lien d'appel), autorité de circulation ; numéro de
 *   l'assistance de l'assureur ABSENT (donnée du fondateur) ⇒ renvoi à l'aide dans l'appli, aucun
 *   numéro inventé ; rappel de ne pas continuer à rouler (08 BR-DAMAGE-01) ;
 * - photos : caméra de l'application seulement, aucun sélecteur de fichier ;
 * - questions fermées obligatoires ; sans photo ⇒ refus de l'API annoncé ; avec une photo (déposée
 *   par le double : la CI n'a pas de caméra) ⇒ incident enregistré, heure du SERVEUR affichée dans
 *   le fuseau du trip, nombre de photos ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-318 critère 2, 16 CLM-002, 10b S17 ; textes : catalogue officiel (`@rueda/i18n`).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import type { Language } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const MAIN = 'main:not([aria-busy])';
/** Heure « serveur » fixe du double (P2P_AT de stub-api.mjs). */
const SERVER_AT = '2036-12-14T09:30:00.000Z';
/** Fuseau du marché du double : premier pays de la configuration (comme e2e/stub-api.mjs). */
const ZONE = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]!.timeZone;

async function signIn(context: BrowserContext, language: Language): Promise<string> {
  const value = `G0st${language}${randomBytes(30).toString('base64url').slice(0, 37)}`;
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
  test.describe(`incident du voyageur · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('S17 → accident → incident : numéros du pays, caméra seulement, photo exigée, heure serveur', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = await signIn(context, language);
      const r = await fetch(`${API}/__e2e/p2p/new?guest=${guest}&host=&status=IN_PROGRESS`);
      expect(r.status).toBe(200);
      const { tripId } = (await r.json()) as { tripId: string };

      // S17 du trip : demande d'aide « accident », puis le lien vers l'incident
      await page.goto(`/trips/${tripId}/help`);
      await page.locator('[data-testid="s17-topic-ACCIDENT"]').check();
      await page.locator('[data-testid="s17-request-submit"]').click();
      const link = page.locator('[data-testid="s17-incident-link"]');
      await expect(link).toHaveText(t('web.incident.open'));
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/incident\\?case=`));
      await expect(page.locator('[data-testid="s17-incident-title"]')).toHaveText(
        t('web.incident.title'),
      );
      const main = page.locator(MAIN);
      // urgence du pays du trip ; assistance de l'assureur absente : renvoi à l'appli, rien d'inventé
      await expect(page.locator('[data-testid="s17-incident-emergencyCall"]')).toHaveAttribute(
        'href',
        'tel:911',
      );
      await expect(main).toContainText(t('web.help.roadside.inApp'));
      await expect(main).not.toContainText(/\+[0-9]{7,}/);
      await expect(page.locator('[data-testid="s17-incident-stop"]')).toHaveText(
        t('web.incident.stopDriving'),
      );
      // capture en direct seulement : aucun sélecteur de fichier
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="s17-incident-take"]')).toBeVisible();
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // réponses obligatoires
      await page.locator('[data-testid="s17-incident-submit"]').click();
      await expect(main).toContainText(t('web.incident.answerRequired'));
      // sans photo : refus de l'API annoncé, rien d'enregistré
      await page.locator('[data-testid="s17-incident-third-party-yes"]').check();
      await page.locator('[data-testid="s17-incident-police-no"]').check();
      await page.locator('[data-testid="s17-incident-submit"]').click();
      await expect(page.locator('[data-testid="s17-incident-error"]')).toHaveText(
        t('common.tripClaims.incidentPhotosRequired'),
      );

      // une photo reçue (heure serveur) : l'incident est enregistré
      const photo = await fetch(`${API}/__e2e/p2p/photo?trip=${tripId}&kind=incident`);
      expect(photo.status).toBe(200);
      await page.reload();
      await expect(page.locator('[data-testid="s17-incident-photos"] li')).toHaveCount(1);
      await page.locator('[data-testid="s17-incident-third-party-yes"]').check();
      await page.locator('[data-testid="s17-incident-police-no"]').check();
      await page.locator('[data-testid="s17-incident-submit"]').click();
      const sent = page.locator('[data-testid="s17-incident-sent"]');
      await expect(sent).toContainText(t('web.incident.sent'));
      await expect(page.locator('[data-testid="s17-incident-sent-at"]')).toHaveText(
        t('web.incident.sentAt', { time: i18n.dateTime(SERVER_AT, ZONE) }),
      );
      await expect(sent).toContainText(t('web.incident.sentPhotos', { count: 1 }));
      await expectAccessible(page, { include: null });
    });

    test('sans demande d’aide : renvoi à S17 ; trip d’une autre personne : même message que l’inconnu', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = await signIn(context, language);
      const mine = await fetch(`${API}/__e2e/p2p/new?guest=${guest}&host=&status=IN_PROGRESS`);
      const { tripId } = (await mine.json()) as { tripId: string };
      await page.goto(`/trips/${tripId}/incident`);
      await expect(page.locator('[data-testid="s17-incident-no-case"]')).toHaveText(
        t('common.tripClaims.incidentCaseRequired'),
      );
      await expect(page.locator('[data-testid="s17-incident-ask-help"]')).toHaveAttribute(
        'href',
        `/trips/${tripId}/help`,
      );
      const other = await fetch(
        `${API}/__e2e/p2p/new?guest=G0st${randomBytes(30).toString('base64url').slice(0, 39)}&host=&status=IN_PROGRESS`,
      );
      const { tripId: foreign } = (await other.json()) as { tripId: string };
      await page.goto(`/trips/${foreign}/incident?case=${tripId}`);
      await expect(page.getByText(t('common.tripClaims.notFound'))).toBeVisible();
    });
  });
}
