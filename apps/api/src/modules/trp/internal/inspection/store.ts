/**
 * Port et adaptateur PostgreSQL des photos d'état du véhicule (US-303, migration 0158, ADR-179).
 * L'adaptateur n'appelle QUE les fonctions `core.trip_*` (SECURITY DEFINER, propriétaire
 * cmd_hold_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables. La personne
 * est désignée par l'empreinte de son jeton de session (`proof`), jamais par un identifiant reçu :
 * la base juge la partie (voyageur du trip ou titulaire de son compte d'hôte) et rend NOT_FOUND à
 * toute autre personne. Requêtes paramétrées ; une erreur de la base devient
 * `InspectionStoreError` (SQLSTATE seulement).
 */
import type { InspectionKind, InspectionRole } from './model.js';
import type { SqlClient, SqlExecutor, SqlPool } from './ports.js';

export interface InspectionPhotoRow {
  readonly slot: string;
  readonly fileId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly receivedAt: string;
  readonly clockSkew: boolean;
}

export interface InspectionSideRow {
  readonly role: InspectionRole;
  readonly status: 'NONE' | 'DRAFT' | 'SUBMITTED';
  readonly submittedAt: string | null;
  readonly photos: readonly InspectionPhotoRow[];
}

export interface InspectionSlotRow {
  readonly code: string;
  readonly group: string;
  readonly required: boolean;
}

export interface InspectionViewRow {
  readonly viewerRole: InspectionRole;
  /** Fuseau IANA du pays du trip (affichage de l'heure serveur). */
  readonly timezone: string;
  readonly open: boolean;
  /** Bornes du pays (17 §7.2) ; `null` si absentes ou mal formées. */
  readonly maxKb: number | null;
  readonly maxPx: number | null;
  readonly slots: readonly InspectionSlotRow[];
  readonly sides: readonly InspectionSideRow[];
}

export interface PhotoRecord {
  readonly captureId: string;
  readonly slot: string;
  readonly fileId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
  readonly deviceCapturedAt: Date | null;
}

/** Rappel de la transaction d'un dépôt : chiffrement et dépôt de l'objet sous `storageKey`. */
export type DepositFn = (tx: SqlExecutor, storageKey: string) => Promise<void>;

export interface InspectionStore {
  /** `null` : trip inconnu, d'une autre personne ou type inconnu (NOT_FOUND). */
  view(proof: Buffer, tripId: string, kind: InspectionKind): Promise<InspectionViewRow | null>;
  openCapture(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    slot: string,
  ): Promise<{ outcome: string; captureId: string | null; expiresAt: Date | null }>;
  /** Jeton présenté, jugé AVANT l'antivirus (n'écrit rien) ; bornes du pays si `OK`. */
  captureCheck(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    captureId: string,
    slot: string,
  ): Promise<{ outcome: string; maxKb: number | null; maxPx: number | null }>;
  /**
   * Transaction : `prepare(tx)` (clé de la personne), commande d'ajout (jeton, `file_asset`,
   * photo), puis `deposit(tx, storageKey)` AVANT la validation ; tout échec annule.
   */
  addPhoto(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    photo: PhotoRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<{ outcome: string; receivedAt: Date | null }>;
  submit(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
  ): Promise<{ outcome: string; submittedAt: Date | null; missing: readonly string[] }>;
}

export class InspectionStoreError extends Error {
  override readonly name = 'InspectionStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`TRP : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Échec d'un dépôt (clé, chiffrement, stockage) : la transaction est annulée. */
export class EvidenceDepositError extends Error {
  override readonly name = 'EvidenceDepositError';
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableInspectionStore implements InspectionStore {
  #fail(): Promise<never> {
    return Promise.reject(new InspectionStoreError('photos : magasin indisponible', undefined));
  }
  view = (): Promise<InspectionViewRow | null> => this.#fail();
  openCapture = (): Promise<{
    outcome: string;
    captureId: string | null;
    expiresAt: Date | null;
  }> => this.#fail();
  captureCheck = (): Promise<{ outcome: string; maxKb: number | null; maxPx: number | null }> =>
    this.#fail();
  addPhoto = (): Promise<{ outcome: string; receivedAt: Date | null }> => this.#fail();
  submit = (): Promise<{
    outcome: string;
    submittedAt: Date | null;
    missing: readonly string[];
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
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

/** Vue jsonb de `core.trip_inspection_view` ; forme inattendue ⇒ erreur (jamais une vue partielle). */
export function parseView(v: unknown): InspectionViewRow | null {
  if (!isObj(v)) throw new InspectionStoreError('lecture des photos : vue illisible', undefined);
  if (v['outcome'] === 'NOT_FOUND') return null;
  const bad = (): never => {
    throw new InspectionStoreError('lecture des photos : vue illisible', undefined);
  };
  const role = v['viewerRole'];
  if (v['outcome'] !== 'OK' || (role !== 'HOST' && role !== 'GUEST')) return bad();
  if (typeof v['timezone'] !== 'string' || v['timezone'].length === 0) return bad();
  if (typeof v['open'] !== 'boolean' || !Array.isArray(v['slots']) || !Array.isArray(v['sides'])) {
    return bad();
  }
  const slots = (v['slots'] as unknown[]).map((s) => {
    if (!isObj(s) || typeof s['code'] !== 'string' || typeof s['group'] !== 'string') bad();
    const o = s as Readonly<Record<string, unknown>>;
    if (typeof o['required'] !== 'boolean') bad();
    return {
      code: o['code'] as string,
      group: o['group'] as string,
      required: o['required'] as boolean,
    };
  });
  const sides = (v['sides'] as unknown[]).map((s): InspectionSideRow => {
    if (!isObj(s) || (s['role'] !== 'HOST' && s['role'] !== 'GUEST')) return bad();
    const status = s['status'];
    if (status !== 'NONE' && status !== 'DRAFT' && status !== 'SUBMITTED') return bad();
    if (!Array.isArray(s['photos'])) return bad();
    const submittedAt = s['submittedAt'] === null ? null : dateOf(s['submittedAt']);
    if (s['submittedAt'] !== null && submittedAt === null) return bad();
    const photos = (s['photos'] as unknown[]).map((p): InspectionPhotoRow => {
      const at = isObj(p) ? dateOf(p['receivedAt']) : null;
      if (
        !isObj(p) ||
        typeof p['slot'] !== 'string' ||
        typeof p['fileId'] !== 'string' ||
        typeof p['sha256'] !== 'string' ||
        !HEX64.test(p['sha256']) ||
        intOrNull(p['bytes']) === null ||
        at === null ||
        typeof p['clockSkew'] !== 'boolean'
      ) {
        return bad();
      }
      return {
        slot: p['slot'],
        fileId: p['fileId'],
        sha256: p['sha256'],
        bytes: p['bytes'] as number,
        receivedAt: at.toISOString(),
        clockSkew: p['clockSkew'],
      };
    });
    return {
      role: s['role'],
      status,
      submittedAt: submittedAt === null ? null : submittedAt.toISOString(),
      photos,
    };
  });
  return {
    viewerRole: role,
    timezone: v['timezone'] as string,
    open: v['open'],
    maxKb: intOrNull(v['maxKb']),
    maxPx: intOrNull(v['maxPx']),
    slots,
    sides,
  };
}

export class PgInspectionStore implements InspectionStore {
  constructor(
    private readonly db: SqlExecutor,
    private readonly pool: SqlPool | null = null,
  ) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new InspectionStoreError(operation, sqlstateOf(error));
    }
  }

