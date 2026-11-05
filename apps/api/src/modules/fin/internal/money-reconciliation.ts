/**
 * Contrôles de rapprochement de l'argent (US-047 ; 19 §1.8 ligne « Rapprochement » ; ADR-086) :
 * cohérence des règlements, des remboursements et des jambes, relue chaque nuit sur toute la base
 * par le travailleur `reconciliation` (lecture seule ; politiques `worker_money_read` de 0027 et
 * 0036). Les invariants viennent de la spécification, jamais du code testé :
 *
 * | Contrôle (code PROPOSÉ)          | Règle                                                                     | Source                      |
 * | -------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
 * | `SETTLEMENT_LEGS_INCOMPLETE`     | une version porte exactement les 4 jambes HOST, INSURER, TAX_THIRD_PARTY, PLATFORM | 08 E7 (tableau des jambes)  |
 * | `SETTLEMENT_LEG_NEGATIVE`        | aucune jambe retenue ni avance négative                                   | 08 E7 règles 2, 5 ; 17 §2.9 |
 * | `SETTLEMENT_LEGS_SUM`            | Σ jambes signées (retenu − avance) = retenu + taxe retenue (TOTAL de `legs`) | 08 E7 (`legs`, complément PLATFORM) |
 * | `SETTLEMENT_HOST_LEG`            | jambe HOST retenue = `hostFromGuest`                                       | 08 E7 (tableau, `legs`)     |
 * | `SETTLEMENT_REFUND_BALANCE`      | remboursement + retenu + taxe retenue = total payé ; 0 ≤ remboursement ≤ total payé | 17 §3.2.8 ; 08 E1          |
 * | `SETTLEMENT_VARIATIONS_REFUND`   | Σ variations = − remboursement (v1) ou − écart de remboursement depuis la version n (v n+1) | 08 E7 règle 3 ; E4 |
 * | `SETTLEMENT_VERSION_CHAIN`       | v1 sans prédécesseur ; v n+1 remplace la version n du même trip           | 08 E4                       |
 * | `LEG_BALANCE_OVERDRAWN`          | remboursé + réaffecté sortant + libéré ≤ capturé + réaffecté entrant, par jambe | 17 §2.9 « Invariants par jambe » |
 *
 * La base refuse déjà la plupart de ces écarts (contraintes et trigger différé
 * `settlement_balanced`, 0027) : ce contrôle est le filet indépendant que demande 19 §1.8, au même
 * titre que l'oracle C12 l'est pour la réservation. Il ne lit AUCUNE donnée personnelle et ne rend
 * que des COMPTES, par contrôle et par pays (17 §6.3) ; un écart lève une alerte P1
 * `FIN_MONEY_RECONCILIATION` par pays (port `AlertChannel`, US-004). Le rapprochement par jambe
 * avec l'export du PSP arrive avec US-311, l'invariant du relevé mensuel avec US-217, l'égalité
 * Σ débits = Σ crédits avec le grand livre (lot 5).
 *
 * Fail-closed : un contexte autre que le travailleur `reconciliation` (la RLS ne montrerait rien et
 * le contrôle rendrait des zéros trompeurs), un compte illisible ou un montant hors du format
 * `bigint` lève une erreur au lieu de rendre un rapport.
 */
import type { AlertChannel, BusRegistry, SqlClient } from '../../bus/index.js';

/** Travailleur du rapprochement (liste des politiques `worker_money_read`, 0027, 0036, 0039). */
export const MONEY_RECONCILIATION_WORKER = 'reconciliation';

/** Période de la tâche : une fois par 24 h (« chaque nuit », PROPOSÉ, ADR-086). */
export const MONEY_RECONCILIATION_PERIOD_SECONDS = 86_400;

/** Contrôles, dans l'ordre de l'en-tête (codes PROPOSÉS, ADR-086). */
export const MONEY_RECONCILIATION_CHECKS = [
  'SETTLEMENT_LEGS_INCOMPLETE',
  'SETTLEMENT_LEG_NEGATIVE',
  'SETTLEMENT_LEGS_SUM',
  'SETTLEMENT_HOST_LEG',
  'SETTLEMENT_REFUND_BALANCE',
  'SETTLEMENT_VARIATIONS_REFUND',
  'SETTLEMENT_VERSION_CHAIN',
  'LEG_BALANCE_OVERDRAWN',
] as const;
export type MoneyReconciliationCheck = (typeof MONEY_RECONCILIATION_CHECKS)[number];

