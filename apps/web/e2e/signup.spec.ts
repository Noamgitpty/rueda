/**
 * Parcours S15 — inscription, CGU et consentements versionnés (US-102) comme un utilisateur réel,
 * à 360 et 390 px, dans les quatre langues, contre le build de production du site et un double de
 * l'API conforme au contrat (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - critère 1 : formulaire valide, CGU cochées ⇒ écran « Revisa tu correo » ; l'API reçoit les
 *   versions AFFICHÉES des CGU et de la confidentialité, l'opt-in non coché, la langue de la vue ;
 * - critère 2 : CGU non cochées ⇒ erreur sur la case, aucun compte ; email existant ⇒ écran
 *   identique au succès ;
 * - critère 3 : compte qui a accepté une version périmée ⇒ réacceptation à la reconnexion, avant
 *   toute réservation ; case obligatoire ;
 * - cases jamais pré-cochées (10b UX-56), mention BROUILLON des textes provisoires (OQ-BR-24) ;
 * - accessibilité minimale : axe-core (WCAG 2.2 A / AA) sans violation, champs libellés,
 *   récapitulatif d'erreurs annoncé ; mobile d'abord (aucun défilement horizontal, cibles ≥ 44 px).
 * Attendus : 10b §4.3 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? 3199}`;
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PASSWORD = 'Correct-Horse-9';

interface Recorded {
  readonly email: string;
  readonly locale: string;
  readonly termsAccepted: boolean;
  readonly marketingOptIn: boolean;
  readonly acceptedDocuments?: readonly { kind: string; version: number }[];
}

async function received(email: string): Promise<Recorded[]> {
  const all = (await (await fetch(`${API}/__e2e/signups`)).json()) as Recorded[];
  return all.filter((s) => s.email === email);
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe;
    // l'écran (`main`) : la coquille (en-tête, menu des langues) relève d'US-048
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

const unique = (language: string) =>
  `s15-${language}-${Math.random().toString(36).slice(2, 10)}@example.test`;

async function fill(page: Page, email: string): Promise<void> {
  await page.locator('#s15-first').fill('Ana');
  await page.locator('#s15-last').fill('Prueba');
  await page.locator('#s15-email').fill(email);
  await page.locator('#s15-password').fill(PASSWORD);
}

for (const language of LANGUAGES) {
  test.describe(`S15 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('critère 1 : CGU cochées ⇒ « Revisa tu correo », versions affichées envoyées', async ({
      page,
    }) => {
      await page.goto('/signup');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const submit = page.locator('main form button[type="submit"]');
      const label = SPEC_TEXT.signupButton[language];
      if (label !== undefined) await expect(submit).toHaveText(label);
      // consentements jamais pré-cochés ; mention BROUILLON des textes provisoires
      await expect(page.locator('#s15-terms')).not.toBeChecked();
      await expect(page.locator('#s15-marketing')).not.toBeChecked();
      const draft = SPEC_TEXT.draftMarker[language];
      expect(draft, 'marqueur BROUILLON attendu dans chaque langue').toBeDefined();
      await expect(page.getByText(draft ?? '')).toBeVisible();
      // champs libellés (WCAG 1.3.1, 3.3.2)
      for (const id of ['s15-first', 's15-last', 's15-email', 's15-password', 's15-terms']) {
        await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
      }
      await expectMobileFriendly(page);
      await expectAccessible(page);

      const email = unique(language);
      await fill(page, email);
      await page.locator('#s15-terms').check();
      await submit.click();
      await expect(page).toHaveURL(/\/signup\/sent$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectMobileFriendly(page);
      const [sent] = await received(email);
      expect(sent).toMatchObject({
        locale: tagOf(language),
        termsAccepted: true,
        marketingOptIn: false,
        acceptedDocuments: [
          { kind: 'TOS_GUEST', version: 2 },
          { kind: 'PRIVACY', version: 1 },
        ],
      });
    });

    test('critère 2 : CGU non cochées ⇒ erreur sur la case, aucune inscription reçue', async ({
      page,
    }) => {
      await page.goto('/signup');
      const email = unique(language);
      await fill(page, email);
      await page.locator('#s15-marketing').check();
      await page.locator('main form button[type="submit"]').click();
      const summary = page.getByRole('alert').first();
      await expect(summary).toBeVisible();
      await expect(summary.locator('a[href="#s15-terms"]')).toHaveCount(1);
      await expect(page.locator('#s15-terms')).toHaveAttribute('aria-invalid', 'true');
      await expect(page).toHaveURL(/\/signup$/);
      // saisie conservée, choix de l'utilisateur respecté, mot de passe jamais réaffiché
      await expect(page.locator('#s15-email')).toHaveValue(email);
      await expect(page.locator('#s15-marketing')).toBeChecked();
      await expect(page.locator('#s15-password')).toHaveValue('');
      expect(await received(email)).toEqual([]);
      await expectMobileFriendly(page);
      await expectAccessible(page);
    });

    test('critère 2 : email déjà inscrit ⇒ écran identique à un succès', async ({ page }) => {
      const email = unique(language);
      const screens: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        await page.goto('/signup');
        await fill(page, email);
        await page.locator('#s15-terms').check();
        await page.locator('main form button[type="submit"]').click();
        await expect(page).toHaveURL(/\/signup\/sent$/);
        screens.push(await page.locator('main').innerText());
      }
      expect(screens[1]).toBe(screens[0]);
    });

    test('document juridique : version et mention BROUILLON, langue de la vue', async ({
      page,
    }) => {
      await page.goto('/legal/TOS_GUEST');
      await expect(page.locator('article')).toHaveAttribute('lang', language);
      const draft = SPEC_TEXT.draftMarker[language];
      expect(draft, 'marqueur BROUILLON attendu dans chaque langue').toBeDefined();
      await expect(page.getByText(draft ?? '').first()).toBeVisible();
      await expectMobileFriendly(page);
      await expectAccessible(page);
    });
  });
}

test.describe('critère 3 : version majeure ⇒ réacceptation avant toute réservation', () => {
  test.use({ locale: tagOf('es') });

  test('reconnexion ⇒ écran de réacceptation ; case obligatoire ; acceptée ⇒ connecté', async ({
    page,
  }, info) => {
    const email = `reaccept-${info.project.name}@example.test`;
    await page.goto('/login');
    await page.locator('#s15-login-email').fill(email);
    await page.locator('#s15-login-password').fill(PASSWORD);
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/terms\/update$/);
    await expect(page.locator('#s15-accept')).not.toBeChecked();
    await expectMobileFriendly(page);
    await expectAccessible(page);

    await page.locator('main form button[type="submit"]').click();
    await expect(page.locator('#s15-accept')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/terms\/update$/);

    await page.locator('#s15-accept').check();
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login\/done$/);

    // reconnexion : plus rien à accepter
    await page.goto('/login');
    await page.locator('#s15-login-email').fill(email);
    await page.locator('#s15-login-password').fill(PASSWORD);
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login\/done$/);
  });

  test('identifiants refusés : erreur annoncée, aucune session', async ({ page, context }) => {
    await page.goto('/login');
    await page.locator('#s15-login-email').fill('nobody@example.test');
    await page.locator('#s15-login-password').fill('Wrong-Horse-9');
    await page.locator('main form button[type="submit"]').click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === '__Host-session')).toBe(false);
  });
});
