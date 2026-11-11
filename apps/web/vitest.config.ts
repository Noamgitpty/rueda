import { defineConfig } from 'vitest/config';

// Logique pure seulement (environnement Node, WebCrypto natif) : les API d'appareil (caméra,
// IndexedDB, géolocalisation réelles) se testent sur téléphone (docs/qa/US-026-protocole-pwa-ios.md).
export default defineConfig({
  test: {
    include: [
      'device/**/*.test.ts',
      'account/**/*.test.ts',
      'app/**/*.test.{ts,tsx}',
      'pwa/**/*.test.{ts,tsx}',
      '*.test.ts',
    ],
    environment: 'node',
  },
});
