/**
 * Adaptateur FAKE du port (US-019) : suite de contrat dans chaque devise des vecteurs (USD à
 * 2 décimales, PYG sans décimale ; CLAUDE.md contrainte 3) et mode hostile scriptable par un test
 * (19 US-019, critère 4). Montants : vecteurs TJ de `@rueda/money/golden-vectors` (jamais calculés).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { FakeForbiddenError } from '@rueda/fake-adapters';
import { isPaymentError } from '../internal/errors.js';
import type { PaymentErrorCode } from '../internal/errors.js';
import { debitFromVariation } from '../internal/legs.js';
import type { LegAmounts } from '../internal/legs.js';
import { describePaymentProviderContract } from './contract.js';
import { FakePaymentProvider } from './fake-payment-provider.js';
import { FAKE_T0, FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';

const set = loadGoldenVectors();
const legsOf = (v: GoldenLegVector): LegAmounts => ({ ...v.legsMinor });

/** Capture totale et remboursement (variation de règlement) d'un même trip, par devise. */
const PAIRS = [
  { capture: legVector(set, 'TJ01'), variation: legVector(set, 'TJ02b') },
  { capture: legVector(set, 'TJ08a'), variation: legVector(set, 'TJ08b') },
];

function harness(pair: (typeof PAIRS)[number], options: FakeStackOptions = {}) {
  const stack = fakeStack(options);
  const refundLegs = debitFromVariation(legsOf(pair.variation));
  return {
    stack,
    harness: {
      provider: stack.provider,
      currency: pair.capture.currency,
      capture: { amountMinor: pair.capture.totalMinor, legs: legsOf(pair.capture) },
      refund: { amountMinor: -pair.variation.totalMinor, legs: refundLegs },
      webhookSecret: new TextEncoder().encode(FAKE_WEBHOOK_SECRET),
      customerPays: (ref: string) => {
        stack.psp.customerPays(ref);
        return Promise.resolve();
      },
      pspCalls: () => stack.psp.totalCalls(),
      webhooks: () =>
        Promise.resolve(
          stack.psp
            .deliverWebhooks()
            .map((d) => ({ body: new TextEncoder().encode(d.body), headers: d.headers })),
        ),
    },
  };
}

for (const pair of PAIRS) {
  describePaymentProviderContract(
    `FAKE (${pair.capture.currency}, ${pair.capture.id})`,
    () => harness(pair).harness,
  );
}

