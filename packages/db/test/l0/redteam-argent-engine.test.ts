/**
 * US-049 — red team ARGENT, moteur pur (`@rueda/money`) : arrondis PYG, débordement bigint, devise
 * croisée, Money forgé, montant modifié entre devis et règlement, supersession rejouée, vecteurs
 * T36 / TJ01 / TJ02b. Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille.
 *
 * Attendus : 08 (BR-PRICE-14, E1, E4, E7) et l'export des oracles Python (`@rueda/money/golden-vectors`),
 * jamais le code testé. Les références d'arrondi ci-dessous sont recopiées de la formule de 08
 * (`roundHalfUp(q) = floor(q + 1/2)` ; `allocHost` : floor si frac ≤ 1/2, sinon ceil), écrites ici
 * en `bigint` pur, indépendamment de `rounding.ts` et `money.ts`.
 * Assertion L0-05 : chaque test commence par `l0()` (connexion sous un rôle de production).
 */
import { describe, expect, it } from 'vitest';
import {
  LEGS,
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  add,
  allocHost,
  buildSettlementRecord,
  computeCancellationSettlement,
  computeCaptureLegs,
  createCurrencyRegistry,
  isMoneyError,
  isSettlementError,
  money,
  moneyFromSafeInteger,
  multiplyByInteger,
  multiplyRoundHalfUp,
  negate,
  parseMajor,
  parseMinor,
  ratio,
  settlementDelta,
  settlementRecordPayload,
  signedLegs,
  splitHostPlatform,
  subtract,
  taxByLine,
  type SettlementRecord,
  type SettlementTrip,
} from '@rueda/money';
import {
  checksFor,
  legVector,
  loadGoldenVectors,
  settlementVector,
} from '@rueda/money/golden-vectors';
import { T0_MS, at, testParams, toEvent, toTrip } from '@rueda/money/testing';
import { withRole } from '../../src/testing/index.ts';

const golden = loadGoldenVectors();
const exponentOf = (code: string): number => {
  const c = golden.currencies.get(code);
  if (c === undefined) throw new Error(`devise ${code} absente de l'export des oracles`);
  return c.exponent;
};
const registry = createCurrencyRegistry([
  { code: 'USD', exponent: exponentOf('USD') },
  { code: 'PYG', exponent: exponentOf('PYG') },
]);
const U = registry.get('USD');
const P = registry.get('PYG');

/** L0-05 : tout test commence sous un rôle de production. */
const l0 = (): Promise<void> =>
  withRole('app_worker', async (c) => {
    await c.query('SELECT 1');
  });

// ------------------------------------------------------------------ références indépendantes (08)
const floorDivRef = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
};
/** 08 : roundHalfUp(q) = floor(q + 1/2). */
const roundHalfUpRef = (n: bigint, d: bigint): bigint => floorDivRef(2n * n + d, 2n * d);
/** 08 BR-PRICE-14 (3) : x = m × pct ; floor(x) si frac(x) ≤ 1/2, sinon ceil(x). */
const allocHostRef = (m: bigint, n: bigint, d: bigint): bigint => {
  const f = floorDivRef(m * n, d);
  const rem = m * n - f * d;
  return 2n * rem <= d ? f : f + 1n;
};

