/**
 * Suite de contrat du port `PaymentProvider` (17 §12, ADR-038 : la MÊME suite tourne sur le FAKE
 * et, au lot C, sur le connecteur réel en bac à sable — US-601). TESTS SEULEMENT.
 *
 * Le harnais fournit l'adaptateur, la devise et des montants tirés des vecteurs dorés (jamais
 * calculés ici), et les gestes du client sur la page hébergée.
 */
import { describe, expect, it } from 'vitest';
import { isPaymentError } from '../internal/errors.js';
import type { PaymentErrorCode } from '../internal/errors.js';
import { LEGS } from '../internal/legs.js';
import type { Leg, LegAmounts } from '../internal/legs.js';
import { MONEY_MOVING_METHODS } from '../internal/port.js';
import type { MoneyMovingMethod, PaymentProvider } from '../internal/port.js';

export interface ContractAmounts {
  readonly amountMinor: bigint;
  readonly legs: LegAmounts;
}

export interface ContractWebhook {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ContractHarness {
  readonly provider: PaymentProvider;
  readonly currency: string;
  /** Capture totale (vecteur TJ d'allocation). */
  readonly capture: ContractAmounts;
  /** Remboursement partiel admissible sur cette capture (vecteur TJ). */
  readonly refund: ContractAmounts;
  readonly webhookSecret: Uint8Array;
  customerPays(providerReference: string): Promise<void>;
  /** Appels reçus par le PSP ; `null` si inobservable (connecteur réel). */
  pspCalls(): number | null;
  /** Webhooks émis depuis le dernier appel. */
  webhooks(): Promise<readonly ContractWebhook[]>;
}

async function expectCode(promise: Promise<unknown>, code: PaymentErrorCode): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isPaymentError(error), String(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`erreur ${code} attendue`);
}

/** Déplace une unité d'une jambe non nulle vers une autre (même total, jambes différentes). */
export function shiftOneUnit(legs: LegAmounts): LegAmounts {
  const from = LEGS.find((l) => legs[l] > 0n);
  if (from === undefined) throw new Error('jambes toutes nulles');
  const to: Leg = from === 'PLATFORM' ? 'HOST' : 'PLATFORM';
  return { ...legs, [from]: legs[from] - 1n, [to]: legs[to] + 1n };
}

/** Une unité de moins sur la plus grande jambe (total − 1, jambes toujours ≥ 0). */
export function minusOneUnit(a: ContractAmounts): ContractAmounts {
  const leg = [...LEGS].sort((x, y) => (a.legs[y] > a.legs[x] ? 1 : -1))[0] as Leg;
  return { amountMinor: a.amountMinor - 1n, legs: { ...a.legs, [leg]: a.legs[leg] - 1n } };
}

