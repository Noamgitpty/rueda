/**
 * Frais annexes — écran de l'hôte « Ajouter des frais avec justificatif » (A04) et du voyageur
 * « payer ou contester » (S12) (US-706), comme un utilisateur réel, à 360 px (les deux écrans
 * passent aussi par `screens.spec.ts`, captures `frais-annexes-hote` et `frais-annexes-voyageur`),
 * dans les quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site).
 *
 * - l'hôte : délai en heure serveur dans le fuseau du trip ; sans photo, la demande est refusée et
 *   rien n'est envoyé (RT-L3-S02) ; avec une photo du retour, la demande est envoyée, le voyageur
 *   prévenu, l'échéance affichée ; annulation ;
 * - le voyageur : payer (montant au bouton, accord annoncé) ; contester : motif trop court refusé
 *   et dit en clair, puis contestation envoyée avec une photo ;
 * - IDOR : les frais d'un autre trip ⇒ même message que l'inconnu ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-706, 16 CLM-021 ; textes : catalogue officiel (`@rueda/i18n`), jamais le code
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
const DEADLINE = '2097-03-13T08:00:00.000Z';
const DUE = '2097-03-13T10:00:00.000Z';
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

async function newTrip(
  guest: string,
  host: string,
  pending: boolean,
  hostFile = false,
): Promise<string> {
  const r = await fetch(
    `${API}/__e2e/incidental/new?guest=${guest}&host=${host}&pending=${pending ? 'yes' : 'no'}` +
      `&hostfile=${hostFile ? 'yes' : 'no'}`,
  );
  expect(r.status).toBe(200);
  return ((await r.json()) as { tripId: string }).tripId;
}

for (const language of LANGUAGES) {
  test.describe(`frais annexes · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('hôte : délai, sans photo refusé (RT-L3-S02), demande envoyée avec une photo, annulation ; IDOR', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = token('G0st');
      const host = token('H0st');
      const trip = await newTrip(guest, host, false);

      await setSession(context, host);
      await page.goto(`/host/trips/${trip}/incidental-fees`);
      await expect(page.locator('[data-testid="incidental-title"]')).toHaveText(
        t('web.incidental.title.HOST'),
      );
      await expect(page.locator('[data-testid="incidental-deadline"]')).toHaveText(
        t('web.incidental.lead.HOST', { date: i18n.dateTime(DEADLINE, TZ) }),
      );
      // aucune saisie d'heure
      await expect(page.locator('main input[type="time"], main input[type="date"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });

      // sans photo : refus annoncé, rien n'est envoyé
      await page.locator('[data-testid="incidental-type"]').selectOption('CLEANING');
      // séparateur décimal de la locale (configuration partagée, jamais écrit ici)
      const decimal = getProfile(LOCALE_CONFIG, tagOf(language)).number.decimal;
      await page.locator('[data-testid="incidental-amount"]').fill(`45${decimal}00`);
      await page
        .locator('[data-testid="incidental-description"]')
        .fill('Sable et boue sur la banquette arrière');
      await page.locator('[data-testid="incidental-submit"]').click();
      await expect(page.getByText(t('web.incidental.form.photoRequired'))).toBeVisible();
      await expect(page.locator('[data-testid="incidental-invoice"]')).toHaveCount(0);

      // avec une photo de l'intérieur au retour : demande envoyée, échéance du voyageur affichée
      await page.locator('[data-testid="incidental-photo-CHECKOUT-INT_01-HOST"]').check();
      await page.locator('[data-testid="incidental-submit"]').click();
      await expect(page.locator('[data-testid="incidental-done"]')).toHaveText(
        t('web.incidental.done.submitted'),
      );
      await expect(page.locator('[data-testid="incidental-status"]')).toHaveText(
        t('web.incidental.status.AWAITING_GUEST', { date: i18n.dateTime(DUE, TZ) }),
      );
      await expectAccessible(page, { include: null });
      // type déjà demandé : retiré du formulaire (INCIDENTAL_DUPLICATE évité à la source)
      await expect(
        page.locator('[data-testid="incidental-type"] option[value="CLEANING"]'),
      ).toHaveCount(0);

      // annulation par l'hôte
      await page.locator('[data-testid="incidental-cancel"]').click();
      await expect(page.locator('[data-testid="incidental-done"]')).toHaveText(
        t('web.incidental.done.cancelled'),
      );
      await expect(page.locator('[data-testid="incidental-status"]')).toHaveText(
        t('web.incidental.status.CANCELLED_BY_HOST'),
      );
      // annulée : le type se redemande
      await expect(
        page.locator('[data-testid="incidental-type"] option[value="CLEANING"]'),
      ).toHaveCount(1);
      // un second type demandé : retiré à son tour, les autres restent (revue qa delta 2)
      await page.locator('[data-testid="incidental-type"]').selectOption('SMOKING');
      await page.locator('[data-testid="incidental-amount"]').fill(`45${decimal}00`);
      await page
        .locator('[data-testid="incidental-description"]')
        .fill('Odeur de tabac dans tout l’habitacle');
      await page.locator('[data-testid="incidental-photo-CHECKOUT-INT_01-HOST"]').check();
      await page.locator('[data-testid="incidental-submit"]').click();
      await expect(page.locator('[data-testid="incidental-done"]')).toHaveText(
        t('web.incidental.done.submitted'),
      );
      await expect(page.locator('[data-testid="incidental-type"] option')).toHaveCount(2);
      await expect(
        page.locator('[data-testid="incidental-type"] option[value="SMOKING"]'),
      ).toHaveCount(0);

      // IDOR : les frais (et leurs preuves) d'un autre trip ⇒ même message que l'inconnu
      const other = await newTrip(token('G0st'), token('H0st'), true);
      await page.goto(`/host/trips/${other}/incidental-fees`);
      await expect(page.getByText(t('common.incidental.notFound'))).toBeVisible();
      await expect(page.locator('[data-testid="incidental-evidence"]')).toHaveCount(0);
      await page.goto(`/trips/${other}/incidental-fees`);
      await expect(page.getByText(t('common.incidental.notFound'))).toBeVisible();
      await expect(page.locator('[data-testid="incidental-evidence"]')).toHaveCount(0);
    });

    test('voyageur : payer (montant au bouton) ; contester avec motif et photo', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      // marché fictif du double (`MARKET` de e2e/stub-api.mjs : XTS, deux décimales)
      const amount = i18n.money({ amountMinor: 4500n, currency: 'XTS', exponent: 2 });

      const guest = token('G0st');
      const trip = await newTrip(guest, token('H0st'), true);
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/incidental-fees`);
      await expect(page.locator('[data-testid="incidental-title"]')).toHaveText(
        t('web.incidental.title.GUEST'),
      );
      await expect(page.locator('[data-testid="incidental-amount-shown"]')).toHaveText(amount);
      await expect(page.getByText(t('web.incidental.payNotice'))).toBeVisible();
      // preuves retenues visibles AVANT de payer (revue ux n° 1)
      await expect(page.locator('[data-testid="incidental-evidence"] li')).toHaveText([
        t('web.incidental.evidenceItem', {
          side: t('web.incidental.side.CHECKOUT'),
          slot: t('web.incidental.slot.INTERIOR'),
          by: t('web.incidental.by.HOST'),
          date: i18n.dateTime('2097-03-10T08:00:00.000Z', TZ),
        }),
      ]);
      // aucun lien vers l'écran de prise de photos (revue ux delta) : la liste fait foi
      await expect(page.locator('[data-testid="incidental-photos-link"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="incidental-status"]')).toHaveText(
        t('web.incidental.statusGuest.AWAITING_GUEST', { date: i18n.dateTime(DUE, TZ) }),
      );
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });
      await expect(page.locator('[data-testid="incidental-accept"]')).toHaveText(
        t('web.s12.accept', { amount }),
      );
      await page.locator('[data-testid="incidental-accept"]').click();
      await expect(page.locator('[data-testid="incidental-status"]')).toHaveText(
        t('web.incidental.status.ACCEPTED'),
      );
      await expect(page.locator('[data-testid="incidental-accept"]')).toHaveCount(0);

      // contestation : motif trop court refusé et dit, puis envoyée avec une photo
      const guest2 = token('G0st');
      const trip2 = await newTrip(guest2, token('H0st'), true);
      await setSession(context, guest2);
      await page.goto(`/trips/${trip2}/incidental-fees`);
      await page.locator('[data-testid="incidental-contest"]').click();
      await page.locator('[data-testid="incidental-reason"]').fill('Pas d’accord');
      await page.locator('[data-testid="incidental-photo-CHECKOUT-INT_02-GUEST"]').check();
      await page.locator('[data-testid="incidental-dispute-submit"]').click();
      await expect(page.getByText(t('web.incidental.dispute.reasonInvalid'))).toBeVisible();
      await page
        .locator('[data-testid="incidental-reason"]')
        .fill('La voiture a été rendue propre, voir ma photo de l’intérieur au retour.');
      await page.locator('[data-testid="incidental-photo-CHECKOUT-INT_02-GUEST"]').check();
      await page.locator('[data-testid="incidental-dispute-submit"]').click();
      // marque de la coquille (donnée de thème) : la phrase est comparée après la marque
      const disputed = t('web.incidental.done.disputed', { brand: 'BRAND' });
      await expect(page.locator('[data-testid="incidental-done"]')).toContainText(
        disputed.slice(disputed.indexOf('BRAND') + 5),
      );
      await expect(page.locator('[data-testid="incidental-dispute-reason"]')).toHaveText(
        'La voiture a été rendue propre, voir ma photo de l’intérieur au retour.',
      );
      await expectAccessible(page, { include: null });
    });

    test('ADR-202 : fichier de l’hôte décrit au voyageur avant de payer ; après une contestation, l’hôte est prévenu que l’annulation est définitive et le type ne se redemande plus', async ({
      page,
      context,
    }) => {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      const t = i18n.t.bind(i18n);
      const guest = token('G0st');
      const host = token('H0st');
      const trip = await newTrip(guest, host, true, true);
      await setSession(context, guest);
      await page.goto(`/trips/${trip}/incidental-fees`);
      // chaque pièce retenue est décrite (F-L3-FRA-02) : la photo du retour et le fichier de l'hôte
      await expect(page.locator('[data-testid="incidental-evidence"] li')).toHaveText([
        t('web.incidental.evidenceItem', {
          side: t('web.incidental.side.CHECKOUT'),
          slot: t('web.incidental.slot.INTERIOR'),
          by: t('web.incidental.by.HOST'),
          date: i18n.dateTime('2097-03-10T08:00:00.000Z', TZ),
        }),
        t('web.incidental.evidenceHostFile', {
          format: 'JPEG',
          date: i18n.dateTime('2097-03-10T10:00:00.000Z', TZ),
        }),
      ]);
      await expectMobileFriendly(page);
      await expectAccessible(page, { include: null });
      // le voyageur conteste
      await page.locator('[data-testid="incidental-contest"]').click();
      await page
        .locator('[data-testid="incidental-reason"]')
        .fill('La voiture a été rendue propre, voir ma photo de l’intérieur au retour.');
      await page.locator('[data-testid="incidental-photo-CHECKOUT-INT_02-GUEST"]').check();
      await page.locator('[data-testid="incidental-dispute-submit"]').click();
      await expect(page.locator('[data-testid="incidental-dispute-reason"]')).toBeVisible();

      // l'hôte : avertissement, annulation, puis le type n'est plus proposé (F-L3-FRA-01)
      await setSession(context, host);
      await page.goto(`/host/trips/${trip}/incidental-fees`);
      await expect(page.locator('[data-testid="incidental-cancel-final"]')).toHaveText(
        t('web.incidental.cancelDisputedFinal'),
      );
      await expectAccessible(page, { include: null });
      // confirmation exigée : sans la case, rien n'est envoyé (champ requis)
      await page.locator('[data-testid="incidental-cancel"]').click();
      await expect(page.locator('[data-testid="incidental-done"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="incidental-status"]')).not.toHaveText(
        t('web.incidental.status.CANCELLED_BY_HOST'),
      );
      await page.locator('[data-testid="incidental-cancel-confirm"]').check();
      await page.locator('[data-testid="incidental-cancel"]').click();
      await expect(page.locator('[data-testid="incidental-status"]')).toHaveText(
        t('web.incidental.status.CANCELLED_BY_HOST'),
      );
      await expect(page.locator('[data-testid="incidental-cancel-final"]')).toHaveCount(0);
      // le type retiré est dit à l'hôte, avec la raison
      await expect(page.locator('[data-testid="incidental-abandoned"]')).toContainText(
        t('web.incidental.fee.CLEANING'),
      );
      await expect(
        page.locator('[data-testid="incidental-type"] option[value="CLEANING"]'),
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="incidental-type"] option')).toHaveCount(2);
    });
  });
}
