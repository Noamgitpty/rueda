/**
 * Parcours doré « trip complet » à 360 px, utilisé d'une main (US-312, critère 2 de 19) : remise
 * puis retour du véhicule entre particuliers, l'hôte (A03 / A04) et le voyageur (S09 · check-in
 * et check-out) sur le même trip, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`). Espagnol seulement (chaque écran est éprouvé en quatre langues par
 * `trip-handover.spec.ts`, et capturé par `screens.spec.ts` : `remise-hote`, `remise-voyageur`,
 * `retour-hote`, `retour-voyageur`, régression visuelle).
 *
 * « D'une main » (PROPOSÉ, 10b UX-41 / UX-42, mobile d'abord) : à chaque étape, aucun défilement
 * horizontal, toute cible tactile d'au moins 44 px (`expectMobileFriendly`), l'action principale
 * de l'étape sur toute la largeur utile (atteignable par l'un ou l'autre pouce) et activable sans
 * geste multipoint ; axe-core (WCAG 2.2 A / AA) sans violation.
 * Attendus : 19 US-312 et US-315, 16 TRP-002, TRP-033, 10b A03, A04, S09 ; textes : catalogue
 * officiel (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, MIN_TARGET_PX, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
/** Heure « serveur » fixe du double et fuseau du premier pays (mêmes sources que le double). */
const SERVER_AT = '2036-12-10T15:00:00.000Z';
const TZ = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]?.timeZone as string;

const token = (prefix: 'H0st' | 'G0st'): string =>
  `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`;

async function as(context: BrowserContext, value: string): Promise<void> {
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

/** Étape utilisable d'une main : cibles, largeur de l'action principale, accessibilité. */
async function oneHanded(page: Page, action: Locator): Promise<void> {
  await expectMobileFriendly(page);
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'action principale visible').not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(box!.width, 'action principale sur la largeur utile').toBeGreaterThanOrEqual(
    0.7 * viewport!.width,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  await expectAccessible(page, { include: null });
}

test.use({ locale: tagOf('es') });

test('remise puis retour du véhicule, hôte et voyageur, d’une main à 360 px', async ({
  page,
  context,
}) => {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf('es')));
  const t = i18n.t.bind(i18n);
  const guest = token('G0st');
  const host = token('H0st');
  const r = await fetch(`${API}/__e2e/handover/new?guest=${guest}&host=${host}&status=BOOKED`);
  expect(r.status).toBe(200);
  const trip = ((await r.json()) as { tripId: string }).tripId;
  const submit = page.locator('[data-testid="handover-validate-submit"]');

  // --- départ : l'hôte arrive, contrôle le permis, remet les clés ---------------------------------
  await as(context, host);
  await page.goto(`/host/trips/${trip}/handover/checkin`);
  const arrived = page.locator('[data-testid="handover-arrived"]');
  await oneHanded(page, arrived);
  await arrived.click();
  const confirm = page.locator('[data-testid="handover-identity-confirm"]');
  await expect(confirm).toBeVisible();
  for (const point of ['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions']) {
    await page.locator(`#handover-check-${point}`).check();
  }
  await oneHanded(page, confirm);
  await confirm.click();
  await expect(page.getByText(t('web.handover.license.ok'))).toBeVisible();
  await page.locator('#handover-odometer').fill('41250');
  await page.locator('#handover-fuel').selectOption('8');
  await expect(submit).toHaveText(t('web.a03.handover'));
  await oneHanded(page, submit);
  await submit.click();
  await expect(page.getByText(t('web.handover.waiting.HOST'))).toBeVisible();

  // --- départ : le voyageur valide sa part ⇒ trip en cours à l'heure serveur ----------------------
  await as(context, guest);
  await page.goto(`/trips/${trip}/handover/checkin`);
  await page.locator('#handover-odometer').fill('41250');
  await oneHanded(page, submit);
  await submit.click();
  await expect(
    page.getByText(t('web.handover.done.checkin', { date: i18n.dateTime(SERVER_AT, TZ) })),
  ).toBeVisible();
  await expectAccessible(page, { include: null });

  // --- retour : l'hôte relève compteur et carburant, valide sa part -------------------------------
  await as(context, host);
  await page.goto(`/host/trips/${trip}/handover/checkout`);
  await expect(page.locator('[data-testid="handover-title"]')).toHaveText(
    t('web.handover.title.checkout'),
  );
  await page.locator('#handover-odometer').fill('41790');
  await page.locator('#handover-fuel').selectOption('6');
  await expect(submit).toHaveText(t('web.handover.validate.HOST.checkout'));
  await oneHanded(page, submit);
  await submit.click();
  await expect(page.getByText(t('web.handover.waiting.HOST'))).toBeVisible();

  // --- retour : le voyageur valide ⇒ auto rendu à l'heure serveur ---------------------------------
  await as(context, guest);
  await page.goto(`/trips/${trip}/handover/checkout`);
  await page.locator('#handover-odometer').fill('41790');
  const fuel = page.locator('#handover-fuel');
  if ((await fuel.count()) > 0) await fuel.selectOption('6');
  await expect(submit).toHaveText(t('web.handover.validate.GUEST.checkout'));
  await oneHanded(page, submit);
  await submit.click();
  await expect(
    page.getByText(t('web.handover.done.checkout', { date: i18n.dateTime(SERVER_AT, TZ) })),
  ).toBeVisible();
  await expectAccessible(page, { include: null });
});