/** Les quatre jambes de 08 E7. */
export const SETTLEMENT_LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;

/** Agrégat d'une version de règlement (une ligne de `SETTLEMENT_AGGREGATES_SQL`). */
export interface SettlementAggregate {
  readonly country: string;
  readonly version: number;
  readonly hasPrevious: boolean;
  /** Version remplacée lue en base (null si absente ou invisible). */
  readonly previousVersion: number | null;
  readonly previousSameTrip: boolean | null;
  readonly previousRefund: bigint | null;
  readonly totalPaid: bigint;
  readonly guestRefund: bigint;
  readonly retained: bigint;
  readonly retainedTax: bigint;
  readonly hostFromGuest: bigint;
  /** Jambes de la version, chacune nommée une fois (ordre libre). */
  readonly legs: readonly string[];
  readonly minKept: bigint | null;
  readonly minAdvance: bigint | null;
  /** Σ (retenu − avance) des jambes. */
  readonly signedSum: bigint;
  readonly variationSum: bigint;
  /** Jambe HOST retenue (null si absente). */
  readonly hostKept: bigint | null;
}

/** Solde d'une jambe d'un segment (`trip_leg_balance`). */
export interface LegBalanceAggregate {
  readonly country: string;
  readonly captured: bigint;
  readonly refunded: bigint;
  readonly reallocatedIn: bigint;
  readonly reallocatedOut: bigint;
  readonly released: bigint;
}

export interface CheckCount {
  readonly total: bigint;
  /** Violations par pays (seuls les pays en écart). */
  readonly byCountry: Readonly<Record<string, bigint>>;
}

export interface MoneyReconciliationReport {
  readonly checks: Readonly<Record<MoneyReconciliationCheck, CheckCount>>;
  readonly violations: bigint;
  /** Lignes examinées, par pays (preuve que le contrôle a vu des données). */
  readonly examined: {
    readonly settlements: Readonly<Record<string, number>>;
    readonly legBalances: Readonly<Record<string, number>>;
  };
}

/** Erreur de contrat : contexte erroné ou ligne illisible. */
export class MoneyReconciliationContractError extends Error {
  override readonly name = 'MoneyReconciliationContractError';
}

/** Contexte de la transaction : seul le travailleur `reconciliation` voit toutes les lignes. */
export const RECONCILIATION_CONTEXT_SQL =
  'SELECT app.actor_kind() AS actor_kind, app.worker_name() AS worker_name';

/**
 * Une ligne par version de règlement : en-tête, version remplacée et agrégats des jambes. Montants
 * en texte (bigint exact, jamais un nombre JavaScript). Aucune donnée personnelle, aucun identifiant
 * rendu. Lecture seule ; aucune horloge.
 */
export const SETTLEMENT_AGGREGATES_SQL = `
SELECT s.country_code AS country,
       s.version,
       (s.supersedes_id IS NOT NULL) AS has_previous,
       p.version AS previous_version,
       (p.trip_id = s.trip_id AND p.segment_no = s.segment_no) AS previous_same_trip,
       p.guest_refund_minor::text AS previous_refund,
       s.total_paid_minor::text AS total_paid,
       s.guest_refund_minor::text AS guest_refund,
       s.retained_minor::text AS retained,
       s.retained_tax_minor::text AS retained_tax,
       s.host_from_guest_minor::text AS host_from_guest,
       COALESCE(l.legs, '{}'::text[]) AS legs,
       l.min_kept::text AS min_kept,
       l.min_advance::text AS min_advance,
       COALESCE(l.signed_sum, 0)::text AS signed_sum,
       COALESCE(l.variation_sum, 0)::text AS variation_sum,
       l.host_kept::text AS host_kept
  FROM core.settlement_settlement AS s
  LEFT JOIN core.settlement_settlement AS p ON p.id = s.supersedes_id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.array_agg(g.leg ORDER BY g.leg) AS legs,
           pg_catalog.min(g.kept_minor) AS min_kept,
           pg_catalog.min(g.advance_minor) AS min_advance,
           pg_catalog.sum(g.kept_minor - g.advance_minor) AS signed_sum,
           pg_catalog.sum(g.variation_minor) AS variation_sum,
           pg_catalog.sum(g.kept_minor) FILTER (WHERE g.leg = 'HOST') AS host_kept
      FROM core.settlement_settlement_leg AS g
     WHERE g.settlement_id = s.id
  ) AS l ON true`;

