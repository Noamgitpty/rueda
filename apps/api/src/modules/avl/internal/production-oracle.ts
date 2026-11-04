/**
 * Oracle de production C12 (17 §2.5 ; 19 US-025 ; ADR-068) : tâche périodique du travailleur
 * `booking_oracle`. Elle appelle `core.booking_production_oracle_alert()` (migration 0045), qui
 * rejoue les cinq contrôles de C12 sur toute la base et, si l'un est non nul, écrit **une** alerte
 * P1 `booking.alert.production_oracle` dans l'outbox (comptes seulement). Les lectures de l'oracle
 * ne portent sur aucune donnée personnelle ; la tâche ne journalise que des comptes.
 *
 * Le câblage (pool `app_worker`, boucles du module BUS) vient avec US-003 : `worker.ts` appellera
 * `registerProductionOracle(registry)`. Période PROPOSÉE : 24 h (« chaque nuit » ; le planificateur
 * du module BUS raisonne en périodes, ADR-050).
 */
import type { BusRegistry, SqlClient } from '../../bus/index.js';

/** Travailleur de l'oracle (ajouté aux politiques SELECT `worker_select`, 0045). */
export const BOOKING_ORACLE_WORKER = 'booking_oracle';

/** Période de la tâche : une fois par 24 h (PROPOSÉ, ADR-068). */
export const PRODUCTION_ORACLE_PERIOD_SECONDS = 86_400;

/** Les cinq contrôles de C12, dans l'ordre de 17 §2.5 (codes PROPOSÉS, 0045). */
export const C12_CHECKS = [
  'TRIP_WITHOUT_ACTIVE_OCCUPANCY',
  'SUCCEEDED_WITHOUT_DISPOSITION',
  'COMPENSATED_HOLD_WITH_TRIP',
  'HOLD_WITH_TWO_CONVERSIONS',
  'INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP',
] as const;
export type C12Check = (typeof C12_CHECKS)[number];

export interface ProductionOracleReport {
  /** Violations par contrôle (les cinq sont toujours présents). */
  readonly checks: Readonly<Record<C12Check, bigint>>;
  readonly violations: bigint;
  /** Vrai si une alerte P1 a été écrite dans l'outbox. */
  readonly alerted: boolean;
}

/** Erreur de contrat : la base n'a pas rendu les cinq contrôles attendus. */
export class ProductionOracleContractError extends Error {
  override readonly name = 'ProductionOracleContractError';
}

const toCount = (value: unknown, check: string): bigint => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]{1,18}$/.test(value)) return BigInt(value);
  throw new ProductionOracleContractError(`compte invalide pour ${check}`);
};

/** Lit le rapport rendu par `core.booking_production_oracle_alert()` ; fail-closed. */
export function parseOracleReport(raw: unknown): ProductionOracleReport {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProductionOracleContractError('rapport absent');
  }
  const r = raw as { checks?: unknown; violations?: unknown; alerted?: unknown };
  if (typeof r.checks !== 'object' || r.checks === null || typeof r.alerted !== 'boolean') {
    throw new ProductionOracleContractError('rapport incomplet');
  }
  const source = r.checks as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(',') !== [...C12_CHECKS].sort().join(',')) {
    throw new ProductionOracleContractError('contrôles inattendus');
  }
  const checks = Object.fromEntries(C12_CHECKS.map((c) => [c, toCount(source[c], c)])) as Record<
    C12Check,
    bigint
  >;
  const violations = toCount(r.violations, 'violations');
  const sum = C12_CHECKS.reduce((acc, c) => acc + checks[c], 0n);
  if (sum !== violations || r.alerted !== violations > 0n) {
    throw new ProductionOracleContractError('rapport incohérent');
  }
  return { checks, violations, alerted: r.alerted };
}

/** Une passe de l'oracle, dans la transaction du travailleur `booking_oracle`. */
export async function runProductionOracle(tx: SqlClient): Promise<ProductionOracleReport> {
  const { rows } = await tx.query<{ report: unknown }>(
    'SELECT core.booking_production_oracle_alert() AS report',
  );
  return parseOracleReport(rows[0]?.report);
}

/** Ligne de journal (comptes seulement, aucun identifiant : 17 §6.3). */
export function oracleLogLine(report: ProductionOracleReport): string {
  return JSON.stringify({
    level: report.alerted ? 'error' : 'info',
    alert: report.alerted ? 'booking.production_oracle' : undefined,
    worker: BOOKING_ORACLE_WORKER,
    violations: report.violations.toString(),
    checks: Object.fromEntries(C12_CHECKS.map((c) => [c, report.checks[c].toString()])),
  });
}

/** Déclare la tâche périodique de l'oracle sur le module BUS (file = travailleur `booking_oracle`). */
export function registerProductionOracle(
  registry: BusRegistry,
  log: (line: string) => void = (line) => {
    console.error(line);
  },
  periodSeconds: number = PRODUCTION_ORACLE_PERIOD_SECONDS,
): void {
  registry.registerPeriodic(BOOKING_ORACLE_WORKER, periodSeconds, async (_payload, tx) => {
    log(oracleLogLine(await runProductionOracle(tx)));
  });
}
