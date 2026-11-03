/**
 * Adaptateur de test US-017 : vecteur doré (US-016) → entrées du moteur ; règlement → observation
 * comparée par le harnais. Il ne calcule **aucun montant** : les attendus restent ceux de l'export
 * des oracles Python (`docs/specs/tools/golden_vectors.json`).
 *
 * Seules données écrites ici, toutes des **entrées** recopiées de 08 (jamais des attendus) :
 * - les paramètres de la configuration de test de 08 (« Jeux de tests de référence » :
 *   `noShowGraceMinutes` = 60, `lastMinuteThreshold` = 25 h, fenêtre gratuite 24 h) ;
 * - le barème `HOST_PENALTY[pays]` du pseudo-code de 08 (`penalty`), valeurs de test d'OQ-BR-24 ;
 * - les parts assureur de test de 08 E7 (7/10, 1/2), absentes de l'export ;
 * - les conventions de l'export pour les drapeaux non écrits (08 : « message + 15 min tracés »
 *   sauf mention ; aucun check-in ; aucune absence de l'hôte signalée ; conducteur additionnel non
 *   approuvé sauf mention) et le sous-motif d'une preuve validée (T07 : permis expiré au retrait).
 */
import {
  SETTLEMENT_AMOUNT_FIELDS,
  type GoldenEvent,
  type GoldenRatio,
  type GoldenSettlementVector,
  type GoldenTrip,
  type LegObservation,
  type SettlementObservation,
} from '../../src/golden-vectors/index.ts';
import {
  computeCancellationSettlement,
  money,
  ratio,
  type CancellationEvent,
  type CancellationSettlement,
  type Currency,
  type HostPenaltySchedule,
  type Legs,
  type Ratio,
  type SettlementLine,
  type SettlementParams,
  type SettlementTrip,
} from '../../src/index.ts';
import { PYG, USD, registry } from '../fixtures.ts';

/** Départ T = 0 des vecteurs (instant arbitraire ; seuls les écarts à T comptent). */
export const T0_MS = Date.UTC(2026, 0, 14, 15, 0, 0);
const MINUTE_MS = 60_000;
export const at = (minutes: number): number => T0_MS + minutes * MINUTE_MS;

const toRatio = (r: GoldenRatio): Ratio => ratio(r.numerator, r.denominator);

/** Parts assureur de la configuration de test de 08 E7 (« valeurs de test »). */
export const TEST_INSURER_SHARES = {
  insurerPremiumShareFrozen: ratio(7n, 10n),
  insurerRoadsideShareFrozen: ratio(1n, 2n),
} as const;

/** Barème `HOST_PENALTY[pays]` du pseudo-code de 08 (unités mineures ; PY PROPOSÉ, OQ-BR-24). */
const TEST_HOST_PENALTY: Readonly<Record<string, readonly [bigint, bigint, bigint, bigint]>> = {
  USD: [2_500n, 5_000n, 15_000n, 5_000n],
  PYG: [200_000n, 400_000n, 1_200_000n, 400_000n],
};

export function testParams(
  currency: Currency,
  overrides: Partial<SettlementParams> = {},
): SettlementParams {
  const p = TEST_HOST_PENALTY[currency.code];
  if (!p) throw new Error(`barème de test absent pour ${currency.code}`);
  const hostPenalty: HostPenaltySchedule = {
    cxlEarly: money(p[0], currency),
    cxlLate: money(p[1], currency),
    hostNoShow: money(p[2], currency),
    cleanliness: money(p[3], currency),
  };
  return {
    noShowGraceMinutes: 60,
    lastMinuteThresholdHours: 25,
    freeCancelLeadHours: 24,
    hostPenalty,
    ...overrides,
  };
}

/** Lignes de l'export → lignes du moteur (mêmes noms ; `youngDriver` absent = 0). */
export function toTrip(t: GoldenTrip): SettlementTrip {
  const currency = registry.get(t.currency);
  const lines: Partial<Record<SettlementLine, ReturnType<typeof money>>> = {};
  for (const [name, amount] of Object.entries(t.linesMinor)) {
    lines[name as SettlementLine] = money(amount, currency);
  }
  return {
    currency,
    days: t.days,
    rateType: t.rate,
    startAtMs: T0_MS,
    bookedAtMs: at(t.bookedAtMinutes),
    lines,
    taxGroups: t.taxGroups.map((g) => ({
      id: g.id,
      lines: g.lines,
      taxPaid: money(g.taxPaidMinor, currency),
      thirdParty: false,
    })),
    totalPaid: money(t.totalPaidMinor, currency),
    hostSharePctFrozen: toRatio(t.hostSharePct),
    deliverySharePct: toRatio(t.deliverySharePct),
    extrasSharePct: toRatio(t.extrasSharePct),
    ...TEST_INSURER_SHARES,
  };
}

