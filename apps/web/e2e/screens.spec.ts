/**
 * Balayage systématique des écrans du site (US-044, 10b §3.10 UX-46 / UX-49 ; 19 §1.8) : chaque
 * écran livré, dans son état d'arrivée, dans les quatre langues, en clair puis en sombre.
 *
 * - axe-core (WCAG 2.2 A / AA) sur la **page entière**, coquille comprise : 0 violation bloquante,
 *   contraste mesuré dans chaque thème (le thème suit l'appareil : `emulateMedia`).
 * - Mobile d'abord : aucun défilement horizontal, cibles ≥ 44 px (fixtures.ts).
 * - Régression visuelle selon la matrice de `visual.ts` ; la tablette ne rejoue que es et en
 *   (`grep` du projet, playwright.config.ts).
 *
 * Les états profonds (erreurs de formulaire, OTP, calendrier, annonces…) restent dans les parcours
 * de chaque story, qui appellent le même `expectAccessible` (axe.ts) ; ce fichier garantit qu'aucun
 * écran n'échappe à axe ni à la capture. Un nouvel écran s'ajoute à `SCREENS`.
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
import { AREA, CITY, DOWN_CITY, listingWithDates, searchUrl, START } from './search-data.ts';
import { captured, expectScreen } from './visual.ts';

/** Fiche publiée du double de l'API (e2e/stub-api.mjs, données fictives). */
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';

/** Session d'hôte neuf du double (`H0st…`, un compte par parcours). */
async function signInHost(context: BrowserContext): Promise<void> {
  await signIn(context, 'H0st');
}

/** Session du double : `H0st…` hôte neuf ; `B00k…` voyageur d'un trip confirmé (US-204). */
async function signIn(context: BrowserContext, prefix: 'H0st' | 'B00k'): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-session',
      value: `${prefix}${randomBytes(30).toString('base64url').slice(0, 39)}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Fiche à boîte manuelle du double (US-208). */
const MANUAL_ID = '11500000-0000-4000-8000-00000000f004';
/** Fiche publiée du double sans protection promise (US-205 critère 4, e2e/stub-api.mjs). */
const NO_COVER_ID = '20500000-0000-4000-8000-00000000f005';

/** Session du double : `G0st<ll>…` voyageur vérifié dont le compte est en langue `<ll>` (US-208). */
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

/**
 * S03 → « Reservar » → S05 du double (US-208) : trois jours à partir du jour donné de décembre
 * (le 20 : devis déjà expiré à la lecture, voir stub-api.mjs).
 */
async function openCheckout(
  page: Page,
  context: BrowserContext,
  language: Language,
  listingId: string = PUBLIC_ID,
  day = 10,
): Promise<void> {
  await signInGuest(context, language);
  const start = `2036-12-${String(day).padStart(2, '0')}T10:00`;
  const end = `2036-12-${String(day + 3).padStart(2, '0')}T10:00`;
  await page.goto(`/listings/${listingId}?${new URLSearchParams({ start, end }).toString()}`);
  await page.locator('[data-testid="s03-book"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}(\?.*)?$/);
  await expect(page.locator('[data-testid="s05-price"]')).toBeVisible();
}

/** Double de l'API (webhooks FAKE joués par `GET /__e2e/payment/webhook`, US-223b). */
const API = `http://127.0.0.1:${process.env['RUEDA_E2E_API_PORT'] ?? '3199'}`;

/**
 * S05 → hold posé → événements de paiement joués par le double (ordre créé, webhook FAKE signé,
 * échéance) → S06 dans l'état attendu (US-223 partie 223b). Aucune sortie vers le PSP ici : le
 * parcours avec la page hébergée est dans `checkout-payment.spec.ts`.
 */
async function openPayment(
  page: Page,
  context: BrowserContext,
  language: Language,
  events: readonly string[],
  state: string,
  day = 10,
): Promise<void> {
  await placePayment(page, context, language, events, state, day);
}

