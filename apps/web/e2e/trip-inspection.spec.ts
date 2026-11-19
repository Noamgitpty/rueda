/**
 * Photos d'état du véhicule — S09 · check-in du voyageur (US-303), comme un utilisateur réel, à
 * 360 px (l'écran passe aussi à 390 px et en tablette par `screens.spec.ts`), dans les quatre
 * langues, contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`,
 * appelé par le SERVEUR du site).
 *
 * - gabarit guidé : les 25 angles obligatoires (15 extérieures, 8 intérieures, carburant,
 *   compteur) et les facultatifs, compteur « 0 de 25 » ; aucun sélecteur de fichier (la galerie
 *   n'est jamais proposée : capture en direct de l'application seulement) ;
 * - critère 1 : valider une série incomplète ⇒ refus, nombre d'angles manquants annoncé ;
 * - IDOR : la série d'un autre trip ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-303, 16 TRP-004, 10b S09 · check-in / UX-07 ; textes : catalogue officiel
 * (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import type { Language } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;

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

async function newTrip(guest: string): Promise<string> {
  const r = await fetch(`${API}/__e2e/inspection/new?guest=${guest}&host=`);
  expect(r.status).toBe(200);
  return ((await r.json()) as { tripId: string }).tripId;
}

for (const language of LANGUAGES) {
  test.describe(`photos de départ · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('gabarit guidé, aucune galerie, validation incomplète refusée, IDOR', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = await signIn(context, language);
      const trip = await newTrip(guest);
      await page.goto(`/trips/${trip}/inspection/checkin`);
      await expect(page.locator('[data-testid="inspection-title"]')).toHaveText(
        t('web.inspection.title.checkin'),
      );
      await expect(page.locator('[data-testid="inspection-progress"]')).toContainText(
        t('web.inspection.progress', { count: 0, total: 25 }),
      );
      await expect(page.locator('[data-testid^="inspection-slot-"]')).toHaveCount(36);
      await expect(page.locator('[data-testid="inspection-slot-INT_08"] button')).toContainText(
        t('web.inspection.slot.INT_08'),
      );
      // capture en direct seulement : aucun sélecteur de fichier dans la page
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // critère 1 : série incomplète ⇒ refus, angles manquants annoncés
      await page.locator('[data-testid="inspection-submit"]').click();
      await expect(page.getByText(t('web.inspection.missing', { count: 25 }))).toBeVisible();

      // IDOR : le trip d'un autre voyageur ⇒ même message que l'inconnu
      const other = await newTrip(`G0st${randomBytes(30).toString('base64url').slice(0, 39)}`);
      await page.goto(`/trips/${other}/inspection/checkin`);
      await expect(page.getByText(t('common.inspection.notFound'))).toBeVisible();
    });
  });
}
