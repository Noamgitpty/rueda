import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Les paquets partagés sont publiés en TypeScript source (comme @rueda/db) : Next le transpile.
  transpilePackages: ['@rueda/i18n', '@rueda/design-tokens'],
};

export default nextConfig;