/** Comme `openPayment`, rend l'identifiant du hold (demande rattachée ensuite à un hôte). */
async function placePayment(
  page: Page,
  context: BrowserContext,
  language: Language,
  events: readonly string[],
  state: string,
  day: number,
): Promise<string> {
  await openCheckout(page, context, language, PUBLIC_ID, day);
  await page.locator('#s05-driver-first').fill('Lucía');
  await page.locator('#s05-driver-last').fill('Gómez');
  for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
    await page.locator(`#s05-doc-${kind}`).check();
  }
  await submitAndSettle(
    page,
    page.locator('[data-testid="s05-submit"]'),
    /\/checkout\/hold\/[0-9a-f-]{36}$/,
  );
  const holdId = /\/checkout\/hold\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)?.[1];
  if (holdId === undefined) throw new Error('hold non posé');
  for (const event of events) {
    const r = await fetch(`${API}/__e2e/payment/webhook?hold=${holdId}&event=${event}`);
    expect(r.status).toBe(200);
  }
  await page.goto(`/checkout/hold/${holdId}/payment`);
  await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute('data-state', state);
  return holdId;
}

/** Demande à l'hôte du double (le 23 décembre ; US-223 partie 223d). */
const REQUEST_DAY = 23;

/**
 * A05 — confirmation de l'acceptation d'une demande (US-223 partie 223d) : demande envoyée par un
 * voyageur, rattachée à un hôte neuf (`GET /__e2e/request/assign`), ouverte puis « Aceptar la
 * solicitud ». Aucune auto saisie : la carte ne porte pas de libellé d'auto (capture stable).
 */
async function openHostRequest(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  const holdId = await placePayment(
    page,
    context,
    language,
    ['PAY', 'SUCCEEDED'],
    'REQUEST_SENT',
    REQUEST_DAY,
  );
  const token = `H0st${randomBytes(30).toString('base64url').slice(0, 39)}`;
  await context.clearCookies();
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
  await page.goto('/host');
  await expect(page.locator('main h1').first()).toBeVisible();
  const r = await fetch(`${API}/__e2e/request/assign?hold=${holdId}&host=${token}`);
  expect(r.status).toBe(200);
  await page.goto('/host/trips');
  await page.locator(`[data-testid="a05-requests"] a[href*="/host/requests/${holdId}"]`).click();
  await page.locator('[data-testid="a05-open-accept"]').click();
  await expect(page.locator('[data-testid="a05-confirm"]')).toBeVisible();
}

/**
 * S05 d'une réservation signalée (US-209 partie 209c) : départ le 19 décembre du double (hold de
 * revue avant le débit), décision de l'ops jouée par `GET /__e2e/review` ; sans décision : S05 « en
 * revue » ; APPROVED : S05 approuvée ; REJECTED : S06 « Reserva no aprobada ».
 */
async function openReview(
  page: Page,
  context: BrowserContext,
  language: Language,
  decision: 'APPROVED' | 'REJECTED' | null,
): Promise<void> {
  await openCheckout(page, context, language, PUBLIC_ID, 19);
  await page.locator('#s05-driver-first').fill('Lucía');
  await page.locator('#s05-driver-last').fill('Gómez');
  for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
    await page.locator(`#s05-doc-${kind}`).check();
  }
  await submitAndSettle(
    page,
    page.locator('[data-testid="s05-submit"]'),
    /\/checkout\/hold\/[0-9a-f-]{36}$/,
  );
  const holdId = /\/checkout\/hold\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)?.[1];
  if (holdId === undefined) throw new Error('hold non posé');
  if (decision === null) {
    await expect(page.locator('[data-testid="s05-review"]')).toHaveAttribute(
      'data-state',
      'PENDING',
    );
    return;
  }
  const r = await fetch(`${API}/__e2e/review?hold=${holdId}&decision=${decision}`);
  expect(r.status).toBe(200);
  await page.goto(`/checkout/hold/${holdId}`);
  if (decision === 'APPROVED') {
    await expect(page.locator('[data-testid="s05-review"]')).toHaveAttribute(
      'data-state',
      'APPROVED',
    );
  } else {
    await expect(page.locator('[data-testid="s06-title"]')).toHaveAttribute('data-state', 'ENDED');
  }
}

