/**
 * Adaptateur SYSTÈME DE FICHIERS du port `FileStore` (US-036 ; 17 §5, §6.1 « Stockage objet » ;
 * ADR-051, ADR-120).
 *
 * Un objet `(bucket, key)` est le fichier `<racine>/<bucket>/<key>`. Il sert au développement
 * local, à l'exercice de portabilité et au dossier d'export ; c'est aussi l'alternative la plus
 * neutre à un stockage objet (un volume POSIX chez n'importe quel hébergeur). Il ne remplace pas,
 * en production, les garanties du stockage de l'hébergeur (verrou objet, réplication) : le choix
 * reste au fondateur (Q-007).
 *
 * Contrat du port respecté : `put` est en **création seule** (lien physique exclusif : un objet
 * existant rend `CONFLICT` et reste intact) ; les échecs sont des valeurs (`NOT_FOUND`, `UNAVAILABLE`).
 * La clé suit la contrainte `file_asset_storage_key_format` de la base ; aucun segment `.` ou `..`
 * n'est admis : un objet ne sort jamais de la racine.
 */
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  Bucket,
  FileStore,
  FileStoreGetResult,
  FileStorePutResult,
} from '../audit/file-asset.ts';

export const BUCKETS: readonly Bucket[] = [
  'PUBLIC_LISTING',
  'PRIVATE_EVIDENCE',
  'KYC',
  'DOCUMENTS',
  'BRAND',
];
const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** Chemin d'un objet sous la racine, ou `null` si la clé est refusée. */
export function objectPath(root: string, bucket: string, key: string): string | null {
  if (!(BUCKETS as readonly string[]).includes(bucket)) return null;
  if (!KEY.test(key) || key.length > 512) return null;
  if (key.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  const base = resolve(root);
  const full = resolve(base, bucket, ...key.split('/'));
  return full.startsWith(`${base}${sep}`) ? full : null;
}

const code = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

export class FsFileStore implements FileStore {
  readonly root: string;

  constructor(root: string) {
    if (root === '') throw new Error('FsFileStore : racine vide');
    this.root = resolve(root);
  }

  readonly put = async (bucket: Bucket, key: string, body: Buffer): Promise<FileStorePutResult> => {
    const path = objectPath(this.root, bucket, key);
    if (path === null) return { status: 'UNAVAILABLE' };
    try {
      await mkdir(dirname(path), { recursive: true });
      // fichier temporaire écrit en entier, puis lien exclusif : jamais d'objet à moitié écrit
      const tmp = join(dirname(path), `.tmp-${randomUUID()}`);
      const handle = await open(tmp, 'wx', 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        // lien physique : atomique, et refusé (EEXIST) si l'objet existe déjà
        await link(tmp, path);
      } catch (error) {
        if (code(error) === 'EEXIST') return { status: 'CONFLICT' };
        throw error;
      } finally {
        await rm(tmp, { force: true });
      }
      return { status: 'STORED' };
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  };

  readonly get = async (bucket: Bucket, key: string): Promise<FileStoreGetResult> => {
    const path = objectPath(this.root, bucket, key);
    if (path === null) return { status: 'NOT_FOUND' };
    try {
      return { status: 'FOUND', body: await readFile(path) };
    } catch (error) {
      return code(error) === 'ENOENT' ? { status: 'NOT_FOUND' } : { status: 'UNAVAILABLE' };
    }
  };
}
