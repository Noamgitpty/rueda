/**
 * Parcours du checkout en une page (US-208, partie 208b ; S03 « Reservar » → S05 → hold posé),
 * comme un voyageur réel, à 360 et 390 px, contre le build de production du site et le double de
 * l'API (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement) :
 *
 * - critère 1 : TA01 (16 A.8.1, configuration « PA1 ») : 40,00 × 3 jours = 120,00, taxe 8,40,
 *   total 128,40 ; même total sur la fiche (devis provisoire) et sur S05 (devis figé) ; la somme des
 *   lignes affichées égale le total ;
 * - critère 1 (revues de 208a) : devis expiré ⇒ nouveau devis demandé par le site et AFFICHÉ avant
 *   toute pose, cases à cocher de nouveau : à la pose (409 `QUOTE_EXPIRED`) et à la lecture
 *   (`expired`) ; nouveau prix du double : 42,00 × 3 = 126,00 + 8,82 = 134,82 ;
 * - critère 2 : boîte manuelle ⇒ case `web.s05.manual` exigée ; nom différent du titulaire ⇒ refus
 *   sur le champ du nom, aucun hold ;
 * - critère 3 : bouton inactif (`aria-disabled`, aide liée) tant qu'une case manque ; un clic
 *   n'envoie rien et affiche le récapitulatif des erreurs ; chaque case a le lien vers la VERSION
 *   exacte de son document ; après la pose, les versions acceptées sont relues (hold) ;
 * - sans session : la connexion d'abord ; accessibilité (axe-core, WCAG 2.2 A / AA) à chaque état.
 *
 * Attendus : 19 US-208, 16 A.8.1 (TA01), 10b §4.3 (`oracle.ts`), jamais le code testé. Données du
 * double : titulaire « Lucía Gómez », instants fixes, taxe de 7 % sur le loyer (TA01).
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import {
  expect,
  expectMobileFriendly,
  LANGUAGES,
  submitAndSettle,
  tagOf,
  test,
} from './fixtures.ts';
import type { Language } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';
import { PUBLIC_ID } from './search-data.ts';

/** Fiche à boîte manuelle du double. */
const MANUAL_ID = '11500000-0000-4000-8000-00000000f004';
/** TA01 : total 128,40 ; prix redemandé du double : 134,82 (montants en unités de la devise). */
const TA01_TOTAL = /128[.,]40/;
const TA01_RENT = /120[.,]00/;
const TA01_TAX = /8[.,]40/;
const RENEWED_TOTAL = /134[.,]82/;
/**
 * US-226 : protection BASICA (16 PRC-018 : part du prix journalier net ; grille de test 1/4) :
 * 10,00 × 3 jours = 30,00, non taxée ; total 128,40 + 30,00 = 158,40. Nom du niveau de base dans
 * chaque langue (10b S05 : `BASICA`).
 */
const PROTECTION_AMOUNT = /30[.,]00/;
const WITH_PROTECTION_TOTAL = /158[.,]40/;
const PROTECTION_LABEL: Readonly<Record<Language, string>> = {
  es: 'Protección Básica',
  en: 'Basic protection',
  fr: 'Protection de base',
  pt: 'Proteção Básica',
};
/** Trois jours (TA01) ; le 15 : expiré à la pose ; le 20 : expiré à la lecture (double). */
const slot = (day: number) => ({
  start: `2036-12-${String(day).padStart(2, '0')}T10:00`,
  end: `2036-12-${String(day + 3).padStart(2, '0')}T10:00`,
});

const fiche = (id: string, s: { start: string; end: string }): string =>
  `/listings/${id}?${new URLSearchParams(s).toString()}`;

/** Session du double : `G0st<ll>…` = voyageur vérifié dont le compte est en langue `<ll>`. */
async function signInGuest(context: BrowserContext, language: Language): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `G0st${language}${randomBytes(30).toString('base64url').slice(0, 37)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/** S03 → « Reservar » → S05 (devis figé). */
async function openCheckout(page: Page, id: string, s: { start: string; end: string }) {
  await page.goto(fiche(id, s));
  const price = page.locator('[data-testid="s03-price"]');
  await expect(price).toBeVisible();
  await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}(\?.*)?$/);
  await expect(page.locator('[data-testid="s05-price"]')).toBeVisible();
}

async function fillDriver(page: Page, first: string, last: string): Promise<void> {
  await page.locator('#s05-driver-first').fill(first);
  await page.locator('#s05-driver-last').fill(last);
}

async function acceptAll(page: Page): Promise<void> {
  for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
    await page.locator(`#s05-doc-${kind}`).check();
  }
}

const submit = (page: Page) => page.locator('[data-testid="s05-submit"]');
const HOLD_URL = /\/checkout\/hold\/[0-9a-f-]{36}$/;

