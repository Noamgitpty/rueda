/**
 * US-017 — propriétés du moteur (fast-check), en PA (USD) et PY (PYG) : invariants de 08 vérifiés
 * par arithmétique entière, jamais en recalculant un montant attendu avec le code testé.
 * - équilibre : remboursement + Σ retenu HT + taxe retenue = total payé ;
 * - Σ jambes = total de l'état ; variation capture → règlement = − remboursement ;
 * - remboursement de taxe ≤ taxe payée, par groupe ; gains hôte ≥ 0 (plancher, T63) ;
 * - résultat indépendant de l'initiateur (le moteur n'en reçoit pas) et déterministe (pur).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BETA_CANCELLATION_REASONS,
  LEGS,
  computeCancellationSettlement,
  money,
  ratio,
  type CancellationEvent,
  type SettlementTrip,
} from '../../src/index.ts';
import { COUNTRY_VARIANTS } from '../fixtures.ts';
import { TEST_INSURER_SHARES, T0_MS, at, testParams } from './adapter.ts';

const RUNS = { numRuns: 500 };
const amount = fc.bigInt({ min: 0n, max: 10n ** 9n });

for (const { country, currency } of COUNTRY_VARIANTS) {
  const tripArb = fc
    .record({
      days: fc.integer({ min: 1, max: 30 }),
      refundable: fc.boolean(),
      bookedBeforeMinutes: fc.integer({ min: 1, max: 14 * 24 * 60 }),
      p: amount,
      promoPlatform: fc.bigInt({ min: 0n, max: 10n ** 6n }),
      promoHost: fc.bigInt({ min: 0n, max: 10n ** 6n }),
      f: amount,
      protection: amount,
      extras: amount,
      roadside: amount,
      driver: amount,
      delivery: amount,
      taxTenths: fc.bigInt({ min: 0n, max: 10n ** 7n }),
      share: fc.integer({ min: 0, max: 100 }),
    })
    .map((r): SettlementTrip => {
      const m = (x: bigint) => money(x, currency);
      const promoPlatform = -(r.promoPlatform < r.p ? r.promoPlatform : 0n);
      const promoHost = -(r.promoHost < r.p ? r.promoHost : 0n);
      const taxPaid = r.taxTenths; // taxe de facture figée, entrée libre
      const total = r.p + promoPlatform + promoHost + r.f + r.protection + r.extras;
      const rest = r.roadside + r.driver + r.delivery + taxPaid;
      const share = ratio(BigInt(r.share), 100n);
      return {
        currency,
        days: r.days,
        rateType: r.refundable ? 'REFUNDABLE' : 'NON_REFUNDABLE',
        startAtMs: T0_MS,
        bookedAtMs: at(-r.bookedBeforeMinutes),
        lines: {
          tripPrice: m(r.p),
          promoPlatform: m(promoPlatform),
          promoHost: m(promoHost),
          tripFee: m(r.f),
          protection: m(r.protection),
          extras: m(r.extras),
          enhancedRoadside: m(r.roadside),
          additionalDriver: m(r.driver),
          delivery: m(r.delivery),
        },
        taxGroups: [
          {
            id: 'g',
            lines: ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee'],
            taxPaid: m(taxPaid),
            thirdParty: false,
          },
        ],
        totalPaid: m(total + rest),
        hostSharePctFrozen: share,
        deliverySharePct: share,
        extrasSharePct: share,
        ...TEST_INSURER_SHARES,
      };
    });

  const eventArb = fc.record({
    reason: fc.constantFrom(...BETA_CANCELLATION_REASONS),
    minutes: fc.integer({ min: -10 * 24 * 60, max: 72 * 60 }),
    flags: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
  });

  describe(`propriétés du règlement — ${country} (${currency.code})`, () => {
    it('équilibre, jambes, plancher hôte, déterminisme', () => {
      fc.assert(
        fc.property(tripArb, eventArb, (trip, e) => {
          const [evidence, checkin, traced, reported, driver] = e.flags;
          const event: CancellationEvent = {
            reason: e.reason,
            requestedAtMs: at(e.minutes),
            subReason: 'INVALID_LICENSE',
            evidenceValidated: evidence,
            checkinValidated: checkin,
            hostMessageTraced: traced,
            hostNoShowReportedBefore: reported,
            additionalDriverApproved: driver,
          };
          const params = testParams(currency, { platformFundedHostCompensation: true });
          let s;
          try {
            s = computeCancellationSettlement(trip, event, params);
          } catch (error) {
            // Seul refus admis : no-show déclaré trop tôt (08, règle 3).
            expect((error as { code?: string }).code).toBe('REJECTED_TOO_EARLY');
            return;
          }
          const total = trip.totalPaid.amountMinor;
          expect(
            s.guestRefund.amountMinor + s.retained.amountMinor + s.retainedTax.amountMinor,
          ).toBe(total);
          expect(s.guestRefund.amountMinor <= total).toBe(true);
          for (const g of trip.taxGroups) {
            const refunded = s.taxRefundByGroup[g.id]?.amountMinor ?? -1n;
            expect(refunded >= 0n && refunded <= g.taxPaid.amountMinor).toBe(true);
          }
          expect(s.hostFromGuest.amountMinor >= 0n).toBe(true);
          expect(s.hostCompensation.amountMinor >= 0n).toBe(true);
          for (const legs of [s.captureLegs, s.settledLegs, s.legVariation]) {
            expect(LEGS.reduce((a, k) => a + legs[k].amountMinor, 0n)).toBe(legs.total.amountMinor);
          }
          expect(s.captureLegs.total.amountMinor).toBe(total);
          expect(s.legVariation.total.amountMinor).toBe(-s.guestRefund.amountMinor);
          expect(computeCancellationSettlement(trip, event, params)).toEqual(s);
        }),
        RUNS,
      );
    });
  });
}
