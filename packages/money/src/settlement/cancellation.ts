/**
 * Moteur de règlement des annulations, sous-ensemble bêta (US-017).
 *
 * Fonction **pure et versionnée** (08 E4 ; 17 §2.9, NN3) : `computeCancellationSettlement(trip,
 * event, params)` suit la table de décision et le pseudo-code de 08 (BR-CXL-00 à BR-CXL-16) et rend
 * aussi les montants par jambe (08 E7). Aucune horloge, aucune E/S, aucune constante pays : les
 * paramètres pays arrivent résolus par la configuration (US-013). Les arrondis sont les seuls du
 * dépôt (`roundHalfUp` par `multiplyRoundHalfUp`, `allocHost`).
 *
 * Le résultat dépend **uniquement du motif qualifié**, jamais de l'initiateur (08, « Principe »).
 */
import {
  add,
  allocHost,
  isNegative,
  max,
  multiplyRoundHalfUp,
  subtract,
  sum,
  zero,
  type Money,
} from '../money.ts';
import { assertRatio, ratio, type Ratio } from '../ratio.ts';
import { SettlementError } from './errors.ts';
import { computeLegs, computeCaptureLegs, legVariation } from './legs.ts';
import { hostFromGuestOf, line } from './lines.ts';
import {
  BETA_CANCELLATION_REASONS,
  LEGS,
  NO_SHOW_SUBREASONS,
  PICKUP_SUBREASONS,
  SETTLEMENT_LINES,
  type CancellationEvent,
  type CancellationReason,
  type CancellationSettlement,
  type Qualification,
  type SettlementLine,
  type SettlementOrigin,
  type SettlementParams,
  type SettlementTrip,
  type TargetState,
} from './types.ts';

/**
 * Version du moteur. Toute modification d'une règle, d'un arrondi ou du sous-ensemble de motifs
 * crée une nouvelle version ; un règlement stocké garde la version qui l'a produit (US-018).
 */
export const CANCELLATION_ENGINE_VERSION = 'cxl-beta/1';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Délais de la **politique** d'annulation (08), communs à tous les pays : ils font partie de la
 * version du moteur. Les délais propres à un pays sont des paramètres (`SettlementParams`).
 */
const POLICY = Object.freeze({
  /** BR-CXL-01 : réservation de dernière minute, fenêtre gratuite d'1 h après la réservation. */
  lastMinuteFreeWindowMs: 60 * MINUTE_MS,
  /** BR-CXL-02 : grâce de 24 h après la réservation sur tarif non remboursable. */
  nonRefundableGraceMs: 24 * HOUR_MS,
  /** BR-CXL-13 : pénalité « annulation > 24 h » si strictement plus de 24 h avant le départ. */
  hostPenaltyLeadMs: 24 * HOUR_MS,
  /** BR-CXL-08 : fenêtre de déclaration `[noShowAt, start + 72 h]`. */
  noShowDeclarationEndMs: 72 * HOUR_MS,
});

type HostCompensationKind = 'NONE' | 'LATE_CXL_AFTER_FREE_WINDOW';
type PenaltyKind = 'NONE' | 'HOST_CXL' | 'HOST_NO_SHOW';

interface ReasonRow {
  readonly qualification: Qualification;
  readonly hostCompensation: HostCompensationKind;
  readonly targetState: TargetState;
  readonly penaltyKind: PenaltyKind;
}

