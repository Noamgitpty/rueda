/**
 * Parcours A07 « Deviens hôte » (US-123) comme un utilisateur réel, à 360 et 390 px, dans les
 * quatre langues, contre le build de production du site et le double de l'API
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - sans session ⇒ connexion proposée ;
 * - liste de tâches (10b UX-40) : chaque tâche a un statut ; numéro fiscal vide ⇒ erreur liée au
 *   champ ; numéro saisi ⇒ type enregistré affiché, jamais le numéro ; envoi ⇒ dossier incomplet
 *   tant que les CGU de l'hôte manquent ;
 * - dossier approuvé, pays pas encore ouvert (interrupteurs fermés) ⇒ `web.a07.waitingCountry`
 *   dit honnêtement, sans date promise (10b §4.3, UX-40) ; plus aucun formulaire ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation à chaque état ; mobile d'abord.
 * Attendus : 10b §4.3 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;

async function expectAccessible(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
    ).axe;
    const r = (await axe.run(
      { include: ['main'] },
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    )) as { violations: { id: string; nodes: { target: string[] }[] }[] };
    return r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
  expect(violations, 'violations axe-core').toEqual([]);
}

/** Session d'hôte neuf du double (`H0st…`, deux comptes d'hôte) ; rend le jeton. */
async function signIn(context: BrowserContext): Promise<string> {
  const token = `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;
  await context.addCookies([
    {
      name: '__Host-session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  return token;
}

for (const language of LANGUAGES) {
  test.describe(`A07 deviens hôte · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('sans session ⇒ connexion proposée', async ({ page }) => {
      await page.goto('/host/verification');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('tâches, numéro fiscal, envoi ; dossier approuvé et pays pas encore ouvert', async ({
      page,
      context,
    }) => {
      const token = await signIn(context);
      await page.goto('/host');
      await page.locator('main a[href^="/host/verification?org="]').click();
      await expect(page).toHaveURL(/\/host\/verification\?org=/);
      // l'écran de chargement de l'espace de l'hôte peut précéder la page (rendu en flux)
      await expect(page.locator('#a07-tasks')).toBeVisible();
      await expect(page.locator('main h1')).toHaveCount(1);
      await expect(page.locator('#a07-tax-form')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // numéro vide : erreur liée au champ, rien n'est enregistré
      await page.locator('#a07-tax-form button[type="submit"]').click();
      await expect(page.locator('#a07-tax-number')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);

      // numéro saisi : type enregistré affiché, jamais le numéro lui-même
      const number = `${String(1_000_000 + (randomBytes(2).readUInt16BE() % 8_999_999))}-7`;
      await page.locator('#a07-tax-number').fill(number);
      await page.locator('#a07-tax-form button[type="submit"]').click();
      await expect(page.getByText(/TAX_NUMBER/).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText(number);

      // envoi : CGU de l'hôte non acceptées ⇒ dossier incomplet, le formulaire reste
      await page.locator('#a07-submit-form button[type="submit"]').click();
      await expect(page.locator('main [role="status"]')).toBeVisible();
      await expect(page.locator('#a07-submit-form')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // l'ops approuve ; interrupteurs du pays fermés : en attente, dit honnêtement
      const approve = await fetch(
        `${API}/__e2e/host-verification/approve?${new URLSearchParams({ token }).toString()}`,
      );
      expect(approve.status).toBe(200);
      await page.reload();
      const waiting = SPEC_TEXT.hostWaitingCountry[language];
      await expect(page.locator('#a07-tasks')).toBeVisible();
      if (waiting !== undefined) await expect(page.getByText(waiting)).toBeVisible();
      await expect(page.locator('main form')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
