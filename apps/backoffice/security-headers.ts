/**
 * En-têtes de sécurité du back-office (revue sécurité US-012, constat 14) : la console interne
 * ne se met jamais en cadre (détournement de clic), ne charge rien d'une autre origine, ne fuit
 * pas son adresse et n'est servie qu'en HTTPS.
 *
 * CSP : tout vient de la même origine. `'unsafe-inline'` reste nécessaire aux scripts
 * d'amorçage de Next et à la feuille de thème injectée (`theme.tsx`), faute de nonce (PROPOSÉ :
 * nonce par requête quand un middleware sera ajouté). `'unsafe-eval'` n'est accordé qu'en
 * développement (rechargement à chaud). Les appels à l'API passent par le mandataire `/api/*` de
 * même origine (`connect-src 'self'`).
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
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
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
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}