  async view(proof: Buffer, tripId: string, kind: InspectionKind) {
    const r = await this.#one<{ v: unknown }>(
      'lecture des photos',
      'SELECT core.trip_inspection_view($1, $2::uuid, $3) AS v',
      [proof, tripId, kind],
    );
    return parseView(r?.v);
  }

  async openCapture(proof: Buffer, tripId: string, kind: InspectionKind, slot: string) {
    const r = await this.#one<{ outcome: string; capture_id: string | null; expires_at: unknown }>(
      'jeton de capture',
      'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)',
      [proof, tripId, kind, slot],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      captureId: r?.capture_id ?? null,
      expiresAt: dateOf(r?.expires_at),
    };
  }

  async captureCheck(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    captureId: string,
    slot: string,
  ) {
    const r = await this.#one<{ outcome: string; max_kb: unknown; max_px: unknown }>(
      'jeton présenté',
      'SELECT * FROM core.trip_photo_capture_check($1, $2::uuid, $3, $4::uuid, $5)',
      [proof, tripId, kind, captureId, slot],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      maxKb: intOrNull(r?.max_kb),
      maxPx: intOrNull(r?.max_px),
    };
  }

  async addPhoto(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    photo: PhotoRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ) {
    if (this.pool === null) throw new InspectionStoreError('photo : pool requis', undefined);
    let client: SqlClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new InspectionStoreError('photo : connexion', sqlstateOf(error) ?? '08006');
    }
    try {
      await client.query('BEGIN');
      await prepare(client);
      const { rows } = await client.query<{
        outcome: string;
        storage_key: string | null;
        received_at: unknown;
      }>(
        `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                          $7, $8::bigint, $9, $10::timestamptz)`,
        [
          proof,
          tripId,
          kind,
          photo.captureId,
          photo.slot,
          photo.fileId,
          photo.mime,
          photo.bytes,
          photo.sha256,
          photo.deviceCapturedAt,
        ],
      );
      const r = rows[0];
      if (r === undefined || r.outcome !== 'DONE' || r.storage_key === null) {
        await client.query('ROLLBACK');
        return { outcome: r?.outcome ?? 'UNAVAILABLE', receivedAt: null };
      }
      // ligne d'abord (jeton consommé, collision refusée par la base), objet ensuite, validation enfin
      await deposit(client, r.storage_key);
      await client.query('COMMIT');
      return { outcome: 'DONE', receivedAt: dateOf(r.received_at) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof EvidenceDepositError || error instanceof InspectionStoreError) {
        throw error;
      }
      throw new InspectionStoreError('photo', sqlstateOf(error));
    } finally {
      client.release();
    }
  }

  async submit(proof: Buffer, tripId: string, kind: InspectionKind) {
    const r = await this.#one<{ outcome: string; submitted_at: unknown; missing: unknown }>(
      'validation de la série',
      'SELECT * FROM core.trip_cmd_submit_inspection($1, $2::uuid, $3)',
      [proof, tripId, kind],
    );
    const missing = Array.isArray(r?.missing)
      ? (r.missing as unknown[]).filter((m): m is string => typeof m === 'string')
      : [];
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      submittedAt: dateOf(r?.submitted_at),
      missing,
    };
  }
}
