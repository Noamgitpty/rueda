/**
 * Types du contrat `docs/specs/tools/golden_vectors.json` (format 1), produit par
 * `docs/specs/tools/export_golden_vectors.py` (US-016). Tout montant est un `bigint` en unités
 * mineures ; aucun `number` ne porte d'argent (17 §1.2, ADR-009).
 */

/** Fraction exacte (taux de taxe, part hôte) telle qu'écrite par l'oracle (« n/d »). */
export interface GoldenRatio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Devise de la configuration de test des oracles ; l'exposant vient des données, jamais du code. */
export interface GoldenCurrency {
  readonly code: string;
  readonly exponent: number;
}

/** Lignes d'un trip (08, pseudo-code `LINES`), en unités mineures. */
export const LINE_NAMES = [
  'tripPrice',
  'promoPlatform',
  'promoHost',
  'tripFee',
  'protection',
  'extras',
  'enhancedRoadside',
  'additionalDriver',
  'delivery',
] as const;
export type LineName = (typeof LINE_NAMES)[number];

export interface GoldenTaxGroup {
  readonly id: string;
  readonly rate: GoldenRatio;
  readonly lines: readonly LineName[];
  readonly taxPaidMinor: bigint;
}

export interface GoldenTrip {
  readonly name: string;
  readonly currency: string;
  /** Jours facturés du trip (ou du segment). Un compte de jours, pas un montant. */
  readonly days: number;
  readonly rate: 'REFUNDABLE' | 'NON_REFUNDABLE';
  /** Minutes relatives au départ T = 0 (négatif = avant le départ). */
  readonly bookedAtMinutes: number;
  readonly hostSharePct: GoldenRatio;
  readonly deliverySharePct: GoldenRatio;
  readonly extrasSharePct: GoldenRatio;
  readonly linesMinor: Readonly<Record<LineName, bigint>>;
  readonly taxGroups: readonly GoldenTaxGroup[];
  readonly totalPaidMinor: bigint;
}

/** Événement d'annulation ou de fin anticipée ; minutes relatives au départ T = 0. */
export interface GoldenEvent {
  readonly reason: string;
  readonly requestedAtMinutes?: number;
  readonly terminatedAtMinutes?: number;
  readonly evidenceValidated?: boolean;
  readonly hostGoodFaith?: boolean;
  readonly additionalDriverApproved?: boolean;
  readonly hostMessageTraced?: boolean;
  readonly checkedIn?: boolean;
  readonly hostNoShowReported?: boolean;
  readonly hostEligibleOverride?: boolean;
}

/** Colonnes de 08 (T01–T48) puis détail calculé par l'oracle indépendant. */
export const SETTLEMENT_AMOUNT_FIELDS = [
  'guestRefundMinor',
  'taxRefundedMinor',
  'hostEarningsMinor',
  'platformNetMinor',
  'hostPenaltyMajor',
  'hostPenaltyMinor',
  'retainedMinor',
  'retainedTaxMinor',
  'hostFromGuestMinor',
  'hostCompensationMinor',
] as const;
export type SettlementAmountField = (typeof SETTLEMENT_AMOUNT_FIELDS)[number];

export type GoldenSettlementExpected = Readonly<Record<SettlementAmountField, bigint>> & {
  readonly qualifiedReason: string;
};

export interface GoldenSettlementVector {
  readonly id: string;
  readonly currency: string;
  /** `false` : valeur d'une option non décidée (DEC-FONDATEUR-01) ou montant PYG PROPOSÉ (OQ-BR-24). */
  readonly normative: boolean;
  readonly nonNormativeReason?: string;
  readonly oracle: string;
  readonly entries08: string;
  readonly qualification08: string;
  readonly trip: GoldenTrip;
  readonly event: GoldenEvent;
  readonly expected: GoldenSettlementExpected;
}

export const LEG_NAMES = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
export type LegName = (typeof LEG_NAMES)[number];

/**
 * - `ALLOCATION` : capture, jambes retenues ou encaissement (chaque jambe ≥ 0) ;
 * - `VARIATION` : ordre de remboursement, variation signée par jambe ;
 * - `REFUSED_CAPTURE` : capture refusée (`PLATFORM` < 0, E7 règle 5) ;
 * - `CHARGEBACK_LOSS` : chargeback perdu ventilé (E7 règle 7).
 */
export type LegVectorKind = 'ALLOCATION' | 'VARIATION' | 'REFUSED_CAPTURE' | 'CHARGEBACK_LOSS';

export interface GoldenLegVector {
  readonly id: string;
  readonly currency: string;
  readonly kind: LegVectorKind;
  readonly normative: boolean;
  readonly oracle: string;
  readonly entries08: string;
  readonly operation08: string;
  readonly legsMinor: Readonly<Record<LegName, bigint>>;
  readonly totalMinor: bigint;
}

/** Valeur attendue d'un contrôle d'oracle, décodée sans perte. */
export type GoldenValue =
  | bigint
  | GoldenRatio
  | string
  | boolean
  | null
  | readonly GoldenValue[]
  | { readonly [key: string]: GoldenValue };

/** Attente d'un contrôle `check(label, obtenu, attendu)` d'un oracle (T28–T68, TA). */
export interface GoldenCheck {
  readonly vectorId: string | null;
  readonly oracle: string;
  readonly label: string;
  readonly normative: boolean;
  readonly expected: GoldenValue;
}

export interface GoldenAcceptance {
  readonly id: string;
  readonly currency: string;
  readonly entries16: string;
  readonly checkLabels: readonly string[];
  readonly legVectorRefs: readonly string[];
  readonly expected?: GoldenValue;
}

export interface GoldenVectorSet {
  readonly format: 1;
  readonly currencies: ReadonlyMap<string, GoldenCurrency>;
  readonly settlement: readonly GoldenSettlementVector[];
  readonly legs: readonly GoldenLegVector[];
  readonly checks: readonly GoldenCheck[];
  readonly acceptance: readonly GoldenAcceptance[];
}
