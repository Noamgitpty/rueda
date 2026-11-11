/**
 * En-têtes de sécurité de l'application voyageur et hôte (US-121, ADR-095 ; mêmes principes que
 * le back-office, revue sécurité US-012). Les textes éditables (blocs de contenu) passent par un
 * arbre fermé rendu en éléments React : la CSP est la DEUXIÈME ligne de défense contre une
 * injection, pas la première.
 *
 * - Rien d'une autre origine : scripts, styles, images, polices, connexions, travailleurs et
 *   manifeste viennent de l'application (`'self'`) ; aucun `<object>`, aucune balise `<base>`,
 *   formulaires vers l'application seulement, jamais en cadre.
 * - `'unsafe-inline'` reste nécessaire aux scripts d'amorçage de Next et à la feuille de thème
 *   injectée (`theme.tsx`), faute de nonce (PROPOSÉ : nonce par requête avec un middleware, comme
 *   pour le back-office). `'unsafe-eval'` et la connexion du rechargement à chaud (`ws:`) ne sont
 *   accordés qu'en développement.
 * - `data:` et `blob:` en image : logo du thème en `data:` (US-048), photos capturées dans la page
 *   (canevas, `device/camera-capture.web.ts`).
 * - Caméra et position : la page elle-même seulement (comptoir et check-in, 17 §6.2) ; micro :
 *   jamais.
 */
export interface SecurityHeader {
  readonly key: string;
  readonly value: string;
}

export function contentSecurityPolicy(production: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${production ? '' : ' ws:'}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(production: boolean): readonly SecurityHeader[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(production) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
  ];
}
