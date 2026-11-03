// Point d'entrée public du module FIN. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, fin.module.ts) est privé (règle rueda/module-boundaries).
export { FinModule } from './fin.module.js';

// Port EInvoicingProvider (US-020, ADR-057) : types seulement ; l'adaptateur est injecté.
export type {
  EInvoicingOutcome,
  EInvoicingProvider,
  FiscalDocumentLine,
  FiscalReceipt,
  FiscalStatus,
  SubmitFiscalDocumentRequest,
} from './internal/e-invoicing-provider.port.js';