/** Compte d'identité du double (`identity-…@example.test`), connecté, puis déclaration d'entrée. */
async function openEntryDeclaration(page: Page, language: Language, project: string) {
  const email = `identity-${language}-screen-${project.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@example.test`;
  await page.goto('/login');
  await page.locator('#s15-login-email').fill(email);
  await page.locator('#s15-login-password').fill('Correct-Horse-9');
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login\/done$/);
  await page.goto('/verify-identity/entry');
  await expect(page.locator('[data-testid="s04-entry-form"]')).toBeVisible();
}

/** Lieu de remise et auto saisis sur le compte d'hôte affiché (A10), pour ouvrir A11 (US-226b). */
async function placeAndCar(page: Page): Promise<void> {
  await page.locator('#a10-place-label').fill('Casa');
  await page.locator('#a10-place-address').fill('Calle Secreta 123');
  await page.locator('#a10-place-city').fill('Ciudad Ficticia');
  await page.locator('#a10-place-form button[type="submit"]').click();
  await expect(page).toHaveURL(/saved=1/);
  await page.locator('#a10-car-plate').fill(`e2e-${randomBytes(3).toString('hex')}`);
  await page.locator('#a10-car-make').fill('Toyota');
  await page.locator('#a10-car-model').fill('Yaris');
  await page.locator('#a10-car-year').fill('2021');
  await page.locator('#a10-car-form button[type="submit"]').click();
  await expect(page.locator('#a10-new')).toBeVisible();
}

/** A10 → A11 du premier véhicule (plan de gains, US-226b) ; `second` : second compte du double. */
async function openEarningsPlan(page: Page, context: BrowserContext, second: boolean) {
  await signInHost(context);
  await page.goto('/host');
  if (second) {
    const accounts = page.locator('nav[aria-labelledby="a10-accounts"] a');
    await accounts.nth(1).click();
    await expect(accounts.nth(1)).toHaveAttribute('aria-current', 'page');
  }
  await placeAndCar(page);
  await page.locator('main a[href*="/earnings-plan?org="]').first().click();
  await expect(page).toHaveURL(/\/earnings-plan\?org=/);
  await expect(page.locator('#a11-current')).toBeVisible();
}

/**
 * S06 confirmé → S09 · contrat du voyageur (US-211 partie 211b) ; `signed` : contrat signé (case
 * cochée, signature du double : heure et sceau fixes).
 */
async function openTripContract(
  page: Page,
  context: BrowserContext,
  language: Language,
  signed: boolean,
): Promise<void> {
  await openPayment(page, context, language, ['PAY', 'SUCCEEDED'], 'CONFIRMED');
  await page.locator('[data-testid="s06-contract"]').click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}\/contract$/);
  await expect(page.locator('[data-testid="contract-summary"]')).toBeVisible();
  if (!signed) return;
  await page.locator('#s09-contract-accept').check();
  await submitAndSettle(
    page,
    page.locator('[data-testid="s09-contract-sign"]'),
    /\/contract\?signed=1$/,
  );
  await expect(page.locator('[data-testid="s09-contract-signed"]')).toBeVisible();
}

/** A10 (lieu et auto) → A02 → A05 → A03 · contrat de l'hôte (US-211 partie 211b), non signé. */
async function openHostContract(page: Page, context: BrowserContext): Promise<void> {
  await signInHost(context);
  await page.goto('/host');
  await page.locator('#a10-place-label').fill('Casa');
  await page.locator('#a10-place-address').fill('Calle Secreta 123');
  await page.locator('#a10-place-city').fill('Ciudad Ficticia');
  await page.locator('#a10-place-form button[type="submit"]').click();
  await expect(page).toHaveURL(/saved=1/);
  // plaque unique (le double refuse une plaque déjà saisie) ; elle n'apparaît pas sur A03
  await page.locator('#a10-car-plate').fill(`e2e-${randomBytes(3).toString('hex')}`);
  await page.locator('#a10-car-make').fill('Toyota');
  await page.locator('#a10-car-model').fill('Yaris');
  await page.locator('#a10-car-year').fill('2021');
  await page.locator('#a10-car-form button[type="submit"]').click();
  await expect(page.locator('#a10-new')).toBeVisible();
  await page.goto('/host');
  await page
    .locator('section[aria-labelledby="a02-upcoming"] li a[href^="/host/trips/"]')
    .first()
    .click();
  await page.locator('[data-testid="a05-contract"]').click();
  await expect(page).toHaveURL(/\/host\/trips\/[0-9a-f-]{36}\/contract\?org=/);
  await expect(page.locator('[data-testid="a03-contract-state"]')).toBeVisible();
}