function requestFor(
  method: MoneyMovingMethod,
  h: ContractHarness,
  legs: LegAmounts,
  amountMinor: bigint,
): Promise<unknown> {
  const p = h.provider;
  const base = { idempotencyKey: `contract:${method}:a1`, currency: h.currency };
  switch (method) {
    case 'createHostedPayment':
      return p.createHostedPayment({ ...base, amountMinor, legs, method: 'CARD', capture: 'AUTO' });
    case 'capture':
      return p.capture({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'refund':
      return p.refund({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'rollback':
      return p.rollback({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'chargeMIT':
      return p.chargeMIT({
        ...base,
        amountMinor,
        legs,
        reason: 'DELAYED_CHARGES',
        instrumentToken: 'tok_contract',
      });
    case 'reallocate':
      return p.reallocate({ ...base, legs, providerReference: 'ref' });
  }
}

export function describePaymentProviderContract(name: string, make: () => ContractHarness): void {
  describe(`contrat PaymentProvider — ${name}`, () => {
    it.each([...MONEY_MOVING_METHODS])(
      '%s : Σ jambes ≠ montant ⇒ LEG_SUM_MISMATCH ; jambe négative ⇒ LEG_AMOUNT_NEGATIVE ; sans appel au PSP',
      async (method) => {
        const h = make();
        const before = h.pspCalls();
        const { amountMinor, legs } = h.capture;
        if (method === 'reallocate') {
          // réaffectation : Σ = 0 exigée (08 E7 règle 3)
          await expectCode(
            requestFor(
              method,
              h,
              { ...legs, HOST: -1n, PLATFORM: 2n, INSURER: 0n, TAX_THIRD_PARTY: 0n },
              0n,
            ),
            'LEG_SUM_MISMATCH',
          );
        } else {
          await expectCode(
            requestFor(method, h, { ...legs, PLATFORM: legs.PLATFORM + 1n }, amountMinor),
            'LEG_SUM_MISMATCH',
          );
          await expectCode(
            requestFor(
              method,
              h,
              { ...legs, HOST: -1n, PLATFORM: legs.PLATFORM + legs.HOST + 1n },
              amountMinor,
            ),
            'LEG_AMOUNT_NEGATIVE',
          );
        }
        expect(h.pspCalls()).toBe(before);
      },
    );

    it('paiement hébergé puis remboursement partiel ; état faisant foi par getOperation, jambes comprises', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      expect(order.redirectUrl).toMatch(/^https:\/\//);
      await h.customerPays(order.providerReference);
      const read = await h.provider.getOperation({ providerReference: order.providerReference });
      expect(read).toMatchObject({
        status: 'SUCCEEDED',
        amountMinor: h.capture.amountMinor,
        currency: h.currency,
      });
      if (read?.legs !== null && read?.legs !== undefined)
        expect(read.legs).toEqual(h.capture.legs);
      const refund = await h.provider.refund({
        idempotencyKey: 'contract:refund:i1:a1',
        currency: h.currency,
        providerReference: order.providerReference,
        ...h.refund,
      });
      expect(refund.status).toBe('SUCCEEDED');
    });

    it('rejeu de la même clé : même opération ; même clé et montant ou jambes différents ⇒ IDEMPOTENCY_CONFLICT', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      await h.customerPays(order.providerReference);
      const req = {
        idempotencyKey: 'contract:refund:i1:a1',
        currency: h.currency,
        providerReference: order.providerReference,
      };
      const first = await h.provider.refund({ ...req, ...h.refund });
      const replay = await h.provider.refund({ ...req, ...h.refund });
      expect(replay.providerReference).toBe(first.providerReference);
      await expectCode(
        h.provider.refund({ ...req, ...minusOneUnit(h.refund) }),
        'IDEMPOTENCY_CONFLICT',
      );
      await expectCode(
        h.provider.refund({
          ...req,
          amountMinor: h.refund.amountMinor,
          legs: shiftOneUnit(h.refund.legs),
        }),
        'IDEMPOTENCY_CONFLICT',
      );
    });

    it('webhook : signature valide ⇒ événement normalisé ; corps altéré ou mauvais secret ⇒ invalide', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      await h.customerPays(order.providerReference);
      const hooks = await h.webhooks();
      expect(hooks.length).toBeGreaterThan(0);
      for (const hook of hooks) {
        const ok = h.provider.verifyAndParseWebhook(hook.body, hook.headers, h.webhookSecret);
        expect(ok.signatureValid).toBe(true);
        expect(ok.events.map((e) => e.providerReference)).toEqual([order.providerReference]);
        const tampered = new Uint8Array([...hook.body, 0x20]);
        expect(
          h.provider.verifyAndParseWebhook(tampered, hook.headers, h.webhookSecret).signatureValid,
        ).toBe(false);
        expect(
          h.provider.verifyAndParseWebhook(
            hook.body,
            hook.headers,
            new TextEncoder().encode('autre'),
          ).signatureValid,
        ).toBe(false);
      }
    });
  });
}
