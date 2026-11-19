/**
 * Port et adaptateur PostgreSQL des portes du dossier de preuve (US-308, migration 0165, ADR-184).
 * L'adaptateur n'appelle QUE les fonctions `core.support_staff_*_evidence_bundle` (SECURITY
 * DEFINER, propriétaire iam_staff_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur la
 * table. Le membre du staff est désigné par l'empreinte de son jeton de session (preuve de
 * possession), jamais par un identifiant reçu ; la base relit le TOTP, la permission
 * `evidence.export`, le dossier de support et journalise. Le contexte STAFF de la transaction
 * (`app.*`, local) ne sert qu'à la RLS de la clé du demandeur (`audit_subject_key`).
 */
import type { EvidenceSqlClient, EvidenceSqlExecutor, EvidenceSqlPool } from './ports.js';

export type EvidencePurpose = 'ACODECO' | 'CHARGEBACK' | 'INSURER' | 'DISPUTE';
export const EVIDENCE_PURPOSES: readonly EvidencePurpose[] = [
  'ACODECO',
  'CHARGEBACK',
  'INSURER',
  'DISPUTE',
];

/** Membre du staff de la session (principal du garde de la console). */
export interface EvidenceStaff {
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly countries: readonly string[];
}

export type EvidenceAccessRefusal =
  'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN' | 'CASE_REQUIRED' | 'SELF_FORBIDDEN';

export type EvidenceRequestOutcome =
  | {
      readonly outcome: 'REQUESTED' | 'ALREADY_REQUESTED';
      readonly bundleId: string;
      readonly status: string;
      readonly manifestSha256: string;
    }
  | { readonly outcome: EvidenceAccessRefusal | 'REQUEST_INVALID' };

