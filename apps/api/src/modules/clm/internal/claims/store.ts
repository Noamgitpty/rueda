/**
 * Port et adaptateur PostgreSQL des déclarations de dommage et des décisions (US-309, migration
 * 0175, ADR-195). L'adaptateur n'appelle QUE les portes `core.support_staff_record_claim`,
 * `core.support_staff_claim` et `core.support_staff_issue_decision` (SECURITY DEFINER,
 * propriétaire iam_staff_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables.
 * Le membre du staff est désigné par l'empreinte de son jeton de session (preuve de possession),
 * jamais par un identifiant reçu ; la base relit le TOTP, la permission (`claim.declare`,
 * `dispute.decide`), le dossier de support, la séparation des tâches, les preuves, les plafonds et
 * journalise chaque décision et chaque refus. Les montants sont des textes d'entiers (unités
 * mineures), jamais des nombres JSON.
 */
import type { EvidenceSqlClient, EvidenceSqlExecutor, EvidenceSqlPool } from '../evidence/ports.js';

export type ClaimDeclaredBy = 'HOST' | 'GUEST';
export type ClaimKind = 'DAMAGE' | 'INCIDENT';
export type DecisionOutcome = 'GUEST_LIABLE' | 'NO_GUEST_CHARGE' | 'INELIGIBLE';
export type DecisionLineCategory =
  | 'REPAIR'
  | 'INSURER_RECOVERY'
  | 'PROCESSING_FEE'
  | 'PROCESSING_FEE_TAX'
  | 'RECOVERY_PARKING'
  | 'NOT_ATTRIBUTABLE';

export const DECLARED_BY: readonly ClaimDeclaredBy[] = ['HOST', 'GUEST'];
export const CLAIM_KINDS: readonly ClaimKind[] = ['DAMAGE', 'INCIDENT'];
export const DECISION_OUTCOMES: readonly DecisionOutcome[] = [
  'GUEST_LIABLE',
  'NO_GUEST_CHARGE',
  'INELIGIBLE',
];
export const DECISION_LINE_CATEGORIES: readonly DecisionLineCategory[] = [
  'REPAIR',
  'INSURER_RECOVERY',
  'PROCESSING_FEE',
  'PROCESSING_FEE_TAX',
  'RECOVERY_PARKING',
  'NOT_ATTRIBUTABLE',
];

/** Membre du staff de la session (principal du garde de la console). */
export interface ClaimStaff {
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly countries: readonly string[];
}

export interface RecordClaimInput {
  readonly requestId: string;
  readonly tripId: string;
  readonly caseId: string;
  readonly declaredBy: ClaimDeclaredBy;
  readonly kind: ClaimKind;
  readonly description: string;
}

export interface DecisionLine {
  readonly category: DecisionLineCategory;
  readonly amountMinor: string;
}

export interface DecisionInput {
  readonly outcome: DecisionOutcome;
  readonly covered: boolean;
  readonly repairCostMinor: string;
  readonly amountMinor: string;
  readonly lines: readonly DecisionLine[];
  readonly hostDeductibleMinor: string;
  readonly facts?: string;
  readonly guestAgreementFileId?: string | null;
}

/** Issue d'une porte : code de la base et corps (vue de la déclaration ou aperçu du gabarit). */
export interface ClaimResult {
  readonly outcome: string;
  readonly id: string | null;
  readonly body: Record<string, unknown> | null;
}

/** Transaction de la console sous contexte STAFF ; `commit: false` l'annule (fail-closed). */
export interface ClaimStore {
  transaction<T>(
    staff: ClaimStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T>;
  record(tx: EvidenceSqlExecutor, staff: ClaimStaff, input: RecordClaimInput): Promise<ClaimResult>;
  view(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    claimId: string,
  ): Promise<ClaimResult>;
  decide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    claimId: string,
    input: DecisionInput,
    preview: boolean,
  ): Promise<ClaimResult>;
}

export class ClaimStoreError extends Error {
  override readonly name = 'ClaimStoreError';
  readonly sqlstate: string | null;

  constructor(sqlstate: string | null) {
    super(`sinistres : base indisponible (${sqlstate ?? 'inconnu'})`);
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

/**
 * L'exposant de la devise (config, lisible par app_api) est joint dans la MÊME instruction, pour
 * l'affichage et la saisie des montants dans la console (jamais un calcul ; comme US-215b).
 */
const withExponent = (call: string, id: string): string => `SELECT r.outcome, ${id} AS id,
       CASE WHEN pg_catalog.jsonb_typeof(r.body) = 'object' AND c.exponent IS NOT NULL
            THEN r.body || pg_catalog.jsonb_build_object('exponent', c.exponent)
            ELSE r.body END AS body
  FROM ${call} AS r
  LEFT JOIN core.config_currency AS c ON c.code::text = r.body ->> 'currency'`;
const RECORD_SQL = withExponent(
  'core.support_staff_record_claim($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)',
  'r.claim_id::text',
);
const VIEW_SQL = withExponent('core.support_staff_claim($1, $2::uuid, $3::uuid)', 'NULL::text');
const DECIDE_SQL = withExponent(
  'core.support_staff_issue_decision($1, $2::uuid, $3::uuid, $4::jsonb, $5)',
  'r.decision_id::text',
);

function sqlstateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function resultOf(
  rows: readonly { outcome: string; id: string | null; body: Record<string, unknown> | null }[],
): ClaimResult {
  const r = rows[0];
  // aucune ligne : contrat rompu, traité comme un refus (fail-closed)
  if (r === undefined) return { outcome: 'FORBIDDEN', id: null, body: null };
  return { outcome: r.outcome, id: r.id, body: r.body };
}

export class PgClaimStore implements ClaimStore {
  constructor(private readonly pool: EvidenceSqlPool) {}

  async transaction<T>(
    staff: ClaimStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T> {
    let client: EvidenceSqlClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new ClaimStoreError(sqlstateOf(error));
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
      if (error instanceof ClaimStoreError) throw error;
      // erreur de la base : SQLSTATE seulement ; une erreur du code appelant remonte telle quelle
      if (sqlstateOf(error) !== null) throw new ClaimStoreError(sqlstateOf(error));
      throw error;
    } finally {
      client.release();
    }
  }

  async record(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    input: RecordClaimInput,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<{
      outcome: string;
      id: string | null;
      body: Record<string, unknown> | null;
    }>(RECORD_SQL, [
      staff.tokenHash,
      input.requestId,
      input.tripId,
      input.caseId,
      input.declaredBy,
      input.kind,
      input.description,
    ]);
    return resultOf(rows);
  }

  async view(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    claimId: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<{
      outcome: string;
      id: string | null;
      body: Record<string, unknown> | null;
    }>(VIEW_SQL, [staff.tokenHash, requestId, claimId]);
    return resultOf(rows);
  }

  async decide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    claimId: string,
    input: DecisionInput,
    preview: boolean,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<{
      outcome: string;
      id: string | null;
      body: Record<string, unknown> | null;
    }>(DECIDE_SQL, [staff.tokenHash, requestId, claimId, JSON.stringify(input), preview]);
    return resultOf(rows);
  }
}

/** Magasin absent : toute transaction échoue (503, fail-closed). */
export const UNAVAILABLE_CLAIM_STORE: ClaimStore = {
  transaction: () => Promise.reject(new ClaimStoreError(null)),
  record: () => Promise.reject(new ClaimStoreError(null)),
  view: () => Promise.reject(new ClaimStoreError(null)),
  decide: () => Promise.reject(new ClaimStoreError(null)),
};
