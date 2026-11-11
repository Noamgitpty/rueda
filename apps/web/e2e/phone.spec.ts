/**
 * Parcours S15 — étape OTP (US-104) comme un utilisateur réel, à 360 et 390 px, dans les quatre
 * langues, contre le build de production du site et un double de l'API conforme au contrat
 * (`e2e/stub-api.mjs`, appelé par le SERVEUR du site seulement).
 *
 * - numéro saisi au format local de l'exemple du pays ⇒ « Código enviado a {phone} » (10b §4.3,
 *   `web.s15.codeSent`), numéro masqué ; champ du code collable (`autocomplete=one-time-code`) ;
 * - numéro trop court ⇒ erreur sur le champ, avec les chiffres et l'exemple du pays (10b §4.3,
 *   `common.error.phoneDigits`) ;
 * - code faux ⇒ erreur sur le champ ; code juste ⇒ « Teléfono verificado » ;
 * - 16 VER-013 : 5 codes faux ⇒ blocage (aucun formulaire de code) ;
 * - accessibilité : axe-core (WCAG 2.2 A / AA) sans violation ; mobile d'abord.
 * Attendus : 10b §4.3, 16 VER-013 et la story (e2e/oracle.ts), jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PASSWORD = 'Correct-Horse-9';
/** Code que le double de l'API « envoie » (e2e/stub-api.mjs). */
const OTP_CODE = '246810';

/** Pays et exemples : données de configuration du dépôt, jamais une constante. */
const COUNTRIES = (
  JSON.parse(
    readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { code: string; phone: { example: string; nationalLength: number } }[] }
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

async function login(page: Page, name: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#s15-login-email').fill(`phone-${name}@example.test`);
  await page.locator('#s15-login-password').fill(PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login\/done$/);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

for (const language of LANGUAGES) {
  test.describe(`S15 OTP · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    for (const country of COUNTRIES) {
      test(`${country.code} : numéro local ⇒ code envoyé (masqué) ; code faux puis juste ⇒ vérifié`, async ({
        page,
      }, info) => {
        await login(page, slug(`${language}-${country.code}-${info.project.name}`));
        await page.goto(`/verify-phone?country=${country.code}`);
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('#s15-country')).toHaveValue(country.code);
        await expectAccessible(page);
        await expectMobileFriendly(page);

        // trop court : erreur avec les chiffres et l'exemple du pays
        await page.locator('#s15-phone').fill('12');
        await page.locator('main form button[type="submit"]').click();
        const phoneError = page.locator('#s15-phone-error');
        await expect(phoneError).toContainText(String(country.phone.nationalLength));
        await expect(phoneError).toContainText(country.phone.example);
        const digitsText = SPEC_TEXT.phoneDigits[language];
        if (digitsText !== undefined) await expect(phoneError).toContainText(digitsText);

        await page.locator('#s15-phone').fill(country.phone.example);
        await page.locator('main form button[type="submit"]').click();
        await expect(page).toHaveURL(/\/verify-phone$/);
        const sent = page.getByRole('status').filter({ hasText: '••' });
        await expect(sent).toBeVisible();
        const sentText = SPEC_TEXT.codeSent[language];
        if (sentText !== undefined) await expect(sent).toContainText(sentText);
        // numéro masqué : jamais le numéro entier
        await expect(sent).not.toContainText(country.phone.example.replace(/[^0-9]/g, ''));
        await expect(page.locator('#s15-code')).toHaveAttribute('autocomplete', 'one-time-code');
        await expect(page.locator('#s15-code')).toHaveAttribute('inputmode', 'numeric');
        await expectAccessible(page);
        await expectMobileFriendly(page);

        await page.locator('#s15-code').fill('000000');
        await page.locator('main form button[type="submit"]').click();
        await expect(page.locator('#s15-code-error')).toContainText('4');
        await page.locator('#s15-code').fill(OTP_CODE);
        await page.locator('main form button[type="submit"]').click();
        await expect(page).toHaveURL(/\/verify-phone$/);
        await expect(page.locator('main #s15-code')).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: '••' })).toBeVisible();
        await expectAccessible(page);
      });
    }

    test('16 VER-013 : 5 codes faux ⇒ blocage, aucun formulaire de code', async ({
      page,
    }, info) => {
      const country = COUNTRIES[0];
      if (country === undefined) throw new Error('aucun pays configuré');
      await login(page, slug(`${language}-lock-${info.project.name}`));
      await page.goto(`/verify-phone?country=${country.code}`);
      await page.locator('#s15-phone').fill(country.phone.example);
      await page.locator('main form button[type="submit"]').click();
      await expect(page.locator('#s15-code')).toBeVisible();
      // essais restants annoncés 4, 3, 2, 1, puis blocage d'une heure (60 min)
      for (let i = 1; i <= 4; i++) {
        await page.locator('#s15-code').fill('000000');
        await page.locator('main form button[type="submit"]').click();
        await expect(page.locator('#s15-code-error')).toContainText(String(5 - i));
      }
      await page.locator('#s15-code').fill('000000');
      await page.locator('main form button[type="submit"]').click();
      await expect(page.locator('main form [role="alert"]').first()).toContainText('60');
      await page.goto('/verify-phone');
      await expect(page.locator('main #s15-code')).toHaveCount(0);
      await expect(page.locator('main #s15-phone')).toHaveCount(0);
      await expectMobileFriendly(page);
    });
  });
}
