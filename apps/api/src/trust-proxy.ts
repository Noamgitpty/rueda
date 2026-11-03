/**
 * Réglage `trust proxy` d'Express (US-010, revue sécurité) : l'adresse IP du client sert au
 * limiteur de débit de l'authentification et au journal des sessions.
 *
 * `RUEDA_API_TRUST_PROXY` (docs/ops/ENV_VARS.md) :
 * - absente ou vide : `false` (défaut sûr) ; `X-Forwarded-For` est ignoré, l'IP est celle de la
 *   connexion, et un en-tête forgé ne contourne pas le plafond par IP ;
 * - entier de 1 à 10 : nombre de mandataires de confiance devant l'API (ex. `1` derrière un seul
 *   répartiteur) ;
 * - toute autre valeur (`true`, liste, sous-réseau…) : refus de démarrer (fail-closed).
 */
export function parseTrustProxy(value: string | undefined): false | number {
  if (value === undefined || value.trim() === '') return false;
  const v = value.trim();
  if (/^(?:[1-9]|10)$/.test(v)) return Number(v);
  throw new Error('RUEDA_API_TRUST_PROXY : entier de 1 à 10 attendu (ou variable absente)');
}
