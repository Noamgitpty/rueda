/**
 * S16 — messages du trip du voyageur (US-525), comme un utilisateur réel, à 360 px seulement (l'écran
 * passe aussi par `screens.spec.ts` : quatre langues, axe à 360 et 390 px, captures à 360 px et en
 * tablette), contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`, appelé
 * par le SERVEUR du site). Une seule langue ici (durée du job e2e) :
 *
 * - bandeau permanent « tout paiement passe par la plateforme », prénom de l'hôte, message reçu ;
 * - critère 1 : un numéro envoyé est masqué dans le fil et l'expéditeur voit le rappel ;
 * - critère 2 : « efectivo » ⇒ message gardé tel quel (jamais refusé) et rappel du paiement ;
 * - texte vide : erreur liée au champ ; fil fermé : lecture seule, aucun formulaire ;
 * - trip dont la session n'est pas partie : même message qu'un trip inconnu ;
 * - rendez-vous (US-316, critère 4) : remise proposée par l'hôte (lieu, heure), confirmée par le
 *   voyageur ⇒ statut « confirmé » et bannière ; jamais de lieu dans l'URL ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-525, 16 MSG-001 / MSG-007, 10b S16 ; textes : catalogue officiel
 * (`@rueda/i18n`), jamais le code testé. Le masquage du double n'est qu'une imitation : les vraies
 * règles sont prouvées sur PostgreSQL (l0-us525-messaging).
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, submitAndSettle, tagOf, test } from './fixtures.ts';

const LANGUAGE = 'es' as const;
const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(LANGUAGE)));
const t = i18n.t.bind(i18n);
/** Trips fixes du double (e2e/stub-api.mjs) : fil ouvert, fil fermé. */
const OPEN_TRIP = '00000000-0000-4000-8000-000000525e2e';
const CLOSED_TRIP = '00000000-0000-4000-8000-000000525c10';
/** Numéro FICTIF (plage réservée à la fiction). */
const PHONE = '+1 555 0123 4567';
const sentUrl = (notices: string): RegExp =>
  new RegExp(`/trips/[0-9a-f-]{36}/messages[?]sent=1${notices === '' ? '$' : `&n=${notices}$`}`);

async function signIn(context: BrowserContext, prefix: 'G0st' | 'H0st'): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `${prefix}${LANGUAGE}${randomBytes(30).toString('base64url').slice(0, 37)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

async function send(page: Page, text: string, notices: string): Promise<void> {
  await page.locator('[data-testid="s16-body"]').fill(text);
  await submitAndSettle(page, page.locator('[data-testid="s16-send"]'), sentUrl(notices));
  // formulaire remonté vide après l'envoi (nouvel identifiant de message)
  await expect(page.locator('[data-testid="s16-body"]')).toHaveValue('');
}

test.describe(`Messages du trip S16 · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('fil, numéro masqué avec rappel, paiement hors plateforme signalé sans refus, texte vide refusé', async ({
    page,
    context,
  }) => {
    await signIn(context, 'G0st');
    await page.goto(`/trips/${OPEN_TRIP}/messages`);
    await expect(page.locator('[data-testid="s16-title"]')).toHaveText(t('web.s16.heading'));
    await expect(page.locator('[data-testid="s16-pay-on-platform"]')).toBeVisible();
    await expect(page.getByText(t('web.s16.with', { name: 'María' })).first()).toBeVisible();
    await expect(page.locator('[data-testid="s16-message"]')).toHaveCount(1);
    await expectMobileFriendly(page);
    await expectAccessible(page, { include: null });

    // critère 1 : numéro masqué dans le fil, rappel à l'expéditeur
    await send(page, `escríbeme al ${PHONE}`, 'CONTACT_MASKED');
    await expect(page.locator('[data-testid="s16-notice-contact"]')).toBeVisible();
    const last = page.locator('[data-testid="s16-message"]').last();
    await expect(last).toContainText('escríbeme al •••');
    await expect(last).toContainText(t('web.s16.masked'));
    await expect(page.locator('main')).not.toContainText(PHONE);
    await expectAccessible(page, { include: null });

    // critère 2 : « efectivo » ⇒ message gardé tel quel, rappel du paiement par la plateforme
    await send(page, 'te pago en efectivo', 'OFF_PLATFORM_PAYMENT');
    await expect(page.locator('[data-testid="s16-notice-payment"]')).toBeVisible();
    await expect(page.locator('[data-testid="s16-message"]').last()).toContainText(
      'te pago en efectivo',
    );
    await expect(page.locator('[data-testid="s16-message"]')).toHaveCount(3);

    // message ordinaire : confirmation, aucun rappel
    await send(page, 'Llego a las 10:30', '');
    await expect(page.locator('[data-testid="s16-sent"]')).toBeVisible();
    await expect(page.locator('[data-testid="s16-notice-payment"]')).toHaveCount(0);

    // texte vide : erreur liée au champ, rien n'est envoyé
    await page.locator('[data-testid="s16-body"]').fill('   ');
    await page.locator('[data-testid="s16-send"]').click();
    await expect(page.locator('#s16-body-error')).toHaveText(t('web.s16.form.required'));
    await expect(page.locator('[data-testid="s16-message"]')).toHaveCount(4);
  });

  test('rendez-vous : remise proposée par l’hôte, confirmée par le voyageur (US-316)', async ({
    page,
    context,
  }) => {
    await signIn(context, 'G0st');
    await page.goto(`/trips/${OPEN_TRIP}/messages`);
    const block = page.locator('[data-testid="s16-meetings"]');
    await expect(block).toContainText(t('web.s16.meeting.heading'));
    const card = page.locator('[data-testid="s16-meeting"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(t('web.s16.meeting.kind.PICKUP'));
    await expect(card).toContainText(t('web.s16.meeting.status.PROPOSED'));
    await expect(card).toContainText('Estacionamiento del centro comercial');
    // le voyageur ne propose pas : aucun formulaire de proposition
    await expect(page.locator('[data-testid="s16-meeting-form"]')).toHaveCount(0);
    await expectAccessible(page, { include: null });

    await submitAndSettle(
      page,
      page.locator('[data-testid="s16-meeting-accept"]'),
      /\/trips\/[0-9a-f-]{36}\/messages[?]mt=ACCEPTED$/,
    );
    await expect(page.locator('[data-testid="s16-meeting-done"]')).toHaveText(
      t('web.s16.meeting.done.ACCEPTED'),
    );
    await expect(card).toContainText(t('web.s16.meeting.status.ACCEPTED'));
    await expect(page.locator('[data-testid="s16-meeting-accept"]')).toHaveCount(0);
    expect(page.url()).not.toContain('Estacionamiento');
    await expectAccessible(page, { include: null });
  });

  test('fil fermé : lecture seule ; trip dont la session n’est pas partie : introuvable', async ({
    page,
    context,
  }) => {
    await signIn(context, 'G0st');
    await page.goto(`/trips/${CLOSED_TRIP}/messages`);
    await expect(page.locator('[data-testid="s16-closed"]')).toBeVisible();
    await expect(page.locator('[data-testid="s16-form"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="s16-message"]')).toHaveCount(1);
    await expectAccessible(page, { include: null });

    await context.clearCookies();
    await signIn(context, 'H0st');
    await page.goto(`/trips/${OPEN_TRIP}/messages`);
    await expect(page.getByText(t('common.trips.notFound'))).toBeVisible();
    await expect(page.locator('[data-testid="s16-thread"]')).toHaveCount(0);
  });
});
