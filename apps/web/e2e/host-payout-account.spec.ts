/**
 * Compte de versement de l'hôte (US-707 ; 16 PYO-001 ; 10b A07, UX-40, UX-43) comme un
 * utilisateur réel, mobile d'abord, dans les quatre langues, contre le build de production du
 * site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 * Aucune capture visuelle (régression visuelle inchangée).
 *
 * - sans session ⇒ connexion proposée ;
 * - numéro fiscal absent ⇒ aucun formulaire, lien vers le profil fiscal d'A07 (le titulaire est
 *   comparé à ce numéro) ;
 * - champ vide ⇒ erreur liée au champ ; titulaire discordant (règle du double : « OTRO ») ⇒ refus
 *   lié au champ, rien n'est enregistré ;
 * - compte enregistré ⇒ affiché masqué (« •••• » et 4 derniers chiffres), jamais le numéro complet
 *   ni le numéro fiscal ;
 * - changement de compte ⇒ versements retenus, bannière avec la date de fin de la retenue (48 h) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation à chaque état ; mobile d'abord.
 * Attendus : la story (19 US-707) et 16 PYO-001, jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { expectAccessible } from './axe.ts';

/** Session d'hôte neuf du double (`H0st…`, deux comptes d'hôte). */
async function signIn(context: BrowserContext): Promise<void> {
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
}

/** Numéro de compte de 10 chiffres, différent à chaque appel. */
const accountNumber = (): string =>
  String(1_000_000_000 + (randomBytes(4).readUInt32BE() % 8_999_999_999));

async function fillAccount(
  page: Page,
  number: string,
  surnames: string,
  institution?: string,
): Promise<void> {
  if (institution !== undefined) await page.locator('#a07p-institution').fill(institution);
  await page.locator('#a07p-number').fill(number);
  await page.locator('#a07p-given').fill('Ana María');
  await page.locator('#a07p-surnames').fill(surnames);
  await page.locator('#a07p-tax').fill('1234567-8');
  await page.locator('#a07p-form button[type="submit"]').click();
}

for (const language of LANGUAGES) {
  test.describe(`compte de versement · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('sans session ⇒ connexion proposée', async ({ page }) => {
      await page.goto('/host/payout-account');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('numéro fiscal d’abord, refus du titulaire discordant, compte masqué, changement retenu', async ({
      page,
      context,
    }) => {
      await signIn(context);
      await page.goto('/host');
      await page.locator('main a[href^="/host/verification?org="]').click();
      await expect(page).toHaveURL(/\/host\/verification\?org=/);
      // écran ouvert par son adresse (aucun lien ajouté à A07 : captures de référence inchangées)
      const org = new URL(page.url()).searchParams.get('org') ?? '';
      const openPayout = () =>
        page.goto(`/host/payout-account?${new URLSearchParams({ org }).toString()}`);
      await openPayout();
      await expect(page).toHaveURL(/\/host\/payout-account\?org=/);
      await expect(page.locator('main h1')).toHaveCount(1);

      // aucun numéro fiscal : pas de formulaire, lien vers le profil fiscal d'A07
      await expect(page.locator('#a07p-tax-first')).toBeVisible();
      await expect(page.locator('#a07p-form')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await page.locator('main a[href*="/host/verification?org="][href$="#a07-tax-form"]').click();
      await page.locator('#a07-tax-number').fill('1234567-8');
      await page.locator('#a07-tax-form button[type="submit"]').click();
      await expect(page.locator('#a07-tasks')).toBeVisible();
      await openPayout();

      // formulaire : un champ vide ⇒ erreur liée au champ
      await expect(page.locator('#a07p-form')).toBeVisible();
      await page.locator('#a07p-form button[type="submit"]').click();
      await expect(page.locator('#a07p-number')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);

      // titulaire qui n'est pas l'hôte ⇒ refus lié au champ, rien n'est enregistré
      const refused = accountNumber();
      await fillAccount(page, refused, 'Otro Titular', 'B01');
      await expect(page.locator('#a07p-surnames')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#a07p-masked')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(refused);
      await expectAccessible(page);

      // compte à son nom ⇒ affiché masqué, jamais le numéro complet ni le numéro fiscal
      const first = accountNumber();
      await fillAccount(page, first, 'Pérez Gómez', 'B01');
      await expect(page.locator('#a07p-masked')).toContainText(`•••• ${first.slice(-4)}`);
      await expect(page.locator('body')).not.toContainText(first);
      await expect(page.locator('body')).not.toContainText('1234567-8');
      // premier compte : aucune retenue
      await expect(page.locator('main [role="status"]')).toHaveCount(0);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // changement vers un portefeuille ⇒ versements retenus jusqu'à une date dite
      await page.locator('main nav a[href*="kind=WALLET"]').click();
      await expect(page.locator('select#a07p-institution')).toBeVisible();
      const second = accountNumber();
      await fillAccount(page, second, 'Pérez Gómez');
      await expect(page.locator('#a07p-masked')).toContainText(`•••• ${second.slice(-4)}`);
      await expect(page.locator('body')).not.toContainText(second);
      const year = String(new Date(Date.now() + 48 * 3_600_000).getUTCFullYear());
      await expect(page.locator('main [role="status"]').first()).toContainText(year);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}
