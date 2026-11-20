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
/** Compte de versement de l'hôte (US-707) : e2e minimal, 360 px seulement. */
const HOST_PAYOUT = /host-payout-account\.spec\.ts$/;
/** Calendrier d'un véhicule de l'hôte A06 (US-119) : mêmes largeurs que l'inscription. */
const HOST_CALENDAR = /host-calendar\.spec\.ts$/;
/** Accueil A02 et réservations A05 de l'hôte (US-219) : mêmes largeurs que l'inscription. */
const HOST_TRIPS = /host-trips\.spec\.ts$/;
/** Recherche publique S01 → résultats → fiche S03 (US-201) : téléphones 360 et 390 px. */
const SEARCH = /search\.spec\.ts$/;
/** Fiche du véhicule S03 : galerie, dates, lieu exact (US-204) : téléphones 360 et 390 px. */
const LISTING = /listing\.spec\.ts$/;
/** Checkout en une page S03 → S05 → hold posé (US-208, partie 208b) : téléphones 360 et 390 px. */
const CHECKOUT = /checkout\.spec\.ts$/;
/** Paiement du hold S05 → PSP → S06 et refus (US-223 partie 223b) : téléphones 360 et 390 px. */
const PAYMENT = /checkout-payment\.spec\.ts$/;
/** Revue d'une réservation signalée, écrans du voyageur (US-209 partie 209c). */
const REVIEW = /checkout-review\.spec\.ts$/;
/** Plan de gains d'un véhicule, A10 → A11 (US-226 partie 226b) : téléphones 360 et 390 px. */
const HOST_EARNINGS = /host-earnings-plan\.spec\.ts$/;
/**
 * Mode sur demande, S05 → S07 « demande envoyée » → A05 → S06 (US-223 partie 223d) : 360 px
 * seulement (durée du job e2e ; le balayage des écrans couvre 390 px et la tablette).
 */
const REQUEST_MODE = /request-mode\.spec\.ts$/;
/** Contrat de location : S09 · contrat du voyageur, A03 · contrat de l'hôte (US-211 partie 211b) : 360 px. */
const CONTRACT = /trip-contract\.spec\.ts$/;
/** Photos d'état du véhicule : S09 · check-in du voyageur (US-303) : 360 px. */
const INSPECTION = /trip-inspection\.spec\.ts$/;
/** Remise du véhicule entre particuliers : A03 de l'hôte, S09 · check-in du voyageur (US-315) : 360 px. */
const HANDOVER = /trip-handover\.spec\.ts$/;
// US-307 : no-show de l'hôte et du voyageur (360 px ; l'écran de l'hôte passe à 390 px par SCREENS)
const NO_SHOW = /trip-no-show\.spec\.ts$/;
/** Remboursement d'un trip : S10 · remboursement du voyageur, A05 de l'hôte (US-224 partie 224d) : 360 px. */
const REFUND = /trip-refund\.spec\.ts$/;
/** « Mis viajes » (S08) et détail du trip (S09) du voyageur (US-214) : 360 px, une langue. */
const GUEST_TRIPS = /guest-trips\.spec\.ts$/;
/** Messages du trip S16 du voyageur (US-525) : 360 px, une langue. */
const TRIP_MESSAGES = /trip-messages\.spec\.ts$/;
/**
 * Constancia d'arrendamiento et centre juridique (US-212) : 360 px et espagnol seulement (durée
 * du job e2e, proche de sa limite ; les quatre langues sont prouvées par les catalogues et l'API).
 */
const CONSTANCIA = /trip-constancia\.spec\.ts$/;
/**
 * Reçu du voyageur (S09 · reçu) et gains de l'hôte (A08), US-217 partie 217b : 360 px et espagnol
 * seulement (durée du job e2e ; les deux écrans passent à 390 px et en tablette par SCREENS).
 */
const RECEIPT = /trip-receipt\.spec\.ts$/;
/**
 * Caution annoncée sur la fiche S03 (US-701 partie 701c, T70 c) : 360 px seulement (durée du job
 * e2e ; la fiche passe à 390 px par LISTING et SCREENS).
 */
const DEPOSIT_NOTICE = /deposit-notice\.spec\.ts$/;
/**
 * Aide et urgence (S17, US-310) : lien d'en-tête, numéros du pays, demande d'aide du trip depuis
 * S09 ; 360 px et espagnol seulement (durée du job e2e ; les quatre langues sont prouvées par les
 * catalogues et les tests de rendu).
 */
const HELP = /help\.spec\.ts$/;
/**
 * Parcours doré « réservation » S01 → S06 (US-221) : 360 px et espagnol seulement, un test (durée
 * du job e2e ; chaque écran est éprouvé en quatre langues par sa spec propre).
 */
