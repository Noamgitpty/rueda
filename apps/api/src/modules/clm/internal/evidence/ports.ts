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

/** Lecture de l'archive (forme de `FileStore.get` d'AUD : échecs en valeurs). */
export type EvidenceFileGet =
  | { readonly status: 'FOUND'; readonly body: Buffer }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

/** Lecture de l'archive dans le bucket PRIVATE_EVIDENCE (port `FileStore` d'AUD). */
export interface EvidenceExportFiles {
  get(bucket: 'PRIVATE_EVIDENCE', key: string): Promise<EvidenceFileGet>;
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
  get(): Promise<EvidenceFileGet> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}
