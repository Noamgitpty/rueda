/**
 * Port du coffre des secrets TOTP du staff (17 §3.2.1 : `auth_factor.secret_ref` est une
 * RÉFÉRENCE au coffre / KMS, jamais le secret ; 17 §5 ports). US-012, ADR-062.
 *
 * Adaptateurs :
 * - `UnavailableTotpVault` (production, en attendant le coffre géré d'US-003) : refuse tout. Aucun
 *   TOTP ne peut être créé ni vérifié, donc aucun membre du staff n'est élevé : fail-closed
 *   (« une capacité inconnue vaut non ») ;
 * - `FakeTotpSecretVault` (`../../testing/`, TESTS SEULEMENT, exclu de la compilation de
 *   production) : mémoire du processus, références `fake-vault:<uuid>`.
 */

export interface TotpSecretVault {
  /** Range un secret neuf ; rend sa référence (format de `auth_factor_secret_ref_format`). */
  store(secret: Buffer): Promise<string>;
  /** Secret d'une référence, ou `null` si elle est inconnue. */
  resolve(ref: string): Promise<Buffer | null>;
}

export class TotpVaultUnavailableError extends Error {
  override readonly name = 'TotpVaultUnavailableError';
}

export class UnavailableTotpVault implements TotpSecretVault {
  store(): Promise<string> {
    return Promise.reject(new TotpVaultUnavailableError('coffre TOTP non configuré (US-003)'));
  }

  resolve(): Promise<Buffer | null> {
    return Promise.reject(new TotpVaultUnavailableError('coffre TOTP non configuré (US-003)'));
  }
}
