import { defineConfig } from 'vitest/config';

// Les FAKE refusent de se construire hors développement et test (src/guard.ts) : la suite déclare
// explicitement son environnement.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { RUEDA_ENV: 'test' },
  },
});
