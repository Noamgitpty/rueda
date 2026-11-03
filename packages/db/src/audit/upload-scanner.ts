/**
 * Port `UploadScanner` : antivirus et contrôle du type réel des fichiers téléversés (module AUD ;
 * 17 §5 « Antivirus et contrôle des téléversements » : quarantaine avant usage, vérification MIME
 * réelle ; US-020).
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/files` (`FakeUploadScanner`, tests seulement) ; réel
 * (ClamAV ou service du nuage) : à choisir, jamais de FAKE en production (C19).
 *
 * Les échecs sont des valeurs (ADR-058). Règle d'usage, **fail-closed** : seul un verdict `CLEAN`
 * libère un fichier ; `INFECTED`, `MIME_MISMATCH`, `UNSUPPORTED_TYPE`, `UNAVAILABLE` et `TIMEOUT`
 * le laissent en quarantaine (`isReleasable`).
 */
export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'MIME_MISMATCH' | 'UNSUPPORTED_TYPE';

export interface ScanRequest {
  /** Type MIME déclaré par le client (jamais cru sur parole). */
  readonly declaredMime: string;
  readonly body: Buffer;
}

export interface ScanReport {
  readonly verdict: ScanVerdict;
  /** Type réel détecté par le contenu ; `null` si inconnu. */
  readonly detectedMime: string | null;
  /** Nom de la menace détectée (`INFECTED`), sinon `null`. */
  readonly threat: string | null;
}

export type ScanResult =
  | { readonly status: 'SCANNED'; readonly report: ScanReport }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface UploadScanner {
  scan(request: ScanRequest): Promise<ScanResult>;
}

/** Vrai seulement pour un fichier analysé et sain : tout autre résultat garde la quarantaine. */
export function isReleasable(result: ScanResult): boolean {
  return result.status === 'SCANNED' && result.report.verdict === 'CLEAN';
}
