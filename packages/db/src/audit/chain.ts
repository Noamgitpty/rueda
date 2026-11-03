/**
 * Chaîne de hachage du journal d'audit (US-009 ; 17 §1.7, §3.1.3 point 3 ; ADR-051).
 *
 * Vérificateur INDÉPENDANT du trigger SQL `zz_audit_log_chain` (migration 0151) : la forme
 * canonique v1 est réécrite ici d'après ADR-051, sans lire `core.audit_log_canonical`. Les deux
 * implémentations doivent s'accorder sur chaque ligne ; un écart signale une altération (ou un
 * défaut de l'une des deux, ce que les tests unitaires bornent par un vecteur écrit à la main).
 *
 * Forme canonique v1 (UTF-8) : l'en-tête `rueda.audit_log.v1`, puis une ligne `nom=champ` par
 * colonne, chacune terminée par LF, dans l'ordre de `CANONICAL_FIELDS` ; un champ vaut `~` s'il
 * est NULL, sinon `<longueur en octets UTF-8>:<texte>`. `hash = SHA-256(forme canonique)`.
 */
import { createHash } from 'node:crypto';

export const AUDIT_CHAIN_VERSION = 'rueda.audit_log.v1';

/** `prev_hash` de la première ligne : 32 octets nuls. */
export const AUDIT_CHAIN_GENESIS: Buffer = Buffer.alloc(32);

/**
 * Une ligne du journal, telle que lue en base. Les champs dont la représentation texte vient de
 * PostgreSQL sont lus comme texte par la requête (`AUDIT_CHAIN_SELECT`) : l'instant en
 * microsecondes depuis l'époque (`at_us`, une `Date` JavaScript perdrait les microsecondes) et
 * les `jsonb` (`before_text`, `after_text`, forme texte normalisée de PostgreSQL).
 */
export interface AuditChainRow {
  readonly id: string;
  readonly atUs: string;
  readonly actorUserId: string | null;
  readonly actorRole: string;
  readonly actionCode: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly beforeText: string | null;
  readonly afterText: string | null;
  readonly reason: string | null;
  readonly ipEnc: Buffer | null;
  readonly ipKeySubjectType: string | null;
  readonly ipKeySubjectId: string | null;
  readonly c2Withheld: boolean;
  readonly requestId: string | null;
  readonly prevHash: Buffer;
  readonly hash: Buffer;
}

const canon = (value: string | null): string =>
  value === null ? '~' : `${Buffer.byteLength(value, 'utf8')}:${value}`;

/** Forme canonique v1 d'une ligne (ADR-051). */
export function canonicalAuditRow(row: Omit<AuditChainRow, 'hash'>): string {
  const fields: ReadonlyArray<readonly [string, string | null]> = [
    ['id', row.id],
    ['at_us', row.atUs],
    ['actor_user_id', row.actorUserId],
    ['actor_role', row.actorRole],
    ['action_code', row.actionCode],
    ['subject_type', row.subjectType],
    ['subject_id', row.subjectId],
    ['before', row.beforeText],
    ['after', row.afterText],
    ['reason', row.reason],
    ['ip_enc', row.ipEnc === null ? null : row.ipEnc.toString('hex')],
    ['ip_key_subject_type', row.ipKeySubjectType],
    ['ip_key_subject_id', row.ipKeySubjectId],
    ['c2_withheld', row.c2Withheld ? 'true' : 'false'],
    ['request_id', row.requestId],
    ['prev_hash', row.prevHash.toString('hex')],
  ];
  let out = `${AUDIT_CHAIN_VERSION}\n`;
  for (const [name, value] of fields) out += `${name}=${canon(value)}\n`;
  return out;
}

/** `SHA-256(forme canonique)`. */
export function auditRowHash(row: Omit<AuditChainRow, 'hash'>): Buffer {
  return createHash('sha256').update(canonicalAuditRow(row), 'utf8').digest();
}

export type AuditChainBreakReason =
  /** les id ne se suivent pas (ligne supprimée, insérée ou réordonnée) */
  | 'ID_GAP'
  /** `prev_hash` ≠ hachage de la ligne précédente (ou ≠ genèse pour la première) */
  | 'PREV_HASH_MISMATCH'
  /** le hachage recalculé ≠ le hachage stocké (ligne modifiée) */
  | 'HASH_MISMATCH'
  /** la dernière ligne ne correspond pas à la tête attendue (fin tronquée ou tête altérée) */
  | 'HEAD_MISMATCH';

