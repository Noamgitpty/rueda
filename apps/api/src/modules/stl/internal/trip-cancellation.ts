/**
 * Règlement des annulations déclenchées par l'ops (US-215, partie 215a ; ADR-148 ; 19 US-215
 * critères 1 à 5 et DoR du recalage du lot 2 ; 08 BR-CXL, E7 règle 7, SM-1 invariant 4 ; 16
 * BKG-028, BKG-032, BKG-035, ADM-006).
 *
 * L'ops demande l'annulation par la console (`CANCEL_TRIP_GUEST`, `CANCEL_TRIP_HOST`,
 * `CANCEL_TRIP_PLATFORM`) : la base écrit une demande `PENDING` (motif demandé et initiateur
 * dérivés de l'action, heure serveur de la demande). Ce processeur règle chaque demande en UNE
 * transaction du travailleur `trip_lifecycle` :
 *
 * 1. `core.booking_trip_cancellation_begin` : verrous voyageur → véhicule → trip, faits du trip,
 *    preuve validée dérivée des pièces de l'action, devis figé, paramètres du pays ;
 * 2. moteur UNIQUE de `@rueda/money` (`buildSettlementRecord`, `cxl-beta/2`) sur le trip tiré du
 *    devis figé REJOUÉ (`replayFrozenQuote`, `quoteSettlementTrip` de PRC), instants et paramètres
 *    de la base ; `REFUND_OUT_OF_RANGE` ⇒ revue FIN (`settleOrFinReview`), rien d'écrit ; le même
 *    refus levé plus loin par 08 E2 (`ordersByTender` : remboursement au-delà des reliquats des
 *    moyens) est lui aussi une revue FIN (`classify`, N-365, ADR-166 n° 8), jamais un `FAILED` ;
 * 3. `core.settlement_cmd_record` (travailleur `settlement`), version 1 ;
 * 4. `core.booking_cmd_trip_settle_cancellation` (travailleur `trip_lifecycle`) : la base requalifie,
 *    LIE le règlement à la demande et applique la transition avec `settlement_id` ;
 * 5. ordres du règlement (`ordersByTender` : réaffectation d'abord, puis remboursement de chaque
 *    moyen d'origine décidé par 08 E2 et ventilé en cascade par la règle 10, US-224f, ADR-166 ;
 *    montants explicites par jambe, jamais un prorata), rattachés à la version 1 et
 *    bornés par 0121 (travailleur `payment_command`) : réaffectation par la commande PAY à 15
 *    arguments, remboursement par l'instance `PLANNED` d'US-224b (`PgRefundPlanner.plan`) ;
 *    la contrainte différée de 0124 exige Σ REFUND = remboursement du voyageur à la validation.
 *
 * US-307 (ADR-191) : les déclarations de no-show (hôte, voyageur, console `DECLARE_NO_SHOW`) et
 * les refus du véhicule (console `REFUSE_AT_PICKUP`) sont des demandes de la même table, réglées
 * par ce même processeur : `hostMessageTraced` d'un no-show du voyageur est lu en base
 * (`core.booking_trip_cancellation_flags`, figé à la déclaration) ; une réaffectation de jambes
 * (TJ05b) exige `SUPPORTS_PAYOUT_ADJUSTMENT` validée (`core.payment_assert_payout_adjustment`,
 * capacité inconnue = « non ») : sinon la demande est garée FIN_REVIEW
 * (`LEG_REALLOCATION_UNSUPPORTED`), rien n'est remboursé ni réaffecté.
 *
 * Un refus déterministe (moteur, paramètre, devis, état du trip, ordre refusé) annule la
 * transaction ; la demande est alors garée dans une transaction à part (`FIN_REVIEW` ou `FAILED`,
 * code seul) et une alerte part (comptes et codes seulement, 17 §6.3). Un interblocage ou une
 * sérialisation laisse la demande en attente : elle est reprise au passage suivant.
 *
 * Aucun montant n'est jamais saisi par l'ops ni écrit ici : tout montant vient du moteur et du
 * devis figé, et la base le rejoue (0054) avant de l'accepter.
 */
import { randomUUID } from 'node:crypto';
import {
  LEGS,
  buildSettlementRecord,
  isSettlementError,
  money,
  settlementOrders,
  settlementRecordPayload,
  tenderRefundOrders,
  type CancellationEvent,
  type Currency,
  type HostPenaltySchedule,
  type Leg,
  type Legs,
  type Money,
  type PaidTender,
  type SettlementParams,
  type SettlementRecord,
  type SettlementTrip,
  type TenderKind,
} from '@rueda/money';
import type { AlertChannel, BusRegistry, SqlClient, WorkerTransactions } from '../../bus/index.js';
import {
  PgOperationRecorder,
  PgRefundPlanner,
  idempotencyKeyToSend,
  settlementOperationKey,
  type LegAmounts,
} from '../../pay/index.js';
import {
  FROZEN_QUOTE_FORMAT,
  isQuoteError,
  quoteSettlementTrip,
  replayFrozenQuote,
  type FrozenQuote,
} from '../../prc/index.js';
import { settleOrFinReview } from './settlement-review.js';

