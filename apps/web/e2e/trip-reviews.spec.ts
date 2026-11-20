/**
 * S13 — avis du voyageur (US-317), avis reçus (droit d'accès, Ley 81), A13 et bloc de l'hôte de la
 * fiche (LST-020), comme un utilisateur réel, à 360 px seulement (S13 et les avis reçus passent aussi
 * par `screens.spec.ts` : quatre langues, axe à 360 et 390 px, captures), contre le build de
 * production du site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site). Une
 * seule langue ici (durée du job e2e) :
 *
 * - fenêtre rendue en date, double aveugle annoncé avec le prénom de l'hôte (`web.review.blind`) ;
 * - texte exigé de 1 à 3 : erreur liée au champ, saisie gardée ; puis envoi ⇒ avis « en attente »
 *   (scellé : l'hôte n'a pas noté), coordonnées masquées et annoncées, aucun formulaire de plus ;
 *   jamais une note ni un texte dans l'URL ;
 * - avis reçus : l'avis publié de l'hôte, prénom de l'auteur ;
 * - A13 : bloc de l'hôte (prénom, ancienneté) et avis des voyageurs ; fiche : « Miembro desde » ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-317, 16 REV-001 / REV-002 / REV-004 / LST-020, 10b S13 / A13 §4.3 ; textes :
 * catalogue officiel (`@rueda/i18n`), jamais le code testé. Les vraies règles (fenêtre, scellé,
 * publication simultanée, masquage) sont prouvées sur PostgreSQL (l0-us317-*).
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, submitAndSettle, tagOf, test } from './fixtures.ts';

const LANGUAGE = 'es' as const;
const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf(LANGUAGE)));
const t = i18n.t.bind(i18n);
/** Trip fixe du double (e2e/stub-api.mjs) : voiture rendue, l'hôte n'a pas noté. */
const REVIEW_TRIP = '00000000-0000-4000-8000-000000317e2e';
/** Annonce publique du double (US-204). */
const PUBLIC_LISTING = '11500000-0000-4000-8000-00000000f001';
/** Numéro FICTIF (plage réservée à la fiction). */
const PHONE = '+1 555 0123 4567';

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

test.describe(`Avis S13, avis reçus, A13 · ${LANGUAGE}`, () => {
  test.use({ locale: tagOf(LANGUAGE) });

  test('S13 : double aveugle annoncé ; texte exigé de 1 à 3 ; avis scellé en attente, coordonnées masquées', async ({
    page,
    context,
  }) => {
    await signIn(context, 'G0st');
    await page.goto(`/trips/${REVIEW_TRIP}/review`);
    await expect(page.locator('[data-testid="review-title"]')).toHaveText(
      t('web.review.heading.guest'),
    );
    await expect(page.locator('[data-testid="review-blind"]')).toContainText(
      t('web.review.blind', { name: 'María', count: 10 }),
    );
    await expect(page.locator('[data-testid="review-published"]')).toContainText(
      t('web.review.publishedEmpty'),
    );
    await expectMobileFriendly(page);
    await expectAccessible(page, { include: null });

    // note de 2 sans texte suffisant : erreur liée au champ, saisie gardée, rien d'envoyé
    await page.locator('[data-testid="review-overall-2"]').check();
    await page.locator('[data-testid="review-text"]').fill('Corto.');
    await page.locator('[data-testid="review-submit"]').click();
    await expect(page.locator('#review-text-error')).toHaveText(t('common.reviews.textRequired'));
    await expect(page.locator('[data-testid="review-text"]')).toHaveValue('Corto.');
    await expect(page.locator('[data-testid="review-overall-2"]')).toBeChecked();
    await expectAccessible(page, { include: null });

    // texte suffisant avec un numéro : envoyé, scellé (l'hôte n'a pas noté), numéro masqué
    await page
      .locator('[data-testid="review-text"]')
      .fill(`El auto olía a cigarro y llegó tarde. Escríbeme al ${PHONE}`);
    await page.locator('#review-score-cleanliness').selectOption('1');
    await submitAndSettle(
      page,
      page.locator('[data-testid="review-submit"]'),
      /\/trips\/[0-9a-f-]{36}\/review[?]rv=SUBMITTED$/,
    );
    await expect(page.locator('[data-testid="review-done"]')).toContainText(
      t('web.review.done.SUBMITTED'),
    );
    const mine = page.locator('[data-testid="review-mine"]');
    await expect(mine).toContainText(t('web.review.status.SUBMITTED'));
    await expect(mine).toContainText(t('web.review.stars', { count: 2 }));
    await expect(mine).toContainText('Escríbeme al •••');
    await expect(mine).toContainText(t('web.review.masked'));
    await expect(page.locator('main')).not.toContainText(PHONE);
    await expect(page.locator('[data-testid="review-form"]')).toHaveCount(0);
    expect(page.url()).not.toContain('cigarro');
    await expectAccessible(page, { include: null });
  });

  test('avis reçus (droit d’accès) puis A13 et fiche : prénoms, ancienneté', async ({
    page,
    context,
  }) => {
    await signIn(context, 'G0st');
    await page.goto('/reviews');
    await expect(page.locator('[data-testid="reviews-title"]')).toHaveText(
      t('web.reviews.received.title'),
    );
    const asGuest = page.locator('[data-testid="reviews-as-guest"]');
    await expect(asGuest).toContainText('María');
    await expect(asGuest).toContainText('Devolvió el auto limpio');
    await expect(page.locator('[data-testid="reviews-as-host"]')).toHaveCount(0);
    await expectMobileFriendly(page);
    await expectAccessible(page, { include: null });

    await context.clearCookies();
    await signIn(context, 'H0st');
    await page.goto('/host/profile');
    await expect(page.locator('[data-testid="a13-title"]')).toHaveText(t('web.a13.title'));
    await expect(page.locator('#a13-host')).toContainText('Ana');
    await expect(page.locator('#a13-host')).toContainText(
      t('common.ui.host.since', { year: '2024' }),
    );
    await expect(page.locator('[data-testid="a13-reviews"]')).toContainText('Lucía');
    await expectAccessible(page, { include: null });

    await page.goto(`/listings/${PUBLIC_LISTING}`);
    await expect(page.locator('#s03-host')).toContainText(
      t('common.ui.host.since', { year: '2024' }),
    );
  });
});
