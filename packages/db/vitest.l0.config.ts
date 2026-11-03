import { databaseSuite } from './vitest.shared.ts';

// pnpm test:l0 — preuves L0 (17 §11) sous les rôles de production.
export default databaseSuite(['test/l0/**/*.test.ts']);
