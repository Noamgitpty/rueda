import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers.ts';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Métadonnées jamais en flux (US-208, titre de S05) : Next 16 les diffuse par défaut dans une
  // frontière Suspense à part ; lors d'une navigation côté client (redirection d'une action
  // serveur, S03 → S05 → hold), l'ancien `<title>` part avec l'ancien écran et le nouveau peut
  // n'arriver que ~300 ms plus tard (révélation différée de React) : la page reste un moment sans
  // titre (WCAG 2.4.2). `/.*/` traite chaque agent comme un « robot limité » : `generateMetadata`
  // est attendu avant le shell (titre dans le `<head>` du rendu serveur) et, en navigation,
  // l'écran et son titre sont posés dans le même commit. Coût négligeable : chaque
  // `generateMetadata` du site ne lit que la langue de la requête.
  htmlLimitedBots: /.*/,
  // Les paquets partagés sont publiés en TypeScript source (comme @rueda/db) : Next le transpile.
  transpilePackages: ['@rueda/i18n', '@rueda/design-tokens', '@rueda/ui'],
  // En-têtes de sécurité sur toutes les routes (US-121, ADR-095) : security-headers.ts.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [...securityHeaders(process.env['NODE_ENV'] === 'production')],
      },
    ]);
  },
};

export default nextConfig;