/** Travailleur des transitions du trip (0099) : propriétaire de la transaction d'annulation. */
export const TRIP_LIFECYCLE_WORKER = 'trip_lifecycle';
const SETTLEMENT_WORKER = 'settlement';
const PAYMENT_COMMAND_WORKER = 'payment_command';

/**
 * Longueur de clé d'idempotence transmise au PSP (FAKE seulement avant le lot C) : au-delà, le
 * SHA-256 hexadécimal (08 E4). PROPOSÉ : la capacité du PSP réel la fixera (lot C).
 */
export const PSP_IDEMPOTENCY_MAX_LENGTH = 64;

/** Faits d'une demande, lus par `core.booking_trip_cancellation_begin` sous verrous. */
export interface CancellationFacts {
  readonly cancellationId: string;
  readonly tripId: string;
  readonly segmentId: string;
  readonly country: string;
  readonly currency: string;
  readonly tripRowVersion: number;
  readonly startAtMs: number;
  readonly bookedAtMs: number;
  readonly requestedReason: string;
  readonly subReason: string | null;
  readonly evidenceValidated: boolean;
  readonly checkinValidated: boolean;
  readonly requestedAtMs: number;
  /**
   * US-307 : no-show du voyageur seulement — message de l'hôte et 15 min sans réponse tracés à la
   * déclaration (08 BR-CXL-08), lu en base ; absent pour tout autre motif.
   */
  readonly hostMessageTraced?: boolean | null;
  readonly frozen: FrozenQuote | null;
  /** Paramètres du pays dans la forme canonique des entrées du règlement (0124), ou `null`. */
  readonly params: unknown;
}

/** Refus déterministe d'un calcul d'annulation (code seul, jamais un montant). */
export class CancellationPlanError extends Error {
  constructor(readonly code: string) {
    super(`annulation : ${code}`);
    this.name = 'CancellationPlanError';
  }
}

/** Un ordre du règlement, montant et jambes explicites (jamais un prorata). */
export interface CancellationOrder {
  readonly kind: 'REFUND' | 'LEG_REALLOCATION';
  readonly amountMinor: bigint;
  readonly legs: LegAmounts;
  /** Rang de l'ordre de cette nature dans le règlement (clé d'idempotence, 08 E4). */
  readonly instanceSeq: number;
}

export interface CancellationPlan {
  readonly record: SettlementRecord;
  /** Devise du trip (configuration du pays), pour les ordres par moyen (US-224f). */
  readonly currency: Currency;
  readonly orders: readonly CancellationOrder[];
}

const INT = /^[0-9]{1,6}$/;
const MINOR = /^[0-9]{1,18}$/;

