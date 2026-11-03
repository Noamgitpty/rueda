import { defineConfig } from 'vitest/config';

// pnpm test:unit — sans base de données : schemas.test.ts (US-001) et src/**.
export default defineConfig({
  test: {
    include: ['*.test.ts', 'src/**/*.test.ts'],
  },
});
