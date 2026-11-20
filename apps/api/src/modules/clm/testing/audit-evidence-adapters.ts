/**
 * Adaptateurs de TEST des ports du dossier de preuve (US-308, ADR-184) sur le magasin de preuves de
 * `@rueda/db/audit` (dépendance de développement : absente de l'image de production) : lecture
 * vérifiée (`readFileAsset`), enveloppe par la clé USER (`seal` / `open`, `fileAad`), clés de sujet
 * (`SubjectKeyStore` sur `FakeKeyWrapper`). Le KMS et le stockage réels arrivent au lot C (US-003).
 * Hors de la compilation de production (dossiers `testing/`).
 */
import { FileAssetError, fileAad, open, readFileAsset, seal } from '@rueda/db/audit';
import type { FileStore, Queryable, SubjectKeyStore } from '@rueda/db/audit';
import type { SqlClient } from '../../bus/index.js';
import {
  EvidenceTransientError,
  type EvidenceArchiveSealer,
  type EvidenceArchiveStore,
  type EvidenceExportVault,
  type EvidenceFileReader,
} from '../index.js';

const q = (tx: SqlClient | object): Queryable => tx as unknown as Queryable;

/** Ports du travailleur : lecture vérifiée, chiffrement de l'archive, dépôt en création seule. */
export function auditEvidenceAdapters(
  store: FileStore,
  keys: Pick<SubjectKeyStore, 'dekFor'>,
): {
  readonly reader: EvidenceFileReader;
  readonly sealer: EvidenceArchiveSealer;
  readonly files: EvidenceArchiveStore;
} {
  return {
    reader: {
      async read(tx, fileId) {
        try {
          const r = await readFileAsset(q(tx), store, keys as SubjectKeyStore, fileId);
          return r.status === 'MATCH' ? { status: 'MATCH', content: r.content } : r;
        } catch (error) {
          if (error instanceof FileAssetError) throw new EvidenceTransientError(error.message);
          throw error;
        }
      },
    },
    sealer: {
      async seal(tx, requesterId, fileId, body) {
        const subject = { type: 'USER', id: requesterId } as const;
        const k = await keys.dekFor(q(tx), subject, 'read');
        if (k.status !== 'OK') return { status: 'KEY_UNAVAILABLE', reason: `KEY_${k.status}` };
        try {
          return { status: 'SEALED', body: seal(k.dek, body, fileAad(fileId, subject)) };
        } finally {
          k.dek.fill(0);
        }
      },
    },
    files: store,
  };
}

/** Coffre de la console : clé USER du demandeur (création, puis ouverture de son archive). */
export function subjectKeyExportVault(keys: Pick<SubjectKeyStore, 'dekFor'>): EvidenceExportVault {
  return {
    async prepare(tx, userId) {
      const k = await keys.dekFor(q(tx), { type: 'USER', id: userId }, 'create');
      if (k.status !== 'OK') return 'UNAVAILABLE';
      k.dek.fill(0);
      return 'READY';
    },
    async open(tx, userId, fileId, body) {
      const subject = { type: 'USER', id: userId } as const;
      const k = await keys.dekFor(q(tx), subject, 'read');
      if (k.status !== 'OK') return { status: 'UNAVAILABLE' };
      try {
        return { status: 'OPENED', body: open(k.dek, body, fileAad(fileId, subject)) };
      } catch {
        return { status: 'REJECTED' };
      } finally {
        k.dek.fill(0);
      }
    },
  };
}
