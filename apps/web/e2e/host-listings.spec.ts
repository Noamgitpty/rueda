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
 * - A10, CGU de l'hôte (US-126) : version, date et brouillon affichés ; case obligatoire jamais
 *   pré-cochée ; acceptation ⇒ formulaire retiré ; texte servi avec retour vers l'espace de l'hôte.
 * - S03 : zone approximative et mention « dirección exacta al confirmar » ; annonce introuvable ;
 *   API en panne ⇒ état d'erreur.
 * - Accessibilité : axe-core (WCAG 2.2 A / AA) sur `main` sans violation, à chaque état ; mobile
 *   d'abord (aucun défilement horizontal, cibles ≥ 44 px).
 * Attendus : 10b §4.3 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';
const DOWN_ID = '11500000-0000-4000-8000-00000000f503';

/** Séparateurs de la locale, lus dans la configuration partagée (jamais écrits ici). */
const NUMBER = new Map(
  (
    JSON.parse(
      readFileSync(new URL('../../../packages/i18n/config/locales.json', import.meta.url), 'utf8'),
    ) as { locales: { tag: string; number: { group: string; decimal: string } }[] }
  ).locales.map((l) => [l.tag, l.number] as const),
);
const numberOf = (tag: string) => {
  const n = NUMBER.get(tag);
  if (n === undefined) throw new Error(`locale absente : ${tag}`);
  return n;
};