export interface AuditChainBreak {
  /** Identifiant de la première ligne fautive (ou de la tête). */
  readonly id: string;
  readonly reason: AuditChainBreakReason;
}

export type AuditChainResult =
  | {
      readonly ok: true;
      readonly count: number;
      readonly lastId: string;
      readonly lastHash: Buffer;
    }
  | { readonly ok: false; readonly break: AuditChainBreak };

export interface AuditChainHead {
  readonly lastId: string;
  readonly lastHash: Buffer;
}

/**
 * Vérifie une chaîne COMPLÈTE, lue depuis l'id 1 dans l'ordre des id. Fail-closed : la première
 * anomalie arrête la vérification. `expectedHead` (tête de `core.audit_chain_head` ou ancrage
 * externe) détecte en plus une troncature de la fin.
 */
export function verifyAuditChain(
  rows: readonly AuditChainRow[],
  expectedHead?: AuditChainHead,
): AuditChainResult {
  let prevHash = AUDIT_CHAIN_GENESIS;
  let expectedId = 1n;
  for (const row of rows) {
    if (row.id !== expectedId.toString())
      return { ok: false, break: { id: row.id, reason: 'ID_GAP' } };
    if (!row.prevHash.equals(prevHash)) {
      return { ok: false, break: { id: row.id, reason: 'PREV_HASH_MISMATCH' } };
    }
    if (!auditRowHash(row).equals(row.hash)) {
      return { ok: false, break: { id: row.id, reason: 'HASH_MISMATCH' } };
    }
    prevHash = row.hash;
    expectedId++;
  }
  const lastId = (expectedId - 1n).toString();
  if (
    expectedHead !== undefined &&
    (expectedHead.lastId !== lastId || !expectedHead.lastHash.equals(prevHash))
  ) {
    return { ok: false, break: { id: expectedHead.lastId, reason: 'HEAD_MISMATCH' } };
  }
  return { ok: true, count: rows.length, lastId, lastHash: prevHash };
}

/**
 * Requête de relecture de la chaîne, sous `app_worker` avec `app.worker_name` =
 * `audit_chain_verifier` (seul lecteur autorisé, migration 0155). Projection seulement : aucun
 * calcul de hachage côté SQL. `$1` = dernier id de la tête lue JUSTE AVANT (même transaction) :
 * sous READ COMMITTED, des écritures validées entre les deux lectures ne faussent pas la
 * comparaison avec la tête (les validations suivent l'ordre des id, ADR-051). Tri sur `l.id`
 * (bigint) et non sur l'alias texte `id` (« 10 » trierait avant « 9 »).
 */
export const AUDIT_CHAIN_SELECT = `
  SELECT id::text AS id,
         ((EXTRACT(epoch FROM at) * 1000000)::bigint)::text AS at_us,
         actor_user_id::text AS actor_user_id, actor_role, action_code, subject_type,
         subject_id::text AS subject_id, before::text AS before_text, after::text AS after_text,
         reason, ip_enc, ip_key_subject_type, ip_key_subject_id::text AS ip_key_subject_id,
         c2_withheld, request_id::text AS request_id, prev_hash, hash
    FROM core.audit_audit_log l
   WHERE l.id <= $1
   ORDER BY l.id`;

/** Ligne brute renvoyée par `AUDIT_CHAIN_SELECT` (pilote `pg`). */
export interface AuditChainDbRow {
  id: string;
  at_us: string;
  actor_user_id: string | null;
  actor_role: string;
  action_code: string;
  subject_type: string;
  subject_id: string;
  before_text: string | null;
  after_text: string | null;
  reason: string | null;
  ip_enc: Buffer | null;
  ip_key_subject_type: string | null;
  ip_key_subject_id: string | null;
  c2_withheld: boolean;
  request_id: string | null;
  prev_hash: Buffer;
  hash: Buffer;
}

export function fromDbRow(r: AuditChainDbRow): AuditChainRow {
  return {
    id: r.id,
    atUs: r.at_us,
    actorUserId: r.actor_user_id,
    actorRole: r.actor_role,
    actionCode: r.action_code,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    beforeText: r.before_text,
    afterText: r.after_text,
    reason: r.reason,
    ipEnc: r.ip_enc,
    ipKeySubjectType: r.ip_key_subject_type,
    ipKeySubjectId: r.ip_key_subject_id,
    c2Withheld: r.c2_withheld,
    requestId: r.request_id,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}
