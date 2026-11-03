/**
 * Cookie de session (17 §6.6 : sessions serveur, cookies `HttpOnly`, `Secure`, `SameSite=Lax`).
 *
 * - Préfixe `__Host-` : le navigateur l'exige `Secure`, `Path=/`, sans `Domain` ; un sous-domaine
 *   ne peut donc ni le poser ni l'écraser (parade au « cookie tossing », donc à la fixation).
 * - `HttpOnly` : illisible par le JavaScript de la page ; `SameSite=Lax` : pas envoyé sur un POST
 *   intersite (complété par l'exigence `Content-Type: application/json` des routes d'écriture).
 * - Aucun réglage pour retirer `Secure` : fail-closed, y compris en développement (les navigateurs
 *   acceptent `Secure` sur http://localhost).
 */
import { isWellFormedToken } from './session-token.js';

export const SESSION_COOKIE = '__Host-session';

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

/** En-tête `Set-Cookie` qui pose le jeton pour `maxAgeS` secondes (≥ 0, entier). */
export function sessionCookie(token: string, maxAgeS: number): string {
  if (!isWellFormedToken(token)) throw new Error('jeton de session mal formé');
  const maxAge = Math.max(0, Math.floor(maxAgeS));
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; ${ATTRIBUTES}`;
}

/** En-tête `Set-Cookie` qui efface le cookie de session. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;
}

/**
 * Jeton de session présenté par la requête (en-tête `Cookie`), ou `null` : absent, mal formé ou
 * présent plusieurs fois (ambigu ⇒ aucun, fail-closed).
 */
export function readSessionToken(cookieHeader: string | string[] | undefined): string | null {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (!header) return null;
  const values: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) values.push(part.slice(eq + 1).trim());
  }
  if (values.length !== 1) return null;
  const value = values[0];
  return isWellFormedToken(value) ? value : null;
}
