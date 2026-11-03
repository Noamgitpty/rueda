/**
 * Contrat du moteur de règlement des annulations, sous-ensemble bêta (US-017 ; 08 BR-CXL, table de
 * décision et pseudo-code `computeCancellationSettlement` ; E7 ; 17 §2.9, NN3).
 *
 * Tout montant est un `Money` (`bigint` en unités mineures) ; tout ratio est une fraction exacte.
 * Les horodatages sont des instants UTC en millisecondes (entiers sûrs) : le moteur ne lit aucune
 * horloge, l'appelant fournit `cancelRequestedAt` (horodatage serveur, 08 « Définitions »).
 */
import type { Currency } from '../currency.ts';
import type { Money } from '../money.ts';
import type { Ratio } from '../ratio.ts';

/** Lignes du trip (08, pseudo-code `LINES`) ; une ligne absente vaut 0. */
export const SETTLEMENT_LINES = [
  'tripPrice',
  'promoPlatform',
  'promoHost',
  'tripFee',
  'protection',
  'extras',
  'enhancedRoadside',
  'additionalDriver',
  'youngDriver',
  'delivery',
] as const;
export type SettlementLine = (typeof SETTLEMENT_LINES)[number];

export type RateType = 'REFUNDABLE' | 'NON_REFUNDABLE';

/** Groupe fiscal figé à la réservation : taxe payée **par ligne puis sommée** (08 BR-CXL-06). */
export interface SettlementTaxGroup {
  readonly id: string;
  /** Lignes taxables du groupe (`tax_line_config` du pays, version figée). */
  readonly lines: readonly SettlementLine[];
  /** Taxe payée du groupe (facture électronique). */
  readonly taxPaid: Money;
  /** Taxe collectée pour le compte d'un tiers : jambe `TAX_THIRD_PARTY` (08 E7). */
  readonly thirdParty: boolean;
}

/** Le SEGMENT concerné (trip ≤ 30 j : le trip entier), version de prix en vigueur (08, E1). */
export interface SettlementTrip {
  readonly currency: Currency;
  /** Jours facturés `billable_days` du segment (entier ≥ 1). Un compte, pas un montant. */
  readonly days: number;
  readonly rateType: RateType;
  /** Début planifié du segment, instant UTC en ms. */
  readonly startAtMs: number;
  /** Horodatage serveur de la réservation d'origine (BR-CXL-03 : une modification ne le change pas). */
  readonly bookedAtMs: number;
  readonly lines: Readonly<Partial<Record<SettlementLine, Money>>>;
  readonly taxGroups: readonly SettlementTaxGroup[];
  /** Total payé (TTC) du segment : contrôlé contre Σ lignes + Σ taxe payée. */
  readonly totalPaid: Money;
  readonly hostSharePctFrozen: Ratio;
  readonly deliverySharePct: Ratio;
  readonly extrasSharePct: Ratio;
  /** Parts figées de la jambe assureur (08 E7). Absentes alors qu'une ligne les exige ⇒ refus. */
  readonly insurerPremiumShareFrozen?: Ratio;
  readonly insurerRoadsideShareFrozen?: Ratio;
}

/**
 * Motifs du sous-ensemble bêta (19 US-017 ; 17 NN3) : voyageur (gratuit, tardif), hôte, plateforme,
 * no-show du voyageur — limités aux lignes de la table de décision de 08 qu'un vecteur doré exerce
 * (ADR-054). Tout autre motif ⇒ `SETTLEMENT_REASON_NOT_SUPPORTED` (moteur complet : US-518).
 */
export const BETA_CANCELLATION_REASONS = [
  'GUEST_CANCELLED',
  'GUEST_NO_SHOW',
  'HOST_CANCELLED_DUE_TO_GUEST',
  'PLATFORM_INCOMPLETE_STEPS',
  'GUEST_FRAUD_PROVEN',
  'HOST_CANCELLED',
  'HOST_NO_SHOW',
  'PLATFORM_TRUST_SAFETY',
  'HOST_ACCOUNT_CLOSED',
  'PLATFORM_REVIEW_DELAY',
  'PSP_FAILURE',
] as const;
export type CancellationReason = (typeof BETA_CANCELLATION_REASONS)[number];

/** Sous-motifs d'un `HOST_CANCELLED_DUE_TO_GUEST` qualifiable en no-show (08, règle 2). */
export const NO_SHOW_SUBREASONS = [
  'INVALID_LICENSE',
  'IDENTITY_NOT_VERIFIED',
  'OTHER_DRIVER_SENT',
  'LICENSE_NOT_UPLOADED_1H',
] as const;
/** Sous-motifs constatés au retrait : no-show déclarable avant `noShowAt` (08, règle 3). */
export const PICKUP_SUBREASONS = [
  'INVALID_LICENSE',
  'IDENTITY_NOT_VERIFIED',
  'OTHER_DRIVER_SENT',
] as const;

/**
 * Événement d'annulation. Les drapeaux sont des faits établis par l'appelant (messagerie, check-in,
 * support) ; un drapeau dont la branche a besoin et qui manque ⇒ `SETTLEMENT_INPUT_INVALID`
 * (jamais de valeur par défaut silencieuse).
 */
