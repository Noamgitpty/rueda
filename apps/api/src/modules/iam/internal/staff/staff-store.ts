/**
 * Port de persistance du staff et de la console (US-012) et son adaptateur PostgreSQL : un appel
 * de commande `core.iam_staff_*` (migrations 0031, 0032 ; SECURITY DEFINER, EXECUTE au seul
 * app_api) par méthode, en autocommit — « un appel = une instruction » (ADR-056). Requêtes
 * paramétrées seulement ; la session est toujours désignée par l'empreinte de son jeton.
 *
 * Les erreurs de la base sont remplacées par une erreur sans message ni paramètre (seul le
 * SQLSTATE est gardé) : ni empreinte, ni code, ni preuve ne peut finir dans un journal.
 */
import type { SqlExecutor } from '../pg-auth-store.js';

export type StaffAccessOutcome =
  | 'AUTH_REQUIRED'
  | 'NOT_STAFF'
  | 'TOTP_NOT_ENROLLED'
  | 'ENROLLMENT_REQUIRED'
  | 'LOCKED'
  | 'MFA_REQUIRED'
  | 'ELEVATED';

export interface StaffRole {
  readonly role: string;
  readonly countries: readonly string[];
}

export interface StaffAccess {
  readonly outcome: StaffAccessOutcome;
  readonly userId: string | null;
  readonly factorId: string | null;
  /** Rendue pour un facteur ACTIF non encore prouvé dans cette session (MFA_REQUIRED). */
  readonly secretRef: string | null;
  readonly lastUsedStep: number | null;
  readonly roles: readonly StaffRole[];
}

export type ElevateOutcome =
  'ELEVATED' | 'ENROLLED' | 'AUTH_REQUIRED' | 'NOT_STAFF' | 'REFUSED' | 'LOCKED' | 'UNAVAILABLE';

export type CommandOutcome = 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN' | 'DONE';

export interface AuditEntry {
  readonly id: string;
  readonly at: Date;
  readonly actorUserId: string | null;
  readonly actorRole: string;
  readonly actionCode: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly reason: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

export interface ResetTotpInput {
  readonly requestId: string;
  readonly target: string;
  readonly reason: string;
  readonly factorId: string;
  readonly secretRef: string;
  readonly codeHash: Buffer;
  readonly ttlS: number;
}

export interface StaffStore {
  begin(tokenHash: Buffer): Promise<StaffAccess>;
  enrollReveal(
    tokenHash: Buffer,
    codeHash: Buffer,
  ): Promise<{
    outcome: 'OK' | 'REFUSED' | 'LOCKED' | 'AUTH_REQUIRED';
    factorId: string | null;
    secretRef: string | null;
  }>;
  elevate(
    tokenHash: Buffer,
    factorId: string,
    step: number,
    proof: Buffer,
  ): Promise<ElevateOutcome>;
  mfaFailed(tokenHash: Buffer): Promise<'COUNTED' | 'LOCKED' | 'AUTH_REQUIRED'>;
  suspend(
    tokenHash: Buffer,
    requestId: string,
    target: string,
    reason: string,
  ): Promise<CommandOutcome>;
  resetTotp(tokenHash: Buffer, input: ResetTotpInput): Promise<CommandOutcome>;
  auditRead(tokenHash: Buffer, beforeId: string | null, limit: number): Promise<AuditEntry[]>;
}

export class StaffStoreError extends Error {
  override readonly name = 'StaffStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`console : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

export class PgStaffStore implements StaffStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async #run<R extends Record<string, unknown>>(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<R[]> {
    try {
      return (await this.#db.query<R>(text, values)).rows;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new StaffStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async begin(tokenHash: Buffer): Promise<StaffAccess> {
    const rows = await this.#run<{
      outcome: StaffAccessOutcome;
      user_id: string | null;
      factor_id: string | null;
      secret_ref: string | null;
      last_used_step: string | null;
      roles: StaffRole[] | null;
    }>(
      'begin',
      'SELECT outcome, user_id, factor_id, secret_ref, last_used_step, roles FROM core.iam_staff_cmd_begin($1)',
      [tokenHash],
    );
    const r = rows[0];
    if (!r) throw new StaffStoreError('begin', undefined);
    return {
      outcome: r.outcome,
      userId: r.user_id,
      factorId: r.factor_id,
      secretRef: r.secret_ref,
      lastUsedStep: r.last_used_step === null ? null : Number(r.last_used_step),
      roles: r.roles ?? [],
    };
  }

  async enrollReveal(tokenHash: Buffer, codeHash: Buffer) {
    const rows = await this.#run<{
      outcome: 'OK' | 'REFUSED' | 'LOCKED' | 'AUTH_REQUIRED';
      factor_id: string | null;
      secret_ref: string | null;
    }>(
      'enroll_reveal',
      'SELECT outcome, factor_id, secret_ref FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
      [tokenHash, codeHash],
    );
    const r = rows[0];
    if (!r) throw new StaffStoreError('enroll_reveal', undefined);
    return { outcome: r.outcome, factorId: r.factor_id, secretRef: r.secret_ref };
  }

  async elevate(tokenHash: Buffer, factorId: string, step: number, proof: Buffer) {
    const rows = await this.#run<{ r: ElevateOutcome }>(
      'elevate',
      'SELECT core.iam_staff_cmd_elevate($1, $2, $3, $4) AS r',
      [tokenHash, factorId, step, proof],
    );
    return rows[0]?.r ?? 'REFUSED';
  }

  async mfaFailed(tokenHash: Buffer) {
    const rows = await this.#run<{ r: 'COUNTED' | 'LOCKED' | 'AUTH_REQUIRED' }>(
      'mfa_failed',
      'SELECT core.iam_staff_cmd_mfa_failed($1) AS r',
      [tokenHash],
    );
    return rows[0]?.r ?? 'COUNTED';
  }

  async suspend(tokenHash: Buffer, requestId: string, target: string, reason: string) {
    const rows = await this.#run<{ r: CommandOutcome }>(
      'suspend',
      'SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r',
      [tokenHash, requestId, target, reason],
    );
    return rows[0]?.r ?? 'FORBIDDEN';
  }

  async resetTotp(tokenHash: Buffer, input: ResetTotpInput) {
    const rows = await this.#run<{ r: CommandOutcome }>(
      'reset_totp',
      'SELECT core.iam_staff_cmd_reset_totp($1, $2, $3, $4, $5, $6, $7, $8) AS r',
      [
        tokenHash,
        input.requestId,
        input.target,
        input.reason,
        input.factorId,
        input.secretRef,
        input.codeHash,
        input.ttlS,
      ],
    );
    return rows[0]?.r ?? 'FORBIDDEN';
  }

  async auditRead(tokenHash: Buffer, beforeId: string | null, limit: number) {
    const rows = await this.#run<{
      id: string;
      at: Date;
      actor_user_id: string | null;
      actor_role: string;
      action_code: string;
      subject_type: string;
      subject_id: string;
      reason: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>('audit_read', 'SELECT * FROM core.iam_staff_audit_read($1, $2, $3)', [
      tokenHash,
      beforeId,
      limit,
    ]);
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorUserId: r.actor_user_id,
      actorRole: r.actor_role,
      actionCode: r.action_code,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      reason: r.reason,
      before: r.before,
      after: r.after,
    }));
  }
}
