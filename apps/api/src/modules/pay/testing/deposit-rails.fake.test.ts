/**
 * US-225 — rails de la caution exécutés par le port `PaymentProvider` sur le PSP simulé (FAKE
 * seulement, C19), en USD (PA) et en PYG sans décimale (PY) : pose par pré-autorisation, décision
 * T57 (capture des frais puis VOID du reste) et T58 (VOID puis MIT), ré-autorisation acceptée ou
 * refusée (trip signalé à l'ops, AUCUN débit), rail « débit puis remboursement » refusé sans appel
 * tant que `funds_holding_enabled` = false. Attendus : vecteurs T57 / T58 (oracle
 * `check_t49plus.py`) et, pour PY, le calcul de 08 BR-PAY-06 refait à la main.
 */
import { readFileSync } from 'node:fs';
import { createCurrencyRegistry, money, ratio } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import { CapabilitySet } from '../internal/capabilities.js';
import { DepositRailExecutor } from '../internal/deposit-executor.js';
import type { DepositPaymentProvider } from '../internal/deposit-executor.js';
import type { OperationStatus } from '../internal/port.js';
import { planDepositDecision } from '../internal/deposit-rails.js';
import { isPaymentError } from '../internal/errors.js';
import { countryCases } from '../../../../test/support/countries.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';

const CURRENCIES = createCurrencyRegistry(
  (
    JSON.parse(
      readFileSync(new URL('../../cfg/data/currencies.json', import.meta.url), 'utf8'),
    ) as { currencies: { code: string; exponent: number }[] }
  ).currencies,
);

/**
 * Pays configurés (lus dans la configuration) ; vecteurs T57–T58 (300,00 et 12,00 en unités
 * majeures) à l'exposant de la devise : USD 30 000 et 1 200 centimes ; PYG 300 et 12.
 */
const CASES = countryCases().map((c) => {
  const exp = 10n ** BigInt(CURRENCIES.get(c.currency).exponent);
  return { ...c, deposit: 300n * exp, fuel: 12n * exp };
});

const H = 3_600_000;
const DECISION = new Date(Date.parse('2031-07-16T08:00:00.000Z'));

function setup(c: (typeof CASES)[number], options: FakeStackOptions = {}) {
  const stack = fakeStack(options);
  const executor = new DepositRailExecutor(stack.provider);
  const ref = {
    depositId: `dep-${c.country}`,
    tripReference: `trip-${c.country}`,
    tripId: `trip-${c.country}`,
    segmentId: `seg-${c.country}`,
    tenderId: `tnd-${c.country}`,
    currency: CURRENCIES.get(c.currency),
  };
  return { stack, executor, ref };
}

async function authorized(c: (typeof CASES)[number], s: ReturnType<typeof setup>): Promise<string> {
  const order = await s.executor.place(s.ref, {
    mechanism: 'PREAUTH_SINGLE',
    amountMinor: c.deposit,
    fundsHoldingEnabled: false,
    attemptNo: 1,
  });
  s.stack.psp.customerPays(order.providerReference);
  return order.providerReference;
}

function plan(c: (typeof CASES)[number], caps: CapabilitySet) {
  return planDepositDecision({
    mechanism: 'PREAUTH_SINGLE',
    amount: money(c.deposit, CURRENCIES.get(c.currency)),
    decisionAt: DECISION,
    feeNoticeH: 48,
    fees: [
      {
        id: 'fuel',
        amount: money(c.fuel, CURRENCIES.get(c.currency)),
        hostShare: ratio(1n, 1n),
        proven: true,
        notifiedAt: new Date(DECISION.getTime() - 69 * H),
        disputed: false,
      },
    ],
    caps: { capabilities: caps },
  });
}

