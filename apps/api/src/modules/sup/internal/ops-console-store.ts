/**
 * Port et adaptateur PostgreSQL des files de revue, de la fiche 360°, des notes internes, des
 * dossiers de support et des pièces du staff (US-109 ; 16 ADM-005, ADM-029, ADM-032 ; 17 §2.3,
 * §3.2.13 ; migration 0064, ADR-097).
 *
 * Chaque méthode est UN appel d'une commande `core.support_staff_*` (SECURITY DEFINER,
 * iam_staff_owner, EXECUTE au seul app_api) en UNE instruction, en autocommit (ADR-056 point 4) :
 * la base relit la session désignée par l'empreinte du jeton (preuve de possession), le TOTP, la
 * permission EN COURS dans le pays du sujet (jamais reçu du client) et la couverture (dossier ou
 * élément de file assigné), journalise chaque refus et chaque lecture de données personnelles
 * (`data_access_log` + audit chaîné) AVANT de rendre la donnée. L'API ne transmet jamais l'acteur.
 *
 * L'enregistrement d'une pièce est la seule écriture faite dans une transaction de l'appelant
 * (ligne `file_asset` puis dépôt du fichier : evidence.ts) : `recordEvidence` reçoit donc le
 * client de cette transaction. Erreurs de la base : seul le SQLSTATE est gardé.
 */
import type { SqlExecutor } from '../../iam/index.js';
import type { StaffActor } from './staff-context.js';

/** Issue d'une commande et son corps (références et données rendues par la base). */
export interface OpsResult {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}

export type CaseCategory =
  'TRIP' | 'PAYMENT' | 'ACCOUNT' | 'LISTING' | 'CLAIM' | 'SAFETY' | 'OTHER';
export type CasePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type CaseChannel = 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'IN_APP';
export type CaseStatus = 'PENDING' | 'RESOLVED' | 'CLOSED';

export interface EvidenceRecord {
  readonly requestId: string;
  readonly subjectUserId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
}

export interface OpsConsoleStore {
  queues(actor: StaffActor, queue: string | null, limit: number): Promise<OpsResult>;
  claim(actor: StaffActor, requestId: string, itemId: string): Promise<OpsResult>;
  kycDossier(
    actor: StaffActor,
    requestId: string,
    itemId: string,
    purpose: string,
  ): Promise<OpsResult>;
  findUser(
    actor: StaffActor,
    requestId: string,
    email: string,
    purpose: string,
  ): Promise<OpsResult>;
  profile(
    actor: StaffActor,
    requestId: string,
    userId: string,
    purpose: string,
  ): Promise<OpsResult>;
  addNote(actor: StaffActor, requestId: string, userId: string, body: string): Promise<OpsResult>;
  openCase(
    actor: StaffActor,
    requestId: string,
    requester: string,
    category: CaseCategory,
    priority: CasePriority,
    channel: CaseChannel,
  ): Promise<OpsResult>;
  setCaseStatus(
    actor: StaffActor,
    requestId: string,
    caseId: string,
    status: CaseStatus,
  ): Promise<OpsResult>;
  evidencePermitted(
    actor: StaffActor,
    requestId: string,
    subjectUserId: string,
  ): Promise<OpsResult>;
  /** Dans la transaction `tx` de l'appelant (ligne file_asset avant le dépôt). */
  recordEvidence(tx: SqlExecutor, actor: StaffActor, input: EvidenceRecord): Promise<OpsResult>;
}