/** Code de l'erreur du moteur levée par `fn`, `AUCUNE_ERREUR` si rien n'est levé. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (isMoneyError(e) || isSettlementError(e)) return e.code;
    return `AUTRE:${String(e)}`;
  }
  return 'AUCUNE_ERREUR';
}

const late = { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) } as const;

describe('ARG-01 — arrondis PYG / USD : allocHost et roundHalfUp uniques, restes d’allocation', () => {
  it('table de cas aux limites (demi-unité, négatifs, > 2^53) : conforme à la formule de 08', async () => {
    await l0();
    // [m, num, den, attendu] — attendus calculés à la main depuis 08 (frac ≤ 1/2 ⇒ floor)
    const cases: [bigint, bigint, bigint, bigint][] = [
      [1n, 1n, 2n, 0n], // 0,5 → floor
      [3n, 1n, 2n, 1n], // 1,5 → floor
      [2n, 1n, 4n, 0n], // 0,5 → floor
      [6n, 1n, 4n, 1n], // 1,5 → floor
      [1n, 3n, 4n, 1n], // 0,75 → ceil
      [1_000_001n, 3n, 4n, 750_001n], // 750 000,75 → ceil (PYG, trip J de 08)
      [5n, 1n, 3n, 2n], // 1,666… → ceil
      [4n, 1n, 3n, 1n], // 1,333… → floor
      [-1n, 1n, 2n, -1n], // −0,5 → floor (formule appliquée telle quelle, 08)
      [-3n, 1n, 2n, -2n], // −1,5 → floor
      [0n, 3n, 4n, 0n],
      [9_007_199_254_740_993n, 3n, 4n, 6_755_399_441_055_745n], // au-delà de 2^53 (piège du flottant)
    ];
    for (const [m, n, d, expected] of cases) {
      for (const cur of [U, P]) {
        expect(allocHost(money(m, cur), ratio(n, d)).amountMinor, `${m}×${n}/${d}`).toBe(expected);
      }
    }
  });

  it('balayage : allocHost = référence de 08 et hôte + plateforme = montant, PYG et USD', async () => {
    await l0();
    const shares: [bigint, bigint][] = [
      [3n, 4n],
      [7n, 10n],
      [1n, 3n],
      [2n, 3n],
      [1n, 2n],
      [9n, 10n],
      [1n, 7n],
    ];
    for (const cur of [U, P]) {
      for (let m = -50n; m <= 4_000n; m += 1n) {
        for (const [n, d] of shares) {
          const got = allocHost(money(m, cur), ratio(n, d)).amountMinor;
          expect(got).toBe(allocHostRef(m, n, d));
          const { host, platform } = splitHostPlatform(money(m, cur), ratio(n, d));
          expect(host.amountMinor + platform.amountMinor).toBe(m); // aucun reste perdu ni créé
        }
      }
    }
  });

  it('taxe par ligne puis somme (T43 : P = F = 10,05 $ à 7 % ⇒ 1,40 et non 1,41) ; PYG : 3 × 5 à 10 %', async () => {
    await l0();
    expect(taxByLine(U, [money(1005n, U), money(1005n, U)], ratio(7n, 100n)).amountMinor).toBe(
      140n,
    );
    const tenth = ratio(1n, 10n);
    // PYG : chaque ligne de 5 porte 0,5 → 1 (demi-unité vers le haut) ; trois lignes = 3, pas roundHalfUp(1,5) = 2
    expect(taxByLine(P, [money(5n, P), money(5n, P), money(5n, P)], tenth).amountMinor).toBe(3n);
    // ligne promo négative : −5 × 1/10 = −0,5 → 0 ; −25 × 1/10 = −2,5 → −2 (08 : « aussi pour une ligne négative »)
    expect(taxByLine(P, [money(-5n, P)], tenth).amountMinor).toBe(0n);
    expect(multiplyRoundHalfUp(money(-25n, P), tenth).amountMinor).toBe(-2n);
    expect(roundHalfUpRef(-25n, 10n)).toBe(-2n);
  });
});

describe('ARG-02 — débordement bigint (int64) : refus, jamais de troncature ni de repli', () => {
  it('bornes de Money, opérations et lecture de chaînes', async () => {
    await l0();
    const max = money(MAX_AMOUNT_MINOR, U);
    const min = money(MIN_AMOUNT_MINOR, U);
    expect(codeOf(() => money(MAX_AMOUNT_MINOR + 1n, U))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => money(MIN_AMOUNT_MINOR - 1n, P))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => add(max, money(1n, U)))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => subtract(min, money(1n, U)))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => negate(min))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => multiplyByInteger(max, 2n))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => multiplyRoundHalfUp(max, ratio(3n, 2n)))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => parseMinor('9223372036854775808', U))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => parseMinor('-9223372036854775809', P))).toBe('MONEY_OUT_OF_RANGE');
    for (const bad of ['0x10', ' 5', '5 ', '5.0', '+5', '-0', '1e3', '٣', '', '00']) {
      expect(
        codeOf(() => parseMinor(bad, U)),
        JSON.stringify(bad),
      ).toBe('MONEY_INVALID_AMOUNT');
    }
    expect(codeOf(() => moneyFromSafeInteger(2 ** 53, U))).toBe('MONEY_INVALID_AMOUNT');
    expect(codeOf(() => moneyFromSafeInteger(Number.NaN, U))).toBe('MONEY_INVALID_AMOUNT');
    expect(codeOf(() => parseMajor('1000.5', P))).toBe('MONEY_INVALID_AMOUNT'); // PYG : aucune décimale
    expect(codeOf(() => parseMajor('10.005', U))).toBe('MONEY_INVALID_AMOUNT'); // pas d’arrondi implicite
  });

  it('un trip dont la somme des lignes dépasse int64 ne produit aucun règlement', async () => {
    await l0();
    const base = toTrip(settlementVector(golden, 'T03').trip);
    const half = MAX_AMOUNT_MINOR / 2n + 1n;
    const huge: SettlementTrip = {
      ...base,
      lines: { tripPrice: money(half, U), tripFee: money(half, U) },
      taxGroups: [],
      totalPaid: money(MAX_AMOUNT_MINOR, U),
    };
    let record: SettlementRecord | undefined;
    const outcome = codeOf(() => {
      record = buildSettlementRecord(huge, late, testParams(U));
    });
    expect(outcome).not.toBe('AUCUNE_ERREUR');
    expect(record).toBeUndefined();
  });
});

describe('ARG-03 — devise croisée (USD sur un trip PY, PYG sur un trip PA) et Money forgé', () => {
  const t03 = toTrip(settlementVector(golden, 'T03').trip); // PA, USD
  const t27 = toTrip(settlementVector(golden, 'T27').trip); // PY, PYG

  it('une ligne, une taxe ou le total dans l’autre devise ⇒ MONEY_CURRENCY_MISMATCH', async () => {
    await l0();
    const lineSwap = { ...t03, lines: { ...t03.lines, tripFee: money(100n, P) } };
    expect(codeOf(() => buildSettlementRecord(lineSwap, late, testParams(U)))).toBe(
      'MONEY_CURRENCY_MISMATCH',
    );
    const totalSwap = { ...t27, totalPaid: money(t27.totalPaid.amountMinor, U) };
    expect(codeOf(() => buildSettlementRecord(totalSwap, late, testParams(P)))).toBe(
      'MONEY_CURRENCY_MISMATCH',
    );
    const taxSwap = {
      ...t03,
      taxGroups: t03.taxGroups.map((g) => ({ ...g, taxPaid: money(g.taxPaid.amountMinor, P) })),
    };
    expect(codeOf(() => buildSettlementRecord(taxSwap, late, testParams(U)))).toBe(
      'MONEY_CURRENCY_MISMATCH',
    );
  });

  it('barème de pénalité d’hôte en PYG appliqué à un trip USD ⇒ aucun règlement', async () => {
    await l0();
    let r: SettlementRecord | undefined;
    const code = codeOf(() => {
      r = buildSettlementRecord(
        t03,
        { reason: 'HOST_CANCELLED', requestedAtMs: at(-600) },
        testParams(P),
      );
    });
    // refus attendu (devise du barème ≠ devise du trip) ; le code exact importe peu, l'absence de règlement si
    expect(code).not.toBe('AUCUNE_ERREUR');
    expect(r).toBeUndefined();
  });

  it('version n+1 d’une autre devise que la version n ⇒ refus', async () => {
    await l0();
    const r1 = buildSettlementRecord(t03, late, testParams(U));
    expect(codeOf(() => buildSettlementRecord(t27, late, testParams(P), r1))).not.toBe(
      'AUCUNE_ERREUR',
    );
  });

  it('Money forgé (objet simple ou clone du prototype) ⇒ MONEY_INVALID_AMOUNT', async () => {
    await l0();
    const fake = { amountMinor: 5n, currency: 'USD' } as unknown as ReturnType<typeof money>;
    expect(codeOf(() => add(money(1n, U), fake))).toBe('MONEY_INVALID_AMOUNT');
    const forged = { ...t03, lines: { ...t03.lines, tripPrice: fake } };
    expect(codeOf(() => buildSettlementRecord(forged, late, testParams(U)))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    const clone = Object.assign(Object.create(Object.getPrototypeOf(money(1n, U)) as object), {
      amountMinor: 1n,
      currency: 'USD',
    }) as ReturnType<typeof money>;
    expect(codeOf(() => add(money(1n, U), clone))).toBe('MONEY_INVALID_AMOUNT');
  });
});

describe('ARG-04 — montant modifié entre devis et règlement', () => {
  const t03 = toTrip(settlementVector(golden, 'T03').trip);

  it('total payé ≠ Σ lignes + Σ taxe payée ⇒ SETTLEMENT_INPUT_INVALID', async () => {
    await l0();
    const bumped = { ...t03, totalPaid: money(t03.totalPaid.amountMinor + 1n, U) };
    expect(codeOf(() => buildSettlementRecord(bumped, late, testParams(U)))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
  });

  it('version n+1 recalculée sur un total payé différent de la version n ⇒ SETTLEMENT_INPUT_INVALID', async () => {
    await l0();
    const r1 = buildSettlementRecord(t03, late, testParams(U));
    const price = t03.lines.tripPrice;
    if (!price) throw new Error('T03 sans ligne tripPrice');
    const requoted: SettlementTrip = {
      ...t03,
      lines: { ...t03.lines, tripPrice: add(price, money(1000n, U)) },
      totalPaid: add(t03.totalPaid, money(1000n, U)),
    };
    expect(codeOf(() => buildSettlementRecord(requoted, late, testParams(U), r1))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
  });

  it('version n+1 sur un devis recomposé à total égal (1 000 déplacés du prix vers le trip fee) ⇒ refus', async () => {
    await l0();
    const r1 = buildSettlementRecord(t03, late, testParams(U));
    const price = t03.lines.tripPrice;
    const fee = t03.lines.tripFee;
    if (!price || !fee) throw new Error('T03 sans tripPrice / tripFee');
    const recomposed: SettlementTrip = {
      ...t03,
      lines: {
        ...t03.lines,
        tripPrice: subtract(price, money(1000n, U)),
        tripFee: add(fee, money(1000n, U)),
      },
    };
    // le devis figé à la réservation ne change pas (08 E1, BR-CXL-03) : v n+1 porte sur les mêmes entrées
    let r2: SettlementRecord | undefined;
    const code = codeOf(() => {
      r2 = buildSettlementRecord(
        recomposed,
        { reason: 'HOST_CANCELLED', requestedAtMs: at(-600) },
        testParams(U),
        r1,
      );
    });
    expect({ accepted: r2 !== undefined, code }).toEqual({
      accepted: false,
      code: expect.any(String),
    });
    expect(code).not.toBe('AUCUNE_ERREUR');
  });
});

describe('ARG-05 — supersession : v2 appliquée deux fois, chaîne v1 → v2 → v3 → v4, delta jamais doublé', () => {
  const v = (id: string) => settlementVector(golden, id);
  const trip = toTrip(v('T08').trip); // T36 : v1 = T08, v2 = T07 (même trip A)
  const params = testParams(U);
  const e08 = toEvent(v('T08').event);
  const e07 = toEvent(v('T07').event);

  it('T36 : delta(v1 → v2) = valeurs de l’oracle (−118,44 / −6,44 / +75,00 / +37,00 / pénalité −50)', async () => {
    await l0();
    const check = checksFor(golden, 'T36').find((c) => c.label === 'T36');
    const [refund, tax, host, platform, penaltyMajor] = check?.expected as readonly bigint[];
    const r1 = buildSettlementRecord(trip, e08, params);
    const r2 = buildSettlementRecord(trip, e07, params, r1);
    const d = settlementDelta(r1, r2);
    expect(d.guestRefundMinor).toBe(refund);
    expect(d.taxRefundMinor).toBe(tax);
    expect(d.hostEarningsMinor).toBe(host);
    expect(d.platformNetMinor).toBe(platform);
    expect(d.hostPenaltyMinor).toBe((penaltyMajor ?? 0n) * 10n ** BigInt(exponentOf('USD')));
  });

  it('v3 = le même événement que v2 rejoué : variation nulle, remboursement inchangé (aucun doublon)', async () => {
    await l0();
    const r1 = buildSettlementRecord(trip, e08, params);
    const r2 = buildSettlementRecord(trip, e07, params, r1);
    const r3 = buildSettlementRecord(trip, e07, params, r2);
    expect(r3.guestRefundMinor).toBe(r2.guestRefundMinor);
    expect(r3.legs.map((l) => l.variationMinor)).toEqual([0n, 0n, 0n, 0n]);
    const d = settlementDelta(r2, r3);
    expect([
      d.guestRefundMinor,
      d.hostEarningsMinor,
      d.platformNetMinor,
      d.hostPenaltyMinor,
    ]).toEqual([0n, 0n, 0n, 0n]);
  });

  it('chaîne de 4 versions : capture + Σ variations = jambes de la dernière ; Σ variations = − remboursement final', async () => {
    await l0();
    const events = [e08, e07, e08, e07];
    const chain: SettlementRecord[] = [];
    for (const [i, e] of events.entries())
      chain.push(buildSettlementRecord(trip, e, params, chain[i - 1]));
    const last = chain[3] as SettlementRecord;
    const capture = computeCaptureLegs(trip);
    for (const leg of LEGS) {
      const total = chain.reduce(
        (s, r) => s + (r.legs.find((l) => l.leg === leg)?.variationMinor ?? 0n),
        0n,
      );
      expect(capture[leg].amountMinor + total, leg).toBe(signedLegs(last)[leg]);
    }
    const sumVar = chain.reduce(
      (s, r) => s + r.legs.reduce((a, l) => a + l.variationMinor, 0n),
      0n,
    );
    expect(sumVar).toBe(-last.guestRefundMinor);
    for (const r of chain) expect(r.guestRefundMinor <= r.totalPaidMinor).toBe(true);
  });

  it('rejeu déterministe : mêmes entrées ⇒ même hachage et même charge utile', async () => {
    await l0();
    const a = buildSettlementRecord(trip, e08, params);
    const b = buildSettlementRecord(trip, e08, params);
    expect(b.inputsHash).toBe(a.inputsHash);
    expect(JSON.stringify(settlementRecordPayload(b))).toBe(
      JSON.stringify(settlementRecordPayload(a)),
    );
  });
});

describe('ARG-06 — vecteurs TJ01 / TJ02b (PA) et TJ08a / TJ08b (PY) : jambes explicites, jamais un prorata', () => {
  it.each([
    ['T03', 'TJ01', 'TJ02b'],
    ['T27', 'TJ08a', 'TJ08b'],
  ])('%s : capture = %s et variation = %s', async (id, capture, variation) => {
    await l0();
    const trip = toTrip(settlementVector(golden, id).trip);
    const s = computeCancellationSettlement(
      trip,
      toEvent(settlementVector(golden, id).event),
      testParams(trip.currency),
    );
    const cap = legVector(golden, capture);
    const diff = legVector(golden, variation);
    for (const leg of LEGS) {
      expect(s.captureLegs[leg].amountMinor, `${capture} ${leg}`).toBe(cap.legsMinor[leg]);
      expect(s.legVariation[leg].amountMinor, `${variation} ${leg}`).toBe(diff.legsMinor[leg]);
    }
    expect(s.captureLegs.total.amountMinor).toBe(cap.totalMinor);
    expect(s.legVariation.total.amountMinor).toBe(diff.totalMinor);
  });
});

describe('ARG-07 — fuzz PYG / USD : invariants d’un règlement sur des montants forçant des restes', () => {
  // générateur congruentiel : déterministe, sans dépendance
  let seed = 0x2f6e2b1n;
  const next = (bound: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return (seed >> 11n) % bound;
  };

  function randomTrip(code: 'USD' | 'PYG', scale: bigint): SettlementTrip {
    const cur = code === 'USD' ? U : P;
    const p = 1n + next(scale);
    const f = 1n + next(scale / 5n + 1n);
    const prot = 1n + next(scale / 3n + 1n);
    const taxPaid = roundHalfUpRef(f, 10n) + roundHalfUpRef(prot, 10n); // par ligne puis somme (08)
    const base = toTrip(settlementVector(golden, code === 'USD' ? 'T03' : 'T27').trip);
    const m = (x: bigint) => money(x, cur);
    return {
      ...base,
      lines: { tripPrice: m(p), tripFee: m(f), protection: m(prot) },
      taxGroups: [
        { id: 'iva', lines: ['tripFee', 'protection'], taxPaid: m(taxPaid), thirdParty: false },
      ],
      totalPaid: m(p + f + prot + taxPaid),
      days: 1 + Number(next(5n)),
      startAtMs: T0_MS,
      bookedAtMs: at(-5 * 24 * 60),
    };
  }

  it.each([
    ['USD', 400_000n],
    ['PYG', 90_000_000n],
  ] as const)(
    '%s : 1 500 règlements aléatoires — équilibre, Σ jambes, bornes (08 E7 règles 5 et 8, 17 §3.2.8)',
    async (code, scale) => {
      await l0();
      const cur = code === 'USD' ? U : P;
      const events = [
        { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) },
        { reason: 'GUEST_CANCELLED', requestedAtMs: at(-4000) },
        { reason: 'HOST_CANCELLED', requestedAtMs: at(-600) },
      ];
      for (let i = 0; i < 1500; i++) {
        const trip = randomTrip(code, scale);
        const ev = events[i % events.length] as (typeof events)[number];
        const r = buildSettlementRecord(trip, ev, testParams(cur));
        const tag = `#${i} ${JSON.stringify(r.legs.map((l) => [l.leg, String(l.keptMinor)]))}`;
        expect(r.guestRefundMinor + r.retainedMinor + r.retainedTaxMinor, tag).toBe(
          r.totalPaidMinor,
        );
        const kept = r.legs.reduce((s, l) => s + l.keptMinor - l.advanceMinor, 0n);
        expect(kept, tag).toBe(r.retainedMinor + r.retainedTaxMinor);
        expect(
          r.legs.reduce((s, l) => s + l.variationMinor, 0n),
          tag,
        ).toBe(-r.guestRefundMinor);
        expect(
          r.legs.reduce((s, l) => s + l.basisMinor, 0n),
          tag,
        ).toBe(r.totalPaidMinor);
        expect(r.legs.find((l) => l.leg === 'HOST')?.keptMinor, tag).toBe(r.hostFromGuestMinor);
        expect(
          r.legs.every((l) => l.keptMinor >= 0n && l.advanceMinor >= 0n && l.basisMinor >= 0n),
          tag,
        ).toBe(true);
        expect(
          r.guestRefundMinor >= 0n &&
            r.taxRefundMinor >= 0n &&
            r.taxRefundMinor <= r.guestRefundMinor,
          tag,
        ).toBe(true);
        expect(r.hostEarningsMinor, tag).toBe(r.hostFromGuestMinor + r.hostCompensationMinor);
        expect(r.platformNetMinor, tag).toBe(r.retainedMinor - r.hostEarningsMinor);
        for (const g of r.taxGroups) {
          expect(g.taxRefundMinor <= g.taxPaidMinor && g.taxRefundMinor >= 0n, tag).toBe(true);
        }
      }
    },
  );
});