/** Événement d'annulation des faits de la base, dans la forme que la base contrôle (0124). */
export function cancellationEvent(f: CancellationFacts): CancellationEvent {
  return {
    reason: f.requestedReason,
    requestedAtMs: f.requestedAtMs,
    ...(f.subReason === null ? {} : { subReason: f.subReason }),
    ...(f.requestedReason === 'HOST_CANCELLED_DUE_TO_GUEST'
      ? { evidenceValidated: f.evidenceValidated }
      : {}),
    checkinValidated: f.checkinValidated,
    // US-307 : fait exigé par le moteur pour un no-show du voyageur (absent ⇒ refus du moteur)
    ...(f.requestedReason === 'GUEST_NO_SHOW' && typeof f.hostMessageTraced === 'boolean'
      ? { hostMessageTraced: f.hostMessageTraced }
      : {}),
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function count(json: Record<string, unknown>, key: string): number {
  const v = json[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || !INT.test(String(v))) {
    throw new CancellationPlanError('PARAM_MISSING');
  }
  return v;
}

function penaltyAmount(value: unknown, currency: Currency): Money {
  const m = record(value);
  const big = m === null ? null : record(m['amountMinor']);
  const digits = big?.['$bigint'];
  if (typeof digits !== 'string' || !MINOR.test(digits) || m?.['currency'] !== currency.code) {
    throw new CancellationPlanError('PARAM_MISSING');
  }
  return money(BigInt(digits), currency);
}

/**
 * Paramètres du moteur lus en base (forme canonique de 0124) : aucune valeur par défaut. Absents
 * ou mal formés ⇒ `PARAM_MISSING` (BLOCK). `platformFundedHostCompensation` est recopié tel quel
 * (seul `true` exact active l'option A, DEC-FONDATEUR-01 ; absent ⇒ option B).
 */
export function cancellationParams(json: unknown, currency: Currency): SettlementParams {
  const p = record(json);
  if (p === null) throw new CancellationPlanError('PARAM_MISSING');
  const hp = p['hostPenalty'] === undefined ? undefined : record(p['hostPenalty']);
  if (hp === null) throw new CancellationPlanError('PARAM_MISSING');
  const hostPenalty: HostPenaltySchedule | undefined =
    hp === undefined
      ? undefined
      : {
          cxlEarly: penaltyAmount(hp['cxlEarly'], currency),
          cxlLate: penaltyAmount(hp['cxlLate'], currency),
          hostNoShow: penaltyAmount(hp['hostNoShow'], currency),
          cleanliness: penaltyAmount(hp['cleanliness'], currency),
        };
  return {
    noShowGraceMinutes: count(p, 'noShowGraceMinutes'),
    lastMinuteThresholdHours: count(p, 'lastMinuteThresholdHours'),
    freeCancelLeadHours: count(p, 'freeCancelLeadHours'),
    ...(hostPenalty === undefined ? {} : { hostPenalty }),
    ...('platformFundedHostCompensation' in p
      ? { platformFundedHostCompensation: p['platformFundedHostCompensation'] }
      : {}),
  };
}

/**
 * Trip du moteur tiré du devis figé REJOUÉ (16 PRC-025 : le règlement part du devis figé) ;
 * départ et réservation : instants de la base (BR-CXL-03 : l'heure de la réservation d'origine).
 * Devis absent ou qui ne se rejoue plus ⇒ `QUOTE_UNAVAILABLE` (jamais un montant deviné).
 */
export function cancellationTrip(f: CancellationFacts): SettlementTrip {
  if (f.frozen === null) throw new CancellationPlanError('QUOTE_UNAVAILABLE');
  try {
    const quote = replayFrozenQuote(f.frozen);
    if (quote.currency.code !== f.currency) throw new CancellationPlanError('QUOTE_UNAVAILABLE');
    return { ...quoteSettlementTrip(quote), startAtMs: f.startAtMs, bookedAtMs: f.bookedAtMs };
  } catch (cause) {
    if (cause instanceof CancellationPlanError) throw cause;
    if (isQuoteError(cause)) throw new CancellationPlanError('QUOTE_UNAVAILABLE');
    throw cause;
  }
}

const legAmounts = (legs: Legs): LegAmounts =>
  Object.fromEntries(LEGS.map((leg) => [leg, legs[leg].amountMinor])) as Record<Leg, bigint>;

/**
 * Règlement version 1 et ordres d'une demande (fonction pure) : moteur unique, puis
 * `settlementOrders` sur la variation signée des jambes et le remboursement du moyen d'origine
 * (carte : `NATIVE`). Les erreurs du moteur remontent telles quelles (`SettlementError`).
 */
export function planCancellation(f: CancellationFacts, trip: SettlementTrip): CancellationPlan {
  const params = cancellationParams(f.params, trip.currency);
  const rec = buildSettlementRecord(trip, cancellationEvent(f), params);
  const currency = trip.currency;
  const variation = variationOf(rec, currency);
  const refund = money(rec.guestRefundMinor, currency);
  const orders = settlementOrders(
    variation,
    rec.guestRefundMinor > 0n ? [{ kind: 'NATIVE', amount: refund }] : [],
  );
  const out: CancellationOrder[] = [];
  if (orders.reallocation !== null) {
    const legs = legAmounts(orders.reallocation);
    const amount = LEGS.reduce((s, leg) => (legs[leg] > 0n ? s + legs[leg] : s), 0n);
    out.push({ kind: 'LEG_REALLOCATION', amountMinor: amount, legs, instanceSeq: 1 });
  }
  orders.refunds.forEach((r, i) => {
    out.push({
      kind: 'REFUND',
      amountMinor: r.legs.total.amountMinor,
      legs: legAmounts(r.legs),
      instanceSeq: i + 1,
    });
  });
  return { record: rec, currency, orders: out };
}

/** Variation signée des jambes d'un règlement (`settlement_leg.variation_minor`, 08 E7 règle 3). */
function variationOf(rec: SettlementRecord, currency: Currency): Legs {
  const variationRow = Object.fromEntries(
    rec.legs.map((l) => [l.leg, money(l.variationMinor, currency)]),
  ) as Record<Leg, Money>;
  return Object.freeze({ ...variationRow, total: money(-rec.guestRefundMinor, currency) });
}

/**
 * Encaissement réussi du loyer d'un trip : un moyen d'origine de 08 E2 (US-224f, ADR-166), lu par
 * `tendersOf` dans l'ordre des captures (la plus ancienne d'abord).
 */
export interface CaptureTender {
  readonly operationId: string;
  readonly accountId: string;
  readonly method: string | null;
  /** Payé par ce moyen, devise du trip. */
  readonly amountMinor: bigint;
  /** Déjà engagé sur ce moyen : instances SM-8 hors `CANCELLED` et `SUPERSEDED` (08 E2). */
  readonly committedMinor: bigint;
}

/** Rail de remboursement de bêta : natif seulement (08 E3 ; ADR-147, ADR-166). */
export type BetaRefundRail = 'NATIVE_PARTIAL';

/** Ordre d'un règlement rattaché à son moyen d'origine (remboursement : avec son rail). */
export interface TenderOrder extends CancellationOrder {
  readonly tender: CaptureTender;
  readonly rail: BetaRefundRail | null;
}

/** Ordre de la cascade de 08 E7 règle 10 (natif → non natif → crédit cash → crédit promo). */
const TENDER_ORDER: readonly TenderKind[] = ['NATIVE', 'NON_NATIVE', 'CASH_CREDIT', 'PROMO_CREDIT'];

/**
 * Catégorie de 08 E2 d'un moyen (PROPOSÉ, ADR-166) : la carte est le seul moyen natif de la bêta
 * (`NATIVE_PARTIAL`, ADR-147) ; crédit cash et crédit promo sont des moyens de Kmino ; tout autre
 * moyen (Yappy, QR, virement, inconnu) est non natif. Un moyen inconnu n'est jamais supposé natif.
 */
export function tenderKindOf(method: string | null): TenderKind {
  if (method === 'CARD') return 'NATIVE';
  if (method === 'CREDIT_CASH') return 'CASH_CREDIT';
  if (method === 'CREDIT_PROMO') return 'PROMO_CREDIT';
  return 'NON_NATIVE';
}

/**
 * Ordres d'un règlement sur les moyens d'origine (fonction pure, US-224f, ADR-166) : 08 E2 décide le
 * montant de chaque moyen, la règle 10 ses jambes (`tenderRefundOrders`) ; réaffectation d'abord
 * (règle 3), rattachée au premier moyen de la cascade. Rail de bêta (fail-closed, 08 E3, SM-8) : un
 * moyen non natif ou un crédit qui doit rembourser quelque chose exige le choix du voyageur
 * (`PENDING_CUSTOMER_CHOICE`) ou un crédit cash recréé, tous deux fermés en bêta (aucune coordonnée
 * bancaire stockée, `funds_holding_enabled` = false) ⇒ `REFUND_RAIL_UNAVAILABLE` : rien n'est écrit,
 * la demande est garée avec une alerte, jamais un remboursement partiel ni un autre moyen deviné.
 */
export function ordersByTender(
  plan: CancellationPlan,
  tenders: readonly CaptureTender[],
): readonly TenderOrder[] {
  const currency = plan.currency;
  const variation = variationOf(plan.record, currency);
  if (!LEGS.some((leg) => variation[leg].amountMinor !== 0n)) return [];
  if (tenders.length === 0) throw new CancellationPlanError('TRIP_NOT_CAPTURED');
  const paid: PaidTender[] = tenders.map((t, i) => ({
    id: t.operationId,
    kind: tenderKindOf(t.method),
    paid: money(t.amountMinor, currency),
    committed: money(t.committedMinor, currency),
    capturedRank: i + 1,
  }));
  const byId = new Map(tenders.map((t) => [t.operationId, t]));
  const tenderOf = (id: string): CaptureTender => {
    const t = byId.get(id);
    if (t === undefined) throw new CancellationPlanError('ROW_SHAPE');
    return t;
  };
  const orders = tenderRefundOrders(variation, paid);
  const out: TenderOrder[] = [];
  if (orders.reallocation !== null) {
    // premier moyen de la cascade (catégorie, puis capture la plus ancienne) : clé et compte
    const first = [...paid].sort(
      (a, b) =>
        TENDER_ORDER.indexOf(a.kind) - TENDER_ORDER.indexOf(b.kind) ||
        a.capturedRank - b.capturedRank,
    )[0];
    if (first === undefined) throw new CancellationPlanError('TRIP_NOT_CAPTURED');
    const legs = legAmounts(orders.reallocation);
    const amount = LEGS.reduce((s, leg) => (legs[leg] > 0n ? s + legs[leg] : s), 0n);
    out.push({
      kind: 'LEG_REALLOCATION',
      amountMinor: amount,
      legs,
      instanceSeq: 1,
      tender: tenderOf(first.id),
      rail: null,
    });
  }
  for (const r of orders.refunds) {
    if (r.kind !== 'NATIVE') throw new CancellationPlanError('REFUND_RAIL_UNAVAILABLE');
    out.push({
      kind: 'REFUND',
      amountMinor: r.legs.total.amountMinor,
      legs: legAmounts(r.legs),
      // 08 E4 : rang de l'instance parmi celles du même (règlement, REFUND, moyen) ; une seule par
      // moyen à la version 1
      instanceSeq: 1,
      tender: tenderOf(r.id),
      rail: 'NATIVE_PARTIAL',
    });
  }
  return out;
}

// ------------------------------------------------------------------ accès à la base (production)

const asWorker = async (db: SqlClient, worker: string): Promise<void> => {
  await db.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [worker]);
};

/** Ligne de la base d'une forme inattendue : refus déterministe, garé (jamais une erreur anonyme). */
const rowShape = (): CancellationPlanError => new CancellationPlanError('ROW_SHAPE');
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw rowShape();
  return v;
};
const textOrNull = (v: unknown): string | null => (v === null ? null : text(v));
const int = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw rowShape();
  return n;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw rowShape();
  return v;
};