/** Échec de la base (SQLSTATE seulement) ; 22023 = donnée refusée par la commande. */
export class OpsStoreError extends Error {
  override readonly name = 'OpsStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`console : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

export const QUEUES_SQL = 'SELECT outcome, body FROM core.support_staff_queues($1, $2, $3)';
export const CLAIM_SQL = 'SELECT outcome, body FROM core.support_staff_claim_item($1, $2, $3)';
export const KYC_SQL = 'SELECT outcome, body FROM core.support_staff_kyc_dossier($1, $2, $3, $4)';
export const FIND_SQL = 'SELECT outcome, body FROM core.support_staff_find_user($1, $2, $3, $4)';
export const PROFILE_SQL = 'SELECT outcome, body FROM core.support_staff_profile($1, $2, $3, $4)';
export const NOTE_SQL = 'SELECT outcome, body FROM core.support_staff_add_note($1, $2, $3, $4)';
export const OPEN_CASE_SQL =
  'SELECT outcome, body FROM core.support_staff_open_case($1, $2, $3, $4, $5, $6)';
export const CASE_STATUS_SQL =
  'SELECT outcome, body FROM core.support_staff_set_case_status($1, $2, $3, $4)';
export const EVIDENCE_PERMITTED_SQL =
  'SELECT outcome, body FROM core.support_staff_evidence_permitted($1, $2, $3)';
export const RECORD_EVIDENCE_SQL =
  'SELECT outcome, body FROM core.support_staff_record_evidence($1, $2, $3, $4, $5, $6)';

async function one(db: SqlExecutor, text: string, values: readonly unknown[]): Promise<OpsResult> {
  try {
    const { rows } = await db.query<{ outcome: string; body: Record<string, unknown> | null }>(
      text,
      values,
    );
    const r = rows[0];
    // aucune ligne : contrat rompu, traité comme un refus (fail-closed)
    return { outcome: r?.outcome ?? 'FORBIDDEN', body: r?.body ?? null };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new OpsStoreError(typeof code === 'string' ? code : undefined);
  }
}

export class PgOpsConsoleStore implements OpsConsoleStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  queues(actor: StaffActor, queue: string | null, limit: number): Promise<OpsResult> {
    return one(this.#db, QUEUES_SQL, [actor.tokenHash, queue, limit]);
  }

  claim(actor: StaffActor, requestId: string, itemId: string): Promise<OpsResult> {
    return one(this.#db, CLAIM_SQL, [actor.tokenHash, requestId, itemId]);
  }

  kycDossier(actor: StaffActor, requestId: string, itemId: string, purpose: string) {
    return one(this.#db, KYC_SQL, [actor.tokenHash, requestId, itemId, purpose]);
  }

  findUser(actor: StaffActor, requestId: string, email: string, purpose: string) {
    return one(this.#db, FIND_SQL, [actor.tokenHash, requestId, email, purpose]);
  }

  profile(actor: StaffActor, requestId: string, userId: string, purpose: string) {
    return one(this.#db, PROFILE_SQL, [actor.tokenHash, requestId, userId, purpose]);
  }

  addNote(actor: StaffActor, requestId: string, userId: string, body: string) {
    return one(this.#db, NOTE_SQL, [actor.tokenHash, requestId, userId, body]);
  }

  openCase(
    actor: StaffActor,
    requestId: string,
    requester: string,
    category: CaseCategory,
    priority: CasePriority,
    channel: CaseChannel,
  ) {
    return one(this.#db, OPEN_CASE_SQL, [
      actor.tokenHash,
      requestId,
      requester,
      category,
      priority,
      channel,
    ]);
  }

  setCaseStatus(actor: StaffActor, requestId: string, caseId: string, status: CaseStatus) {
    return one(this.#db, CASE_STATUS_SQL, [actor.tokenHash, requestId, caseId, status]);
  }

  evidencePermitted(actor: StaffActor, requestId: string, subjectUserId: string) {
    return one(this.#db, EVIDENCE_PERMITTED_SQL, [actor.tokenHash, requestId, subjectUserId]);
  }

  recordEvidence(tx: SqlExecutor, actor: StaffActor, input: EvidenceRecord) {
    return one(tx, RECORD_EVIDENCE_SQL, [
      actor.tokenHash,
      input.requestId,
      input.subjectUserId,
      input.mime,
      input.bytes,
      input.sha256,
    ]);
  }
}
