/**
 * Magasin des vues de la bêta et du rapprochement assisté (US-311, migration 0174, ADR-194) : une
 * porte SQL par opération (`core.report_staff_beta_view`, `core.finance_staff_*`), sous app_api.
 * La base juge la session élevée, la permission et le pays du rôle, journalise les refus et les
 * exports (BULK_EXPORT) ; ce magasin ne fait que transmettre l'empreinte du jeton (preuve de
 * possession, jamais journalisée) et des valeurs liées, jamais concaténées.
 */

/** Exécuteur SQL minimal (pool `pg` ou client de transaction). */
export interface SqlExecutor {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export const BETA_VIEWS = ['HANDOVERS_TODAY', 'OVERDUE', 'EXIT_KPI'] as const;
export type BetaView = (typeof BETA_VIEWS)[number];
export const RECON_KINDS = ['OPERATIONS', 'LEGS'] as const;
export type ReconKind = (typeof RECON_KINDS)[number];
export const RECON_RESOLUTIONS = [
  'TIMING',
  'PSP_FEE',
  'PSP_ERROR',
  'PLATFORM_ERROR',
  'DUPLICATE',
  'OTHER',
] as const;
export type ReconResolution = (typeof RECON_RESOLUTIONS)[number];
/** Points de la checklist mensuelle (ADR-194, PROPOSÉ) : tous à `true` pour clôturer. */
export const RECON_CHECKLIST = [
  'PSP_STATEMENT_COMPLETE',
  'OPERATIONS_RECONCILED',
  'LEGS_RECONCILED',
  'DISCREPANCIES_EXPLAINED_OR_ESCALATED',
  'THRESHOLD_REVIEWED',
] as const;

/** Issue d'une porte et son corps (`null` hors `OK`). */
export interface ReportResult {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}

export interface ReportStore {
  betaView(
    tokenHash: Buffer,
    requestId: string,
    view: BetaView,
    country: string,
    exportReason: string | null,
  ): Promise<ReportResult>;
  platformExport(
    tokenHash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    reason: string,
  ): Promise<ReportResult>;
  record(
    tokenHash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    lines: readonly unknown[],
    reason: string,
  ): Promise<{ readonly outcome: string; readonly runId: string | null }>;
  run(
    tokenHash: Buffer,
    requestId: string,
    runId: string,
    exportReason: string | null,
  ): Promise<ReportResult>;
  runs(tokenHash: Buffer, country: string): Promise<ReportResult>;
  resolve(
    tokenHash: Buffer,
    requestId: string,
    itemId: string,
    resolution: ReconResolution,
    note: string,
  ): Promise<{ readonly outcome: string }>;
  sign(
    tokenHash: Buffer,
    requestId: string,
    runId: string,
    checklist: Readonly<Record<string, boolean>>,
  ): Promise<{ readonly outcome: string; readonly unexplained: number | null }>;
}

export class ReportStoreError extends Error {
  override readonly name = 'ReportStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`rapports : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableReportStore implements ReportStore {
  betaView(): Promise<ReportResult> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  platformExport(): Promise<ReportResult> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  record(): Promise<{ outcome: string; runId: string | null }> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  run(): Promise<ReportResult> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  runs(): Promise<ReportResult> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  resolve(): Promise<{ outcome: string }> {
    return Promise.reject(new ReportStoreError(undefined));
  }
  sign(): Promise<{ outcome: string; unexplained: number | null }> {
    return Promise.reject(new ReportStoreError(undefined));
  }
}

export const BETA_VIEW_SQL =
  'SELECT outcome, body FROM core.report_staff_beta_view($1, $2::uuid, $3, $4, $5, $6)';
export const PLATFORM_EXPORT_SQL =
  'SELECT outcome, body FROM core.finance_staff_reconciliation_export($1, $2::uuid, $3, $4::date, $5, $6)';
export const RECORD_SQL = `SELECT outcome, run_id
  FROM core.finance_staff_record_reconciliation($1, $2::uuid, $3, $4::date, $5, $6::jsonb, $7)`;
export const RUN_SQL =
  'SELECT outcome, body FROM core.finance_staff_reconciliation_run($1, $2::uuid, $3::uuid, $4, $5)';
export const RUNS_SQL = 'SELECT outcome, body FROM core.finance_staff_reconciliation_runs($1, $2)';
export const RESOLVE_SQL =
  'SELECT outcome FROM core.finance_staff_resolve_reconciliation_item($1, $2::uuid, $3::uuid, $4, $5)';
export const SIGN_SQL = `SELECT outcome, unexplained
  FROM core.finance_staff_sign_reconciliation($1, $2::uuid, $3::uuid, $4::jsonb)`;

const TEXT = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const OBJ = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

async function rowOf(
  db: SqlExecutor,
  text: string,
  values: readonly unknown[],
): Promise<Record<string, unknown> | undefined> {
  try {
    return (await db.query<Record<string, unknown>>(text, values)).rows[0];
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new ReportStoreError(typeof code === 'string' ? code : undefined);
  }
}

/** Aucune ligne rendue : contrat rompu, fail-closed (refus). */
const result = (r: Record<string, unknown> | undefined): ReportResult => ({
  outcome: TEXT(r?.['outcome']) ?? 'FORBIDDEN',
  body: OBJ(r?.['body']),
});

export class PgReportStore implements ReportStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async betaView(
    tokenHash: Buffer,
    requestId: string,
    view: BetaView,
    country: string,
    exportReason: string | null,
  ): Promise<ReportResult> {
    return result(
      await rowOf(this.#db, BETA_VIEW_SQL, [
        tokenHash,
        requestId,
        view,
        country,
        exportReason !== null,
        exportReason,
      ]),
    );
  }

  async platformExport(
    tokenHash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    reason: string,
  ): Promise<ReportResult> {
    return result(
      await rowOf(this.#db, PLATFORM_EXPORT_SQL, [
        tokenHash,
        requestId,
        country,
        month,
        kind,
        reason,
      ]),
    );
  }

  async record(
    tokenHash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    lines: readonly unknown[],
    reason: string,
  ): Promise<{ outcome: string; runId: string | null }> {
    const r = await rowOf(this.#db, RECORD_SQL, [
      tokenHash,
      requestId,
      country,
      month,
      kind,
      JSON.stringify(lines),
      reason,
    ]);
    return { outcome: TEXT(r?.['outcome']) ?? 'FORBIDDEN', runId: TEXT(r?.['run_id']) };
  }

  async run(
    tokenHash: Buffer,
    requestId: string,
    runId: string,
    exportReason: string | null,
  ): Promise<ReportResult> {
    return result(
      await rowOf(this.#db, RUN_SQL, [
        tokenHash,
        requestId,
        runId,
        exportReason !== null,
        exportReason,
      ]),
    );
  }

  async runs(tokenHash: Buffer, country: string): Promise<ReportResult> {
    return result(await rowOf(this.#db, RUNS_SQL, [tokenHash, country]));
  }

  async resolve(
    tokenHash: Buffer,
    requestId: string,
    itemId: string,
    resolution: ReconResolution,
    note: string,
  ): Promise<{ outcome: string }> {
    const r = await rowOf(this.#db, RESOLVE_SQL, [tokenHash, requestId, itemId, resolution, note]);
    return { outcome: TEXT(r?.['outcome']) ?? 'FORBIDDEN' };
  }

  async sign(
    tokenHash: Buffer,
    requestId: string,
    runId: string,
    checklist: Readonly<Record<string, boolean>>,
  ): Promise<{ outcome: string; unexplained: number | null }> {
    const r = await rowOf(this.#db, SIGN_SQL, [
      tokenHash,
      requestId,
      runId,
      JSON.stringify(checklist),
    ]);
    const n = r?.['unexplained'];
    return {
      outcome: TEXT(r?.['outcome']) ?? 'FORBIDDEN',
      unexplained: typeof n === 'number' ? n : null,
    };
  }
}