const GOLDEN = /parcours-dore\.spec\.ts$/;
/** Balayage axe + captures de chaque écran du site (US-044). */
const SCREENS = /screens\.spec\.ts$/;
/** Balayage des écrans de la console interne (US-044). */
const CONSOLE = /console\.spec\.ts$/;
/** Arguments de Chrome communs à tous les projets (voir `use.launchOptions`). */
const CHROME_ARGS = ['--disable-lcd-text'] as const;
/**
 * Téléphones : écran de Chrome à l'échelle 2, égale au `deviceScaleFactor` émulé. Sous Linux,
 * le réglage de tramage d'une police (`gfx::GetFontRenderParams`) dépend de l'échelle de la
 * requête : 1 ⇒ ajustement des glyphes à la grille de pixels de fontconfig (hinting « slight »),
 * plus de 1 ⇒ aucun ajustement. Sans ce drapeau, l'écran réel vaut 1 et l'émulation 2 : la toute première police de la page (le texte courant,
 * 16 px normal) est parfois demandée avant que l'échelle émulée n'arrive au moteur de rendu, et
 * garde alors l'ajustement pour toute la page (décalage vertical d'environ un demi-pixel, encre
 * ±5 %, gras et 14 px intacts) ; une capture de téléphone échouait au hasard sous charge
 * (docs/qa/REGRESSION_VISUELLE.md, « Ajustement des glyphes selon l'échelle de l'écran »).
 * L'écart est revenu malgré ce drapeau (run 44071319010, `accueil · fr`, même signature) : les
 * téléphones demandent aussi `--font-render-hinting=none`, qui fixe l'ajustement à « aucun »
 * quelle que soit l'échelle de la requête, soit l'état que l'échelle 2 donne déjà (références
 * inchangées) ; la branche « ajustée » de la course disparaît. La tablette (échelle 1, ajustement
 * « slight » dans ses références) n'en reçoit pas.
 * Ces deux drapeaux ne ferment pas la course (runs 44138991977, 44171328704) : Blink crée une
 * police avec l'échelle globale du processus de rendu, à 1 jusqu'à la première mise en page
 * (`FontCache::DeviceScaleFactor()`). La capture la neutralise par `e2e/capture-polices.css`
 * (`text-rendering: geometricPrecision`, e2e/visual.ts) ; les drapeaux restent, sans effet sur les
 * références.
 */
const phone = {
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  launchOptions: {
    args: [...CHROME_ARGS, '--force-device-scale-factor=2', '--font-render-hinting=none'],
  },
};

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
    // Texte toujours tramé en niveaux de gris : Chrome active ou non l'anticrénelage sous-pixel
    // (LCD) selon les calques composés de la page, et ce tramage varie d'une machine de la CI à
    // l'autre ; sans lui, une capture ne dépend plus ni de la machine ni des calques
    // (docs/qa/REGRESSION_VISUELLE.md, « Texte sans anticrénelage sous-pixel »). Le site servi ne
    // change pas : seul le navigateur des e2e est réglé.
    launchOptions: { args: [...CHROME_ARGS] },
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'off',
  },
  // Les parcours de la coquille tournent sur les trois viewports ; ceux de la PWA sur « pwa » seul.
  projects: [
    {
      name: 'mobile-360',
      testMatch: [
        SHELL,
        SIGNUP,
        PHONE,
        HOST,
        IDENTITY,
        HOST_VERIFICATION,
        HOST_PAYOUT,
        HOST_CALENDAR,
        HOST_TRIPS,
        SEARCH,
        LISTING,
        CHECKOUT,
        PAYMENT,
        REVIEW,
        HOST_EARNINGS,
        REQUEST_MODE,
        CONTRACT,
        INSPECTION,
        HANDOVER,
        NO_SHOW,
        REFUND,
        GUEST_TRIPS,
        TRIP_MESSAGES,
        CONSTANCIA,
        RECEIPT,
        DEPOSIT_NOTICE,
        HELP,
        GOLDEN,
        SCREENS,
      ],
      use: { ...phone, viewport: { width: 360, height: 780 } },
    },
    {
      name: 'mobile-390',
      testMatch: [
        SHELL,
        SIGNUP,
        PHONE,
        HOST,
        IDENTITY,
        HOST_VERIFICATION,
        HOST_CALENDAR,
        HOST_TRIPS,
        SEARCH,
        LISTING,
        CHECKOUT,
        PAYMENT,
        REVIEW,
        HOST_EARNINGS,
        // CONTRACT : 360 px seulement ; ses trois écrans passent à 390 px par SCREENS (axe, mobile
        // d'abord) : job e2e proche de sa limite de 20 min (suite à la passation d'US-211b) ; REFUND
        // (US-224d) : 360 px seulement, ses deux écrans passent à 390 px par SCREENS
        // GUEST_TRIPS (US-214) : 360 px seulement, ses deux écrans passent à 390 px par SCREENS
        // RECEIPT (US-217b) : 360 px seulement, ses deux écrans passent à 390 px par SCREENS
        // INSPECTION (US-303) : 360 px seulement, son écran passe à 390 px par SCREENS
        // HANDOVER (US-315) : 360 px seulement, son écran A03 passe à 390 px par SCREENS
        // TRIP_MESSAGES (US-525) : 360 px seulement, son écran passe à 390 px par SCREENS
        // NO_SHOW (US-307) : 360 px seulement, l'écran de l'hôte passe à 390 px par SCREENS
        SCREENS,
      ],
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
        // bucket public des photos d'annonce : servi par le double (US-204)
        WEB_MEDIA_URL: `http://127.0.0.1:${API_PORT}/media`,
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
