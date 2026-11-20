/**
 * Port et adaptateur PostgreSQL de la remise et du retour (US-315, migration 0163, ADR-183).
 * L'adaptateur n'appelle QUE les fonctions `core.trip_handover_view`, `core.trip_cmd_open_checkin`,
 * `core.trip_cmd_identity_check` et `core.trip_cmd_validate_handover` (SECURITY DEFINER,
 * propriétaire cmd_hold_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables.
 * La personne est désignée par l'empreinte de son jeton de session (`proof`), jamais par un
 * identifiant reçu. Requêtes paramétrées ; une erreur de la base devient `HandoverStoreError`
 * (SQLSTATE seulement). Aucune heure n'est envoyée à la base : elle prend `platform.now()`.
 */
import type { SqlExecutor } from '../inspection/ports.js';
import type { HandoverKind, HandoverMethod, Subreason } from './model.js';

export type HandoverRole = 'HOST' | 'GUEST';
export type SeriesStatus = 'NONE' | 'DRAFT' | 'SUBMITTED';

export interface HandoverValidationRow {
  readonly validatedAt: Date;
  readonly odometerKm: number;
  readonly fuelEighths: number;
}

export interface HandoverViewRow {
  readonly viewerRole: HandoverRole;
  readonly tripStatus: string;
  readonly timezone: string;
  readonly opensAt: Date | null;
  readonly open: boolean;
  readonly canOpen: boolean;
  readonly blockers: readonly string[];
  readonly identityCheck: {
    readonly status: 'PENDING' | 'OK' | 'FAILED';
    readonly checkedAt: Date | null;
  } | null;
  readonly guest: {
    readonly firstName: string | null;
    readonly lastInitial: string | null;
    readonly birthYear: number | null;
  } | null;
  readonly photos: { readonly mine: SeriesStatus; readonly other: SeriesStatus };
  readonly validations: {
    readonly mine: HandoverValidationRow | null;
    readonly other: HandoverValidationRow | null;
  };
  readonly contactlessOffered: boolean;
  readonly completedAt: Date | null;
}

export interface HandoverStore {
  /** `null` : trip inconnu, d'une autre personne ou sens inconnu (NOT_FOUND). */
  view(proof: Buffer, tripId: string, kind: HandoverKind): Promise<HandoverViewRow | null>;
  open(proof: Buffer, tripId: string): Promise<{ outcome: string; openedAt: Date | null }>;
  identity(
    proof: Buffer,
    tripId: string,
    checklist: Readonly<Record<string, unknown>>,
    subreason: Subreason | null,
  ): Promise<{ outcome: string; status: string | null; checkedAt: Date | null }>;
  validate(
    proof: Buffer,
    tripId: string,
    kind: HandoverKind,
    reading: { readonly odometerKm: number; readonly fuelEighths: number },
    method: HandoverMethod,
  ): Promise<{
    outcome: string;
    validatedAt: Date | null;
    completedAt: Date | null;
    tripStatus: string | null;
  }>;
}

export class HandoverStoreError extends Error {
  override readonly name = 'HandoverStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`TRP : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableHandoverStore implements HandoverStore {
  #fail(): Promise<never> {
    return Promise.reject(new HandoverStoreError('remise : magasin indisponible', undefined));
  }
  view = (): Promise<HandoverViewRow | null> => this.#fail();
  open = (): Promise<{ outcome: string; openedAt: Date | null }> => this.#fail();
  identity = (): Promise<{ outcome: string; status: string | null; checkedAt: Date | null }> =>
    this.#fail();
  validate = (): Promise<{
    outcome: string;
    validatedAt: Date | null;
    completedAt: Date | null;
    tripStatus: string | null;
  }> => this.#fail();
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
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const SERIES = ['NONE', 'DRAFT', 'SUBMITTED'] as const;
const BLOCKERS = [
  'CHECKIN_PAYMENT_NOT_CONFIRMED',
  'CONTRACT_NOT_SIGNED',
  'DEPOSIT_NOT_READY',
  'INSURER_CONTRACT_INACTIVE',
  'HANDOVER_BLOCKED',
] as const;

