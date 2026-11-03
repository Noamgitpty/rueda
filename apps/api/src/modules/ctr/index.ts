// Point d'entrée public du module CTR. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, ctr.module.ts) est privé (règle rueda/module-boundaries).
export { CtrModule } from './ctr.module.js';

// Port SignatureService (US-020, ADR-057) : types seulement ; l'adaptateur est injecté.
export type {
  SignatureCheckResult,
  SignatureOutcome,
  SignatureRecord,
  SignatureService,
  SignRequest,
} from './internal/signature-service.port.js';
