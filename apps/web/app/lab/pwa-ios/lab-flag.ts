/**
 * Drapeau du laboratoire PWA iOS (US-026). **Désactivé par défaut** : la page, le manifeste, le
 * service worker et les icônes répondent 404 tant que la variable ne vaut pas exactement `true`.
 * Lu à chaque requête côté serveur (jamais `NEXT_PUBLIC_*`, donc jamais figé dans le bundle).
 * Ne jamais la définir en production (voir apps/web/README.md).
 */
export const LAB_PWA_IOS_FLAG = 'WEB_LAB_PWA_IOS_ENABLED';

export function isPwaIosLabEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[LAB_PWA_IOS_FLAG] === 'true';
}

/** Préfixe des URL du laboratoire : portée du manifeste et du service worker. */
export const LAB_BASE_PATH = '/lab/pwa-ios';

export function labNotFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