/** Vue jsonb de `core.trip_handover_view` ; forme inattendue ⇒ erreur (jamais une vue partielle). */
export function parseHandoverView(v: unknown): HandoverViewRow | null {
  const bad = (): never => {
    throw new HandoverStoreError('lecture de la remise : vue illisible', undefined);
  };
  if (!isObj(v)) return bad();
  if (v['outcome'] === 'NOT_FOUND') return null;
  const role = v['viewerRole'];
  if (v['outcome'] !== 'OK' || (role !== 'HOST' && role !== 'GUEST')) return bad();
  if (typeof v['tripStatus'] !== 'string' || !/^[A-Z_]{2,32}$/.test(v['tripStatus'])) return bad();
  if (typeof v['timezone'] !== 'string' || v['timezone'].length === 0) return bad();
  if (typeof v['open'] !== 'boolean' || typeof v['canOpen'] !== 'boolean') return bad();
  if (typeof v['contactlessOffered'] !== 'boolean') return bad();
  const time = (x: unknown): Date | null => {
    if (x === null || x === undefined) return null;
    return dateOf(x) ?? bad();
  };
  const blockers = v['blockers'];
  if (
    !Array.isArray(blockers) ||
    blockers.some((b) => !(BLOCKERS as readonly unknown[]).includes(b))
  ) {
    return bad();
  }
  let identityCheck: HandoverViewRow['identityCheck'] = null;
  const ic = v['identityCheck'];
  if (ic !== null && ic !== undefined) {
    if (
      !isObj(ic) ||
      (ic['status'] !== 'PENDING' && ic['status'] !== 'OK' && ic['status'] !== 'FAILED')
    ) {
      return bad();
    }
    identityCheck = { status: ic['status'], checkedAt: time(ic['checkedAt']) };
  }
  let guest: HandoverViewRow['guest'] = null;
  const g = v['guest'];
  if (g !== null && g !== undefined) {
    if (!isObj(g)) return bad();
    const text = (x: unknown): string | null =>
      x === null || x === undefined ? null : typeof x === 'string' ? x : bad();
    const year = g['birthYear'];
    if (year !== null && year !== undefined && !isInt(year)) return bad();
    guest = {
      firstName: text(g['firstName']),
      lastInitial: text(g['lastInitial']),
      birthYear: isInt(year) ? year : null,
    };
  }
  const photos = v['photos'];
  if (
    !isObj(photos) ||
    !(SERIES as readonly unknown[]).includes(photos['mine']) ||
    !(SERIES as readonly unknown[]).includes(photos['other'])
  ) {
    return bad();
  }
  const validation = (x: unknown): HandoverValidationRow | null => {
    if (x === null || x === undefined) return null;
    if (!isObj(x) || !isInt(x['odometerKm']) || !isInt(x['fuelEighths'])) return bad();
    const at = dateOf(x['validatedAt']);
    if (at === null) return bad();
    return { validatedAt: at, odometerKm: x['odometerKm'], fuelEighths: x['fuelEighths'] };
  };
  const vals = v['validations'];
  if (!isObj(vals)) return bad();
  return {
    viewerRole: role,
    tripStatus: v['tripStatus'],
    timezone: v['timezone'],
    opensAt: time(v['opensAt']),
    open: v['open'],
    canOpen: v['canOpen'],
    blockers: blockers as string[],
    identityCheck,
    guest,
    photos: { mine: photos['mine'] as SeriesStatus, other: photos['other'] as SeriesStatus },
    validations: { mine: validation(vals['mine']), other: validation(vals['other']) },
    contactlessOffered: v['contactlessOffered'],
    completedAt: time(v['completedAt']),
  };
}

export class PgHandoverStore implements HandoverStore {
  constructor(private readonly db: SqlExecutor) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new HandoverStoreError(operation, sqlstateOf(error));
    }
  }

  async view(proof: Buffer, tripId: string, kind: HandoverKind) {
    const r = await this.#one<{ v: unknown }>(
      'lecture de la remise',
      'SELECT core.trip_handover_view($1, $2::uuid, $3) AS v',
      [proof, tripId, kind],
    );
    return parseHandoverView(r?.v);
  }

  async open(proof: Buffer, tripId: string) {
    const r = await this.#one<{ outcome: string; opened_at: unknown }>(
      'ouverture de la remise',
      'SELECT * FROM core.trip_cmd_open_checkin($1, $2::uuid)',
      [proof, tripId],
    );
    return { outcome: r?.outcome ?? 'UNAVAILABLE', openedAt: dateOf(r?.opened_at) };
  }

  async identity(
    proof: Buffer,
    tripId: string,
    checklist: Readonly<Record<string, unknown>>,
    subreason: Subreason | null,
  ) {
    const r = await this.#one<{ outcome: string; status: string | null; checked_at: unknown }>(
      'contrôle du permis',
      'SELECT * FROM core.trip_cmd_identity_check($1, $2::uuid, $3::jsonb, $4)',
      [proof, tripId, JSON.stringify(checklist), subreason],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      status: r?.status ?? null,
      checkedAt: dateOf(r?.checked_at),
    };
  }

  async validate(
    proof: Buffer,
    tripId: string,
    kind: HandoverKind,
    reading: { readonly odometerKm: number; readonly fuelEighths: number },
    method: HandoverMethod,
  ) {
    const r = await this.#one<{
      outcome: string;
      validated_at: unknown;
      completed_at: unknown;
      trip_status: string | null;
    }>(
      'validation de la remise',
      `SELECT * FROM core.trip_cmd_validate_handover($1, $2::uuid, $3, $4::integer, $5::integer,
                                                     $6)`,
      [proof, tripId, kind, reading.odometerKm, reading.fuelEighths, method],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      validatedAt: dateOf(r?.validated_at),
      completedAt: dateOf(r?.completed_at),
      tripStatus: r?.trip_status ?? null,
    };
  }
}