export function toEvent(e: GoldenEvent): CancellationEvent {
  if (e.hostEligibleOverride !== undefined)
    throw new Error('surcharge d’éligibilité : sonde, non rejouée');
  if (e.requestedAtMinutes === undefined) throw new Error(`${e.reason} : fin anticipée, hors bêta`);
  return {
    reason: e.reason,
    requestedAtMs: at(e.requestedAtMinutes),
    ...(e.evidenceValidated === true ? { subReason: 'INVALID_LICENSE' } : {}),
    evidenceValidated: e.evidenceValidated ?? false,
    checkinValidated: e.checkedIn ?? false,
    hostMessageTraced: e.hostMessageTraced ?? true,
    hostNoShowReportedBefore: e.hostNoShowReported ?? false,
    additionalDriverApproved: e.additionalDriverApproved ?? false,
  };
}

/** Champs comparés : colonnes de 08 et détail de l'oracle (hors pénalité en unités majeures). */
export const COMPARED_FIELDS = SETTLEMENT_AMOUNT_FIELDS.filter((f) => f !== 'hostPenaltyMajor');

export function toObservation(s: CancellationSettlement): SettlementObservation {
  return {
    guestRefundMinor: s.guestRefund.amountMinor,
    taxRefundedMinor: s.taxRefund.amountMinor,
    hostEarningsMinor: s.hostEarnings.amountMinor,
    platformNetMinor: s.platformNet.amountMinor,
    hostPenaltyMinor: s.hostPenalty.amountMinor,
    retainedMinor: s.retained.amountMinor,
    retainedTaxMinor: s.retainedTax.amountMinor,
    hostFromGuestMinor: s.hostFromGuest.amountMinor,
    hostCompensationMinor: s.hostCompensation.amountMinor,
  };
}

export function toLegObservation(l: Legs): LegObservation {
  return {
    legsMinor: {
      HOST: l.HOST.amountMinor,
      INSURER: l.INSURER.amountMinor,
      TAX_THIRD_PARTY: l.TAX_THIRD_PARTY.amountMinor,
      PLATFORM: l.PLATFORM.amountMinor,
    },
    totalMinor: l.total.amountMinor,
  };
}

/** Rejoue un vecteur de règlement avec les paramètres de test (et d'éventuelles options). */
export function settleVector(
  v: GoldenSettlementVector,
  overrides: Partial<SettlementParams> = {},
): CancellationSettlement {
  const trip = toTrip(v.trip);
  return computeCancellationSettlement(
    trip,
    toEvent(v.event),
    testParams(trip.currency, overrides),
  );
}

/** Part du plan `ESTÁNDAR` de la configuration de test de 08 E7 (3/4). */
const TEST_PLAN = ratio(3n, 4n);

/**
 * N (USD, 3 j) et NP (PYG, 3 j) de 08 E7 (TJ13a à d) : promo plateforme sur P ; taxe sur P, promo
 * et F, payée par ligne puis sommée (entrées de 08 ; la taxe de la ligne promo est négative).
 */
export function promoTrip(
  currency: typeof USD,
  p: bigint,
  promo: bigint,
  f: bigint,
  protection: bigint,
  taxPaid: bigint,
): SettlementTrip {
  const m = (x: bigint) => money(x, currency);
  return {
    currency,
    days: 3,
    rateType: 'REFUNDABLE',
    startAtMs: T0_MS,
    bookedAtMs: at(-5 * 24 * 60),
    lines: { tripPrice: m(p), promoPlatform: m(promo), tripFee: m(f), protection: m(protection) },
    taxGroups: [
      {
        id: 'g',
        lines: ['tripPrice', 'promoPlatform', 'tripFee'],
        taxPaid: m(taxPaid),
        thirdParty: false,
      },
    ],
    totalPaid: m(p + promo + f + protection + taxPaid),
    hostSharePctFrozen: TEST_PLAN,
    deliverySharePct: TEST_PLAN,
    extrasSharePct: TEST_PLAN,
    ...TEST_INSURER_SHARES,
  };
}
// TJ13a : P 100,00, promo −90,00, F 15,00, protection 30,00 ; taxe 7 % : 7,00 − 6,30 + 1,05.
export const N = promoTrip(USD, 10_000n, -9_000n, 1_500n, 3_000n, 700n - 630n + 105n);
// TJ13b : N avec la promo maximale admise −53,32 ; taxe 7,00 − 3,73 + 1,05.
export const N_MAX = promoTrip(USD, 10_000n, -5_332n, 1_500n, 3_000n, 700n - 373n + 105n);
// TJ13c : NP, P 1 000 000, promo −900 000, F 150 000, protection 300 000 ; IVA 10 % par ligne.
export const NP = promoTrip(
  PYG,
  1_000_000n,
  -900_000n,
  150_000n,
  300_000n,
  100_000n - 90_000n + 15_000n,
);
// TJ13d : NP avec la promo maximale admise −550 000.
export const NP_MAX = promoTrip(
  PYG,
  1_000_000n,
  -550_000n,
  150_000n,
  300_000n,
  100_000n - 55_000n + 15_000n,
);
