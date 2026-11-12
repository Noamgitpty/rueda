/**
 * Port et adaptateur PostgreSQL du calendrier de l'hôte (US-119, migration 0072). L'adaptateur
 * n'appelle QUE les fonctions `core.catalog_*` de 0072 (SECURITY DEFINER, propriétaire
 * catalog_cmd_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur l'occupation. Les
 * blocages passent par la commande de la table d'occupation unique (`booking_cmd_place_host_block`,
 * exclusion GiST, verrou du véhicule) ; l'hôte est désigné par l'empreinte de son jeton (`proof`),
 * jamais par un identifiant reçu. Requêtes paramétrées ; une erreur de la base devient
 * `HostListingStoreError` (SQLSTATE seulement).
 */
import { HostListingStoreError } from '../host-listings/store.js';
import type { Outcome, SqlExecutor } from '../host-listings/store.js';
import type { LocalPeriod } from './model.js';

/** Type d'une occupation (16 CAL-011). */
export type OccupancyKind = 'TRIP' | 'HOLD' | 'HOST_BLOCK' | 'BUFFER';

/** En-tête du calendrier d'un véhicule ; `outcome` ≠ `DONE` : refus (compte, véhicule). */
export interface CalendarHeader {
  readonly outcome: string;
  readonly timezone: string | null;
  readonly listed: boolean;
  readonly locationId: string | null;
  /** Préavis de l'hôte pour le lieu du véhicule ; `null` : défaut du pays. */
  readonly noticeMinutes: number | null;
  /** Préavis en vigueur (lieu, sinon pays ; plancher de la classe) ; `null` : paramètre absent. */
  readonly effectiveNoticeMinutes: number | null;
}

/** Occupation à venir : type et bornes, jamais le voyageur ni la référence d'un hold ou d'un trip. */
export interface CalendarEntry {
  readonly id: string;
  readonly kind: OccupancyKind;
  readonly startsAt: string;
  readonly endsAt: string;
  /** Bornes dans le fuseau du véhicule (`AAAA-MM-JJTHH:MM`). */
  readonly startLocal: string;
  readonly endLocal: string;
  /** Blocage manuel de l'hôte : levée possible. */
  readonly removable: boolean;
}

export interface HostCalendarStore {
  header(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarHeader>;
  entries(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarEntry[]>;
  placeBlock(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    period: LocalPeriod,
  ): Promise<Outcome>;
  removeBlock(proof: Buffer, orgId: string, vehicleId: string, blockId: string): Promise<Outcome>;
  setNotice(
    proof: Buffer,
    orgId: string,
    locationId: string,
    minutes: number | null,
  ): Promise<Outcome>;
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableHostCalendarStore implements HostCalendarStore {
  #fail(): Promise<never> {
    return Promise.reject(new HostListingStoreError('calendrier indisponible', undefined));
  }
  header = (): Promise<CalendarHeader> => this.#fail();
  entries = (): Promise<CalendarEntry[]> => this.#fail();
  placeBlock = (): Promise<Outcome> => this.#fail();
  removeBlock = (): Promise<Outcome> => this.#fail();
  setNotice = (): Promise<Outcome> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code as string)
    : undefined;

const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export class PgHostCalendarStore implements HostCalendarStore {
  constructor(private readonly db: SqlExecutor) {}

  async #rows<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R[]> {
    try {
      return (await this.db.query<R>(sql, values)).rows;
    } catch (error) {
      throw new HostListingStoreError(operation, sqlstateOf(error));
    }
  }

  async header(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarHeader> {
    const rows = await this.#rows<Record<string, unknown>>(
      'calendrier',
      'SELECT * FROM core.catalog_host_vehicle_calendar($1, $2::uuid, $3::uuid)',
      [proof, orgId, vehicleId],
    );
    const r = rows[0];
    return {
      outcome: typeof r?.['outcome'] === 'string' ? r['outcome'] : 'LISTING_UNAVAILABLE',
      timezone: typeof r?.['timezone'] === 'string' ? r['timezone'] : null,
      listed: r?.['listed'] === true,
      locationId: typeof r?.['location_id'] === 'string' ? r['location_id'] : null,
      noticeMinutes: intOrNull(r?.['notice_minutes']),
      effectiveNoticeMinutes: intOrNull(r?.['effective_notice_minutes']),
    };
  }

  async entries(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarEntry[]> {
    const rows = await this.#rows<Record<string, unknown>>(
      'occupations',
      'SELECT * FROM core.catalog_host_vehicle_occupancies($1, $2::uuid, $3::uuid)',
      [proof, orgId, vehicleId],
    );
    return rows.map((r) => ({
      id: String(r['occupancy_id']),
      kind: r['kind'] as OccupancyKind,
      startsAt: iso(r['starts_at']),
      endsAt: iso(r['ends_at']),
      startLocal: String(r['start_local']),
      endLocal: String(r['end_local']),
      removable: r['removable'] === true,
    }));
  }

  async #outcome(operation: string, sql: string, values: readonly unknown[]): Promise<Outcome> {
    const rows = await this.#rows<{ outcome: string; id: string | null }>(operation, sql, values);
    return { outcome: rows[0]?.outcome ?? 'LISTING_UNAVAILABLE', id: rows[0]?.id ?? null };
  }

  placeBlock(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    period: LocalPeriod,
  ): Promise<Outcome> {
    return this.#outcome(
      'blocage',
      `SELECT r.outcome, r.block_id::text AS id
         FROM core.catalog_cmd_place_host_block($1, $2::uuid, $3::uuid, $4::timestamp,
                                                $5::timestamp) AS r`,
      [proof, orgId, vehicleId, period.startLocal, period.endLocal],
    );
  }

  removeBlock(proof: Buffer, orgId: string, vehicleId: string, blockId: string): Promise<Outcome> {
    return this.#outcome(
      'levée',
      `SELECT r.outcome, r.block_id::text AS id
         FROM core.catalog_cmd_remove_host_block($1, $2::uuid, $3::uuid, $4::uuid) AS r`,
      [proof, orgId, vehicleId, blockId],
    );
  }

  setNotice(
    proof: Buffer,
    orgId: string,
    locationId: string,
    minutes: number | null,
  ): Promise<Outcome> {
    return this.#outcome(
      'préavis',
      `SELECT r.outcome, r.location_id::text AS id
         FROM core.catalog_cmd_set_location_notice($1, $2::uuid, $3::uuid, $4::integer) AS r`,
      [proof, orgId, locationId, minutes],
    );
  }
}
