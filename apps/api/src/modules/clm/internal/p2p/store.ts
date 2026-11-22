/**
 * Port et adaptateur PostgreSQL des sinistres entre particuliers d'un trip (US-318, migration 0178,
 * ADR-198). L'adaptateur n'appelle QUE `core.claim_cmd_report_incident`,
 * `core.claim_cmd_declare_traffic_charge` et `core.claim_host_trip_claims` (SECURITY DEFINER,
 * propriétaire cmd_hold_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables.
 * La personne est désignée par l'empreinte de son jeton de session (`proof`), jamais par un
 * identifiant reçu. Requêtes paramétrées ; une erreur de la base devient `TripClaimStoreError`
 * (SQLSTATE seulement). Aucune heure de réception n'est envoyée : la base prend `platform.now()`.
 * Les montants sont des textes d'entiers (unités mineures), jamais des nombres JSON.
 */
import type { EvidenceSqlExecutor } from '../evidence/ports.js';

export type TrafficChargeKind = 'TOLL' | 'FINE' | 'IMPOUND';
export const TRAFFIC_CHARGE_KINDS: readonly TrafficChargeKind[] = ['TOLL', 'FINE', 'IMPOUND'];

export interface IncidentInput {
  readonly requestId: string;
  readonly caseId: string;
  readonly thirdParty: boolean;
  readonly policeReport: boolean;
}

export interface IncidentResult {
  readonly outcome: string;
  readonly incidentId: string | null;
  readonly reportedAt: Date | null;
  readonly photoCount: number | null;
}

export interface TrafficChargeInput {
  readonly requestId: string;
  readonly kind: TrafficChargeKind;
  readonly occurredAt: Date;
  readonly amountMinor: bigint;
  readonly fileId: string;
}

export interface TrafficChargeResult {
  readonly outcome: string;
  readonly chargeId: string | null;
  readonly body: Readonly<Record<string, unknown>> | null;
}

export interface TripClaimsStore {
  reportIncident(proof: Buffer, tripId: string, input: IncidentInput): Promise<IncidentResult>;
  declareTrafficCharge(
    proof: Buffer,
    tripId: string,
    input: TrafficChargeInput,
  ): Promise<TrafficChargeResult>;
  /** `null` : personne autre que le titulaire (NOT_FOUND). */
  hostClaims(proof: Buffer, tripId: string): Promise<Readonly<Record<string, unknown>> | null>;
}

export class TripClaimStoreError extends Error {
  override readonly name = 'TripClaimStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`CLM : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableTripClaimsStore implements TripClaimsStore {
  #fail(): Promise<never> {
    return Promise.reject(new TripClaimStoreError('sinistres : magasin indisponible', undefined));
  }
  reportIncident = (): Promise<IncidentResult> => this.#fail();
  declareTrafficCharge = (): Promise<TrafficChargeResult> => this.#fail();
  hostClaims = (): Promise<Readonly<Record<string, unknown>> | null> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d !== null && Number.isFinite(d.getTime()) ? d : null;
};
const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export class PgTripClaimsStore implements TripClaimsStore {
  constructor(private readonly db: EvidenceSqlExecutor) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new TripClaimStoreError(operation, sqlstateOf(error));
    }
  }

  async reportIncident(proof: Buffer, tripId: string, input: IncidentInput) {
    const r = await this.#one<{
      outcome: string;
      incident_id: string | null;
      reported_at: unknown;
      photo_count: number | null;
    }>(
      "déclaration d'incident",
      `SELECT outcome, incident_id::text AS incident_id, reported_at, photo_count
         FROM core.claim_cmd_report_incident($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)`,
      [proof, input.requestId, tripId, input.caseId, input.thirdParty, input.policeReport],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      incidentId: r?.incident_id ?? null,
      reportedAt: dateOf(r?.reported_at),
      photoCount: typeof r?.photo_count === 'number' ? r.photo_count : null,
    };
  }

  async declareTrafficCharge(proof: Buffer, tripId: string, input: TrafficChargeInput) {
    const r = await this.#one<{ outcome: string; charge_id: string | null; body: unknown }>(
      'déclaration de refacturation',
      `SELECT outcome, charge_id::text AS charge_id, body
         FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz,
                                                    $6::bigint, $7::uuid)`,
      [
        proof,
        input.requestId,
        tripId,
        input.kind,
        input.occurredAt.toISOString(),
        input.amountMinor.toString(),
        input.fileId,
      ],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      chargeId: r?.charge_id ?? null,
      body: isObj(r?.body) ? r.body : null,
    };
  }

  async hostClaims(proof: Buffer, tripId: string) {
    const r = await this.#one<{ v: unknown }>(
      'lecture des sinistres du trip',
      'SELECT core.claim_host_trip_claims($1, $2::uuid) AS v',
      [proof, tripId],
    );
    if (r === undefined) throw new TripClaimStoreError('lecture des sinistres du trip', undefined);
    if (r.v === null) return null;
    if (!isObj(r.v))
      throw new TripClaimStoreError('lecture des sinistres : vue illisible', undefined);
    return r.v;
  }
}
