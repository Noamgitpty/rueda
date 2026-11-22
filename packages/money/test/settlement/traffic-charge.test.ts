/**
 * US-318 — jambes d'une amende, d'un péage ou d'une fourrière refacturés au voyageur (08 BR-TT-02 à
 * 04 ; BR-PRICE-15 [NOUS] : frais de gestion 5 % ; BR-REIMB-04 : 100 % à l'hôte, frais facturés au
 * voyageur ; ADR-198), en PA (USD) et PY (PYG sans décimale).
 *
 * Attendus écrits à la main depuis 08 (5 % = 500 points de base, arrondi roundHalfUp de 08
 * BR-PRICE-14 : demi-unité vers le haut), jamais calculés par le code testé :
 *   USD 12,30 ⇒ 5 % = 61,5 c ⇒ 62 c ; total 12,92 ;
 *   USD 10,00 ⇒ 50 c ; total 10,50 ; USD 0,01 ⇒ 0,05 c ⇒ 0 ; total 0,01 ;
 *   PYG 25 010 ⇒ 1 250,5 ⇒ 1 251 ; total 26 261 ; PYG 150 000 ⇒ 7 500 ; total 157 500 ;
 *   PYG 9 ⇒ 0,45 ⇒ 0 ; PYG 10 ⇒ 0,5 ⇒ 1.
 * Propriétés (graines fixes) : Σ jambes = total = montant + frais ; HOST = montant ; INSURER =
 * TAX_THIRD_PARTY = 0 ; frais ≤ montant × bps / 10 000 + ½.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TRAFFIC_CHARGE_RULE_VERSION,
  isSettlementError,
  money,
  trafficChargeLegs,
} from '../../src/index.ts';
import { PYG, USD } from '../fixtures.ts';

const CASES = [
  { currency: USD, amount: 1230n, fee: 62n },
  { currency: USD, amount: 1000n, fee: 50n },
  { currency: USD, amount: 1n, fee: 0n },
  { currency: PYG, amount: 25010n, fee: 1251n },
  { currency: PYG, amount: 150000n, fee: 7500n },
  { currency: PYG, amount: 9n, fee: 0n },
  { currency: PYG, amount: 10n, fee: 1n },
] as const;

describe('US-318 — trafficChargeLegs (BR-TT-02 à 04, BR-PRICE-15)', () => {
  it('version de la règle', () => {
    expect(TRAFFIC_CHARGE_RULE_VERSION).toBe('BR-TT-US318');
  });

  it.each(CASES)('$currency.code $amount à 5 % ⇒ frais $fee', ({ currency, amount, fee }) => {
    const l = trafficChargeLegs(currency, money(amount, currency), 500);
    expect(l.HOST.amountMinor).toBe(amount);
    expect(l.INSURER.amountMinor).toBe(0n);
    expect(l.TAX_THIRD_PARTY.amountMinor).toBe(0n);
    expect(l.PLATFORM.amountMinor).toBe(fee);
    expect(l.total.amountMinor).toBe(amount + fee);
  });

  it('frais nuls (0 bps) et plafond des bornes (10 000 bps = 100 %)', () => {
    expect(trafficChargeLegs(USD, money(1230n, USD), 0).PLATFORM.amountMinor).toBe(0n);
    expect(trafficChargeLegs(PYG, money(25010n, PYG), 10_000).PLATFORM.amountMinor).toBe(25010n);
  });

  it('refus : montant nul ou négatif, frais hors bornes ou non entiers, autre devise', () => {
    const bad = [
      () => trafficChargeLegs(USD, money(0n, USD), 500),
      () => trafficChargeLegs(USD, money(-1n, USD), 500),
      () => trafficChargeLegs(USD, money(100n, USD), -1),
      () => trafficChargeLegs(USD, money(100n, USD), 10_001),
      () => trafficChargeLegs(USD, money(100n, USD), 2.5),
      () => trafficChargeLegs(USD, money(100n, PYG), 500),
    ];
    for (const f of bad) {
      let err: unknown;
      try {
        f();
      } catch (e) {
        err = e;
      }
      expect(isSettlementError(err, 'SETTLEMENT_INPUT_INVALID')).toBe(true);
    }
  });

  it.each([USD, PYG])('propriétés ($code)', (currency) => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 10_000 }),
        (amount, bps) => {
          const l = trafficChargeLegs(currency, money(amount, currency), bps);
          const sum =
            l.HOST.amountMinor +
            l.INSURER.amountMinor +
            l.TAX_THIRD_PARTY.amountMinor +
            l.PLATFORM.amountMinor;
          expect(sum).toBe(l.total.amountMinor);
          expect(l.HOST.amountMinor).toBe(amount);
          // |frais − montant × bps / 10 000| ≤ ½ : 2·10 000·frais ∈ [2·m·bps − 10 000, 2·m·bps + 10 000]
          const twice = 20_000n * l.PLATFORM.amountMinor;
          const exact = 2n * amount * BigInt(bps);
          expect(twice >= exact - 10_000n && twice <= exact + 10_000n).toBe(true);
        },
      ),
      { seed: 318, numRuns: 500 },
    );
  });
});
