/**
 * Export et import des clés de données par sujet (US-036 critère 2 ; 17 §3.1.3 points 1 et 2,
 * §3.2.13 `subject_key`, §6.4 ; ADR-026, ADR-051, ADR-120 ; L1-PM-34).
 *
 * **Export** (ancien hébergeur, fenêtre de maintenance, écritures arrêtées) : chaque DEK vivante
 * est déroulée par le `KeyWrapper` de l'ancien hébergeur, puis ré-enveloppée pour la clé PUBLIQUE
 * de séquestre du fondateur (`EscrowSealer`) ; la DEK en clair n'existe qu'en mémoire, effacée
 * aussitôt. Une clé détruite (crypto-shredding) est exportée détruite : rien ne la ressuscite.
 * Fail-closed : une seule DEK illisible fait échouer tout l'export (aucun fichier partiel).
 *
 * **Import** (nouvel hébergeur, entre les sections `data` et `post-data` de `pg_restore`, donc
 * avant les triggers de garde et les clés étrangères) : chaque DEK est ouverte avec la clé
 * PRIVÉE de séquestre (`EscrowOpener`, fournie par le fondateur pour l'import seulement), puis
 * enveloppée par le `KeyWrapper` du NOUVEL hébergeur ; `kms_key_id` devient celui de la nouvelle
 * clé maîtresse. La table doit être vide ; tout se fait dans une seule transaction.
 *
 * Les deux opérations s'exécutent sous le rôle d'ADMINISTRATION de l'instance (outil
 * d'exploitation, comme `pg_dump` / `pg_restore`), jamais sous un rôle applicatif ; la base
 * restaurée est ensuite vérifiée sous les rôles de production (`restore/cli.ts`, L0-05).
 */
import type { SubjectRef } from '../audit/envelope.ts';
import type { KeyWrapper } from '../audit/key-wrapper.ts';
import type { Queryable } from '../audit/subject-keys.ts';
import type { EscrowOpener, EscrowSealer } from './escrow.ts';

export const ESCROW_FORMAT = 'rueda-subject-keys-escrow-v1';

export interface EscrowHeader {
  readonly format: typeof ESCROW_FORMAT;
  readonly escrow: string;
  readonly count: number;
  readonly live: number;
}

export interface EscrowedKey {
  readonly subjectType: SubjectRef['type'];
  readonly subjectId: string;
  readonly sourceKeyId: string;
  readonly createdAt: string;
  readonly destroyedAt: string | null;
  readonly destroyRequestId: string | null;
  /** DEK chiffrée pour le séquestre (base64) ; `null` pour une clé détruite. */
  readonly escrowDek: string | null;
}

export class PortabilityError extends Error {
  override readonly name = 'PortabilityError';
}

interface KeyRow {
  subject_type: SubjectRef['type'];
  subject_id: string;
  wrapped_dek: Buffer | null;
  kms_key_id: string;
  created_at: string;
  destroyed_at: string | null;
  destroy_request_id: string | null;
}

/** Horodatages en texte ISO à l'UTC : aucune perte de précision (microsecondes) à l'aller-retour. */
const SESSION_UTC = `SELECT pg_catalog.set_config('TimeZone', 'UTC', true),
                            pg_catalog.set_config('DateStyle', 'ISO, YMD', true)`;

const SELECT_KEYS = `SELECT subject_type, subject_id::text AS subject_id, wrapped_dek, kms_key_id,
                            created_at::text AS created_at, destroyed_at::text AS destroyed_at,
                            destroy_request_id::text AS destroy_request_id
                       FROM core.audit_subject_key
                      ORDER BY subject_type, subject_id`;

const INSERT_KEY = `INSERT INTO core.audit_subject_key
                      (subject_type, subject_id, wrapped_dek, kms_key_id, created_at, destroyed_at,
                       destroy_request_id)
                    VALUES ($1, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7::uuid)`;

