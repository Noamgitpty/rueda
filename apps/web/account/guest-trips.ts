/**
 * Lecture défensive de « Mis viajes » et du détail du trip du voyageur (US-214, ADR-160 ; 16
 * BKG-027 ; 10b S08, S09), côté SERVEUR du site seulement. Une réponse mal formée est refusée en
 * bloc (`null`) : l'écran affiche son état d'erreur, jamais une donnée partielle. Aucun montant
 * n'est calculé ici : le total du devis figé est relu tel quel, en unités mineures (bigint), avec
 * l'exposant de la devise servi par l'API (PYG sans décimale). Aucune constante de pays.
 */
import type { ApiResult } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const CURRENCY = /^[A-Z]{3}$/;
const STATUS = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Ordre d'affichage des sections de S08 (celui de l'API). */
export const GUEST_TRIP_TABS = [
  'REQUESTED',
  'UPCOMING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;
export type GuestTripTab = (typeof GUEST_TRIP_TABS)[number];
export const GUEST_PAYMENT_STATUSES = ['CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED'] as const;
export type GuestPaymentStatus = (typeof GUEST_PAYMENT_STATUSES)[number];
export const CONTRACT_STATES = ['NONE', 'TO_SIGN', 'SIGNED'] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' ? v : undefined;
const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;

export interface GuestTripView {
  readonly kind: 'TRIP' | 'REQUEST';
  readonly id: string;
  readonly reference: string | null;
  readonly tab: GuestTripTab;
  readonly status: string;
  readonly paymentStatus: GuestPaymentStatus | null;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly respondBy: string | null;
  readonly vehicle: {
    readonly make: string | null;
    readonly model: string | null;
    readonly year: number | null;
  };
  /** Prénom et initiale de l'hôte (L2-PM-35) ; `null` : compte effacé. */
  readonly hostName: string | null;
  readonly handover: {
    readonly place: string | null;
    readonly address: string | null;
    readonly city: string | null;
  };
  /** Total du devis figé en unités mineures (bigint, jamais un `number`) ; `null` : sans devis. */
  readonly totalMinor: bigint | null;
  readonly contract: ContractState | null;
}

function tripOf(t: unknown): GuestTripView | null {
  if (!isObj(t) || !isObj(t['vehicle']) || !isObj(t['handover'])) return null;
  const v = t['vehicle'];
  const h = t['handover'];
  const kind = t['kind'] === 'TRIP' || t['kind'] === 'REQUEST' ? t['kind'] : null;
  const tab = oneOf(t['tab'], GUEST_TRIP_TABS);
  const reference = strOrNull(t['reference']);
  const make = strOrNull(v['make']);
  const model = strOrNull(v['model']);
  const year =
    v['year'] === null
      ? null
      : typeof v['year'] === 'number' && Number.isInteger(v['year'])
        ? v['year']
        : undefined;
  const hostName = strOrNull(t['hostName']);
  const place = strOrNull(h['place']);
  const address = strOrNull(h['address']);
  const city = strOrNull(h['city']);
  const exp = t['currencyExponent'];
  const paymentStatus =
    t['paymentStatus'] === null ? null : oneOf(t['paymentStatus'], GUEST_PAYMENT_STATUSES);
  const contract = t['contract'] === null ? null : oneOf(t['contract'], CONTRACT_STATES);
  const respondBy =
    t['respondBy'] === null ? null : isInstant(t['respondBy']) ? t['respondBy'] : undefined;
  if (
    kind === null ||
    tab === null ||
    !UUID.test(String(t['id'])) ||
    typeof t['status'] !== 'string' ||
    !STATUS.test(t['status']) ||
    typeof t['currency'] !== 'string' ||
    !CURRENCY.test(t['currency']) ||
    typeof exp !== 'number' ||
    !Number.isInteger(exp) ||
    exp < 0 ||
    exp > 4 ||
    typeof t['timezone'] !== 'string' ||
    !isInstant(t['startsAt']) ||
    !isInstant(t['endsAt']) ||
    respondBy === undefined ||
    [reference, make, model, year, hostName, place, address, city].includes(undefined) ||
    (t['totalMinor'] !== null &&
      (typeof t['totalMinor'] !== 'string' || !MINOR.test(t['totalMinor']))) ||
    (kind === 'REQUEST' && t['totalMinor'] === null) ||
    (t['paymentStatus'] !== null && paymentStatus === null) ||
    (t['contract'] !== null && contract === null) ||
    // un trip porte un statut de paiement et un état du contrat ; une demande, ni l'un ni l'autre
    (kind === 'TRIP' && (paymentStatus === null || contract === null || tab === 'REQUESTED')) ||
    (kind === 'REQUEST' && (paymentStatus !== null || contract !== null || tab !== 'REQUESTED'))
  ) {
    return null;
  }
  return {
    kind,
    id: String(t['id']),
    reference: reference ?? null,
    tab,
    status: t['status'],
    paymentStatus,
    currency: t['currency'],
    currencyExponent: exp,
    timezone: t['timezone'],
    startsAt: t['startsAt'] as string,
    endsAt: t['endsAt'] as string,
    respondBy,
    vehicle: { make: make ?? null, model: model ?? null, year: year ?? null },
    hostName: hostName ?? null,
    handover: { place: place ?? null, address: address ?? null, city: city ?? null },
    totalMinor: typeof t['totalMinor'] === 'string' ? BigInt(t['totalMinor']) : null,
    contract,
  };
}

/** `GET /trips` ; `null` si la réponse est illisible ou refusée. */
export function guestTripsOf(reply: ApiResult): readonly GuestTripView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['trips'])) {
    return null;
  }
  const trips: GuestTripView[] = [];
  for (const t of reply.json['trips'] as unknown[]) {
    const trip = tripOf(t);
    if (trip === null) return null;
    trips.push(trip);
  }
  return trips;
}

/** `GET /trips/{tripId}` ; `null` si la réponse est illisible, refusée ou n'est pas un trip. */
export function guestTripOf(reply: ApiResult, tripId: string): GuestTripView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const trip = tripOf(reply.json['trip']);
  return trip === null || trip.kind !== 'TRIP' || trip.id !== tripId.toLowerCase() ? null : trip;
}

/** Libellé de l'auto : marque, modèle, année (aucune plaque côté voyageur). */
export function guestCarLabel(t: GuestTripView): string {
  const name = [t.vehicle.make, t.vehicle.model].filter((x) => x !== null && x !== '').join(' ');
  return [name, t.vehicle.year].filter((x) => x !== null && x !== '').join(' · ');
}

/** Référence affichée : numéro public, sinon les 8 premiers caractères de l'identifiant. */
export const guestTripReference = (t: GuestTripView): string =>
  t.reference ?? t.id.slice(0, 8).toUpperCase();

/** Lien d'un élément : détail du trip (S09), ou page de la demande (S06 / S07 sur demande). */
export const guestTripHref = (t: GuestTripView): string =>
  t.kind === 'TRIP' ? `/trips/${t.id}` : `/checkout/hold/${t.id}/payment`;

/** Le remboursement (S10) a un sens : trip annulé ou paiement remboursé. */
export const hasRefund = (t: GuestTripView): boolean =>
  t.kind === 'TRIP' && (t.tab === 'CANCELLED' || t.paymentStatus !== 'CONFIRMED');