/** Une ligne par jambe de segment tenue (`trip_leg_balance`). */
export const LEG_BALANCE_AGGREGATES_SQL = `
SELECT b.country_code AS country,
       b.captured_minor::text AS captured,
       b.refunded_minor::text AS refunded,
       b.reallocated_in_minor::text AS reallocated_in,
       b.reallocated_out_minor::text AS reallocated_out,
       b.released_minor::text AS released
  FROM core.settlement_trip_leg_balance AS b`;

const MINOR = /^-?[0-9]{1,19}$/;
const COUNTRY = /^[A-Z]{2}$/;

function minor(value: unknown, field: string): bigint {
  if (typeof value === 'string' && MINOR.test(value)) return BigInt(value);
  throw new MoneyReconciliationContractError(`montant illisible : ${field}`);
}
function minorOrNull(value: unknown, field: string): bigint | null {
  return value === null || value === undefined ? null : minor(value, field);
}
function country(value: unknown): string {
  if (typeof value === 'string' && COUNTRY.test(value)) return value;
  throw new MoneyReconciliationContractError('pays illisible');
}
function version(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 1) return n;
  throw new MoneyReconciliationContractError(`version illisible : ${field}`);
}
function legsOf(value: unknown): string[] {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  // pg rend un text[] en tableau ; un littéral « {A,B} » n'est pas attendu ici
  throw new MoneyReconciliationContractError('jambes illisibles');
}
function bool(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new MoneyReconciliationContractError(`booléen illisible : ${field}`);
}

/** Lit une ligne de `SETTLEMENT_AGGREGATES_SQL` ; fail-closed. */
export function parseSettlementRow(row: Record<string, unknown>): SettlementAggregate {
  const hasPrevious = bool(row.has_previous, 'has_previous');
  const previousSameTrip = row.previous_same_trip;
  if (previousSameTrip !== null && previousSameTrip !== undefined) {
    bool(previousSameTrip, 'previous_same_trip');
  }
  return {
    country: country(row.country),
    version: version(row.version, 'version'),
    hasPrevious,
    previousVersion:
      row.previous_version === null || row.previous_version === undefined
        ? null
        : version(row.previous_version, 'previous_version'),
    previousSameTrip: (previousSameTrip as boolean | null | undefined) ?? null,
    previousRefund: minorOrNull(row.previous_refund, 'previous_refund'),
    totalPaid: minor(row.total_paid, 'total_paid'),
    guestRefund: minor(row.guest_refund, 'guest_refund'),
    retained: minor(row.retained, 'retained'),
    retainedTax: minor(row.retained_tax, 'retained_tax'),
    hostFromGuest: minor(row.host_from_guest, 'host_from_guest'),
    legs: legsOf(row.legs),
    minKept: minorOrNull(row.min_kept, 'min_kept'),
    minAdvance: minorOrNull(row.min_advance, 'min_advance'),
    signedSum: minor(row.signed_sum, 'signed_sum'),
    variationSum: minor(row.variation_sum, 'variation_sum'),
    hostKept: minorOrNull(row.host_kept, 'host_kept'),
  };
}

/** Lit une ligne de `LEG_BALANCE_AGGREGATES_SQL` ; fail-closed. */
export function parseLegBalanceRow(row: Record<string, unknown>): LegBalanceAggregate {
  return {
    country: country(row.country),
    captured: minor(row.captured, 'captured'),
    refunded: minor(row.refunded, 'refunded'),
    reallocatedIn: minor(row.reallocated_in, 'reallocated_in'),
    reallocatedOut: minor(row.reallocated_out, 'reallocated_out'),
    released: minor(row.released, 'released'),
  };
}

