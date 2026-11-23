/**
 * Preuve d'ouverture de session (US-410, F-RLS-03, migration 0185, ADR-205).
 *
 * `core.iam_cmd_open_session` n'ouvre une session que sur une preuve HMAC-SHA-256 calculée ici,
 * après la vérification du mot de passe, sous une clé tenue par l'API (`RUEDA_SESSION_OPEN_KEY`,
 * secret géré, docs/ops/ENV_VARS.md ; jamais journalisée). La base la recalcule avec la clé de
 * `core.iam_session_open_key`, qu'aucun rôle applicatif ne lit : du SQL arbitraire sous app_api ne
 * peut pas signer, donc pas ouvrir une session pour un compte de son choix.
 *
 * Message v1 : UTF-8('rueda-session-open-v1') ‖ UUID de session (16) ‖ UUID du compte (16) ‖
 * empreinte du jeton (32) ‖ durée (int4 BE) ‖ instant d'émission (ms de `platform.now()`, int8 BE).
 * La base refuse une preuve émise plus de 60 s avant l'appel, et tout rejeu (session ou jeton déjà
 * vus).
 */
import { createHmac } from 'node:crypto';

export const SESSION_OPEN_PROOF_CONTEXT = 'rueda-session-open-v1';
/** Longueur admise de la clé (octets), comme la contrainte de la table. */
export const SESSION_OPEN_KEY_MIN_BYTES = 32;
export const SESSION_OPEN_KEY_MAX_BYTES = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionOpenFields {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly ttlS: number;
  readonly issuedAtMs: bigint;
}

export function sessionOpenMessage(f: SessionOpenFields): Buffer {
  if (f.tokenHash.length !== 32) throw new Error('empreinte de jeton : 32 octets attendus');
  if (!UUID.test(f.sessionId)) throw new Error('session : UUID attendu');
  if (!UUID.test(f.userId)) throw new Error('compte : UUID attendu');
  if (!Number.isInteger(f.ttlS) || f.ttlS < 0 || f.ttlS > 0x7fffffff) {
    throw new Error('durée : entier positif sur 32 bits attendu');
  }
  const ttl = Buffer.alloc(4);
  ttl.writeInt32BE(f.ttlS);
  const at = Buffer.alloc(8);
  at.writeBigInt64BE(f.issuedAtMs);
  return Buffer.concat([
    Buffer.from(SESSION_OPEN_PROOF_CONTEXT, 'utf8'),
    Buffer.from(f.sessionId.replace(/-/g, ''), 'hex'),
    Buffer.from(f.userId.replace(/-/g, ''), 'hex'),
    f.tokenHash,
    ttl,
    at,
  ]);
}

export function sessionOpenProof(key: Buffer, f: SessionOpenFields): Buffer {
  return createHmac('sha256', key).update(sessionOpenMessage(f)).digest();
}

/**
 * Clé lue dans l'environnement (hexadécimal, 32 à 64 octets). Absente : `null` (aucune session
 * ouverte, fail-closed). Présente mais mal formée : erreur au démarrage (sans afficher la valeur).
 */
export function parseSessionOpenKey(raw: string | undefined): Buffer | null {
  if (raw === undefined || raw === '') return null;
  const ok =
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= SESSION_OPEN_KEY_MIN_BYTES &&
    raw.length / 2 <= SESSION_OPEN_KEY_MAX_BYTES;
  if (!ok) {
    throw new Error(
      `RUEDA_SESSION_OPEN_KEY : ${SESSION_OPEN_KEY_MIN_BYTES} à ${SESSION_OPEN_KEY_MAX_BYTES} octets en hexadécimal attendus`,
    );
  }
  return Buffer.from(raw, 'hex');
}

export function sessionOpenKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Buffer | null {
  return parseSessionOpenKey(env['RUEDA_SESSION_OPEN_KEY']);
}
