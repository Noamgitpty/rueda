/**
 * Port de persistance de l'authentification (adaptateur interne, ADR-021 défaut, ADR-052).
 *
 * Deux implémentations :
 * - `PgAuthStore` (production) : commandes `core.iam_*` (migration 0011) sous `app_api` ;
 * - `FakeAuthStore` (`../testing/`, TESTS SEULEMENT, exclu de la compilation de production).
 * Le contrat commun est vérifié par `../testing/auth-store-contract.ts` sur les deux.
 *
 * Les sessions sont désignées par l'empreinte SHA-256 du jeton (`tokenHash`), jamais par le jeton.
 */

export type AccountStatus = 'PENDING_EMAIL' | 'ACTIVE' | 'RESTRICTED' | 'CLOSED' | 'BANNED';
export type MfaLevel = 'NONE' | 'OTP' | 'TOTP';
/** Motifs de révocation que l'API peut écrire (les autres : console interne, US-012). */
export type ApiRevocationReason = 'LOGOUT' | 'ROTATED';

export interface RegisterAccountInput {
  readonly userId: string;
  /** Normalisé (trim, minuscules). */
  readonly email: string;
  /** Chaîne PHC argon2id. */
  readonly passwordHash: string;
  readonly legalFirstName: string;
  readonly legalLastName: string;
  readonly preferredLocale: string;
  readonly verificationId: string;
  readonly verificationTokenHash: Buffer;
  readonly verificationTtlS: number;
  readonly ip: string | null;
}

export interface Credentials {
  readonly userId: string;
  readonly passwordHash: string | null;
  readonly status: AccountStatus;
}

export interface OpenSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly ttlS: number;
  readonly mfaLevel: MfaLevel;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly mfaLevel: MfaLevel;
  readonly expiresAt: Date;
  /** Email vérifié : exigé pour les actions sensibles (réserver, publier), comme chez Turo. */
  readonly emailVerified: boolean;
}

export interface AuthStore {
  /** `false` si l'email est déjà pris (aucune écriture). */
  registerAccount(input: RegisterAccountInput): Promise<boolean>;
  /** `true` si un lien valide a été consommé ; révoque alors les sessions antérieures. */
  verifyEmail(tokenHash: Buffer): Promise<boolean>;
  findCredentials(email: string): Promise<Credentials | null>;
  /** Échéance de la session, ou `null` si le compte ne peut pas se connecter. */
  openSession(input: OpenSessionInput): Promise<Date | null>;
  /** Session ni révoquée ni expirée (horloge de la base), compte actif ; sinon `null`. */
  resolveSession(tokenHash: Buffer): Promise<SessionRecord | null>;
  revokeSession(tokenHash: Buffer, reason: ApiRevocationReason): Promise<boolean>;
  /** Révoque toutes les sessions du titulaire d'une session valide ; nombre révoqué. */
  revokeAllSessions(tokenHash: Buffer): Promise<number>;
}
