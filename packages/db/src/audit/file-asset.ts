/**
 * Magasin de preuves : réception d'un fichier avec empreinte SHA-256 et recalcul (US-009 ;
 * 17 §1.7 « empreinte SHA-256 calculée à la réception et heure serveur » (CLM-034), §3.1.3
 * point 1, §3.2.13 `file_asset` ; ADR-051).
 *
 * - L'empreinte porte sur les octets REÇUS (le clair), calculée en flux pendant la réception,
 *   avant tout chiffrement ; `server_received_at` = `platform.now()` (défaut de la base, jamais
 *   fourni par le client).
 * - Un fichier C2 / C3 est chiffré avec la clé de son sujet avant le dépôt (enveloppe v1, AAD liée
 *   à l'identifiant du fichier) ; la base refuse un fichier C2 / C3 sans clé de sujet.
 * - `verifyFileAsset` relit l'objet, le déchiffre si besoin, recalcule l'empreinte et la compare
 *   à `file_asset.sha256` (critère US-009). Lecture réservée au travailleur `evidence_verifier`.
 *
 * Bêta : le corps est assemblé en mémoire (`maxBytes`), le port FileStore réel (S3, URL signées,
 * verrou objet) arrive avec US-003 ; antivirus : port `UploadScanner` (`upload-scanner.ts`,
 * US-020), branché sur la réception par la story du téléversement.
 */
import { createHash } from 'node:crypto';
import { fileAad, open, seal } from './envelope.ts';
import type { SubjectRef } from './envelope.ts';
import type { Queryable, SubjectKeyStore } from './subject-keys.ts';

export type Bucket = 'PUBLIC_LISTING' | 'PRIVATE_EVIDENCE' | 'KYC' | 'DOCUMENTS' | 'BRAND';
/** `HOST_UPLOAD` : photo d'annonce téléversée par l'hôte (US-115, 0067). */
export type FileSource =
  'IN_APP_CAMERA' | 'STAFF_UPLOAD' | 'GENERATED' | 'PROVIDER' | 'HOST_UPLOAD';
export type Classification = 'C0' | 'C1' | 'C2' | 'C3';

/**
 * Port `FileStore` (17 §5, module AUD). Adaptateur FAKE : `@rueda/fake-adapters/files`
 * (`InMemoryFileStore`, US-020) ; adaptateur réel : US-003.
 *
 * Contrat de `put` : **création seule**. Si un objet existe déjà sous `(bucket, key)`, `put` rend
 * `CONFLICT` et l'objet existant reste intact ; un objet n'est JAMAIS écrasé (une preuve ne change
 * pas d'octets). Adaptateur réel (US-003) : écriture conditionnelle (`If-None-Match: *` sur S3) et
 * verrou objet du bucket `PRIVATE_EVIDENCE`.
 *
 * Les échecs sont des **valeurs** (US-020, ADR-058) : `UNAVAILABLE` (rien n'est fait), `TIMEOUT`
 * (issue inconnue : l'objet a pu être déposé), `NOT_FOUND`. Ainsi le FAKE, dans un paquet feuille,
 * se conforme au port sans importer `@rueda/db` (pas de cycle de paquets).
 */
export interface FileStore {
  readonly put: (bucket: Bucket, key: string, body: Buffer) => Promise<FileStorePutResult>;
  readonly get: (bucket: Bucket, key: string) => Promise<FileStoreGetResult>;
}

