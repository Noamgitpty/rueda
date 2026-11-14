/**
 * Export et import des fichiers (US-036 critère 2 ; 17 §3.2.13 `file_asset`, §6.4 « Fichiers » ;
 * ADR-051, ADR-120).
 *
 * Le registre des objets est la table `file_asset` : chaque ligne nomme un objet `(bucket,
 * storage_key)` du port `FileStore`. L'export copie chaque objet, OCTET POUR OCTET (un fichier
 * C2 / C3 reste chiffré par la clé de son sujet : l'export ne déchiffre rien), de l'ancien
 * stockage vers un `FileStore` de destination (un dossier, `FsFileStore`), et écrit un manifeste
 * (empreinte SHA-256 des octets STOCKÉS, taille). L'import recopie vers le stockage du nouvel
 * hébergeur et vérifie chaque empreinte. Fail-closed : un objet absent, illisible ou différent du
 * manifeste fait échouer l'opération. Un objet sans ligne `file_asset` (orphelin) n'est pas exporté.
 *
 * La lecture du registre se fait sous l'administration de l'instance, en lecture seule ; la preuve
 * que les fichiers importés sont les bons (empreinte du CLAIR = `file_asset.sha256`, après
 * déchiffrement par les clés importées) est faite sous `app_worker` / `evidence_verifier`
 * (`verifyFileAsset`) par l'exercice de portabilité.
 */
import { createHash } from 'node:crypto';
import type { Bucket, FileStore } from '../audit/file-asset.ts';
import type { Queryable } from '../audit/subject-keys.ts';
import { PortabilityError } from './keys.ts';

export const FILES_FORMAT = 'rueda-files-manifest-v1';

export interface ManifestEntry {
  readonly bucket: Bucket;
  readonly key: string;
  readonly bytes: number;
  /** SHA-256 des octets stockés (chiffrés pour C2 / C3), en hexadécimal. */
  readonly sha256: string;
}

export interface FilesManifest {
  readonly format: typeof FILES_FORMAT;
  readonly count: number;
  readonly entries: readonly ManifestEntry[];
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function copyOne(from: FileStore, to: FileStore, bucket: Bucket, key: string) {
  const got = await from.get(bucket, key);
  if (got.status !== 'FOUND') {
    throw new PortabilityError(`objet ${bucket} illisible à la source (${got.status})`);
  }
  const put = await to.put(bucket, key, got.body);
  if (put.status === 'CONFLICT') {
    // reprise d'une copie interrompue : admis seulement si les octets sont identiques
    const there = await to.get(bucket, key);
    if (there.status !== 'FOUND' || !there.body.equals(got.body)) {
      throw new PortabilityError(`objet ${bucket} déjà présent à la destination, différent`);
    }
  } else if (put.status !== 'STORED') {
    throw new PortabilityError(`objet ${bucket} non écrit à la destination (${put.status})`);
  }
  return got.body;
}

/** Copie chaque objet du registre vers `destination` ; rend le manifeste. */
export async function exportFiles(
  admin: Queryable,
  source: FileStore,
  destination: FileStore,
): Promise<FilesManifest> {
  await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let rows: { bucket: Bucket; storage_key: string }[];
  try {
    rows = (
      await admin.query<{ bucket: Bucket; storage_key: string }>(
        'SELECT bucket, storage_key FROM core.audit_file_asset ORDER BY bucket, storage_key',
      )
    ).rows;
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  const entries: ManifestEntry[] = [];
  for (const r of rows) {
    const body = await copyOne(source, destination, r.bucket, r.storage_key);
    entries.push({ bucket: r.bucket, key: r.storage_key, bytes: body.length, sha256: sha(body) });
  }
  return { format: FILES_FORMAT, count: entries.length, entries };
}

/** Relit un manifeste ; refuse un format inconnu ou un compte faux. */
export function parseManifest(text: string): FilesManifest {
  const m = JSON.parse(text) as FilesManifest;
  if (m.format !== FILES_FORMAT) throw new PortabilityError('format de manifeste inconnu');
  if (!Array.isArray(m.entries) || m.entries.length !== m.count) {
    throw new PortabilityError('manifeste des fichiers incomplet');
  }
  return m;
}

/** Recopie les objets du manifeste depuis `exported` vers `target`, empreinte vérifiée. */
export async function importFiles(
  manifest: FilesManifest,
  exported: FileStore,
  target: FileStore,
): Promise<{ imported: number }> {
  for (const e of manifest.entries) {
    const got = await exported.get(e.bucket, e.key);
    if (got.status !== 'FOUND' || got.body.length !== e.bytes || sha(got.body) !== e.sha256) {
      throw new PortabilityError(`objet ${e.bucket} de l’export absent ou altéré`);
    }
    await copyOne(exported, target, e.bucket, e.key);
    const there = await target.get(e.bucket, e.key);
    if (there.status !== 'FOUND' || sha(there.body) !== e.sha256) {
      throw new PortabilityError(`objet ${e.bucket} mal relu à la destination`);
    }
  }
  return { imported: manifest.entries.length };
}
