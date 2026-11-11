/**
 * Décisions FINANCE à deux personnes depuis la console (US-101 ; 17 §2.3 « commandes FINANCE »,
 * RLS-24 ; migration 0036). La DEMANDE passe par le cadre des actions de console
 * (`ISSUE_BORDEREAU`, `DECIDE_ADVANCE`, `WRITE_OFF_RECEIVABLE` : manual-action-store.ts) ; ce port
 * porte les deux autres gestes :
 * - `pending` : demandes en attente, lues sous la RLS `fin_read` (FINANCE et ADMIN du pays, session
 *   élevée ; colonnes sans identifiant du personnel) dans une transaction courte de lecture, sous le
 *   contexte STAFF (forme transactionnelle admise, ADR-063 point 7) ;
 * - `approve` : `core.settlement_cmd_approve_finance_action` en UNE instruction, en autocommit ;
 *   l'approbateur est la personne de la session : la base refuse le demandeur (SELF_APPROVAL),
 *   même dans une autre session.
 */
import type { SqlExecutor } from '../../iam/index.js';
import { STAFF_CONTEXT_CTE, STAFF_CONTEXT_SELECT, staffContextValues } from './staff-context.js';
import type { StaffActor } from './staff-context.js';

export type ApprovalOutcome =
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_PENDING'
  | 'SELF_APPROVAL'
  | 'SUBJECT_CHANGED'
  | 'APPROVED';

export interface PendingApproval {
  readonly id: string;
  readonly action: string;
  readonly subjectId: string;
  readonly country: string;
  readonly reason: string;
  readonly requestedAt: Date;
}

export interface FinanceApprovalStore {
  pending(actor: StaffActor, limit: number): Promise<readonly PendingApproval[]>;
  approve(actor: StaffActor, approvalId: string): Promise<ApprovalOutcome>;
}

/** Client d'une transaction (sous-ensemble de `pg.PoolClient`). */
export interface SqlClient extends SqlExecutor {
  release(): void;
}

/** Pool de connexions (sous-ensemble de `pg.Pool`). */
export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
}

export const APPROVE_SQL = `WITH ${STAFF_CONTEXT_CTE}
SELECT r.outcome
  FROM ctx
 CROSS JOIN LATERAL core.settlement_cmd_approve_finance_action(
         CASE WHEN ctx.kind IS NOT NULL THEN $4::bytea END, $5::uuid) AS r`;

const PENDING_SQL = `SELECT f.id, f.action, f.subject_id, f.country_code, f.reason, f.requested_at
  FROM core.settlement_finance_approval AS f
 WHERE f.status = 'PENDING'
 ORDER BY f.requested_at, f.id
 LIMIT $1`;

export class PgFinanceApprovalStore implements FinanceApprovalStore {
  readonly #pool: SqlPool;

  constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  async pending(actor: StaffActor, limit: number): Promise<readonly PendingApproval[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(STAFF_CONTEXT_SELECT, staffContextValues(actor));
      const { rows } = await client.query<{
        id: string;
        action: string;
        subject_id: string;
        country_code: string;
        reason: string;
        requested_at: Date;
      }>(PENDING_SQL, [limit]);
      await client.query('COMMIT');
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        subjectId: r.subject_id,
        country: r.country_code,
        reason: r.reason,
        requestedAt: r.requested_at,
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async approve(actor: StaffActor, approvalId: string): Promise<ApprovalOutcome> {
    const { rows } = await this.#pool.query<{ outcome: ApprovalOutcome }>(APPROVE_SQL, [
      ...staffContextValues(actor),
      actor.tokenHash,
      approvalId,
    ]);
    return rows[0]?.outcome ?? 'FORBIDDEN';
  }
}
