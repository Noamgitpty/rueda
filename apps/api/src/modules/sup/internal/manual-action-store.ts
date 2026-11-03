/**
 * Port et adaptateur PostgreSQL des actions de console (`manual_action`, 17 §3.2.13 ; US-012).
 * Un appel de `core.iam_staff_cmd_manual_action` (migration 0032 ; SECURITY DEFINER, EXECUTE au
 * seul app_api) en autocommit : « un appel = une instruction » (ADR-056). La commande relit la
 * session (preuve de possession), la MFA, les rôles, la matrice et le pays du sujet, puis agit ou
 * refuse, et écrit l'audit en dernier. Erreurs de la base : seul le SQLSTATE est gardé.
 */
import type { SqlExecutor } from '../../iam/index.js';

export type ManualActionOutcome =
  'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE' | 'RECORDED' | 'DUPLICATE';

export interface ManualActionInput {
  readonly requestId: string;
  readonly actionCode: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly input: Record<string, unknown> | null;
}

export interface ManualActionStore {
  record(
    tokenHash: Buffer,
    input: ManualActionInput,
  ): Promise<{ outcome: ManualActionOutcome; actionId: string | null }>;
}

export class ManualActionStoreError extends Error {
  override readonly name = 'ManualActionStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`console : échec de la base (manual_action${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

export class PgManualActionStore implements ManualActionStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async record(
    tokenHash: Buffer,
    input: ManualActionInput,
  ): Promise<{ outcome: ManualActionOutcome; actionId: string | null }> {
    try {
      const { rows } = await this.#db.query<{
        outcome: ManualActionOutcome;
        action_id: string | null;
      }>(
        'SELECT outcome, action_id FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6)',
        [tokenHash, input.requestId, input.actionCode, input.subjectId, input.reason, input.input],
      );
      const r = rows[0];
      return { outcome: r?.outcome ?? 'FORBIDDEN', actionId: r?.action_id ?? null };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new ManualActionStoreError(typeof code === 'string' ? code : undefined);
    }
  }
}
