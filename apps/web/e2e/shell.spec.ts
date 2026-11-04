/**
 * Parcours de la coquille (US-048) comme un utilisateur réel, sur chaque viewport (360 px, 390 px,
 * tablette) : quatre langues, clair et sombre, choix de la langue, perte et retour du réseau.
 * Critères repris de `scripts/shell-check.mjs` : aucun défilement horizontal, cibles ≥ 44 px.
 */
import {
  ALL_TAGS,
  backgroundLuminance,
  expect,
  expectMobileFriendly,
  LANGUAGES,
  measure,
  tagOf,
  test,
} from './fixtures.ts';
import { SPEC_TEXT } from './oracle.ts';

const SCHEMES = ['light', 'dark'] as const;

for (const language of LANGUAGES) {
  for (const scheme of SCHEMES) {
    test.describe(`${language} · ${scheme === 'light' ? 'clair' : 'sombre'}`, () => {
      test.use({ locale: tagOf(language), colorScheme: scheme });

      test('accueil : langue de la vue, titre, mobile d’abord, thème', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        const title = page.getByRole('heading', { level: 1 });
        const expected = SPEC_TEXT.homeTitle[language];
        if (expected !== undefined) await expect(title).toHaveText(expected);
        else await expect(title).not.toHaveText(Object.values(SPEC_TEXT.homeTitle) as string[]);
        await expect(page.getByRole('banner')).toBeVisible();
        await expectMobileFriendly(page);
        const luminance = await backgroundLuminance(page);
        if (scheme === 'light') expect(luminance).toBeGreaterThan(0.5);
        else expect(luminance).toBeLessThan(0.5);
      });

      test('écran hors ligne : titre, reprise, mobile d’abord', async ({ page }) => {
        await page.goto('/offline');
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        await expect(page.locator('h1#offline-title')).toBeVisible();
        await expect(page.locator('main a')).toBeVisible(); // reprise : lien, fonctionne sans JavaScript
        await expectMobileFriendly(page);
      });
    });
  }
}

test.describe('choix de la langue', () => {
  test.use({ locale: tagOf('es') });

  test('menu ouvert : options ≥ 44 px, sans défilement horizontal', async ({ page }) => {
    await page.goto('/');
    await page.locator('header summary').click();
    const options = page.locator('header form button[name="locale"]');
    await expect(options).toHaveCount(ALL_TAGS.length);
    await expect(options.first()).toBeVisible();
    await expectMobileFriendly(page);
  });

  test('es → en : la vue entière change de langue et le choix est mémorisé', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SPEC_TEXT.homeTitle.es ?? '');
    await page.locator('header summary').click();
    await page.locator(`header button[name="locale"][value="${tagOf('en')}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('lang', tagOf('en'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SPEC_TEXT.homeTitle.en ?? '');
    // mémorisé : une nouvelle visite reste en anglais malgré Accept-Language espagnol
    await page.goto('/offline');
    expect((await measure(page)).lang).toBe(tagOf('en'));
  });
});

test.describe('perte et retour du réseau', () => {
  test.use({ locale: tagOf('es') });

  test('bandeau « Sin conexión » annoncé, puis retour en ligne annoncé', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const status = page.getByRole('status');
    await expect(status).toBeEmpty();
    await context.setOffline(true);
    await expect(status).toHaveText(SPEC_TEXT.offlineBanner.es ?? '');
    await expectMobileFriendly(page);
    await context.setOffline(false);
    await expect(status).not.toBeEmpty();
    await expect(status).not.toHaveText(SPEC_TEXT.offlineBanner.es ?? '');
  });
});
