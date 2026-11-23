/**
 * Port et adaptateur PostgreSQL de la décision de l'ops sur un frais annexe contesté (US-706,
 * migration 0177, ADR-197 ; 16 CLM-021 « OPS_AGENT (décider) », ADM-008). L'adaptateur n'appelle
 * QUE les portes `core.support_staff_incidental` et `core.support_staff_decide_incidental`
 * (SECURITY DEFINER, propriétaire iam_staff_owner, EXECUTE au seul app_api), dans la transaction
 * STAFF du magasin des sinistres (même contexte, mêmes erreurs) : la base relit le TOTP, la
 * permission `dispute.decide` dans le pays, la séparation des tâches (ADR-122), le motif, réserve
 * le débit à ADMIN et journalise chaque décision et chaque refus. Le montant n'est jamais saisi
 * ici : il est celui de la demande de l'hôte, avec ses jambes figées.
 *
 * US-318 suite (migration 0181, ADR-201) : même mécanique pour une amende, un péage ou une fourrière
 * refacturés et contestés par le voyageur, par les portes `core.support_staff_traffic_charge`,
 * `core.support_staff_decide_traffic_charge` et `core.support_staff_traffic_review` (même
 * transaction STAFF, mêmes règles : `dispute.decide`, ADR-122, motif, débit réservé à ADMIN).
 */
import type { EvidenceSqlExecutor, EvidenceSqlPool } from '../evidence/ports.js';
import { ClaimStoreError, PgClaimStore } from '../claims/store.js';
import type { ClaimResult, ClaimStaff } from '../claims/store.js';

export type IncidentalDecisionOutcome = 'CHARGE' | 'REJECT';
export const INCIDENTAL_DECISION_OUTCOMES: readonly IncidentalDecisionOutcome[] = [
  'CHARGE',
  'REJECT',
];

export interface IncidentalStaffStore {
  transaction<T>(
    staff: ClaimStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T>;
  view(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    invoiceId: string,
  ): Promise<ClaimResult>;
  decide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    invoiceId: string,
    outcome: IncidentalDecisionOutcome,
    rationale: string,
  ): Promise<ClaimResult>;
  /** Frais « à revoir par l'ops » des pays de l'agent (report plafonné, ADR-197 n° 18). */
  review(tx: EvidenceSqlExecutor, staff: ClaimStaff, requestId: string): Promise<ClaimResult>;
  /** Refacturation d'une amende, d'un péage ou d'une fourrière (US-318 suite, ADR-201). */
  trafficView(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    chargeId: string,
  ): Promise<ClaimResult>;
  trafficDecide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    chargeId: string,
    outcome: IncidentalDecisionOutcome,
    rationale: string,
  ): Promise<ClaimResult>;
  /** Refacturations contestées à décider des pays de l'agent. */
  trafficReview(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
  ): Promise<ClaimResult>;
}

/** L'exposant de la devise (config, lisible par app_api) est joint pour l'affichage du montant. */
const withExponent = (call: string): string => `SELECT r.outcome, NULL::text AS id,
       CASE WHEN pg_catalog.jsonb_typeof(r.body) = 'object' AND c.exponent IS NOT NULL
            THEN r.body || pg_catalog.jsonb_build_object('exponent', c.exponent)
            ELSE r.body END AS body
  FROM ${call} AS r
  LEFT JOIN core.config_currency AS c ON c.code::text = r.body ->> 'currency'`;
const VIEW_SQL = withExponent('core.support_staff_incidental($1, $2::uuid, $3::uuid)');
const DECIDE_SQL = withExponent(
  'core.support_staff_decide_incidental($1, $2::uuid, $3::uuid, $4, $5)',
);

const REVIEW_SQL = `SELECT r.outcome, NULL::text AS id, r.body
  FROM core.support_staff_incidental_review($1, $2::uuid) AS r`;
const TRAFFIC_VIEW_SQL = withExponent('core.support_staff_traffic_charge($1, $2::uuid, $3::uuid)');
const TRAFFIC_DECIDE_SQL = withExponent(
  'core.support_staff_decide_traffic_charge($1, $2::uuid, $3::uuid, $4, $5)',
);
const TRAFFIC_REVIEW_SQL = `SELECT r.outcome, NULL::text AS id, r.body
  FROM core.support_staff_traffic_review($1, $2::uuid) AS r`;

type Row = { outcome: string; id: string | null; body: Record<string, unknown> | null };

function resultOf(rows: readonly Row[]): ClaimResult {
  const r = rows[0];
  // aucune ligne : contrat rompu, traité comme un refus (fail-closed)
  if (r === undefined) return { outcome: 'FORBIDDEN', id: null, body: null };
  return { outcome: r.outcome, id: r.id, body: r.body };
}

export class PgIncidentalStaffStore implements IncidentalStaffStore {
  readonly #claims: PgClaimStore;

  constructor(pool: EvidenceSqlPool) {
    this.#claims = new PgClaimStore(pool);
  }

  transaction<T>(
    staff: ClaimStaff,
    fn: (tx: EvidenceSqlExecutor) => Promise<{ readonly commit: boolean; readonly value: T }>,
  ): Promise<T> {
    return this.#claims.transaction(staff, fn);
  }

  async view(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    invoiceId: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(VIEW_SQL, [staff.tokenHash, requestId, invoiceId]);
    return resultOf(rows);
  }

  async decide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    invoiceId: string,
    outcome: IncidentalDecisionOutcome,
    rationale: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(DECIDE_SQL, [
      staff.tokenHash,
      requestId,
      invoiceId,
      outcome,
      rationale,
    ]);
    return resultOf(rows);
  }

  async review(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(REVIEW_SQL, [staff.tokenHash, requestId]);
    return resultOf(rows);
  }

  async trafficView(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    chargeId: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(TRAFFIC_VIEW_SQL, [staff.tokenHash, requestId, chargeId]);
    return resultOf(rows);
  }

  async trafficDecide(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
    chargeId: string,
    outcome: IncidentalDecisionOutcome,
    rationale: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(TRAFFIC_DECIDE_SQL, [
      staff.tokenHash,
      requestId,
      chargeId,
      outcome,
      rationale,
    ]);
    return resultOf(rows);
  }

  async trafficReview(
    tx: EvidenceSqlExecutor,
    staff: ClaimStaff,
    requestId: string,
  ): Promise<ClaimResult> {
    const { rows } = await tx.query<Row>(TRAFFIC_REVIEW_SQL, [staff.tokenHash, requestId]);
    return resultOf(rows);
  }
}

/** Magasin absent : toute transaction échoue (503, fail-closed). */
export const UNAVAILABLE_INCIDENTAL_STAFF_STORE: IncidentalStaffStore = {
  transaction: () => Promise.reject(new ClaimStoreError(null)),
  view: () => Promise.reject(new ClaimStoreError(null)),
  decide: () => Promise.reject(new ClaimStoreError(null)),
  review: () => Promise.reject(new ClaimStoreError(null)),
  trafficView: () => Promise.reject(new ClaimStoreError(null)),
  trafficDecide: () => Promise.reject(new ClaimStoreError(null)),
  trafficReview: () => Promise.reject(new ClaimStoreError(null)),
};
