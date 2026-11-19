/**
 * Ports des photos d'état du véhicule (US-303 ; 17 §5 « Antivirus et contrôle des
 * téléversements », §3.1.3 points 1 et 6 ; ADR-179).
 *
 * Une photo d'état est une PREUVE (C2 : plaque, abords, personnes possibles) : elle va au bucket
 * PRIVÉ `PRIVATE_EVIDENCE` (verrou objet en mode conformité dans le stockage réel), chiffrée par la
 * clé USER de la personne qui photographie, jamais reçue avant l'analyse antivirus. Les octets
 * stockés sont ceux REÇUS (aucun retrait de métadonnées : l'empreinte enregistrée est celle des
 * octets envoyés par l'appareil).
 *
 * Production (bêta) : antivirus (ClamAV auto-hébergé, DEC-FONDATEUR-20), coffre KMS et stockage
 * objet à verrou ne sont pas livrés (US-003 ; aucune préproduction, Q-007) : leurs adaptateurs
 * `Unavailable*` rendent l'envoi indisponible (503) — jamais un FAKE en production (C19).
 */
import type { PhotoScanner } from '../../../aud/index.js';

/** Exécuteur SQL minimal (pool `pg` ou client d'une transaction). */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Client d'une transaction : `release` rend la connexion. */
export interface SqlClient extends SqlExecutor {
  release(): void;
}

/** Pool capable d'ouvrir une transaction (ligne, puis objet, puis validation). */
export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
}

/** Antivirus et type réel (forme du port `UploadScanner` d'AUD ; FAKE : FakeUploadScanner). */
export type EvidenceScanner = PhotoScanner;

/** Clé USER de la personne (enveloppe KMS) : créée au besoin, puis chiffrement avant le dépôt. */
export interface EvidenceVault {
  /** Crée au besoin la clé de la personne, dans la transaction `tx` (sous app_api). */
  prepare(tx: SqlExecutor, subjectUserId: string): Promise<'READY' | 'UNAVAILABLE'>;
  seal(
    tx: SqlExecutor,
    subjectUserId: string,
    fileId: string,
    body: Buffer,
  ): Promise<
    { readonly status: 'SEALED'; readonly body: Buffer } | { readonly status: 'UNAVAILABLE' }
  >;
}

/** Stockage objet du bucket PRIVATE_EVIDENCE : dépôt en création seule (port `FileStore` d'AUD). */
export interface EvidenceFileStore {
  put(
    bucket: 'PRIVATE_EVIDENCE',
    key: string,
    body: Buffer,
  ): Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' }>;
}

export class UnavailableEvidenceScanner implements EvidenceScanner {
  scan(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export class UnavailableEvidenceVault implements EvidenceVault {
  prepare(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
  seal(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export class UnavailableEvidenceFileStore implements EvidenceFileStore {
  put(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/** Antivirus, coffre et stockage des photos d'état. */
export interface EvidencePipeline {
  readonly scanner: EvidenceScanner;
  readonly vault: EvidenceVault;
  readonly files: EvidenceFileStore;
}

/** Production en bêta : tout indisponible (fail-closed, aucun FAKE). */
export const UNAVAILABLE_EVIDENCE: EvidencePipeline = Object.freeze({
  scanner: new UnavailableEvidenceScanner(),
  vault: new UnavailableEvidenceVault(),
  files: new UnavailableEvidenceFileStore(),
});

/** Envoi ouvert seulement si antivirus, coffre et stockage sont branchés. */
export function evidenceOpen(p: EvidencePipeline): boolean {
  return (
    !(p.scanner instanceof UnavailableEvidenceScanner) &&
    !(p.vault instanceof UnavailableEvidenceVault) &&
    !(p.files instanceof UnavailableEvidenceFileStore)
  );
}
