/**
 * US-224 (partie 224f, ADR-166) — remboursement réparti entre les moyens d'origine : 08 E2
 * (imputation incrémentale) puis 08 E7 règle 10 (cascade). Attendus, jamais calculés par le code
 * testé :
 * - T33 (08 E2) et `check_legs.py` `e2_refunds` : carte 150,00, Yappy 37,44, crédit cash 0, crédit
 *   promo 0 (CROSS « TJ16 remboursements par moyen = T33 ») ;
 * - TJ16c / TJ16d (08 E7, export des oracles) : D (PYG) payé par carte 1 000 000 + crédit cash
 *   438 050, règlement T27 : carte 1 000 000, crédit cash 367 (CROSS « TJ16c-d ») ;
 * - T66 (b) / TJ20a (08 E2, `e2_incremental`) : complément de 69,22 après TJ16a-b : carte 0, Yappy
 *   19,22, crédit cash 30,00, crédit promo 20,00 ;
 * - deux cartes (même catégorie) : `allocate` de `docs/specs/tools/check_t49plus.py` extraite telle
 *   quelle (la capture la plus récente absorbe d'abord) :
 *
 *     cd docs/specs && python -I -X utf8 -c "…exec de CAT et allocate de tools/check_t49plus.py…;
 *       allocate([('c1','external_native',1000000,1),('c2','external_native',438050,2)], 437683);
 *       allocate([('c1','external_native',1000000,2),('c2','external_native',438050,1)], 437683)"
 *     → {c2: 367, c1: 1000000} ; {c1: 562317, c2: 438050}
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
  refundsByTender,
  tenderRefundOrders,
  type Currency,
  type Legs,
  type PaidTender,
  type TenderKind,
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

const tender = (
  id: string,
  kind: TenderKind,
  paid: bigint,
  currency: Currency,
  capturedRank: number,
  committed = 0n,
): PaidTender => ({
  id,
  kind,
  paid: money(paid, currency),
  committed: money(committed, currency),
  capturedRank,
});

const amounts = (rs: readonly { id: string; amount: { amountMinor: bigint } }[]) =>
  rs.map((r) => [r.id, r.amount.amountMinor]);

const caught = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return isSettlementError(e) ? e.code : 'AUTRE';
  }
  return 'AUCUNE';
};

// T33 : carte 150,00, Yappy 56,66, crédit cash 30,00, crédit promo 20,00 (Σ 256,66 = TJ01)
const T33 = [
  tender('promo', 'PROMO_CREDIT', 2000n, USD, 4),
  tender('yappy', 'NON_NATIVE', 5666n, USD, 2),
  tender('card', 'NATIVE', 15000n, USD, 1),
  tender('cash', 'CASH_CREDIT', 3000n, USD, 3),
];

describe('08 E2 — combien chaque moyen rembourse (USD et PYG)', () => {
  it('T33 : 187,44 = carte 150,00, Yappy 37,44, crédit cash 0, crédit promo 0 ; ordre de la cascade', () => {
    expect(amounts(refundsByTender(money(18744n, USD), T33))).toEqual([
      ['card', 15000n],
      ['yappy', 3744n],
      ['cash', 0n],
      ['promo', 0n],
    ]);
  });

  it('TJ16c-d (PYG) : 1 000 367 = carte 1 000 000 et crédit cash 367 ; retenue 437 683 absorbée par le crédit cash d’abord', () => {
    const rs = refundsByTender(money(1000367n, PYG), [
      tender('cash', 'CASH_CREDIT', 438050n, PYG, 2),
      tender('card', 'NATIVE', 1000000n, PYG, 1),
    ]);
    expect(amounts(rs)).toEqual([
      ['card', 1000000n],
      ['cash', 367n],
    ]);
  });

  it('T66 (b) incrémental : après TJ16a-b (carte 150,00, Yappy 37,44 engagés), complément 69,22 = carte 0, Yappy 19,22, cash 30,00, promo 20,00', () => {
    const rs = refundsByTender(
      money(6922n, USD),
      T33.map((t) =>
        t.id === 'card'
          ? { ...t, committed: money(15000n, USD) }
          : t.id === 'yappy'
            ? { ...t, committed: money(3744n, USD) }
            : t,
      ),
    );
    expect(amounts(rs)).toEqual([
      ['card', 0n],
      ['yappy', 1922n],
      ['cash', 3000n],
      ['promo', 2000n],
    ]);
  });

  it('deux cartes : la capture la plus récente absorbe d’abord (oracle `allocate`)', () => {
    const recentSecond = refundsByTender(money(1000367n, PYG), [
      tender('c1', 'NATIVE', 1000000n, PYG, 1),
      tender('c2', 'NATIVE', 438050n, PYG, 2),
    ]);
    expect(amounts(recentSecond)).toEqual([
      ['c1', 1000000n],
      ['c2', 367n],
    ]);
    const recentFirst = refundsByTender(money(1000367n, PYG), [
      tender('c1', 'NATIVE', 1000000n, PYG, 2),
      tender('c2', 'NATIVE', 438050n, PYG, 1),
    ]);
    expect(amounts(recentFirst)).toEqual([
      ['c2', 438050n],
      ['c1', 562317n],
    ]);
  });
});

describe('08 E2 puis E7 règle 10 — ordres par moyen, jambes explicites (TJ16a à TJ16d)', () => {
  it('USD : TJ02b ⇒ carte = TJ16a, Yappy = TJ16b ; crédits absorbés, sans ordre ; Σ = TJ02b', () => {
    const o = tenderRefundOrders(legsOf(legVector(set, 'TJ02b'), USD), T33);
    expect(o.reallocation).toBeNull();
    expect(o.refunds.map((r) => [r.id, r.kind])).toEqual([
      ['card', 'NATIVE'],
      ['yappy', 'NON_NATIVE'],
    ]);
    expect(minor(o.refunds[0]!.legs)).toEqual(minor(legsOf(legVector(set, 'TJ16a'), USD, -1n)));
    expect(minor(o.refunds[1]!.legs)).toEqual(minor(legsOf(legVector(set, 'TJ16b'), USD, -1n)));
  });

  it('PYG : TJ08b ⇒ carte = TJ16c, crédit cash recréé = TJ16d (PLATFORM seulement) ; Σ = TJ08b à l’unité', () => {
    const o = tenderRefundOrders(legsOf(legVector(set, 'TJ08b'), PYG), [
      tender('cash', 'CASH_CREDIT', 438050n, PYG, 2),
      tender('card', 'NATIVE', 1000000n, PYG, 1),
    ]);
    expect(o.refunds.map((r) => [r.id, r.kind])).toEqual([
      ['card', 'NATIVE'],
      ['cash', 'CASH_CREDIT'],
    ]);
    const c = minor(o.refunds[0]!.legs);
    const d = minor(o.refunds[1]!.legs);
    expect(c).toEqual(minor(legsOf(legVector(set, 'TJ16c'), PYG, -1n)));
    expect(d).toEqual(minor(legsOf(legVector(set, 'TJ16d'), PYG, -1n)));
    const tj08b = minor(legsOf(legVector(set, 'TJ08b'), PYG, -1n));
    for (const k of [...LEGS, 'total'] as const) expect(c[k]! + d[k]!).toBe(tj08b[k]);
  });
});

describe('refus (fail-closed : jamais un moyen remboursé au-delà de son reliquat, jamais un prorata)', () => {
  it('remboursement au-delà de Σ reliquats ⇒ REFUND_OUT_OF_RANGE', () => {
    expect(caught(() => refundsByTender(money(25667n, USD), T33))).toBe('REFUND_OUT_OF_RANGE');
    const committed = T33.map((t) => ({ ...t, committed: t.paid }));
    expect(caught(() => refundsByTender(money(1n, USD), committed))).toBe('REFUND_OUT_OF_RANGE');
  });

  it('entrée incohérente ⇒ SETTLEMENT_INPUT_INVALID', () => {
    const card = tender('card', 'NATIVE', 15000n, USD, 1);
    for (const tenders of [
      [card, { ...card, capturedRank: 2 }], // moyen en double
      [card, tender('other', 'NATIVE', 100n, USD, 1)], // rang en double
      [tender('pyg', 'NATIVE', 100n, PYG, 1)], // devise différente
      [tender('zero', 'NATIVE', 0n, USD, 1)], // payé nul
      [{ ...card, committed: money(-1n, USD) }], // engagé négatif
      [{ ...card, kind: 'GIFT' as TenderKind }], // catégorie inconnue
    ]) {
      expect(caught(() => refundsByTender(money(100n, USD), tenders))).toBe(
        'SETTLEMENT_INPUT_INVALID',
      );
    }
    expect(caught(() => refundsByTender(money(-1n, USD), [card]))).toBe('SETTLEMENT_INPUT_INVALID');
    const positive = legsOf(legVector(set, 'TJ02b'), USD, -1n);
    expect(caught(() => tenderRefundOrders(positive, T33))).toBe('SETTLEMENT_INPUT_INVALID');
  });
});
