/**
 * Frais annexes entre particuliers côté site (US-706, ADR-197 ; 16 CLM-021 ; 10b A04, S12) :
 * lecture DÉFENSIVE de `GET /trips/{id}/incidental-fees` (toute forme inattendue ⇒ `null`, l'écran
 * dit l'erreur, jamais un état partiel), textes des types, des états et des photos, liens des
 * écrans. L'hôte demande un frais de la liste fermée avec des photos du trip ; le voyageur paie ou
 * conteste avant l'échéance relue en base. Le site n'envoie jamais d'heure ni de jambe ; le montant
 * saisi est converti en unités mineures sans flottant (`minorFromInput`). Jamais de donnée
 * personnelle dans une URL ni un journal.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { messageKeyOf } from './host-listings.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MINOR = /^[1-9][0-9]{0,17}$/;
const SLOT = /^(EXT_[0-9]{2}|INT_[0-9]{2}|FUEL|ODOMETER|KEY|DAMAGE_[0-9]{2})$/;

export type IncidentalRole = 'HOST' | 'GUEST';
export const FEE_TYPES = ['FUEL', 'CLEANING', 'SMOKING'] as const;
export type FeeType = (typeof FEE_TYPES)[number];
export const STATUSES = [
  'AWAITING_GUEST',
  'ACCEPTED',
  'DISPUTED',
  'DECIDED_CHARGE',
  'CHARGED',
  'REJECTED',
  'CANCELLED_BY_HOST',
] as const;
export type IncidentalStatus = (typeof STATUSES)[number];
export type ChargeStatus = 'PROCESSING' | 'PAID' | 'UNPAID';
export const SLOT_GROUPS = ['EXTERIOR', 'INTERIOR', 'FUEL', 'ODOMETER', 'KEY', 'DAMAGE'] as const;
export type SlotGroup = (typeof SLOT_GROUPS)[number];

/** Motif saisi par l'hôte (10 à 500 caractères) et par le voyageur (20 à 1 000), comme la base. */
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 500;
export const DISPUTE_MIN = 20;
export const DISPUTE_MAX = 1000;
export const EVIDENCE_MAX = 10;

export interface IncidentalInvoice {
  readonly id: string;
  readonly feeType: FeeType;
  readonly amountMinor: string;
  readonly status: IncidentalStatus;
  readonly notifiedAt: string;
  readonly responseDueAt: string;
  readonly windowOpen: boolean;
  readonly description: string;
  readonly evidenceCount: number;
  /** Photos du trip retenues comme pièces (le voyageur les voit avant de payer). */
  readonly evidence: readonly IncidentalEvidence[];
  readonly disputeReason: string | null;
  readonly decision: 'CHARGE' | 'REJECTED' | null;
  readonly decisionRationale: string | null;
  readonly chargeStatus: ChargeStatus | null;
}

export interface IncidentalEvidence {
  readonly kind: 'CHECKIN' | 'CHECKOUT';
  readonly slotCode: string;
  readonly slotGroup: SlotGroup;
  readonly takenBy: IncidentalRole;
  readonly receivedAt: string;
}

export interface IncidentalPhoto {
  readonly fileId: string;
  readonly kind: 'CHECKIN' | 'CHECKOUT';
  readonly slotCode: string;
  readonly slotGroup: SlotGroup;
  readonly takenBy: IncidentalRole;
}

export interface TripIncidentalView {
  readonly tripId: string;
  readonly viewerRole: IncidentalRole;
  readonly currency: string;
  readonly currencyExponent: number;
  /** Fuseau IANA du trip (heure serveur affichée). */
  readonly timezone: string;
  readonly endedAt: string | null;
  readonly hostDeadlineAt: string | null;
  readonly canSubmit: boolean;
  /** Plafonds du pays (unités mineures) ; hôte seulement, `null` pour le voyageur. */
  readonly caps: Readonly<Record<FeeType, string | null>> | null;
  readonly feeTypes: readonly FeeType[];
  readonly invoices: readonly IncidentalInvoice[];
  readonly photos: readonly IncidentalPhoto[];
}

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isRole = (v: unknown): v is IncidentalRole => v === 'HOST' || v === 'GUEST';
const isTime = (v: unknown): v is string => typeof v === 'string' && ISO.test(v);
const isTimeOrNull = (v: unknown): v is string | null => v === null || isTime(v);
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const has = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v);

