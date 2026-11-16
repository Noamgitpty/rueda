/**
 * US-223 — ventilation des jambes entre plusieurs encaissements (08 E7 règle 10) rejouée sur les
 * vecteurs TJ15a à TJ15d et TJ21a, TJ21b de l'export des oracles (`check_legs.py`, `cascade`). Les
 * attendus viennent de l'export ; aucun n'est écrit ici, sauf la variante PYG ci-dessous, produite
 * par la MÊME fonction de l'oracle (`cascade` de check_legs.py extraite telle quelle) :
 *
 *   cd docs/specs && python -I -X utf8 -c "…exec de LEGS4 et cascade de tools/check_legs.py…;
 *     cascade(TJ09a, [1000000, 300000, 138052])"
 *   → {HOST 787501, INSURER 105000, TAX 0, PLATFORM 107499, TOTAL 1000000},
 *     {PLATFORM 300000, TOTAL 300000}, {PLATFORM 138052, TOTAL 138052}
 *
 * Encaissements de TJ15 (T33 de 08) : carte 150,00 (native), Yappy 56,66, crédit cash 30,00,
 * crédit promo 20,00 ; TJ21 : 120,00 de crédit cash demandés, plafonnés à PLATFORM de TJ01.
 */
import { describe, expect, it } from 'vitest';
import {
  compareLegs,
  legVector,
  loadGoldenVectors,
  type GoldenLegVector,
} from '../../src/golden-vectors/index.ts';
import {
  cascadeTenders,
  creditCap,
  isSettlementError,
  money,
  subtract,
  type Legs,
  type Tender,
} from '../../src/index.ts';
import { PYG, USD } from '../fixtures.ts';
import { toLegObservation } from './adapter.ts';

const set = loadGoldenVectors();

const legsOf = (v: GoldenLegVector, currency: typeof USD): Legs =>
  Object.freeze({
    HOST: money(v.legsMinor.HOST, currency),
    INSURER: money(v.legsMinor.INSURER, currency),
    TAX_THIRD_PARTY: money(v.legsMinor.TAX_THIRD_PARTY, currency),
    PLATFORM: money(v.legsMinor.PLATFORM, currency),
    total: money(v.totalMinor, currency),
  });

describe('08 E7 règle 10 — cascade des encaissements (USD, TJ15, TJ21)', () => {
  const capture = legsOf(legVector(set, 'TJ01'), USD);

  it('TJ15a à TJ15d : carte, Yappy, crédit cash, crédit promo ; les crédits ne touchent que PLATFORM', () => {
    const expected = ['TJ15a', 'TJ15b', 'TJ15c', 'TJ15d'].map((id) => legVector(set, id));
    // ordre volontairement mélangé : la cascade ordonne natif → non natif → cash → promo
    const tenders: Tender[] = [
      { kind: 'PROMO_CREDIT', amount: money(expected[3]!.totalMinor, USD) },
      { kind: 'NATIVE', amount: money(expected[0]!.totalMinor, USD) },
      { kind: 'CASH_CREDIT', amount: money(expected[2]!.totalMinor, USD) },
      { kind: 'NON_NATIVE', amount: money(expected[1]!.totalMinor, USD) },
    ];
    const rows = cascadeTenders(capture, tenders);
    expect(rows.map((r) => r.kind)).toEqual([
      'NATIVE',
      'NON_NATIVE',
      'CASH_CREDIT',
      'PROMO_CREDIT',
    ]);
    rows.forEach((r, i) => {
      expect(compareLegs(expected[i]!, toLegObservation(r.legs))).toEqual([]);
    });
  });

  it('TJ21 : crédit cash demandé 120,00 plafonné à PLATFORM (99,91) ; le reste par carte', () => {
    const a = legVector(set, 'TJ21a');
    const b = legVector(set, 'TJ21b');
    const credit = creditCap(capture, money(12_000n, USD));
    expect(credit.amountMinor).toBe(b.totalMinor);
    const rows = cascadeTenders(capture, [
      { kind: 'NATIVE', amount: subtract(capture.total, credit) },
      { kind: 'CASH_CREDIT', amount: credit },
    ]);
    expect(compareLegs(a, toLegObservation(rows[0]!.legs))).toEqual([]);
    expect(compareLegs(b, toLegObservation(rows[1]!.legs))).toEqual([]);
  });

  it('crédit au-delà de PLATFORM, Σ encaissements ≠ total, encaissement nul ou d’une autre devise : refus', () => {
    const over = () =>
      cascadeTenders(capture, [
        { kind: 'NATIVE', amount: money(13_666n, USD) },
        { kind: 'CASH_CREDIT', amount: money(12_000n, USD) },
      ]);
    expect(over).toThrow(/PLATFORM/);
    for (const bad of [
      [{ kind: 'NATIVE', amount: money(25_665n, USD) }],
      [
        { kind: 'NATIVE', amount: money(25_666n, USD) },
        { kind: 'PROMO_CREDIT', amount: money(0n, USD) },
      ],
      [{ kind: 'NATIVE', amount: money(25_666n, PYG) }],
    ] as Tender[][]) {
      try {
        cascadeTenders(capture, bad);
        expect.unreachable('refus attendu');
      } catch (error) {
        expect(isSettlementError(error) && error.code).toBe('SETTLEMENT_INPUT_INVALID');
      }
    }
  });
});

describe('08 E7 règle 10 — cascade des encaissements (PYG sans décimale, TJ09a)', () => {
  const capture = legsOf(legVector(set, 'TJ09a'), PYG);

  it('carte 1 000 000, Yappy 300 000, crédit cash 138 052 : valeurs de la fonction de l’oracle', () => {
    const rows = cascadeTenders(capture, [
      { kind: 'NATIVE', amount: money(1_000_000n, PYG) },
      { kind: 'NON_NATIVE', amount: money(300_000n, PYG) },
      { kind: 'CASH_CREDIT', amount: money(138_052n, PYG) },
    ]);
    expect(rows.map((r) => toLegObservation(r.legs))).toEqual([
      {
        legsMinor: { HOST: 787_501n, INSURER: 105_000n, TAX_THIRD_PARTY: 0n, PLATFORM: 107_499n },
        totalMinor: 1_000_000n,
      },
      {
        legsMinor: { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 300_000n },
        totalMinor: 300_000n,
      },
      {
        legsMinor: { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 138_052n },
        totalMinor: 138_052n,
      },
    ]);
    // plafond du crédit : PLATFORM de la capture (545 551)
    expect(creditCap(capture, money(600_000n, PYG)).amountMinor).toBe(
      legVector(set, 'TJ09a').legsMinor.PLATFORM,
    );
  });
});
