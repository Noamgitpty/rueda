/**
 * US-222b — red team argent du lot 2, axe « adaptateur FAKE du port » (19 US-222 critère 2,
 * scénarios 2 « jambe négative », 3 « somme des jambes falsifiée », 7 « ventilation au prorata » ;
 * pré-mortem L2 : RT-L2-M03, M04 ; risques L2-PM-04, L2-PM-06). Rapport :
 * docs/team/redteam/L2-argent.md.
 *
 * Contrôles purs de l'adaptateur FAKE (même contrat qu'un connecteur réel, 17 §2.8, port.ts) au-dessus
 * du PSP simulé de @rueda/fake-adapters, SANS base de données (`test:unit` de l'API, donc sans
 * assertion L0-05, comme redteam-l1-uploads.test.ts) : un ordre aux jambes négatives ou dont la
 * somme est fausse, ou envoyé à un PSP qui ne prend pas le montant par jambe (capacité inconnue =
 * non), est refusé AVANT tout appel au PSP ; seul l'ordre aux montants explicites part, et le PSP
 * simulé garde exactement ces jambes (jamais un prorata, TJ10b contre TJ10c). Les scènes avec la
 * base et les vrais services sont dans apps/api/test/int/redteam-l2-argent-*.int.test.ts. Placé
 * dans le module PAY (dossier `testing/redteam/`, hors de l'image de production) pour respecter
 * `rueda/module-boundaries`. Montants : export des oracles (`@rueda/money/golden-vectors`).
 */
import { randomUUID } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { LegAmounts } from '../../internal/legs.js';
import { fakeStack } from '../fake-stack.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const legsOf = (id: string): LegAmounts => ({ ...legVector(golden, id).legsMinor });
const total = (l: LegAmounts): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const neg = (l: LegAmounts): LegAmounts =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as LegAmounts;
const codeOf = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
};

/** Capture par devise : TJ01 (USD) et TJ08a (PYG) ; remboursement du règlement : TJ02b / TJ08b. */
const CASES = [
  { capture: 'TJ01', variation: 'TJ02b' },
  { capture: 'TJ08a', variation: 'TJ08b' },
  { capture: 'TJ10a', variation: 'TJ10b', prorata: 'TJ10c' },
] as const;

describe.each(CASES)('RT-L2-ARG — adaptateur FAKE du port ($capture)', (v) => {
  const capture = legsOf(v.capture);
  const currency = legVector(golden, v.capture).currency;
  const refund = neg(legsOf(v.variation));

  it('S2 / S3 : jambe négative ou Σ jambes ≠ montant ⇒ LEG_AMOUNT_NEGATIVE / LEG_SUM_MISMATCH avant tout appel (paiement hébergé, capture, remboursement)', async () => {
    const { provider, psp } = fakeStack();
    const before = psp.transactions().length;
    const negative = { ...capture, HOST: -1n, PLATFORM: capture.PLATFORM + capture.HOST + 1n };
    const inflated = { ...capture, HOST: capture.HOST + 1n };
    const key = (): string => `rt-l2-${randomUUID()}`;
    for (const [legs, code] of [
      [negative, 'LEG_AMOUNT_NEGATIVE'],
      [inflated, 'LEG_SUM_MISMATCH'],
    ] as const) {
      expect(
        await codeOf(() =>
          provider.createHostedPayment({
            idempotencyKey: key(),
            amountMinor: total(capture),
            currency,
            legs,
            method: 'CARD',
            capture: 'AUTO',
          }),
        ),
      ).toBe(code);
      expect(
        await codeOf(() =>
          provider.capture({
            idempotencyKey: key(),
            providerReference: 'ref-rt-l2',
            amountMinor: total(capture),
            currency,
            legs,
          }),
        ),
      ).toBe(code);
      expect(
        await codeOf(() =>
          provider.refund({
            idempotencyKey: key(),
            providerReference: 'ref-rt-l2',
            amountMinor: total(capture),
            currency,
            legs,
          }),
        ),
      ).toBe(code);
    }
    expect(psp.transactions().length).toBe(before);
  });

  it('S7 : PSP sans montant par jambe (SUPPORTS_PER_LEG_AMOUNTS absente ou seulement documentée) ⇒ paiement HOST_PAYOUT_RAIL_UNAVAILABLE, capture et remboursement UNSUPPORTED_CAPABILITY, avant tout appel : jamais un ordre que le PSP ventilerait au prorata', async () => {
    for (const options of [
      { without: ['SUPPORTS_PER_LEG_AMOUNTS'] },
      {
        override: [
          {
            capability: 'SUPPORTS_PER_LEG_AMOUNTS',
            method: '*',
            value: true,
            status: 'DOCUMENTED' as const,
          },
        ],
      },
    ]) {
      const { provider, psp } = fakeStack(options);
      const before = psp.transactions().length;
      expect(
        await codeOf(() =>
          provider.createHostedPayment({
            idempotencyKey: `rt-l2-${randomUUID()}`,
            amountMinor: total(capture),
            currency,
            legs: capture,
            method: 'CARD',
            capture: 'AUTO',
          }),
        ),
      ).toBe('HOST_PAYOUT_RAIL_UNAVAILABLE');
      expect(
        await codeOf(() =>
          provider.refund({
            idempotencyKey: `rt-l2-${randomUUID()}`,
            providerReference: 'ref-rt-l2',
            amountMinor: total(refund),
            currency,
            legs: refund,
          }),
        ),
      ).toBe('UNSUPPORTED_CAPABILITY');
      expect(psp.transactions().length).toBe(before);
    }
  });

  it('S7 : PSP complet : l’ordre de paiement porte et le PSP garde le montant EXPLICITE de chaque jambe de la capture ; le contre-exemple au prorata de l’oracle (TJ10c) a la même somme que TJ10b mais d’autres jambes (le remboursement explicite est prouvé en base, redteam-l2-argent-annulations)', async () => {
    const { provider, psp } = fakeStack();
    const paid = await provider.createHostedPayment({
      idempotencyKey: `rt-l2-${randomUUID()}`,
      amountMinor: total(capture),
      currency,
      legs: capture,
      method: 'CARD',
      capture: 'AUTO',
    });
    const order = psp.transactions().find((t) => t.reference === paid.providerReference);
    expect(order).toBeDefined();
    expect({ ...order!.legs }).toEqual(capture);
    if ('prorata' in v) {
      const prorata = neg(legsOf(v.prorata));
      expect(total(prorata)).toBe(total(refund));
      expect(prorata).not.toEqual(refund);
    }
  });
});
