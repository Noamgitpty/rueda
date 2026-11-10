/**
 * US-042 — propriétés complémentaires (fast-check), en PA (USD) et PY (PYG) : monotonie, bornes,
 * conservation des jambes et du règlement. Les invariants viennent de 08 (BR-PRICE-14, E7,
 * pseudo-code BR-CXL, fuzz de `independent_settlement_check.py`) ; ils sont vérifiés par
 * arithmétique entière croisée, jamais en recalculant un attendu avec le code testé. La
 * comparaison directe aux oracles Python est `test/oracle/` (`test:oracle`).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BETA_CANCELLATION_REASONS,
  LEGS,
  SETTLEMENT_LINES,
  allocHost,
  compareRatios,
  computeCancellationSettlement,
  computeLegs,
  money,
  multiplyRoundHalfUp,
  ratio,
  roundHalfUp,
  splitHostPlatform,
  sum,
  type Money,
  type Ratio,
  type SettlementLine,
  type SettlementTrip,
} from '../src/index.ts';
import { COUNTRY_VARIANTS } from './fixtures.ts';
import { TEST_INSURER_SHARES, T0_MS, at, testParams } from './settlement/adapter.ts';

const RUNS = { numRuns: 1000 };

const amount = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const nonNegative = fc.bigInt({ min: 0n, max: 10n ** 12n });
const share = fc
  .bigInt({ min: 1n, max: 10n ** 6n })
  .chain((den) => fc.tuple(fc.bigInt({ min: 0n, max: den }), fc.constant(den)))
  .map(([num, den]) => ratio(num, den));
const anyRatio = fc
  .tuple(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), fc.bigInt({ min: 1n, max: 10n ** 9n }))
  .map(([num, den]) => ratio(num, den));

const sorted = <T>(a: T, b: T, cmp: (x: T, y: T) => number): [T, T] =>
  cmp(a, b) <= 0 ? [a, b] : [b, a];

describe.each(COUNTRY_VARIANTS)('monotonie et bornes — $country', ({ currency }) => {
  const m = (minor: bigint): Money => money(minor, currency);

  it('roundHalfUp est croissant : q1 ≤ q2 ⇒ rhu(q1) ≤ rhu(q2)', () => {
    fc.assert(
      fc.property(anyRatio, anyRatio, (a, b) => {
        const [lo, hi] = sorted<Ratio>(a, b, compareRatios);
        expect(roundHalfUp(lo) <= roundHalfUp(hi)).toBe(true);
      }),
      RUNS,
    );
  });

  it('roundHalfUp commute avec un entier : rhu(q + k) = rhu(q) + k', () => {
    fc.assert(
      fc.property(anyRatio, fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (q, k) => {
        expect(roundHalfUp(ratio(q.num + k * q.den, q.den))).toBe(roundHalfUp(q) + k);
      }),
      RUNS,
    );
  });

  it('allocHost est croissant en montant (part fixe)', () => {
    fc.assert(
      fc.property(amount, amount, share, (a, b, pct) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(allocHost(m(lo), pct).amountMinor <= allocHost(m(hi), pct).amountMinor).toBe(true);
      }),
      RUNS,
    );
  });

  it('allocHost est croissant en part pour m ≥ 0, décroissant pour m ≤ 0', () => {
    fc.assert(
      fc.property(amount, share, share, (a, p1, p2) => {
        const [lo, hi] = sorted<Ratio>(p1, p2, compareRatios);
        const low = allocHost(m(a), lo).amountMinor;
        const high = allocHost(m(a), hi).amountMinor;
        expect(a >= 0n ? low <= high : low >= high).toBe(true);
      }),
      RUNS,
    );
  });

  it('allocHost : part 0 ⇒ 0, part 1 ⇒ m ; m < 0 ⇒ m ≤ hôte ≤ 0', () => {
    fc.assert(
      fc.property(amount, share, (a, pct) => {
        expect(allocHost(m(a), ratio(0n, 1n)).amountMinor).toBe(0n);
        expect(allocHost(m(a), ratio(1n, 1n)).amountMinor).toBe(a);
        const host = allocHost(m(a), pct).amountMinor;
        if (a < 0n) expect(host >= a && host <= 0n).toBe(true);
      }),
      RUNS,
    );
  });

  it('allocHost diffère de roundHalfUp seulement sur une égalité exacte (½ → plateforme)', () => {
    fc.assert(
      fc.property(amount, share, (a, pct) => {
        const host = allocHost(m(a), pct).amountMinor;
        const rounded = multiplyRoundHalfUp(m(a), pct).amountMinor;
        // frac(m × pct) = ½ ⇔ 2·(m·num mod den) = den
        const r = (((a * pct.num) % pct.den) + pct.den) % pct.den;
        expect(host).toBe(2n * r === pct.den ? rounded - 1n : rounded);
      }),
      RUNS,
    );
  });

  it('splitHostPlatform : aucun centime créé ni perdu, devise conservée, sur une liste', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(amount, share), { maxLength: 10 }), (items) => {
        let hosts = 0n;
        let platforms = 0n;
        for (const [a, pct] of items) {
          const { host, platform } = splitHostPlatform(m(a), pct);
          hosts += host.amountMinor;
          platforms += platform.amountMinor;
        }
        const total = sum(
          currency,
          items.map(([a]) => m(a)),
        );
        expect(hosts + platforms).toBe(total.amountMinor);
        expect(total.currency).toBe(currency.code);
      }),
      RUNS,
    );
  });
});

// --------------------------------------------------------------------------- jambes (08 E7)

for (const { country, currency } of COUNTRY_VARIANTS) {
  const m = (minor: bigint): Money => money(minor, currency);
  const tripArb = fc
    .record({
      lines: fc.tuple(...SETTLEMENT_LINES.map(() => nonNegative)),
      host: nonNegative,
      groups: fc.array(fc.tuple(nonNegative, fc.boolean()), { minLength: 0, maxLength: 3 }),
      premium: share,
      roadside: share,
    })
    .map((r) => {
      const retained = Object.fromEntries(
        SETTLEMENT_LINES.map((l, i) => [l, m(r.lines[i]!)]),
      ) as Record<SettlementLine, Money>;
      const taxGroups = r.groups.map(([tax, thirdParty], i) => ({
        id: `g${i}`,
        lines: ['tripFee'] as SettlementLine[],
        taxPaid: m(tax),
        thirdParty,
      }));
      const retainedTax = Object.fromEntries(taxGroups.map((g) => [g.id, g.taxPaid]));
      const trip = {
        currency,
        taxGroups,
        insurerPremiumShareFrozen: r.premium,
        insurerRoadsideShareFrozen: r.roadside,
      } as unknown as SettlementTrip;
      return { trip, retained, retainedTax, host: m(r.host), r };
    });

  describe(`jambes — ${country} (${currency.code})`, () => {
    it('Σ jambes = Σ lignes retenues + Σ taxe retenue ; PLATFORM = complément exact', () => {
      fc.assert(
        fc.property(tripArb, ({ trip, retained, retainedTax, host, r }) => {
          const legs = computeLegs(trip, retained, retainedTax, host);
          const lines = r.lines.reduce((a, b) => a + b, 0n);
          const taxes = r.groups.reduce((a, [t]) => a + t, 0n);
          expect(legs.total.amountMinor).toBe(lines + taxes);
          expect(LEGS.reduce((a, k) => a + legs[k].amountMinor, 0n)).toBe(lines + taxes);
          expect(legs.HOST.amountMinor).toBe(r.host);
          for (const k of LEGS) expect(legs[k].currency).toBe(currency.code);
        }),
        RUNS,
      );
    });

    it('INSURER : chaque part au plus proche, 0 ≤ INSURER ≤ protection + assistance', () => {
      fc.assert(
        fc.property(tripArb, ({ trip, retained, retainedTax, host, r }) => {
          const legs = computeLegs(trip, retained, retainedTax, host);
          const pr = retained.protection.amountMinor;
          const rd = retained.enhancedRoadside.amountMinor;
          const ins = legs.INSURER.amountMinor;
          expect(ins >= 0n && ins <= pr + rd).toBe(true);
          // |INSURER − (pr·p + rd·q)| ≤ 1 (deux arrondis au plus proche)
          const D = r.premium.den * r.roadside.den;
          const exact = pr * r.premium.num * r.roadside.den + rd * r.roadside.num * r.premium.den;
          const gap = ins * D - exact;
          expect((gap < 0n ? -gap : gap) <= D).toBe(true);
        }),
        RUNS,
      );
    });

    it('TAX_THIRD_PARTY = Σ taxe retenue des seuls groupes « pour compte de tiers »', () => {
      fc.assert(
        fc.property(tripArb, ({ trip, retained, retainedTax, host, r }) => {
          const legs = computeLegs(trip, retained, retainedTax, host);
          const third = r.groups.filter(([, tp]) => tp).reduce((a, [t]) => a + t, 0n);
          expect(legs.TAX_THIRD_PARTY.amountMinor).toBe(third);
        }),
        RUNS,
      );
    });
  });
}

// --------------------------------------------------------------------------- règlement

for (const { country, currency } of COUNTRY_VARIANTS) {
  const m = (minor: bigint): Money => money(minor, currency);
  const tripArb = fc
    .record({
      days: fc.integer({ min: 1, max: 30 }),
      refundable: fc.boolean(),
      bookedBeforeMinutes: fc.integer({ min: 1, max: 20 * 24 * 60 }),
      p: nonNegative,
      f: nonNegative,
      protection: nonNegative,
      delivery: nonNegative,
      taxPercent: fc.bigInt({ min: 0n, max: 30n }),
      share: fc.integer({ min: 0, max: 100 }),
    })
    .map((r): SettlementTrip => {
      const s = ratio(BigInt(r.share), 100n);
      // taxe de facture cohérente avec son assiette (P + F) : nulle si l'assiette est nulle
      const tax = ((r.p + r.f) * r.taxPercent) / 100n;
      return {
        currency,
        days: r.days,
        rateType: r.refundable ? 'REFUNDABLE' : 'NON_REFUNDABLE',
        startAtMs: T0_MS,
        bookedAtMs: at(-r.bookedBeforeMinutes),
        lines: {
          tripPrice: m(r.p),
          tripFee: m(r.f),
          protection: m(r.protection),
          delivery: m(r.delivery),
        },
        taxGroups: [
          { id: 'g', lines: ['tripPrice', 'tripFee'], taxPaid: m(tax), thirdParty: true },
        ],
        totalPaid: m(r.p + r.f + r.protection + r.delivery + tax),
        hostSharePctFrozen: s,
        deliverySharePct: s,
        extrasSharePct: s,
        ...TEST_INSURER_SHARES,
      };
    })
    // Total payé > 0 (ADR-090 ; nul : défaut fail-closed, Q-013).
    .filter((trip) => trip.totalPaid.amountMinor > 0n);
  const flags = {
    subReason: 'INVALID_LICENSE',
    evidenceValidated: true,
    checkinValidated: true,
    hostMessageTraced: true,
    hostNoShowReportedBefore: false,
    additionalDriverApproved: false,
  };
  let cached: ReturnType<typeof testParams> | undefined;
  // paresseux : aucun calcul à la collecte (mutants « statiques » de Stryker)
  const paramsOf = () =>
    (cached ??= testParams(currency, { platformFundedHostCompensation: true }));

  describe(`règlement — ${country} (${currency.code})`, () => {
    it('annulation du voyageur : plus la demande est tardive, moins le remboursement est élevé', () => {
      fc.assert(
        fc.property(
          tripArb,
          fc.integer({ min: -20 * 24 * 60, max: 72 * 60 }),
          fc.integer({ min: -20 * 24 * 60, max: 72 * 60 }),
          (trip, a, b) => {
            const booked = (trip.bookedAtMs - T0_MS) / 60_000;
            const [early, late] = [Math.max(booked, Math.min(a, b)), Math.max(booked, a, b)];
            const refund = (min: number) =>
              computeCancellationSettlement(
                trip,
                { reason: 'GUEST_CANCELLED', requestedAtMs: at(min), ...flags },
                paramsOf(),
              ).guestRefund.amountMinor;
            expect(refund(early) >= refund(late)).toBe(true);
          },
        ),
        RUNS,
      );
    });

    it('motif FULL (hôte, plateforme) : tout est remboursé, rien n’est retenu', () => {
      const full = ['HOST_CANCELLED', 'HOST_NO_SHOW', 'HOST_ACCOUNT_CLOSED', 'PSP_FAILURE'];
      fc.assert(
        fc.property(
          tripArb,
          fc.constantFrom(...full),
          fc.integer({ min: -48 * 60, max: 72 * 60 }),
          (trip, reason, min) => {
            const s = computeCancellationSettlement(
              trip,
              { reason, requestedAtMs: at(min), ...flags },
              paramsOf(),
            );
            expect(s.guestRefund.amountMinor).toBe(trip.totalPaid.amountMinor);
            expect(s.retained.amountMinor + s.retainedTax.amountMinor).toBe(0n);
            expect(s.settledLegs.total.amountMinor).toBe(0n);
            expect(s.hostFromGuest.amountMinor).toBe(0n);
          },
        ),
        RUNS,
      );
    });

    it('part hôte ≤ retenu HT (sans promo plateforme) ; net plateforme ≥ 0 hors compensation', () => {
      fc.assert(
        fc.property(
          tripArb,
          fc.constantFrom(...BETA_CANCELLATION_REASONS),
          fc.integer({ min: 60, max: 72 * 60 }),
          (trip, reason, min) => {
            const s = computeCancellationSettlement(
              trip,
              { reason, requestedAtMs: at(min), ...flags },
              paramsOf(),
            );
            expect(s.hostFromGuest.amountMinor <= s.retained.amountMinor).toBe(true);
            expect(s.platformNet.amountMinor + s.hostCompensation.amountMinor >= 0n).toBe(true);
            for (const k of LEGS) expect(s.settledLegs[k].currency).toBe(currency.code);
          },
        ),
        RUNS,
      );
    });
  });
}
