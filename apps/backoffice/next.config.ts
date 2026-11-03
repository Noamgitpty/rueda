import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers.ts';

/**
 * Mandataire de même origine vers l'API (US-012) : `/api/*` → `RUEDA_API_URL/*`. Le back-office vit
 * sur son propre domaine (17 §6.1) ; le cookie de session `__Host-session` posé par l'API à travers
 * ce mandataire reste lié à ce domaine, distinct de celui de l'application voyageur. Sans
 * `RUEDA_API_URL`, aucune réécriture : la console affiche l'écran de connexion et chaque appel
 * échoue (fail-closed). Variable documentée dans apps/backoffice/README.md.
 */
const apiUrl = process.env['RUEDA_API_URL'];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Les paquets partagés sont publiés en TypeScript source (comme @rueda/db) : Next le transpile.
  transpilePackages: ['@rueda/i18n', '@rueda/design-tokens', '@rueda/ui'],
  // En-têtes de sécurité sur toutes les routes (revue sécurité US-012) : security-headers.ts.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [...securityHeaders(process.env['NODE_ENV'] === 'production')],
      },
    ]);
  },
  rewrites() {
    return Promise.resolve(
      apiUrl ? [{ source: '/api/:path*', destination: `${apiUrl.replace(/\/$/, '')}/:path*` }] : [],
    );
  },
};

export default nextConfig;
