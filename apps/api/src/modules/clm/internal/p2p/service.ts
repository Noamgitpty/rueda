/**
 * Service des sinistres entre particuliers d'un trip (US-318 ; 19 US-318 critères 2 et 3 ;
 * 16 CLM-002 ; 08 BR-TT-02 à 04 ; ADR-198). Toute règle est jugée par la base (partie de la
 * session, fenêtre du trip, demande d'aide, photos, délai à l'heure serveur, période du trip, pièce,
 * frais du pays, jambes explicites) : le service lit le corps strictement, appelle la commande et
 * traduit l'issue. Aucune heure de réception ni aucun montant de frais n'est lu du client ; le
 * montant payé par l'hôte est un texte d'entier en unités mineures. Base injoignable ⇒ 503.
 *
 * Suite (0181, ADR-201) : référence du PV obligatoire (unique par trip, jugée en base) ; le
 * voyageur lit ses refacturations, paie ou conteste avant l'échéance (08 BR-TT-02 : 48 h) ;
 * aucune heure ni aucun montant n'est reçu de lui.
 */
import { Inject, Injectable } from '@nestjs/common';
import { CLM_TRIP_CLAIMS_STORE } from '../tokens.js';
import { TripClaimHttpError, tripClaimOutcomeCode } from './errors.js';
import { TRAFFIC_CHARGE_KINDS, TripClaimStoreError } from './store.js';
import type {
  IncidentInput,
  TrafficChargeInput,
  TrafficChargeKind,
  TrafficDisputeInput,
  TripClaimsStore,
} from './store.js';

type Body = Readonly<Record<string, unknown>>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^[1-9][0-9]{0,12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const SLOT = /^DAMAGE_[0-9]{2}$/;
/** Référence d'un avis, d'un PV ou d'un reçu (même format que la base, 0181). */
export const TRAFFIC_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{1,38}[A-Za-z0-9]$/;

function only(body: Body, keys: readonly string[], required: readonly string[] = keys): void {
  for (const k of Object.keys(body)) {
    if (!keys.includes(k)) throw new TripClaimHttpError('REQUEST_INVALID');
  }
  for (const k of required) {
    if (!(k in body)) throw new TripClaimHttpError('REQUEST_INVALID');
  }
}

const uuidOf = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v.toLowerCase())) {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  return v.toLowerCase();
};

