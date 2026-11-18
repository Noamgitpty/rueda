// Point d'entrée public du module FIN. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, fin.module.ts) est privé (règle rueda/module-boundaries).
export { FinModule } from './fin.module.js';

// Port EInvoicingProvider (US-020, ADR-058) : types seulement ; l'adaptateur est injecté.
export type {
  EInvoicingOutcome,
  EInvoicingProvider,
  FiscalDocumentLine,
  FiscalReceipt,
  FiscalStatus,
  SubmitFiscalDocumentRequest,
} from './internal/e-invoicing-provider.port.js';

// Contrôles de rapprochement de l'argent (US-047, ADR-087) : tâche nocturne du travailleur
// `reconciliation`, lecture seule, comptes par contrôle et par pays.
export {
  evaluateMoneyReconciliation,
  LEG_BALANCE_SOURCE,
  legBalanceAggregatesSql,
  MONEY_RECONCILIATION_CHECKS,
  MONEY_RECONCILIATION_PERIOD_SECONDS,
  MONEY_RECONCILIATION_WORKER,
  MoneyReconciliationContractError,
  parseLegBalanceRow,
  parseSettlementRow,
  reconciliationReportJson,
  registerMoneyReconciliation,
  runMoneyReconciliation,
  SETTLEMENT_LEG_SOURCE,
  SETTLEMENT_SOURCE,
  settlementAggregatesSql,
  // US-217a (ADR-161) : faits de l'invariant par jambe, lus de core.finance_trip_leg_facts()
  parseTripLegFactRow,
  TRIP_LEG_FACTS_SOURCE,
  tripLegFactsSql,
  tripLegViolations,
  // US-227 (ADR-165) : faits de la jambe assureur, lus de core.finance_insurer_ledger_facts()
  INSURER_LEDGER_FACTS_SOURCE,
  insurerLedgerFactsSql,
  insurerLedgerViolations,
  parseInsurerLedgerFactRow,
} from './internal/money-reconciliation.js';
export type {
  InsurerLedgerFact,
  MoneyReconciliationCheck,
  MoneyReconciliationReport,
  TripLegFact,
} from './internal/money-reconciliation.js';