async function expectCode(promise: Promise<unknown>, code: PaymentErrorCode) {
  try {
    await promise;
  } catch (error) {
    expect(isPaymentError(error), String(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return error as { details: Record<string, unknown> };
  }
  throw new Error(`erreur ${code} attendue`);
}

describe.each(PAIRS)('FAKE hostile — $capture.currency', (pair) => {
  const capture = { amountMinor: pair.capture.totalMinor, legs: legsOf(pair.capture) };
  const currency = pair.capture.currency;

  it('garde C19 : l’adaptateur refuse de se construire en production', () => {
    const { stack } = harness(pair);
    expect(
      () => new FakePaymentProvider(stack.psp, stack.capabilities, { RUEDA_ENV: 'production' }),
    ).toThrow(FakeForbiddenError);
    expect(() => new FakePaymentProvider(stack.psp, stack.capabilities, {})).toThrow(
      FakeForbiddenError,
    );
  });

  it('délai dépassé après succès ⇒ UNKNOWN_OUTCOME ; getOperation par notre clé lève l’incertitude', async () => {
    const { stack } = harness(pair, {
      scenario: { responses: { CREATE_ORDER: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    const req = {
      idempotencyKey: 'hold:h1:CAPTURE:a1',
      currency,
      method: 'CARD' as const,
      capture: 'AUTO' as const,
      ...capture,
    };
    await expectCode(stack.provider.createHostedPayment(req), 'UNKNOWN_OUTCOME');
    const read = await stack.provider.getOperation({ merchantReference: req.idempotencyKey });
    expect(read).toMatchObject({
      status: 'SUBMITTED',
      amountMinor: capture.amountMinor,
      legs: capture.legs,
    });
  });

  it('réponse inconnue (illisible) ⇒ UNKNOWN_OUTCOME ; panne avant envoi ⇒ PROVIDER_UNAVAILABLE', async () => {
    const { stack } = harness(pair, {
      scenario: {
        responses: { MIT_CHARGE: [{ kind: 'UNREADABLE_AFTER_SUCCESS' }, { kind: 'UNAVAILABLE' }] },
      },
    });
    const req = {
      idempotencyKey: 'A:1:v1:MIT_CHARGE:card:i1:a1',
      currency,
      reason: 'DELAYED_CHARGES' as const,
      instrumentToken: 'tok_1',
      ...capture,
    };
    await expectCode(stack.provider.chargeMIT(req), 'UNKNOWN_OUTCOME');
    await expectCode(
      stack.provider.chargeMIT({ ...req, idempotencyKey: 'other:a1' }),
      'PROVIDER_UNAVAILABLE',
    );
    expect(stack.psp.movements()).toHaveLength(1);
  });

  it('capacité absente ou seulement DOCUMENTED ⇒ refus sans appel au PSP (bloquante : HOST_PAYOUT_RAIL_UNAVAILABLE, US-061)', async () => {
    const { stack } = harness(pair, {
      without: ['SUPPORTS_MIT'],
      override: [
        { capability: 'SUPPORTS_PER_LEG_AMOUNTS', method: '*', value: true, status: 'DOCUMENTED' },
      ],
    });
    const err = await expectCode(
      stack.provider.createHostedPayment({
        idempotencyKey: 'k',
        currency,
        method: 'CARD',
        capture: 'AUTO',
        ...capture,
      }),
      'HOST_PAYOUT_RAIL_UNAVAILABLE',
    );
    expect(err.details['missing']).toEqual(['SUPPORTS_MIT', 'SUPPORTS_PER_LEG_AMOUNTS']);
    expect(stack.psp.totalCalls()).toBe(0);
    const { stack: noMit } = harness(pair, { without: ['SUPPORTS_MIT'] });
    await expectCode(
      noMit.provider.chargeMIT({
        idempotencyKey: 'k',
        currency,
        reason: 'NO_SHOW',
        instrumentToken: 't',
        ...capture,
      }),
      'UNSUPPORTED_CAPABILITY',
    );
    expect(noMit.psp.totalCalls()).toBe(0);
  });

  it('ordre Yappy de 300 s : expiration rendue, paiement refusé après 300 s, webhook order.expired', async () => {
    const { stack } = harness(pair);
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: 'hold:h1:CAPTURE:a1',
      currency,
      method: 'YAPPY',
      capture: 'AUTO',
      ...capture,
    });
    expect(order.expiresAt?.getTime()).toBe(FAKE_T0 + 300_000);
    stack.clock.now = FAKE_T0 + 300_000;
    stack.psp.tick();
    expect(
      (await stack.provider.getOperation({ providerReference: order.providerReference }))?.status,
    ).toBe('FAILED');
    const types = stack.psp
      .deliverWebhooks()
      .map((d) => (JSON.parse(d.body) as { type: string }).type);
    expect(types).toEqual(['order.created', 'order.expired']);
  });

  it('pré-autorisation : capture partielle aux jambes réglées (08 E7 règle 2), VOID du reste interdit après capture', async () => {
    const retained =
      pair.capture.currency === legVector(set, 'TJ03').currency ? legVector(set, 'TJ03') : null;
    const { stack } = harness(pair);
    const auth = await stack.provider.createHostedPayment({
      idempotencyKey: 'hold:h1:AUTH:a1',
      currency,
      method: 'CARD',
      capture: 'MANUAL',
      ...capture,
    });
    stack.psp.customerPays(auth.providerReference);
    if (retained !== null) {
      // TJ03 : la capture de `owed` porte directement les jambes retenues
      const cap = await stack.provider.capture({
        idempotencyKey: 'A:1:v1:CAPTURE:card:i1:a1',
        currency,
        providerReference: auth.providerReference,
        amountMinor: retained.totalMinor,
        legs: legsOf(retained),
      });
      expect(cap.status).toBe('SUCCEEDED');
      await expectCode(
        stack.provider.void({
          idempotencyKey: 'A:1:v1:VOID:card:i1:a1',
          providerReference: auth.providerReference,
        }),
        'INVALID_REQUEST',
      );
    } else {
      const voided = await stack.provider.void({
        idempotencyKey: 'v',
        providerReference: auth.providerReference,
      });
      expect(voided.status).toBe('SUCCEEDED');
    }
  });

  it('réaffectation (TJ05b) : part de l’hôte inéligible passée à PLATFORM avant le remboursement', async () => {
    const tj05b = legVector(set, 'TJ05b');
    const tj01 = legVector(set, 'TJ01');
    if (pair.capture.currency !== tj05b.currency) return; // vecteur publié dans une seule devise
    const { stack } = harness(pair);
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: 'hold:h1:CAPTURE:a1',
      currency,
      method: 'CARD',
      capture: 'AUTO',
      amountMinor: tj01.totalMinor,
      legs: legsOf(tj01),
    });
    stack.psp.customerPays(order.providerReference);
    // 08 E7 règle 3 : la variation positive de PLATFORM est prise sur HOST (jambe en baisse)
    const moved = tj05b.legsMinor.PLATFORM;
    const reallocation = { HOST: -moved, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: moved };
    const res = await stack.provider.reallocate({
      idempotencyKey: 'A:1:v1:LEG_REALLOCATION:card:i1:a1',
      currency,
      providerReference: order.providerReference,
      legs: reallocation,
    });
    expect(res.status).toBe('SUCCEEDED');
    const refundLegs = {
      HOST: -(tj05b.legsMinor.HOST + moved),
      INSURER: -tj05b.legsMinor.INSURER,
      TAX_THIRD_PARTY: -tj05b.legsMinor.TAX_THIRD_PARTY,
      PLATFORM: 0n,
    };
    const refund = await stack.provider.refund({
      idempotencyKey: 'A:1:v1:REFUND:card:i1:a1',
      currency,
      providerReference: order.providerReference,
      amountMinor: -tj05b.totalMinor,
      legs: refundLegs,
    });
    expect(refund.status).toBe('SUCCEEDED');
  });

  it('cancelOrder : « déjà annulé » vaut succès ; « déjà payé » est un refus définitif', async () => {
    const { stack } = harness(pair, {
      scenario: {
        responses: { CANCEL_ORDER: [{ kind: 'ALREADY_CANCELLED' }, { kind: 'ALREADY_PAID' }] },
      },
    });
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: 'hold:h1:CAPTURE:a1',
      currency,
      method: 'CARD',
      capture: 'AUTO',
      ...capture,
    });
    const first = await stack.provider.cancelOrder({
      idempotencyKey: 'c1',
      providerReference: order.providerReference,
    });
    expect(first.status).toBe('SUCCEEDED');
    const err = await expectCode(
      stack.provider.cancelOrder({
        idempotencyKey: 'c2',
        providerReference: order.providerReference,
      }),
      'DECLINED',
    );
    expect(err.details).toMatchObject({ declineCode: 'ALREADY_PAID', doNotRetry: true });
  });
});
