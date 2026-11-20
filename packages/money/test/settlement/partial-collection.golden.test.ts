/**
 * US-703 — encaissements partiels d'une dette, jambe par jambe (08 E7 règle 4 révisée par US-056 ;
 * 19 US-703 critère 2 ; L3-PM-23, RT-L3-M03), en PA (USD) et PY (PYG sans décimale).
 *
 * Attendus : vecteurs TJ07a / TJ07b, TJ17a à TJ17f et TJ19a à TJ19f de l'export des oracles
 * (`check_legs.py`, `@rueda/money/golden-vectors`), jamais calculés ici. Les jambes dues de chaque
 * séquence sont celles que 08 nomme dans la ligne du vecteur (« jambes TJ02a », « jambes TJ01 »,
 * « jambes TJ11a », « jambes TJ13b ») ; les montants payés sont les totaux des vecteurs.
 * Propriétés (fast-check, graines fixes, PA et PY) : celles du balayage de `check_legs.py`
 * (aucun incrément négatif ; `HOST` porté ≤ ⌊HOST × encaissé / dû⌋ à chaque pas ; cumul = jambes
 * dues au solde) et Σ incréments = encaissement, cumul ≤ dû par jambe.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  legVector,
  loadGoldenVectors,
  type GoldenLegVector,
} from '../../src/golden-vectors/index.ts';
import {
  LEGS,
  PARTIAL_COLLECTION_RULE_VERSION,
  addLegs,
  isSettlementError,
  money,
  partialCollectionLegs,
  remainingLegs,
  type Currency,
  type Leg,
  type Legs,
} from '../../src/index.ts';
import { COUNTRY_VARIANTS, registry } from '../fixtures.ts';

const set = loadGoldenVectors();

const legsOf = (v: GoldenLegVector, currency: Currency): Legs => {
  const out = {} as Record<Leg, ReturnType<typeof money>>;
  for (const k of LEGS) out[k] = money(v.legsMinor[k], currency);
  return Object.freeze({ ...out, total: money(v.totalMinor, currency) });
};

const minorOf = (l: Legs): Record<Leg, bigint> =>
  Object.fromEntries(LEGS.map((k) => [k, l[k].amountMinor])) as Record<Leg, bigint>;

const zeroLegs = (currency: Currency): Legs => {
  const out = {} as Record<Leg, ReturnType<typeof money>>;
  for (const k of LEGS) out[k] = money(0n, currency);
  return Object.freeze({ ...out, total: money(0n, currency) });
};

/** Séquences de 08 : dette (vecteur nommé par 08) puis encaissements (vecteurs, dans l'ordre). */
const SEQUENCES = [
  { due: 'TJ02a', steps: ['TJ07a', 'TJ07b'] },
  { due: 'TJ01', steps: ['TJ17a', 'TJ17b', 'TJ17c'] },
  { due: 'TJ11a', steps: ['TJ17d', 'TJ17e', 'TJ17f'] },
  { due: 'TJ01', steps: ['TJ19a', 'TJ19b'] },
  { due: 'TJ11a', steps: ['TJ19c', 'TJ19d'] },
  { due: 'TJ13b', steps: ['TJ19e', 'TJ19f'] },
] as const;

