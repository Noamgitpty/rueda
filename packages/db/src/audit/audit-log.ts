/**
 * Écriture du journal d'audit et du journal d'accès aux données (US-009 ; 17 §1.7, §3.1.3
 * points 3 et 9, §3.2.13 ; 16 ADM-001 ; ADR-051).
 *
 * - L'appelant fournit sa transaction (contexte `app.*` posé) : l'audit est atomique avec l'action.
 *   Recommandation (ADR-051) : écrire l'audit EN DERNIER dans la transaction, car la tête de chaîne
 *   est verrouillée jusqu'au COMMIT.
 * - `id`, `at`, `prev_hash` et `hash` sont attribués par la base (trigger de chaîne) : le client
 *   n'a pas le droit de les fournir.
 * - L'IP de l'acteur [C2] est chiffrée avec la clé du sujet ACTEUR (`USER:<actorUserId>`) ; si la
 *   clé n'est pas disponible (KMS injoignable) ou si le sujet est effacé, la ligne est écrite
 *   quand même, sans l'IP, avec `c2_withheld = true` (l'audit n'est jamais bloqué, la donnée
 *   personnelle n'est jamais écrite en clair, 17 §3.1.3 point 9).
 * - `before` / `after` : références et valeurs C0 / C1 seulement (17 §3.1.3 point 3). Garde-fou
 *   (défense en profondeur, non exhaustif) : refus d'une valeur qui ressemble à une adresse email
 *   ou IP.
 */
import { columnAad, seal } from './envelope.ts';
import type { SubjectRef } from './envelope.ts';
import type { Queryable, SubjectKeyStore } from './subject-keys.ts';

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOKS_PERSONAL = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/, // IPv4 (IPv6 non détectée : trop de faux positifs, ex. heures)
];

/** Valeur admise dans `before` / `after` : référence ou valeur C0 / C1. */
export type AuditValue = string | number | boolean | null | readonly AuditValue[] | AuditObject;
export interface AuditObject {
  readonly [key: string]: AuditValue;
}

export interface AuditEntry {
  /** `NULL` = système. */
  readonly actorUserId: string | null;
  readonly actorRole: string;
  readonly actionCode: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly before?: AuditObject;
  readonly after?: AuditObject;
  readonly reason?: string;
  /** IP de l'acteur [C2], en clair ; chiffrée ici avant l'écriture. */
  readonly ip?: string;
  readonly requestId?: string;
}

export interface AuditAppendResult {
  /** Vrai si l'IP n'a pas pu être chiffrée (KMS injoignable ou sujet effacé) et n'est pas écrite. */
  readonly c2Withheld: boolean;
}

/** Entrée refusée avant l'écriture (aucune valeur n'est recopiée dans le message). */
export class AuditEntryError extends Error {
  override readonly name = 'AuditEntryError';
}

function assertNoObviousPersonalData(value: AuditValue, path: string): void {
  if (typeof value === 'string') {
    if (LOOKS_PERSONAL.some((re) => re.test(value) && !UUID.test(value))) {
      throw new AuditEntryError(`${path} : donnée personnelle probable (C2) interdite en clair`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v: AuditValue, i: number) => assertNoObviousPersonalData(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoObviousPersonalData(v, `${path}.${k}`);
  }
}

function validate(entry: AuditEntry): void {
  for (const [name, v] of [
    ['actorRole', entry.actorRole],
    ['actionCode', entry.actionCode],
    ['subjectType', entry.subjectType],
  ] as const) {
    if (!CODE.test(v)) throw new AuditEntryError(`${name} : format invalide`);
  }
  if (entry.before !== undefined) assertNoObviousPersonalData(entry.before, 'before');
  if (entry.after !== undefined) assertNoObviousPersonalData(entry.after, 'after');
  if (entry.ip !== undefined && entry.actorUserId === null) {
    throw new AuditEntryError('ip : un acteur système n’a pas d’IP à journaliser');
  }
}

/** Emplacement de l'IP dans l'AAD de l'enveloppe. */
export const AUDIT_IP_TABLE = 'audit_log';
export const AUDIT_IP_COLUMN = 'ip_enc';

const INSERT_AUDIT = `
  INSERT INTO core.audit_audit_log
         (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after, reason,
          ip_enc, ip_key_subject_type, ip_key_subject_id, c2_withheld, request_id)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13)`;

/** Ajoute une ligne au journal d'audit, dans la transaction de l'appelant. */
export async function appendAuditLog(
  db: Queryable,
  keys: SubjectKeyStore,
  entry: AuditEntry,
): Promise<AuditAppendResult> {
  validate(entry);
  let ipEnc: Buffer | null = null;
  let keySubject: SubjectRef | null = null;
  let withheld = false;
  if (entry.ip !== undefined && entry.actorUserId !== null) {
    const subject: SubjectRef = { type: 'USER', id: entry.actorUserId };
    const key = await keys.dekFor(db, subject, 'create');
    if (key.status === 'OK') {
      try {
        ipEnc = seal(
          key.dek,
          Buffer.from(entry.ip, 'utf8'),
          columnAad(AUDIT_IP_TABLE, AUDIT_IP_COLUMN, subject),
        );
      } finally {
        key.dek.fill(0);
      }
      keySubject = subject;
    } else {
      withheld = true;
    }
  }
  await db.query(INSERT_AUDIT, [
    entry.actorUserId,
    entry.actorRole,
    entry.actionCode,
    entry.subjectType,
    entry.subjectId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.reason ?? null,
    ipEnc,
    keySubject?.type ?? null,
    keySubject?.id ?? null,
    withheld,
    entry.requestId ?? null,
  ]);
  return { c2Withheld: withheld };
}

export type DataAccessKind = 'READ_C3' | 'READ_C2_SUPPORT' | 'BULK_EXPORT' | 'BREAK_GLASS';

export interface DataAccessEntry {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorRole: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Nom technique du champ (`identity_document.number_enc`) ou identifiant du fichier. */
  readonly fieldOrFile: string;
  readonly purpose: string;
  readonly accessKind: DataAccessKind;
  readonly caseRef?: string;
  readonly requestId?: string;
}

/** Journalise une lecture C3, une consultation C2 du support ou un export (17 §2.3, ADM-032). */
export async function recordDataAccess(db: Queryable, entry: DataAccessEntry): Promise<void> {
  if (!CODE.test(entry.actorRole) || !CODE.test(entry.subjectType)) {
    throw new AuditEntryError('actorRole / subjectType : format invalide');
  }
  await db.query(
    `INSERT INTO core.audit_data_access_log
            (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
             access_kind, case_ref, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.id,
      entry.actorUserId,
      entry.actorRole,
      entry.subjectType,
      entry.subjectId,
      entry.fieldOrFile,
      entry.purpose,
      entry.accessKind,
      entry.caseRef ?? null,
      entry.requestId ?? null,
    ],
  );
}
