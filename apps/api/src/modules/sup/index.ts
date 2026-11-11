// Point d'entrée public du module SUP. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, sup.module.ts) est privé (règle rueda/module-boundaries).
export { SupModule } from './sup.module.js';

// Actions de console (US-012, US-101) : montage par le processus API seulement (api.module.ts).
export { SupConsoleModule } from './internal/sup-console.module.js';
export type { SupConsoleOptions } from './internal/sup-console.module.js';
export { PgManualActionStore } from './internal/manual-action-store.js';
export type { ManualActionStore } from './internal/manual-action-store.js';
export { PgFinanceApprovalStore } from './internal/finance-approval-store.js';
export type { FinanceApprovalStore, SqlPool } from './internal/finance-approval-store.js';

// Console « Apparence / Marque » (US-034) : montage par le processus API seulement.
export { SupBrandConsoleModule } from './internal/sup-brand-console.module.js';

// Tableau de sécurité (US-052) : montage par le processus API seulement.
export { SupSecurityConsoleModule } from './internal/sup-security-console.module.js';