/** Lecture des faits d'une demande en attente (aucune ligne : demande déjà traitée). */
export async function beginCancellation(
  db: SqlClient,
  cancellationId: string,
): Promise<CancellationFacts | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT cancellation_id, trip_id, segment_id, country_code, currency, trip_row_version,
            start_at_ms::text AS start_at_ms, booked_at_ms::text AS booked_at_ms,
            requested_reason, sub_reason, evidence_validated, checkin_validated,
            requested_at_ms::text AS requested_at_ms, quote_engine_version, quote_inputs,
            quote_inputs_hash, quote_outputs, quote_outputs_hash, quote_total_minor,
            quote_currency, params
       FROM core.booking_trip_cancellation_begin($1::uuid)`,
    [cancellationId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  const requestedReason = text(r['requested_reason']);
  // US-307 (ADR-191) : hostMessageTraced figé à la déclaration (no-show du voyageur seulement)
  let hostMessageTraced: boolean | null = null;
  if (requestedReason === 'GUEST_NO_SHOW') {
    const flags = await db.query<Record<string, unknown>>(
      'SELECT host_message_traced FROM core.booking_trip_cancellation_flags($1::uuid)',
      [cancellationId],
    );
    hostMessageTraced = bool(flags.rows[0]?.['host_message_traced']);
  }
  const frozen: FrozenQuote | null =
    r['quote_inputs'] === null || r['quote_inputs'] === undefined
      ? null
      : {
          format: FROZEN_QUOTE_FORMAT,
          engineVersion: text(r['quote_engine_version']),
          inputs: text(r['quote_inputs']),
          inputsHash: text(r['quote_inputs_hash']),
          outputs: text(r['quote_outputs']),
          outputsHash: text(r['quote_outputs_hash']),
          totalMinor: text(r['quote_total_minor']),
          currency: text(r['quote_currency']),
        };
  return {
    cancellationId: text(r['cancellation_id']),
    tripId: text(r['trip_id']),
    segmentId: text(r['segment_id']),
    country: text(r['country_code']),
    currency: text(r['currency']),
    tripRowVersion: int(r['trip_row_version']),
    startAtMs: int(r['start_at_ms']),
    bookedAtMs: int(r['booked_at_ms']),
    requestedReason,
    subReason: textOrNull(r['sub_reason']),
    evidenceValidated: bool(r['evidence_validated']),
    checkinValidated: bool(r['checkin_validated']),
    requestedAtMs: int(r['requested_at_ms']),
    ...(requestedReason === 'GUEST_NO_SHOW' ? { hostMessageTraced } : {}),
    frozen,
    params: r['params'] ?? null,
  };
}

export type CancellationOutcome =
  | { readonly outcome: 'SETTLED'; readonly costBearer: string; readonly orders: number }
  | { readonly outcome: 'SKIPPED' }
  | { readonly outcome: 'FIN_REVIEW' | 'FAILED'; readonly code: string }
  | { readonly outcome: 'RETRY'; readonly code: string }
  /** Garage ou alerte impossible : la demande reste en attente, reprise au passage suivant. */
  | { readonly outcome: 'DEFERRED'; readonly code: string };

/**
 * Essais passagers consécutifs (interblocage, sérialisation, alerte ou garage impossibles) admis
 * pour une demande avant de la garer `FAILED` (`RETRY_EXHAUSTED`) avec une alerte (PROPOSÉ,
 * ADR-148) ; compteur du processus, remis à zéro au redémarrage du travailleur.
 */
export const TRIP_CANCELLATION_MAX_RETRIES = 5;

export interface TripCancellationDeps {
  readonly transactions: WorkerTransactions;
  readonly alerts: AlertChannel;
  /**
   * Trip du moteur d'une demande (production : `cancellationTrip`, devis figé rejoué) ; remplacé
   * dans les tests par un trip des vecteurs de 08.
   */
  readonly tripOf?: (f: CancellationFacts) => SettlementTrip;
  /** Journal d'exploitation : comptes et codes seulement (17 §6.3). */
  readonly log?: (line: string) => void;
}

/**
 * Processeur du travailleur `trip_lifecycle` : une demande par transaction ; les refus
 * déterministes garent la demande, les erreurs passagères la laissent en attente.
 */
export class TripCancellationProcessor {
  readonly #deps: TripCancellationDeps;

  constructor(deps: TripCancellationDeps) {
    this.#deps = deps;
  }

  readonly #retries = new Map<string, number>();

  /**
   * Règle une demande ; ne lève jamais : toute issue est rendue. Refus déterministe ⇒ alerte P1
   * PUIS garage (une alerte perdue laisse la demande en attente, jamais garée en silence) ; erreur
   * passagère ⇒ demande laissée en attente, bornée à `TRIP_CANCELLATION_MAX_RETRIES` essais.
   */
  async process(cancellationId: string): Promise<CancellationOutcome> {
    let country: string | null = null;
    let alerted = false;
    let result: CancellationOutcome;
    try {
      result = await this.#deps.transactions.run(TRIP_LIFECYCLE_WORKER, async (db) => {
        const f = await beginCancellation(db, cancellationId);
        if (f === null) return { outcome: 'SKIPPED' } as const;
        country = f.country;
        const tripOf = this.#deps.tripOf ?? cancellationTrip;
        const attempt = await settleOrFinReview(
          () => planCancellation(f, tripOf(f)),
          f.country,
          this.#deps.alerts,
        );
        if (attempt.outcome === 'FIN_REVIEW') {
          // settleOrFinReview a déjà levé l'alerte FIN_SETTLEMENT_REVIEW : une seule alerte
          alerted = true;
          return { outcome: 'FIN_REVIEW', code: attempt.code } as const;
        }
        return this.#apply(db, f, attempt.result);
      });
    } catch (error) {
      result = classifyOrUnexpected(error);
      if (result.outcome === 'FAILED' && result.code === UNEXPECTED_CODE) {
        this.#log({ level: 'error', event: 'unexpected', error_class: errorClass(error) });
      }
    }
    if (result.outcome === 'RETRY') {
      const n = (this.#retries.get(cancellationId) ?? 0) + 1;
      this.#retries.set(cancellationId, n);
      if (n < TRIP_CANCELLATION_MAX_RETRIES) return result;
      result = { outcome: 'FAILED', code: 'RETRY_EXHAUSTED' };
    }
    if (result.outcome !== 'FIN_REVIEW' && result.outcome !== 'FAILED') {
      this.#retries.delete(cancellationId);
      return result;
    }
    const parked = result;
    try {
      if (!alerted) {
        await this.#deps.alerts.send({
          code:
            parked.outcome === 'FIN_REVIEW' ? 'FIN_SETTLEMENT_REVIEW' : 'TRIP_CANCELLATION_FAILED',
          severity: 'P1',
          counts: { cancellations: 1 },
          labels:
            country === null ? { error_code: parked.code } : { country, error_code: parked.code },
        });
      }
      await this.#park(cancellationId, parked.outcome, parked.code);
    } catch (error) {
      // alerte ou garage impossible : la demande reste en attente (reprise, essais bornés)
      const n = (this.#retries.get(cancellationId) ?? 0) + 1;
      this.#retries.set(cancellationId, n);
      this.#log({ level: 'warn', event: 'park_deferred', error_class: errorClass(error) });
      return { outcome: 'DEFERRED', code: parked.code };
    }
    this.#retries.delete(cancellationId);
    return parked;
  }

  #log(fields: Record<string, string>): void {
    this.#deps.log?.(JSON.stringify({ worker: TRIP_LIFECYCLE_WORKER, ...fields }));
  }

  async #apply(db: SqlClient, f: CancellationFacts, plan: CancellationPlan) {
    await asWorker(db, SETTLEMENT_WORKER);
    const { rows: recorded } = await db.query<{ id: string }>(
      `SELECT core.settlement_cmd_record($1::uuid, $2::uuid, 1, 1, NULL, $3, $4::jsonb) AS id`,
      [
        randomUUID(),
        f.tripId,
        f.tripRowVersion,
        JSON.stringify(settlementRecordPayload(plan.record)),
      ],
    );
    const settlementId = text(recorded[0]?.id);
    await asWorker(db, TRIP_LIFECYCLE_WORKER);
    const { rows: settled } = await db.query<{ r: { costBearer?: unknown } }>(
      'SELECT core.booking_cmd_trip_settle_cancellation($1::uuid, $2::uuid) AS r',
      [f.cancellationId, settlementId],
    );
    const costBearer = text(settled[0]?.r.costBearer);
    let count = 0;
    if (plan.orders.length > 0) {
      await asWorker(db, PAYMENT_COMMAND_WORKER);
      // US-224f (ADR-166) : chaque moyen d'origine rembourse ce que lui donne 08 E2, jambes en
      // cascade (règle 10) ; Σ remboursements = remboursement du voyageur (contrainte différée 0124)
      const orders = ordersByTender(plan, await tendersOf(db, f.tripId, f.currency));
      count = orders.length;
      const recorder = new PgOperationRecorder(db);
      const refunds = new PgRefundPlanner(db);
      for (const o of orders) {
        const idemPlain = orderKey(f, o, o.tender.operationId);
        const idemSent = idempotencyKeyToSend(idemPlain, PSP_IDEMPOTENCY_MAX_LENGTH);
        if (o.kind === 'REFUND') {
          // US-224b (ADR-147) : un remboursement naît d'une instance PLANNED (SM-8), rail du moyen
          // d'origine ; son envoi au PSP est le service d'US-224 (aucun PSP réel avant le lot C)
          if (o.rail === null) throw new CancellationPlanError('REFUND_RAIL_UNAVAILABLE');
          await refunds.plan({
            instanceId: randomUUID(),
            operationId: randomUUID(),
            settlementId,
            refundedOperationId: o.tender.operationId,
            instanceSeq: o.instanceSeq,
            rail: o.rail,
            legs: o.legs,
            idemPlain,
            idemSent,
          });
          continue;
        }
        // US-307 (ADR-191 ; 08 E7 règle 3, 17 §2.8) : réaffectation seulement si la capacité
        // SUPPORTS_PAYOUT_ADJUSTMENT est validée pour le compte et le moyen (inconnue = non)
        await db.query('SELECT core.payment_assert_payout_adjustment($1::uuid, $2)', [
          o.tender.accountId,
          o.tender.method,
        ]);
        await recorder.record({
          id: randomUUID(),
          holdId: null,
          tripId: f.tripId,
          pspAccountId: o.tender.accountId,
          method: o.tender.method,
          kind: o.kind,
          purpose: 'RENT',
          amountMinor: o.amountMinor,
          currency: f.currency,
          attemptNo: 1,
          idemPlain,
          idemSent,
          legs: o.legs,
          settlement: { id: settlementId, version: 1 },
        });
      }
    }
    return { outcome: 'SETTLED', costBearer, orders: count } as const;
  }

  async #park(cancellationId: string, status: 'FIN_REVIEW' | 'FAILED', code: string) {
    await this.#deps.transactions.run(TRIP_LIFECYCLE_WORKER, (db) =>
      db.query('SELECT core.booking_cmd_trip_park_cancellation($1::uuid, $2, $3) AS r', [
        cancellationId,
        status,
        code,
      ]),
    );
  }
}

/**
 * Moyens d'origine du trip (US-224f, ADR-166) : encaissements RÉUSSIS du loyer dans la devise du
 * trip (capture, débit MIT, recouvrement : mêmes natures que `core.payment_cmd_plan_refund`), dans
 * l'ordre des captures, avec ce qui est déjà engagé sur chacun (instances SM-8 hors `CANCELLED` et
 * `SUPERSEDED`, 08 E2). Un encaissement dans une autre devise n'est pas un moyen : le remboursement
 * dépasse alors Σ payé et la demande est garée (fail-closed, aucune conversion en bêta).
 */
async function tendersOf(
  db: SqlClient,
  tripId: string,
  currency: string,
): Promise<readonly CaptureTender[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT o.id, o.psp_account_id, o.method, o.amount_minor::text AS amount_minor,
            COALESCE(e.engaged, 0)::text AS committed_minor
       FROM core.payment_payment_operation AS o
       LEFT JOIN LATERAL (SELECT pg_catalog.sum(ri.amount_trip_minor) AS engaged
                            FROM core.payment_refund_instance AS ri
                           WHERE ri.refunded_operation_id = o.id
                             AND ri.status NOT IN ('CANCELLED', 'SUPERSEDED')) AS e ON true
      WHERE o.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
        AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
        AND o.status = 'SUCCEEDED' AND o.currency = $2
        AND (o.trip_id = $1::uuid
             OR o.hold_id = (SELECT t.source_hold_id FROM core.booking_trip AS t
                              WHERE t.id = $1::uuid))
      ORDER BY o.created_at, o.id`,
    [tripId, currency],
  );
  return rows.map((r) => ({
    operationId: text(r['id']),
    accountId: text(r['psp_account_id']),
    method: textOrNull(r['method']),
    amountMinor: minorOf(r['amount_minor']),
    committedMinor: minorOf(r['committed_minor']),
  }));
}

