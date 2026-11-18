/**
 * Constancia d'arrendamiento et centre juridique (US-212) comme un utilisateur réel, à 360 px, en
 * espagnol (langue qui fait foi ; les quatre langues sont prouvées par les catalogues et les tests
 * de l'API), contre le build de production du site et le double de l'API (`e2e/stub-api.mjs`,
 * appelé par le SERVEUR du site). Minimal : le job e2e est proche de sa limite (passation d'US-211b).
 *
 * - S09 · contrat ⇒ « Otros documentos del viaje » ⇒ constancia : usage rappelé, BROUILLON, résumé
 *   (plaque, période à l'heure locale avec le NOM du pays, auto, hôte et conducteur en prénom et
 *   initiale, lieu de remise, total, contrat), PDF servi par le site sans cache avec son empreinte,
 *   texte espagnol (fait foi) puis anglais (`lang`) ;
 * - centre juridique : version et date, BROUILLON, intermédiaire entre particuliers, documents
 *   publiés, désaccords (médiation, voies externes toujours ouvertes), aucune « inapelable » ;
 * - IDOR : la constancia d'un autre ⇒ même message que l'inconnu ;
 * - recherche de l'hôte : saisie invalide ⇒ erreur ; aucun trip ⇒ message ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 19 US-212, 16 LEG-026 / LEG-011 / LEG-014 / LEG-015, 10b UX-51 ; textes : catalogue
 * officiel (`@rueda/i18n`), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, submitAndSettle, tagOf, test } from './fixtures.ts';
import { PUBLIC_ID } from './search-data.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOLD_URL = /\/checkout\/hold\/([0-9a-f-]{36})$/;
const CONSTANCIA_URL = /\/trips\/([0-9a-f-]{36})\/constancia$/;
const MAIN = 'main:not([aria-busy])';
const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf('es')));

async function cookie(context: BrowserContext, value: string): Promise<void> {
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

const token = (prefix: string): string =>
  `${prefix}${randomBytes(30)
    .toString('base64url')
    .slice(0, 43 - prefix.length)}`;

/** S03 → S05 → hold → paiement confirmé (webhooks FAKE du double) → S06 → S09 · contrat. */
async function openContract(page: Page): Promise<void> {
  const q = new URLSearchParams({ start: '2036-12-10T10:00', end: '2036-12-13T10:00' });
  await page.goto(`/listings/${PUBLIC_ID}?${q.toString()}`);
  await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await page.locator('#s05-driver-first').fill('Lucía');
  await page.locator('#s05-driver-last').fill('Gómez');
  for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
    await page.locator(`#s05-doc-${kind}`).check();
  }
  await submitAndSettle(page, page.locator('[data-testid="s05-submit"]'), HOLD_URL);
  const holdId = HOLD_URL.exec(new URL(page.url()).pathname)?.[1];
  if (holdId === undefined) throw new Error('hold non posé');
  for (const event of ['PAY', 'SUCCEEDED']) {
    const r = await fetch(`${API}/__e2e/payment/webhook?hold=${holdId}&event=${event}`);
    expect(r.status).toBe(200);
  }
  await page.goto(`/checkout/hold/${holdId}/payment`);
  await page.locator('[data-testid="s06-contract"]').click();
  await expect(page.locator('[data-testid="s09-contract-title"]')).toBeVisible();
}

