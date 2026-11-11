import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers.ts';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