interface Screen {
  /** Nom stable de la capture (dossier de références). */
  readonly name: string;
  /** Écran de 10b ou story qui le livre (lecture humaine seulement). */
  readonly source: string;
  /** `project` : projet Playwright (compte du double propre à chaque projet, US-209c). */
  readonly open: (
    page: Page,
    context: BrowserContext,
    language: Language,
    project: string,
  ) => Promise<void>;
  /**
   * Capture sous la feuille `e2e/capture-sans-calques.css` (calques composés neutralisés pendant la
   * capture seulement ; axe voit la page réelle) : écran dont le tramage du texte variait d'une
   * exécution à l'autre (docs/qa/REGRESSION_VISUELLE.md).
   */
  readonly stableCompositing?: boolean;
}

const at =
  (path: string) =>
  async (page: Page): Promise<void> => {
    await page.goto(path);
  };

export const SCREENS: readonly Screen[] = [
  { name: 'accueil', source: 'S01, US-048', open: at('/'), stableCompositing: true },
  { name: 'hors-ligne', source: 'US-048', open: at('/offline') },
  { name: 'inscription', source: 'S15, US-102', open: at('/signup') },
  { name: 'inscription-envoyee', source: 'S15, US-102', open: at('/signup/sent') },
  { name: 'connexion', source: 'S15, US-102', open: at('/login') },
  { name: 'connexion-faite', source: 'S15, US-102', open: at('/login/done') },
  { name: 'cgu-reacceptation', source: 'S15, US-102', open: at('/terms/update') },
  { name: 'verification-email', source: 'S15, US-102', open: at('/verify-email') },
  { name: 'document-cgu', source: 'S15, US-102', open: at('/legal/TOS_GUEST') },
  { name: 'document-confidentialite', source: 'S15, US-102', open: at('/legal/PRIVACY') },
  { name: 'telephone', source: 'S15, US-104', open: at('/verify-phone') },
  { name: 'identite', source: 'S04, US-105', open: at('/verify-identity') },
  // fiche S03 (US-204) : galerie dont la deuxième photo est introuvable au bucket du double ;
  // capture une fois la vignette de remplacement posée
  {
    name: 'fiche-publique',
    source: 'S03, US-115, US-204',
    open: async (page) => {
      await page.goto(`/listings/${PUBLIC_ID}`);
      await expect(page.locator('[data-testid="gallery-photo"] [role="img"]')).toHaveCount(1);
    },
  },
  // Recherche (US-201) : liste, aucun résultat, refus du formulaire (fin avant début le même
  // jour), API indisponible ; fiche S03 avec les dates reprises. Le chargement (`loading.tsx`)
  // n'a pas d'état d'arrivée stable ici : le rendu en flux se termine avant la capture.
  { name: 'recherche-resultats', source: 'S02, US-201, US-203', open: at(searchUrl(CITY, AREA)) },
  {
    name: 'recherche-aucun-resultat',
    source: 'S02, US-201',
    open: at(searchUrl(CITY, 'Barrio Sur')),
  },
  {
    name: 'recherche-refus',
    source: 'S02, US-201',
    open: at(searchUrl(CITY, AREA, START, { date: START.date, time: '09:30' })),
  },
  { name: 'recherche-erreur', source: 'S02, US-201', open: at(searchUrl(DOWN_CITY, null)) },
  {
    name: 'fiche-publique-dates',
    source: 'S03, US-201, US-204',
    open: async (page) => {
      await page.goto(listingWithDates());
      await expect(page.locator('[data-testid="gallery-photo"] [role="img"]')).toHaveCount(1);
    },
  },
  // US-204 : départ dans le préavis de l'hôte (07:00 dans le double) ⇒ refus annoncé ; voyageur
  // d'un trip confirmé (session `B00k…` du double) ⇒ lieu de remise exact
  {
    name: 'fiche-preavis',
    source: 'S03, US-204',
    open: async (page) => {
      await page.goto(`/listings/${PUBLIC_ID}?start=2036-12-10T07%3A00&end=2036-12-12T10%3A00`);
      await expect(
        page.locator('section[aria-labelledby="s03-dates"] [role="alert"]'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="gallery-photo"] [role="img"]')).toHaveCount(1);
    },
  },
  {
    name: 'fiche-lieu-exact',
    source: 'S03, US-204',
    open: async (page, context) => {
      await signIn(context, 'B00k');
      await page.goto(`/listings/${PUBLIC_ID}`);
      await expect(page.locator('[data-testid="meeting-point"]')).toBeVisible();
      await expect(page.locator('[data-testid="gallery-photo"] [role="img"]')).toHaveCount(1);
    },
  },
  // US-205 : conditions de la fiche avec dates (annulation de dernière minute : départ à 09:30 dans
  // le double) ; fiche publiée sans protection promise ⇒ aucune couverture, pas de « Reservar »
  {
    name: 'fiche-derniere-minute',
    source: 'S03, US-205',
    open: async (page) => {
      await page.goto(`/listings/${PUBLIC_ID}?start=2036-12-14T09%3A30&end=2036-12-17T10%3A00`);
      await expect(page.locator('[data-testid="s03-protection"]')).toBeVisible();
      await expect(page.locator('[data-testid="gallery-photo"] [role="img"]')).toHaveCount(1);
    },
  },
  {
    name: 'fiche-sans-protection',
    source: 'S03, US-205',
    open: async (page) => {
      await page.goto(`/listings/${NO_COVER_ID}?start=2036-12-14T10%3A00&end=2036-12-17T10%3A00`);
      await expect(page.locator('[data-testid="s03-protection"]')).toBeVisible();
    },
  },
  // Checkout en une page (US-208, partie 208b) : S05 du devis figé (boîte automatique, puis
  // manuelle avec sa case), devis expiré à la lecture, nouveau prix affiché, hold posé ; textes
  // des cases (politique d'annulation, zones de circulation)
  {
    name: 'checkout',
    source: 'S05, US-208',
    open: (page, context, language) => openCheckout(page, context, language),
  },
  {
    name: 'checkout-manuelle',
    source: 'S05, US-208',
    open: (page, context, language) => openCheckout(page, context, language, MANUAL_ID),
  },
  {
    name: 'checkout-expire',
    source: 'S05, US-208',
    open: (page, context, language) => openCheckout(page, context, language, PUBLIC_ID, 20),
  },
  {
    name: 'checkout-prix-actualise',
    source: 'S05, US-208',
    open: async (page, context, language) => {
      await openCheckout(page, context, language, PUBLIC_ID, 20);
      await page.locator('[data-testid="s05-renew"] button[type="submit"]').click();
      await expect(page).toHaveURL(/\?renewed=1$/);
      await expect(page.locator('[data-testid="s05-form"]')).toBeVisible();
    },
  },
  {
    name: 'checkout-hold',
    source: 'S05, US-208',
    open: async (page, context, language) => {
      await openCheckout(page, context, language);
      await page.locator('#s05-driver-first').fill('Lucía');
      await page.locator('#s05-driver-last').fill('Gómez');
      for (const kind of ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS']) {
        await page.locator(`#s05-doc-${kind}`).check();
      }
      await submitAndSettle(
        page,
        page.locator('[data-testid="s05-submit"]'),
        /\/checkout\/hold\/[0-9a-f-]{36}$/,
      );
      await expect(page.locator('[data-testid="s05-hold-documents"]')).toBeVisible();
    },
  },
  // US-223 partie 223b : S06 dans chaque état (10b UX-27, règles 3 et 4) ; S05 du hold porte le
  // bouton « Pagar {amount} » (capture checkout-hold)
  {
    name: 'paiement-verification',
    source: 'S06, US-223',
    open: (page, context, language) => openPayment(page, context, language, ['PAY'], 'VERIFYING'),
  },
  {
    name: 'paiement-interrompu',
    source: 'S06, US-223',
    open: (page, context, language) =>
      openPayment(page, context, language, ['INTERRUPT'], 'INTERRUPTED'),
  },
  {
    name: 'paiement-confirme',
    source: 'S06, US-223',
    open: (page, context, language) =>
      openPayment(page, context, language, ['PAY', 'SUCCEEDED'], 'CONFIRMED'),
  },
  {
    name: 'paiement-refuse',
    source: 'S06, US-223',
    open: (page, context, language) =>
      openPayment(page, context, language, ['PAY', 'FAILED'], 'DECLINED'),
  },
  {
    name: 'paiement-expire',
    source: 'S06, US-223',
    open: (page, context, language) => openPayment(page, context, language, ['EXPIRE'], 'ENDED'),
  },
  {
    name: 'paiement-non-prouve',
    source: 'S06, US-223',
    open: (page, context, language) =>
      openPayment(page, context, language, ['PAY', 'EXPIRE'], 'UNPROVEN'),
  },
  {
    name: 'paiement-rembourse',
    source: 'S06, US-223',
    open: (page, context, language) =>
      openPayment(page, context, language, ['PAY', 'EXPIRE', 'SUCCEEDED'], 'REFUND_DUE'),
  },
  // US-223 partie 223d : mode sur demande (10b S07 « demande envoyée », S06 demande refusée, A05
  // confirmation de l'acceptation)
  {
    name: 'demande-envoyee',
    source: 'S07, US-223',
    open: async (page, context, language) => {
      await openPayment(page, context, language, ['PAY', 'SUCCEEDED'], 'REQUEST_SENT', REQUEST_DAY);
    },
  },
  {
    name: 'demande-refusee',
    source: 'S06, US-223',
    open: async (page, context, language) => {
      await openPayment(
        page,
        context,
        language,
        ['PAY', 'SUCCEEDED', 'DECLINE'],
        'REQUEST_DECLINED',
        REQUEST_DAY,
      );
    },
  },
  {
    name: 'hote-demande-acceptation',
    source: 'A05, US-223',
    open: (page, context, language) => openHostRequest(page, context, language),
  },
  // US-209 partie 209c : réservation signalée (S05 en revue, S05 approuvée, S06 revue refusée) et
  // déclaration d'entrée du voyageur (S04)
  {
    name: 'checkout-revue',
    source: 'S05, US-209',
    open: (page, context, language) => openReview(page, context, language, null),
  },
  {
    name: 'checkout-revue-approuvee',
    source: 'S05, US-209',
    open: (page, context, language) => openReview(page, context, language, 'APPROVED'),
  },
  {
    name: 'paiement-revue-refusee',
    source: 'S06, US-209',
    open: (page, context, language) => openReview(page, context, language, 'REJECTED'),
  },
  {
    name: 'identite-entree',
    source: 'S04, US-209',
    open: (page, _context, language, project) => openEntryDeclaration(page, language, project),
  },
  // US-226 partie 226b : choix de la protection sur S05 (le 25 du double : BASICA présélectionnée,
  // TOTAL grisé sans âge) ; TOTAL validé à 25 ans (nouveau devis, nouveau total) ; contrat de
  // l'assureur fermé après le gel (le 28) ; plan de gains d'A11 (un plan, puis deux plans)
  {
    name: 'checkout-protection',
    source: 'S05, US-226',
    open: async (page, context, language) => {
      await openCheckout(page, context, language, PUBLIC_ID, 25);
      await expect(page.locator('[data-testid="s05-protection"]')).toBeVisible();
    },
  },
  {
    name: 'checkout-protection-total',
    source: 'S05, US-226',
    open: async (page, context, language) => {
      await openCheckout(page, context, language, PUBLIC_ID, 25);
      await page.locator('#s05-driver-age').fill('25');
      await page.locator('#s05-protection-TOTAL').check();
      await submitAndSettle(
        page,
        page.locator('[data-testid="s05-protection-apply"]'),
        /\/checkout\/[0-9a-f-]{36}\?protection=1$/,
      );
      await expect(page.locator('#s05-protection-TOTAL')).toBeChecked();
    },
  },
  {
    name: 'checkout-assureur-ferme',
    source: 'S05, US-226',
    open: async (page, context, language) => {
      await openCheckout(page, context, language, PUBLIC_ID, 28);
      await expect(page.locator('section[aria-labelledby="s05-closed"]')).toBeVisible();
    },
  },
  {
    name: 'document-annulation',
    source: 'S05, US-208',
    open: at('/legal/CANCELLATION_POLICY'),
  },
  { name: 'document-zones', source: 'S05, US-208', open: at('/legal/GEO_TERMS') },
  { name: 'hote-sans-session', source: 'A10, US-115', open: at('/host') },
  {
    name: 'hote-espace',
    source: 'A10, US-115',
    open: async (page, context) => {
      await signInHost(context);
      await page.goto('/host');
    },
  },
  {
    name: 'hote-verification',
    source: 'A07, US-123',
    open: async (page, context) => {
      await signInHost(context);
      await page.goto('/host');
      await page.locator('main a[href^="/host/verification?org="]').click();
      await expect(page).toHaveURL(/\/host\/verification\?org=/);
      await expect(page.locator('#a07-tasks')).toBeVisible();
    },
  },
  {
    name: 'hote-plan-gains',
    source: 'A10, A11, US-226',
    open: (page, context) => openEarningsPlan(page, context, false),
  },
  {
    name: 'hote-plan-gains-choix',
    source: 'A10, A11, US-226',
    open: (page, context) => openEarningsPlan(page, context, true),
  },
  // US-211 partie 211b : contrat de location (S09 à signer, S09 signé, A03 de l'hôte)
  {
    name: 'contrat-a-signer',
    source: 'S09, US-211',
    open: (page, context, language) => openTripContract(page, context, language, false),
  },
  {
    name: 'contrat-signe',
    source: 'S09, US-211',
    open: (page, context, language) => openTripContract(page, context, language, true),
  },
  {
    name: 'hote-contrat',
    source: 'A03, US-211',
    open: (page, context) => openHostContract(page, context),
  },
  { name: 'vitrine-composants', source: 'US-032', open: at('/ui?width=mobile') },
];

for (const screen of SCREENS) {
  for (const language of LANGUAGES) {
    test.describe(`écran ${screen.name} · ${language}`, () => {
      test.use({ locale: tagOf(language) });

      test(`axe, mobile d'abord et capture (${screen.source})`, async ({ page, context }, info) => {
        await screen.open(page, context, language, info.project.name);
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        await expect(page.locator('h1').first()).toBeVisible();
        // Écran ouvert par une navigation côté client (redirection d'une action serveur, lien) :
        // `networkidle` ne vaut que pour le dernier chargement complet du document et ne signale
        // rien ici ; le `<title>` du nouvel écran peut être posé par React dans un commit qui
        // suit de peu celui du contenu (US-208, titre de S05). Signal déterministe : le titre du
        // document est posé (jamais un délai) ; axe vérifie ensuite la règle `document-title`.
        await expect(page).toHaveTitle(/\S/);
        await page.waitForLoadState('networkidle');
        await expectMobileFriendly(page);
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await expectAccessible(page, { include: null });
          if (captured(info, language, scheme))
            await expectScreen(page, screen.name, language, scheme, {
              stableCompositing: screen.stableCompositing === true,
            });
        }
      });
    });
  }
}