function evidenceOf(e: unknown): IncidentalEvidence | null {
  if (
    !isObj(e) ||
    (e['kind'] !== 'CHECKIN' && e['kind'] !== 'CHECKOUT') ||
    typeof e['slotCode'] !== 'string' ||
    !SLOT.test(e['slotCode']) ||
    !has(SLOT_GROUPS, e['slotGroup']) ||
    !isRole(e['takenBy']) ||
    !isTime(e['receivedAt'])
  ) {
    return null;
  }
  return {
    kind: e['kind'],
    slotCode: e['slotCode'],
    slotGroup: e['slotGroup'],
    takenBy: e['takenBy'],
    receivedAt: e['receivedAt'],
  };
}

const CAP = /^(0|[1-9][0-9]{0,17})$/;
function capsOf(v: unknown): TripIncidentalView['caps'] | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const out: Record<string, string | null> = {};
  for (const f of FEE_TYPES) {
    const c = v[f];
    if (c === null) out[f] = null;
    else if (typeof c === 'string' && CAP.test(c)) out[f] = c;
    else return undefined;
  }
  return out as Record<FeeType, string | null>;
}

function invoiceOf(i: unknown): IncidentalInvoice | null {
  if (!isObj(i)) return null;
  const rawEvidence = i['evidence'];
  if (!Array.isArray(rawEvidence)) return null;
  const evidence = rawEvidence.map(evidenceOf);
  if (evidence.some((e) => e === null)) return null;
  const { decision, chargeStatus } = i;
  if (
    typeof i['id'] !== 'string' ||
    !UUID.test(i['id']) ||
    !has(FEE_TYPES, i['feeType']) ||
    typeof i['amountMinor'] !== 'string' ||
    !MINOR.test(i['amountMinor']) ||
    !has(STATUSES, i['status']) ||
    !isTime(i['notifiedAt']) ||
    !isTime(i['responseDueAt']) ||
    typeof i['windowOpen'] !== 'boolean' ||
    typeof i['description'] !== 'string' ||
    typeof i['evidenceCount'] !== 'number' ||
    !Number.isInteger(i['evidenceCount']) ||
    !isTextOrNull(i['disputeReason']) ||
    !(decision === null || decision === 'CHARGE' || decision === 'REJECTED') ||
    !isTextOrNull(i['decisionRationale']) ||
    !(chargeStatus === null || has(['PROCESSING', 'PAID', 'UNPAID'] as const, chargeStatus))
  ) {
    return null;
  }
  return {
    id: i['id'],
    feeType: i['feeType'],
    amountMinor: i['amountMinor'],
    status: i['status'],
    notifiedAt: i['notifiedAt'],
    responseDueAt: i['responseDueAt'],
    windowOpen: i['windowOpen'],
    description: i['description'],
    evidenceCount: i['evidenceCount'],
    evidence: evidence as IncidentalEvidence[],
    disputeReason: i['disputeReason'],
    decision,
    decisionRationale: i['decisionRationale'],
    chargeStatus,
  };
}

