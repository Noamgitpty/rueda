import { defineConfig } from 'vitest/config';

// pnpm test:unit — sans base de données.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