const minorOf = (v: unknown): bigint => {
  const s = text(v);
  if (!/^[0-9]{1,18}$/.test(s)) throw rowShape();
  return BigInt(s);
};

/**
 * Clé d'idempotence d'un ordre (08 E4) : `{trip}:{segment}:v1:{opération}:{moyen}:i{n}:a1`, le
 * moyen étant la capture d'origine. La réaffectation n'est pas une opération du PSP de 08 E4 : sa
 * clé suit la même forme avec `LEG_REALLOCATION` (PROPOSÉ, ADR-148).
 */
export function orderKey(f: CancellationFacts, o: CancellationOrder, tenderId: string): string {
  if (o.kind === 'REFUND') {
    return settlementOperationKey({
      tripId: f.tripId,
      segmentId: f.segmentId,
      settlementVersion: 1,
      operationType: 'REFUND',
      tenderId,
      instanceSeq: o.instanceSeq,
      attemptNo: 1,
    });
  }
  return [
    f.tripId,
    f.segmentId,
    'v1',
    'LEG_REALLOCATION',
    tenderId,
    `i${o.instanceSeq}`,
    'a1',
  ].join(':');
}

/** Code garé d'une erreur sans SQLSTATE (programme, réseau) : la file n'est jamais bloquée. */
export const UNEXPECTED_CODE = 'UNEXPECTED_ERROR';