describe.each(CASES)('$country ($currency) — exécution sur le FAKE', (c) => {
  it('pose : pré-autorisation MANUAL du montant explicite, sur PLATFORM (compte marchand de Kmino), aucun mouvement', async () => {
    const s = setup(c);
    await authorized(c, s);
    const [auth] = s.stack.psp.transactions();
    expect([auth?.captureMode, auth?.status, auth?.amountMinor, auth?.legs?.PLATFORM]).toEqual([
      'MANUAL',
      'AUTHORIZED',
      c.deposit,
      c.deposit,
    ]);
    expect(s.stack.psp.movements()).toEqual([]);
  });

  it('T57 : capture des frais (jambe HOST, montant explicite) puis VOID du reste ; rejeu sans second mouvement', async () => {
    const s = setup(c);
    const reference = await authorized(c, s);
    const p = plan(c, new CapabilitySet(s.stack.capabilities));
    const target = { providerReference: reference, instrumentToken: 'tok_card', attemptNo: 1 };
    const run = await s.executor.execute(s.ref, p, target);
    expect(run.failed).toBeNull();
    expect(run.completed.map((r) => [r.step.op, r.result?.status])).toEqual([
      ['CAPTURE', 'SUCCEEDED'],
      ['VOID', 'SUCCEEDED'],
    ]);
    expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor, m.legs?.HOST])).toEqual([
      ['CAPTURE', c.fuel, c.fuel],
    ]);
    // même tentative rejouée : clés identiques, aucun nouveau mouvement
    await s.executor.execute(s.ref, p, target);
    expect(s.stack.psp.movements()).toHaveLength(1);
  });

  it('T58 (critère 5) : sans capture partielle ⇒ VOID de la caution entière puis débit MIT des frais', async () => {
    // capacité bloquante de la place de marché (17 §2.8) : validée pour le compte (`*`), absente
    // pour la carte (moyen de la caution) — le cas de T58 pour ce moyen
    const s = setup(c, {
      override: [
        {
          capability: 'SUPPORTS_PARTIAL_CAPTURE',
          method: '*',
          value: true,
          status: 'VALIDATED_SANDBOX',
        },
        {
          capability: 'SUPPORTS_PARTIAL_CAPTURE',
          method: 'CARD',
          value: false,
          status: 'VALIDATED_SANDBOX',
        },
      ],
    });
    const reference = await authorized(c, s);
    const p = plan(c, new CapabilitySet(s.stack.capabilities));
    const run = await s.executor.execute(s.ref, p, {
      providerReference: reference,
      instrumentToken: 'tok_card',
      attemptNo: 1,
    });
    expect(run.failed).toBeNull();
    expect(run.completed.map((r) => r.step.op)).toEqual(['VOID', 'MIT_CHARGE']);
    expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor, m.legs?.HOST])).toEqual([
      ['MIT_CHARGE', c.fuel, c.fuel],
    ]);
  });

  it('critère 3 : ré-autorisation acceptée ; refusée ⇒ trip signalé à l’ops, AUCUN débit', async () => {
    const ok = setup(c);
    const r1 = await authorized(c, ok);
    expect((await ok.executor.reauthorize(ok.ref, r1, 1, 1)).kind).toBe('REAUTHORIZED');

    const refused = setup(c, {
      scenario: { responses: { REAUTHORIZE: [{ kind: 'DECLINE', code: 'do_not_honor' }] } },
    });
    const r2 = await authorized(c, refused);
    expect(await refused.executor.reauthorize(refused.ref, r2, 1, 1)).toEqual({
      kind: 'REAUTH_REFUSED',
      opsSignal: 'DEPOSIT_REAUTH_FAILED',
      reason: 'DECLINED',
    });
    expect(refused.stack.psp.calls('MIT_CHARGE')).toBe(0);
    expect(refused.stack.psp.movements()).toEqual([]);

    // capacité non validée : refus sans appel au PSP, même signal, aucun débit
    const unvalidated = setup(c, { without: ['SUPPORTS_REAUTH'] });
    const r3 = await authorized(c, unvalidated);
    expect(await unvalidated.executor.reauthorize(unvalidated.ref, r3, 1, 1)).toMatchObject({
      kind: 'REAUTH_REFUSED',
      reason: 'UNSUPPORTED_CAPABILITY',
    });
    expect(unvalidated.stack.psp.calls('REAUTHORIZE')).toBe(0);
  });

  it('critère 4 / 17 §0.1 : « débit puis remboursement » refusé SANS appel tant que funds_holding_enabled = false', async () => {
    const s = setup(c);
    const refused = await s.executor
      .place(s.ref, {
        mechanism: 'CHARGE_THEN_REFUND',
        amountMinor: c.deposit,
        fundsHoldingEnabled: false,
        attemptNo: 1,
      })
      .catch((e: unknown) => e);
    expect(isPaymentError(refused, 'INVALID_REQUEST')).toBe(true);
    expect(s.stack.psp.totalCalls()).toBe(0);
  });

  it('sans pré-autorisation validée : la pose est refusée sans appel (capacité inconnue = non)', async () => {
    const s = setup(c, { without: ['SUPPORTS_PREAUTH'] });
    const refused = await s.executor
      .place(s.ref, {
        mechanism: 'PREAUTH_SINGLE',
        amountMinor: c.deposit,
        fundsHoldingEnabled: false,
        attemptNo: 1,
      })
      .catch((e: unknown) => e);
    expect(isPaymentError(refused, 'UNSUPPORTED_CAPABILITY')).toBe(true);
    expect(s.stack.psp.calls('CREATE_ORDER')).toBe(0);
  });
});

/**
 * Port FAKE dont la capture rend un statut imposé (revues argent, code, qa de la PR 236) : tous les
 * autres appels passent au PSP simulé.
 */