test.describe('constancia et centre juridique · es', () => {
  test.use({ locale: tagOf('es') });

  test('S09 · contrat ⇒ constancia (résumé, BROUILLON, PDF, texte es puis en) ⇒ centre juridique ; constancia d’un autre ⇒ introuvable', async ({
    page,
    context,
  }) => {
    await cookie(context, token('G0stes'));
    await openContract(page);
    const contractUrl = page.url();
    const docs = page.locator('[data-testid="trip-documents"]');
    await expect(docs).toContainText(t.t('web.contract.documents'));
    await docs.locator('[data-testid="trip-constancia-link"]').click();
    await expect(page).toHaveURL(CONSTANCIA_URL);
    const tripId = CONSTANCIA_URL.exec(new URL(page.url()).pathname)?.[1] ?? '';
    await expect(page).toHaveTitle(t.t('web.constancia.title'));
    const main = page.locator(MAIN);
    await expect(main).toContainText(t.t('web.constancia.lead'));
    await expect(main).toContainText(t.t('web.constancia.draft'));
    const summary = page.locator('[data-testid="constancia-summary"]');
    await expect(summary.locator('dt')).toHaveCount(8);
    await expect(summary.locator('dt').first()).toHaveText(t.t('web.constancia.label.plate'));
    await expect(summary.locator('dd').first()).toHaveText('AB 1234');
    // hôte et conducteur en prénom et initiale (double : María G., Lucía G.), jamais un nom complet
    await expect(summary).toContainText('María G.');
    await expect(summary).toContainText('Lucía G.');
    await expect(summary).not.toContainText('Gómez');
    // aucun fuseau IANA (« Région/Ville ») dans la période
    await expect(summary).not.toContainText(/[A-Z][a-z]+\/[A-Z][A-Za-z_]+/);
    await expect(page.locator('[data-testid="contract-text-es"]')).toHaveAttribute('lang', 'es');
    await expect(page.locator('[data-testid="contract-text-courtesy"]')).toHaveAttribute(
      'lang',
      'en',
    );
    const href = await page.locator('[data-testid="constancia-pdf"]').getAttribute('href');
    expect(href).toBe(`/trips/${tripId}/constancia/pdf`);
    const pdf = await page.request.get(href ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['cache-control']).toBe('no-store');
    expect(pdf.headers()['x-constancia-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expectAccessible(page);
    await expectMobileFriendly(page);

    // retour au contrat, puis le centre juridique
    await page.locator(`${MAIN} > header a`).first().click();
    await expect(page).toHaveURL(contractUrl);
    await page.locator('[data-testid="legal-center-link"]').click();
    await expect(page).toHaveURL(/\/legal$/);
    await expect(page.locator('[data-testid="legal-center-title"]')).toHaveText(
      t.t('web.legalCenter.title'),
    );
    const center = page.locator(MAIN);
    await expect(center).toContainText(t.t('web.legal.draft'));
    await expect(center).toContainText(
      t.t('web.legalCenter.version', { version: '1', date: '' }).trim(),
    );
    await expect(page.locator('[data-testid="legal-center-role"]')).toContainText(
      t.t('web.legalCenter.role.body1'),
    );
    await expect(page.locator('[data-testid="legal-center-docs"] li a')).toHaveCount(5);
    await expect(page.locator('[data-testid="legal-center-disputes"]')).toContainText(
      t.t('web.legalCenter.disputes.body3'),
    );
    await expect(center).not.toContainText(/inapelable/i);
    await expectAccessible(page);
    await expectMobileFriendly(page);

    // un autre voyageur : même message que l'inconnu, aucune donnée de la constancia
    await context.clearCookies();
    await cookie(context, token('G0stes'));
    await page.goto(`/trips/${tripId}/constancia`);
    await expect(page.locator(MAIN)).toContainText(t.t('common.constancia.notFound'));
    await expect(page.locator(MAIN)).not.toContainText('AB 1234');
  });

  test('recherche de l’hôte : saisie invalide ⇒ erreur ; aucun trip de son compte ⇒ message', async ({
    page,
    context,
  }) => {
    await cookie(context, token('H0st'));
    await page.goto('/host/constancia');
    await expect(page).toHaveTitle(t.t('web.constancia.search.title'));
    const submit = page.locator('[data-testid="constancia-search-submit"]');
    await submitAndSettle(page, submit);
    await expect(page.locator(MAIN)).toContainText(t.t('web.constancia.search.invalid'));
    await expectAccessible(page);
    await page.locator('#constancia-search-plate').fill('AB-1234');
    await page.locator('#constancia-search-date').fill('2036-12-11');
    await submitAndSettle(page, submit);
    await expect(page.locator('[data-testid="constancia-search-results"]')).toContainText(
      t.t('web.constancia.search.none'),
    );
    await expectAccessible(page);
    await expectMobileFriendly(page);
  });
});