export interface CancellationEvent {
  readonly reason: string;
  /** `cancelRequestedAt` : horodatage serveur de la demande ou de l'événement système, en ms. */
  readonly requestedAtMs: number;
  readonly subReason?: string;
  /** `HOST_CANCELLED_DUE_TO_GUEST` : preuve validée (check-in ou support). */
  readonly evidenceValidated?: boolean;
  /** Check-in validé : une annulation guest après `noShowAt` sans check-in devient no-show. */
  readonly checkinValidated?: boolean;
  /** No-show déclaré ou automatique : message de l'hôte + 15 min sans réponse tracés (`hostMessageTraced`). */
  readonly hostMessageTraced?: boolean;
  /** Annulation guest requalifiée : le guest avait signalé une absence de l'hôte avant d'annuler. */
  readonly hostNoShowReportedBefore?: boolean;
  /** Tarif non remboursable : un conducteur additionnel a-t-il été approuvé (BR-PRICE-08) ? */
  readonly additionalDriverApproved?: boolean;
  /** Exemption de pénalité accordée (table de portée de BR-CXL-13, All-Star). */
  readonly hostPenaltyWaived?: boolean;
}

/** Barème `host_penalty[pays]` en unités mineures de la devise du pays (08 `penalty`, US-013). */
export interface HostPenaltySchedule {
  readonly cxlEarly: Money;
  readonly cxlLate: Money;
  readonly hostNoShow: Money;
  readonly cleanliness: Money;
}

/**
 * Paramètres pays résolus par la configuration (US-013, clés de 17 §7.2) au moment du règlement.
 * Aucune valeur par défaut dans le moteur (aucune constante pays).
 */
export interface SettlementParams {
  /** `no_show_grace_minutes` (OQ-BR-33). */
  readonly noShowGraceMinutes: number;
  /** `last_minute_threshold`, en heures (OQ-BR-30). */
  readonly lastMinuteThresholdHours: number;
  /** `free_cancel_lead`, en heures (BR-CXL-01). */
  readonly freeCancelLeadHours: number;
  /**
   * `platform_funded_host_compensation` (DEC-FONDATEUR-01, OQ-BR-41) : seul `true` exact active
   * l'option A ; absent, `null`, `false` ou toute autre valeur ⇒ option B (fail-closed).
   */
  readonly platformFundedHostCompensation?: unknown;
  /** `host_penalty` ; exigé seulement quand une pénalité est due (absent ⇒ refus, jamais 0). */
  readonly hostPenalty?: HostPenaltySchedule;
}

export type Qualification = 'VOLUNTARY' | 'FAULT_PRE_START' | 'NO_SHOW' | 'FULL';
export type SettlementOrigin =
  'EVENT' | 'LATE_GUEST_CANCELLATION' | 'REQUALIFIED_NO_EVIDENCE' | 'PICKUP_CHECK';
export type TargetState =
  | 'CANCELLED_BY_GUEST'
  | 'NO_SHOW_GUEST'
  | 'CANCELLED_BY_HOST'
  | 'NO_SHOW_HOST'
  | 'CANCELLED_BY_PLATFORM';

export const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
export type Leg = (typeof LEGS)[number];

/** Montants par jambe d'un état (08 E7) ; `total` = Σ jambes. */
export type Legs = Readonly<Record<Leg, Money>> & { readonly total: Money };

export interface CancellationSettlement {
  /** Version du moteur qui a produit ce règlement (fonction pure versionnée, 08 E4). */
  readonly engineVersion: string;
  readonly currency: string;
  readonly requestedReason: string;
  /** Motif qualifié (règles 1 et 2 de `qualify`). */
  readonly reason: CancellationReason;
  readonly origin: SettlementOrigin;
  readonly qualification: Qualification;
  readonly targetState: TargetState;
  /** Jours de pénalité appliqués (`null` si aucun remboursement partiel au prorata). */
  readonly penaltyDays: Ratio | null;
  readonly hostEligible: boolean;
  readonly refundByLine: Readonly<Record<SettlementLine, Money>>;
  readonly retainedByLine: Readonly<Record<SettlementLine, Money>>;
  readonly taxRefundByGroup: Readonly<Record<string, Money>>;
  readonly retainedTaxByGroup: Readonly<Record<string, Money>>;
  /** Remboursement économique TTC dû au guest (les mouvements de fonds relèvent de E1). */
  readonly guestRefund: Money;
  readonly taxRefund: Money;
  /** Σ retenu HT. */
  readonly retained: Money;
  readonly retainedTax: Money;
  readonly hostFromGuest: Money;
  /** Compensation financée par la plateforme (0 en option B, défaut). */
  readonly hostCompensation: Money;
  readonly hostEarnings: Money;
  /** HT, avant frais PSP ; négatif si compensation. */
  readonly platformNet: Money;
  /** Écriture séparée du `host_ledger`, hors jambes (08 E7 règle 7). */
  readonly hostPenalty: Money;
  /** Jambes de la capture du total (`captureLegs`). */
  readonly captureLegs: Legs;
  /** Jambes retenues de ce règlement (`settledLegs`). */
  readonly settledLegs: Legs;
  /** Variation signée capture → règlement (Σ = − remboursement du guest). */
  readonly legVariation: Legs;
  /**
   * Une jambe retenue est négative (08 E7 règle 5) : le remboursement n'est jamais réduit, l'ordre
   * reste `PLANNED` jusqu'à la décision FIN (SM-8, US-018).
   */
  readonly negativeLeg: boolean;
}
