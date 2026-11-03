import { databaseSuite } from './vitest.shared.ts';

// pnpm test:int — tests d'intégration du banc et des migrations sur PostgreSQL réel.
export default databaseSuite(['test/int/**/*.test.ts']);