describe('E7 règle 4 : encaissements partiels rejoués sur les vecteurs de l’export', () => {
  it('version de la règle publiée', () => {
    expect(PARTIAL_COLLECTION_RULE_VERSION).toBe('E7R4-US056');
  });

  it.each(SEQUENCES)('dette aux jambes $due : $steps', ({ due, steps }) => {
    const dueVector = legVector(set, due);
    const currency = registry.get(dueVector.currency);
    const dueLegs = legsOf(dueVector, currency);
    let carried = zeroLegs(currency);
    for (const id of steps) {
      const v = legVector(set, id);
      expect(v.currency).toBe(dueVector.currency);
      const inc = partialCollectionLegs(currency, dueLegs, carried, money(v.totalMinor, currency));
      expect(minorOf(inc), id).toEqual({ ...v.legsMinor });
      for (const k of LEGS) expect(inc[k].amountMinor >= 0n, `${id} ${k}`).toBe(true);
      carried = addLegs(carried, inc);
    }
    // cumul = jambes dues, jambe par jambe, sans réaffectation (critère 2)
    expect(minorOf(carried)).toEqual({ ...dueVector.legsMinor });
    expect(minorOf(remainingLegs(dueLegs, carried))).toEqual({
      HOST: 0n,
      INSURER: 0n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: 0n,
    });
  });

  it('les deux pays sont couverts (USD et PYG)', () => {
    const currencies = new Set(SEQUENCES.map((s) => legVector(set, s.due).currency));
    for (const { currency } of COUNTRY_VARIANTS) expect(currencies.has(currency.code)).toBe(true);
  });

  it('refus : encaissement nul, au-delà du reste dû, cumul hors bornes, devises mêlées', () => {
    const dueVector = legVector(set, 'TJ02a');
    const usd = registry.get(dueVector.currency);
    const due = legsOf(dueVector, usd);
    const code = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (error) {
        return isSettlementError(error) ? error.code : 'OTHER';
      }
      return undefined;
    };
    const zero = zeroLegs(usd);
    expect(code(() => partialCollectionLegs(usd, due, zero, money(0n, usd)))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(
      code(() => partialCollectionLegs(usd, due, zero, money(dueVector.totalMinor + 1n, usd))),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    expect(code(() => partialCollectionLegs(usd, due, due, money(1n, usd)))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    const other = registry.get(legVector(set, 'TJ11a').currency);
    expect(code(() => partialCollectionLegs(usd, due, zero, money(1n, other)))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
  });
});

describe('E7 règle 4 : propriétés (PA, PY ; graines fixes)', () => {
  for (const { country, currency } of COUNTRY_VARIANTS) {
    const legAmount = fc.bigInt({ min: 0n, max: 10n ** 9n });
    const caseArb = fc
      .record({
        host: legAmount,
        insurer: legAmount,
        tax: legAmount,
        platform: legAmount,
        cuts: fc.array(fc.bigInt({ min: 1n, max: 10n ** 9n }), { minLength: 0, maxLength: 6 }),
      })
      .filter((r) => r.host + r.insurer + r.tax + r.platform > 0n);

    it(`${country} (${currency.code}) : aucun incrément négatif, HOST ≤ hostPayable, solde exact`, () => {
      fc.assert(
        fc.property(caseArb, (r) => {
          const owed = r.host + r.insurer + r.tax + r.platform;
          const due: Legs = Object.freeze({
            HOST: money(r.host, currency),
            INSURER: money(r.insurer, currency),
            TAX_THIRD_PARTY: money(r.tax, currency),
            PLATFORM: money(r.platform, currency),
            total: money(owed, currency),
          });
          // encaissements : coupures bornées par le reste, puis le solde
          const pays: bigint[] = [];
          let left = owed;
          for (const cut of r.cuts) {
            if (left <= 1n) break;
            const a = 1n + (cut % (left - 1n));
            pays.push(a);
            left -= a;
          }
          pays.push(left);
          let carried = zeroLegs(currency);
          let c = 0n;
          for (const a of pays) {
            const inc = partialCollectionLegs(currency, due, carried, money(a, currency));
            let s = 0n;
            for (const k of LEGS) {
              if (inc[k].amountMinor < 0n) return false;
              s += inc[k].amountMinor;
            }
            if (s !== a) return false;
            carried = addLegs(carried, inc);
            c += a;
            for (const k of LEGS) if (carried[k].amountMinor > due[k].amountMinor) return false;
            if (carried.HOST.amountMinor > (r.host * c) / owed) return false;
          }
          return LEGS.every((k) => carried[k].amountMinor === due[k].amountMinor);
        }),
        { numRuns: 400, seed: country === COUNTRY_VARIANTS[0]?.country ? 703 : 7030 },
      );
    });
  }
});
