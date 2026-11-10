/**
 * ADR-090 — refus fail-closed d'un trip ou d'un devis que 08 n'autorise pas, en PA (USD) et PY (PYG).
 *
 * Règles (08, jamais le code testé) :
 * - pseudo-code BR-CXL `LINES` : « promoPlatform ≤ 0 et promoHost ≤ 0 » ; les autres lignes sont
 *   des prix ≥ 0 ⇒ `LINE_SIGN_INVALID` ;
 * - BR-PAY-07 : un code promo s'applique « sur le prix du véhicule seulement » ; E7 règle 5 : un code
 *   trop fort est refusé au checkout ⇒ Σ promos ≥ −P, sinon `PROMO_EXCEEDS_TRIP_PRICE` ; une promo
 *   à 100 % (VERIF_09-m02) est admise ;
 * - E1 : `0 ≤ refund_committed ≤ collected_total` ⇒ total payé négatif interdit ; total nul : défaut
 *   fail-closed (PROPOSÉ, Q-013) ⇒ `TOTAL_PAID_NOT_POSITIVE`.
 * L'oracle `independent_settlement_check.py` rend, sur le contre-exemple ci-dessous, un total de −1,
 * un remboursement de 0 et des gains hôte de −864 210 : il viole son propre invariant de fuzz
 * `0 ≤ guest ≤ total`, preuve que ce trip est hors du domaine de 08.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BETA_CANCELLATION_REASONS,
  CANCELLATION_ENGINE_VERSION,
  SettlementError,
  isSettlementError,
  SETTLEMENT_LINES,
  assertPayableAmounts,
  buildSettlementRecord,
  computeCancellationSettlement,
  money,
  ratio,
  type CancellationEvent,
  type Currency,
  type SettlementLine,
  type SettlementTrip,
} from '../../src/index.ts';
import { COUNTRY_VARIANTS, PYG, USD } from '../fixtures.ts';
import { TEST_INSURER_SHARES, T0_MS, at, testParams } from './adapter.ts';

const RUNS = { numRuns: 300 };
const PROMOS: readonly SettlementLine[] = ['promoPlatform', 'promoHost'];
const PRICED = SETTLEMENT_LINES.filter((l) => !PROMOS.includes(l));

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
  return undefined;
}

/** Trip non remboursable d'un jour, sans taxe ; total = Σ lignes + taxe (cohérent par construction). */
function tripOf(
  currency: Currency,
  lines: Partial<Record<SettlementLine, bigint>>,
  taxPaid = 0n,
  share = ratio(0n, 1n),
): SettlementTrip {
  const m = (x: bigint) => money(x, currency);
  const all = Object.fromEntries(SETTLEMENT_LINES.map((l) => [l, m(lines[l] ?? 0n)])) as Record<
    SettlementLine,
    ReturnType<typeof m>
  >;
  const total = SETTLEMENT_LINES.reduce((a, l) => a + (lines[l] ?? 0n), 0n) + taxPaid;
  return {
    currency,
    days: 1,
    rateType: 'NON_REFUNDABLE',
    startAtMs: T0_MS,
    bookedAtMs: at(-1),
    lines: all,
    taxGroups: [
      {
        id: 'g',
        lines: ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee'],
        taxPaid: m(taxPaid),
        thirdParty: false,
      },
    ],
    totalPaid: m(total),
    hostSharePctFrozen: share,
    deliverySharePct: share,
    extrasSharePct: share,
    ...TEST_INSURER_SHARES,
  };
}

/** Événement du contre-exemple : no-show du voyageur à T, aucun fait établi. */
const NO_SHOW_AT_T: CancellationEvent = {
  reason: 'GUEST_NO_SHOW',
  requestedAtMs: at(0),
  subReason: 'INVALID_LICENSE',
  evidenceValidated: false,
  checkinValidated: false,
  hostMessageTraced: false,
  hostNoShowReportedBefore: false,
  additionalDriverApproved: false,
};

