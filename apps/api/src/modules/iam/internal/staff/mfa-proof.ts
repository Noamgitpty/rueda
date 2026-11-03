/**
 * Preuve d'élévation MFA (US-012, ADR-062) : l'API, seule à connaître le secret TOTP (coffre),
 * prouve à la base qu'elle a vérifié le code du pas `step` pour CETTE session et CE facteur.
 *
 *   preuve = HMAC-SHA-256(clé, UTF-8("rueda-staff-mfa-v1") ‖ SHA-256(jeton) ‖ UUID(16) ‖ pas(int8 BE))
 *
 * La base recalcule la même valeur (core.iam_mfa_proof, migration 0031) avec la clé de
 * `core.iam_mfa_proof_key`, qu'aucun rôle applicatif ne lit : du SQL arbitraire sous app_api ne peut
 * pas fabriquer une session élevée (RLS-18 réduite). La clé est un secret géré hors dépôt
 * (`RUEDA_STAFF_MFA_PROOF_KEY`, docs/ops/ENV_VARS.md) ; jamais journalisée.
 */
import { createHmac } from 'node:crypto';

export const MFA_PROOF_CONTEXT = 'rueda-staff-mfa-v1';
/** Longueur admise de la clé (octets), comme la contrainte de la table. */
export const MFA_PROOF_KEY_MIN_BYTES = 32;
export const MFA_PROOF_KEY_MAX_BYTES = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mfaProofMessage(tokenHash: Buffer, factorId: string, step: number): Buffer {
  if (tokenHash.length !== 32) throw new Error('empreinte de jeton : 32 octets attendus');
  if (!UUID.test(factorId)) throw new Error('facteur : UUID attendu');
  const s = Buffer.alloc(8);
  s.writeBigInt64BE(BigInt(step));
  return Buffer.concat([
    Buffer.from(MFA_PROOF_CONTEXT, 'utf8'),
    tokenHash,
    Buffer.from(factorId.replace(/-/g, ''), 'hex'),
    s,
  ]);
}

export function mfaProof(key: Buffer, tokenHash: Buffer, factorId: string, step: number): Buffer {
  return createHmac('sha256', key)
    .update(mfaProofMessage(tokenHash, factorId, step))
    .digest();
}

/**
 * Clé lue dans l'environnement (hexadécimal, 32 à 64 octets). Absente : `null` (aucune élévation
 * possible, fail-closed). Présente mais mal formée : erreur au démarrage (sans afficher la valeur).
 */
export function parseMfaProofKey(raw: string | undefined): Buffer | null {
  if (raw === undefined || raw === '') return null;
  const ok =
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= MFA_PROOF_KEY_MIN_BYTES &&
    raw.length / 2 <= MFA_PROOF_KEY_MAX_BYTES;
  if (!ok) {
    throw new Error(
      `RUEDA_STAFF_MFA_PROOF_KEY : ${MFA_PROOF_KEY_MIN_BYTES} à ${MFA_PROOF_KEY_MAX_BYTES} octets en hexadécimal attendus`,
    );
  }
  return Buffer.from(raw, 'hex');
}
