/**
 * US-224 — ordres d'un règlement (08 E7 règles 1, 3 et 10) rejoués sur l'export des oracles
 * (`docs/specs/tools/check_legs.py` : `cascade`, `e2_refunds`) : TJ02b + TJ16a, TJ16b (USD, T03 payé
 * comme T33 : carte 150,00 et Yappy 37,44), TJ08b + TJ16c, TJ16d (PYG, carte 1 000 000 et crédit cash
 * recréé 367), TJ10b (PYG, une carte) et TJ10c (prorata, jamais produit). Attendus : export des
 * oracles ; pour TJ05b (réaffectation), 08 E7 règle 3 : « 18,53 pris sur HOST, puis remboursement
 * de 112,72 sur HOST et 25,50 sur INSURER ». Aucun attendu n'est calculé par le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  legVector,
  loadGoldenVectors,
  type GoldenLegVector,
} from '../../src/golden-vectors/index.ts';
import {
  isSettlementError,
  money,
  settlementOrders,
  type Currency,
  type Legs,
  type Tender,
} from '../../src/index.ts';
import { PYG, USD } from '../fixtures.ts';

const set = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;

const legsOf = (v: GoldenLegVector, currency: Currency, sign = 1n): Legs =>
  Object.freeze({
    HOST: money(sign * v.legsMinor.HOST, currency),
    INSURER: money(sign * v.legsMinor.INSURER, currency),
    TAX_THIRD_PARTY: money(sign * v.legsMinor.TAX_THIRD_PARTY, currency),
    PLATFORM: money(sign * v.legsMinor.PLATFORM, currency),
    total: money(sign * v.totalMinor, currency),
  });

const minor = (l: Legs): Record<string, bigint> =>
  Object.fromEntries([...LEGS, 'total' as const].map((k) => [k, l[k].amountMinor]));

const caught = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return isSettlementError(e) ? e.code : 'AUTRE';
  }
  return 'AUCUNE';
};

describe('08 E7 règle 10 — remboursement réparti entre moyens (TJ16, USD et PYG)', () => {
  it('TJ02b ventilée en carte 150,00 puis Yappy 37,44 = TJ16a, TJ16b ; Σ = TJ02b jambe par jambe', () => {
    const variation = legsOf(legVector(set, 'TJ02b'), USD);
    const a = legVector(set, 'TJ16a');
    const b = legVector(set, 'TJ16b');
    // E2 (T33) : 150,00 sur la carte, 37,44 sur Yappy ; ordre volontairement inversé
    const tenders: Tender[] = [
      { kind: 'NON_NATIVE', amount: money(-b.totalMinor, USD) },
      { kind: 'NATIVE', amount: money(-a.totalMinor, USD) },
    ];
    const orders = settlementOrders(variation, tenders);
    expect(orders.reallocation).toBeNull();
    expect(orders.refunds.map((r) => r.kind)).toEqual(['NATIVE', 'NON_NATIVE']);
    // jambes des ordres = débits (positifs) ; l'export donne les variations (négatives)
    expect(minor(orders.refunds[0]!.legs)).toEqual(minor(legsOf(a, USD, -1n)));
    expect(minor(orders.refunds[1]!.legs)).toEqual(minor(legsOf(b, USD, -1n)));
  });

  it('TJ08b ventilée en carte 1 000 000 puis crédit cash 367 = TJ16c, TJ16d ; le crédit ne touche que PLATFORM', () => {
    const variation = legsOf(legVector(set, 'TJ08b'), PYG);
    const c = legVector(set, 'TJ16c');
    const d = legVector(set, 'TJ16d');
    const orders = settlementOrders(variation, [
      { kind: 'NATIVE', amount: money(-c.totalMinor, PYG) },
      { kind: 'CASH_CREDIT', amount: money(-d.totalMinor, PYG) },
    ]);
    expect(minor(orders.refunds[0]!.legs)).toEqual(minor(legsOf(c, PYG, -1n)));
    expect(minor(orders.refunds[1]!.legs)).toEqual(minor(legsOf(d, PYG, -1n)));
    expect(orders.refunds[1]!.legs.HOST.amountMinor).toBe(0n);
  });

  it('TJ10b (PYG, une carte) : l’ordre porte exactement TJ10b, jamais le prorata TJ10c', () => {
    const tj10b = legVector(set, 'TJ10b');
    const tj10c = legVector(set, 'TJ10c');
    const orders = settlementOrders(legsOf(tj10b, PYG), [
      { kind: 'NATIVE', amount: money(-tj10b.totalMinor, PYG) },
    ]);
    expect(minor(orders.refunds[0]!.legs)).toEqual(minor(legsOf(tj10b, PYG, -1n)));
    expect(minor(orders.refunds[0]!.legs)).not.toEqual(minor(legsOf(tj10c, PYG, -1n)));
    // même total, jambes différentes : 68 535 PYG d'écart sur HOST (08 E7 règle 1)
    expect(tj10c.legsMinor.HOST - tj10b.legsMinor.HOST).toBe(-68_535n);
  });
});

describe('08 E7 règle 3 — réaffectation passée avant le remboursement (TJ05b, USD)', () => {
  it('18,53 pris sur HOST vers PLATFORM, puis remboursement de 112,72 sur HOST et 25,50 sur INSURER', () => {
    const tj05b = legVector(set, 'TJ05b');
    const orders = settlementOrders(legsOf(tj05b, USD), [
      { kind: 'NATIVE', amount: money(-tj05b.totalMinor, USD) },
    ]);
    // attendus : texte de 08 E7 règle 3 (TJ05b)
    expect(minor(orders.reallocation!)).toEqual({
      HOST: -1853n,
      INSURER: 0n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: 1853n,
      total: 0n,
    });
    expect(minor(orders.refunds[0]!.legs)).toEqual({
      HOST: 11272n,
      INSURER: 2550n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: 0n,
      total: 13822n,
    });
  });
});

describe('refus (fail-closed, aucun prorata)', () => {
  const tj02b = legVector(set, 'TJ02b');
  const variation = legsOf(tj02b, USD);

  it('Σ remboursements ≠ remboursement du règlement ⇒ SETTLEMENT_INPUT_INVALID', () => {
    expect(
      caught(() =>
        settlementOrders(variation, [
          { kind: 'NATIVE', amount: money(-tj02b.totalMinor + 1n, USD) },
        ]),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
  });

  it('moyen nul, devise différente, crédit au-delà de PLATFORM ⇒ SETTLEMENT_INPUT_INVALID', () => {
    expect(
      caught(() => settlementOrders(variation, [{ kind: 'NATIVE', amount: money(0n, USD) }])),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    expect(
      caught(() =>
        settlementOrders(variation, [{ kind: 'NATIVE', amount: money(-tj02b.totalMinor, PYG) }]),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    // tout le remboursement en crédit cash : il toucherait HOST (TJ20b : réaffectation, 224b)
    expect(
      caught(() =>
        settlementOrders(variation, [
          { kind: 'CASH_CREDIT', amount: money(-tj02b.totalMinor, USD) },
        ]),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
  });

  it('variation sans débit et un remboursement demandé ⇒ SETTLEMENT_INPUT_INVALID ; sans rien ⇒ aucun ordre', () => {
    const zero = legsOf(
      {
        ...tj02b,
        totalMinor: 0n,
        legsMinor: { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
      },
      USD,
    );
    expect(caught(() => settlementOrders(zero, [{ kind: 'NATIVE', amount: money(1n, USD) }]))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(settlementOrders(zero, [])).toEqual({ reallocation: null, refunds: [] });
  });

  it('variation positive plus grande que les jambes en baisse ⇒ SETTLEMENT_INPUT_INVALID', () => {
    const bad: Legs = Object.freeze({
      HOST: money(-1n, USD),
      INSURER: money(0n, USD),
      TAX_THIRD_PARTY: money(0n, USD),
      PLATFORM: money(2n, USD),
      total: money(1n, USD),
    });
    expect(caught(() => settlementOrders(bad, []))).toBe('SETTLEMENT_INPUT_INVALID');
  });
});
