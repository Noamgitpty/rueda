import { defineConfig } from 'vitest/config';

// pnpm test:unit — sans base de données. Les *.int.test.ts tournent dans test:int (vitest.int.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', '**/node_modules/**'],
    testTimeout: 30_000,
    // les adaptateurs FAKE (US-019) refusent de se construire hors development / test (C19)
    env: { RUEDA_ENV: 'test' },
  },
});