/** `POST /trips/{tripId}/incidents` : `{ requestId, caseId, thirdParty, policeReport }`. */
export function parseIncidentRequest(body: Body): IncidentInput {
  only(body, ['requestId', 'caseId', 'thirdParty', 'policeReport']);
  const thirdParty = body['thirdParty'];
  const policeReport = body['policeReport'];
  if (typeof thirdParty !== 'boolean' || typeof policeReport !== 'boolean') {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  return {
    requestId: uuidOf(body['requestId']),
    caseId: uuidOf(body['caseId']),
    thirdParty,
    policeReport,
  };
}

/**
 * `POST /trips/{tripId}/traffic-charges` :
 * `{ requestId, kind, occurredAt, amountMinor, fileId }` (montant payé par l'hôte, texte d'entier).
 */
export function parseTrafficChargeRequest(body: Body): TrafficChargeInput {
  only(
    body,
    ['requestId', 'kind', 'occurredAt', 'amountMinor', 'fileId', 'reference'],
    ['requestId', 'kind', 'occurredAt', 'amountMinor', 'fileId'],
  );
  const rawRef = body['reference'];
  if (rawRef !== undefined && typeof rawRef !== 'string') {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  const reference = (rawRef ?? '').trim();
  if (reference === '') throw new TripClaimHttpError('TRAFFIC_REFERENCE_REQUIRED');
  if (
    !TRAFFIC_REFERENCE.test(reference) ||
    reference.toUpperCase().replace(/[^A-Z0-9]/g, '').length < 3
  ) {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  const kind = body['kind'];
  const at = body['occurredAt'];
  const amount = body['amountMinor'];
  if (
    typeof kind !== 'string' ||
    !(TRAFFIC_CHARGE_KINDS as readonly string[]).includes(kind) ||
    typeof at !== 'string' ||
    at.length > 40 ||
    !ISO.test(at) ||
    typeof amount !== 'string' ||
    !MINOR.test(amount)
  ) {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  const occurredAt = new Date(at);
  if (!Number.isFinite(occurredAt.getTime())) throw new TripClaimHttpError('REQUEST_INVALID');
  return {
    requestId: uuidOf(body['requestId']),
    kind: kind as TrafficChargeKind,
    occurredAt,
    amountMinor: BigInt(amount),
    fileId: uuidOf(body['fileId']),
    reference,
  };
}

/** `POST /trips/{tripId}/traffic-charges/{chargeId}/dispute` : `{ reason, evidence? }`. */
export function parseTrafficDisputeRequest(body: Body): TrafficDisputeInput {
  only(body, ['reason', 'evidence'], ['reason']);
  const reason = body['reason'];
  const evidence = body['evidence'] ?? [];
  if (
    typeof reason !== 'string' ||
    reason.length > 1000 ||
    !Array.isArray(evidence) ||
    evidence.length > 10
  ) {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  return { reason, evidence: evidence.map(uuidOf) };
}

export type TrafficGuestStatus =
  'AWAITING_GUEST' | 'ACCEPTED' | 'DISPUTED' | 'DECIDED_CHARGE' | 'REJECTED';
export const TRAFFIC_GUEST_STATUSES: readonly TrafficGuestStatus[] = [
  'AWAITING_GUEST',
  'ACCEPTED',
  'DISPUTED',
  'DECIDED_CHARGE',
  'REJECTED',
];
export type TrafficExecutionStatus = 'PENDING' | 'DONE' | 'BLOCKED' | 'VOID';
const EXECUTION_STATUSES: readonly TrafficExecutionStatus[] = [
  'PENDING',
  'DONE',
  'BLOCKED',
  'VOID',
];

export interface TripClaimsView {
  readonly tripId: string;
  readonly country: string;
  readonly currency: string;
  readonly open: boolean;
  readonly tripStartAt: string;
  readonly tripEndAt: string | null;
  readonly deadlineAt: string | null;
  readonly feeBps: number | null;
  /** Délai du voyageur pour payer ou contester (h) et plafond du montant du pays (0181). */
  readonly responseHours: number | null;
  readonly capMinor: string | null;
  readonly theft: {
    readonly status: 'THEFT_INVESTIGATION' | 'RETURNED';
    readonly openedAt: string;
    readonly closedAt: string | null;
    readonly insurerStatus: 'PENDING' | 'SENT' | 'WITHDRAWN';
  } | null;
  readonly charges: readonly {
    readonly id: string;
    readonly kind: TrafficChargeKind;
    readonly occurredAt: string;
    readonly amountMinor: string;
    readonly adminFeeMinor: string;
    readonly totalMinor: string;
    readonly declaredAt: string;
    /** Référence du PV ; échéance et réponse du voyageur (`null` : refacturation de 0178). */
    readonly reference: string | null;
    readonly responseDueAt: string | null;
    readonly guestStatus: TrafficGuestStatus | null;
    readonly status: TrafficExecutionStatus;
  }[];
  readonly evidence: readonly {
    readonly fileId: string;
    readonly slot: string;
    readonly receivedAt: string;
    readonly used: boolean;
  }[];
}

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Vue jsonb de `core.claim_host_trip_claims` ; forme inattendue ⇒ 503 (jamais une vue partielle). */
export function parseTripClaimsView(v: Readonly<Record<string, unknown>>): TripClaimsView {
  const bad = (): never => {
    throw new TripClaimStoreError('lecture des sinistres : vue illisible', undefined);
  };
  const iso = (x: unknown): string =>
    typeof x === 'string' && ISO.test(x) && Number.isFinite(Date.parse(x))
      ? new Date(x).toISOString()
      : bad();
  const isoOrNull = (x: unknown): string | null => (x === null || x === undefined ? null : iso(x));
  const minor = (x: unknown): string =>
    typeof x === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(x) ? x : bad();
  const oneOf = <T extends string>(x: unknown, values: readonly T[]): T =>
    typeof x === 'string' && (values as readonly string[]).includes(x) ? (x as T) : bad();
  const tripId = v['tripId'];
  if (
    typeof tripId !== 'string' ||
    !UUID.test(tripId) ||
    typeof v['country'] !== 'string' ||
    !COUNTRY.test(v['country']) ||
    typeof v['currency'] !== 'string' ||
    !CURRENCY.test(v['currency']) ||
    typeof v['open'] !== 'boolean' ||
    !Array.isArray(v['charges']) ||
    !Array.isArray(v['evidence'])
  ) {
    return bad();
  }
  const fee = v['feeBps'];
  if (fee !== null && (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0)) return bad();
  const hours = v['responseHours'] ?? null;
  if (hours !== null && (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1)) {
    return bad();
  }
  const cap = v['capMinor'] ?? null;
  const capMinor = cap === null ? null : minor(cap);
  const t = v['theft'];
  let theft: TripClaimsView['theft'] = null;
  if (t !== null && t !== undefined) {
    if (!isObj(t)) return bad();
    theft = {
      status: oneOf(t['status'], ['THEFT_INVESTIGATION', 'RETURNED'] as const),
      openedAt: iso(t['openedAt']),
      closedAt: isoOrNull(t['closedAt']),
      insurerStatus: oneOf(t['insurerStatus'], ['PENDING', 'SENT', 'WITHDRAWN'] as const),
    };
  }
  const charges = (v['charges'] as unknown[]).map((c) => {
    if (!isObj(c) || typeof c['id'] !== 'string' || !UUID.test(c['id'])) return bad();
    return {
      id: c['id'],
      kind: oneOf(c['kind'], TRAFFIC_CHARGE_KINDS),
      occurredAt: iso(c['occurredAt']),
      amountMinor: minor(c['amountMinor']),
      adminFeeMinor: minor(c['adminFeeMinor']),
      totalMinor: minor(c['totalMinor']),
      declaredAt: iso(c['declaredAt']),
      reference: referenceOrNull(c['reference'], bad),
      responseDueAt: isoOrNull(c['responseDueAt']),
      guestStatus:
        c['guestStatus'] === null || c['guestStatus'] === undefined
          ? null
          : oneOf(c['guestStatus'], TRAFFIC_GUEST_STATUSES),
      status: oneOf(c['status'], EXECUTION_STATUSES),
    };
  });
  const evidence = (v['evidence'] as unknown[]).map((e) => {
    if (
      !isObj(e) ||
      typeof e['fileId'] !== 'string' ||
      !UUID.test(e['fileId']) ||
      typeof e['slot'] !== 'string' ||
      !SLOT.test(e['slot']) ||
      typeof e['used'] !== 'boolean'
    ) {
      return bad();
    }
    return {
      fileId: e['fileId'],
      slot: e['slot'],
      receivedAt: iso(e['receivedAt']),
      used: e['used'],
    };
  });
  return {
    tripId,
    country: v['country'],
    currency: v['currency'],
    open: v['open'],
    tripStartAt: iso(v['tripStartAt']),
    tripEndAt: isoOrNull(v['tripEndAt']),
    deadlineAt: isoOrNull(v['deadlineAt']),
    feeBps: fee as number | null,
    responseHours: hours as number | null,
    capMinor,
    theft,
    charges,
    evidence,
  };
}

function referenceOrNull(x: unknown, bad: () => never): string | null {
  if (x === null || x === undefined) return null;
  return typeof x === 'string' && TRAFFIC_REFERENCE.test(x) ? x : bad();
}

/** Refacturations du trip vues par son voyageur (`core.claim_traffic_guest_view`). */
export interface TrafficGuestView {
  readonly tripId: string;
  readonly currency: string;
  readonly charges: readonly {
    readonly id: string;
    readonly kind: TrafficChargeKind;
    readonly occurredAt: string;
    readonly reference: string;
    readonly amountMinor: string;
    readonly adminFeeMinor: string;
    readonly totalMinor: string;
    readonly declaredAt: string;
    readonly responseDueAt: string;
    readonly status: TrafficGuestStatus;
    readonly executionStatus: TrafficExecutionStatus;
    readonly canRespond: boolean;
    readonly disputeReason: string | null;
    readonly decidedAt: string | null;
    readonly decisionRationale: string | null;
  }[];
  /** Photos du trip proposées comme pièces d'une contestation (tant qu'une réponse est possible). */
  readonly photos: readonly {
    readonly fileId: string;
    readonly kind: 'CHECKIN' | 'CHECKOUT';
    readonly slot: string;
    readonly takenBy: 'HOST' | 'GUEST';
    readonly receivedAt: string;
  }[];
}

/** Vue jsonb du voyageur ; forme inattendue ⇒ 503 (jamais une vue partielle). */
export function parseTrafficGuestView(v: Readonly<Record<string, unknown>>): TrafficGuestView {
  const bad = (): never => {
    throw new TripClaimStoreError('lecture des refacturations : vue illisible', undefined);
  };
  const iso = (x: unknown): string =>
    typeof x === 'string' && ISO.test(x) && Number.isFinite(Date.parse(x))
      ? new Date(x).toISOString()
      : bad();
  const isoOrNull = (x: unknown): string | null => (x === null || x === undefined ? null : iso(x));
  const minor = (x: unknown): string =>
    typeof x === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(x) ? x : bad();
  const oneOf = <T extends string>(x: unknown, values: readonly T[]): T =>
    typeof x === 'string' && (values as readonly string[]).includes(x) ? (x as T) : bad();
  const text = (x: unknown): string | null =>
    x === null || x === undefined ? null : typeof x === 'string' ? x : bad();
  const tripId = v['tripId'];
  if (
    typeof tripId !== 'string' ||
    !UUID.test(tripId) ||
    typeof v['currency'] !== 'string' ||
    !CURRENCY.test(v['currency']) ||
    !Array.isArray(v['charges']) ||
    !Array.isArray(v['photos'])
  ) {
    return bad();
  }
  const charges = (v['charges'] as unknown[]).map((c) => {
    if (
      !isObj(c) ||
      typeof c['id'] !== 'string' ||
      !UUID.test(c['id']) ||
      typeof c['canRespond'] !== 'boolean'
    ) {
      return bad();
    }
    return {
      id: c['id'],
      kind: oneOf(c['kind'], TRAFFIC_CHARGE_KINDS),
      occurredAt: iso(c['occurredAt']),
      reference: referenceOrNull(c['reference'], bad) ?? bad(),
      amountMinor: minor(c['amountMinor']),
      adminFeeMinor: minor(c['adminFeeMinor']),
      totalMinor: minor(c['totalMinor']),
      declaredAt: iso(c['declaredAt']),
      responseDueAt: iso(c['responseDueAt']),
      status: oneOf(c['status'], TRAFFIC_GUEST_STATUSES),
      executionStatus: oneOf(c['executionStatus'], EXECUTION_STATUSES),
      canRespond: c['canRespond'],
      disputeReason: text(c['disputeReason']),
      decidedAt: isoOrNull(c['decidedAt']),
      decisionRationale: text(c['decisionRationale']),
    };
  });
  const photos = (v['photos'] as unknown[]).map((p) => {
    if (!isObj(p) || typeof p['fileId'] !== 'string' || !UUID.test(p['fileId'])) return bad();
    if (typeof p['slot'] !== 'string' || !/^[A-Z][A-Z0-9_]{1,31}$/.test(p['slot'])) return bad();
    return {
      fileId: p['fileId'],
      kind: oneOf(p['kind'], ['CHECKIN', 'CHECKOUT'] as const),
      slot: p['slot'],
      takenBy: oneOf(p['takenBy'], ['HOST', 'GUEST'] as const),
      receivedAt: iso(p['receivedAt']),
    };
  });
  return { tripId, currency: v['currency'], charges, photos };
}

/** Texte d'un entier en unités mineures rendu par la base ; autre forme ⇒ 503 (fail-closed). */
function minorText(x: unknown): string {
  if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(x)) {
    throw new TripClaimHttpError('TRIP_CLAIM_UNAVAILABLE');
  }
  return x;
}

@Injectable()
export class TripClaimsService {
  constructor(@Inject(CLM_TRIP_CLAIMS_STORE) private readonly store: TripClaimsStore) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof TripClaimStoreError) {
        // identifiant de requête déjà pris par une autre déclaration : 22023 (entrée invalide)
        if (error.sqlstate === '22023') throw new TripClaimHttpError('REQUEST_INVALID');
        throw new TripClaimHttpError('TRIP_CLAIM_UNAVAILABLE');
      }
      throw error;
    }
  }

  async view(proof: Buffer, tripId: string): Promise<TripClaimsView> {
    const v = await this.#call(() => this.store.hostClaims(proof, tripId));
    if (v === null) throw new TripClaimHttpError('TRIP_CLAIM_NOT_FOUND');
    return this.#call(async () => parseTripClaimsView(v));
  }

  async reportIncident(proof: Buffer, tripId: string, body: Body) {
    const input = parseIncidentRequest(body);
    const r = await this.#call(() => this.store.reportIncident(proof, tripId, input));
    if (
      (r.outcome !== 'REPORTED' && r.outcome !== 'DUPLICATE' && r.outcome !== 'EXISTS') ||
      r.incidentId === null ||
      r.reportedAt === null ||
      r.photoCount === null
    ) {
      throw new TripClaimHttpError(tripClaimOutcomeCode(r.outcome));
    }
    return {
      incidentId: r.incidentId,
      reportedAt: r.reportedAt.toISOString(),
      photoCount: r.photoCount,
      replayed: r.outcome !== 'REPORTED',
    };
  }

  /**
   * Récapitulatif AVANT l'envoi (revue ux n° 1) : mêmes contrôles que la déclaration, montants
   * calculés par la base (montant payé, frais de gestion, total refacturé au voyageur, devise),
   * rien n'est écrit ; l'hôte confirme ensuite par `declareTrafficCharge` avec le même corps.
   */
  async previewTrafficCharge(proof: Buffer, tripId: string, body: Body) {
    const input = parseTrafficChargeRequest(body);
    const r = await this.#call(() => this.store.declareTrafficCharge(proof, tripId, input, true));
    if (r.outcome !== 'PREVIEW') this.#refuse(r);
    const b = r.body ?? {};
    const currency = b['currency'];
    const fee = b['feeBps'];
    const deadline = b['deadlineAt'];
    const hours = b['responseHours'];
    if (
      typeof currency !== 'string' ||
      !CURRENCY.test(currency) ||
      typeof fee !== 'number' ||
      !Number.isInteger(fee) ||
      typeof deadline !== 'string' ||
      typeof hours !== 'number' ||
      !Number.isInteger(hours) ||
      hours < 1
    ) {
      throw new TripClaimHttpError('TRIP_CLAIM_UNAVAILABLE');
    }
    return {
      kind: input.kind,
      occurredAt: input.occurredAt.toISOString(),
      currency,
      feeBps: fee,
      amountMinor: minorText(b['amountMinor']),
      adminFeeMinor: minorText(b['adminFeeMinor']),
      totalMinor: minorText(b['totalMinor']),
      deadlineAt: new Date(deadline).toISOString(),
      reference: input.reference,
      responseHours: hours,
      capMinor: minorText(b['capMinor']),
      chargedBy: 'SEPARATE_CARD_CHARGE' as const,
    };
  }

  #refuse(r: {
    readonly outcome: string;
    readonly body: Readonly<Record<string, unknown>> | null;
  }): never {
    const code = tripClaimOutcomeCode(r.outcome);
    const deadline = r.body?.['deadlineAt'];
    const existing = r.body?.['chargeId'];
    const cap = r.body?.['capMinor'];
    let extra: Record<string, string> | undefined;
    if (code === 'TRAFFIC_CHARGE_DEADLINE_PASSED' && typeof deadline === 'string') {
      extra = { deadlineAt: deadline };
    } else if (
      code === 'TRAFFIC_DUPLICATE' &&
      typeof existing === 'string' &&
      UUID.test(existing)
    ) {
      extra = { chargeId: existing };
    } else if (
      code === 'TRAFFIC_AMOUNT_ABOVE_CAP' &&
      typeof cap === 'string' &&
      /^(0|[1-9][0-9]{0,17})$/.test(cap)
    ) {
      extra = { capMinor: cap };
    }
    throw new TripClaimHttpError(code, extra);
  }

  async declareTrafficCharge(proof: Buffer, tripId: string, body: Body) {
    const input = parseTrafficChargeRequest(body);
    const r = await this.#call(() => this.store.declareTrafficCharge(proof, tripId, input, false));
    if ((r.outcome !== 'DECLARED' && r.outcome !== 'DUPLICATE') || r.chargeId === null) {
      this.#refuse(r);
    }
    const b = r.body ?? {};
    const text = (x: unknown): string => {
      if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(x)) {
        throw new TripClaimHttpError('TRIP_CLAIM_UNAVAILABLE');
      }
      return x;
    };
    const deadline = b['deadlineAt'];
    const due = b['responseDueAt'];
    if (
      typeof deadline !== 'string' ||
      typeof due !== 'string' ||
      !Number.isFinite(Date.parse(due)) ||
      !CODE.test(r.outcome)
    ) {
      throw new TripClaimHttpError('TRIP_CLAIM_UNAVAILABLE');
    }
    return {
      chargeId: r.chargeId,
      amountMinor: text(b['amountMinor']),
      adminFeeMinor: text(b['adminFeeMinor']),
      totalMinor: text(b['totalMinor']),
      deadlineAt: new Date(deadline).toISOString(),
      responseDueAt: new Date(due).toISOString(),
      replayed: r.outcome === 'DUPLICATE',
    };
  }

  /** Refacturations du trip vues par son voyageur (S12 : payer ou contester). */
  async guestCharges(proof: Buffer, tripId: string): Promise<TrafficGuestView> {
    const v = await this.#call(() => this.store.guestCharges(proof, tripId));
    if (v === null) throw new TripClaimHttpError('TRIP_CLAIM_NOT_FOUND');
    return this.#call(async () => parseTrafficGuestView(v));
  }

  /** Paiement par le voyageur avant l'échéance (accord écrit) ; débit par Kmino ensuite. */
  async acceptTrafficCharge(proof: Buffer, chargeId: string, body: Body) {
    only(body, []);
    const r = await this.#call(() => this.store.acceptTrafficCharge(proof, chargeId));
    if (r !== 'ACCEPTED' && r !== 'ALREADY_ACCEPTED') {
      throw new TripClaimHttpError(tripClaimOutcomeCode(r));
    }
    return { chargeId, status: 'ACCEPTED' as const, replayed: r === 'ALREADY_ACCEPTED' };
  }

  /** Contestation par le voyageur avant l'échéance (motif, photos du trip facultatives). */
  async disputeTrafficCharge(proof: Buffer, chargeId: string, body: Body) {
    const input = parseTrafficDisputeRequest(body);
    const r = await this.#call(() => this.store.disputeTrafficCharge(proof, chargeId, input));
    if (r !== 'DISPUTED' && r !== 'ALREADY_DISPUTED') {
      throw new TripClaimHttpError(tripClaimOutcomeCode(r));
    }
    return { chargeId, status: 'DISPUTED' as const, replayed: r === 'ALREADY_DISPUTED' };
  }
}
