import { defineConfig } from 'vitest/config';

/** US-042 : comparaison aux oracles Python (`pnpm --filter @rueda/money test:oracle`). */
export default defineConfig({
  test: {
    include: ['test/oracle/**/*.oracle.ts'],
    testTimeout: 600_000,
  },
});