function photoOf(p: unknown): IncidentalPhoto | null {
  if (!isObj(p)) return null;
  if (
    typeof p['fileId'] !== 'string' ||
    !UUID.test(p['fileId']) ||
    (p['kind'] !== 'CHECKIN' && p['kind'] !== 'CHECKOUT') ||
    typeof p['slotCode'] !== 'string' ||
    !SLOT.test(p['slotCode']) ||
    !has(SLOT_GROUPS, p['slotGroup']) ||
    !isRole(p['takenBy'])
  ) {
    return null;
  }
  return {
    fileId: p['fileId'],
    kind: p['kind'],
    slotCode: p['slotCode'],
    slotGroup: p['slotGroup'],
    takenBy: p['takenBy'],
  };
}

/** Vue de l'API, lue strictement ; `null` si la forme surprend (jamais un état deviné). */
export function tripIncidentalOf(reply: ApiResult): TripIncidentalView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const exponent = j['currencyExponent'];
  const feeTypes = j['feeTypes'];
  const rawInvoices = j['invoices'];
  const rawPhotos = j['photos'];
  if (
    typeof j['tripId'] !== 'string' ||
    !UUID.test(j['tripId']) ||
    !isRole(j['viewerRole']) ||
    typeof j['currency'] !== 'string' ||
    !/^[A-Z]{3}$/.test(j['currency']) ||
    typeof exponent !== 'number' ||
    !Number.isInteger(exponent) ||
    exponent < 0 ||
    exponent > 4 ||
    typeof j['timezone'] !== 'string' ||
    j['timezone'] === '' ||
    !isTimeOrNull(j['endedAt']) ||
    !isTimeOrNull(j['hostDeadlineAt']) ||
    typeof j['canSubmit'] !== 'boolean' ||
    !Array.isArray(feeTypes) ||
    !feeTypes.every((f) => has(FEE_TYPES, f)) ||
    !Array.isArray(rawInvoices) ||
    !Array.isArray(rawPhotos)
  ) {
    return null;
  }
  const caps = capsOf(j['caps']);
  if (caps === undefined) return null;
  const invoices = rawInvoices.map(invoiceOf);
  const photos = rawPhotos.map(photoOf);
  if (invoices.some((i) => i === null) || photos.some((p) => p === null)) return null;
  return {
    tripId: j['tripId'],
    viewerRole: j['viewerRole'],
    currency: j['currency'],
    currencyExponent: exponent,
    timezone: j['timezone'],
    endedAt: j['endedAt'],
    hostDeadlineAt: j['hostDeadlineAt'],
    canSubmit: j['canSubmit'],
    caps,
    feeTypes: feeTypes as FeeType[],
    invoices: invoices as IncidentalInvoice[],
    photos: photos as IncidentalPhoto[],
  };
}

export const FEE_KEYS: Readonly<Record<FeeType, MessageKey>> = {
  FUEL: 'web.incidental.fee.FUEL',
  CLEANING: 'web.incidental.fee.CLEANING',
  SMOKING: 'web.incidental.fee.SMOKING',
};

export const STATUS_KEYS: Readonly<Record<IncidentalStatus, MessageKey>> = {
  AWAITING_GUEST: 'web.incidental.status.AWAITING_GUEST',
  ACCEPTED: 'web.incidental.status.ACCEPTED',
  DISPUTED: 'web.incidental.status.DISPUTED',
  DECIDED_CHARGE: 'web.incidental.status.DECIDED_CHARGE',
  CHARGED: 'web.incidental.status.CHARGED',
  REJECTED: 'web.incidental.status.REJECTED',
  CANCELLED_BY_HOST: 'web.incidental.status.CANCELLED_BY_HOST',
};

export const STATUS_TONE: Readonly<
  Record<IncidentalStatus, 'info' | 'success' | 'warning' | 'danger'>
> = {
  AWAITING_GUEST: 'info',
  ACCEPTED: 'info',
  DISPUTED: 'warning',
  DECIDED_CHARGE: 'info',
  CHARGED: 'success',
  REJECTED: 'danger',
  CANCELLED_BY_HOST: 'info',
};

