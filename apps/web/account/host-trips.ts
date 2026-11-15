/**
 * Lecture défensive des trips de l'hôte (US-219, ADR-127 ; 16 HDB-001 / HDB-002), côté SERVEUR du
 * site seulement. Une réponse mal formée est refusée en bloc (`null`) : l'écran affiche son état
 * d'erreur, jamais une donnée partielle. Aucun montant n'est calculé ici : les gains estimés (jambe
 * HOST) sont relus tels quels, en unités mineures, avec l'exposant de la devise servi par l'API
 * (PYG sans décimale). Aucune constante de pays.
 */
import type { ApiResult } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^[0-9]+$/;
const CURRENCY = /^[A-Z]{3}$/;
export const TRIP_TABS = ['UPCOMING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TripTab = (typeof TRIP_TABS)[number];
export const PAYMENT_STATUSES = ['CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' ? v : undefined;
const intOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isInteger(v) ? v : undefined;
const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));

export interface HostTripView {
  readonly tripId: string;
  readonly reference: string | null;
  readonly tab: TripTab;
  readonly status: string;
  readonly vehicle: {
    readonly id: string;
    readonly makeText: string | null;
    readonly modelText: string | null;
    readonly year: number | null;
    readonly plate: string | null;
  };
  readonly handoverPlace: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly paymentStatus: PaymentStatus;
  readonly currency: string;
  /** Jambe HOST en unités mineures (bigint, jamais un `number`) ; `null` : annulé ou inconnu. */
  readonly hostEarningsMinor: bigint | null;
  readonly guest: {
    readonly firstName: string | null;
    readonly ageYears: number | null;
    readonly rating: string | null;
    readonly verified: boolean;
  };
}

export interface TripMarket {
  readonly currency: string;
  readonly currencyExponent: number;
}

function marketOf(v: unknown): TripMarket | null {
  if (!isObj(v)) return null;
  const exp = v['currencyExponent'];
  if (typeof v['currency'] !== 'string' || !CURRENCY.test(v['currency'])) return null;
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp < 0) return null;
  return { currency: v['currency'], currencyExponent: exp };
}

function tripOf(t: unknown): HostTripView | null {
  if (!isObj(t) || !isObj(t['vehicle']) || !isObj(t['guest'])) return null;
  const v = t['vehicle'];
  const g = t['guest'];
  const reference = strOrNull(t['reference']);
  const place = strOrNull(t['handoverPlace']);
  const make = strOrNull(v['makeText']);
  const model = strOrNull(v['modelText']);
  const year = intOrNull(v['year']);
  const plate = strOrNull(v['plate']);
  const earnings = strOrNull(t['hostEarningsMinor']);
  const firstName = strOrNull(g['firstName']);
  const age = intOrNull(g['ageYears']);
  const rating = strOrNull(g['rating']);
  if (
    !UUID.test(String(t['tripId'])) ||
    !(TRIP_TABS as readonly unknown[]).includes(t['tab']) ||
    typeof t['status'] !== 'string' ||
    !UUID.test(String(v['id'])) ||
    !isInstant(t['startsAt']) ||
    !isInstant(t['endsAt']) ||
    typeof t['timezone'] !== 'string' ||
    !(PAYMENT_STATUSES as readonly unknown[]).includes(t['paymentStatus']) ||
    typeof t['currency'] !== 'string' ||
    !CURRENCY.test(t['currency']) ||
    typeof g['verified'] !== 'boolean' ||
    [reference, place, make, model, year, plate, earnings, firstName, age, rating].includes(
      undefined,
    ) ||
    (earnings !== null && earnings !== undefined && !MINOR.test(earnings))
  ) {
    return null;
  }
  return {
    tripId: String(t['tripId']),
    reference: reference ?? null,
    tab: t['tab'] as TripTab,
    status: t['status'],
    vehicle: {
      id: String(v['id']),
      makeText: make ?? null,
      modelText: model ?? null,
      year: year ?? null,
      plate: plate ?? null,
    },
    handoverPlace: place ?? null,
    startsAt: t['startsAt'],
    endsAt: t['endsAt'],
    timezone: t['timezone'],
    paymentStatus: t['paymentStatus'] as PaymentStatus,
    currency: t['currency'],
    hostEarningsMinor: earnings === null || earnings === undefined ? null : BigInt(earnings),
    guest: {
      firstName: firstName ?? null,
      ageYears: age ?? null,
      rating: rating ?? null,
      verified: g['verified'],
    },
  };
}

/** `GET …/trips` ; `null` si la réponse est illisible ou refusée. */
export function hostTripsOf(
  reply: ApiResult,
): { readonly market: TripMarket; readonly trips: readonly HostTripView[] } | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['trips'])) {
    return null;
  }
  const market = marketOf(reply.json['market']);
  if (market === null) return null;
  const trips: HostTripView[] = [];
  for (const t of reply.json['trips'] as unknown[]) {
    const trip = tripOf(t);
    if (trip === null) return null;
    trips.push(trip);
  }
  return { market, trips };
}

/** `GET …/trips/{tripId}` ; `null` si la réponse est illisible ou refusée. */
export function hostTripOf(
  reply: ApiResult,
): { readonly market: TripMarket; readonly trip: HostTripView } | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const market = marketOf(reply.json['market']);
  const trip = tripOf(reply.json['trip']);
  return market === null || trip === null ? null : { market, trip };
}

/** Libellé de l'auto : marque, modèle, année, plaque (comme A10). */
export function tripCarLabel(t: HostTripView): string {
  const name = [t.vehicle.makeText, t.vehicle.modelText].filter(Boolean).join(' ');
  return [name, t.vehicle.year, t.vehicle.plate].filter((x) => x !== null && x !== '').join(' · ');
}

/** Référence affichée : numéro public, sinon les 8 premiers caractères de l'identifiant. */
export const tripReference = (t: HostTripView): string =>
  t.reference ?? t.tripId.slice(0, 8).toUpperCase();

/** Requête de filtre d'A05 (`tab`, `vehicleId`, `from`, `to`), sans valeur étrangère. */
export function tripFilterQuery(query: Readonly<Record<string, string | string[] | undefined>>): {
  readonly tab: TripTab;
  readonly params: URLSearchParams;
} {
  const one = (k: string): string | undefined => {
    const v = query[k];
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  const wanted = one('tab');
  const tab = (TRIP_TABS as readonly string[]).includes(wanted ?? '')
    ? (wanted as TripTab)
    : 'UPCOMING';
  const params = new URLSearchParams({ tab });
  const vehicleId = one('vehicleId');
  if (vehicleId !== undefined && UUID.test(vehicleId)) params.set('vehicleId', vehicleId);
  for (const k of ['from', 'to']) {
    const v = one(k);
    if (v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v)) params.set(k, v);
  }
  return { tab, params };
}
