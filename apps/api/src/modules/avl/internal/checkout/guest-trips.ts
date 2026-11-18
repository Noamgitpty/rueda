/**
 * « Mis viajes » et détail du trip du voyageur (US-214, ADR-160 ; 19 US-214 ; 16 BKG-027 ; 10b S08,
 * S09). La base juge le voyageur (celui de la SESSION, `core.booking_guest_trips`, 0133, SECURITY
 * DEFINER, EXECUTE app_api), filtre et minimise : hôte en prénom et initiale (L2-PM-35), adresse
 * exacte d'un trip à venir ou en cours seulement, aucune plaque. Un trip d'une autre personne (y
 * compris celui que la session héberge), un trip inconnu ou un identifiant mal formé rendent la
 * même réponse 404 `TRIP_NOT_FOUND` (RLS-1, 17 §2.3 point 5 : aucun oracle).
 *
 * Montants en unités mineures, en TEXTE (bigint exact) : total du devis figé lu de la base, jamais
 * recalculé ; exposant de la devise joint dans la même instruction (affichage seulement ; PYG sans
 * décimale). Toute forme inattendue de la base ⇒ 503 `TRIPS_UNAVAILABLE` (fail-closed : jamais une
 * liste partielle ni devinée). Lecture seule : toute modification passe par le support en bêta
 * (08 BR-MOD-01).
 */
import { HttpException } from '@nestjs/common';
import { isUuid } from './model.js';
import type { SqlExecutor } from './store.js';

export const GUEST_TRIP_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  TRIP_NOT_FOUND: { status: 404, messageKey: 'common.trips.notFound' },
  TRIPS_UNAVAILABLE: { status: 503, messageKey: 'common.trips.unavailable' },
} as const;

export type GuestTripHttpCode = keyof typeof GUEST_TRIP_MESSAGES;

export class GuestTripHttpError extends HttpException {
  readonly code: GuestTripHttpCode;

