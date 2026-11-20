/** Jetons d'injection Nest du module SUP. */
export const MANUAL_ACTION_STORE = Symbol('sup.ManualActionStore');
export const FINANCE_APPROVAL_STORE = Symbol('sup.FinanceApprovalStore');
export const OPS_CONSOLE_STORE = Symbol('sup.OpsConsoleStore');
export const EVIDENCE_SERVICE = Symbol('sup.EvidenceService');
export const VEHICLE_FILES = Symbol('sup.VehicleFiles');
/** Service du dossier de preuve (US-308, CLM) injecté dans le contrôleur de la console. */
export const EVIDENCE_BUNDLE_SERVICE = Symbol('EVIDENCE_BUNDLE_SERVICE');
