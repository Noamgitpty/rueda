/**
 * Adaptateurs de PRODUCTION de la console interne (US-012). Aucune option ne permet d'y brancher
 * un FAKE : le coffre TOTP est `UnavailableTotpVault` tant que le coffre géré (US-003) n'existe
 * pas ; la clé de preuve vient de `RUEDA_STAFF_MFA_PROOF_KEY` (secret géré, docs/ops/ENV_VARS.md),
 * absente => aucune élévation. Les deux défauts sont fail-closed : aucun pouvoir de staff.
 */
import type { SqlExecutor } from '../pg-auth-store.js';
import { parseMfaProofKey } from './mfa-proof.js';
import { UnavailableTotpVault } from './secret-vault.js';
import type { StaffOptions } from './staff.service.js';
import { PgStaffStore } from './staff-store.js';

export function postgresStaffAdapters(
  db: SqlExecutor,
  env: Readonly<Record<string, string | undefined>>,
  issuer: string,
): StaffOptions {
  return {
    store: new PgStaffStore(db),
    vault: new UnavailableTotpVault(),
    proofKey: parseMfaProofKey(env['RUEDA_STAFF_MFA_PROOF_KEY']),
    issuer,
  };
}
