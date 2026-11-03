/**
 * Politique d'authentification : valeurs PROPOSÉES (ADR-052), à inscrire au registre des
 * paramètres (17 §7.2) quand CFG le portera (US-008). Aucune n'est propre à un pays.
 *
 * Bornes dures appliquées EN PLUS par la base (migration 0011) : session de 300 s à 30 j, 8 h
 * pour un compte qui a un rôle interne (17 §3.2.1) ; lien de vérification de 300 s à 7 j.
 */
export interface AuthPolicy {
  /** Durée absolue d'une session (s). PROPOSÉ : 14 j. */
  readonly sessionTtlS: number;
  /** Durée du lien de vérification d'email (s). 16 ACC-001 : 24 h, PROPOSÉ. */
  readonly emailVerificationTtlS: number;
  /** Longueur minimale du mot de passe (caractères). 16 ACC-001 : ≥ 10, PROPOSÉ. */
  readonly passwordMinLength: number;
  /** Longueur maximale (octets UTF-8) : borne le coût d'un hachage. PROPOSÉ : 1 024. */
  readonly passwordMaxBytes: number;
  /** Échecs de connexion tolérés par email sur la fenêtre. PROPOSÉ : 10 / 15 min. */
  readonly loginFailuresPerEmail: number;
  /** Échecs de connexion tolérés par adresse IP sur la fenêtre. PROPOSÉ : 100 / 15 min. */
  readonly loginFailuresPerIp: number;
  readonly loginWindowMs: number;
  /** Inscriptions par adresse IP sur la fenêtre. PROPOSÉ : 20 / h. */
  readonly signupsPerIp: number;
  readonly signupWindowMs: number;
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  sessionTtlS: 14 * 24 * 3600,
  emailVerificationTtlS: 24 * 3600,
  passwordMinLength: 10,
  passwordMaxBytes: 1024,
  loginFailuresPerEmail: 10,
  loginFailuresPerIp: 100,
  loginWindowMs: 15 * 60_000,
  signupsPerIp: 20,
  signupWindowMs: 60 * 60_000,
};
