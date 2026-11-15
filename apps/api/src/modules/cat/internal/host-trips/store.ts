/**
 * Port et adaptateur PostgreSQL des trips de l'hôte (US-219, migration 0100, ADR-127). L'adaptateur
 * n'appelle QUE `core.booking_host_trips` (SECURITY DEFINER, propriétaire host_view_owner, EXECUTE
 * au seul app_api) : l'hôte est désigné par l'empreinte de son jeton (`proof`), jamais par un
 * identifiant reçu ; la base juge le compte (titulaire de la session), filtre et minimise. Requête
 * paramétrée ; une erreur de la base devient `HostListingStoreError` (SQLSTATE seulement).
 */
import { HostListingStoreError } from '../host-listings/store.js';
import type { SqlExecutor } from '../host-listings/store.js';

/** Onglets de 16 HDB-002 : à venir, en cours, terminés, annulés. */
export const TRIP_TABS = ['UPCOMING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TripTab = (typeof TRIP_TABS)[number];

export interface TripQuery {
  readonly tab: TripTab | null;
  readonly vehicleId: string | null;
  /** Dates locales du trip (`AAAA-MM-JJ`), bornes incluses. */
  readonly from: string | null;
  readonly to: string | null;
  readonly tripId: string | null;
  readonly limit: number;
}

/** Ce que l'hôte voit du voyageur (17 `host_guest_v`) : rien d'autre. */
export interface TripGuest {
  readonly firstName: string | null;
  readonly ageYears: number | null;
  readonly rating: string | null;
  readonly verified: boolean;
}

export interface HostTripRow {
  readonly tripId: string;
  readonly reference: string | null;
  readonly tab: TripTab;
  readonly status: string;
  readonly vehicleId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly bookedAt: string;
  readonly paymentStatus: string;
  readonly currency: string;
  /** Jambe HOST de la conversion (unités mineures, chaîne) ; `null` : annulé ou inconnu. */
  readonly hostEarningsMinor: string | null;
  readonly guest: TripGuest;
}

/** `outcome` ≠ `DONE` : refus (compte d'un autre hôte, saisie invalide) et aucune ligne. */
export interface HostTripsResult {
  readonly outcome: string;
  readonly rows: readonly HostTripRow[];
}

export interface HostTripStore {
  trips(proof: Buffer, orgId: string, query: TripQuery): Promise<HostTripsResult>;
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableHostTripStore implements HostTripStore {
  trips(): Promise<HostTripsResult> {
    return Promise.reject(new HostListingStoreError('trips indisponibles', undefined));
  }
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code as string)
    : undefined;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const textOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
const isTab = (v: unknown): v is TripTab => (TRIP_TABS as readonly unknown[]).includes(v);

export class PgHostTripStore implements HostTripStore {
  constructor(private readonly db: SqlExecutor) {}

  async trips(proof: Buffer, orgId: string, q: TripQuery): Promise<HostTripsResult> {
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.db.query<Record<string, unknown>>(
          `SELECT * FROM core.booking_host_trips($1, $2::uuid, $3, $4::uuid, $5::date, $6::date,
                                                 $7::uuid, $8)`,
          [proof, orgId, q.tab, q.vehicleId, q.from, q.to, q.tripId, q.limit],
        )
      ).rows;
    } catch (error) {
      throw new HostListingStoreError('trips de l’hôte', sqlstateOf(error));
    }
    const refused = rows.find((r) => r['outcome'] !== 'DONE');
    if (refused !== undefined) {
      return { outcome: String(refused['outcome']), rows: [] };
    }
    const out: HostTripRow[] = [];
    for (const r of rows) {
      // ligne mal formée : refus de toute la réponse (jamais une donnée partielle)
      if (typeof r['trip_id'] !== 'string' || !isTab(r['tab'])) {
        throw new HostListingStoreError('trips de l’hôte : ligne illisible', undefined);
      }
      out.push({
        tripId: r['trip_id'],
        reference: textOrNull(r['public_ref']),
        tab: r['tab'],
        status: String(r['status']),
        vehicleId: String(r['vehicle_id']),
        startsAt: iso(r['scheduled_start']),
        endsAt: iso(r['scheduled_end']),
        timezone: String(r['timezone']),
        bookedAt: iso(r['booked_at']),
        paymentStatus: String(r['payment_status']),
        currency: String(r['currency']),
        hostEarningsMinor: textOrNull(r['host_leg_minor']),
        guest: {
          firstName: textOrNull(r['guest_first_name']),
          ageYears:
            r['guest_age_years'] === null || r['guest_age_years'] === undefined
              ? null
              : Number(r['guest_age_years']),
          rating: textOrNull(r['guest_rating']),
          verified: r['guest_verified'] === true,
        },
      });
    }
    return { outcome: 'DONE', rows: out };
  }
}
