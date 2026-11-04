/**
 * Variante PWA installée (19 US-041, critère 2 ; US-048) : manifeste installable selon Chrome,
 * icônes PNG aux tailles déclarées, application en affichage `standalone`, service worker réel et
 * écran hors ligne servi sans réseau. Projet Playwright « pwa » (service workers autorisés).
 */
import type { Page } from '@playwright/test';
import { openAppWindow } from './app-window.ts';
import { expect, expectMobileFriendly, FROZEN_AT, LANGUAGES, tagOf, test } from './fixtures.ts';

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}
interface Manifest {
  readonly name?: string;
  readonly short_name?: string;
  readonly lang?: string;
  readonly start_url?: string;
  readonly scope?: string;
  readonly display?: string;
  readonly theme_color?: string;
  readonly background_color?: string;
  readonly icons?: readonly ManifestIcon[];
}

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG (octets 16 à 23). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex'), 'signature PNG').toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** L'écran hors ligne est en cache, dans la langue donnée (clé interne du service worker, US-048). */
function offlineCachedIn(page: Page, tag: string): Promise<boolean> {
  return page.evaluate(async (lang) => {
    const hit = await caches.match('/__shell/offline-lang');
    return (await hit?.text()) === lang;
  }, tag);
}

test.describe('manifeste', () => {
  for (const language of LANGUAGES) {
    test(`complet, dans la langue de la vue (${language})`, async ({ request }) => {
      const response = await request.get('/manifest.webmanifest', {
        headers: { 'accept-language': tagOf(language) },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json/);
      const manifest = (await response.json()) as Manifest;
      expect(manifest.name).toBeTruthy();
      expect(manifest.short_name).toBeTruthy();
      expect(manifest.lang).toBe(tagOf(language));
      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
      expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
      expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);

      // Icônes : 192 et 512 px au moins (critères d'installation de Chrome), une « maskable ».
      const icons = manifest.icons ?? [];
      const sizes = icons.map((i) => i.sizes);
      expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
      expect(icons.some((i) => i.purpose?.split(' ').includes('maskable'))).toBe(true);
      for (const icon of icons) {
        const r = await request.get(icon.src);
        expect(r.status(), icon.src).toBe(200);
        expect(r.headers()['content-type']).toBe('image/png');
        const { width, height } = pngSize(await r.body());
        expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
      }
    });
  }
});

test.describe('hors ligne avec le service worker réel', () => {
  for (const language of LANGUAGES) {
    test(`page jamais visitée, réseau coupé → écran hors ligne (${language})`, async ({
      page,
      context,
      baseURL,
    }) => {
      // Le service worker n'hérite pas des en-têtes de la page : la langue passe par le cookie,
      // comme après un choix explicite (POST /locale).
      await context.addCookies([{ name: 'locale', value: tagOf(language), url: baseURL ?? '' }]);
      await page.goto('/');
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true);
      // Écran hors ligne pré-chargé dans la langue de la page (message « shell-locale »).
      await expect.poll(() => offlineCachedIn(page, tagOf(language))).toBe(true);

      await context.setOffline(true);
      await page.goto('/viajes');
      await expect(page.locator('h1#offline-title')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
      await expectMobileFriendly(page);

      // Retour du réseau : la reprise recharge la page demandée, servie par le réseau. Le
      // rechargement automatique (événement « online ») peut précéder la fin de l'émulation dans
      // le service worker : l'utilisateur touche alors « reprise », d'où la boucle.
      await context.setOffline(false);
      const title = page.locator('h1#offline-title');
      await expect(async () => {
        if ((await title.count()) > 0) await page.locator('main a').click({ timeout: 1_000 });
        await expect(title).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 10_000 });
      expect(new URL(page.url()).pathname).toBe('/viajes');
    });
  }
});

/**
 * Application installée : fenêtre d'application de Chrome (`--app`, `display-mode: standalone`)
 * sur un profil persistant (e2e/app-window.ts). Le verdict d'installabilité de Chrome y est lu,
 * puis le parcours hors ligne tourne dans cette fenêtre, à 390 px.
 * Hors périmètre (ADR-074) : l'installation par le système (iOS / Android réels, protocole US-026).
 */
test.describe('application installée (fenêtre d’application)', () => {
  for (const language of ['es', 'en'] as const) {
    test(`standalone, installable, utilisable hors ligne (${language})`, async ({
      playwright,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const win = await openAppWindow(playwright.chromium, origin, { lang: tagOf(language) });
      const offsite: string[] = [];
      try {
        const context = win.page.context();
        context.on('request', (r) => {
          // réseau seulement (http, https, ws) : les extensions internes de Chrome n'en sont pas
          if (/^(https?|wss?):/.test(r.url()) && new URL(r.url()).origin !== origin) {
            offsite.push(r.url());
          }
        });
        await context.addCookies([{ name: 'locale', value: tagOf(language), url: origin }]);
        const app = win.page;
        await app.setViewportSize({ width: 390, height: 844 });
        await app.clock.setFixedTime(FROZEN_AT);
        await app.reload();
        const standalone = () =>
          app.evaluate(() => matchMedia('(display-mode: standalone)').matches);
        expect(await standalone()).toBe(true);
        await expect(app.locator('html')).toHaveAttribute('lang', tagOf(language));
        await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
        await expectMobileFriendly(app);

        const cdp = await context.newCDPSession(app);
        await expect
          .poll(async () => {
            const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
            return installabilityErrors.map((e) => e.errorId);
          })
          .toEqual([]);
        expect((await cdp.send('Page.getAppId')).appId).toBe(`${origin}/`);

        await expect
          .poll(() => app.evaluate(() => navigator.serviceWorker.controller !== null))
          .toBe(true);
        await expect.poll(() => offlineCachedIn(app, tagOf(language))).toBe(true);
        await context.setOffline(true);
        await app.goto(`${origin}/viajes`);
        await expect(app.locator('h1#offline-title')).toBeVisible();
        await expect(app.locator('html')).toHaveAttribute('lang', tagOf(language));
        expect(await standalone()).toBe(true);
        await expectMobileFriendly(app);
      } finally {
        await win.close();
      }
      expect(offsite, 'requêtes hors du serveur testé').toEqual([]);
    });
  }
});
