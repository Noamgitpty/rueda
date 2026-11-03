import { defineConfig } from 'vitest/config';

// Rendu serveur (`react-dom/server`) puis analyse dans un DOM jsdom créé par le test : pas
// d'environnement de navigateur global. Les modules CSS gardent des noms lisibles.
export default defineConfig({
  css: { modules: { generateScopedName: 'ui-[local]' } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    css: { include: [/\.module\.css$/] },
    testTimeout: 30000,
  },
});
