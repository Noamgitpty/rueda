/**
 * Port et adaptateur PostgreSQL des actions de console (`manual_action`, 17 §3.2.13, §10 ; US-012,
 * US-101). Un appel de `core.iam_staff_cmd_manual_action` (forme à pièces de la migration 0060 ;
 * SECURITY DEFINER, EXECUTE au seul app_api) en UNE instruction, en autocommit : la CTE pose le
 * contexte STAFF (lu par les commandes FINANCE liées), puis la ligne qu'elle produit déclenche la
 * commande (ADR-056 point 4, ADR-063, ADR-092). La commande relit la session (preuve de
 * possession), la MFA, les rôles, la matrice et le pays du sujet, applique les règles de saisie
 * (aucun montant) et de pièces, appelle la commande de domaine liée dans la même transaction, et
 * écrit l'audit en dernier. Erreurs de la base : seul le SQLSTATE est gardé.
 */
import type { SqlExecutor } from '../../iam/index.js';
import { STAFF_CONTEXT_CTE, staffContextValues } from './staff-context.js';
import type { StaffActor } from './staff-context.js';

export type ManualActionOutcome =
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'REFUSED'
  | 'RECORDED'
  | 'DONE'
  | 'REQUESTED'
  | 'DUPLICATE';

export interface ManualActionInput {
  readonly requestId: string;
  readonly actionCode: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly input: Record<string, unknown> | null;
  /** Pièces déjà reçues (`audit_file_asset`, seau des preuves) ; obligatoires en RECORD_ONLY. */
  readonly evidence: readonly string[];
}

export interface ManualActionResult {
  readonly outcome: ManualActionOutcome;
  readonly actionId: string | null;
  /** Référence rendue par la commande de domaine (par exemple la demande FINANCE). */
  readonly domainRef: string | null;
  /** REFUSED : issue de la commande de domaine ; DUPLICATE : issue d'origine. */
  readonly detail: string | null;
}

export interface ManualActionStore {
  record(actor: StaffActor, input: ManualActionInput): Promise<ManualActionResult>;
}

export class ManualActionStoreError extends Error {
  override readonly name = 'ManualActionStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`console : échec de la base (manual_action${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

export const MANUAL_ACTION_SQL = `WITH ${STAFF_CONTEXT_CTE}
SELECT r.outcome, r.action_id, r.domain_ref, r.detail
  FROM ctx
 CROSS JOIN LATERAL core.iam_staff_cmd_manual_action(
         CASE WHEN ctx.kind IS NOT NULL THEN $4::bytea END, $5::uuid, $6::text, $7::uuid, $8::text,
         $9::jsonb, $10::uuid[]) AS r`;

export class PgManualActionStore implements ManualActionStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async record(actor: StaffActor, input: ManualActionInput): Promise<ManualActionResult> {
    try {
      const { rows } = await this.#db.query<{
        outcome: ManualActionOutcome;
        action_id: string | null;
        domain_ref: string | null;
        detail: string | null;
      }>(MANUAL_ACTION_SQL, [
        ...staffContextValues(actor),
        actor.tokenHash,
        input.requestId,
        input.actionCode,
        input.subjectId,
        input.reason,
        input.input ?? {},
        [...input.evidence],
      ]);
      const r = rows[0];
      return {
        outcome: r?.outcome ?? 'FORBIDDEN',
        actionId: r?.action_id ?? null,
        domainRef: r?.domain_ref ?? null,
        detail: r?.detail ?? null,
      };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new ManualActionStoreError(typeof code === 'string' ? code : undefined);
    }
  }
}
