/**
 * Contrat HTTP du paiement du hold du checkout (US-223 partie 223b, ADR-142 ; écrans S05 et S06)
 * sur l'application RÉELLE (ApiModule, harnais d'US-043) : `POST /checkout/holds/{id}/payment` et
 * `GET /checkout/holds/{id}/payment`. Chaque réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 19 US-223 (critère 1 : l'ordre porte le montant EXPLICITE de chaque jambe ;
 * critère 6 : capacité bloquante non validée ⇒ refus avant le paiement), de 08 E7 et des oracles
 * Python (`docs/specs/tools/golden_vectors.json`, lus par `@rueda/money/golden-vectors`), jamais du
 * code testé : TJ01 en USD (HOST 131,25, INSURER 25,50, TAX 0,00, PLATFORM 99,91, total 256,66) et
 * TJ08a en PYG sans décimale. Le montant et les jambes rendus par T1 sont ceux du devis engagé
 * rejoué par la base (prouvé par `l0-us223-checkout-payment`) ; ici, l'API les transmet au PSP sans
 * les recalculer ni les recevoir du client. La preuve par webhook signé et la conversion sont
 * prouvées par la base et par l'adaptateur FAKE de PAY (`l0-us223-conversion`, `pay/testing/`).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { PRODUCTION_PROVIDERS } from '../../pay/index.js';
import { postgresCheckoutAdapters } from '../internal/checkout/avl-checkout.module.js';
import type { CheckoutPaymentRow, PaymentStart } from '../internal/checkout/payment-store.js';
import type { HostedPaymentProvider } from '../internal/checkout/payment.service.js';
import {
  FakeCheckoutPaymentStore,
  PaymentError,
  RecordingHostedPayments,
} from './fake-checkout-payment-store.js';

const HOLD = '00000000-0000-4000-8000-0000000223b1';
const OPERATION = '00000000-0000-4000-8000-0000000223c1';
const TRIP = '00000000-0000-4000-8000-0000000223d1';
const EXPIRES = '2036-11-30T15:10:00.000Z';
const golden = loadGoldenVectors();
const TJ01 = legVector(golden, 'TJ01');
const TJ08A = legVector(golden, 'TJ08a');

const ROW: CheckoutPaymentRow = {
  holdStatus: 'ACTIVE',
  tripId: null,
  expiresAt: EXPIRES,
  paymentInFlightUntil: null,
  operationStatus: null,
  // US-223c : hold CHECKOUT (aucune demande à l'hôte)
  request: null,
};

const startOf = (v: GoldenLegVector, outcome: PaymentStart['outcome'] = 'NEW_ORDER') => ({
  kind: 'START' as const,
  start: {
    outcome,
    operationId: OPERATION,
    idemSent: `hold:${HOLD}:CAPTURE:a1`,
    provider: 'FAKE',
    method: 'CARD',
    amountMinor: v.totalMinor,
    currency: v.currency,
    legs: { ...v.legsMinor },
    // US-223c : réservation immédiate (hold CHECKOUT) ⇒ capture AUTO décidée par la base
    capture: 'AUTO' as const,
  },
});

const apps: ContractApp[] = [];

async function app(
  options: {
    readonly providers?: ReadonlyMap<string, HostedPaymentProvider>;
    readonly psp?: RecordingHostedPayments;
  } = {},
) {
  const store = new FakeCheckoutPaymentStore();
  const psp = options.psp ?? new RecordingHostedPayments();
  const a = await startContractApp({
    checkout: {
      payments: { store, providers: options.providers ?? new Map([['FAKE', psp]]) },
    },
  });
  apps.push(a);
  const hold = (row: Partial<CheckoutPaymentRow> = {}, extra: object = {}) => {
    const h = { row: { ...ROW, ...row }, ...extra };
    store.holds.set(`${a.hash('voyageur')}:${HOLD}`, h);
    return h;
  };
  const pay = (body: unknown = { method: 'CARD' }) =>
    a.api.request('POST', `/checkout/holds/${HOLD}/payment`, {
      headers: a.cookie('voyageur'),
      body,
    });
  const read = () =>
    a.api.request('GET', `/checkout/holds/${HOLD}/payment`, { headers: a.cookie('voyageur') });
  return { a, store, psp, hold, pay, read };
}

describe('US-223b — contrat du paiement du hold du checkout', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  for (const v of [TJ01, TJ08A]) {
    it(`critère 1 (${v.id}, ${v.currency}) : T1 puis createHostedPayment avec le montant EXPLICITE de chaque jambe, la clé de T1 et la capture AUTO, puis T2 ; 201 et page hébergée ; aucun montant du client`, async () => {
      const { store, psp, hold, pay } = await app();
      hold({}, { start: startOf(v) });
      const r = await pay();
      expect(r.status).toBe(201);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.json).toEqual({
        payment: {
          holdId: HOLD,
          state: 'VERIFYING',
          holdStatus: 'PAYMENT_IN_FLIGHT',
          tripId: null,
          expiresAt: EXPIRES,
          paymentInFlightUntil: null,
          redirectUrl: 'https://psp.fake.invalid/pay/fake-1',
        },
      });
      expect(store.starts).toHaveLength(1);
      expect(store.starts[0]).toMatchObject({ holdId: HOLD, method: 'CARD' });
      expect(psp.orders).toHaveLength(1);
      const order = psp.orders[0];
      expect(order?.legs).toEqual(v.legsMinor);
      expect(order?.amountMinor).toBe(v.totalMinor);
      expect(order?.currency).toBe(v.currency);
      expect(order?.idempotencyKey).toBe(`hold:${HOLD}:CAPTURE:a1`);
      expect(order?.capture).toBe('AUTO');
      expect(store.records).toEqual([
        {
          holdId: HOLD,
          operationId: OPERATION,
          providerReference: 'fake-1',
          orderExpiresAt: '2036-11-30T15:20:00.000Z',
        },
      ]);
    });
  }

  it('TJ01 : valeurs de l’oracle (HOST 131,25, INSURER 25,50, TAX 0,00, PLATFORM 99,91, total 256,66)', () => {
    expect(TJ01.legsMinor).toEqual({
      HOST: 13_125n,
      INSURER: 2_550n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: 9_991n,
    });
    expect(TJ01.totalMinor).toBe(25_666n);
  });

  it('idempotence : reprise d’un ordre interrompu alors que T1 rend EXISTING_ORDER ou VERIFYING (PSP sans recherche par clé) ⇒ 200, aucun nouvel ordre au PSP', async () => {
    const { store, psp, hold, pay } = await app();
    hold(
      { holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'PENDING' },
      { start: { kind: 'IN_FLIGHT' } },
    );
    const r = await pay();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ payment: { state: 'INTERRUPTED', redirectUrl: null } });
    expect(store.starts).toHaveLength(1);
    expect(psp.orders).toEqual([]);
  });

  it('deux POST simultanés sur le même hold ⇒ un seul ordre chez le PSP (le second voit le hold en vol)', async () => {
    const { psp, hold, a } = await app();
    hold({}, { start: startOf(TJ01) });
    const send = () =>
      a.api.request('POST', `/checkout/holds/${HOLD}/payment`, {
        headers: a.cookie('voyageur'),
        body: { method: 'CARD' },
      });
    const replies = await Promise.all([send(), send()]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(psp.orders).toHaveLength(1);
  });

  it('câblage de production : aucun connecteur tant que PRODUCTION_PROVIDERS est vide (C19)', () => {
    expect(PRODUCTION_PROVIDERS).toEqual([]);
    const adapters = postgresCheckoutAdapters(
      { query: () => Promise.reject(new Error('aucune base')) },
      () => {
        throw new Error('aucun paramètre');
      },
    );
    expect(adapters.payments?.providers.size).toBe(0);
  });

  it('hold déjà en vol, converti ou échu ⇒ 200 avec l’état, sans T1 ni appel au PSP', async () => {
    const { store, psp, hold, pay } = await app();
    for (const [row, state] of [
      [{ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'SUBMITTED' }, 'VERIFYING'],
      [{ holdStatus: 'CONVERTED', tripId: TRIP, operationStatus: 'SUCCEEDED' }, 'CONFIRMED'],
      [{ holdStatus: 'EXPIRED' }, 'ENDED'],
    ] as const) {
      hold(row);
      const r = await pay();
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ payment: { state, redirectUrl: null } });
    }
    expect(store.starts).toEqual([]);
    expect(psp.orders).toEqual([]);
  });

  it('N-108, reprise après un PSP sans réponse : hold en vol sans ordre enregistré (INTERRUPTED) ⇒ T1 RETRY_SAME_KEY, recherche par NOTRE clé ; ordre trouvé jamais recréé (T2 avec sa référence, 200) ; inconnu ⇒ recréé sous la même clé (201)', async () => {
    const psp = new RecordingHostedPayments();
    psp.found = {
      providerReference: 'fake-found',
      merchantReference: `hold:${HOLD}:CAPTURE:a1`,
      status: 'PENDING',
      amountMinor: TJ01.totalMinor,
      currency: TJ01.currency,
      legs: { ...TJ01.legsMinor },
    };
    const { store, hold, pay } = await app({ psp });
    const interrupted = { holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'PENDING' };
    hold(interrupted, { start: startOf(TJ01, 'RETRY_SAME_KEY') });
    const r = await pay();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ payment: { state: 'VERIFYING', redirectUrl: null } });
    expect(psp.lookups).toEqual([{ merchantReference: `hold:${HOLD}:CAPTURE:a1` }]);
    expect(psp.orders).toEqual([]);
    expect(store.records[0]).toMatchObject({
      providerReference: 'fake-found',
      orderExpiresAt: null,
    });

    psp.found = null;
    hold(interrupted, { start: startOf(TJ01, 'RETRY_SAME_KEY') });
    const again = await pay();
    expect(again.status).toBe(201);
    expect(psp.orders.map((o) => o.idempotencyKey)).toEqual([`hold:${HOLD}:CAPTURE:a1`]);
  });

  it('jambes de T1 dont la somme diffère du montant ⇒ 503 PAYMENT_UNAVAILABLE et AUCUN appel au PSP (critère 2)', async () => {
    const { psp, hold, pay } = await app();
    const bad = startOf(TJ01);
    hold({}, { start: { ...bad, start: { ...bad.start, amountMinor: TJ01.totalMinor - 1n } } });
    const r = await pay();
    expect(r.status).toBe(503);
    expect(r.json).toEqual({
      code: 'PAYMENT_UNAVAILABLE',
      messageKey: 'common.payment.unavailable',
    });
    expect(psp.orders).toEqual([]);
  });

  it('PSP sans réponse ⇒ 503 PAYMENT_UNAVAILABLE, aucune redirection ; capacité bloquante retirée chez le PSP ⇒ 409 HOST_PAYOUT_RAIL_UNAVAILABLE', async () => {
    const psp = new RecordingHostedPayments();
    const { store, hold, pay } = await app({ psp });
    psp.failWith = new PaymentError('UNKNOWN_OUTCOME', 'délai dépassé (FAKE)');
    hold({}, { start: startOf(TJ01) });
    const r = await pay();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    expect(store.records).toEqual([]);

    psp.failWith = new PaymentError('HOST_PAYOUT_RAIL_UNAVAILABLE', 'capacité (FAKE)');
    hold({}, { start: startOf(TJ01) });
    const rail = await pay();
    expect(rail.status).toBe(409);
    expect(rail.json).toEqual({
      code: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
      messageKey: 'common.payment.payoutRailUnavailable',
    });
  });

  it('refus de T1 (base) : capacité bloquante non validée, revue avant débit, tentatives épuisées, moyen indisponible, conducteur non vérifié', async () => {
    const { psp, hold, pay } = await app();
    for (const [code, status, key] of [
      ['HOST_PAYOUT_RAIL_UNAVAILABLE', 409, 'common.payment.payoutRailUnavailable'],
      ['BOOKING_UNDER_REVIEW', 409, 'common.payment.underReview'],
      ['PAYMENT_ATTEMPTS_EXCEEDED', 409, 'common.payment.attemptsExceeded'],
      ['PAYMENT_METHOD_UNAVAILABLE', 422, 'common.payment.methodUnavailable'],
      ['KYC_NOT_APPROVED', 403, 'common.kyc.notApproved'],
      ['PAYMENT_UNAVAILABLE', 503, 'common.payment.unavailable'],
    ] as const) {
      hold({}, { start: { kind: 'REFUSED', code } });
      const r = await pay();
      expect(r.status).toBe(status);
      expect(r.json).toEqual({ code, messageKey: key });
    }
    expect(psp.orders).toEqual([]);
  });

  it('hold échu entre T1 et T2 ⇒ 409 HOLD_EXPIRED, aucune redirection vers le PSP (17 §2.5 étape 3c)', async () => {
    const { hold, pay } = await app();
    hold({}, { start: startOf(TJ01), record: 'EXPIRED' });
    const r = await pay();
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ code: 'HOLD_EXPIRED', messageKey: 'common.payment.holdExpired' });
  });

  it('preuve arrivée avant T2 (CONVERTED) ⇒ 200 sans redirection', async () => {
    const { hold, pay } = await app();
    hold({}, { start: startOf(TJ01), record: 'CONVERTED' });
    const r = await pay();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ payment: { redirectUrl: null } });
  });

  it('L2-PM-03 : un montant, une jambe ou un champ inconnu dans le corps ⇒ 400 REQUEST_INVALID, rien n’est envoyé', async () => {
    const { store, psp, hold, pay } = await app();
    hold({}, { start: startOf(TJ01) });
    for (const body of [
      { method: 'CARD', amountMinor: '1' },
      { legs: { HOST: '1' } },
      { method: 'CHEQUE' },
      [],
    ]) {
      const r = await pay(body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ code: 'REQUEST_INVALID', messageKey: 'common.auth.requestInvalid' });
    }
    expect(store.starts).toEqual([]);
    expect(psp.orders).toEqual([]);
  });

  it('IDOR : hold d’un autre voyageur ou inconnu ⇒ 404 HOLD_NOT_FOUND (même réponse), rien n’est démarré', async () => {
    const { a, store, hold } = await app();
    hold({}, { start: startOf(TJ01) });
    for (const path of [
      `/checkout/holds/${HOLD}/payment`,
      '/checkout/holds/00000000-0000-4000-8000-000000000000/payment',
      '/checkout/holds/pas-un-uuid/payment',
    ]) {
      const r = await a.api.request('POST', path, {
        headers: a.cookie('staff_sans_mfa'),
        body: { method: 'CARD' },
      });
      expect(r.status).toBe(404);
      expect(r.json).toEqual({
        code: 'HOLD_NOT_FOUND',
        messageKey: 'common.checkout.holdNotFound',
      });
      const read = await a.api.request('GET', path, { headers: a.cookie('staff_sans_mfa') });
      expect(read.status).toBe(404);
    }
    expect(store.starts).toEqual([]);
  });

  it('sans session ⇒ 401 AUTH_REQUIRED', async () => {
    const { a } = await app();
    for (const method of ['POST', 'GET'] as const) {
      const r = await a.api.request(method, `/checkout/holds/${HOLD}/payment`, {
        ...(method === 'POST' ? { body: {} } : {}),
      });
      expect(r.status).toBe(401);
    }
  });

  it('production (aucun connecteur servi, C19) ⇒ 503 PAYMENT_UNAVAILABLE AVANT T1 : le hold n’est jamais mis en vol', async () => {
    const { store, hold, pay } = await app({ providers: new Map() });
    hold({}, { start: startOf(TJ01) });
    const r = await pay();
    expect(r.status).toBe(503);
    expect(r.json).toEqual({
      code: 'PAYMENT_UNAVAILABLE',
      messageKey: 'common.payment.unavailable',
    });
    expect(store.starts).toEqual([]);
  });

  it('base en panne ⇒ 503 BOOKING_UNAVAILABLE (lecture et paiement), jamais un succès', async () => {
    const { store, pay, read } = await app();
    store.down = true;
    for (const r of [await pay(), await read()]) {
      expect(r.status).toBe(503);
      expect(r.json).toEqual({
        code: 'BOOKING_UNAVAILABLE',
        messageKey: 'common.checkout.unavailable',
      });
    }
  });

  it('S06 (UX-27) : état fondé sur hold_status et le trip né ; « confirmé » seulement avec un trip ; le statut brut de l’opération n’est jamais rendu', async () => {
    const { hold, read } = await app();
    for (const [row, state] of [
      [{}, 'PAYABLE'],
      [{ operationStatus: 'FAILED' }, 'DECLINED'],
      [{ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'SUBMITTED' }, 'VERIFYING'],
      [{ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'PENDING' }, 'INTERRUPTED'],
      [{ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'UNKNOWN' }, 'VERIFYING'],
      [{ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'SUCCEEDED' }, 'VERIFYING'],
      [{ holdStatus: 'CONVERTED', tripId: null, operationStatus: 'SUCCEEDED' }, 'VERIFYING'],
      [{ holdStatus: 'CONVERTED', tripId: TRIP, operationStatus: 'SUCCEEDED' }, 'CONFIRMED'],
      [{ holdStatus: 'COMPENSATED', operationStatus: 'SUCCEEDED' }, 'REFUND_DUE'],
      [{ holdStatus: 'EXPIRED', operationStatus: 'SUBMITTED' }, 'UNPROVEN'],
      [{ holdStatus: 'EXPIRED', operationStatus: 'FAILED' }, 'ENDED'],
      [{ holdStatus: 'RELEASED' }, 'ENDED'],
    ] as const) {
      hold(row);
      const r = await read();
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.json).toMatchObject({ payment: { holdId: HOLD, state } });
      expect(JSON.stringify(r.json)).not.toContain('operationStatus');
    }
  });

  it('couverture : chaque statut déclaré pour /checkout/holds/{holdId}/payment est exercé', () => {
    expect(
      missingCoverage(contract, '/checkout/holds/{holdId}/payment', coverageOf(...apps)),
    ).toEqual([]);
  });
});
