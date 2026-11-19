/**
 * Mode sur demande d'un pays (US-223, ouverture du mode, ADR-175 ; BOARD N-246) tel que l'API le
 * rend (`requestMode` de `GET /listings/{id}` et du devis `GET /checkout/quotes/{id}`, lu en base par
 * `core.catalog_public_request_terms`, 0154). Lecture FAIL-CLOSED : le mode n'est ouvert que si la
 * réponse dit `enabled: true` avec un délai entier ≥ 1 ; absent (API N-1), mal formé ou fermé ⇒
 * `null`, et l'écran garde le bandeau `common.checkout.requestModeUnavailable` (19 US-223 DoR 2).
 * Le site ne déduit jamais le mode du seul `instantBook` de l'annonce.
 */

/** Délai de réponse de l'hôte en heures si le mode est ouvert dans le pays, sinon `null`. */
export function requestHoursOf(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const hours = v['expiryHours'];
  return v['enabled'] === true &&
    typeof hours === 'number' &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= 720
    ? hours
    : null;
}
