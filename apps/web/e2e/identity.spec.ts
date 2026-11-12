/**
 * Parcours S04 — vérification d'identité (US-105) comme un utilisateur réel, à 360 et 390 px,
 * dans les quatre langues, contre le build de production du site et un double de l'API conforme
 * au contrat (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - 16 VER-004 : consentement biométrique SÉPARÉ, case jamais pré-cochée, texte versionné marqué
 *   BROUILLON ; envoi sans case cochée ⇒ erreur sur la case ;
 * - 16 VER-001 : pays du permis proposé (pays de la configuration), puis départ vers le parcours
 *   HÉBERGÉ du fournisseur (adresse https du fournisseur, interceptée : aucun réseau externe) ;
 * - décision du fournisseur ⇒ « Verificado » (10b §4.3, `web.s04.result.verified`) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 10b §4.3, 16 VER-001 / VER-004 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PASSWORD = 'Correct-Horse-9';
const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;
const HOSTED = /^https:\/\/identity\.fake\.invalid\/session\/fk_idv_\d{6}$/;

/** Pays : données de configuration du dépôt, jamais une constante. */
const COUNTRIES = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { code: string }[] }
).countries;

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe;
    const r = (await (axe.run as (context: unknown, options: unknown) => Promise<unknown>)(
      { include: ['main'] },
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    )) as { violations: { id: string; nodes: { target: string[] }[] }[] };
    return r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
  expect(violations, 'violations axe-core').toEqual([]);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

for (const language of LANGUAGES) {
  test.describe(`S04 identité · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('consentement séparé, pays du permis, parcours hébergé, résultat « vérifié »', async ({
      page,
      offsite,
    }, info) => {
      const email = `identity-${language}-${slug(info.project.name)}@example.test`;
      await page.goto('/login');
      await page.locator('#s15-login-email').fill(email);
      await page.locator('#s15-login-password').fill(PASSWORD);
      await page.locator('main form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/login\/done$/);

      await page.goto('/verify-identity');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // étape 1 : texte du consentement (BROUILLON), case séparée jamais pré-cochée
      const draft = SPEC_TEXT.draftMarker[language];
      if (draft !== undefined) await expect(page.locator('main article')).toContainText(draft);
      await expect(page.locator('#s04-consent')).not.toBeChecked();
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await page.locator('main form button[type="submit"]').click();
      await expect(page.locator('#s04-consent-error')).toBeVisible();

      await page.locator('#s04-consent').check();
      await page.locator('main form button[type="submit"]').first().click();
      await expect(page).toHaveURL(/\/verify-identity$/);
      // étape 2 : pays du permis parmi ceux de la configuration
      await expect(page.locator('#s04-country')).toBeVisible();
      const options = await page
        .locator('#s04-country option')
        .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
      expect(options).toEqual(COUNTRIES.map((c) => c.code));
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // étape 3 : parcours hébergé du fournisseur (intercepté : aucun réseau externe)
      let hosted = '';
      await page.route(/^https:\/\/identity\.fake\.invalid\//, (route) => {
        hosted = route.request().url();
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>provider</title><main>provider</main>',
        });
      });
      await page.locator('main form button[type="submit"]').first().click();
      await expect(page).toHaveURL(HOSTED);
      expect(hosted).toMatch(HOSTED);
      // seule sortie du site : l'adresse hébergée du fournisseur (interceptée), rien d'autre
      expect(offsite).toEqual([hosted]);
      offsite.splice(0);

      // étape 4 : le fournisseur décide ; retour sur S04
      const decided = await fetch(
        `${API}/__e2e/identity/approve?email=${encodeURIComponent(email)}`,
      );
      expect(decided.status).toBe(200);
      await page.goto('/verify-identity');
      const verified = SPEC_TEXT.identityVerified[language];
      const banner = page.locator('main').getByRole('status').first();
      await expect(banner).toBeVisible();
      if (verified !== undefined) await expect(banner).toContainText(verified);
      await expect(page.locator('main #s04-consent')).toHaveCount(0);
      await expect(page.locator('main #s04-country')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // VER-004 : retrait proposé aussi une fois vérifié ; retour à l'étape 1 (consentement)
      await page.locator('#s04-withdraw-heading').scrollIntoViewIfNeeded();
      await page
        .locator('form[aria-labelledby="s04-withdraw-heading"] button[type="submit"]')
        .click();
      await expect(page).toHaveURL(/\/verify-identity$/);
      await expect(page.locator('#s04-consent')).toBeVisible();
      await expect(page.locator('#s04-consent')).not.toBeChecked();
      await expect(page.locator('#s04-withdraw-heading')).toHaveCount(0);
      await expectAccessible(page);
    });

    test('retrait après ouverture de la session hébergée : retour au consentement', async ({
      page,
      offsite,
    }, info) => {
      const email = `identity-${language}-w-${slug(info.project.name)}@example.test`;
      await page.goto('/login');
      await page.locator('#s15-login-email').fill(email);
      await page.locator('#s15-login-password').fill(PASSWORD);
      await page.locator('main form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/login\/done$/);
      await page.goto('/verify-identity');
      await page.locator('#s04-consent').check();
      await page.locator('main form button[type="submit"]').first().click();
      await expect(page.locator('#s04-country')).toBeVisible();
      await page.route(/^https:\/\/identity\.fake\.invalid\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>p</title>',
        }),
      );
      await page.locator('main form button[type="submit"]').first().click();
      await expect(page).toHaveURL(HOSTED);
      offsite.splice(0);
      // retour sur S04 sans terminer : reprise proposée, et retrait possible
      await page.goto('/verify-identity');
      await expect(page.locator('#s04-withdraw-heading')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await page
        .locator('form[aria-labelledby="s04-withdraw-heading"] button[type="submit"]')
        .click();
      await expect(page).toHaveURL(/\/verify-identity$/);
      await expect(page.locator('#s04-consent')).toBeVisible();
      await expect(page.locator('#s04-country')).toHaveCount(0);
    });
  });
}
