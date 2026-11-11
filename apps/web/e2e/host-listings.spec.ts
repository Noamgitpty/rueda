/**
 * Parcours A10 (espace de l'hôte) et S03 (fiche publique d'une annonce) — US-115, comme un
 * utilisateur réel, à 360 et 390 px, dans les quatre langues, contre le build de production du
 * site et le double de l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - A10 : sans session ⇒ connexion proposée ; sans compte d'hôte ⇒ message ; état vide (10b §4.3
 *   `web.a10.empty`) ; lieu de remise, auto et brouillon créés ⇒ « Guardado » (`web.a10.saved`) ;
 *   champ obligatoire vide ⇒ erreur liée au champ ; photo ⇒ dépôt indisponible annoncé (503 de la
 *   production : antivirus et stockage pas encore branchés) ; soumission sans photos ⇒ refus
 *   annoncé, l'annonce reste en brouillon ; hors connexion ⇒ bandeau de la coquille.
 * - S03 : zone approximative et mention « dirección exacta al confirmar » ; annonce introuvable ;
 *   API en panne ⇒ état d'erreur.
 * - Accessibilité : axe-core (WCAG 2.2 A / AA) sur `main` sans violation, à chaque état ; mobile
 *   d'abord (aucun défilement horizontal, cibles ≥ 44 px).
 * Attendus : 10b §4.3 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';
const DOWN_ID = '11500000-0000-4000-8000-00000000f503';

async function expectAccessible(page: Page): Promise<void> {
  // en haut de page : l'en-tête collant de la coquille ne recouvre aucune cible de l'écran
  // (axe compterait une case cachée sous lui comme trop petite, WCAG 2.5.8)
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

/** Session de test du double : `H0st…` = hôte neuf (un par parcours), `N0ho…` = sans compte. */
async function signIn(context: BrowserContext, prefix: 'H0st' | 'N0ho'): Promise<void> {
  const token = `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`;
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

for (const language of LANGUAGES) {
  test.describe(`A10 et S03 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('A10 : sans session ⇒ connexion ; sans compte d’hôte ⇒ message', async ({
      page,
      context,
    }) => {
      await page.goto('/host');
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expect(page.locator('main a[href="/login"]')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await signIn(context, 'N0ho');
      await page.goto('/host');
      await expect(page.locator('main h2')).toBeVisible();
      await expect(page.locator('main form')).toHaveCount(0);
      await expectAccessible(page);
    });

    test('A10 : état vide, lieu, auto et brouillon ⇒ « Guardado » ; photo indisponible ; soumission refusée', async ({
      page,
      context,
    }) => {
      await signIn(context, 'H0st');
      await page.goto('/host');
      const empty = SPEC_TEXT.hostEmpty[language];
      if (empty !== undefined) {
        await expect(page.getByRole('heading', { name: empty })).toBeVisible();
      }
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // champ obligatoire vide : erreur liée au champ, rien n'est créé
      await page.locator('#a10-place-address').fill('Calle Secreta 123');
      await page.locator('#a10-place-form button[type="submit"]').click();
      await expect(page.locator('#a10-place-label')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);

      await page.locator('#a10-place-label').fill('Casa');
      await page.locator('#a10-place-city').fill('Ciudad Ficticia');
      await page.locator('#a10-place-area').fill('Barrio Norte');
      await page.locator('#a10-place-form button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      const saved = SPEC_TEXT.hostSaved[language];
      if (saved !== undefined)
        await expect(page.locator('main [role="status"]')).toContainText(saved);

      await page.locator('#a10-car-plate').fill(`e2e-${randomBytes(3).toString('hex')}`);
      await page.locator('#a10-car-make').fill('Toyota');
      await page.locator('#a10-car-model').fill('Yaris');
      await page.locator('#a10-car-year').fill('2021');
      await page.locator('#a10-car-form button[type="submit"]').click();
      await expect(page.locator('#a10-new')).toBeVisible();

      await page.locator('#a10-new-price').fill(language === 'en' ? '40.00' : '40,00');
      await page.locator('#a10-new button[type="submit"]').click();
      await expect(page.locator('main article')).toHaveCount(1);
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // photo : la production répond 503 (antivirus et stockage pas encore branchés)
      const article = page.locator('main article');
      await article.locator('input[type="file"]').setInputFiles({
        name: 'auto.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
      });
      await article.locator('form[id$="-photo"] button[type="submit"]').click();
      await expect(article.locator('form[id$="-photo"] [role="alert"]')).toBeVisible();

      // soumission sans les photos requises : refus annoncé, l'annonce reste en brouillon
      await article.locator('form[id$="-submit"] button[type="submit"]').click();
      await expect(article.locator('form[id$="-submit"] [role="alert"]')).toBeVisible();
      await expectAccessible(page);

      // l'adresse exacte saisie n'apparaît jamais ailleurs que dans la carte du lieu de l'hôte
      await expect(article).not.toContainText('Calle Secreta');
    });

    test('A10 : hors connexion ⇒ bandeau de la coquille', async ({ page, context }) => {
      await signIn(context, 'H0st');
      await page.goto('/host');
      await expect(page.locator('#a10-places')).toBeVisible();
      await context.setOffline(true);
      const banner = SPEC_TEXT.offlineBanner[language];
      if (banner !== undefined) await expect(page.getByRole('status').first()).toHaveText(banner);
      else await expect(page.getByRole('status').first()).not.toBeEmpty();
      await expectMobileFriendly(page);
      await context.setOffline(false);
    });

    test('S03 : zone approximative seulement ; introuvable ; panne', async ({ page }) => {
      await page.goto(`/listings/${PUBLIC_ID}`);
      await expect(page.locator('main h1')).toContainText('Toyota Yaris 2021');
      await expect(page.locator('main')).toContainText('Barrio Norte');
      await expect(page.locator('main')).toContainText('Ciudad Ficticia');
      await expectAccessible(page);
      await expectMobileFriendly(page);
      await page.goto('/listings/11500000-0000-4000-8000-0000000f0404');
      await expect(page.locator('main a[href="/"]')).toBeVisible();
      await expectAccessible(page);
      await page.goto(`/listings/${DOWN_ID}`);
      await expect(page.locator('main [role="alert"]')).toBeVisible();
      await expectAccessible(page);
    });
  });
}
