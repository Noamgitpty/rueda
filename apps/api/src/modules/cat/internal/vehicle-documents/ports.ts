/**
 * Ports des pièces du véhicule (US-124 ; 16 HST-039 ; 17 §5 « Antivirus et contrôle des
 * téléversements », §3.1.3 point 1 ; pré-mortem L1-PM-15, L1-PM-41 à L1-PM-43 ; ADR-107).
 *
 * Une pièce (titre, autorisation notariée, photo de la plaque et du VIN, inspection, consentement
 * du créancier, assurance obligatoire) est une donnée personnelle (C2) : elle va au seau PRIVÉ
 * `DOCUMENTS`, chiffrée par la clé USER de l'hôte, jamais servie avant l'analyse antivirus, et lue
 * seulement par l'ops couvert par l'élément de file, après journalisation.
 *
 * Production (bêta) : antivirus (ClamAV, DEC-FONDATEUR-20), coffre KMS et stockage objet ne sont
 * pas encore livrés (US-003) ; leurs adaptateurs `Unavailable*` rendent le dépôt et la lecture
 * indisponibles (503) — jamais un FAKE en production (C19).
 */
import type { PhotoScanResult, PhotoScanner } from '../host-listings/photo-ingest.js';
import type { SqlExecutor } from '../host-listings/store.js';

export type DocumentMime = 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';

/** Taille maximale d'une pièce (PROPOSÉ, ADR-107 ; bornée en plus par le corps JSON de l'API). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Marques ISO-BMFF des images HEIF / HEIC (octets 8 à 11 après « ftyp »). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * Type RÉEL d'après les octets, liste blanche JPEG, PNG, HEIC, PDF (L1-PM-41) ; SVG, HTML, texte,
 * archive : `null`. Seul le préfixe est lu : un polyglotte repose sur l'antivirus et sur la règle de
 * service (seau privé, jamais l'origine de l'application).
 */
export function sniffDocumentMime(b: Buffer): DocumentMime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    b.length >= 12 &&
    b.subarray(4, 8).toString('latin1') === 'ftyp' &&
    HEIF_BRANDS.has(b.subarray(8, 12).toString('latin1'))
  ) {
    return 'image/heic';
  }
  return null;
}

/** Antivirus et type réel : même forme que le port des photos (`UploadScanner` d'AUD). */
export type DocumentScanner = PhotoScanner;
export type DocumentScanResult = PhotoScanResult;

/** Seul un fichier analysé, sain et du type réel attendu est libéré. */
export function isCleanDocument(result: DocumentScanResult, mime: DocumentMime): boolean {
  return (
    result.status === 'SCANNED' &&
    result.report.verdict === 'CLEAN' &&
    result.report.detectedMime === mime
  );
}

/** Clé USER de l'hôte (enveloppe KMS) ; chiffrement avant le dépôt, déchiffrement pour l'ops. */
export interface DocumentVault {
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
  open(
    subjectUserId: string,
    fileId: string,
    sealed: Buffer,
  ): Promise<
    { readonly status: 'OPENED'; readonly body: Buffer } | { readonly status: 'UNAVAILABLE' }
  >;
}

/** Stockage objet du seau privé DOCUMENTS : dépôt en création seule, lecture par clé. */
export interface DocumentFileStore {
  put(
    bucket: 'DOCUMENTS',
    key: string,
    body: Buffer,
  ): Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' }>;
  get(
    bucket: 'DOCUMENTS',
    key: string,
  ): Promise<
    | { readonly status: 'FOUND'; readonly body: Buffer }
    | { readonly status: 'MISSING' | 'UNAVAILABLE' | 'TIMEOUT' }
  >;
}

export class UnavailableDocumentScanner implements DocumentScanner {
  scan(): Promise<DocumentScanResult> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export class UnavailableDocumentVault implements DocumentVault {
  prepare(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
  seal(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
  open(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export class UnavailableDocumentFileStore implements DocumentFileStore {
  put(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
  get(): Promise<{ readonly status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/** Antivirus, coffre et stockage des pièces. */
export interface DocumentPipeline {
  readonly scanner: DocumentScanner;
  readonly vault: DocumentVault;
  readonly files: DocumentFileStore;
  readonly maxBytes?: number;
}

/** Production en bêta : tout indisponible (fail-closed, aucun FAKE). */
export const UNAVAILABLE_DOCUMENTS: DocumentPipeline = Object.freeze({
  scanner: new UnavailableDocumentScanner(),
  vault: new UnavailableDocumentVault(),
  files: new UnavailableDocumentFileStore(),
});

/** Dépôt ouvert seulement si antivirus, coffre et stockage sont branchés. */
export function documentsOpen(p: DocumentPipeline): boolean {
  return (
    !(p.scanner instanceof UnavailableDocumentScanner) &&
    !(p.vault instanceof UnavailableDocumentVault) &&
    !(p.files instanceof UnavailableDocumentFileStore)
  );
}
