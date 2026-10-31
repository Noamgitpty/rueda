// Point d'entrée public du module KYC. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, kyc.module.ts) est privé (règle rueda/module-boundaries).
export { KycModule } from './kyc.module.js';
