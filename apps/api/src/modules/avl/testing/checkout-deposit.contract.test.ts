/**
 * Contrat HTTP de la caution au paiement du hold (US-701, ADR-169 ; 08 BR-PAY-06 « Moment de
 * l'évaluation » ; écran S05) sur l'application RÉELLE (ApiModule, harnais d'US-043) : chaque
 * réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 08 BR-PAY-06 et de 19 US-225 / US-701, jamais du code testé :
 * - la caution est décidée AVANT le paiement : refus ⇒ 409 `DEPOSIT_RAIL_UNAVAILABLE` (T59) ou
 *   `DEPOSIT_PARAM_MISSING` (T72 c), AUCUN T1 ni ordre chez le PSP ;
 * - le voyageur ne lit que le montant, la devise, la nature et la libération (S-7) : jamais les
 *   déclencheurs, l'âge, le signal de risque ni l'instantané des paramètres ;
 * - porte indisponible ⇒ 503, jamais un paiement sans décision de caution (fail-closed).
 * Montant : 300,00 de T57 (valeur de test du mécanisme) à l'exposant de la devise de chaque pays
 * configuré (USD 30 000, PYG 300).
 * Les règles de la porte sont prouvées par PAY (`deposit-checkout.test.ts`) et en base
 * (`l0-us701-deposit-hold`).
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../test/support/countries.js';
import { closeContractApps, startContractApp } from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import type { CheckoutPaymentRow } from '../internal/checkout/payment-store.js';
import {
  FakeCheckoutPaymentStore,
  FakeDepositGate,
  RecordingHostedPayments,
} from './fake-checkout-payment-store.js';

const HOLD = '00000000-0000-4000-8000-0000000701b1';
const EXPIRES = '2036-11-30T15:10:00.000Z';
const RELEASE = '2036-12-06T15:00:00.000Z';

const ROW: CheckoutPaymentRow = {
  holdStatus: 'ACTIVE',
  tripId: null,
  expiresAt: EXPIRES,
  paymentInFlightUntil: null,
  operationStatus: null,
  request: null,
};

/** Pays configurés (lus dans la configuration) ; 300,00 de T57 à l'exposant de la devise. */
const EXPONENTS = new Map(
  (
    JSON.parse(
      readFileSync(new URL('../../cfg/data/currencies.json', import.meta.url), 'utf8'),
    ) as { currencies: { code: string; exponent: number }[] }
  ).currencies.map((c) => [c.code, c.exponent]),
);
const CASES = countryCases().map((c) => ({
  ...c,
  deposit: 300n * 10n ** BigInt(EXPONENTS.get(c.currency) ?? 0),
}));

const apps: ContractApp[] = [];

async function app() {
  const store = new FakeCheckoutPaymentStore();
  const psp = new RecordingHostedPayments();
  const gate = new FakeDepositGate();
  const a = await startContractApp({
    checkout: { payments: { store, providers: new Map([['FAKE', psp]]), deposits: gate } },
  });
  apps.push(a);
  const hold = (row: Partial<CheckoutPaymentRow> = {}) =>
    store.holds.set(`${a.hash('voyageur')}:${HOLD}`, { row: { ...ROW, ...row } });
  const pay = () =>
    a.api.request('POST', `/checkout/holds/${HOLD}/payment`, {
      headers: a.cookie('voyageur'),
      body: { method: 'CARD' },
    });
  const read = () =>
    a.api.request('GET', `/checkout/holds/${HOLD}/payment`, { headers: a.cookie('voyageur') });
  return { store, psp, gate, hold, pay, read };
}

const C2 = ['triggers', 'paramsSnapshot', 'params_snapshot', 'youngestDriverAge', 'riskEvaluated'];

describe('US-701 — caution au paiement du hold du checkout (contrat)', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  for (const c of CASES) {
    it(`S05 (${c.country}, ${c.currency}) : caution exigée ⇒ montant, nature et libération seulement, jamais un champ [C2]`, async () => {
      const { gate, hold, read } = await app();
      hold();
      gate.shown = {
        status: 'REQUIRED',
        amountMinor: c.deposit,
        currency: c.currency,
        kind: 'HOLD',
        releaseAt: new Date(RELEASE),
      };
      const r = await read();
      expect(r.status).toBe(200);
      expect((r.json as { payment: { deposit: unknown } }).payment.deposit).toEqual({
        status: 'REQUIRED',
        amountMinor: String(c.deposit),
        currency: c.currency,
        kind: 'HOLD',
        releaseAt: RELEASE,
      });
      for (const k of C2) expect(JSON.stringify(r.json)).not.toContain(k);
      // un paiement est possible : la porte est évaluée (sans écriture)
      expect(gate.views).toEqual([true]);
    });
  }

  it('S05 : aucune caution (T70) ⇒ `NONE` ; réservation impossible (T59) ⇒ `UNAVAILABLE` et jours possibles', async () => {
    const { gate, hold, read } = await app();
    hold();
    gate.shown = { status: 'NONE' };
    expect((await read()).json).toMatchObject({ payment: { deposit: { status: 'NONE' } } });
    gate.shown = { status: 'UNAVAILABLE', code: 'DEPOSIT_RAIL_UNAVAILABLE', maxBookableDays: 3 };
    const r = await read();
    expect((r.json as { payment: { deposit: unknown } }).payment.deposit).toEqual({
      status: 'UNAVAILABLE',
      maxBookableDays: 3,
    });
    // le code interne du refus n'est pas rendu dans la vue (le message suit maxBookableDays)
    expect(JSON.stringify(r.json)).not.toContain('DEPOSIT_RAIL_UNAVAILABLE');
  });

  it('paiement terminé ou en cours : la porte n’est PAS évaluée (décision figée seulement)', async () => {
    const { gate, hold, read } = await app();
    hold({ holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'SUBMITTED' });
    const r = await read();
    expect(r.status).toBe(200);
    expect((r.json as { payment: Record<string, unknown> }).payment).not.toHaveProperty('deposit');
    expect(gate.views).toEqual([false]);
  });

  for (const [code, refusal] of [
    ['DEPOSIT_RAIL_UNAVAILABLE', 'DEPOSIT_RAIL_UNAVAILABLE'],
    ['DEPOSIT_PARAM_MISSING', 'PARAM_MISSING'],
  ] as const) {
    it(`refus de la porte (${refusal}) ⇒ 409 ${code} AVANT T1 : aucun ordre, aucun appel au PSP`, async () => {
      const { store, psp, gate, hold, pay } = await app();
      hold();
      gate.enforcement = {
        kind: 'REFUSED',
        view: { status: 'UNAVAILABLE', code: refusal, maxBookableDays: null },
      };
      const r = await pay();
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ code, messageKey: 'common.payment.depositUnavailable' });
      expect(gate.enforced).toEqual([HOLD]);
      expect(store.starts).toEqual([]);
      expect(psp.orders).toEqual([]);
    });
  }

  it('porte de la caution en panne ⇒ 503 BOOKING_UNAVAILABLE (lecture et paiement), aucun T1', async () => {
    const { store, gate, hold, pay, read } = await app();
    hold();
    gate.down = true;
    for (const r of [await pay(), await read()]) {
      expect(r.status).toBe(503);
      expect(r.json).toEqual({
        code: 'BOOKING_UNAVAILABLE',
        messageKey: 'common.checkout.unavailable',
      });
    }
    expect(store.starts).toEqual([]);
  });
});
