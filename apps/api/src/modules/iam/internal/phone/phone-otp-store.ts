/**
 * Port de persistance de l'OTP du téléphone (US-104, ADR-098) et son adaptateur PostgreSQL : les
 * seules commandes `core.iam_*` de 0066 (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`),
 * requêtes paramétrées, personne désignée par l'empreinte de son jeton de session (jamais un
 * identifiant reçu du client). La base juge tout à son horloge, avec les paramètres du pays.
 *
 * Implémentations : `PgPhoneOtpStore` (production) ; `FakePhoneOtpStore` (`../../testing/`, TESTS
 * SEULEMENT) ; `UnavailablePhoneOtpStore` (aucun magasin fourni : OTP indisponible, fail-closed).
 * Erreurs de la base : remplacées par une erreur sans message du serveur ni paramètre.
 */
import type { SqlExecutor } from '../pg-auth-store.js';
import { AuthStoreError } from '../pg-auth-store.js';

export const OTP_REQUEST_OUTCOMES = [
  'SENT',
  'AUTH_REQUIRED',
  'REQUEST_INVALID',
  'COUNTRY_UNKNOWN',
  'NOT_ELIGIBLE',
  'ALREADY_VERIFIED',
  'PARAM_MISSING',
  'LOCKED',
  'RESEND_WAIT',
] as const;
export type OtpRequestOutcome = (typeof OTP_REQUEST_OUTCOMES)[number];

export const OTP_VERIFY_OUTCOMES = [
  'PHONE_VERIFIED',
  'AUTH_REQUIRED',
  'PARAM_MISSING',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_INVALID',
  'ACCOUNT_DUPLICATE_PHONE',
] as const;
export type OtpVerifyOutcome = (typeof OTP_VERIFY_OUTCOMES)[number];

export interface OtpRequestResult {
  readonly outcome: OtpRequestOutcome;
  readonly resendAfterS: number | null;
  readonly expiresInS: number | null;
  readonly lockedForS: number | null;
}

export interface OtpVerifyResult {
  readonly outcome: OtpVerifyOutcome;
  readonly attemptsLeft: number | null;
  readonly lockedForS: number | null;
}

/** État du téléphone de la personne de la session (`null` : session invalide). */
export interface PhoneState {
  readonly verifiedPhone: string | null;
  readonly pendingPhone: string | null;
  readonly resendAfterS: number | null;
  readonly expiresInS: number | null;
  readonly lockedForS: number | null;
  readonly attemptsLeft: number | null;
}

export interface PhoneOtpStore {
  state(tokenHash: Buffer): Promise<PhoneState | null>;
  /** Défi sans code + `iam.otp.requested` (SENT), ou un refus sans écriture. */
  request(tokenHash: Buffer, phoneE164: string, country: string): Promise<OtpRequestResult>;
  /** Saisie : empreintes du code (1 à 2). */
  verify(tokenHash: Buffer, codeHashes: readonly Buffer[]): Promise<OtpVerifyResult>;
}

/** Aucun magasin : tout appel échoue (l'API rend OTP_UNAVAILABLE). */
export class UnavailablePhoneOtpStore implements PhoneOtpStore {
  state(): Promise<PhoneState | null> {
    return Promise.reject(new AuthStoreError('phone_state', undefined));
  }
  request(): Promise<OtpRequestResult> {
    return Promise.reject(new AuthStoreError('phone_otp_request', undefined));
  }
  verify(): Promise<OtpVerifyResult> {
    return Promise.reject(new AuthStoreError('phone_otp_verify', undefined));
  }
}

const int = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
};

export class PgPhoneOtpStore implements PhoneOtpStore {
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
      const { code } = error as { code?: unknown };
      throw new AuthStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async state(tokenHash: Buffer): Promise<PhoneState | null> {
    const rows = await this.#run<Record<string, unknown>>(
      'phone_state',
      `SELECT outcome, verified_phone, pending_phone, resend_after_s, expires_in_s, locked_for_s,
              attempts_left
         FROM core.iam_phone_otp_state($1)`,
      [tokenHash],
    );
    const row = rows[0];
    if (row === undefined) throw new AuthStoreError('phone_state', undefined);
    if (row['outcome'] === 'AUTH_REQUIRED') return null;
    if (row['outcome'] !== 'OK') throw new AuthStoreError('phone_state', undefined);
    const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      verifiedPhone: text(row['verified_phone']),
      pendingPhone: text(row['pending_phone']),
      resendAfterS: int(row['resend_after_s']),
      expiresInS: int(row['expires_in_s']),
      lockedForS: int(row['locked_for_s']),
      attemptsLeft: int(row['attempts_left']),
    };
  }

  async request(tokenHash: Buffer, phoneE164: string, country: string): Promise<OtpRequestResult> {
    const rows = await this.#run<Record<string, unknown>>(
      'phone_otp_request',
      `SELECT outcome, resend_after_s, expires_in_s, locked_for_s
         FROM core.iam_cmd_phone_otp_request($1, $2, $3)`,
      [tokenHash, phoneE164, country],
    );
    const row = rows[0];
    // issue inconnue de la commande : jamais interprétée comme un succès (fail-closed)
    if (!row || !(OTP_REQUEST_OUTCOMES as readonly unknown[]).includes(row['outcome'])) {
      throw new AuthStoreError('phone_otp_request', undefined);
    }
    return {
      outcome: row['outcome'] as OtpRequestOutcome,
      resendAfterS: int(row['resend_after_s']),
      expiresInS: int(row['expires_in_s']),
      lockedForS: int(row['locked_for_s']),
    };
  }

  async verify(tokenHash: Buffer, codeHashes: readonly Buffer[]): Promise<OtpVerifyResult> {
    const rows = await this.#run<Record<string, unknown>>(
      'phone_otp_verify',
      'SELECT outcome, attempts_left, locked_for_s FROM core.iam_cmd_phone_otp_verify($1, $2::bytea[])',
      [tokenHash, [...codeHashes]],
    );
    const row = rows[0];
    if (!row || !(OTP_VERIFY_OUTCOMES as readonly unknown[]).includes(row['outcome'])) {
      throw new AuthStoreError('phone_otp_verify', undefined);
    }
    return {
      outcome: row['outcome'] as OtpVerifyOutcome,
      attemptsLeft: int(row['attempts_left']),
      lockedForS: int(row['locked_for_s']),
    };
  }
}
