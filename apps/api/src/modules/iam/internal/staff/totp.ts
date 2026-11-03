/**
 * TOTP du staff (US-012 ; 16 ADM-001 « 2FA TOTP obligatoire pour tout rôle interne »).
 * RFC 4226 (HOTP) et RFC 6238 (TOTP) : HMAC-SHA-1, 6 chiffres, pas de 30 s, fenêtre ±1 pas
 * (paramètres PROPOSÉS, compatibles avec les applications d'authentification courantes ; ADR-062).
 * Base32 sans remplissage (RFC 4648) pour l'URI `otpauth://`.
 *
 * Fonctions pures, sans état : le secret vient du coffre (port `TotpSecretVault`), le pas reconnu
 * est jugé une seconde fois par la base (fenêtre à l'horloge `platform.now()`, anti-rejeu).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
/** Secret de 160 bits (RFC 4226 §4 : au moins 128, 160 recommandés). */
export const TOTP_SECRET_BYTES = 20;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Décodage tolérant (casse, espaces, `=`) ; `null` si un caractère est hors alphabet. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226 §5.3) : troncature dynamique de HMAC-SHA-1(secret, compteur sur 8 octets). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Pas TOTP (RFC 6238 §4.2) : T = floor(unix / 30). */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
}

/** Code saisi normalisé (chiffres seulement, espaces tolérés) ; `null` s'il est mal formé. */
export function normalizeTotpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.replace(/\s/g, '');
  return new RegExp(`^[0-9]{${TOTP_DIGITS}}$`).test(code) ? code : null;
}

/**
 * Pas reconnu pour `code` dans la fenêtre ±1 autour de `nowMs`, strictement après `lastUsedStep`
 * (un pas déjà consommé n'est jamais rendu : anti-rejeu, revérifié par la base) ; `null` sinon.
 * Comparaison à temps constant ; toutes les candidates sont calculées.
 */
export function matchTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): number | null {
  const now = totpStep(nowMs);
  const given = Buffer.from(code, 'utf8');
  let found: number | null = null;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = now + delta;
    const expected = Buffer.from(hotp(secret, step), 'utf8');
    const same = expected.length === given.length && timingSafeEqual(expected, given);
    if (same && (lastUsedStep === null || step > lastUsedStep) && found === null) found = step;
  }
  return found;
}

/** URI d'enrôlement (format « Key Uri » des applications d'authentification). */
export function otpauthUri(input: {
  readonly issuer: string;
  readonly account: string;
  readonly secret: Buffer;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