describe('régression — graine fast-check -1390209851 (run 42167466075)', () => {
  // Contre-exemple exact du journal : P 864 211, promo plateforme −2, promo hôte −864 210, total −1.
  const counterexample = { tripPrice: 864_211n, promoPlatform: -2n, promoHost: -864_210n };

  for (const currency of [PYG, USD]) {
    it(`${currency.code} : promos au-delà du prix ⇒ PROMO_EXCEEDS_TRIP_PRICE, au règlement, à la version persistée et au devis`, () => {
      const trip = tripOf(currency, counterexample);
      expect(trip.totalPaid.amountMinor).toBe(-1n);
      const params = testParams(currency, { platformFundedHostCompensation: true });
      expect(codeOf(() => computeCancellationSettlement(trip, NO_SHOW_AT_T, params))).toBe(
        'PROMO_EXCEEDS_TRIP_PRICE',
      );
      expect(codeOf(() => buildSettlementRecord(trip, NO_SHOW_AT_T, params))).toBe(
        'PROMO_EXCEEDS_TRIP_PRICE',
      );
      expect(codeOf(() => assertPayableAmounts(trip))).toBe('PROMO_EXCEEDS_TRIP_PRICE');
    });
  }

  it('graine -1970700454 (trouvée en rejouant) : promo à 100 % sur une égalité ⇒ REFUND_OUT_OF_RANGE, en USD et en PYG', () => {
    // P 3, promo hôte −3, F 1, taxe figée 1, remboursable 1 jour, PLATFORM_INCOMPLETE_STEPS à T :
    // l'oracle rend remboursement −2 (−1 HT, −1 de taxe), contraire à 08 E1 (0 ≤ remboursement).
    for (const currency of [USD, PYG]) {
      const trip = {
        ...tripOf(currency, { tripPrice: 3n, promoHost: -3n, tripFee: 1n }, 1n),
        rateType: 'REFUNDABLE' as const,
      };
      const params = testParams(currency, { platformFundedHostCompensation: true });
      const event = { ...NO_SHOW_AT_T, reason: 'PLATFORM_INCOMPLETE_STEPS' as const };
      expect([
        currency.code,
        codeOf(() => computeCancellationSettlement(trip, event, params)),
      ]).toEqual([currency.code, 'REFUND_OUT_OF_RANGE']);
      expect(codeOf(() => buildSettlementRecord(trip, event, params))).toBe('REFUND_OUT_OF_RANGE');
      // Le même trip annulé en motif FULL (tout remboursé) reste réglé : seul l'arrondi est en cause.
      expect(
        codeOf(() =>
          computeCancellationSettlement(trip, { ...event, reason: 'HOST_CANCELLED' }, params),
        ),
      ).toBe(undefined);
    }
  });

  it('graine -1546341607 (contre-exemple réduit du rejeu) : remboursement négatif ⇒ REFUND_OUT_OF_RANGE, en USD et en PYG', () => {
    // Contre-exemple exact de la graine : P 2, promo plateforme −2, F 1, taxe figée 1, 1 jour,
    // remboursable, GUEST_CANCELLED à +60 min (requalifié GUEST_NO_SHOW à noShowAt), total 2.
    // L'oracle rend remboursement −2 (taxe remboursée −1), contraire à 08 E1 (0 ≤ remboursement).
    for (const currency of [USD, PYG]) {
      const base = tripOf(currency, { tripPrice: 2n, promoPlatform: -2n, tripFee: 1n }, 1n);
      const trip: SettlementTrip = { ...base, rateType: 'REFUNDABLE' };
      expect(trip.totalPaid.amountMinor).toBe(2n);
      const params = testParams(currency, { platformFundedHostCompensation: true });
      const event = { ...NO_SHOW_AT_T, reason: 'GUEST_CANCELLED' as const, requestedAtMs: at(60) };
      expect([
        currency.code,
        codeOf(() => computeCancellationSettlement(trip, event, params)),
      ]).toEqual([currency.code, 'REFUND_OUT_OF_RANGE']);
      expect(codeOf(() => buildSettlementRecord(trip, event, params))).toBe('REFUND_OUT_OF_RANGE');
    }
  });

  it('REFUND_OUT_OF_RANGE porte le contexte de l’alerte FIN, sans donnée personnelle', () => {
    const base = tripOf(PYG, { tripPrice: 2n, promoPlatform: -2n, tripFee: 1n }, 1n);
    const trip: SettlementTrip = { ...base, rateType: 'REFUNDABLE' };
    const event = { ...NO_SHOW_AT_T, reason: 'GUEST_CANCELLED' as const, requestedAtMs: at(60) };
    const params = testParams(PYG, { platformFundedHostCompensation: true });
    let caught: unknown;
    try {
      computeCancellationSettlement(trip, event, params);
    } catch (error) {
      caught = error;
    }
    expect(isSettlementError(caught, 'REFUND_OUT_OF_RANGE')).toBe(true);
    // Attendus : entrées (total 2, devise, motif requalifié par 08 `qualify` règle 1) et montants
    // de l'oracle (remboursement −2, taxe remboursée −1, retenu HT 2).
    expect((caught as SettlementError).details).toEqual({
      engineVersion: CANCELLATION_ENGINE_VERSION,
      currency: 'PYG',
      reason: 'GUEST_NO_SHOW',
      guestRefundMinor: '-2',
      totalPaidMinor: '2',
      retainedMinor: '2',
      taxRefundMinor: '-1',
      taxGroupId: 'g',
    });
    expect(Object.isFrozen((caught as SettlementError).details)).toBe(true);
    expect((caught as Error).message).toContain('groupe g');
    // Remboursement seul hors bornes (taxe dans les bornes) : pas de groupe dans le contexte.
    const variant: SettlementTrip = {
      ...tripOf(PYG, { tripPrice: 6n, promoPlatform: -3n, promoHost: -3n, tripFee: 1n }),
      days: 9,
      rateType: 'REFUNDABLE',
    };
    try {
      computeCancellationSettlement(variant, event, params);
    } catch (error) {
      caught = error;
    }
    expect((caught as SettlementError).details).toEqual({
      engineVersion: CANCELLATION_ENGINE_VERSION,
      currency: 'PYG',
      reason: 'GUEST_NO_SHOW',
      guestRefundMinor: '2',
      totalPaidMinor: '1',
      retainedMinor: '-1',
      taxRefundMinor: '0',
    });
    expect((caught as Error).message).toContain('remboursement 2 hors de [0 ; 1]');
  });

  it('variante (trouvée hors de la graine) : retenue HT négative ⇒ remboursement > total ⇒ REFUND_OUT_OF_RANGE', () => {
    // P 6, promos −3 et −3, F 1, 9 jours, no-show du voyageur (annulation reçue à noShowAt) :
    // l'oracle rend retenue −1 et remboursement 2 pour un total payé de 1 (08 E1 : remboursement ≤ encaissé).
    for (const currency of [USD, PYG]) {
      const base = tripOf(currency, {
        tripPrice: 6n,
        promoPlatform: -3n,
        promoHost: -3n,
        tripFee: 1n,
      });
      const trip: SettlementTrip = { ...base, days: 9, rateType: 'REFUNDABLE' };
      const params = testParams(currency, { platformFundedHostCompensation: true });
      const event = { ...NO_SHOW_AT_T, reason: 'GUEST_CANCELLED' as const, requestedAtMs: at(60) };
      expect(codeOf(() => computeCancellationSettlement(trip, event, params))).toBe(
        'REFUND_OUT_OF_RANGE',
      );
    }
  });

  it('taxe remboursée > taxe payée d’un groupe, remboursement total ≤ total payé ⇒ REFUND_OUT_OF_RANGE', () => {
    // Même trip, taxe figée 1 et livraison 10 hors groupe (retenue ½) : la taxe remboursée du groupe
    // vaut 2 > 1 alors que le remboursement reste sous le total.
    for (const currency of [USD, PYG]) {
      const base = tripOf(
        currency,
        { tripPrice: 6n, promoPlatform: -3n, promoHost: -3n, tripFee: 1n, delivery: 10n },
        1n,
      );
      const trip: SettlementTrip = { ...base, days: 9, rateType: 'REFUNDABLE' };
      const params = testParams(currency, { platformFundedHostCompensation: true });
      const event = { ...NO_SHOW_AT_T, reason: 'GUEST_CANCELLED' as const, requestedAtMs: at(60) };
      expect(codeOf(() => computeCancellationSettlement(trip, event, params))).toBe(
        'REFUND_OUT_OF_RANGE',
      );
    }
  });

  it('taxe remboursée négative d’un groupe, remboursement total positif ⇒ REFUND_OUT_OF_RANGE', () => {
    for (const currency of [USD, PYG]) {
      const base = tripOf(
        currency,
        { tripPrice: 3n, promoHost: -3n, tripFee: 1n, extras: 100n },
        1n,
      );
      const trip: SettlementTrip = { ...base, rateType: 'REFUNDABLE' };
      const params = testParams(currency, { platformFundedHostCompensation: true });
      const event = { ...NO_SHOW_AT_T, reason: 'PLATFORM_INCOMPLETE_STEPS' as const };
      expect(codeOf(() => computeCancellationSettlement(trip, event, params))).toBe(
        'REFUND_OUT_OF_RANGE',
      );
    }
  });

  it('la graine et le chemin de rejeu sont imprimés à chaque échec de propriété', () => {
    let message = '';
    try {
      fc.assert(
        fc.property(fc.integer(), (n) => n !== n),
        { seed: -1390209851 },
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('seed: -1390209851');
    expect(message).toMatch(/path: "[0-9:]+"/);
  });
});

for (const { country, currency } of COUNTRY_VARIANTS) {
  const m = (x: bigint) => money(x, currency);

  describe(`bornes de la garde — ${country} (${currency.code})`, () => {
    it('promo à 100 % du prix admise ; une unité de plus refusée', () => {
      expect(
        codeOf(() =>
          assertPayableAmounts(
            tripOf(currency, { tripPrice: 500n, promoHost: -500n, tripFee: 1n }),
          ),
        ),
      ).toBe(undefined);
      expect(
        codeOf(() =>
          assertPayableAmounts(
            tripOf(currency, {
              tripPrice: 500n,
              promoPlatform: -200n,
              promoHost: -300n,
              tripFee: 1n,
            }),
          ),
        ),
      ).toBe(undefined);
      for (const [pp, ph] of [
        [-501n, 0n],
        [0n, -501n],
        [-250n, -251n],
      ] as const) {
        expect(
          codeOf(() =>
            assertPayableAmounts(
              tripOf(currency, { tripPrice: 500n, promoPlatform: pp, promoHost: ph, tripFee: 9n }),
            ),
          ),
        ).toBe('PROMO_EXCEEDS_TRIP_PRICE');
      }
    });

    it('TAX_PAID_NEGATIVE porte le groupe et le montant ; les autres refus n’ont pas de contexte', () => {
      const caught = (fn: () => unknown): SettlementError => {
        try {
          fn();
        } catch (error) {
          return error as SettlementError;
        }
        throw new Error('refus attendu');
      };
      const tax = caught(() => assertPayableAmounts(tripOf(currency, { tripFee: 5n }, -3n)));
      expect(tax.code).toBe('TAX_PAID_NEGATIVE');
      expect(tax.details).toEqual({ currency: currency.code, taxGroupId: 'g', taxPaidMinor: '-3' });
      const sign = caught(() => assertPayableAmounts(tripOf(currency, { tripFee: -1n })));
      expect(sign.code).toBe('LINE_SIGN_INVALID');
      expect(sign.details).toBe(undefined);
    });

    it('promo positive refusée ; promo nulle admise', () => {
      for (const promo of PROMOS) {
        expect(
          codeOf(() => assertPayableAmounts(tripOf(currency, { tripPrice: 10n, [promo]: 1n }))),
        ).toBe('LINE_SIGN_INVALID');
        expect(
          codeOf(() => assertPayableAmounts(tripOf(currency, { tripPrice: 10n, [promo]: 0n }))),
        ).toBe(undefined);
      }
    });

    it('prix négatif refusé, ligne par ligne ; prix nul admis', () => {
      for (const l of PRICED) {
        const others = l === 'tripFee' ? { tripPrice: 100n } : { tripFee: 100n };
        expect([
          l,
          codeOf(() => assertPayableAmounts(tripOf(currency, { ...others, [l]: -1n }))),
        ]).toEqual([l, 'LINE_SIGN_INVALID']);
        expect([
          l,
          codeOf(() => assertPayableAmounts(tripOf(currency, { ...others, [l]: 0n }))),
        ]).toEqual([l, undefined]);
      }
    });

    it('total payé 0 ou négatif refusé ; 1 admis', () => {
      expect(codeOf(() => assertPayableAmounts(tripOf(currency, {})))).toBe(
        'TOTAL_PAID_NOT_POSITIVE',
      );
      expect(
        codeOf(() => assertPayableAmounts(tripOf(currency, { tripPrice: 7n, promoHost: -7n }))),
      ).toBe('TOTAL_PAID_NOT_POSITIVE');
      expect(codeOf(() => assertPayableAmounts(tripOf(currency, {}, -1n)))).toBe(
        'TAX_PAID_NEGATIVE',
      );
      // Devis sans taxe encore calculée : seul le total est contrôlé.
      expect(codeOf(() => assertPayableAmounts({ currency, lines: {}, totalPaid: m(-1n) }))).toBe(
        'TOTAL_PAID_NOT_POSITIVE',
      );
      expect(codeOf(() => assertPayableAmounts(tripOf(currency, {}, 1n)))).toBe(undefined);
      expect(codeOf(() => assertPayableAmounts(tripOf(currency, { tripFee: 1n })))).toBe(undefined);
    });

    it('lignes absentes lues comme 0 ; une ligne d’une autre devise est refusée', () => {
      expect(
        codeOf(() =>
          assertPayableAmounts({ currency, lines: { tripFee: m(1n) }, totalPaid: m(1n) }),
        ),
      ).toBe(undefined);
      const other = currency.code === USD.code ? PYG : USD;
      expect(
        codeOf(() =>
          assertPayableAmounts({
            currency,
            lines: { tripFee: money(1n, other) },
            totalPaid: m(1n),
          }),
        ),
      ).toBe('MONEY_CURRENCY_MISMATCH');
    });
  });

  describe(`propriétés de refus — ${country} (${currency.code})`, () => {
    const amount = fc.bigInt({ min: 0n, max: 10n ** 9n });
    const eventArb = fc.record({
      reason: fc.constantFrom(...BETA_CANCELLATION_REASONS),
      minutes: fc.integer({ min: -10 * 24 * 60, max: 72 * 60 }),
    });
    const settleCode = (trip: SettlementTrip, e: { reason: string; minutes: number }) =>
      codeOf(() =>
        computeCancellationSettlement(
          trip,
          {
            ...NO_SHOW_AT_T,
            reason: e.reason as CancellationEvent['reason'],
            requestedAtMs: at(e.minutes),
          },
          testParams(currency, { platformFundedHostCompensation: true }),
        ),
      );

    it('Σ promos > prix du véhicule ⇒ PROMO_EXCEEDS_TRIP_PRICE, quel que soit le reste du trip', () => {
      fc.assert(
        fc.property(
          amount,
          fc.bigInt({ min: 1n, max: 10n ** 6n }),
          fc.integer({ min: 0, max: 100 }),
          amount,
          amount,
          fc.bigInt({ min: 0n, max: 10n ** 7n }),
          eventArb,
          (p, excess, split, f, protection, tax, e) => {
            const promos = p + excess;
            const pp = (promos * BigInt(split)) / 100n;
            const trip = tripOf(
              currency,
              {
                tripPrice: p,
                promoPlatform: -pp,
                promoHost: -(promos - pp),
                tripFee: f,
                protection,
              },
              tax,
            );
            expect(codeOf(() => assertPayableAmounts(trip))).toBe('PROMO_EXCEEDS_TRIP_PRICE');
            expect(settleCode(trip, e)).toBe('PROMO_EXCEEDS_TRIP_PRICE');
          },
        ),
        RUNS,
      );
    });

    it('lignes valides, taxe nulle et total payé nul ⇒ TOTAL_PAID_NOT_POSITIVE', () => {
      fc.assert(
        fc.property(amount, fc.integer({ min: 0, max: 100 }), eventArb, (p, split, e) => {
          const pp = (p * BigInt(split)) / 100n;
          const trip = tripOf(currency, { tripPrice: p, promoPlatform: -pp, promoHost: -(p - pp) });
          expect(trip.totalPaid.amountMinor).toBe(0n);
          expect(codeOf(() => assertPayableAmounts(trip))).toBe('TOTAL_PAID_NOT_POSITIVE');
          expect(settleCode(trip, e)).toBe('TOTAL_PAID_NOT_POSITIVE');
        }),
        RUNS,
      );
    });

    it('taxe payée négative d’un groupe ⇒ TAX_PAID_NEGATIVE, avant tout calcul de remboursement', () => {
      fc.assert(
        fc.property(
          amount,
          amount,
          fc.bigInt({ min: 1n, max: 10n ** 6n }),
          eventArb,
          (p, f, minus, e) => {
            const trip = tripOf(currency, { tripPrice: p, tripFee: f }, -minus);
            expect(codeOf(() => assertPayableAmounts(trip))).toBe('TAX_PAID_NEGATIVE');
            expect(settleCode(trip, e)).toBe('TAX_PAID_NEGATIVE');
          },
        ),
        RUNS,
      );
    });

    it('devis sans taxe, total payé ≤ 0 ⇒ TOTAL_PAID_NOT_POSITIVE', () => {
      fc.assert(
        fc.property(fc.bigInt({ min: -(10n ** 9n), max: 0n }), (total) => {
          expect(
            codeOf(() => assertPayableAmounts({ currency, lines: {}, totalPaid: m(total) })),
          ).toBe('TOTAL_PAID_NOT_POSITIVE');
        }),
        RUNS,
      );
    });

    it('promo positive ou prix négatif ⇒ LINE_SIGN_INVALID', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SETTLEMENT_LINES),
          fc.bigInt({ min: 1n, max: 10n ** 9n }),
          amount,
          eventArb,
          (l, bad, f, e) => {
            const value = PROMOS.includes(l) ? bad : -bad;
            const base = l === 'tripFee' ? { tripPrice: f + bad + 1n } : { tripFee: f + bad + 1n };
            const trip = tripOf(currency, { ...base, [l]: value });
            expect(codeOf(() => assertPayableAmounts(trip))).toBe('LINE_SIGN_INVALID');
            expect(settleCode(trip, e)).toBe('LINE_SIGN_INVALID');
          },
        ),
        RUNS,
      );
    });

    it('Σ promos ≤ prix et total > 0 ⇒ admis par la garde', () => {
      fc.assert(
        fc.property(
          amount,
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          amount,
          (p, a, b, f) => {
            const pp = (p * BigInt(a)) / 100n;
            const ph = ((p - pp) * BigInt(b)) / 100n;
            const trip = tripOf(currency, {
              tripPrice: p,
              promoPlatform: -pp,
              promoHost: -ph,
              tripFee: f + 1n,
            });
            expect(codeOf(() => assertPayableAmounts(trip))).toBe(undefined);
          },
        ),
        RUNS,
      );
    });
  });
}
