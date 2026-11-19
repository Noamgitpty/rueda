/**
 * Ports du dossier de preuve côté console (US-308, ADR-184). L'archive est chiffrée par la clé USER
 * du DEMANDEUR (créée à la demande, lue au téléchargement sous le contexte STAFF de sa session :
 * la RLS d'`audit_subject_key` ne rend à app_api que la clé de l'acteur) : seul le demandeur ouvre
 * son archive.
 *
 * Production (bêta) : coffre KMS et stockage objet à verrou ne sont pas livrés (US-003, lot C ;
 * Q-007) : leurs adaptateurs `Unavailable*` rendent les routes indisponibles (503) — jamais un FAKE
 * en production (C19).
 */
import { fileAad, open } from '@rueda/db/audit';
import type { FileStoreGetResult, Queryable, SubjectKeyStore } from '@rueda/db/audit';

/** Exécuteur SQL minimal (client d'une transaction `pg`). */
export interface EvidenceSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface EvidenceSqlClient extends EvidenceSqlExecutor {
  release(): void;
}

export interface EvidenceSqlPool {
  connect(): Promise<EvidenceSqlClient>;
}

/** Clé USER du demandeur : création à la demande, ouverture de l'archive au téléchargement. */
export interface EvidenceExportVault {
  prepare(tx: EvidenceSqlExecutor, userId: string): Promise<'READY' | 'UNAVAILABLE'>;
  open(
    tx: EvidenceSqlExecutor,
    userId: string,
    fileId: string,
    body: Buffer,
  ): Promise<
    | { readonly status: 'OPENED'; readonly body: Buffer }
    | { readonly status: 'UNAVAILABLE' }
    | { readonly status: 'REJECTED' }
  >;
}

/** Lecture de l'archive dans le bucket PRIVATE_EVIDENCE (port `FileStore` d'AUD). */
export interface EvidenceExportFiles {
  get(bucket: 'PRIVATE_EVIDENCE', key: string): Promise<FileStoreGetResult>;
}

export class UnavailableEvidenceExportVault implements EvidenceExportVault {
  prepare(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
  open(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export class UnavailableEvidenceExportFiles implements EvidenceExportFiles {
  get(): Promise<FileStoreGetResult> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/** Coffre sur `SubjectKeyStore` (KMS par `KeyWrapper`) : FAKE en test, KMS réel au lot C. */
export function subjectKeyExportVault(keys: SubjectKeyStore): EvidenceExportVault {
  return {
    async prepare(tx, userId) {
      const k = await keys.dekFor(
        tx as unknown as Queryable,
        { type: 'USER', id: userId },
        'create',
      );
      if (k.status !== 'OK') return 'UNAVAILABLE';
      k.dek.fill(0);
      return 'READY';
    },
    async open(tx, userId, fileId, body) {
      const subject = { type: 'USER', id: userId } as const;
      const k = await keys.dekFor(tx as unknown as Queryable, subject, 'read');
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
