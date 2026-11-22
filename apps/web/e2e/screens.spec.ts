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
async function openHostContract(
  page: Page,
  context: BrowserContext,
  plate = `e2e-${randomBytes(3).toString('hex')}`,
): Promise<void> {
  await signInHost(context);
  await page.goto('/host');
  await page.locator('#a10-place-label').fill('Casa');
  await page.locator('#a10-place-address').fill('Calle Secreta 123');
  await page.locator('#a10-place-city').fill('Ciudad Ficticia');
  await page.locator('#a10-place-form button[type="submit"]').click();
  await expect(page).toHaveURL(/saved=1/);
  // plaque unique (le double refuse une plaque déjà saisie) ; elle n'apparaît pas sur A03
  await page.locator('#a10-car-plate').fill(plate);
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

/**
 * S06 confirmé (trip né) → S08 « Mis viajes » ; avec `detail`, S09 · détail du trip (US-214). Faits
 * du double fixes (référence, dates, total) : captures stables.
 */
async function openGuestTrips(
  page: Page,
  context: BrowserContext,
  language: Language,
  detail: boolean,
): Promise<void> {
  await openPayment(page, context, language, ['PAY', 'SUCCEEDED'], 'CONFIRMED');
  const href = await page.locator('[data-testid="s06-contract"]').getAttribute('href');
  const tripId = /\/trips\/([0-9a-f-]{36})\/contract$/.exec(href ?? '')?.[1];
  if (tripId === undefined) throw new Error('trip absent');
  await page.goto('/trips');
  await expect(page.locator('[data-testid="s08-upcoming"]')).toBeVisible();
  if (!detail) return;
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator('[data-testid="s09-documents"]')).toBeVisible();
}

/**
 * S06 confirmé → S09 → S09 · reçu du voyageur (US-217 partie 217b) : reçu d'un trip payé.
 */
async function openGuestReceipt(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await openGuestTrips(page, context, language, true);
  await page.locator('[data-testid="s09-receipt"]').click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}\/receipt$/);
  await expect(page.locator('[data-testid="s09r-total"]')).toBeVisible();
}

/** Trip fixe du double dont le fil S16 est ouvert (US-525, e2e/stub-api.mjs). */
const MESSAGES_TRIP = '00000000-0000-4000-8000-000000525e2e';

/** S16 — messages du trip du voyageur (US-525) : fil du double, un message de l'hôte. */
async function openTripMessages(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  await page.goto(`/trips/${MESSAGES_TRIP}/messages`);
  await expect(page.locator('[data-testid="s16-thread"]')).toBeVisible();
}

/** S13 — avis du voyageur sur un trip rendu du double (US-317) : formulaire, double aveugle. */
const REVIEW_TRIP = '00000000-0000-4000-8000-000000317e2e';
async function openTripReview(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  await page.goto(`/trips/${REVIEW_TRIP}/review`);
  await expect(page.locator('[data-testid="review-form"]')).toBeVisible();
}

/** Avis reçus par le voyageur (US-317 ; droit d'accès, Ley 81). */
async function openReceivedReviews(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  await page.goto('/reviews');
  await expect(page.locator('[data-testid="reviews-as-guest-list"]')).toBeVisible();
}

/**
 * A10 → A08 de l'hôte (US-217 partie 217b) : mois du double qui porte des gains (acquis, à
 * liquider, pénalité en ligne séparée), compte au marché à deux décimales ; US-314 : versements
 * (premier versement payé avec compensation, lot retenu pour réclamation et versements fermés).
 */
async function openHostEarnings(page: Page, context: BrowserContext): Promise<void> {
  await signInHost(context);
  await page.goto('/host');
  await page.locator('[data-testid="a10-earnings"]').click();
  await expect(page).toHaveURL(/\/host\/earnings\?org=/);
  const org = new URL(page.url()).searchParams.get('org') ?? '';
  await page.goto(`/host/earnings?org=${org}&month=2036-12`);
  await expect(page.locator('[data-testid="a08-earned"]')).toBeVisible();
  // US-314 : section « Versements » (lot payé, lot retenu et ses motifs)
  await expect(page.locator('[data-testid="a08-hold-CLAIM"]')).toBeVisible();
}

/**
 * S06 confirmé → contrat (trip né) → annulation réglée par le double → S10 · remboursement émis du
 * voyageur (US-224 partie 224d).
 */