function captureReturning(
  s: ReturnType<typeof setup>,
  status: OperationStatus,
): DepositRailExecutor {
  const p = s.stack.provider;
  const port: DepositPaymentProvider = {
    capabilities: () => p.capabilities(),
    createHostedPayment: (r) => p.createHostedPayment(r),
    capture: (r) => Promise.resolve({ providerReference: r.providerReference, status }),
    void: (r) => p.void(r),
    refund: (r) => p.refund(r),
    chargeMIT: (r) => p.chargeMIT(r),
    reauthorize: (r) => p.reauthorize(r),
  };
  return new DepositRailExecutor(port);
}

describe.each(CASES)(
  '$country ($currency) — capture non aboutie : arrêt ou repli, jamais un VOID du reste',
  (c) => {
    const target = (providerReference: string) => ({
      providerReference,
      instrumentToken: 'tok_card',
      attemptNo: 1,
    });

    it('capture REFUSÉE (exception) ⇒ repli 08 E3 : VOID de la caution ENTIÈRE puis MIT du carburant (jambe HOST) ; rejeu sans second mouvement', async () => {
      const s = setup(c, {
        scenario: { responses: { CAPTURE: [{ kind: 'DECLINE', code: 'do_not_honor' }] } },
      });
      const reference = await authorized(c, s);
      const p = plan(c, new CapabilitySet(s.stack.capabilities));
      const run = await s.executor.execute(s.ref, p, target(reference));
      expect(run.failed).toBeNull();
      expect(run.fallback?.steps.map((x) => x.op)).toEqual(['VOID', 'MIT_CHARGE']);
      expect(run.fallback?.releasedMinor).toBe(c.deposit);
      expect(run.completed.map((r) => r.step.op)).toEqual(['VOID', 'MIT_CHARGE']);
      const moves = () =>
        s.stack.psp.movements().map((m) => [m.operation, m.amountMinor, m.legs?.HOST]);
      expect(moves()).toEqual([['MIT_CHARGE', c.fuel, c.fuel]]);
      // rejeu de la même tentative : mêmes clés ⇒ aucun nouveau mouvement
      const again = await s.executor.execute(s.ref, p, target(reference));
      expect(again.failed).toBeNull();
      expect(moves()).toEqual([['MIT_CHARGE', c.fuel, c.fuel]]);
    });

    it('capture rendue FAILED (statut) ⇒ même repli, aucun VOID partiel du reste', async () => {
      const s = setup(c);
      const reference = await authorized(c, s);
      const p = plan(c, new CapabilitySet(s.stack.capabilities));
      const run = await captureReturning(s, 'FAILED').execute(s.ref, p, target(reference));
      expect(run.failed).toBeNull();
      expect(run.completed.map((r) => r.step.op)).toEqual(['VOID', 'MIT_CHARGE']);
      expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor])).toEqual([
        ['MIT_CHARGE', c.fuel],
      ]);
    });

    it.each(['PENDING', 'SUBMITTED', 'UNKNOWN'] as const)(
      'capture rendue %s ⇒ arrêt : ni VOID ni MIT, lecture de l’état exigée avant tout rejeu',
      async (status) => {
        const s = setup(c);
        const reference = await authorized(c, s);
        const p = plan(c, new CapabilitySet(s.stack.capabilities));
        const run = await captureReturning(s, status).execute(s.ref, p, target(reference));
        expect(run.failed).toMatchObject({ status, needsLookup: true, error: null });
        expect(run.failed?.step.op).toBe('CAPTURE');
        expect(run.completed).toEqual([]);
        expect(run.fallback).toBeNull();
        expect([s.stack.psp.calls('VOID'), s.stack.psp.calls('MIT_CHARGE')]).toEqual([0, 0]);
        expect(s.stack.psp.movements()).toEqual([]);
      },
    );

    it('capture en issue inconnue (réponse perdue après succès) ⇒ arrêt sans VOID ; rejeu avec les mêmes clés ⇒ une seule capture, puis VOID du reste', async () => {
      const s = setup(c, {
        scenario: { responses: { CAPTURE: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
      });
      const reference = await authorized(c, s);
      const p = plan(c, new CapabilitySet(s.stack.capabilities));
      const run = await s.executor.execute(s.ref, p, target(reference));
      expect(run.failed?.needsLookup).toBe(true);
      expect(isPaymentError(run.failed?.error, 'UNKNOWN_OUTCOME')).toBe(true);
      expect(s.stack.psp.calls('VOID')).toBe(0);
      const again = await s.executor.execute(s.ref, p, target(reference));
      expect(again.failed).toBeNull();
      expect(again.completed.map((r) => r.step.op)).toEqual(['CAPTURE', 'VOID']);
      expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor])).toEqual([
        ['CAPTURE', c.fuel],
      ]);
    });
  },
);
