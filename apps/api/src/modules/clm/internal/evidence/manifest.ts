/**
 * Lecture du manifeste scellé par la base (US-308, migration 0164, ADR-184). Le manifeste est le
 * texte exact de `claim_evidence_bundle.manifest` (forme canonique de jsonb) : il est écrit tel quel
 * dans `manifest.json` de l'archive, et son SHA-256 doit égaler `manifest_sha256` (scellé). Ici,
 * seules les parties dont le travailleur a besoin sont lues et contrôlées (fail-closed : une forme
 * inattendue est un refus, jamais une archive devinée).
 */
import { createHash } from 'node:crypto';
import { isSafeZipPath } from './zip.js';

export const MANIFEST_SCHEMA = 'clm.evidence/1';

export type ManifestFileKind = 'PHOTO' | 'CONTRACT' | 'MESSAGES';

export interface ManifestFile {
  readonly path: string;
  readonly kind: ManifestFileKind;
  /** Identifiant du fichier (`file_asset.id`), du document de contrat ou du fil de messages. */
  readonly ref: string;
  /** SHA-256 attendu (hexadécimal) : celui du registre, jamais une valeur du client. */
  readonly sha256: string;
}

export interface EvidenceManifest {
  readonly bundleId: string;
  readonly sealedAt: Date;
  readonly files: readonly ManifestFile[];
  /** Photos dont la copie de la série diffère du registre des fichiers (constat). */
  readonly registryMismatch: readonly string[];
}

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    .digest('hex');

/** Contrôle le scellé puis lit le manifeste ; `ManifestError` à la moindre forme inattendue. */
export function parseManifest(text: string, expectedSha256: string): EvidenceManifest {
  if (sha256Hex(text) !== expectedSha256) throw new ManifestError('scellé du manifeste rompu');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError('manifeste illisible');
  }
  if (!isObject(raw) || raw['schema'] !== MANIFEST_SCHEMA) {
    throw new ManifestError('schéma inconnu');
  }
  const bundleId = raw['bundleId'];
  const sealedAt = raw['sealedAt'];
  if (typeof bundleId !== 'string' || !UUID.test(bundleId)) throw new ManifestError('bundleId');
  if (typeof sealedAt !== 'string' || !ISO.test(sealedAt)) throw new ManifestError('sealedAt');
  const filesRaw = raw['files'];
  if (!Array.isArray(filesRaw)) throw new ManifestError('files');
  const paths = new Set<string>(['manifest.json']);
  const files = filesRaw.map((f): ManifestFile => {
    if (!isObject(f)) throw new ManifestError('fichier');
    const { path, kind, ref, sha256 } = f;
    if (typeof path !== 'string' || !isSafeZipPath(path) || paths.has(path)) {
      throw new ManifestError('chemin');
    }
    paths.add(path);
    if (kind !== 'PHOTO' && kind !== 'CONTRACT' && kind !== 'MESSAGES') {
      throw new ManifestError('type de pièce');
    }
    if (typeof ref !== 'string' || !UUID.test(ref)) throw new ManifestError('référence');
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) throw new ManifestError('empreinte');
    return { path, kind, ref, sha256 };
  });
  const inspections = raw['inspections'];
  if (!Array.isArray(inspections)) throw new ManifestError('inspections');
  const registryMismatch: string[] = [];
  for (const i of inspections) {
    if (!isObject(i) || !Array.isArray(i['photos'])) throw new ManifestError('série');
    for (const p of i['photos'] as unknown[]) {
      if (!isObject(p) || typeof p['fileId'] !== 'string') throw new ManifestError('photo');
      if (p['registryMismatch'] !== false) registryMismatch.push(p['fileId']);
    }
  }
  return { bundleId, sealedAt: new Date(sealedAt), files, registryMismatch };
}
