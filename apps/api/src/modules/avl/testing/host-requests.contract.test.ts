/**
 * Contrat HTTP des demandes de réservation de l'hôte (US-223 partie 223c, ADR-146 ; 16 HDB-002 ;
 * 17 §2.5 « Hold de demande REQUEST ») sur l'application RÉELLE (ApiModule, harnais d'US-043) et
 * les FAKE du magasin et du connecteur de capture : chaque réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 19 US-223 (critère US-060 : « Σ jambes = montant capturé = total du devis figé ≤
 * montant de l'AUTH, sinon LEG_SUM_MISMATCH et aucune capture »), de 19 US-219 (critères 4 à 6 :
 * acceptation ⇒ capture par jambes ; refus ⇒ rien n'est débité ; acceptation tardive ⇒
 * REQUEST_EXPIRED), de 17 §2.5 (exigence de sécurité 2 : IDOR sans état révélé), de 08 E7 et des
 * oracles Python (`@rueda/money/golden-vectors` : TJ01 en USD, TJ08a en PYG sans décimale), jamais
 * du code testé. Les règles elles-mêmes sont prouvées sur PostgreSQL (l0-us223-request).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { postgresCheckoutAdapters } from '../internal/checkout/avl-checkout.module.js';
import type { RequestCaptureProvider } from '../internal/checkout/host-requests.service.js';
import type { AcceptResult, HostRequestRow } from '../internal/checkout/host-requests-store.js';
import {
  FakeHostRequestStore,
  PaymentError,
  RecordingCaptures,
} from './fake-host-request-store.js';

const ORG_A = '00000000-0000-4000-8000-00000223c0a1';
const ORG_B = '00000000-0000-4000-8000-00000223c0b1';
const HOLD = '00000000-0000-4000-8000-00000223c0c1';
const OPERATION = '00000000-0000-4000-8000-00000223c0d1';
const VEHICLE = '00000000-0000-4000-8000-00000223c0e1';
const golden = loadGoldenVectors();
const TJ01 = legVector(golden, 'TJ01');
const TJ08A = legVector(golden, 'TJ08a');

const rowOf = (v: GoldenLegVector): HostRequestRow => ({
  holdId: HOLD,
  status: 'AWAITING_HOST',
  vehicleId: VEHICLE,
  scheduledStart: '2036-12-10T15:00:00.000Z',
  scheduledEnd: '2036-12-13T15:00:00.000Z',
  timezone: 'Etc/UTC',
  respondBy: '2036-12-01T16:00:00.000Z',
  currency: v.currency,
  totalMinor: v.totalMinor.toString(),
  hostLegMinor: (v.legsMinor.HOST ?? 0n).toString(),
  guest: { firstName: 'Ana', ageYears: 34, rating: 4.8, verified: true },
});

const captureOf = (
  v: GoldenLegVector,
  outcome: 'CAPTURE_ORDER' | 'RETRY_SAME_KEY',
): AcceptResult => ({
  kind: 'CAPTURE',
  capture: {
    outcome,
    operationId: OPERATION,
    idemSent: `hold:${HOLD}:CAPTURE:a1`,
    provider: 'FAKE',
    method: 'CARD',
    amountMinor: v.totalMinor,
    currency: v.currency,
    legs: { ...v.legsMinor },
    authorizationReference: 'fake-auth-1',
    lookup: outcome === 'RETRY_SAME_KEY',
  },
});

const apps: ContractApp[] = [];

async function app(
  options: { readonly providers?: ReadonlyMap<string, RequestCaptureProvider> } = {},
) {
  const store = new FakeHostRequestStore();
  const psp = new RecordingCaptures();
  const a = await startContractApp({
    checkout: {
      hostRequests: { store, providers: options.providers ?? new Map([['FAKE', psp]]) },
    },
  });
  apps.push(a);
  // hôte A = acteur « voyageur » du harnais (compte ORG_A) ; hôte B = « staff_sans_mfa » (ORG_B)
  store.accounts.set(a.hash('voyageur'), new Set([ORG_A]));
  store.accounts.set(a.hash('staff_sans_mfa'), new Set([ORG_B]));
  const as = (actor: 'voyageur' | 'staff_sans_mfa' | null) =>
    actor === null ? {} : a.cookie(actor);
  const get = (path: string, actor: 'voyageur' | 'staff_sans_mfa' | null = 'voyageur') =>
    a.api.request('GET', path, { headers: as(actor) });
  const post = (path: string, actor: 'voyageur' | 'staff_sans_mfa' | null = 'voyageur') =>
    a.api.request('POST', path, { headers: as(actor), body: {} });
  return { a, store, psp, get, post };
}

const base = (org: string) => `/host/accounts/${org}/requests`;

describe('US-223c — contrat des demandes de réservation de l’hôte', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  it('liste et détail : demandes du compte titulaire de la session ; compte d’un autre, demande inconnue ⇒ 404 REQUEST_NOT_FOUND ; sans session ⇒ 401 ; no-store', async () => {
    const { store, get } = await app();
    store.requests.set(ORG_A, [rowOf(TJ01)]);
    const list = await get(base(ORG_A));
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(list.json).toEqual({ requests: [rowOf(TJ01)] });
    const one = await get(`${base(ORG_A)}/${HOLD}`);
    expect(one.status).toBe(200);
    expect(one.json).toEqual({ request: rowOf(TJ01) });
    // IDOR : l'hôte B ne voit rien du compte A (même réponse qu'un compte inconnu)
    for (const r of [
      await get(base(ORG_A), 'staff_sans_mfa'),
      await get(`${base(ORG_A)}/${HOLD}`, 'staff_sans_mfa'),
      await get(`${base(ORG_A)}/00000000-0000-4000-8000-000000000999`),
      await get(`${base('pas-un-uuid')}`),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json).toMatchObject({ code: 'REQUEST_NOT_FOUND' });
    }
    expect((await get(base(ORG_A), null)).status).toBe(401);
    expect((await get(`${base(ORG_A)}/${HOLD}`, null)).status).toBe(401);
    store.down = true;
    for (const r of [await get(base(ORG_A)), await get(`${base(ORG_A)}/${HOLD}`)]) {
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
    }
  });

  for (const v of [TJ01, TJ08A]) {
    it(`acceptation (${v.id}, ${v.currency}) : capture avec le montant EXPLICITE de chaque jambe du devis, la clé stockée et la référence de l’autorisation, puis affinage ; 200 CAPTURING ; aucun montant du client`, async () => {
      const { store, psp, post } = await app();
      store.accepts.set(HOLD, captureOf(v, 'CAPTURE_ORDER'));
      const r = await post(`${base(ORG_A)}/${HOLD}/accept`);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.json).toEqual({ decision: { holdId: HOLD, status: 'CAPTURING' } });
      expect(psp.captures).toHaveLength(1);
      const c = psp.captures[0];
      // 08 E7 règle 2 : jambes de la capture = jambes du devis (oracle), Σ = total
      expect(c?.legs).toEqual(v.legsMinor);
      expect(c?.amountMinor).toBe(v.totalMinor);
      expect(Object.values(v.legsMinor).reduce((s, x) => s + x, 0n)).toBe(v.totalMinor);
      expect(c?.currency).toBe(v.currency);
      expect(c?.idempotencyKey).toBe(`hold:${HOLD}:CAPTURE:a1`);
      expect(c?.providerReference).toBe('fake-auth-1');
      expect(store.recorded).toEqual([
        { holdId: HOLD, operationId: OPERATION, providerReference: 'fake-capture-1' },
      ]);
    });
  }

  it('N-108 : reprise d’une capture jamais enregistrée ⇒ recherche par NOTRE clé ; trouvée ⇒ affinage sans seconde capture ; inconnue ⇒ capture sous la même clé', async () => {
    const { store, psp, post } = await app();
    store.accepts.set(HOLD, captureOf(TJ01, 'RETRY_SAME_KEY'));
    psp.found = {
      providerReference: 'fake-capture-found',
      merchantReference: `hold:${HOLD}:CAPTURE:a1`,
      status: 'SUBMITTED',
      amountMinor: TJ01.totalMinor,
      currency: TJ01.currency,
      legs: { ...TJ01.legsMinor },
    };
    expect((await post(`${base(ORG_A)}/${HOLD}/accept`)).status).toBe(200);
    expect(psp.lookups).toEqual([{ merchantReference: `hold:${HOLD}:CAPTURE:a1` }]);
    expect(psp.captures).toHaveLength(0);
    expect(store.recorded[0]?.providerReference).toBe('fake-capture-found');
    psp.found = null;
    expect((await post(`${base(ORG_A)}/${HOLD}/accept`)).status).toBe(200);
    expect(psp.captures).toHaveLength(1);
    expect(psp.captures[0]?.idempotencyKey).toBe(`hold:${HOLD}:CAPTURE:a1`);
    // sans recherche par clé, la base n'a rendu la reprise que si l'en-tête d'idempotence est validé :
    // même clé, sans lecture
    const noLookup = captureOf(TJ01, 'RETRY_SAME_KEY');
    if (noLookup.kind !== 'CAPTURE') throw new Error('capture attendue');
    store.accepts.set(HOLD, { kind: 'CAPTURE', capture: { ...noLookup.capture, lookup: false } });
    const lookups = psp.lookups.length;
    expect((await post(`${base(ORG_A)}/${HOLD}/accept`)).status).toBe(200);
    expect(psp.lookups).toHaveLength(lookups);
    expect(psp.captures).toHaveLength(2);
    expect(psp.captures[1]?.idempotencyKey).toBe(`hold:${HOLD}:CAPTURE:a1`);
  });

  it('capture en cours ou trip né ⇒ 200 sans nouvel envoi ; refus de la base ⇒ 409 ou 404 sans capture', async () => {
    const { store, psp, post } = await app();
    for (const outcome of ['CAPTURING', 'ACCEPTED'] as const) {
      store.accepts.set(HOLD, { kind: 'DONE', outcome });
      const r = await post(`${base(ORG_A)}/${HOLD}/accept`);
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ decision: { holdId: HOLD, status: outcome } });
    }
    for (const code of [
      'REQUEST_EXPIRED',
      'INVALID_TRANSITION',
      'TERMS_REACCEPT_REQUIRED',
      'GUEST_NOT_ELIGIBLE',
      'START_PASSED',
      'LEG_SUM_MISMATCH',
    ] as const) {
      store.accepts.set(HOLD, { kind: 'REFUSED', code });
      const r = await post(`${base(ORG_A)}/${HOLD}/accept`);
      expect(r.status, code).toBe(409);
      expect(r.json).toMatchObject({ code });
    }
    // IDOR : demande d'un autre compte ⇒ la base rend FORBIDDEN ⇒ 404, sans état
    const other = await post(`${base(ORG_A)}/${HOLD}/accept`, 'staff_sans_mfa');
    expect(other.status).toBe(404);
    expect(other.json).toMatchObject({ code: 'REQUEST_NOT_FOUND' });
    expect(psp.captures).toHaveLength(0);
    expect((await post(`${base(ORG_A)}/${HOLD}/accept`, null)).status).toBe(401);
  });

  it('invariant : jambes rendues par la base dont la somme diffère du montant ⇒ 503 BOOKING_UNAVAILABLE (défaut grave journalisé, jamais un conseil de refus), aucun appel au PSP', async () => {
    const { store, psp, post } = await app();
    const bad = captureOf(TJ01, 'CAPTURE_ORDER');
    if (bad.kind !== 'CAPTURE') throw new Error('capture attendue');
    store.accepts.set(HOLD, {
      kind: 'CAPTURE',
      capture: { ...bad.capture, amountMinor: TJ01.totalMinor + 1n },
    });
    const r = await post(`${base(ORG_A)}/${HOLD}/accept`);
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
    expect(psp.captures).toHaveLength(0);
    expect(store.recorded).toHaveLength(0);
  });

  it('aucun connecteur servi (production jusqu’au lot C) ⇒ 503 PAYMENT_UNAVAILABLE AVANT la base ; PSP en échec ⇒ 503, capture non enregistrée ; base indisponible ⇒ 503', async () => {
    const none = await app({ providers: new Map() });
    none.store.accepts.set(HOLD, captureOf(TJ01, 'CAPTURE_ORDER'));
    const r = await none.post(`${base(ORG_A)}/${HOLD}/accept`);
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    expect(none.store.accepted).toHaveLength(0);
    const failing = await app();
    failing.store.accepts.set(HOLD, captureOf(TJ01, 'CAPTURE_ORDER'));
    failing.psp.failWith = new PaymentError('UNKNOWN_OUTCOME', 'délai dépassé (FAKE)');
    const f = await failing.post(`${base(ORG_A)}/${HOLD}/accept`);
    expect(f.status).toBe(503);
    expect(f.json).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    expect(failing.store.recorded).toHaveLength(0);
    failing.store.down = true;
    const down = await failing.post(`${base(ORG_A)}/${HOLD}/accept`);
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
  });

  it('refus : 200 DECLINED, aucun appel au PSP (VOID par la boîte d’envoi) ; échue ou déjà acceptée ⇒ 409 ; autre compte ⇒ 404 ; sans session ⇒ 401 ; base indisponible ⇒ 503', async () => {
    const { store, psp, post } = await app();
    store.declines.set(HOLD, { kind: 'DECLINED' });
    const r = await post(`${base(ORG_A)}/${HOLD}/decline`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ decision: { holdId: HOLD, status: 'DECLINED' } });
    expect(psp.captures).toHaveLength(0);
    for (const code of ['REQUEST_EXPIRED', 'INVALID_TRANSITION'] as const) {
      store.declines.set(HOLD, { kind: 'REFUSED', code });
      const x = await post(`${base(ORG_A)}/${HOLD}/decline`);
      expect(x.status).toBe(409);
      expect(x.json).toMatchObject({ code });
    }
    const other = await post(`${base(ORG_A)}/${HOLD}/decline`, 'staff_sans_mfa');
    expect(other.status).toBe(404);
    expect(other.json).toMatchObject({ code: 'REQUEST_NOT_FOUND' });
    expect((await post(`${base(ORG_A)}/${HOLD}/decline`, null)).status).toBe(401);
    store.down = true;
    expect((await post(`${base(ORG_A)}/${HOLD}/decline`)).status).toBe(503);
  });

  it('câblage de production : aucun connecteur de capture tant que le lot C n’est pas livré', () => {
    const adapters = postgresCheckoutAdapters(
      { query: () => Promise.reject(new Error('non appelé')) },
      () => {
        throw new Error('non appelé');
      },
    );
    expect(adapters.hostRequests?.providers.size).toBe(0);
    expect(FIRST_COUNTRY).toMatch(/^[A-Z]{2}$/);
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId}/requests est exercé', () => {
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}/requests', coverageOf(...apps)),
    ).toEqual([]);
  });
});
