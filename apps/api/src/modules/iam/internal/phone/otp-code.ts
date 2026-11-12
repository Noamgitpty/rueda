/**
 * Code à usage unique du téléphone (US-104, ADR-098 ; 16 VER-013 « code 6 chiffres » ; 17 §6.6) :
 *
 * - TIRAGE par le générateur cryptographique du système (`crypto.randomInt`, CSPRNG, loi
 *   uniforme sur 000000–999999), au travailleur `iam_otp_sender` seulement ;
 * - EMPREINTE HMAC-SHA-256 sous la clé `RUEDA_OTP_KEY` (secret géré, 32 à 64 octets en
 *   hexadécimal, la même pour l'API qui vérifie et le travailleur qui émet ; jamais commitée,
 *   jamais journalisée ; docs/ops/ENV_VARS.md). La base ne reçoit que l'empreinte : une copie de
 *   la base, sans la clé, ne permet pas de retrouver un code par force brute (10^6 codes) ;
 * - message de l'empreinte : `rueda-otp-v1` NUL code (séparation de domaine).
 *
 * Clé ABSENTE : aucun code n'est émis ni vérifié (`OTP_UNAVAILABLE`, fail-closed), dans tous les
 * environnements : une clé aléatoire propre au processus ne conviendrait pas (l'API et le
 * travailleur sont deux processus). Clé MAL FORMÉE : refus de démarrer. Rotation : une nouvelle
 * clé invalide les codes en cours (10 min au plus) ; le voyageur demande un nouveau code.
 */
import { createHmac, randomInt } from 'node:crypto';

export const OTP_KEY_VAR = 'RUEDA_OTP_KEY';
export const OTP_KEY_MIN_BYTES = 32;
export const OTP_KEY_MAX_BYTES = 64;
/** 16 VER-013 : « code 6 chiffres » (17 §6.6). Longueur commune aux pays, pas un paramètre. */
export const OTP_CODE_DIGITS = 6;
const OTP_CODE = /^[0-9]{6}$/;
const DOMAIN = 'rueda-otp-v1';

/** Clé de `RUEDA_OTP_KEY` ; `null` si absente ; mal formée : erreur (refus de démarrer). */
export function parseOtpKey(raw: string | undefined): Buffer | null {
  if (raw === undefined || raw === '') return null;
  const ok =
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= OTP_KEY_MIN_BYTES &&
    raw.length / 2 <= OTP_KEY_MAX_BYTES;
  if (!ok) {
    throw new Error(
      `${OTP_KEY_VAR} : ${OTP_KEY_MIN_BYTES} à ${OTP_KEY_MAX_BYTES} octets en hexadécimal attendus`,
    );
  }
  return Buffer.from(raw, 'hex');
}

/** Code bien formé (6 chiffres ASCII). */
export function isOtpCode(value: unknown): value is string {
  return typeof value === 'string' && OTP_CODE.test(value);
}

/** Tirage d'un code (CSPRNG), zéros de tête compris. */
export function drawOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_DIGITS)).padStart(OTP_CODE_DIGITS, '0');
}

export class OtpCodeHasher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length < OTP_KEY_MIN_BYTES) throw new Error('clé OTP trop courte');
    this.#key = Buffer.from(key);
  }

  /** Empreinte de 32 octets d'un code de 6 chiffres. */
  hash(code: string): Buffer {
    if (!isOtpCode(code)) throw new Error('code OTP mal formé');
    return createHmac('sha256', this.#key).update(`${DOMAIN}\u0000${code}`, 'utf8').digest();
  }
}

/** Hacheur de la configuration, ou `null` (clé absente : OTP indisponible). */
export function otpHasherFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): OtpCodeHasher | null {
  const key = parseOtpKey(env[OTP_KEY_VAR]);
  return key === null ? null : new OtpCodeHasher(key);
}
