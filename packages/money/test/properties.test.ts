/**
 * Propriétés (fast-check), en variantes PA (USD) et PY (PYG). Les invariants viennent de 08
 * BR-PRICE-14 (3) et du pseudo-code BR-CXL ; ils sont vérifiés par arithmétique entière croisée,
 * jamais en recalculant avec le code testé.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  add,
  allocHost,
  isMoneyError,
  money,
  multiplyRoundHalfUp,
  negate,
  ratio,
  roundHalfUp,
  splitHostPlatform,
  subtract,
  sum,
  taxByLine,
  type Money,
} from '../src/index.ts';
import { COUNTRY_VARIANTS } from './fixtures.ts';

const RUNS = { numRuns: 2000 };

/** Montant de ligne réaliste : jusqu'à 10^15 unités mineures (10^13 USD, 10^15 PYG). */
const lineAmount = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const nonNegativeAmount = fc.bigInt({ min: 0n, max: 10n ** 15n });
/** Tout l'intervalle int64. */
const int64 = fc.bigInt({ min: MIN_AMOUNT_MINOR, max: MAX_AMOUNT_MINOR });
/** Part dans [0 ; 1] (dénominateurs variés : 4, 100, 10 000, quelconques). */
const share = fc
  .bigInt({ min: 1n, max: 10n ** 6n })
  .chain((den) => fc.tuple(fc.bigInt({ min: 0n, max: den }), fc.constant(den)))
  .map(([num, den]) => ratio(num, den));
/** Fraction quelconque (signée), dénominateur > 0. */
const anyRatio = fc
  .tuple(
    fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
    fc.bigInt({ min: 1n, max: 10n ** 12n }),
  )
  .map(([num, den]) => ratio(num, den));

