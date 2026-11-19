/**
 * Magasin de la messagerie par trip (US-525, ADR-181) : port et lecture STRICTE des lignes de la
 * base (fonctions `core.messaging_thread_read` et `core.messaging_cmd_post_message` de 0160,
 * SECURITY DEFINER, EXECUTE au seul `app_api`). La base juge la partie du trip de la SESSION,
 * masque les coordonnées et signale le marché gris ; l'API ne fait que traduire. Toute forme
 * inattendue ⇒ erreur (fail-closed : jamais un fil deviné, jamais un succès supposé). Aucune erreur
 * ne porte le texte d'un message : SQLSTATE seulement.
 */

export const VIEWER_ROLES = ['GUEST', 'HOST', 'CO_HOST'] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

export interface StoredMessage {
  readonly id: string;
  readonly mine: boolean;
  readonly authorRole: ViewerRole;
  readonly authorName: string | null;
  /** Texte SERVI (coordonnées masquées) ; `null` : message masqué par l'ops (`hidden_at`). */
  readonly body: string | null;
  readonly masked: boolean;
  /** Proposition de paiement hors plateforme dans un message de la session (rappel). */
  readonly offPlatform: boolean;
  readonly sentAt: Date;
}

export type ThreadReadResult =
  | {
      readonly outcome: 'DONE';
      readonly viewerRole: ViewerRole;
      readonly counterpartName: string | null;
      readonly writable: boolean;
      readonly closesAt: Date | null;
      /** Fuseau du trip (IANA), pour l'affichage des heures. */
      readonly timezone: string;
      readonly messages: readonly StoredMessage[];
    }
  | { readonly outcome: 'AUTH_REQUIRED' | 'NOT_FOUND' | 'REQUEST_INVALID' };

export type PostResult =
  | {
      readonly outcome: 'DONE';
      readonly id: string;
      readonly body: string;
      readonly masked: boolean;
      readonly offPlatform: boolean;
      readonly sentAt: Date;
    }
  | {
      readonly outcome:
        | 'AUTH_REQUIRED'
        | 'NOT_FOUND'
        | 'MESSAGE_THREAD_CLOSED'
        | 'MESSAGE_INVALID'
        | 'REQUEST_INVALID';
    };

export interface TripMessageStore {
  read(proof: Buffer, tripId: string, limit: number): Promise<ThreadReadResult>;
  post(proof: Buffer, tripId: string, messageId: string, body: string): Promise<PostResult>;
}

export class TripMessageStoreError extends Error {
  override readonly name = 'TripMessageStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(
      `messagerie (${operation}) : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`,
    );
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableTripMessageStore implements TripMessageStore {
  read(): Promise<ThreadReadResult> {
    return Promise.reject(new TripMessageStoreError('read', undefined));
  }

  post(): Promise<PostResult> {
    return Promise.reject(new TripMessageStoreError('post', undefined));
  }
}

/** Exécuteur SQL (pool `pg` sous `app_api`). */
export interface MsgSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export const THREAD_SQL = 'SELECT * FROM core.messaging_thread_read($1, $2::uuid, $3)';
export const POST_SQL = 'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)';

const READ_REFUSALS = ['AUTH_REQUIRED', 'NOT_FOUND', 'REQUEST_INVALID'] as const;
const POST_REFUSALS = [
  'AUTH_REQUIRED',
  'NOT_FOUND',
  'MESSAGE_THREAD_CLOSED',
  'MESSAGE_INVALID',
  'REQUEST_INVALID',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new TripMessageStoreError(`${operation}: issue inconnue`, undefined);
}

function bool(value: unknown, operation: string): boolean {
  if (typeof value !== 'boolean') throw new TripMessageStoreError(`${operation}: forme`, undefined);
  return value;
}

function date(value: unknown, operation: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TripMessageStoreError(`${operation}: forme`, undefined);
  }
  return value;
}

function textOrNull(value: unknown, operation: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TripMessageStoreError(`${operation}: forme`, undefined);
  return value;
}

