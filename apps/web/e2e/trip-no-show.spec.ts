/**
 * No-show entre particuliers — écran de l'hôte « le voyageur n'est pas venu » et du voyageur
 * « l'hôte n'est pas venu » (US-307), comme un utilisateur réel, à 360 px (l'écran de l'hôte passe
 * aussi par `screens.spec.ts`, capture `no-show-hote`), dans les quatre langues, contre le build de
 * production du site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site).
 *
 * - l'hôte : fenêtre en heure serveur dans le fuseau du trip, preuve tracée, déclaration définitive
 *   confirmée (sans la case : refus annoncé, rien n'est envoyé), puis état « en cours » ; le
 *   voyageur voit la même demande ;
 * - le voyageur sans message tracé : obstacle « preuve manquante » dit en clair, aucun formulaire ;
 * - IDOR : le no-show d'un autre trip ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-307, 16 TRP-015 ; textes : catalogue officiel (`@rueda/i18n`), jamais le code
 * testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
/** Heures « serveur » du double et fuseau du premier pays (mêmes sources que le double). */
const FROM = '2036-12-10T13:00:00.000Z';
const UNTIL = '2036-12-13T12:00:00.000Z';
const DECLARED_AT = '2036-12-10T15:00:00.000Z';
const TZ = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { timeZone: string }[] }
).countries[0]?.timeZone as string;

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

async function newTrip(guest: string, host: string, traced: boolean): Promise<string> {
  const r = await fetch(
    `${API}/__e2e/no-show/new?guest=${guest}&host=${host}&traced=${traced ? 'yes' : 'no'}`,
  );
  expect(r.status).toBe(200);
  return ((await r.json()) as { tripId: string }).tripId;
}

for (const language of LANGUAGES) {
  test.describe(`no-show · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('hôte : fenêtre, preuve, déclaration confirmée ; voyageur : même demande ; IDOR', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = token('G0st');
      const host = token('H0st');
      const trip = await newTrip(guest, host, true);

      await setSession(context, host);
      await page.goto(`/host/trips/${trip}/no-show`);
      await expect(page.locator('[data-testid="no-show-title"]')).toHaveText(
        t('web.noShow.title.HOST'),
      );
      await expect(page.locator('[data-testid="no-show-window"]')).toHaveText(
        t('web.noShow.lead.HOST', { d1: i18n.dateTime(FROM, TZ), d2: i18n.dateTime(UNTIL, TZ) }),
      );
      await expect(page.getByText(t('web.noShow.traced.yes'))).toBeVisible();
      // aucune saisie d'heure ni de montant
      await expect(page.locator('main input[type="number"], main input[type="time"]')).toHaveCount(
        0,
      );
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // sans la case « décision définitive » : refus annoncé, rien n'est envoyé
      await page.locator('[data-testid="no-show-submit"]').click();
      await expect(page.getByText(t('web.noShow.confirmRequired'))).toBeVisible();
      await page.locator('#no-show-confirm').check();
      await page.locator('[data-testid="no-show-submit"]').click();
      await expect(
        page.getByText(t('web.noShow.status.PENDING', { date: i18n.dateTime(DECLARED_AT, TZ) })),
      ).toBeVisible();
      await expect(page.getByText(t('web.noShow.reason.GUEST_NO_SHOW'))).toBeVisible();
      await expect(page.locator('[data-testid="no-show-form"]')).toHaveCount(0);

      // le voyageur déclaré absent lit la déclaration de SON point de vue, sans formulaire
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/no-show`);
      await expect(page.locator('[data-testid="no-show-title"]')).toHaveText(
        t('web.noShow.title.against'),
      );
      await expect(page.locator('[data-testid="no-show-against"]')).toHaveText(
        t('web.noShow.against.GUEST', { date: i18n.dateTime(DECLARED_AT, TZ) }),
      );
      await expect(page.locator('[data-testid="no-show-form"]')).toHaveCount(0);
      await expectAccessible(page, { include: null });

      // IDOR : le no-show d'un autre trip ⇒ même message que l'inconnu
      const other = await newTrip(token('G0st'), token('H0st'), true);
      await page.goto(`/trips/${other}/no-show`);
      await expect(page.getByText(t('common.noShow.notFound'))).toBeVisible();
    });

    test('voyageur sans message tracé : la preuve manquante est dite, aucun formulaire', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = token('G0st');
      const trip = await newTrip(guest, token('H0st'), false);
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/no-show`);
      await expect(page.locator('[data-testid="no-show-blocker"]')).toHaveText(
        t('common.noShow.evidenceRequired'),
      );
      await expect(page.getByText(t('web.noShow.traced.no'))).toBeVisible();
      await expect(page.locator('[data-testid="no-show-form"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });
    });
  });
}