describe.each(COUNTRY_VARIANTS)('propriétés — $country', ({ currency }) => {
  const m = (minor: bigint): Money => money(minor, currency);

  it('allocHost : part hôte + part plateforme = total (aucun résidu perdu)', () => {
    fc.assert(
      fc.property(lineAmount, share, (amount, pct) => {
        const { host, platform } = splitHostPlatform(m(amount), pct);
        expect(host.amountMinor + platform.amountMinor).toBe(amount);
        expect(host.currency).toBe(currency.code);
        expect(platform.currency).toBe(currency.code);
      }),
      RUNS,
    );
  });

  it('allocHost : au plus proche, |hôte − m × pct| ≤ ½, égalité → floor (plateforme)', () => {
    fc.assert(
      fc.property(lineAmount, share, (amount, pct) => {
        const host = allocHost(m(amount), pct).amountMinor;
        // écart signé × 2·den : d = 2·(host·den − amount·num) ∈ [−den ; den[
        // (−den : égalité exacte, résidu à la plateforme ; +den interdit : ce serait un ceil d'égalité)
        const d = 2n * (host * pct.den - amount * pct.num);
        expect(d >= -pct.den && d < pct.den).toBe(true);
      }),
      RUNS,
    );
  });

  it('allocHost : pour m ≥ 0, 0 ≤ hôte ≤ m', () => {
    fc.assert(
      fc.property(nonNegativeAmount, share, (amount, pct) => {
        const host = allocHost(m(amount), pct).amountMinor;
        expect(host >= 0n && host <= amount).toBe(true);
      }),
      RUNS,
    );
  });

  it('allocHost : écart ≤ 1,5 unité sur trois lignes (P, D, Extras ; 08 BR-PRICE-14 (3))', () => {
    fc.assert(
      fc.property(
        fc.tuple(nonNegativeAmount, nonNegativeAmount, nonNegativeAmount),
        fc.tuple(share, share, share),
        (amounts, shares) => {
          // Σ host_i − Σ m_i·pct_i, ramené au dénominateur commun D = Π den_i : |écart| ≤ 3/2
          const D = shares[0].den * shares[1].den * shares[2].den;
          let deviation = 0n;
          for (let i = 0; i < 3; i += 1) {
            const amount = amounts[i]!;
            const pct = shares[i]!;
            const host = allocHost(m(amount), pct).amountMinor;
            deviation += (host * pct.den - amount * pct.num) * (D / pct.den);
          }
          const absolute = deviation < 0n ? -deviation : deviation;
          expect(2n * absolute <= 3n * D).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('roundHalfUp : écart dans ]−½ ; ½] (demi-unité vers +∞)', () => {
    fc.assert(
      fc.property(anyRatio, (q) => {
        const r = roundHalfUp(q);
        // d = 2·(r·den − num) ∈ ]−den ; den]
        const d = 2n * (r * q.den - q.num);
        expect(d > -q.den && d <= q.den).toBe(true);
      }),
      RUNS,
    );
  });

  it('roundHalfUp : symétrique hors égalité, demi-unité vers +∞ en cas d’égalité', () => {
    fc.assert(
      fc.property(anyRatio, (q) => {
        const up = roundHalfUp(q);
        const down = roundHalfUp(ratio(-q.num, q.den));
        const isHalf = q.den === 2n; // forme réduite : demi-entier exact ⇔ dénominateur 2
        expect(down).toBe(isHalf ? -up + 1n : -up);
      }),
      RUNS,
    );
  });

  it('roundHalfUp : symétrie exercée sur les demi-entiers exacts', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), (k) => {
        const q = ratio(2n * k + 1n, 2n); // k + ½
        expect(roundHalfUp(q)).toBe(k + 1n);
        expect(roundHalfUp(ratio(-(2n * k + 1n), 2n))).toBe(-k);
      }),
      RUNS,
    );
  });

  it('roundHalfUp : un entier exact est inchangé', () => {
    fc.assert(
      fc.property(int64, (k) => {
        expect(roundHalfUp(ratio(k, 1n))).toBe(k);
      }),
      RUNS,
    );
  });

  it('taxe par ligne : |Σ roundHalfUp(l × t) − roundHalfUp(t × Σ l)| ≤ (n + 1)/2', () => {
    fc.assert(
      fc.property(fc.array(lineAmount, { maxLength: 12 }), share, (amounts, rate) => {
        const lines = amounts.map((a) => m(a));
        const byLine = taxByLine(currency, lines, rate).amountMinor;
        const aggregated = multiplyRoundHalfUp(sum(currency, lines), rate).amountMinor;
        const gap = byLine - aggregated;
        const absolute = gap < 0n ? -gap : gap;
        expect(2n * absolute <= BigInt(lines.length) + 1n).toBe(true);
      }),
      RUNS,
    );
  });

  it('aucun débordement : arithmétique exacte au-delà de 2^53 et refus explicite hors int64', () => {
    fc.assert(
      fc.property(int64, int64, (a, b) => {
        const exact = a + b;
        try {
          const result = add(m(a), m(b)).amountMinor;
          expect(result).toBe(exact);
          expect(subtract(m(result), m(b)).amountMinor).toBe(a);
        } catch (error) {
          expect(isMoneyError(error, 'MONEY_OUT_OF_RANGE')).toBe(true);
          expect(exact < MIN_AMOUNT_MINOR || exact > MAX_AMOUNT_MINOR).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('aucun débordement : produit intermédiaire hors int64, résultat exact ou refus', () => {
    fc.assert(
      fc.property(int64, share, (a, pct) => {
        // m × pct avec pct ∈ [0 ; 1] reste dans int64 : jamais de refus, jamais de perte
        const host = allocHost(m(a), pct).amountMinor;
        const d = 2n * (host * pct.den - a * pct.num);
        expect(d >= -pct.den && d < pct.den).toBe(true);
        const rounded = multiplyRoundHalfUp(m(a), pct).amountMinor;
        const e = 2n * (rounded * pct.den - a * pct.num);
        expect(e > -pct.den && e <= pct.den).toBe(true);
      }),
      RUNS,
    );
  });

  it('opposé : négation exacte (sauf MIN int64, refusé)', () => {
    fc.assert(
      fc.property(int64, (a) => {
        if (a === MIN_AMOUNT_MINOR) return;
        expect(negate(negate(m(a))).amountMinor).toBe(a);
      }),
      RUNS,
    );
  });
});