/** Classe d'une erreur (nom du constructeur borné), jamais son message (17 §6.3). */
function errorClass(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Unknown';
}

/** `classify`, et toute erreur sans SQLSTATE garée `FAILED` (`UNEXPECTED_ERROR`). */
export function classifyOrUnexpected(error: unknown): CancellationOutcome {
  try {
    return classify(error);
  } catch {
    return { outcome: 'FAILED', code: UNEXPECTED_CODE };
  }
}

/**
 * Contraintes de la base qui renvoient à la décision FINANCE d'US-224b (08 E7 règle 5) ; US-227
 * (ADR-165) : jambe INSURER déjà portée par un bordereau émis (08 E7 règle 3 bis, ADR-147).
 */
const FIN_CONSTRAINTS = new Set([
  'operation_settlement_fin_review',
  'refund_exceeds_collected',
  // US-224f (08 E2) : jamais plus que le payé d'un moyen
  'refund_exceeds_tender',
  'advance_decision_required',
  'insurer_leg_on_bordereau',
  // US-307 (ADR-191) : réaffectation sans SUPPORTS_PAYOUT_ADJUSTMENT validée (17 §2.8)
  'leg_reallocation_unsupported',
]);
/** Interblocage, sérialisation : reprise au passage suivant. */
const RETRY_STATES = new Set(['40P01', '40001']);
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * Refus déterministe (garé) ou erreur passagère (reprise au passage suivant). Le code garé est le
 * nom de la contrainte de la base en majuscules (jamais un message ni une valeur), à défaut le
 * SQLSTATE (`DB_<état>`) ; une erreur sans SQLSTATE (réseau, programme) est relancée.
 */