for (const language of LANGUAGES) {
  test.describe(`checkout S05 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('critères 1 et 3 : TA01 sur la fiche et sur S05, bouton inactif tant qu’une case manque, liens versionnés, hold posé et versions relues', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      await page.goto(fiche(PUBLIC_ID, slot(10)));
      const s03 = page.locator('[data-testid="s03-price"]');
      await expect(s03).toContainText(TA01_TOTAL);
      const cta = SPEC_TEXT.bookCta[language];
      if (cta !== undefined) {
        await expect(page.locator('[data-testid="s03-book"] button')).toHaveText(cta);
      }
      await expectAccessible(page);
      await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
      await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
      const quoteUrl = page.url();

      // détail du prix : loyer, taxes, total (somme des lignes = total, 16 A.8.1)
      const s05 = page.locator('[data-testid="s05-price"]');
      await expect(s05.locator('details')).toHaveAttribute('open', '');
      await expect(s05.locator('dd').nth(0)).toHaveText(TA01_RENT);
      await expect(s05.locator('dd').nth(1)).toHaveText(TA01_TAX);
      await expect(s05.locator('dd').last()).toHaveText(TA01_TOTAL);
      await expect(page.locator('#s05-manual')).toHaveCount(0);

      // bouton inactif : annoncé, aide liée ; un clic n'envoie rien et montre ce qui manque
      const button = submit(page);
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAttribute('aria-describedby', 's05-hold-hint');
      await expect(button).toContainText(TA01_TOTAL);
      await expectMobileFriendly(page);
      await expectAccessible(page);
      // inactif : Playwright refuse de cliquer un bouton `aria-disabled` ; le clic forcé est celui
      // d'un utilisateur (souris, clavier) que l'écran doit arrêter
      await button.click({ force: true });
      await expect(page).toHaveURL(quoteUrl);
      const summary = page.locator('#s05-errors');
      await expect(summary).toBeVisible();
      await expect(summary.locator('li')).toHaveCount(5);
      await expect(summary).toBeFocused();
      await expectAccessible(page);

      // nom saisi, une case manque encore : toujours inactif
      await fillDriver(page, 'Lucía', 'Gómez');
      await page.locator('#s05-doc-TOS_GUEST').check();
      await page.locator('#s05-doc-CANCELLATION_POLICY').check();
      await expect(button).toHaveAttribute('aria-disabled', 'true');

      // chaque case porte le lien de la version exacte affichée (nouvel onglet)
      const link = page.locator('#s05-doc-GEO_TERMS-hint a');
      await expect(link).toHaveAttribute('target', '_blank');
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^\/legal\/GEO_TERMS\?/);
      const params = new URL(href ?? '', 'http://localhost').searchParams;
      expect(params.get('version')).toBe('1');
      expect(params.get('from')).toBe('checkout');

      await page.locator('#s05-doc-GEO_TERMS').check();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await submitAndSettle(page, button, HOLD_URL);
      const until = SPEC_TEXT.holdUntil[language];
      if (until !== undefined) await expect(page.locator('main')).toContainText(until);
      await expect(page.locator('[data-testid="s05-hold-total"]')).toContainText(TA01_TOTAL);
      await expect(page.locator('[data-testid="s05-hold-documents"] li')).toHaveCount(3);
      await expectMobileFriendly(page);
      await expectAccessible(page);

      // le devis engagé ne repart pas : un second envoi est refusé, aucun second hold
      await page.goto(quoteUrl);
      await fillDriver(page, 'Lucía', 'Gómez');
      await acceptAll(page);
      await submitAndSettle(page, submit(page));
      await expect(page).toHaveURL(quoteUrl);
      await expect(page.locator('main [role="alert"]').first()).toBeVisible();
    });

    test('US-226 : devis avec la protection BASICA ⇒ ligne nommée dans le détail du prix, somme des lignes = total, hold posé', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      await openCheckout(page, PUBLIC_ID, slot(25));
      const s05 = page.locator('[data-testid="s05-price"]');
      // TA01 + protection BASICA du double (1/4 de 40,00 × 3 jours = 30,00, non taxée) = 158,40
      await expect(s05).toContainText(PROTECTION_LABEL[language]);
      await expect(s05.locator('dd').nth(1)).toHaveText(PROTECTION_AMOUNT);
      await expect(s05.locator('dd').last()).toHaveText(WITH_PROTECTION_TOTAL);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expectMobileFriendly(page);
      await expectAccessible(page);
      await fillDriver(page, 'Lucía', 'Gómez');
      await acceptAll(page);
      await submitAndSettle(page, submit(page), HOLD_URL);
      await expect(page.locator('[data-testid="s05-hold-total"]')).toContainText(
        WITH_PROTECTION_TOTAL,
      );
    });

    test('document du checkout : version exacte servie, BROUILLON marqué, retour au devis', async ({
      page,
      context,
    }) => {
      await signInGuest(context, language);
      await openCheckout(page, PUBLIC_ID, slot(10));
      const quoteUrl = new URL(page.url());
      for (const kind of ['CANCELLATION_POLICY', 'GEO_TERMS']) {
        const href = await page.locator(`#s05-doc-${kind}-hint a`).getAttribute('href');
        await page.goto(href ?? '/');
        await expect(page.locator('h1')).toBeVisible();
        const draft = SPEC_TEXT.draftMarker[language];
        if (draft !== undefined) await expect(page.locator('main')).toContainText(draft);
        await expect(page.locator(`main a[href="${quoteUrl.pathname}"]`)).toBeVisible();
        await expectAccessible(page);
        await page.goto(quoteUrl.href);
      }
    });
  });
}

