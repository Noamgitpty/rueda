/**
 * Remise du véhicule entre particuliers — A03 de l'hôte et S09 · check-in du voyageur (US-315),
 * comme un utilisateur réel, à 360 px (l'écran A03 passe aussi à 390 px et en tablette par
 * `screens.spec.ts`), dans les quatre langues, contre le build de production du site et le
 * double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site).
 *
 * - arrivée : « Ya llegué » ouvre la remise ;
 * - contrôle du permis (hôte) : prénom, initiale et année de naissance seulement, 6 points ;
 *   confirmer sans les 6 cases ⇒ refus annoncé ; aucune image ni sélecteur de fichier ;
 * - validation : compteur et carburant, en personne seulement (aucune option sans rencontre,
 *   aucune heure saisie) ; l'hôte attend le voyageur ; le voyageur valide ⇒ trip en cours à
 *   l'heure serveur ;
 * - IDOR : la remise d'un autre trip ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-315, 16 TRP-002, VER-015, 10b A03, UX-41 ; textes : catalogue officiel
 * (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
/** Heure « serveur » fixe du double et fuseau du premier pays (mêmes sources que le double). */
const SERVER_AT = '2036-12-10T15:00:00.000Z';
const TZ = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]?.timeZone as string;

async function signIn(context: BrowserContext, prefix: 'H0st' | 'G0st'): Promise<string> {
  const value = `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`;
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
  return value;
}

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

async function newTrip(guest: string, host: string): Promise<string> {
  const r = await fetch(`${API}/__e2e/handover/new?guest=${guest}&host=${host}&status=BOOKED`);
  expect(r.status).toBe(200);
  return ((await r.json()) as { tripId: string }).tripId;
}

for (const language of LANGUAGES) {
  test.describe(`remise du véhicule · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('arrivée, permis en 6 points, validation des deux parties, IDOR', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = await signIn(context, 'G0st');
      const host = await signIn(context, 'H0st');
      const trip = await newTrip(guest, host);

      // étape 1 : arrivée
      await page.goto(`/host/trips/${trip}/handover/checkin`);
      await expect(page.locator('[data-testid="handover-title"]')).toHaveText(
        t('web.handover.title.checkin'),
      );
      await page.locator('[data-testid="handover-arrived"]').click();

      // étape 2 : ce que l'hôte voit du voyageur, rien d'autre ; aucune image de pièce
      const who = page.locator('[data-testid="handover-guest"]');
      await expect(who).toContainText('Ana P.');
      await expect(who).toContainText('1990');
      await expect(page.locator('main img')).toHaveCount(0);
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      // remise en personne seulement : aucun choix du mode de remise
      await expect(page.locator('[name="method"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // confirmer sans les 6 cases ⇒ refus annoncé
      await page.locator('[data-testid="handover-identity-confirm"]').click();
      await expect(page.getByText(t('common.handover.licenseCheckIncomplete'))).toBeVisible();
      for (const point of ['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions']) {
        await page.locator(`#handover-check-${point}`).check();
      }
      await page.locator('[data-testid="handover-identity-confirm"]').click();
      await expect(page.getByText(t('web.handover.license.ok'))).toBeVisible();

      // étape finale : relevés, « Entregar las llaves », attente du voyageur
      await page.locator('#handover-odometer').fill('41250');
      await page.locator('#handover-fuel').selectOption('8');
      await expect(page.locator('[data-testid="handover-validate-submit"]')).toHaveText(
        t('web.a03.handover'),
      );
      await page.locator('[data-testid="handover-validate-submit"]').click();
      await expect(page.getByText(t('web.handover.waiting.HOST'))).toBeVisible();

      // le voyageur : statut du contrôle seulement, puis sa validation ⇒ trip en cours
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/handover/checkin`);
      await expect(page.getByText(t('web.handover.license.ok'))).toBeVisible();
      await expect(page.locator('[data-testid="handover-guest"]')).toHaveCount(0);
      await page.locator('#handover-odometer').fill('41250');
      await page.locator('[data-testid="handover-validate-submit"]').click();
      await expect(
        page.getByText(t('web.handover.done.checkin', { date: i18n.dateTime(SERVER_AT, TZ) })),
      ).toBeVisible();
      await expectAccessible(page, { include: null });

      // IDOR : la remise d'un autre trip ⇒ même message que l'inconnu
      const other = await newTrip(
        `G0st${randomBytes(30).toString('base64url').slice(0, 39)}`,
        `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`,
      );
      await page.goto(`/trips/${other}/handover/checkin`);
      await expect(page.getByText(t('common.handover.notFound'))).toBeVisible();
    });
  });
}
