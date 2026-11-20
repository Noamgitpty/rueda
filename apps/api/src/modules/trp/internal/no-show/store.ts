/**
 * Port et adaptateur PostgreSQL du no-show (US-307, migration 0171, ADR-191). L'adaptateur
 * n'appelle QUE `core.trip_no_show_view` et `core.trip_cmd_report_no_show` (SECURITY DEFINER,
 * propriétaire cmd_hold_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables.
 * La personne est désignée par l'empreinte de son jeton de session (`proof`), jamais par un
 * identifiant reçu ; la partie absente (l'autre partie du trip) est déduite par la base. Requêtes
 * paramétrées ; une erreur de la base devient `NoShowStoreError` (SQLSTATE seulement). Aucune heure
 * n'est envoyée à la base : elle prend `platform.now()`.
 */
import type { SqlExecutor } from '../inspection/ports.js';

export type NoShowRole = 'HOST' | 'GUEST';
export type DeclarationStatus = 'PENDING' | 'SETTLED' | 'FIN_REVIEW' | 'FAILED';

export interface NoShowViewRow {
  readonly viewerRole: NoShowRole;
  readonly absentParty: NoShowRole;
  readonly tripStatus: string;
  readonly timezone: string;
  readonly scheduledStart: Date;
  readonly declarableFrom: Date | null;
  readonly declarableUntil: Date | null;
  /** Premier obstacle de la base (`null` : déclarable). */
  readonly blocker: string | null;
  readonly messageTraced: boolean;
  readonly declaration: {
    readonly id: string;
    readonly requestedReason: string;
    readonly status: DeclarationStatus;
    readonly requestedAt: Date;
    readonly mine: boolean;
  } | null;
}

export interface NoShowReport {
  readonly outcome: string;
  readonly declarationId: string | null;
  readonly requestedAt: Date | null;
}

export interface NoShowStore {
  /** `null` : trip inconnu ou d'une autre personne (NOT_FOUND). */
  view(proof: Buffer, tripId: string): Promise<NoShowViewRow | null>;
  report(proof: Buffer, tripId: string, requestId: string): Promise<NoShowReport>;
}

export class NoShowStoreError extends Error {
  override readonly name = 'NoShowStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`TRP : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableNoShowStore implements NoShowStore {
  #fail(): Promise<never> {
    return Promise.reject(new NoShowStoreError('no-show : magasin indisponible', undefined));
  }
  view = (): Promise<NoShowViewRow | null> => this.#fail();
  report = (): Promise<NoShowReport> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d !== null && Number.isFinite(d.getTime()) ? d : null;
};
const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const ROLES: readonly unknown[] = ['HOST', 'GUEST'];
const STATUSES: readonly unknown[] = ['PENDING', 'SETTLED', 'FIN_REVIEW', 'FAILED'];
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Vue jsonb de `core.trip_no_show_view` ; forme inattendue ⇒ erreur (jamais une vue partielle). */
export function parseNoShowView(v: unknown): NoShowViewRow | null {
  const bad = (): never => {
    throw new NoShowStoreError('lecture du no-show : vue illisible', undefined);
  };
  if (!isObj(v)) return bad();
  if (v['outcome'] === 'NOT_FOUND') return null;
  const role = v['viewerRole'];
  const absent = v['absentParty'];
  if (
    v['outcome'] !== 'OK' ||
    !ROLES.includes(role) ||
    !ROLES.includes(absent) ||
    role === absent
  ) {
    return bad();
  }
  const status = v['tripStatus'];
  if (typeof status !== 'string' || !/^[A-Z_]{2,32}$/.test(status)) return bad();
  const timezone = v['timezone'];
  if (typeof timezone !== 'string' || timezone.length === 0) return bad();
  const traced = v['messageTraced'];
  if (typeof traced !== 'boolean') return bad();
  const blocker = v['blocker'];
  if (blocker !== null && blocker !== undefined) {
    if (typeof blocker !== 'string' || !CODE.test(blocker)) return bad();
  }
  const time = (x: unknown): Date | null => {
    if (x === null || x === undefined) return null;
    return dateOf(x) ?? bad();
  };
  const start = time(v['scheduledStart']);
  if (start === null) return bad();
  let declaration: NoShowViewRow['declaration'] = null;
  const d = v['declaration'];
  if (d !== null && d !== undefined) {
    if (!isObj(d)) return bad();
    const id = d['id'];
    const reason = d['requestedReason'];
    const mine = d['mine'];
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      typeof reason !== 'string' ||
      !CODE.test(reason) ||
      !STATUSES.includes(d['status']) ||
      typeof mine !== 'boolean'
    ) {
      return bad();
    }
    const at = time(d['requestedAt']);
    if (at === null) return bad();
    declaration = {
      id,
      requestedReason: reason,
      status: d['status'] as DeclarationStatus,
      requestedAt: at,
      mine,
    };
  }
  return {
    viewerRole: role as NoShowRole,
    absentParty: absent as NoShowRole,
    tripStatus: status,
    timezone,
    scheduledStart: start,
    declarableFrom: time(v['declarableFrom']),
    declarableUntil: time(v['declarableUntil']),
    blocker: typeof blocker === 'string' ? blocker : null,
    messageTraced: traced,
    declaration,
  };
}

export class PgNoShowStore implements NoShowStore {
  constructor(private readonly db: SqlExecutor) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new NoShowStoreError(operation, sqlstateOf(error));
    }
  }

  async view(proof: Buffer, tripId: string): Promise<NoShowViewRow | null> {
    const r = await this.#one<{ v: unknown }>(
      'lecture du no-show',
      'SELECT core.trip_no_show_view($1, $2::uuid) AS v',
      [proof, tripId],
    );
    return parseNoShowView(r?.v);
  }

  async report(proof: Buffer, tripId: string, requestId: string): Promise<NoShowReport> {
    const r = await this.#one<{
      outcome: string;
      declaration_id: string | null;
      requested_at: unknown;
    }>(
      'déclaration du no-show',
      'SELECT * FROM core.trip_cmd_report_no_show($1, $2::uuid, $3::uuid)',
      [proof, tripId, requestId],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      declarationId: r?.declaration_id ?? null,
      requestedAt: dateOf(r?.requested_at),
    };
  }
}