test.describe('checkout S05 · es', () => {
  test.use({ locale: tagOf('es') });

  test('sans session : « Reservar » mène à la connexion, aucun devis', async ({ page }) => {
    await page.goto(fiche(PUBLIC_ID, slot(10)));
    await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('critère 2 : boîte manuelle ⇒ case `web.s05.manual` exigée, puis hold posé', async ({
    page,
    context,
  }) => {
    await signInGuest(context, 'es');
    await openCheckout(page, MANUAL_ID, slot(10));
    const manual = page.locator('#s05-manual');
    await expect(manual).toBeVisible();
    await expect(page.locator('label[for="s05-manual"]')).toContainText(
      SPEC_TEXT.manualBox.es ?? '',
    );
    await expect(manual).not.toBeChecked();
    await fillDriver(page, 'Lucía', 'Gómez');
    await acceptAll(page);
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    await expectAccessible(page);
    await manual.check();
    await submitAndSettle(page, submit(page), HOLD_URL);
  });

  test('critère 2 : nom du conducteur différent du titulaire ⇒ refus sur le champ du nom, aucun hold', async ({
    page,
    context,
  }) => {
    await signInGuest(context, 'es');
    await openCheckout(page, PUBLIC_ID, slot(10));
    const quoteUrl = page.url();
    await fillDriver(page, 'Otra', 'Persona');
    await acceptAll(page);
    await submitAndSettle(page, submit(page));
    await expect(page).toHaveURL(quoteUrl);
    await expect(page.locator('#s05-driver-first')).toHaveAttribute('aria-invalid', 'true');
    // la saisie est conservée ; une forme Unicode décomposée du bon nom passe (NFC, revue de code)
    await expect(page.locator('#s05-driver-first')).toHaveValue('Otra');
    await expectAccessible(page);
    await fillDriver(page, 'Lucía', 'Gómez');
    await acceptAll(page);
    await submitAndSettle(page, submit(page), HOLD_URL);
  });

  test('critère 1 : devis expiré à la pose (409 QUOTE_EXPIRED) ⇒ nouveau devis affiché, cases à recocher, puis hold', async ({
    page,
    context,
  }) => {
    await signInGuest(context, 'es');
    await openCheckout(page, PUBLIC_ID, slot(15));
    const first = page.url();
    await expect(page.locator('[data-testid="s05-price"] dd').last()).toHaveText(TA01_TOTAL);
    await fillDriver(page, 'Lucía', 'Gómez');
    await acceptAll(page);
    await submitAndSettle(page, submit(page), /\/checkout\/[0-9a-f-]{36}\?renewed=1$/);
    // nouveau devis : autre identifiant, prix à jour annoncé, rien n'est coché
    expect(page.url()).not.toContain(new URL(first).pathname);
    await expect(page.locator('main')).toContainText(SPEC_TEXT.priceChanged.es ?? '');
    await expect(page.locator('[data-testid="s05-price"] dd').last()).toHaveText(RENEWED_TOTAL);
    await expect(submit(page)).toContainText(RENEWED_TOTAL);
    await expect(page.locator('#s05-doc-TOS_GUEST')).not.toBeChecked();
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    await expectAccessible(page);
    await fillDriver(page, 'Lucía', 'Gómez');
    await acceptAll(page);
    await submitAndSettle(page, submit(page), HOLD_URL);
    await expect(page.locator('[data-testid="s05-hold-total"]')).toContainText(RENEWED_TOTAL);
  });

  test('critère 1 : devis déjà expiré à la lecture ⇒ aucun formulaire, « nouveau prix » demandé puis affiché', async ({
    page,
    context,
  }) => {
    await signInGuest(context, 'es');
    await openCheckout(page, PUBLIC_ID, slot(20));
    await expect(page.locator('[data-testid="s05-form"]')).toHaveCount(0);
    const renew = page.locator('[data-testid="s05-renew"] button[type="submit"]');
    await expect(renew).toBeVisible();
    await expectAccessible(page);
    await renew.click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}\?renewed=1$/);
    await expect(page.locator('[data-testid="s05-price"] dd').last()).toHaveText(RENEWED_TOTAL);
    await expect(page.locator('[data-testid="s05-form"]')).toBeVisible();
  });
});
