/**
 * Jambes explicites (08 E7 règles 1, 3, 5 ; 17 §2.8) : tous les vecteurs TJ de l'export des
 * oracles, dans leurs deux devises. Les attendus viennent de `@rueda/money/golden-vectors`.
 */
import { legVectors, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { PaymentError } from './errors.js';
import {
  assertMovingLegs,
  assertReallocationLegs,
  debitFromVariation,
  legsEqual,
  legsToJson,
  legSum,
} from './legs.js';
import type { LegAmounts } from './legs.js';

const set = loadGoldenVectors();
const legsOf = (v: GoldenLegVector): LegAmounts => ({ ...v.legsMinor });
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof PaymentError ? error.code : String(error);
  }
  return 'OK';
};

const allocations = legVectors(set, { kind: 'ALLOCATION' });
const variations = legVectors(set, { kind: 'VARIATION' });

describe('jambes d’un ordre qui déplace des fonds', () => {
  it('les deux devises sont couvertes', () => {
    expect(new Set(allocations.map((v) => v.currency)).size).toBeGreaterThanOrEqual(2);
  });

  it.each(allocations.map((v) => [v.id, v] as const))(
    '%s : Σ jambes = montant, chaque jambe ≥ 0 ⇒ accepté',
    (_id, v) => {
      expect(legSum(legsOf(v))).toBe(v.totalMinor);
      expect(() => assertMovingLegs(v.totalMinor, legsOf(v))).not.toThrow();
    },
  );

  it.each(allocations.filter((v) => v.totalMinor > 1n).map((v) => [v.id, v] as const))(
    '%s : une unité de trop ou de moins ⇒ LEG_SUM_MISMATCH',
    (_id, v) => {
      expect(code(() => assertMovingLegs(v.totalMinor + 1n, legsOf(v)))).toBe('LEG_SUM_MISMATCH');
      expect(code(() => assertMovingLegs(v.totalMinor - 1n, legsOf(v)))).toBe('LEG_SUM_MISMATCH');
    },
  );

  it.each(legVectors(set, { kind: 'REFUSED_CAPTURE' }).map((v) => [v.id, v] as const))(
    '%s : capture refusée (PLATFORM < 0) ⇒ LEG_AMOUNT_NEGATIVE (08 E7 règle 5)',
    (_id, v) => {
      expect(v.legsMinor.PLATFORM < 0n).toBe(true);
      expect(code(() => assertMovingLegs(v.totalMinor, legsOf(v)))).toBe('LEG_AMOUNT_NEGATIVE');
    },
  );

  it('montant nul ou non bigint, jambe manquante ou en trop ⇒ INVALID_REQUEST', () => {
    const v = allocations[0] as GoldenLegVector;
    expect(code(() => assertMovingLegs(0n, legsOf(v)))).toBe('INVALID_REQUEST');
    expect(code(() => assertMovingLegs(Number(v.totalMinor) as unknown as bigint, legsOf(v)))).toBe(
      'INVALID_REQUEST',
    );
    const missing: Partial<Record<keyof LegAmounts, bigint>> = { ...legsOf(v) };
    delete missing.HOST;
    expect(code(() => assertMovingLegs(v.totalMinor, missing as unknown as LegAmounts))).toBe(
      'INVALID_REQUEST',
    );
    expect(
      code(() =>
        assertMovingLegs(v.totalMinor, { ...legsOf(v), OTHER: 0n } as unknown as LegAmounts),
      ),
    ).toBe('INVALID_REQUEST');
    expect(
      code(() =>
        assertMovingLegs(v.totalMinor, {
          ...legsOf(v),
          HOST: Number(v.legsMinor.HOST),
        } as unknown as LegAmounts),
      ),
    ).toBe('INVALID_REQUEST');
  });
});

describe('variation de règlement ⇒ débit par jambe (08 E7 règle 3)', () => {
  const pure = variations.filter((v) => Object.values(v.legsMinor).every((x) => x <= 0n));
  it.each(pure.map((v) => [v.id, v] as const))(
    '%s : débit = − variation, Σ = remboursement',
    (_id, v) => {
      const debit = debitFromVariation(legsOf(v));
      expect(legSum(debit)).toBe(-v.totalMinor);
      expect(() => assertMovingLegs(-v.totalMinor, debit)).not.toThrow();
    },
  );

  it('TJ05b : variation positive (hôte inéligible) ⇒ réaffectation d’abord, puis remboursement', () => {
    const v = variations.find((x) => x.id === 'TJ05b') as GoldenLegVector;
    expect(code(() => debitFromVariation(legsOf(v)))).toBe('INVALID_REQUEST');
    const moved = v.legsMinor.PLATFORM;
    const reallocation = { HOST: -moved, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: moved };
    expect(assertReallocationLegs(reallocation)).toBe(moved);
    const rest = {
      HOST: v.legsMinor.HOST + moved,
      INSURER: v.legsMinor.INSURER,
      TAX_THIRD_PARTY: v.legsMinor.TAX_THIRD_PARTY,
      PLATFORM: 0n,
    };
    const debit = debitFromVariation(rest);
    expect(legSum(debit)).toBe(-v.totalMinor);
    expect(() => assertMovingLegs(-v.totalMinor, debit)).not.toThrow();
  });

  it('réaffectation : Σ ≠ 0 ⇒ LEG_SUM_MISMATCH ; vide ⇒ INVALID_REQUEST', () => {
    expect(
      code(() =>
        assertReallocationLegs({ HOST: -2n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 1n }),
      ),
    ).toBe('LEG_SUM_MISMATCH');
    expect(
      code(() =>
        assertReallocationLegs({ HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n }),
      ),
    ).toBe('INVALID_REQUEST');
  });

  it('TJ10c (prorata d’un PSP) ≠ TJ10b (cascade) à montant égal : les jambes, pas le total, distinguent', () => {
    const b = variations.find((x) => x.id === 'TJ10b') as GoldenLegVector;
    const c = variations.find((x) => x.id === 'TJ10c') as GoldenLegVector;
    expect(b.totalMinor).toBe(c.totalMinor);
    expect(legsEqual(legsOf(b), legsOf(c))).toBe(false);
  });
});

describe('forme JSON sans perte (paramètre p_legs des commandes SQL)', () => {
  it('montants en texte, au-delà de 2^53', () => {
    const big = 2n ** 60n;
    expect(legsToJson({ HOST: big, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 1n })).toEqual({
      HOST: big.toString(),
      INSURER: '0',
      TAX_THIRD_PARTY: '0',
      PLATFORM: '1',
    });
  });
});