/** Lit toutes les clés et les ré-enveloppe pour le séquestre ; rend l'en-tête et les lignes. */
export async function exportSubjectKeys(
  admin: Queryable,
  source: KeyWrapper,
  sealer: EscrowSealer,
): Promise<{ header: EscrowHeader; keys: EscrowedKey[] }> {
  await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await admin.query(SESSION_UTC);
    const { rows } = await admin.query<KeyRow>(SELECT_KEYS);
    const keys: EscrowedKey[] = [];
    for (const r of rows) {
      const subject: SubjectRef = { type: r.subject_type, id: r.subject_id };
      let escrowDek: string | null = null;
      if (r.destroyed_at === null) {
        if (r.wrapped_dek === null) throw new PortabilityError('clé vivante sans DEK enveloppée');
        let dek: Buffer;
        try {
          dek = await source.unwrap(r.wrapped_dek, r.kms_key_id, subject);
        } catch (error) {
          const why = error instanceof Error ? error.name : 'erreur';
          throw new PortabilityError(`DEK illisible par la clé source (${why}) : export refusé`);
        }
        try {
          escrowDek = sealer.seal(dek, subject).toString('base64');
        } finally {
          dek.fill(0);
        }
      }
      keys.push({
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        sourceKeyId: r.kms_key_id,
        createdAt: r.created_at,
        destroyedAt: r.destroyed_at,
        destroyRequestId: r.destroy_request_id,
        escrowDek,
      });
    }
    await admin.query('COMMIT');
    return {
      header: {
        format: ESCROW_FORMAT,
        escrow: sealer.fingerprint,
        count: keys.length,
        live: keys.filter((k) => k.escrowDek !== null).length,
      },
      keys,
    };
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Sérialise l'export en JSON Lines : l'en-tête, puis une ligne par clé. */
export function serializeKeys(header: EscrowHeader, keys: readonly EscrowedKey[]): string {
  return [header, ...keys].map((x) => JSON.stringify(x)).join('\n') + '\n';
}

const SUBJECT_TYPES: readonly string[] = ['USER', 'ORG', 'PLATFORM'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Relit un export ; refuse un format inconnu, un compte faux ou une ligne mal formée. */
export function parseKeys(text: string): { header: EscrowHeader; keys: EscrowedKey[] } {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const [first, ...rest] = lines;
  if (first === undefined) throw new PortabilityError('export des clés vide');
  const header = JSON.parse(first) as EscrowHeader;
  if (header.format !== ESCROW_FORMAT) throw new PortabilityError('format d’export inconnu');
  const keys = rest.map((l) => JSON.parse(l) as EscrowedKey);
  if (keys.length !== header.count) throw new PortabilityError('export des clés incomplet');
  for (const k of keys) {
    if (!SUBJECT_TYPES.includes(k.subjectType) || !UUID.test(k.subjectId)) {
      throw new PortabilityError('ligne de clé mal formée');
    }
    if ((k.destroyedAt === null) !== (k.escrowDek !== null)) {
      throw new PortabilityError('clé vivante sans séquestre, ou clé détruite avec séquestre');
    }
  }
  if (keys.filter((k) => k.escrowDek !== null).length !== header.live) {
    throw new PortabilityError('export des clés incohérent (clés vivantes)');
  }
  return { header, keys };
}

/** Importe les clés dans une base restaurée (table vide), ré-enveloppées par `target`. */
export async function importSubjectKeys(
  admin: Queryable,
  opener: EscrowOpener,
  target: KeyWrapper,
  exported: { header: EscrowHeader; keys: readonly EscrowedKey[] },
): Promise<{ imported: number; live: number }> {
  if (exported.header.escrow !== opener.fingerprint) {
    throw new PortabilityError('clé de séquestre différente de celle de l’export');
  }
  await admin.query('BEGIN');
  try {
    await admin.query(SESSION_UTC);
    const existing = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM core.audit_subject_key',
    );
    if (Number(existing.rows[0]?.n ?? '0') !== 0) {
      throw new PortabilityError('la base cible a déjà des clés de sujet : import refusé');
    }
    let live = 0;
    for (const k of exported.keys) {
      const subject: SubjectRef = { type: k.subjectType, id: k.subjectId };
      let wrapped: Buffer | null = null;
      let keyId = k.sourceKeyId;
      if (k.escrowDek !== null) {
        const dek = opener.open(Buffer.from(k.escrowDek, 'base64'), subject);
        try {
          wrapped = await target.wrap(dek, subject);
          const back = await target.unwrap(wrapped, target.keyId, subject);
          const same = back.equals(dek);
          back.fill(0);
          if (!same) throw new PortabilityError('ré-enveloppe non relisible : import refusé');
        } finally {
          dek.fill(0);
        }
        keyId = target.keyId;
        live += 1;
      }
      await admin.query(INSERT_KEY, [
        k.subjectType,
        k.subjectId,
        wrapped,
        keyId,
        k.createdAt,
        k.destroyedAt,
        k.destroyRequestId,
      ]);
    }
    await admin.query('COMMIT');
    return { imported: exported.keys.length, live };
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