/** Lignes de la table de décision de 08 retenues pour la bêta (n° entre parenthèses). */
const REASONS: Readonly<Record<CancellationReason, ReasonRow>> = Object.freeze({
  // (1) voyageur, gratuit ou tardif
  GUEST_CANCELLED: row('VOLUNTARY', 'NONE', 'CANCELLED_BY_GUEST', 'NONE'),
  // (2) no-show du voyageur, déclaré par l'hôte ou automatique
  GUEST_NO_SHOW: row('NO_SHOW', 'NONE', 'NO_SHOW_GUEST', 'NONE'),
  // (3) annulation de l'hôte à cause du guest, preuve validée (sinon requalifiée n° 6)
  HOST_CANCELLED_DUE_TO_GUEST: row('NO_SHOW', 'NONE', 'NO_SHOW_GUEST', 'NONE'),
  // (4), (5) plateforme, faute du guest avant le départ
  PLATFORM_INCOMPLETE_STEPS: row('FAULT_PRE_START', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
  GUEST_FRAUD_PROVEN: row('FAULT_PRE_START', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
  // (6), (7) hôte
  HOST_CANCELLED: row('FULL', 'NONE', 'CANCELLED_BY_HOST', 'HOST_CXL'),
  HOST_NO_SHOW: row('FULL', 'NONE', 'NO_SHOW_HOST', 'HOST_NO_SHOW'),
  // (12), (13), (17), (18) plateforme
  PLATFORM_TRUST_SAFETY: row('FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'),
  HOST_ACCOUNT_CLOSED: row('FULL', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
  PLATFORM_REVIEW_DELAY: row('FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'),
  PSP_FAILURE: row('FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'),
});

function row(
  qualification: Qualification,
  hostCompensation: HostCompensationKind,
  targetState: TargetState,
  penaltyKind: PenaltyKind,
): ReasonRow {
  return Object.freeze({ qualification, hostCompensation, targetState, penaltyKind });
}

const ONE = ratio(1n, 1n);
const HALF = ratio(1n, 2n);
const TWO = ratio(2n, 1n);
const THREE_QUARTERS = ratio(3n, 4n);

interface QualifiedEvent {
  readonly reason: CancellationReason;
  readonly origin: SettlementOrigin;
  readonly requestedAtMs: number;
}

type LineAmounts = Partial<Record<SettlementLine, Money>>;

// ------------------------------------------------------------------------------- validation

function invalid(message: string): never {
  throw new SettlementError('SETTLEMENT_INPUT_INVALID', message);
}

function requireInstant(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalid(`${name} doit être un instant en ms (entier sûr)`);
  }
  return value;
}

function requireNonNegativeInteger(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SettlementError('SETTLEMENT_CONFIG_INVALID', `${name} : entier ≥ 0 attendu`);
  }
  return value;
}

function requireFlag(name: string, value: unknown, why: string): boolean {
  if (typeof value !== 'boolean') invalid(`${name} est requis (${why})`);
  return value;
}

function validateTrip(trip: SettlementTrip): void {
  if (!Number.isSafeInteger(trip.days) || trip.days < 1) invalid('days : entier ≥ 1 attendu');
  if (trip.rateType !== 'REFUNDABLE' && trip.rateType !== 'NON_REFUNDABLE') {
    invalid(`rateType inconnu : ${String(trip.rateType)}`);
  }
  requireInstant('startAtMs', trip.startAtMs);
  requireInstant('bookedAtMs', trip.bookedAtMs);
  if (trip.bookedAtMs > trip.startAtMs) invalid('bookedAtMs postérieur au départ');
  for (const key of Object.keys(trip.lines)) {
    if (!(SETTLEMENT_LINES as readonly string[]).includes(key)) invalid(`ligne inconnue : ${key}`);
  }
  const ids = new Set<string>();
  for (const g of trip.taxGroups) {
    if (ids.has(g.id)) invalid(`groupe fiscal en double : ${g.id}`);
    ids.add(g.id);
    if (typeof g.thirdParty !== 'boolean') invalid(`groupe ${g.id} : thirdParty booléen requis`);
    for (const l of g.lines) {
      if (!(SETTLEMENT_LINES as readonly string[]).includes(l)) invalid(`groupe ${g.id} : ${l}`);
    }
  }
  for (const share of [trip.hostSharePctFrozen, trip.deliverySharePct, trip.extrasSharePct]) {
    assertRatio(share);
  }
  const expectedTotal = add(
    sum(
      trip.currency,
      SETTLEMENT_LINES.map((l) => line(trip, l)),
    ),
    sum(
      trip.currency,
      trip.taxGroups.map((g) => add(zero(trip.currency), g.taxPaid)),
    ),
  );
  if (expectedTotal.amountMinor !== add(zero(trip.currency), trip.totalPaid).amountMinor) {
    invalid(
      `total payé ${trip.totalPaid.amountMinor} ≠ Σ lignes + Σ taxe payée ${expectedTotal.amountMinor}`,
    );
  }
}

function validateParams(params: SettlementParams): void {
  requireNonNegativeInteger('noShowGraceMinutes', params.noShowGraceMinutes);
  requireNonNegativeInteger('lastMinuteThresholdHours', params.lastMinuteThresholdHours);
  requireNonNegativeInteger('freeCancelLeadHours', params.freeCancelLeadHours);
}

// ------------------------------------------------------------------------------- règles de 08

function noShowAt(trip: SettlementTrip, params: SettlementParams): number {
  return trip.startAtMs + params.noShowGraceMinutes * MINUTE_MS;
}

/** BR-CXL-01, R03 : `freeUntil`, borne incluse. */
export function freeUntil(trip: SettlementTrip, params: SettlementParams): number {
  const lastMinute = trip.startAtMs - trip.bookedAtMs < params.lastMinuteThresholdHours * HOUR_MS;
  return lastMinute
    ? Math.min(trip.bookedAtMs + POLICY.lastMinuteFreeWindowMs, trip.startAtMs)
    : trip.startAtMs - params.freeCancelLeadHours * HOUR_MS;
}

function isBetaReason(reason: string): reason is CancellationReason {
  return (BETA_CANCELLATION_REASONS as readonly string[]).includes(reason);
}

/** Règles de qualification 1 à 3 de 08. */
function qualify(
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
): QualifiedEvent {
  const { reason } = event;
  if (typeof reason !== 'string' || !isBetaReason(reason)) {
    throw new SettlementError(
      'SETTLEMENT_REASON_NOT_SUPPORTED',
      `motif hors du sous-ensemble bêta : ${String(reason)} (moteur complet : US-518)`,
    );
  }
  const at = requireInstant('requestedAtMs', event.requestedAtMs);
  const sub = event.subReason;
  if (reason === 'GUEST_CANCELLED' && at >= noShowAt(trip, params)) {
    const checkedIn = requireFlag('checkinValidated', event.checkinValidated, 'après noShowAt');
    if (!checkedIn)
      return { reason: 'GUEST_NO_SHOW', origin: 'LATE_GUEST_CANCELLATION', requestedAtMs: at };
  }
  if (reason === 'HOST_CANCELLED_DUE_TO_GUEST') {
    const qualifies =
      sub !== undefined &&
      (NO_SHOW_SUBREASONS as readonly string[]).includes(sub) &&
      event.evidenceValidated === true;
    if (!qualifies) {
      return { reason: 'HOST_CANCELLED', origin: 'REQUALIFIED_NO_EVIDENCE', requestedAtMs: at };
    }
  }
  if (reason === 'GUEST_NO_SHOW' && at < noShowAt(trip, params)) {
    if (sub === undefined || !(PICKUP_SUBREASONS as readonly string[]).includes(sub)) {
      throw new SettlementError(
        'REJECTED_TOO_EARLY',
        'no-show déclaré avant noShowAt sans sous-motif constaté au retrait',
      );
    }
    return { reason, origin: 'PICKUP_CHECK', requestedAtMs: at };
  }
  return { reason, origin: 'EVENT', requestedAtMs: at };
}

function penaltyDays(trip: SettlementTrip, qualification: Qualification): Ratio {
  if (qualification === 'NO_SHOW') return trip.days > 2 ? TWO : THREE_QUARTERS;
  return trip.days > 2 ? ONE : HALF;
}

/** `roundHalfUp(m × j / days)`. */
function perDays(m: Money, j: Ratio, days: number): Money {
  return multiplyRoundHalfUp(m, ratio(j.num, j.den * BigInt(days)));
}

/** BR-CXL-08, `hostEligible` (corrigé VERIF_09-M07). */
function hostEligible(
  trip: SettlementTrip,
  rowOf: ReasonRow,
  ev: QualifiedEvent,
  event: CancellationEvent,
  params: SettlementParams,
): boolean {
  if (rowOf.qualification === 'VOLUNTARY' || rowOf.qualification === 'FAULT_PRE_START') return true;
  if (rowOf.qualification === 'FULL') return false;
  if (ev.reason === 'HOST_CANCELLED_DUE_TO_GUEST') return true;
  if (ev.origin === 'LATE_GUEST_CANCELLATION') {
    return !requireFlag(
      'hostNoShowReportedBefore',
      event.hostNoShowReportedBefore,
      'annulation guest requalifiée en no-show',
    );
  }
  const traced = requireFlag('hostMessageTraced', event.hostMessageTraced, 'no-show du guest');
  return (
    traced &&
    noShowAt(trip, params) <= ev.requestedAtMs &&
    ev.requestedAtMs <= trip.startAtMs + POLICY.noShowDeclarationEndMs
  );
}

/** Part hôte d'une compensation : même assiette que la part retenue, plancher 0 (T63). */
function hostPartOf(trip: SettlementTrip, j: Ratio): Money {
  const raw = add(
    add(
      allocHost(perDays(line(trip, 'tripPrice'), j, trip.days), trip.hostSharePctFrozen),
      perDays(line(trip, 'promoHost'), j, trip.days),
    ),
    allocHost(multiplyRoundHalfUp(line(trip, 'delivery'), HALF), trip.deliverySharePct),
  );
  return max(zero(trip.currency), raw);
}

/** DEC-FONDATEUR-01 : fail-closed, seul `true` exact active l'option A (T61). */
function compensation(
  trip: SettlementTrip,
  rowOf: ReasonRow,
  ev: QualifiedEvent,
  params: SettlementParams,
): Money {
  if (params.platformFundedHostCompensation !== true) return zero(trip.currency);
  if (
    rowOf.hostCompensation === 'LATE_CXL_AFTER_FREE_WINDOW' &&
    ev.requestedAtMs > freeUntil(trip, params)
  ) {
    return hostPartOf(trip, trip.days > 2 ? ONE : HALF);
  }
  return zero(trip.currency);
}

/** BR-CXL-13 : barème par devise, jamais converti ; absent quand il est dû ⇒ refus. */
function penalty(
  trip: SettlementTrip,
  rowOf: ReasonRow,
  ev: QualifiedEvent,
  event: CancellationEvent,
  params: SettlementParams,
): Money {
  if (rowOf.penaltyKind === 'NONE' || event.hostPenaltyWaived === true) return zero(trip.currency);
  const schedule = params.hostPenalty;
  if (schedule === undefined) {
    throw new SettlementError('SETTLEMENT_CONFIG_INVALID', 'host_penalty absent pour ce pays');
  }
  const fee =
    rowOf.penaltyKind === 'HOST_NO_SHOW'
      ? schedule.hostNoShow
      : trip.startAtMs - ev.requestedAtMs > POLICY.hostPenaltyLeadMs
        ? schedule.cxlEarly
        : schedule.cxlLate;
  if (fee.currency !== trip.currency.code) {
    throw new SettlementError(
      'SETTLEMENT_CONFIG_INVALID',
      `host_penalty en ${fee.currency}, trip en ${trip.currency.code} (aucune conversion)`,
    );
  }
  return add(zero(trip.currency), fee);
}

// ------------------------------------------------------------------------------- settle

function settle(
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
  ev: QualifiedEvent,
  refund: LineAmounts,
  hostCompensation: Money,
  j: Ratio | null,
): CancellationSettlement {
  const rowOf = REASONS[ev.reason];
  const c = trip.currency;
  const refundByLine = {} as Record<SettlementLine, Money>;
  const retainedByLine = {} as Record<SettlementLine, Money>;
  for (const l of SETTLEMENT_LINES) {
    refundByLine[l] = add(zero(c), refund[l] ?? zero(c));
    retainedByLine[l] = subtract(line(trip, l), refundByLine[l]);
  }
  const taxRefundByGroup: Record<string, Money> = {};
  const retainedTaxByGroup: Record<string, Money> = {};
  for (const g of trip.taxGroups) {
    const base = sum(
      c,
      g.lines.map((l) => line(trip, l)),
    );
    const refunded = sum(
      c,
      g.lines.map((l) => refundByLine[l]),
    );
    // Prorata de la base taxable remboursée (A04), garde base nulle (m02).
    const taxRefund =
      base.amountMinor === 0n
        ? zero(c)
        : multiplyRoundHalfUp(g.taxPaid, ratio(refunded.amountMinor, base.amountMinor));
    taxRefundByGroup[g.id] = taxRefund;
    retainedTaxByGroup[g.id] = subtract(g.taxPaid, taxRefund);
  }
  const eligible = hostEligible(trip, rowOf, ev, event, params);
  const hostFromGuest = eligible ? hostFromGuestOf(trip, retainedByLine) : zero(c);
  const hostEarnings = add(hostFromGuest, hostCompensation);
  const taxRefund = sum(c, Object.values(taxRefundByGroup));
  const retained = sum(c, Object.values(retainedByLine));
  const retainedTax = sum(c, Object.values(retainedTaxByGroup));
  const guestRefund = add(sum(c, Object.values(refundByLine)), taxRefund);
  if (add(add(guestRefund, retained), retainedTax).amountMinor !== trip.totalPaid.amountMinor) {
    throw new SettlementError(
      'SETTLEMENT_UNBALANCED',
      'remboursement + retenu HT + taxe retenue ≠ total payé',
    );
  }
  const captureLegs = computeCaptureLegs(trip);
  const settledLegs = computeLegs(trip, retainedByLine, retainedTaxByGroup, hostFromGuest);
  return Object.freeze({
    engineVersion: CANCELLATION_ENGINE_VERSION,
    currency: c.code,
    requestedReason: event.reason,
    reason: ev.reason,
    origin: ev.origin,
    qualification: rowOf.qualification,
    targetState: rowOf.targetState,
    penaltyDays: j,
    hostEligible: eligible,
    refundByLine: Object.freeze(refundByLine),
    retainedByLine: Object.freeze(retainedByLine),
    taxRefundByGroup: Object.freeze(taxRefundByGroup),
    retainedTaxByGroup: Object.freeze(retainedTaxByGroup),
    guestRefund,
    taxRefund,
    retained,
    retainedTax,
    hostFromGuest,
    hostCompensation,
    hostEarnings,
    platformNet: subtract(retained, hostEarnings),
    hostPenalty: penalty(trip, rowOf, ev, event, params),
    captureLegs,
    settledLegs,
    legVariation: legVariation(captureLegs, settledLegs),
    negativeLeg: LEGS.some((k) => isNegative(settledLegs[k])),
  });
}

function allLines(trip: SettlementTrip): LineAmounts {
  return Object.fromEntries(SETTLEMENT_LINES.map((l) => [l, line(trip, l)]));
}

// ------------------------------------------------------------------------------- point d'entrée

/**
 * Règlement d'une annulation ou d'un no-show (08 `computeCancellationSettlement`), motifs bêta.
 * `trip` est le segment concerné ; `params` sont les paramètres pays résolus (US-013).
 */
export function computeCancellationSettlement(
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
): CancellationSettlement {
  validateTrip(trip);
  validateParams(params);
  const ev = qualify(trip, event, params);
  const rowOf = REASONS[ev.reason];
  if (rowOf.qualification === 'FULL') {
    return settle(
      trip,
      event,
      params,
      ev,
      allLines(trip),
      compensation(trip, rowOf, ev, params),
      null,
    );
  }
  const none = zero(trip.currency);
  if (rowOf.qualification === 'VOLUNTARY') {
    const graceEnd = Math.min(trip.bookedAtMs + POLICY.nonRefundableGraceMs, trip.startAtMs);
    if (trip.rateType === 'NON_REFUNDABLE' && ev.requestedAtMs <= graceEnd) {
      return settle(trip, event, params, ev, allLines(trip), none, null);
    }
    if (trip.rateType === 'REFUNDABLE' && ev.requestedAtMs <= freeUntil(trip, params)) {
      return settle(trip, event, params, ev, allLines(trip), none, null);
    }
  }
  if (trip.rateType === 'NON_REFUNDABLE') {
    // VOLUNTARY hors grâce, FAULT_PRE_START, NO_SHOW : seul le conducteur additionnel non
    // approuvé est remboursé (BR-PRICE-08).
    const driver = line(trip, 'additionalDriver');
    const refund: LineAmounts = {};
    if (driver.amountMinor !== 0n) {
      const approved = requireFlag(
        'additionalDriverApproved',
        event.additionalDriverApproved,
        'tarif non remboursable avec conducteur additionnel',
      );
      if (!approved) refund.additionalDriver = driver;
    }
    return settle(trip, event, params, ev, refund, none, null);
  }
  const j = penaltyDays(trip, rowOf.qualification);
  const retained: LineAmounts = {
    tripPrice: perDays(line(trip, 'tripPrice'), j, trip.days),
    promoPlatform: perDays(line(trip, 'promoPlatform'), j, trip.days),
    promoHost: perDays(line(trip, 'promoHost'), j, trip.days),
    tripFee: perDays(line(trip, 'tripFee'), j, trip.days),
    delivery: multiplyRoundHalfUp(line(trip, 'delivery'), HALF),
  };
  const refund: LineAmounts = {};
  for (const l of SETTLEMENT_LINES) {
    refund[l] = subtract(line(trip, l), retained[l] ?? none);
  }
  return settle(trip, event, params, ev, refund, none, j);
}
