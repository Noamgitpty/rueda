/**
 * Demande d'aide pendant le trip (US-310, ADR-182 ; 16 SUP-004) : port du magasin et adaptateur
 * PostgreSQL. La base juge tout (0162) : la personne de la SESSION (empreinte du jeton, jamais un
 * identifiant reçu), son rôle dans le trip (voyageur, titulaire du compte d'hôte), le pays du trip,
 * le « hors plage » à son horloge et au fuseau du pays, l'idempotence et la demande vivante. Une
 * instruction par appel, en autocommit (une connexion par appel, libérée par le pool).
 */
import type { StaffActor } from '../staff-context.js';

/** Exécuteur SQL minimal (pool `pg` ou client de transaction). */
export interface SqlExecutor {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Motifs fermés d'une demande d'aide (0162 `help_topic`) : aucun texte libre (minimisation). */
export const HELP_TOPICS = ['ACCIDENT', 'BREAKDOWN', 'HANDOVER', 'SAFETY', 'OTHER'] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export type HelpRole = 'GUEST' | 'HOST';

/** Plage du support transmise à la base (heures locales du pays) ; `null` : non publiée. */
export interface HelpHours {
  readonly from: string;
  readonly to: string;
}

export interface HelpContextRow {
  /** `DONE`, `AUTH_REQUIRED`, `NOT_FOUND`. */
  readonly outcome: string;
  readonly role: HelpRole | null;
  readonly country: string | null;
}

export interface HelpOpenRow {
  /** `OPENED`, `DUPLICATE`, `EXISTS`, `AUTH_REQUIRED`, `NOT_FOUND`. */
  readonly outcome: string;
  readonly caseId: string | null;
  readonly offHours: boolean | null;
  readonly role: HelpRole | null;
  readonly country: string | null;
}

export interface HelpStaffResult {
  /** `OK`, `AUTH_REQUIRED`, `MFA_REQUIRED`, `FORBIDDEN`. */
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}

export interface HelpStore {
  context(proof: Buffer, tripId: string): Promise<HelpContextRow>;
  open(
    proof: Buffer,
    requestId: string,
    tripId: string,
    topic: HelpTopic,
    hours: HelpHours | null,
  ): Promise<HelpOpenRow>;
  staffRequests(actor: StaffActor, country: string | null, limit: number): Promise<HelpStaffResult>;
}

export class HelpStoreError extends Error {
  override readonly name = 'HelpStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`aide : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableHelpStore implements HelpStore {
  context(): Promise<HelpContextRow> {
    return Promise.reject(new HelpStoreError(undefined));
  }
  open(): Promise<HelpOpenRow> {
    return Promise.reject(new HelpStoreError(undefined));
  }
  staffRequests(): Promise<HelpStaffResult> {
    return Promise.reject(new HelpStoreError(undefined));
  }
}

export const HELP_CONTEXT_SQL =
  'SELECT outcome, requester_role, country_code FROM core.support_trip_help_context($1, $2::uuid)';
export const HELP_OPEN_SQL = `SELECT outcome, case_id, off_hours, requester_role, country_code
  FROM core.support_cmd_open_help_request($1, $2::uuid, $3::uuid, $4, $5::jsonb)`;
export const HELP_STAFF_SQL =
  'SELECT outcome, body FROM core.support_staff_help_requests($1, $2, $3)';

const ROLE = (v: unknown): HelpRole | null => (v === 'GUEST' || v === 'HOST' ? v : null);
const TEXT = (v: unknown): string | null => (typeof v === 'string' ? v : null);

async function rowsOf(
  db: SqlExecutor,
  text: string,
  values: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  try {
    return (await db.query<Record<string, unknown>>(text, values)).rows;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new HelpStoreError(typeof code === 'string' ? code : undefined);
  }
}

export class PgHelpStore implements HelpStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async context(proof: Buffer, tripId: string): Promise<HelpContextRow> {
    const r = (await rowsOf(this.#db, HELP_CONTEXT_SQL, [proof, tripId]))[0];
    // aucune ligne : contrat rompu (fail-closed, traité comme un trip absent)
    return {
      outcome: TEXT(r?.['outcome']) ?? 'NOT_FOUND',
      role: ROLE(r?.['requester_role']),
      country: TEXT(r?.['country_code']),
    };
  }

  async open(
    proof: Buffer,
    requestId: string,
    tripId: string,
    topic: HelpTopic,
    hours: HelpHours | null,
  ): Promise<HelpOpenRow> {
    const r = (
      await rowsOf(this.#db, HELP_OPEN_SQL, [
        proof,
        requestId,
        tripId,
        topic,
        hours === null ? null : JSON.stringify({ from: hours.from, to: hours.to }),
      ])
    )[0];
    return {
      outcome: TEXT(r?.['outcome']) ?? 'NOT_FOUND',
      caseId: TEXT(r?.['case_id']),
      offHours: typeof r?.['off_hours'] === 'boolean' ? r['off_hours'] : null,
      role: ROLE(r?.['requester_role']),
      country: TEXT(r?.['country_code']),
    };
  }

  async staffRequests(
    actor: StaffActor,
    country: string | null,
    limit: number,
  ): Promise<HelpStaffResult> {
    const r = (await rowsOf(this.#db, HELP_STAFF_SQL, [actor.tokenHash, country, limit]))[0];
    const body = r?.['body'];
    return {
      outcome: TEXT(r?.['outcome']) ?? 'FORBIDDEN',
      body: body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    };
  }
}
