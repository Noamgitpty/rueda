// Point d'entrée public du module AVL. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, avl.module.ts) est privé (règle rueda/module-boundaries).
export { AvlModule } from './avl.module.js';

// Oracle de production C12 (US-025, ADR-068) : tâche périodique du travailleur booking_oracle.
export {
  BOOKING_ORACLE_WORKER,
  C12_CHECKS,
  oracleLogLine,
  parseOracleReport,
  PRODUCTION_ORACLE_PERIOD_SECONDS,
  ProductionOracleContractError,
  registerProductionOracle,
  runProductionOracle,
} from './internal/production-oracle.js';
export type { C12Check, ProductionOracleReport } from './internal/production-oracle.js';