export function classify(error: unknown): CancellationOutcome {
  if (error instanceof CancellationPlanError) return { outcome: 'FAILED', code: error.code };
  if (isSettlementError(error)) {
    // N-365 (ADR-090 décision 2, ADR-166 n° 8) : un remboursement hors bornes n'est jamais réduit
    // ni abandonné ; où qu'il soit levé (moteur ou 08 E2 des moyens), il va à la revue FIN
    return error.code === 'REFUND_OUT_OF_RANGE'
      ? { outcome: 'FIN_REVIEW', code: error.code }
      : { outcome: 'FAILED', code: error.code };
  }
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const state = typeof e['code'] === 'string' && SQLSTATE.test(e['code']) ? e['code'] : null;
  if (state === null) throw error;
  if (RETRY_STATES.has(state)) return { outcome: 'RETRY', code: 'RETRY' };
  const constraint =
    typeof e['constraint'] === 'string' && CONSTRAINT.test(e['constraint'])
      ? e['constraint']
      : null;
  if (constraint !== null && FIN_CONSTRAINTS.has(constraint)) {
    return { outcome: 'FIN_REVIEW', code: constraint.toUpperCase() };
  }
  return {
    outcome: 'FAILED',
    code: constraint === null ? `DB_${state}` : constraint.toUpperCase(),
  };
}
/** Période du travailleur (PROPOSÉ, ADR-148) : une demande réglée en ~10 s, comme la conversion. */
export const TRIP_CANCELLATION_PERIOD_SECONDS = 10;
/** Demandes traitées par passage, une par transaction. */
export const TRIP_CANCELLATION_BATCH = 50;