  constructor(code: GuestTripHttpCode) {
    super(
      { code, messageKey: GUEST_TRIP_MESSAGES[code].messageKey },
      GUEST_TRIP_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Onglets : demandes en attente, puis la partition des statuts de 0101 (SM-1). */
export const GUEST_TRIP_TABS = [
  'REQUESTED',
  'UPCOMING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;
export type GuestTripTab = (typeof GUEST_TRIP_TABS)[number];

/** États SM-1 d'un trip (17 `booking_trip.status`) ; la base n'en rend pas d'autre. */
export const TRIP_STATUSES = [
  'BOOKED',
  'CHECKIN_OPEN',
  'START_WINDOW_EXPIRED',
  'IN_PROGRESS',
  'OVERDUE',
  'RETURNED',
  'UNRETURNED',
  'TERMINATED_EARLY',
  'VEHICLE_LOST',
  'POST_TRIP',
  'COMPLETED',
  'IN_DISPUTE',
  'CANCELLED_BY_GUEST',
  'CANCELLED_BY_HOST',
  'CANCELLED_BY_PLATFORM',
  'REFUSED_AT_PICKUP',
  'NO_SHOW_GUEST',
  'NO_SHOW_HOST',
] as const;
/** États d'une demande en attente de l'hôte (0126). */
export const REQUEST_STATUSES = ['AWAITING_HOST', 'PAYMENT_IN_FLIGHT'] as const;
export const PAYMENT_STATUSES = ['CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED'] as const;
export const CONTRACT_STATES = ['NONE', 'TO_SIGN', 'SIGNED'] as const;

/** Onglet attendu de chaque état (même partition que la base : une divergence ⇒ 503). */
const TAB_OF: Readonly<Record<string, GuestTripTab>> = {
  BOOKED: 'UPCOMING',
  CHECKIN_OPEN: 'UPCOMING',
  START_WINDOW_EXPIRED: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  OVERDUE: 'IN_PROGRESS',
  UNRETURNED: 'IN_PROGRESS',
  RETURNED: 'DONE',
  TERMINATED_EARLY: 'DONE',
  VEHICLE_LOST: 'DONE',
  POST_TRIP: 'DONE',
  COMPLETED: 'DONE',
  IN_DISPUTE: 'DONE',
  CANCELLED_BY_GUEST: 'CANCELLED',
  CANCELLED_BY_HOST: 'CANCELLED',
  CANCELLED_BY_PLATFORM: 'CANCELLED',
  REFUSED_AT_PICKUP: 'CANCELLED',
  NO_SHOW_GUEST: 'CANCELLED',
  NO_SHOW_HOST: 'CANCELLED',
};

export interface GuestTrip {
  readonly kind: 'TRIP' | 'REQUEST';
  readonly id: string;
  readonly reference: string | null;
  readonly tab: GuestTripTab;
  readonly status: string;
  readonly paymentStatus: (typeof PAYMENT_STATUSES)[number] | null;
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
  readonly hostName: string | null;
  readonly handover: {
    readonly place: string | null;
    readonly address: string | null;
    readonly city: string | null;
  };
  /** Total du devis figé, unités mineures (texte) ; jamais recalculé. */
  readonly totalMinor: string;
  readonly contract: (typeof CONTRACT_STATES)[number] | null;
}

/** Ligne telle que la base la rend (0133) et exposant de la devise (`config_currency`). */
export interface GuestTripRow {
  readonly outcome: string;
  readonly kind: unknown;
  readonly itemId: unknown;
  readonly publicRef: unknown;
  readonly tab: unknown;
  readonly status: unknown;
  readonly paymentStatus: unknown;
  readonly currency: unknown;
  readonly exponent: unknown;
  readonly timezone: unknown;
  readonly startsAt: unknown;
  readonly endsAt: unknown;
  readonly respondBy: unknown;
  readonly vehicleMake: unknown;
  readonly vehicleModel: unknown;
  readonly vehicleYear: unknown;
  readonly hostName: unknown;
  readonly placeLabel: unknown;
  readonly placeAddress: unknown;
  readonly placeCity: unknown;
  readonly totalMinor: unknown;
  readonly contractState: unknown;
}

export interface GuestTripStore {
  /** `tripId` null : la liste ; sinon le seul trip demandé (zéro ligne s'il n'est pas le sien). */
  read(proof: Buffer, tripId: string | null, limit: number): Promise<readonly GuestTripRow[]>;
}

export class GuestTripStoreError extends Error {
  override readonly name = 'GuestTripStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`trips du voyageur : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableGuestTripStore implements GuestTripStore {
  read(): Promise<readonly GuestTripRow[]> {
    return Promise.reject(new GuestTripStoreError(undefined));
  }
}

/** Lecture (0133) et exposant de chaque devise, dans la MÊME instruction, ordre de la base gardé. */
export const GUEST_TRIPS_SQL = `SELECT g.*, c.exponent
  FROM core.booking_guest_trips($1, NULL, $2::uuid, $3) WITH ORDINALITY AS g
  LEFT JOIN core.config_currency AS c ON c.code::text = g.currency
 ORDER BY g.ordinality`;

/** Plafond de la liste (borne de la base : 200). */
export const GUEST_TRIPS_PAGE = 200;

export class PgGuestTripStore implements GuestTripStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(proof: Buffer, tripId: string | null, limit: number): Promise<GuestTripRow[]> {
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.db.query<Record<string, unknown>>(GUEST_TRIPS_SQL, [
        proof,
        tripId,
        limit,
      ]));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new GuestTripStoreError(typeof code === 'string' ? code : undefined);
    }
    return rows.map((r) => ({
      outcome: typeof r['outcome'] === 'string' ? r['outcome'] : '',
      kind: r['kind'],
      itemId: r['item_id'],
      publicRef: r['public_ref'],
      tab: r['tab'],
      status: r['status'],
      paymentStatus: r['payment_status'],
      currency: r['currency'],
      exponent: r['exponent'],
      timezone: r['timezone'],
      startsAt: r['starts_at'],
      endsAt: r['ends_at'],
      respondBy: r['respond_by'],
      vehicleMake: r['vehicle_make'],
      vehicleModel: r['vehicle_model'],
      vehicleYear: r['vehicle_year'],
      hostName: r['host_name'],
      placeLabel: r['place_label'],
      placeAddress: r['place_address'],
      placeCity: r['place_city'],
      // bigint du pilote pg : texte exact ; un nombre JS est refusé plus bas
      totalMinor: r['total_minor'],
      contractState: r['contract_state'],
    }));
  }
}

const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const CURRENCY = /^[A-Z]{3}$/;
const TIMEZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
/** Texte ou NULL ; `undefined` : forme inattendue. */
const textOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && v.length <= 500 ? v : undefined;
/** Instant (Date du pilote ou texte ISO) en ISO 8601 UTC ; `undefined` : illisible. */
function instantOf(v: unknown): string | undefined {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d === null || Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Une ligne contrôlée champ par champ ; une seule anomalie ⇒ `null` (toute la réponse refusée). */
export function guestTripOf(r: GuestTripRow): GuestTrip | null {
  const kind = r.kind === 'TRIP' || r.kind === 'REQUEST' ? r.kind : null;
  const tab = oneOf(r.tab, GUEST_TRIP_TABS);
  const id = typeof r.itemId === 'string' && UUID.test(r.itemId) ? r.itemId : null;
  const reference = textOrNull(r.publicRef);
  const startsAt = instantOf(r.startsAt);
  const endsAt = instantOf(r.endsAt);
  const respondBy = r.respondBy === null ? null : instantOf(r.respondBy);
  const make = textOrNull(r.vehicleMake);
  const model = textOrNull(r.vehicleModel);
  const hostName = textOrNull(r.hostName);
  const place = textOrNull(r.placeLabel);
  const address = textOrNull(r.placeAddress);
  const city = textOrNull(r.placeCity);
  const year =
    r.vehicleYear === null
      ? null
      : typeof r.vehicleYear === 'number' && Number.isInteger(r.vehicleYear)
        ? r.vehicleYear
        : undefined;
  const exponent = r.exponent;
  if (
    r.outcome !== 'DONE' ||
    kind === null ||
    tab === null ||
    id === null ||
    typeof r.currency !== 'string' ||
    !CURRENCY.test(r.currency) ||
    typeof exponent !== 'number' ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 4 ||
    typeof r.timezone !== 'string' ||
    !TIMEZONE.test(r.timezone) ||
    startsAt === undefined ||
    endsAt === undefined ||
    respondBy === undefined ||
    [reference, make, model, hostName, place, address, city, year].includes(undefined) ||
    typeof r.totalMinor !== 'string' ||
    !MINOR.test(r.totalMinor)
  ) {
    return null;
  }
  let paymentStatus: GuestTrip['paymentStatus'];
  let contract: GuestTrip['contract'];
  if (kind === 'TRIP') {
    // trip : état SM-1 connu et onglet cohérent, statut du paiement et état du contrat connus
    paymentStatus = oneOf(r.paymentStatus, PAYMENT_STATUSES);
    contract = oneOf(r.contractState, CONTRACT_STATES);
    if (
      typeof r.status !== 'string' ||
      TAB_OF[r.status] !== tab ||
      paymentStatus === null ||
      contract === null ||
      reference === null ||
      respondBy !== null
    ) {
      return null;
    }
  } else {
    // demande : en attente de l'hôte, sans référence, ni paiement, ni contrat, ni adresse
    paymentStatus = null;
    contract = null;
    if (
      oneOf(r.status, REQUEST_STATUSES) === null ||
      tab !== 'REQUESTED' ||
      r.paymentStatus !== null ||
      r.contractState !== null ||
      reference !== null ||
      respondBy === null ||
      address !== null
    ) {
      return null;
    }
  }
  return {
    kind,
    id,
    reference: reference ?? null,
    tab,
    status: r.status as string,
    paymentStatus,
    currency: r.currency,
    currencyExponent: exponent,
    timezone: r.timezone,
    startsAt,
    endsAt,
    respondBy,
    vehicle: { make: make ?? null, model: model ?? null, year: year ?? null },
    hostName: hostName ?? null,
    handover: { place: place ?? null, address: address ?? null, city: city ?? null },
    totalMinor: r.totalMinor,
    contract,
  };
}

/** Service des routes `GET /trips` et `GET /trips/{tripId}`. */
export class GuestTripsService {
  constructor(private readonly store: GuestTripStore) {}

  async #rows(proof: Buffer, tripId: string | null, limit: number) {
    let rows: readonly GuestTripRow[];
    try {
      rows = await this.store.read(proof, tripId, limit);
    } catch {
      throw new GuestTripHttpError('TRIPS_UNAVAILABLE');
    }
    // session échue ou révoquée entre la garde et la lecture : 401
    if (rows.some((r) => r.outcome === 'AUTH_REQUIRED')) {
      throw new GuestTripHttpError('AUTH_REQUIRED');
    }
    const trips: GuestTrip[] = [];
    for (const r of rows) {
      const trip = guestTripOf(r);
      if (trip === null) throw new GuestTripHttpError('TRIPS_UNAVAILABLE');
      trips.push(trip);
    }
    return trips;
  }

  async list(proof: Buffer | null): Promise<{ readonly trips: readonly GuestTrip[] }> {
    if (proof === null) throw new GuestTripHttpError('AUTH_REQUIRED');
    return { trips: await this.#rows(proof, null, GUEST_TRIPS_PAGE) };
  }

  async one(proof: Buffer | null, rawTripId: string): Promise<{ readonly trip: GuestTrip }> {
    if (proof === null) throw new GuestTripHttpError('AUTH_REQUIRED');
    const tripId = rawTripId.toLowerCase();
    // identifiant mal formé : même réponse qu'un trip d'autrui (aucun oracle)
    if (!isUuid(tripId)) throw new GuestTripHttpError('TRIP_NOT_FOUND');
    const trips = await this.#rows(proof, tripId, 1);
    const trip = trips[0];
    if (trip === undefined) throw new GuestTripHttpError('TRIP_NOT_FOUND');
    // la base ne rend que le trip demandé ; tout autre élément est une anomalie
    if (trips.length !== 1 || trip.kind !== 'TRIP' || trip.id !== tripId) {
      throw new GuestTripHttpError('TRIPS_UNAVAILABLE');
    }
    return { trip };
  }
}