function uuidOf(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TripMessageStoreError(`${operation}: forme`, undefined);
  }
  return value;
}

/** Lignes de `core.messaging_thread_read` : en-tête répété, une ligne par message (ou aucune). */
export function threadOf(rows: readonly Record<string, unknown>[]): ThreadReadResult {
  const [head] = rows;
  if (head === undefined) throw new TripMessageStoreError('read: aucune ligne', undefined);
  if (head['outcome'] !== 'DONE') {
    if (rows.length !== 1) throw new TripMessageStoreError('read: forme', undefined);
    return { outcome: member(READ_REFUSALS, head['outcome'], 'read') };
  }
  const viewerRole = member(VIEWER_ROLES, head['viewer_role'], 'read');
  const counterpartName = textOrNull(head['counterpart_name'], 'read');
  const writable = bool(head['writable'], 'read');
  const closesAt = head['closes_at'] === null ? null : date(head['closes_at'], 'read');
  const timezone = head['timezone'];
  if (typeof timezone !== 'string' || !/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(timezone)) {
    throw new TripMessageStoreError('read: forme', undefined);
  }
  const messages: StoredMessage[] = [];
  for (const r of rows) {
    // en-tête identique sur chaque ligne (une seule instruction, un seul instantané)
    if (
      r['outcome'] !== 'DONE' ||
      r['viewer_role'] !== viewerRole ||
      r['counterpart_name'] !== counterpartName ||
      r['writable'] !== writable ||
      r['timezone'] !== timezone
    ) {
      throw new TripMessageStoreError('read: en-tête incohérent', undefined);
    }
    if (r['message_id'] === null) {
      if (rows.length !== 1) throw new TripMessageStoreError('read: forme', undefined);
      continue;
    }
    messages.push({
      id: uuidOf(r['message_id'], 'read'),
      mine: bool(r['mine'], 'read'),
      authorRole: member(VIEWER_ROLES, r['author_role'], 'read'),
      authorName: textOrNull(r['author_name'], 'read'),
      body: textOrNull(r['body'], 'read'),
      masked: bool(r['masked'], 'read'),
      offPlatform: bool(r['off_platform'], 'read'),
      sentAt: date(r['sent_at'], 'read'),
    });
  }
  return { outcome: 'DONE', viewerRole, counterpartName, writable, closesAt, timezone, messages };
}

/** Ligne de `core.messaging_cmd_post_message`. */
export function postOf(rows: readonly Record<string, unknown>[]): PostResult {
  const [r] = rows;
  if (r === undefined || rows.length !== 1) {
    throw new TripMessageStoreError('post: forme', undefined);
  }
  if (r['outcome'] !== 'DONE') return { outcome: member(POST_REFUSALS, r['outcome'], 'post') };
  const body = textOrNull(r['body'], 'post');
  if (body === null || body.length === 0) throw new TripMessageStoreError('post: forme', undefined);
  return {
    outcome: 'DONE',
    id: uuidOf(r['message_id'], 'post'),
    body,
    masked: bool(r['masked'], 'post'),
    offPlatform: bool(r['off_platform'], 'post'),
    sentAt: date(r['sent_at'], 'post'),
  };
}

export class PgTripMessageStore implements TripMessageStore {
  readonly #db: MsgSqlExecutor;

  constructor(db: MsgSqlExecutor) {
    this.#db = db;
  }

  async #run(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<Record<string, unknown>[]> {
    try {
      return (await this.#db.query<Record<string, unknown>>(text, values)).rows;
    } catch (error) {
      const { code } = error as { code?: unknown };
      throw new TripMessageStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async read(proof: Buffer, tripId: string, limit: number): Promise<ThreadReadResult> {
    return threadOf(await this.#run('read', THREAD_SQL, [proof, tripId, limit]));
  }

  async post(proof: Buffer, tripId: string, messageId: string, body: string): Promise<PostResult> {
    return postOf(await this.#run('post', POST_SQL, [proof, tripId, messageId, body]));
  }
}