export const CHARGE_KEYS: Readonly<Record<ChargeStatus, MessageKey>> = {
  PROCESSING: 'web.incidental.charge.PROCESSING',
  PAID: 'web.incidental.charge.PAID',
  UNPAID: 'web.incidental.charge.UNPAID',
};

export const SLOT_KEYS: Readonly<Record<SlotGroup, MessageKey>> = {
  EXTERIOR: 'web.incidental.slot.EXTERIOR',
  INTERIOR: 'web.incidental.slot.INTERIOR',
  FUEL: 'web.incidental.slot.FUEL',
  ODOMETER: 'web.incidental.slot.ODOMETER',
  KEY: 'web.incidental.slot.KEY',
  DAMAGE: 'web.incidental.slot.DAMAGE',
};

/** Résultat affiché après une action (paramètre `done` reconstruit, jamais un texte reçu). */
export const DONE = ['submitted', 'accepted', 'disputed', 'cancelled'] as const;
export type Done = (typeof DONE)[number];
export const DONE_KEYS: Readonly<Record<Done, MessageKey>> = {
  submitted: 'web.incidental.done.submitted',
  accepted: 'web.incidental.done.accepted',
  disputed: 'web.incidental.done.disputed',
  cancelled: 'web.incidental.done.cancelled',
};
export const doneOf = (v: unknown): Done | null =>
  typeof v === 'string' && (DONE as readonly string[]).includes(v) ? (v as Done) : null;

/** Page des frais annexes, reconstruite (jamais une adresse reçue d'un formulaire). */
export function incidentalHref(
  role: IncidentalRole,
  tripId: string,
  org: string | null,
  done?: Done,
): string {
  const q = new URLSearchParams();
  if (role === 'HOST' && org !== null && UUID.test(org)) q.set('org', org);
  if (done !== undefined) q.set('done', done);
  const query = q.toString();
  const base =
    role === 'HOST' ? `/host/trips/${tripId}/incidental-fees` : `/trips/${tripId}/incidental-fees`;
  return query === '' ? base : `${base}?${query}`;
}

/** Photos du trip (séries de départ et de retour), reconstruites. */
export function tripPhotosHref(role: IncidentalRole, tripId: string, org: string | null): string {
  return role === 'HOST'
    ? `/host/trips/${tripId}/inspection/checkout${org !== null && UUID.test(org) ? `?org=${org}` : ''}`
    : `/trips/${tripId}/inspection/checkout`;
}

/**
 * Texte de l'état d'un frais pour la personne qui lit (MINEUR des revues : le voyageur lit « répondez
 * avant… », l'hôte « réponse du voyageur attendue… ») ; échéance passée : ce qui va se passer
 * (débit, ou décision de la plateforme si le frais est contesté ; revue ux n° 2).
 */
export function statusKeyOf(
  inv: IncidentalInvoice,
  role: IncidentalRole,
  nowMs: number,
): MessageKey {
  const passed = nowMs >= Date.parse(inv.responseDueAt);
  if (inv.status === 'AWAITING_GUEST') {
    if (!inv.windowOpen || passed) return 'web.incidental.expired.AWAITING_GUEST';
    return role === 'GUEST'
      ? 'web.incidental.statusGuest.AWAITING_GUEST'
      : 'web.incidental.status.AWAITING_GUEST';
  }
  if (inv.status === 'DISPUTED' && passed) return 'web.incidental.expired.DISPUTED';
  return STATUS_KEYS[inv.status];
}

/** Les états d'un trip où la page des frais annexes est proposée (après le retour). */
export function incidentalOffered(status: string): boolean {
  return status === 'RETURNED' || status === 'POST_TRIP' || status === 'COMPLETED';
}

/** Clé du refus d'une réponse de l'API ; sans réseau : indisponible. */
export function incidentalFailureKey(reply: ApiResult): MessageKey {
  if (reply.status === 'unavailable') return 'common.incidental.unavailable';
  return messageKeyOf(reply) ?? 'common.error.server';
}
