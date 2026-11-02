import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Le paquet partagé est publié en TypeScript source (comme @rueda/db) : Next le transpile.
  transpilePackages: ['@rueda/i18n'],
};

export default nextConfig;