/** Lieu de remise et auto saisis sur le compte affiché ; le formulaire d'annonce apparaît. */
async function placeAndCar(page: Page): Promise<void> {
  await page.locator('#a10-place-label').fill('Casa');
  await page.locator('#a10-place-address').fill('Calle Secreta 123');
  await page.locator('#a10-place-city').fill('Ciudad Ficticia');
  await page.locator('#a10-place-area').fill('Barrio Norte');
  await page.locator('#a10-place-form button[type="submit"]').click();
  await expect(page).toHaveURL(/saved=1/);
  await page.locator('#a10-car-plate').fill(`e2e-${randomBytes(3).toString('hex')}`);
  await page.locator('#a10-car-make').fill('Toyota');
  await page.locator('#a10-car-model').fill('Yaris');
  await page.locator('#a10-car-year').fill('2021');
  await page.locator('#a10-car-form button[type="submit"]').click();
  await expect(page.locator('#a10-new')).toBeVisible();
}

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

      // photo : dépôt fermé (production : antivirus et stockage pas encore branchés), dit
      // d'emblée, sans champ de fichier ni envoi voué à l'échec
      const article = page.locator('main article');
      await expect(article.locator('input[type="file"]')).toHaveCount(0);
      await expect(article.locator('[id$="-photo"][role="status"]')).not.toBeEmpty();

      // soumission sans les photos requises : refus annoncé, l'annonce reste en brouillon
      await article.locator('form[id$="-submit"] button[type="submit"]').click();
      await expect(article.locator('form[id$="-submit"] [role="alert"]')).toBeVisible();
      await expectAccessible(page);

      // l'adresse exacte saisie n'apparaît jamais ailleurs que dans la carte du lieu de l'hôte
      await expect(article).not.toContainText('Calle Secreta');
    });

    test('A10 : CGU de l’hôte (US-126) — version, date, brouillon ; case obligatoire ; acceptation ⇒ acceptées ; texte servi avec retour vers l’espace', async ({
      page,
      context,
    }) => {
      await signIn(context, 'H0st');
      await page.goto('/host');
      const section = page.locator('section[aria-labelledby="a10-terms"]');
      await expect(section.locator('h2')).toBeVisible();
      const link = section.locator('a[href^="/legal/TOS_HOST?"]');
      await expect(link).toHaveAttribute('href', /from=host/);
      // version 1 et date d'entrée en vigueur affichées ; brouillon signalé (OQ-BR-24)
      const line = section.locator('p', { has: page.locator('a[href^="/legal/TOS_HOST?"]') });
      await expect(line).toContainText('1');
      await expect(line).toContainText('2026');
      await expect(section.locator('#a10-terms-form')).toBeVisible();
      await expectAccessible(page);
      await expectMobileFriendly(page);

      // case non cochée : erreur liée à la case, rien n'est envoyé
      await section.locator('#a10-terms-form button[type="submit"]').click();
      await expect(page.locator('#a10-terms-accept')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);

      await page.locator('#a10-terms-accept').check();
      await section.locator('#a10-terms-form button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(page.locator('#a10-terms-form')).toHaveCount(0);
      await expect(page.locator('section[aria-labelledby="a10-terms"]')).toContainText('1');
      await expectAccessible(page);

      // texte servi : version, brouillon ; hors de l'espagnol, mention de traduction ; retour
      await page.goto('/legal/TOS_HOST?from=host');
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('main a[href="/host"]')).toBeVisible();
      await expect(page.locator('main article')).toHaveAttribute('lang', language);
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });

    test('A10 : changer le prix d’une annonce à distance incluse garde le prix du km ; saisie ambiguë refusée ; suppression confirmée libère l’auto', async ({
      page,
      context,
    }) => {
      const n = numberOf(tagOf(language));
      await signIn(context, 'H0st');
      await page.goto('/host');
      await placeAndCar(page);
      await page.locator('#a10-new-price').fill(`40${n.decimal}00`);
      await page.locator('#a10-new-km').fill('200');
      // distance incluse sans prix du km : refus lié AU champ du km extra (jamais un 0 implicite)
      await page.locator('#a10-new button[type="submit"]').click();
      await expect(page.locator('#a10-new-extra')).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#a10-new-extra').fill(`0${n.decimal}25`);
      await page.locator('#a10-new button[type="submit"]').click();
      const article = page.locator('main article');
      await expect(article).toHaveCount(1);
      const extra = article.locator('input[name="extraKm"]');
      await expect(extra).toHaveValue(`0${n.decimal}25`);
      // nouveau prix : le prix du km prérempli est renvoyé tel quel, jamais remis à 0
      await article.locator('input[name="price"]').fill(`50${n.decimal}00`);
      await article.locator('form[aria-label] button[type="submit"]').first().click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(article.locator('input[name="price"]')).toHaveValue(`50${n.decimal}00`);
      await expect(article.locator('input[name="extraKm"]')).toHaveValue(`0${n.decimal}25`);
      await expect(article.locator('input[name="km"]')).toHaveValue('200');
      // « 40.50 » là où le point groupe les milliers : refusé avec un exemple, jamais 4 050
      if (n.group === '.') {
        // page hydratée avant la saisie (sinon React rétablit la valeur préremplie)
        await page.waitForLoadState('networkidle');
        await article.locator('input[name="price"]').fill('40.50');
        await expect(article.locator('input[name="price"]')).toHaveValue('40.50');
        await article.locator('form[aria-label] button[type="submit"]').first().click();
        await expect(article.locator('input[name="price"]')).toHaveAttribute(
          'aria-invalid',
          'true',
        );
      }
      await expectAccessible(page);
      // suppression : sans la case cochée, rien n'est supprimé ; cochée, l'auto redevient libre
      const remove = article.locator('form[id$="-delete"]');
      await remove.locator('button[type="submit"]').click();
      await expect(remove.locator('input[name="confirm"]')).toHaveAttribute('aria-invalid', 'true');
      await expect(article).toHaveCount(1);
      await remove.locator('input[name="confirm"]').check();
      await remove.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expect(page.locator('main article')).toHaveCount(0);
      await expect(page.locator('#a10-new')).toBeVisible();
      await expectMobileFriendly(page);
    });

    test('A10 : second compte (devise sans décimale) — sélecteur, prix entier, photo trop lourde annoncée', async ({
      page,
      context,
    }) => {
      const n = numberOf(tagOf(language));
      await signIn(context, 'H0st');
      await page.goto('/host');
      // deux comptes : le sélecteur nomme les pays ; le compte affiché dit son pays et sa devise
      const accounts = page.locator('nav[aria-labelledby="a10-accounts"] a');
      await expect(accounts).toHaveCount(2);
      // l'écran de chargement (sans contenu) peut coexister un instant : l'écran est le main prêt
      const screen = page.locator('main:not([aria-busy="true"])');
      await expect(screen).toContainText('XTS');
      await accounts.nth(1).click();
      await expect(page).toHaveURL(/org=/);
      await expect(accounts.nth(1)).toHaveAttribute('aria-current', 'page');
      await expect(screen).toContainText('XXX');
      await placeAndCar(page);
      // devise sans décimale : une décimale est refusée, le prix groupé est accepté
      await page.locator('#a10-new-price').fill(`250${n.decimal}5`);
      await page.locator('#a10-new button[type="submit"]').click();
      await expect(page.locator('#a10-new-price')).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#a10-new-price').fill(`250${n.group}000`);
      await page.locator('#a10-new button[type="submit"]').click();
      const article = page.locator('main article');
      await expect(article).toHaveCount(1);
      // prérempli sans décimale ; affiché sans décimale (250 000, jamais 2 500,00)
      await expect(article.locator('input[name="price"]')).toHaveValue('250000');
      const shown = (await article.locator('p').first().textContent()) ?? '';
      expect(shown).toMatch(/250\D?000/);
      expect(shown).not.toMatch(/250\D?000[.,]\d/);
      expect(shown).not.toMatch(/2\D?500[.,]00/);
      // photo : taille maximale annoncée sous le champ ; trop lourde : refus dédié, rien d'envoyé
      const photo = article.locator('form[id$="-photo"]');
      await expect(photo.locator('[id$="-file-hint"]')).not.toBeEmpty();
      await photo.locator('input[type="file"]').setInputFiles({
        name: 'auto.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.alloc(3_000, 0xff),
      });
      await photo.locator('button[type="submit"]').click();
      await expect(photo.locator('[role="alert"]')).toBeVisible();
      // photo légère : déposée (double de l'API : dépôt ouvert sur ce compte)
      await photo.locator('input[type="file"]').setInputFiles({
        name: 'auto.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
      });
      await photo.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/saved=1/);
      await expectAccessible(page);
      await expectMobileFriendly(page);
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
      // l'écran de chargement (sans titre) peut coexister un instant : la fiche est le main titré
      const sheet = page.locator('main', { has: page.locator('h1') });
      await expect(sheet).toContainText('Barrio Norte');
      await expect(sheet).toContainText('Ciudad Ficticia');
      // zone seule avant confirmation : ni adresse exacte, ni plaque, ni point exact
      await expect(sheet).not.toContainText('Calle Secreta');
      await expect(sheet).not.toContainText('8.983712');
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
