/**
 * Port de persistance du staff et de la console (US-012) et son adaptateur PostgreSQL : un appel
 * de commande `core.iam_staff_*` (migrations 0033, 0034 ; SECURITY DEFINER, EXECUTE au seul
 * app_api) par méthode, en autocommit — « un appel = une instruction » (ADR-056). Requêtes
 * paramétrées seulement ; la session est toujours désignée par l'empreinte de son jeton.
 *
 * Les erreurs de la base sont remplacées par une erreur sans message ni paramètre (seul le
 * SQLSTATE est gardé) : ni empreinte, ni code, ni preuve ne peut finir dans un journal.
 */
import { AuthHttpError } from '../errors.js';
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
  readonly roles: readonly StaffRole[];
}

/** Tentative MFA comptée par la base AVANT de rendre la référence du secret. */
export interface MfaAttempt {
  readonly outcome: 'OK' | 'LOCKED' | 'REFUSED' | 'AUTH_REQUIRED' | 'NOT_STAFF';
  readonly factorId: string | null;
  readonly secretRef: string | null;
  readonly lastUsedStep: number | null;
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
  mfaAttempt(tokenHash: Buffer): Promise<MfaAttempt>;
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
      roles: StaffRole[] | null;
    }>('begin', 'SELECT outcome, user_id, factor_id, roles FROM core.iam_staff_cmd_begin($1)', [
      tokenHash,
    ]);
    const r = rows[0];
    if (!r) throw new StaffStoreError('begin', undefined);
    return { outcome: r.outcome, userId: r.user_id, factorId: r.factor_id, roles: r.roles ?? [] };
  }

  async mfaAttempt(tokenHash: Buffer): Promise<MfaAttempt> {
    const rows = await this.#run<{
      outcome: MfaAttempt['outcome'];
      factor_id: string | null;
      secret_ref: string | null;
      last_used_step: string | null;
    }>(
      'mfa_attempt',
      'SELECT outcome, factor_id, secret_ref, last_used_step FROM core.iam_staff_cmd_mfa_attempt($1)',
      [tokenHash],
    );
    const r = rows[0];
    if (!r) throw new StaffStoreError('mfa_attempt', undefined);
    return {
      outcome: r.outcome,
      factorId: r.factor_id,
      secretRef: r.secret_ref,
      lastUsedStep: r.last_used_step === null ? null : Number(r.last_used_step),
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

  /**
   * Lecture vide : refus ou vraie liste vide ? La lecture a déjà journalisé un refus ; l'issue
   * d'accès (0049, sans écriture) fait répondre 401 / 403 au lieu d'un 200 vide (16 ADM-001, US-043).
   */
  async #assertReadAccess(tokenHash: Buffer, permission: string, scope: string): Promise<void> {
    const rows = await this.#run<{ outcome: string }>(
      'read_access',
      'SELECT core.iam_staff_read_access($1, $2, $3) AS outcome',
      [tokenHash, permission, scope],
    );
    const outcome = rows[0]?.outcome;
    if (outcome === 'OK') return;
    if (outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
    if (outcome === 'MFA_REQUIRED') throw new AuthHttpError('2FA_REQUIRED');
    throw new AuthHttpError('FORBIDDEN');
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
    if (rows.length === 0) await this.#assertReadAccess(tokenHash, 'audit.read', 'ANY');
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
