/**
 * Jetons opaques (session, lien de vérification d'email) : 32 octets aléatoires (256 bits,
 * `crypto.randomBytes`), transmis en base64url (43 caractères). La base ne stocke que le SHA-256
 * du jeton (17 §3.1.4 C4) : une fuite de la base ne permet pas d'usurper une session.
 *
 * Un jeton n'est JAMAIS journalisé, ni placé dans une erreur, une URL de l'API ou un événement.
 */
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 32;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Nouveau jeton opaque. */
export function newOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Le texte a la forme d'un jeton émis par nous (sinon : traité comme absent, sans requête). */
export function isWellFormedToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && TOKEN_FORMAT.test(value);
}

/** Empreinte stockée : SHA-256 du texte du jeton (UTF-8), 32 octets. */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
