import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Les tests lancent ESLint avec la configuration réelle : premier chargement lent sous Windows.
    testTimeout: 60_000,
  },
});
