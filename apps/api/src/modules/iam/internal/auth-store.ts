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

/** Version d'un document juridique AFFICHÉE et acceptée à l'inscription (US-102). */
export interface AcceptedDocument {
  readonly kind: 'TOS_GUEST' | 'PRIVACY';
  readonly version: number;
}

/**
 * Refus des consentements à l'inscription (US-102, commande 0059) : version affichée périmée,
 * aucun document en vigueur (fail-closed) ou liste mal formée. Jamais de donnée personnelle.
 */
export class SignupDocumentsError extends Error {
  override readonly name = 'SignupDocumentsError';
  constructor(readonly reason: 'VERSION_CHANGED' | 'UNAVAILABLE' | 'INVALID' | 'COUNTRY_UNKNOWN') {
    super(`IAM : consentements refusés (${reason})`);
  }
}

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
  /**
   * Consentements (US-102) : pays du parcours (portée des documents ; absent = documents communs),
   * versions affichées (OBLIGATOIRES : absentes, refus `VERSION_CHANGED`) et opt-in des communications (non pré-coché,
   * défaut `false`). La base refuse tout compte sans CGU ni confidentialité acceptées.
   */
  readonly country?: string | null;
  readonly documents?: readonly AcceptedDocument[] | null;
  readonly marketingOptIn?: boolean;
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

/**
 * Issues de l'ouverture d'un compte d'hôte (US-107, commande `core.iam_cmd_open_host_account`,
 * migration 0061) : `DONE` ou un refus métier (rien n'est écrit). Codes de 16 A.8 quand ils existent
 * (`HOST_ENTITY_NOT_ALLOWED`, `HOST_UNDER_AGE`, `PARAM_MISSING`, `COUNTRY_UNKNOWN`) ; PROPOSÉS :
 * `HOST_ACCOUNT_EXISTS`, `HOST_ACCOUNT_NOT_ELIGIBLE`.
 */
export const HOST_ACCOUNT_OUTCOMES = [
  'DONE',
  'AUTH_REQUIRED',
  'HOST_ENTITY_NOT_ALLOWED',
  'COUNTRY_UNKNOWN',
  'HOST_ACCOUNT_NOT_ELIGIBLE',
  'PARAM_MISSING',
  'HOST_UNDER_AGE',
  'HOST_ACCOUNT_EXISTS',
] as const;
export type HostAccountOutcome = (typeof HOST_ACCOUNT_OUTCOMES)[number];

/** Déclaration du demandeur : seule une personne physique est acceptée (DEC-FONDATEUR-13). */
export type HolderKind = 'INDIVIDUAL' | 'LEGAL_ENTITY';

/** Compte d'hôte dont la personne de la session est titulaire (17 §3.2.1, US-107). */
export interface HostAccount {
  readonly orgId: string;
  readonly country: string;
  /** Rôle de la personne sur ce compte : `P2P_HOST` (titulaire). */
  readonly role: 'P2P_HOST';
  /** `organization.status` (`ONBOARDING`, `PENDING_ACTIVATION`, `ACTIVE`, …). */
  readonly status: string;
  /** Nom affiché aux voyageurs : le prénom du titulaire [C2], jamais une raison sociale. */
  readonly displayName: string;
}

export interface AuthStore {
  /**
   * `false` si l'email est déjà pris (aucune écriture). Enregistre les consentements dans la même
   * transaction ; `SignupDocumentsError` si les versions sont refusées (contrôlé avant l'email).
   */
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
  /**
   * Ouvre le compte d'hôte de la personne de la session dans `country` (US-107) : organisation
   * `ONBOARDING` et appartenance `P2P_HOST` titulaire, ou un refus métier sans écriture.
   */
  openHostAccount(
    tokenHash: Buffer,
    country: string,
    holderKind: HolderKind,
  ): Promise<{ readonly outcome: HostAccountOutcome; readonly orgId: string | null }>;
  /** Comptes d'hôte dont la personne de la session est titulaire (session invalide : aucun). */
  hostAccounts(tokenHash: Buffer): Promise<HostAccount[]>;
}
