/**
 * Adaptateur PostgreSQL du port de persistance (production) : appelle les seules commandes
 * `core.iam_*` (migration 0011, `SECURITY DEFINER`, `EXECUTE` au seul `app_api`). Requêtes
 * paramétrées uniquement (aucun SQL construit, 17 §2.3 « Limite de la RLS »).
 *
 * Les erreurs de la base sont remplacées par une erreur sans message du serveur ni paramètre
 * (seul le SQLSTATE est gardé) : un jeton, une empreinte ou un email ne peut pas finir dans un
 * journal par ce chemin.
 */
import type {
  AccountStatus,
  ApiRevocationReason,
  AuthStore,
  Credentials,
  MfaLevel,
  OpenSessionInput,
  RegisterAccountInput,
  SessionRecord,
} from './auth-store.js';
import { SignupDocumentsError } from './auth-store.js';

/** Contraintes de la commande d'inscription avec consentements (0059) → motif du refus. */
const SIGNUP_DOCUMENT_CONSTRAINTS: Readonly<Record<string, SignupDocumentsError['reason']>> = {
  ctr_document_version_current: 'VERSION_CHANGED',
  ctr_document_unavailable: 'UNAVAILABLE',
  ctr_document_request_invalid: 'INVALID',
  ctr_country_unknown: 'COUNTRY_UNKNOWN',
};

/** Sous-ensemble de `pg.Pool` / `pg.Client` utilisé ici. */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export class AuthStoreError extends Error {
  override readonly name = 'AuthStoreError';
  readonly sqlstate: string | undefined;
  /** Nom de contrainte (jamais une valeur) : distingue les refus métier des commandes. */
  readonly constraint: string | undefined;

  constructor(operation: string, sqlstate: string | undefined, constraint?: string) {
    super(`IAM : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
    this.constraint = constraint;
  }
}

export class PgAuthStore implements AuthStore {
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
      const { code, constraint } = error as { code?: unknown; constraint?: unknown };
      throw new AuthStoreError(
        operation,
        typeof code === 'string' ? code : undefined,
        typeof constraint === 'string' ? constraint : undefined,
      );
    }
  }

  async registerAccount(input: RegisterAccountInput): Promise<boolean> {
    let rows: { created: boolean }[];
    try {
      // US-102 : compte et consentements dans la même instruction (le déclencheur différé de 0059
      // refuse tout compte sans CGU ni confidentialité acceptées)
      rows = await this.#run<{ created: boolean }>(
        'register',
        `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                                                    $11, $12::jsonb, $13) AS created`,
        [
          input.userId,
          input.email,
          input.passwordHash,
          input.legalFirstName,
          input.legalLastName,
          input.preferredLocale,
          input.verificationId,
          input.verificationTokenHash,
          input.verificationTtlS,
          input.ip,
          input.country ?? null,
          input.documents == null ? null : JSON.stringify(input.documents),
          input.marketingOptIn ?? false,
        ],
      );
    } catch (error) {
      // 23514 : refus métier nommés ; 23503 (clé étrangère, ex. pays) : demande invalide, jamais 500
      const reason =
        error instanceof AuthStoreError && error.sqlstate === '23514'
          ? SIGNUP_DOCUMENT_CONSTRAINTS[error.constraint ?? '']
          : error instanceof AuthStoreError && error.sqlstate === '23503'
            ? 'INVALID'
            : undefined;
      if (reason !== undefined) throw new SignupDocumentsError(reason);
      throw error;
    }
    return rows[0]?.created === true;
  }

  async verifyEmail(tokenHash: Buffer): Promise<boolean> {
    const rows = await this.#run<{ ok: boolean }>(
      'verify_email',
      'SELECT core.iam_cmd_verify_email($1) AS ok',
      [tokenHash],
    );
    return rows[0]?.ok === true;
  }

  async findCredentials(email: string): Promise<Credentials | null> {
    const rows = await this.#run<{ user_id: string; password_hash: string | null; status: string }>(
      'lookup',
      'SELECT user_id, password_hash, status FROM core.iam_auth_lookup($1)',
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      passwordHash: row.password_hash,
      status: row.status as AccountStatus,
    };
  }

  async openSession(input: OpenSessionInput): Promise<Date | null> {
    const rows = await this.#run<{ expires_at: Date | null }>(
      'open_session',
      'SELECT core.iam_cmd_open_session($1, $2, $3, $4, $5, $6, $7) AS expires_at',
      [
        input.sessionId,
        input.userId,
        input.tokenHash,
        input.ttlS,
        input.mfaLevel,
        input.ip,
        input.userAgent,
      ],
    );
    return rows[0]?.expires_at ?? null;
  }

  async resolveSession(tokenHash: Buffer): Promise<SessionRecord | null> {
    const rows = await this.#run<{
      session_id: string;
      user_id: string;
      mfa_level: string;
      expires_at: Date;
      email_verified: boolean;
    }>(
      'resolve_session',
      'SELECT session_id, user_id, mfa_level, expires_at, email_verified FROM core.iam_session_resolve($1)',
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      mfaLevel: row.mfa_level as MfaLevel,
      expiresAt: row.expires_at,
      emailVerified: row.email_verified === true,
    };
  }

  async revokeSession(tokenHash: Buffer, reason: ApiRevocationReason): Promise<boolean> {
    const rows = await this.#run<{ ok: boolean }>(
      'revoke_session',
      'SELECT core.iam_cmd_revoke_session($1, $2) AS ok',
      [tokenHash, reason],
    );
    return rows[0]?.ok === true;
  }

  async revokeAllSessions(tokenHash: Buffer): Promise<number> {
    const rows = await this.#run<{ n: number }>(
      'revoke_all_sessions',
      'SELECT core.iam_cmd_revoke_all_sessions($1) AS n',
      [tokenHash],
    );
    return rows[0]?.n ?? 0;
  }
}

/**
 * Contrôle de démarrage (L0-05 appliqué à la production) : la connexion de l'API tourne sous
 * `app_api`, sans `SUPERUSER` ni `BYPASSRLS`. Sinon, refus de démarrer.
 */
export async function assertApiDatabaseRole(db: SqlExecutor): Promise<void> {
  const { rows } = await db.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_user, r.rolsuper, r.rolbypassrls
       FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (
    !row ||
    row.current_user !== 'app_api' ||
    row.rolsuper !== false ||
    row.rolbypassrls !== false
  ) {
    throw new Error(
      `IAM : la connexion de l'API doit être app_api sans SUPERUSER ni BYPASSRLS (obtenu : ${row?.current_user ?? '?'})`,
    );
  }
}