export type FileStorePutResult =
  | { readonly status: 'STORED' }
  | { readonly status: 'CONFLICT' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export type FileStoreGetResult =
  | { readonly status: 'FOUND'; readonly body: Buffer }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

/** Un objet existe déjà sous cette clé : refus, rien n'est écrasé (contrat de `FileStore.put`). */
export class FileStoreConflictError extends Error {
  override readonly name = 'FileStoreConflictError';
}

/** SHA-256 calculé en flux. */
export async function sha256Stream(
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<{ readonly sha256: Buffer; readonly bytes: number; readonly content: Buffer }> {
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new FileAssetError('fichier trop volumineux');
    hash.update(chunk);
    chunks.push(Buffer.from(chunk));
  }
  return { sha256: hash.digest(), bytes, content: Buffer.concat(chunks) };
}

export class FileAssetError extends Error {
  override readonly name = 'FileAssetError';
}

export interface ReceiveFileInput {
  readonly id: string;
  readonly bucket: Bucket;
  readonly storageKey: string;
  readonly mime: string;
  readonly uploaderUserId: string | null;
  readonly source: FileSource;
  readonly deviceCapturedAt?: Date;
  readonly classification: Classification;
  readonly retentionClass: string;
  /** Sujet dont la clé chiffre le fichier ; obligatoire pour C2 / C3. */
  readonly encryptFor?: SubjectRef;
  /** Taille maximale admise (Bêta : assemblage en mémoire). */
  readonly maxBytes?: number;
}

export interface ReceivedFile {
  readonly sha256: Buffer;
  readonly bytes: number;
  readonly encrypted: boolean;
}

/**
 * Reçoit un fichier : empreinte et taille en flux, chiffrement par sujet si C2 / C3, ligne
 * `file_asset` dans la transaction de l'appelant, puis dépôt en création seule. Fail-closed : sans
 * clé de sujet disponible, un fichier C2 / C3 n'est PAS déposé ; une collision de `storage_key`
 * est refusée (23505) sans toucher à l'objet existant.
 */
export async function receiveFile(
  db: Queryable,
  store: FileStore,
  keys: SubjectKeyStore,
  input: ReceiveFileInput,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<ReceivedFile> {
  const personal = input.classification === 'C2' || input.classification === 'C3';
  if (personal && input.encryptFor === undefined) {
    throw new FileAssetError('un fichier C2 / C3 est chiffré avec la clé de son sujet');
  }
  const received = await sha256Stream(body, input.maxBytes);
  let stored = received.content;
  if (input.encryptFor !== undefined) {
    const key = await keys.dekFor(db, input.encryptFor, 'create');
    if (key.status !== 'OK') {
      throw new FileAssetError(`clé du sujet indisponible (${key.status}) : fichier non déposé`);
    }
    try {
      stored = seal(key.dek, received.content, fileAad(input.id, input.encryptFor));
    } finally {
      key.dek.fill(0);
    }
  }
  // La ligne D'ABORD : la contrainte UNIQUE (bucket, storage_key) refuse une collision avant que
  // le stockage ne soit touché, et la transaction de l'appelant porte l'annulation. Le dépôt
  // ENSUITE, en création seule : un objet existant sans ligne (orphelin) est refusé, pas écrasé.
  await db.query(
    `INSERT INTO core.audit_file_asset
            (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source,
             device_captured_at, classification, retention_class, enc_subject_type, enc_subject_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.id,
      input.bucket,
      input.storageKey,
      input.mime,
      received.bytes,
      received.sha256,
      input.uploaderUserId,
      input.source,
      input.deviceCapturedAt ?? null,
      input.classification,
      input.retentionClass,
      input.encryptFor?.type ?? null,
      input.encryptFor?.id ?? null,
    ],
  );
  const put = await store.put(input.bucket, input.storageKey, stored);
  if (put.status === 'CONFLICT') throw new FileStoreConflictError('objet déjà présent');
  if (put.status !== 'STORED') {
    // Issue inconnue ou panne : l'exception annule la transaction de l'appelant (la ligne
    // file_asset disparaît). Après TIMEOUT, un objet orphelin peut rester : nouvelle clé au rejeu.
    throw new FileAssetError(`stockage indisponible (${put.status}) : fichier non reçu`);
  }
  return {
    sha256: received.sha256,
    bytes: received.bytes,
    encrypted: input.encryptFor !== undefined,
  };
}

export type FileVerification =
  | { readonly status: 'MATCH'; readonly sha256: Buffer }
  | { readonly status: 'MISMATCH'; readonly expected: Buffer; readonly actual: Buffer }
  /** Objet illisible : octets chiffrés altérés, clé du sujet détruite / indisponible, objet absent. */
  | {
      readonly status: 'UNREADABLE';
      readonly reason: 'DECRYPT_FAILED' | 'KEY_DESTROYED' | 'KEY_WITHHELD' | 'OBJECT_MISSING';
    }
  | { readonly status: 'UNKNOWN_FILE' };

interface FileAssetRow {
  bucket: Bucket;
  storage_key: string;
  sha256: Buffer;
  enc_subject_type: SubjectRef['type'] | null;
  enc_subject_id: string | null;
}

/** Recalcule l'empreinte d'un fichier et la compare à `file_asset.sha256`. */
export async function verifyFileAsset(
  db: Queryable,
  store: FileStore,
  keys: SubjectKeyStore,
  fileId: string,
): Promise<FileVerification> {
  const { rows } = await db.query<FileAssetRow>(
    `SELECT bucket, storage_key, sha256, enc_subject_type, enc_subject_id::text AS enc_subject_id
       FROM core.audit_file_asset WHERE id = $1`,
    [fileId],
  );
  const row = rows[0];
  if (row === undefined) return { status: 'UNKNOWN_FILE' };
  const got = await store.get(row.bucket, row.storage_key);
  if (got.status === 'NOT_FOUND') return { status: 'UNREADABLE', reason: 'OBJECT_MISSING' };
  if (got.status !== 'FOUND') {
    // Panne passagère : pas un verdict sur la preuve, l'appelant réessaiera.
    throw new FileAssetError(`stockage indisponible (${got.status}) : vérification reportée`);
  }
  let content = got.body;
  if (row.enc_subject_type !== null && row.enc_subject_id !== null) {
    const subject: SubjectRef = { type: row.enc_subject_type, id: row.enc_subject_id };
    const key = await keys.dekFor(db, subject, 'read');
    if (key.status === 'DESTROYED') return { status: 'UNREADABLE', reason: 'KEY_DESTROYED' };
    if (key.status !== 'OK') return { status: 'UNREADABLE', reason: 'KEY_WITHHELD' };
    try {
      content = open(key.dek, content, fileAad(fileId, subject));
    } catch {
      return { status: 'UNREADABLE', reason: 'DECRYPT_FAILED' };
    } finally {
      key.dek.fill(0);
    }
  }
  const actual = createHash('sha256').update(content).digest();
  return actual.equals(row.sha256)
    ? { status: 'MATCH', sha256: actual }
    : { status: 'MISMATCH', expected: row.sha256, actual };
}
