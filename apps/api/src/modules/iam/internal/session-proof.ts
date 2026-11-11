/**
 * Preuve de possession de la session d'une requête (US-102) : SHA-256 du jeton du cookie
 * `__Host-session`, jamais le jeton. Les commandes en base des autres modules (CTR : consentements)
 * désignent le titulaire par cette empreinte, comme les commandes `core.iam_*` : aucun identifiant
 * de personne n'est reçu du client ni de l'appelant (17 §2.3 « Limite de la RLS »).
 *
 * `null` si le cookie est absent, mal formé ou ambigu. À n'appeler qu'APRÈS `SessionGuard` (la
 * session est alors vivante) ; la base revérifie de toute façon la session.
 */
import { readSessionToken } from './cookies.js';
import type { HttpRequest } from './http.js';
import { tokenHash } from './session-token.js';

export function sessionProofOf(request: Pick<HttpRequest, 'headers'>): Buffer | null {
  const token = readSessionToken(request.headers['cookie']);
  return token === null ? null : tokenHash(token);
}
