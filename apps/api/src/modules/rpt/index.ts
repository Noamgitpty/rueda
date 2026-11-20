// Point d'entrée public du module RPT. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, rpt.module.ts) est privé (règle rueda/module-boundaries).
export { RptModule } from './rpt.module.js';
// US-311 : vues de la bêta et rapprochement par jambe assisté (console)
export { RptConsoleModule } from './internal/report-console.module.js';
export { REPORT_MESSAGES, ReportHttpError } from './internal/errors.js';
export type { ReportCode } from './internal/errors.js';
export { toCsv, CSV_COLUMNS } from './internal/csv.js';
export {
  BETA_VIEWS,
  PgReportStore,
  RECON_CHECKLIST,
  RECON_KINDS,
  RECON_RESOLUTIONS,
  ReportStoreError,
  UnavailableReportStore,
} from './internal/store.js';
export type {
  BetaView,
  ReconKind,
  ReconResolution,
  ReportResult,
  ReportStore,
} from './internal/store.js';
