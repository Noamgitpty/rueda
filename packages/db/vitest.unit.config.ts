import { defineConfig } from 'vitest/config';

// pnpm test:unit — sans base de données : schemas.test.ts (US-001), src/** et les aides pures de test/support (US-007).
export default defineConfig({
  test: {
    include: ['*.test.ts', 'src/**/*.test.ts', 'test/support/**/*.test.ts'],
  },
});
