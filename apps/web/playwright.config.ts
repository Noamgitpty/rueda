/**
 * Parcours e2e Playwright du site (US-041, 19 §1.8 ; ADR-074). Lancement : `pnpm --filter
 * @rueda/web test:e2e` après `next build` (le serveur de production est démarré par Playwright).
 *
 * - Viewports (19 US-041) : 360 px et 390 px en téléphone tactile, tablette 768 px ; un projet
 *   « pwa » rejoue l'application installée (affichage `standalone`, service worker, hors ligne).
 * - Navigateur : le Google Chrome installé (`channel: 'chrome'`), comme le job `diagrammes` de la
 *   CI : aucun binaire téléchargé, aucun réseau externe.
 * - Déterminisme : aucune relance (un test instable doit se voir), mouvement réduit, fuseau et
 *   horloge fixés par les fixtures (e2e/fixtures.ts), données de test fictives seulement.
 * - Accessibilité et régression visuelle (US-044, ADR-112) : balayage de chaque écran du site
 *   (`screens.spec.ts`) et de la console interne (`console.spec.ts`, serveur du back-office
 *   démarré ici) ; références des captures dans `e2e/__screenshots__/<plateforme>/<projet>/`,
 *   jamais réécrites en CI (`updateSnapshots: 'none'`).
 */
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env['RUEDA_E2E_PORT'] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
// Console interne (apps/backoffice, construite avant les e2e) : balayage US-044 seulement.
const CONSOLE_PORT = Number(process.env['RUEDA_E2E_CONSOLE_PORT'] ?? 3102);
const CONSOLE_URL = `http://localhost:${CONSOLE_PORT}`;
// Double de l'API des comptes (US-102, e2e/stub-api.mjs) : appelé par le serveur du site seulement.
const API_PORT = Number(process.env['RUEDA_E2E_API_PORT'] ?? 3199);

const SHELL = /shell\.spec\.ts$/;
// Inscription, connexion et consentements (US-102) : téléphones 360 et 390 px.
const SIGNUP = /signup\.spec\.ts$/;
// Espace de l'hôte (A10) et fiche publique (S03), US-115 : téléphones 360 et 390 px.
const HOST = /host-listings\.spec\.ts$/;
/** Étape OTP de S15 (US-104) : mêmes largeurs que l'inscription. */
const PHONE = /phone\.spec\.ts$/;
/** Vérification d'identité S04 (US-105) : mêmes largeurs que l'inscription. */
const IDENTITY = /identity\.spec\.ts$/;
/** Liste de tâches de l'hôte A07 (US-123) : mêmes largeurs que l'inscription. */
const HOST_VERIFICATION = /host-verification\.spec\.ts$/;
/** Balayage axe + captures de chaque écran du site (US-044). */
const SCREENS = /screens\.spec\.ts$/;
/** Balayage des écrans de la console interne (US-044). */
const CONSOLE = /console\.spec\.ts$/;
const phone = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Captures (US-044) : seuil de couleur par pixel bas, aucune tolérance en nombre de pixels :
    // un changement de jeton se voit toujours ; animations et curseur coupés (défaut Playwright).
    toHaveScreenshot: { threshold: 0.1, maxDiffPixels: 0 },
  },
  // Les références ne sont jamais écrites en CI : un écart échoue et l'artefact le présente.
  updateSnapshots: process.env['CI'] !== undefined ? 'none' : 'missing',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  reporter: process.env['CI'] !== undefined ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'off',
  },
  // Les parcours de la coquille tournent sur les trois viewports ; ceux de la PWA sur « pwa » seul.
  projects: [
    {
      name: 'mobile-360',
      testMatch: [SHELL, SIGNUP, PHONE, HOST, IDENTITY, HOST_VERIFICATION, SCREENS],
      use: { ...phone, viewport: { width: 360, height: 780 } },
    },
    {
      name: 'mobile-390',
      testMatch: [SHELL, SIGNUP, PHONE, HOST, IDENTITY, HOST_VERIFICATION, SCREENS],
      use: { ...phone, viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablette',
      testMatch: [SHELL, SCREENS],
      // balayage des écrans en tablette : es et en seulement (19 US-044, notes techniques)
      grepInvert: /écran .* · (fr|pt) /,
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: 'console-360',
      testMatch: CONSOLE,
      use: { ...phone, viewport: { width: 360, height: 780 }, baseURL: CONSOLE_URL },
    },
    {
      name: 'console-390',
      testMatch: CONSOLE,
      use: { ...phone, viewport: { width: 390, height: 844 }, baseURL: CONSOLE_URL },
    },
    {
      name: 'pwa',
      testMatch: /pwa\.spec\.ts$/,
      use: { ...phone, viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      command: 'node e2e/stub-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/legal/documents?locale=es`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { RUEDA_E2E_API_PORT: String(API_PORT) },
    },
    {
      command: `pnpm exec next start --port ${PORT}`,
      url: `${BASE_URL}/manifest.webmanifest`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 60_000,
      // Thème embarqué (aucune API de marque) ; laboratoire PWA iOS coupé ; API des comptes :
      // double local (US-102).
      env: {
        WEB_BRAND_API_URL: '',
        WEB_API_URL: `http://127.0.0.1:${API_PORT}`,
        WEB_LAB_PWA_IOS_ENABLED: 'false',
        // vitrine des composants (US-032) : balayée par US-044 ; jamais en production
        WEB_UI_CATALOG_ENABLED: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
    {
      // Console interne sans `RUEDA_API_URL` : aucun mandataire, `/api/*` intercepté par le test.
      command: `pnpm exec next start --port ${CONSOLE_PORT}`,
      cwd: '../backoffice',
      url: CONSOLE_URL,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 60_000,
      env: { NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