export type EvidenceStatusOutcome =
  | { readonly outcome: 'OK'; readonly body: Record<string, unknown> }
  | { readonly outcome: 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' };

export type EvidenceOpenOutcome =
  | {
      readonly outcome: 'OK';
      readonly fileId: string;
      readonly storageKey: string;
      readonly sha256: string;
      readonly bytes: number;
      readonly manifestSha256: string;
      readonly tripId: string;
    }
  | {
      readonly outcome: EvidenceAccessRefusal | 'NOT_FOUND' | 'NOT_READY' | 'FAILED' | 'EXPIRED';
    };

export interface EvidenceRequestInput {
  readonly requestId: string;
  readonly tripId: string;
  readonly caseId: string;
  readonly purpose: EvidencePurpose;
  readonly reason: string;
}

/** Transaction de la console sous contexte STAFF ; `commit: false` l'annule (fail-closed). */
export interface EvidenceBundleStore {
  transaction<T>(
    staff: EvidenceStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T>;
  request(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    input: EvidenceRequestInput,
  ): Promise<EvidenceRequestOutcome>;
  status(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
  ): Promise<EvidenceStatusOutcome>;
  open(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
    reason: string,
  ): Promise<EvidenceOpenOutcome>;
}

export class EvidenceStoreError extends Error {
  override readonly name = 'EvidenceStoreError';
  readonly sqlstate: string | null;

  constructor(sqlstate: string | null) {
    super(`dossier de preuve : base indisponible (${sqlstate ?? 'inconnu'})`);
    this.sqlstate = sqlstate;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** Mêmes sept paramètres que `setSessionContext` de `@rueda/db` (valeurs liées, SET LOCAL). */
const STAFF_CONTEXT_SQL = `SELECT pg_catalog.set_config('app.actor_kind', 'STAFF', true),
       pg_catalog.set_config('app.actor_id', $1, true),
       pg_catalog.set_config('app.org_id', '', true),
       pg_catalog.set_config('app.vehicle_scope', '', true),
       pg_catalog.set_config('app.country_scope', $2, true),
       pg_catalog.set_config('app.worker_name', '', true),
       pg_catalog.set_config('app.session_token_hash', $3, true)`;

const REQUEST_SQL = `SELECT outcome, bundle_id::text AS bundle_id, status, manifest_sha256
  FROM core.support_staff_request_evidence_bundle($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)`;
const STATUS_SQL =
  'SELECT outcome, body FROM core.support_staff_evidence_bundle($1, $2::uuid, $3::uuid)';
const OPEN_SQL = `SELECT outcome, file_id::text AS file_id, storage_key, sha256, bytes::text AS bytes,
       manifest_sha256, trip_id::text AS trip_id
  FROM core.support_staff_open_evidence_bundle($1, $2::uuid, $3::uuid, $4)`;

const REFUSALS = ['AUTH_REQUIRED', 'MFA_REQUIRED', 'FORBIDDEN', 'CASE_REQUIRED', 'SELF_FORBIDDEN'];

function sqlstateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

export class PgEvidenceBundleStore implements EvidenceBundleStore {
  constructor(private readonly pool: EvidenceSqlPool) {}

  async transaction<T>(
    staff: EvidenceStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T> {
    let client: EvidenceSqlClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new EvidenceStoreError(sqlstateOf(error));
    }
    try {
      await client.query('BEGIN');
      const id = staff.userId.toLowerCase();
      const countries = staff.countries.filter((c) => COUNTRY.test(c));
      await client.query(STAFF_CONTEXT_SQL, [
        UUID.test(id) ? id : '',
        countries.length > 0 ? `{${countries.join(',')}}` : '',
        staff.tokenHash.length === 32 ? staff.tokenHash.toString('hex') : '',
      ]);
      const r = await fn(client);
      await client.query(r.commit ? 'COMMIT' : 'ROLLBACK');
      return r.value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof EvidenceStoreError) throw error;
      // erreur de la base : SQLSTATE seulement ; une erreur du code appelant remonte telle quelle
      if (sqlstateOf(error) !== null) throw new EvidenceStoreError(sqlstateOf(error));
      throw error;
    } finally {
      client.release();
    }
  }

  async request(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    input: EvidenceRequestInput,
  ): Promise<EvidenceRequestOutcome> {
    const { rows } = await tx.query<{
      outcome: string;
      bundle_id: string | null;
      status: string | null;
      manifest_sha256: string | null;
    }>(REQUEST_SQL, [
      staff.tokenHash,
      input.requestId,
      input.tripId,
      input.caseId,
      input.purpose,
      input.reason,
    ]);
    const r = rows[0];
    if (
      (r?.outcome === 'REQUESTED' || r?.outcome === 'ALREADY_REQUESTED') &&
      r.bundle_id !== null &&
      r.status !== null &&
      r.manifest_sha256 !== null
    ) {
      return {
        outcome: r.outcome,
        bundleId: r.bundle_id,
        status: r.status,
        manifestSha256: r.manifest_sha256,
      };
    }
    if (r?.outcome === 'REQUEST_INVALID') return { outcome: 'REQUEST_INVALID' };
    // issue inconnue : contrat rompu, traité comme un refus (fail-closed)
    return {
      outcome: REFUSALS.includes(r?.outcome ?? '')
        ? (r!.outcome as EvidenceAccessRefusal)
        : 'FORBIDDEN',
    };
  }

  async status(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
  ): Promise<EvidenceStatusOutcome> {
    const { rows } = await tx.query<{ outcome: string; body: Record<string, unknown> | null }>(
      STATUS_SQL,
      [staff.tokenHash, requestId, bundleId],
    );
    const r = rows[0];
    if (r?.outcome === 'OK' && r.body !== null) return { outcome: 'OK', body: r.body };
    if (
      r?.outcome === 'AUTH_REQUIRED' ||
      r?.outcome === 'MFA_REQUIRED' ||
      r?.outcome === 'NOT_FOUND'
    ) {
      return { outcome: r.outcome };
    }
    return { outcome: 'FORBIDDEN' };
  }

  async open(
    tx: EvidenceSqlExecutor,
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
    reason: string,
  ): Promise<EvidenceOpenOutcome> {
    const { rows } = await tx.query<{
      outcome: string;
      file_id: string | null;
      storage_key: string | null;
      sha256: string | null;
      bytes: string | null;
      manifest_sha256: string | null;
      trip_id: string | null;
    }>(OPEN_SQL, [staff.tokenHash, requestId, bundleId, reason]);
    const r = rows[0];
    if (
      r?.outcome === 'OK' &&
      r.file_id !== null &&
      r.storage_key !== null &&
      r.sha256 !== null &&
      r.bytes !== null &&
      r.manifest_sha256 !== null &&
      r.trip_id !== null
    ) {
      return {
        outcome: 'OK',
        fileId: r.file_id,
        storageKey: r.storage_key,
        sha256: r.sha256,
        bytes: Number(r.bytes),
        manifestSha256: r.manifest_sha256,
        tripId: r.trip_id,
      };
    }
    const known = [...REFUSALS, 'NOT_FOUND', 'NOT_READY', 'FAILED', 'EXPIRED'];
    return {
      outcome: known.includes(r?.outcome ?? '')
        ? (r!.outcome as Exclude<EvidenceOpenOutcome['outcome'], 'OK'>)
        : 'FORBIDDEN',
    };
  }
}