/** Contrôles en écart d'une version de règlement (fonction pure). */
export function settlementViolations(s: SettlementAggregate): MoneyReconciliationCheck[] {
  const out: MoneyReconciliationCheck[] = [];
  const legs = [...s.legs].sort();
  const expected = [...SETTLEMENT_LEGS].sort();
  if (legs.length !== expected.length || legs.some((l, i) => l !== expected[i])) {
    out.push('SETTLEMENT_LEGS_INCOMPLETE');
  }
  if ((s.minKept !== null && s.minKept < 0n) || (s.minAdvance !== null && s.minAdvance < 0n)) {
    out.push('SETTLEMENT_LEG_NEGATIVE');
  }
  if (s.signedSum !== s.retained + s.retainedTax) out.push('SETTLEMENT_LEGS_SUM');
  if (s.hostKept !== s.hostFromGuest) out.push('SETTLEMENT_HOST_LEG');
  if (
    s.guestRefund + s.retained + s.retainedTax !== s.totalPaid ||
    s.guestRefund < 0n ||
    s.guestRefund > s.totalPaid
  ) {
    out.push('SETTLEMENT_REFUND_BALANCE');
  }
  const chainOk =
    s.version === 1
      ? !s.hasPrevious
      : s.hasPrevious &&
        s.previousVersion === s.version - 1 &&
        s.previousSameTrip === true &&
        s.previousRefund !== null;
  if (!chainOk) out.push('SETTLEMENT_VERSION_CHAIN');
  // v n+1 dont la version n est illisible : l'écart de remboursement n'est pas calculable, la
  // chaîne est déjà en écart ; on ne compte pas une seconde fois la même version.
  if (s.version === 1 || s.previousRefund !== null) {
    const refundDelta = s.guestRefund - (s.version === 1 ? 0n : (s.previousRefund ?? 0n));
    if (s.variationSum !== -refundDelta) out.push('SETTLEMENT_VARIATIONS_REFUND');
  }
  return out;
}

/** Vrai si la jambe du segment est à découvert (17 §2.9, fonction pure). */
export function legBalanceOverdrawn(b: LegBalanceAggregate): boolean {
  return b.refunded + b.reallocatedOut + b.released > b.captured + b.reallocatedIn;
}

/** Rapport à partir des lignes lues (fonction pure). */
export function evaluateMoneyReconciliation(
  settlements: readonly SettlementAggregate[],
  legBalances: readonly LegBalanceAggregate[],
): MoneyReconciliationReport {
  const totals = new Map<MoneyReconciliationCheck, Map<string, bigint>>(
    MONEY_RECONCILIATION_CHECKS.map((c) => [c, new Map()]),
  );
  const hit = (check: MoneyReconciliationCheck, cc: string): void => {
    const m = totals.get(check);
    if (m === undefined) throw new MoneyReconciliationContractError(`contrôle inconnu : ${check}`);
    m.set(cc, (m.get(cc) ?? 0n) + 1n);
  };
  const examinedSettlements: Record<string, number> = {};
  const examinedBalances: Record<string, number> = {};
  for (const s of settlements) {
    examinedSettlements[s.country] = (examinedSettlements[s.country] ?? 0) + 1;
    for (const check of settlementViolations(s)) hit(check, s.country);
  }
  for (const b of legBalances) {
    examinedBalances[b.country] = (examinedBalances[b.country] ?? 0) + 1;
    if (legBalanceOverdrawn(b)) hit('LEG_BALANCE_OVERDRAWN', b.country);
  }
  let violations = 0n;
  const checks = Object.fromEntries(
    MONEY_RECONCILIATION_CHECKS.map((c) => {
      const byCountry = Object.fromEntries(
        [...(totals.get(c) ?? new Map<string, bigint>())].sort(([a], [b]) => a.localeCompare(b)),
      );
      const total = Object.values(byCountry).reduce((a, n) => a + n, 0n);
      violations += total;
      return [c, { total, byCountry }];
    }),
  ) as Record<MoneyReconciliationCheck, CheckCount>;
  return {
    checks,
    violations,
    examined: { settlements: examinedSettlements, legBalances: examinedBalances },
  };
}

