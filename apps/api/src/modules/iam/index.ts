// Point d'entrée public du module IAM. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, testing/, iam.module.ts) est privé (règle rueda/module-boundaries).
export { IamModule } from './iam.module.js';

// Port d'authentification (US-010, ADR-021, ADR-052) : ce que les autres modules utilisent.
export { SessionGuard } from './internal/session.guard.js';
export { principalOf } from './internal/http.js';
export { AUTHENTICATION_PORT } from './internal/tokens.js';
export type { AuthenticatedPrincipal, AuthenticationPort } from './internal/auth.service.js';

// Montage par le processus API seulement (api.module.ts) et par les tests.
export { IamAuthModule } from './internal/iam-auth.module.js';
export type { IamAuthOptions } from './internal/iam-auth.module.js';
export { postgresIamAdapters } from './internal/production.js';
export type { SqlExecutor } from './internal/pg-auth-store.js';
