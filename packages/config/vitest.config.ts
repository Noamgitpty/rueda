import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Fixtures lintées par les tests (dont un faux fichier de test) : jamais exécutées.
    exclude: ['test/fixtures/**', '**/node_modules/**'],
    // Les tests lancent ESLint avec la configuration réelle : premier chargement lent sous Windows.
    testTimeout: 60_000,
  },
});