/**
 * Une passe du rapprochement, dans la transaction du travailleur `reconciliation` (l'appelant
 * l'ouvre : `WorkerTransactions.run`). Vérifie d'abord le contexte (fail-closed).
 */
export async function runMoneyReconciliation(tx: SqlClient): Promise<MoneyReconciliationReport> {
  const ctx = await tx.query<{ actor_kind: unknown; worker_name: unknown }>(
    RECONCILIATION_CONTEXT_SQL,
  );
  const c = ctx.rows[0];
  if (c?.actor_kind !== 'WORKER' || c.worker_name !== MONEY_RECONCILIATION_WORKER) {
    throw new MoneyReconciliationContractError(
      `contexte attendu : travailleur ${MONEY_RECONCILIATION_WORKER}`,
    );
  }
  const settlements = await tx.query<Record<string, unknown>>(SETTLEMENT_AGGREGATES_SQL);
  const balances = await tx.query<Record<string, unknown>>(LEG_BALANCE_AGGREGATES_SQL);
  return evaluateMoneyReconciliation(
    settlements.rows.map(parseSettlementRow),
    balances.rows.map(parseLegBalanceRow),
  );
}

/** Forme JSON du rapport (montants en texte), pour le journal et le tableau de bord QA. */
export function reconciliationReportJson(report: MoneyReconciliationReport): {
  violations: string;
  checks: Record<string, { total: string; byCountry: Record<string, string> }>;
  examined: MoneyReconciliationReport['examined'];
} {
  return {
    violations: report.violations.toString(),
    checks: Object.fromEntries(
      MONEY_RECONCILIATION_CHECKS.map((c) => [
        c,
        {
          total: report.checks[c].total.toString(),
          byCountry: Object.fromEntries(
            Object.entries(report.checks[c].byCountry).map(([k, v]) => [k, v.toString()]),
          ),
        },
      ]),
    ),
    examined: report.examined,
  };
}

/** Ligne de journal (comptes seulement, aucun identifiant : 17 §6.3). */
export function reconciliationLogLine(report: MoneyReconciliationReport): string {
  const json = reconciliationReportJson(report);
  return JSON.stringify({
    level: report.violations > 0n ? 'error' : 'info',
    worker: MONEY_RECONCILIATION_WORKER,
    violations: json.violations,
    checks: Object.fromEntries(Object.entries(json.checks).map(([k, v]) => [k, v.total])),
    examined: json.examined,
  });
}

const alertKey = (check: MoneyReconciliationCheck): string => check.toLowerCase().slice(0, 40);

/** Une alerte P1 par pays en écart (comptes par contrôle seulement). */
export async function alertOnViolations(
  report: MoneyReconciliationReport,
  alerts: AlertChannel,
): Promise<number> {
  const countries = new Set<string>();
  for (const c of MONEY_RECONCILIATION_CHECKS) {
    for (const cc of Object.keys(report.checks[c].byCountry)) countries.add(cc);
  }
  let sent = 0;
  for (const cc of [...countries].sort()) {
    const counts: Record<string, number> = {};
    for (const c of MONEY_RECONCILIATION_CHECKS) {
      const n = report.checks[c].byCountry[cc];
      if (n !== undefined && n > 0n) counts[alertKey(c)] = Number(n);
    }
    await alerts.send({
      code: 'FIN_MONEY_RECONCILIATION',
      severity: 'P1',
      counts,
      labels: { country: cc },
    });
    sent++;
  }
  return sent;
}

/** Déclare la tâche périodique du rapprochement (file = travailleur `reconciliation`). */
export function registerMoneyReconciliation(
  registry: BusRegistry,
  alerts: AlertChannel,
  log: (line: string) => void,
  periodSeconds: number = MONEY_RECONCILIATION_PERIOD_SECONDS,
): void {
  registry.registerPeriodic(MONEY_RECONCILIATION_WORKER, periodSeconds, async (_payload, tx) => {
    const report = await runMoneyReconciliation(tx);
    log(reconciliationLogLine(report));
    await alertOnViolations(report, alerts);
  });
}