/**
 * Tâche périodique `trip_lifecycle` : chaque demande en attente est réglée dans sa propre
 * transaction ; les comptes seulement sont journalisés (aucun identifiant, 17 §6.3).
 */
export function registerTripCancellations(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  alerts: AlertChannel,
  log: (line: string) => void,
  /** Tests seulement : trip du moteur d'une demande (défaut : devis figé rejoué). */
  tripOf?: (f: CancellationFacts) => SettlementTrip,
): void {
  const processor = new TripCancellationProcessor({
    transactions,
    alerts,
    log,
    ...(tripOf === undefined ? {} : { tripOf }),
  });
  registry.registerPeriodic(
    TRIP_LIFECYCLE_WORKER,
    TRIP_CANCELLATION_PERIOD_SECONDS,
    async (_payload, tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM core.booking_trip_cancellations_pending($1)',
        [TRIP_CANCELLATION_BATCH],
      );
      const counts = { settled: 0, skipped: 0, fin_review: 0, failed: 0, retry: 0, deferred: 0 };
      for (const row of rows) {
        // `process` ne lève pas : une demande ne bloque jamais les suivantes
        const r = await processor.process(row.id);
        if (r.outcome === 'SETTLED') counts.settled++;
        else if (r.outcome === 'SKIPPED') counts.skipped++;
        else if (r.outcome === 'FIN_REVIEW') counts.fin_review++;
        else if (r.outcome === 'FAILED') counts.failed++;
        else if (r.outcome === 'RETRY') counts.retry++;
        else counts.deferred++;
      }
      log(JSON.stringify({ level: 'info', worker: TRIP_LIFECYCLE_WORKER, ...counts }));
    },
  );
}