async function openTripRefund(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await openPayment(page, context, language, ['PAY', 'SUCCEEDED'], 'CONFIRMED');
  await page.locator('[data-testid="s06-contract"]').click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}\/contract$/);
  const tripId = /\/trips\/([0-9a-f-]{36})\/contract$/.exec(new URL(page.url()).pathname)?.[1];
  if (tripId === undefined) throw new Error('trip absent');
  expect((await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=issued`)).status).toBe(200);
  await page.goto(`/trips/${tripId}/refund`);
  await expect(page.locator('[data-testid="refund-issued"]')).toBeVisible();
}

/**
 * A10 → A02 → A05 de l'hôte avec le remboursement du voyageur planifié (US-224 partie 224d). La
 * plaque paraît sur A05 : FIXE par projet et par langue (unique dans le double, capture stable).
 */
async function openHostRefund(
  page: Page,
  context: BrowserContext,
  language: Language,
  project: string,
): Promise<void> {
  const code = project
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toUpperCase();
  await openHostContract(page, context, `RF${code}${language.toUpperCase()}`);
  const tripId = /\/host\/trips\/([0-9a-f-]{36})\/contract/.exec(page.url())?.[1] ?? '';
  expect((await fetch(`${API}/__e2e/refund/cancel?trip=${tripId}&state=preparing`)).status).toBe(
    200,
  );
  await page.goto(page.url().replace('/contract?', '?'));
  await expect(page.locator('[data-testid="a05-refunds"]')).toBeVisible();
}

/** S09 · check-in : photos de départ du voyageur (US-303), série vide, trip créé par le double. */
async function openInspection(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(`${API}/__e2e/inspection/new?guest=${token}&host=`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  await page.goto(`/trips/${tripId}/inspection/checkin`);
  await expect(page.locator('[data-testid="inspection-progress"]')).toBeVisible();
}

/** A03 : remise par l'hôte (US-315), étape du contrôle du permis, trip créé par le double. */
async function openHandover(page: Page, context: BrowserContext): Promise<void> {
  await signInHost(context);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(`${API}/__e2e/handover/new?guest=&host=${token}&status=CHECKIN_OPEN`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  await page.goto(`/host/trips/${tripId}/handover/checkin`);
  await expect(page.locator('[data-testid="handover-identity"]')).toBeVisible();
}

/**
 * S09 · check-in du voyageur (US-315), validation du départ sous le rappel du consentement MIT
 * (US-703, 16 PAY-037) : permis contrôlé par l'hôte, trip créé par le double.
 */
async function openGuestHandover(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(
    `${API}/__e2e/handover/new?guest=${token}&host=&status=CHECKIN_OPEN&identity=OK`,
  );
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  await page.goto(`/trips/${tripId}/handover/checkin`);
  await expect(page.locator('[data-testid="handover-mit-reminder"]')).toBeVisible();
}

/**
 * US-312 : retour du véhicule (A04 de l'hôte, S09 · check-out du voyageur), trip en cours créé par
 * le double, photos des deux parties déjà déposées : relevés et validation de sa part.
 */
async function openReturn(
  page: Page,
  context: BrowserContext,
  role: 'HOST' | 'GUEST',
  language: Language,
): Promise<void> {
  if (role === 'HOST') await signInHost(context);
  else await signInGuest(context, language);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const who = role === 'HOST' ? `guest=&host=${token}` : `guest=${token}&host=`;
  const r = await fetch(`${API}/__e2e/handover/new?${who}&status=IN_PROGRESS`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  await page.goto(
    role === 'HOST'
      ? `/host/trips/${tripId}/handover/checkout`
      : `/trips/${tripId}/handover/checkout`,
  );
  await expect(page.locator('[data-testid="handover-validate-submit"]')).toBeVisible();
}

/** US-307 : écran du no-show de l'hôte (message tracé, déclaration possible). */
async function openNoShow(page: Page, context: BrowserContext): Promise<void> {
  await signInHost(context);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(`${API}/__e2e/no-show/new?guest=&host=${token}&traced=yes`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  await page.goto(`/host/trips/${tripId}/no-show`);
  await expect(page.locator('[data-testid="no-show-form"]')).toBeVisible();
}

/**
 * US-318 : S17 · incidente du voyageur (trip en cours, demande d'aide « accident », une photo
 * déposée par le double : la CI n'a pas de caméra).
 */
async function openIncident(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await signInGuest(context, language);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(`${API}/__e2e/p2p/new?guest=${token}&host=&status=IN_PROGRESS`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  expect((await fetch(`${API}/__e2e/p2p/photo?trip=${tripId}&kind=incident`)).status).toBe(200);
  await page.goto(`/trips/${tripId}/help`);
  await page.locator('[data-testid="s17-topic-ACCIDENT"]').check();
  await page.locator('[data-testid="s17-request-submit"]').click();
  await page.locator('[data-testid="s17-incident-link"]').click();
  await expect(page.locator('[data-testid="s17-incident-submit"]')).toBeVisible();
}

/** US-318 : A09 · amendes, péages et fourrière de l'hôte, vol présumé annoncé, une pièce reçue. */
async function openTrafficCharges(page: Page, context: BrowserContext): Promise<void> {
  await signInHost(context);
  const token = (await context.cookies()).find((c) => c.name === '__Host-session')?.value ?? '';
  const r = await fetch(`${API}/__e2e/p2p/new?guest=&host=${token}&status=COMPLETED&theft=yes`);
  expect(r.status).toBe(200);
  const { tripId } = (await r.json()) as { tripId: string };
  expect((await fetch(`${API}/__e2e/p2p/photo?trip=${tripId}&kind=traffic`)).status).toBe(200);
  await page.goto(`/host/trips/${tripId}/claims`);
  await expect(page.locator('[data-testid="a09-traffic-submit"]')).toBeVisible();
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
  // US-224 partie 224d : remboursement émis vu par le voyageur (S10) ; vu par l'hôte (A05)
  {
    name: 'remboursement-emis',
    source: 'S10, US-224',
    open: (page, context, language) => openTripRefund(page, context, language),
  },
  {
    name: 'hote-remboursement',
    source: 'A05, US-224',
    open: (page, context, language, project) => openHostRefund(page, context, language, project),
  },
  // US-214 : « Mis viajes » (S08) et détail du trip (S09) du voyageur
  {
    name: 'mes-voyages',
    source: 'S08, US-214',
    open: (page, context, language) => openGuestTrips(page, context, language, false),
  },
  {
    name: 'detail-voyage',
    source: 'S09, US-214',
    open: (page, context, language) => openGuestTrips(page, context, language, true),
  },
  // US-217 partie 217b : reçu du voyageur (S09 · reçu) et gains de l'hôte (A08)
  {
    name: 'recu-voyage',
    source: 'S09, US-217',
    open: (page, context, language) => openGuestReceipt(page, context, language),
  },
  {
    name: 'hote-gains',
    source: 'A08, US-217',
    open: (page, context) => openHostEarnings(page, context),
  },
  // US-303 : photos de départ du voyageur (S09 · check-in), série vide
  {
    name: 'photos-depart',
    source: 'S09 · check-in, US-303',
    open: (page, context, language) => openInspection(page, context, language),
  },
  // US-315 : remise par l'hôte (A03), étape du contrôle du permis en 6 points
  {
    name: 'remise-hote',
    source: 'A03, US-315',
    open: (page, context) => openHandover(page, context),
  },
  // US-703 : départ du voyageur (S09) sous le rappel du consentement MIT
  {
    name: 'remise-voyageur',
    source: 'S09 · check-in, US-315, US-703',
    open: (page, context, language) => openGuestHandover(page, context, language),
  },
  // US-312 : retour du véhicule par l'hôte (A04) et par le voyageur (S09 · check-out)
  {
    name: 'retour-hote',
    source: 'A04, US-315, US-312',
    open: (page, context, language) => openReturn(page, context, 'HOST', language),
  },
  {
    name: 'retour-voyageur',
    source: 'S09 · check-out, US-315, US-312',
    open: (page, context, language) => openReturn(page, context, 'GUEST', language),
  },
  // US-307 : no-show du voyageur déclaré par l'hôte (A05 · no-show)
  {
    name: 'no-show-hote',
    source: 'A05, US-307',
    open: (page, context) => openNoShow(page, context),
  },
  // US-525 : messages du trip (S16), fil du voyageur
  {
    name: 'messages-voyage',
    source: 'S16, US-525',
    open: (page, context, language) => openTripMessages(page, context, language),
  },
  // US-317 : avis du voyageur (S13 : fenêtre, double aveugle, formulaire) et avis reçus
  {
    name: 'avis-voyage',
    source: 'S13, US-317',
    open: (page, context, language) => openTripReview(page, context, language),
  },
  {
    name: 'avis-recus',
    source: 'US-317 (droit d’accès)',
    open: (page, context, language) => openReceivedReviews(page, context, language),
  },
  // US-318 : incident du voyageur depuis S17 et sinistres du trip vus par l'hôte (A09)
  {
    name: 'incident-voyageur',
    source: 'S17 · incidente, US-318',
    open: (page, context, language) => openIncident(page, context, language),
  },
  {
    name: 'sinistres-hote',
    source: 'A09, US-318',
    open: (page, context) => openTrafficCharges(page, context),
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
