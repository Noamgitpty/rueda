/**
 * Pièces téléversées par le staff (US-109 ; reports d'US-101 ; pré-mortem du lot 1 L1-PM-41 à
 * L1-PM-43 ; 17 §5 « Antivirus et contrôle des téléversements », §3.1.3 point 1 ; ADR-097).
 *
 * Ordre, fail-closed à chaque pas (rien n'est déposé tant qu'un pas n'est pas franchi) :
 *   1. taille : 1 octet à `maxBytes` (PROPOSÉ 64 Kio en Bêta : le corps JSON de l'API est borné à
 *      100 Kio ; les gros fichiers passeront par une URL de dépôt signée et bornée, US-003) ;
 *   2. type RÉEL lu sur les octets (liste blanche JPEG, PNG, HEIC, PDF ; SVG, HTML et tout le reste
 *      refusés, L1-PM-41) ; le type déclaré doit être le type réel ;
 *   3. droit `evidence.upload` dans le pays de la personne sujet, jugé par la base AVANT toute
 *      analyse (refus journalisé) ;
 *   4. antivirus (port `EvidenceScanner`, même forme que `UploadScanner` d'AUD) : seul un verdict
 *      `CLEAN` libère le fichier ; INFECTED, MIME_MISMATCH, UNSUPPORTED_TYPE ⇒ refus ; panne ou
 *      délai ⇒ indisponible (L1-PM-43) ; le fichier refusé n'est JAMAIS déposé ;
 *   5. dans UNE transaction : clé de la personne (port `EvidenceVault`, KMS), ligne `file_asset`
 *      (seau PRIVATE_EVIDENCE, C2, chiffrée par la clé de la personne ; commande
 *      `core.support_staff_record_evidence`), chiffrement, dépôt en création seule (port
 *      `EvidenceFileStore`) ; tout échec annule la transaction.
 *
 * Production (Bêta) : antivirus, coffre KMS et stockage objet ne sont pas encore livrés (US-003 ;
 * fournisseur d'antivirus : question Q-019) ; leurs adaptateurs `Unavailable*` rendent la route
 * indisponible (503) — jamais un FAKE en production (C19).
 */
import { createHash } from 'node:crypto';
import type { SqlExecutor } from '../../iam/index.js';
import type { SqlPool } from './finance-approval-store.js';
import type { OpsConsoleStore } from './ops-console-store.js';
import type { StaffActor } from './staff-context.js';

/** Taille maximale d'une pièce en Bêta (octets, PROPOSÉ ; voir l'en-tête). */
export const EVIDENCE_MAX_BYTES = 64 * 1024;

export type EvidenceMime = 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
export const EVIDENCE_MIMES: readonly EvidenceMime[] = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

/** Marques ISO-BMFF des images HEIF / HEIC (octets 8 à 11 après « ftyp »). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const MAGIC: ReadonlyArray<readonly [EvidenceMime, (b: Buffer) => boolean]> = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
  ['image/jpeg', (b) => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))],
  ['application/pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
  [
    'image/heic',
    (b) =>
      b.length >= 12 &&
      b.subarray(4, 8).toString('latin1') === 'ftyp' &&
      HEIF_BRANDS.has(b.subarray(8, 12).toString('latin1')),
  ],
];

/** Type réel d'après les octets ; `null` hors liste blanche (SVG, HTML, script, archive…). */
export function sniffEvidenceMime(body: Buffer): EvidenceMime | null {
  return MAGIC.find(([, test]) => test(body))?.[0] ?? null;
}

// ---- Ports (échecs en valeurs, ADR-058) --------------------------------------------------------
export type EvidenceScanVerdict = 'CLEAN' | 'INFECTED' | 'MIME_MISMATCH' | 'UNSUPPORTED_TYPE';
export type EvidenceScanResult =
  | {
      readonly status: 'SCANNED';
      readonly report: {
        readonly verdict: EvidenceScanVerdict;
        readonly detectedMime: string | null;
        readonly threat: string | null;
      };
    }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

/** Antivirus et type réel (même forme que `UploadScanner` de `@rueda/db/audit`). */
export interface EvidenceScanner {
  readonly scan: (request: {
    readonly declaredMime: string;
    readonly body: Buffer;
  }) => Promise<EvidenceScanResult>;
}

/** Clé de la personne (enveloppe KMS) et chiffrement du fichier avant le dépôt. */
export interface EvidenceVault {
  /** Crée au besoin la clé de la personne, dans la transaction `tx`. */
  readonly prepare: (tx: SqlExecutor, subjectUserId: string) => Promise<'READY' | 'UNAVAILABLE'>;
  readonly seal: (
    tx: SqlExecutor,
    subjectUserId: string,
    fileId: string,
    body: Buffer,
  ) => Promise<
    { readonly status: 'SEALED'; readonly body: Buffer } | { readonly status: 'UNAVAILABLE' }
  >;
}

/** Stockage objet du seau des preuves, en création seule (`FileStore` d'AUD). */
export interface EvidenceFileStore {
  readonly put: (
    bucket: 'PRIVATE_EVIDENCE',
    key: string,
    body: Buffer,
  ) => Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' }>;
}

export class UnavailableEvidenceScanner implements EvidenceScanner {
  readonly scan = (): Promise<EvidenceScanResult> => Promise.resolve({ status: 'UNAVAILABLE' });
}

export class UnavailableEvidenceVault implements EvidenceVault {
  readonly prepare = (): Promise<'UNAVAILABLE'> => Promise.resolve('UNAVAILABLE');
  readonly seal = (): Promise<{ readonly status: 'UNAVAILABLE' }> =>
    Promise.resolve({ status: 'UNAVAILABLE' });
}

export class UnavailableEvidenceFileStore implements EvidenceFileStore {
  readonly put = (): Promise<{ readonly status: 'UNAVAILABLE' }> =>
    Promise.resolve({ status: 'UNAVAILABLE' });
}

export interface EvidenceOptions {
  readonly pool: SqlPool;
  readonly scanner: EvidenceScanner;
  readonly vault: EvidenceVault;
  readonly files: EvidenceFileStore;
  readonly maxBytes?: number;
}

/** Adaptateurs de production en Bêta : tout indisponible (fail-closed, aucun FAKE). */
export function unavailableEvidence(pool: SqlPool): EvidenceOptions {
  return {
    pool,
    scanner: new UnavailableEvidenceScanner(),
    vault: new UnavailableEvidenceVault(),
    files: new UnavailableEvidenceFileStore(),
  };
}

export type EvidenceRejection = 'SIZE' | 'TYPE' | 'SCAN';

/** Refus d'une pièce : REJECTED (422, `reason`), UNAVAILABLE (503), ou issue d'accès de la base. */
export class EvidenceError extends Error {
  override readonly name = 'EvidenceError';
  readonly kind: 'REJECTED' | 'UNAVAILABLE' | 'ACCESS';
  readonly reason: EvidenceRejection | string;

  constructor(kind: 'REJECTED' | 'UNAVAILABLE' | 'ACCESS', reason: EvidenceRejection | string) {
    super(`pièce : ${kind} (${reason})`);
    this.kind = kind;
    this.reason = reason;
  }
}

export interface EvidenceUpload {
  readonly requestId: string;
  readonly subjectUserId: string;
  readonly declaredMime: string;
  readonly content: Buffer;
}

export interface EvidenceReceipt {
  readonly fileId: string;
  readonly duplicate: boolean;
  readonly sha256: string;
}

export class EvidenceService {
  readonly #store: OpsConsoleStore;
  readonly #options: EvidenceOptions;

  constructor(store: OpsConsoleStore, options: EvidenceOptions) {
    this.#store = store;
    this.#options = options;
  }

  async upload(actor: StaffActor, input: EvidenceUpload): Promise<EvidenceReceipt> {
    const max = this.#options.maxBytes ?? EVIDENCE_MAX_BYTES;
    const body = input.content;
    if (body.length === 0 || body.length > max) throw new EvidenceError('REJECTED', 'SIZE');
    const mime = sniffEvidenceMime(body);
    if (mime === null || mime !== input.declaredMime) throw new EvidenceError('REJECTED', 'TYPE');
    // 3. droit jugé par la base AVANT toute analyse (refus journalisé)
    const permitted = await this.#store.evidencePermitted(
      actor,
      input.requestId,
      input.subjectUserId,
    );
    if (permitted.outcome !== 'PERMITTED') throw new EvidenceError('ACCESS', permitted.outcome);
    // 4. antivirus : seul CLEAN libère ; panne ou délai : indisponible (jamais déposé)
    const scan = await this.#options.scanner.scan({ declaredMime: mime, body });
    if (scan.status !== 'SCANNED') throw new EvidenceError('UNAVAILABLE', 'SCAN');
    if (scan.report.verdict !== 'CLEAN') throw new EvidenceError('REJECTED', 'SCAN');
    const sha256 = createHash('sha256').update(body).digest();
    // 5. clé, ligne, chiffrement, dépôt : une transaction ; tout échec l'annule
    const client = await this.#options.pool.connect();
    try {
      await client.query('BEGIN');
      if ((await this.#options.vault.prepare(client, input.subjectUserId)) !== 'READY') {
        throw new EvidenceError('UNAVAILABLE', 'KEY');
      }
      const r = await this.#store.recordEvidence(client, actor, {
        requestId: input.requestId,
        subjectUserId: input.subjectUserId,
        mime,
        bytes: body.length,
        sha256,
      });
      if (r.outcome === 'UNAVAILABLE') throw new EvidenceError('UNAVAILABLE', 'KEY');
      if (r.outcome !== 'RECORDED' && r.outcome !== 'DUPLICATE') {
        throw new EvidenceError('ACCESS', r.outcome);
      }
      const storageKey = r.body?.['storageKey'];
      if (typeof storageKey !== 'string') throw new EvidenceError('UNAVAILABLE', 'STORE');
      if (r.outcome === 'RECORDED') {
        const sealed = await this.#options.vault.seal(
          client,
          input.subjectUserId,
          input.requestId,
          body,
        );
        if (sealed.status !== 'SEALED') throw new EvidenceError('UNAVAILABLE', 'KEY');
        const put = await this.#options.files.put('PRIVATE_EVIDENCE', storageKey, sealed.body);
        if (put.status !== 'STORED') throw new EvidenceError('UNAVAILABLE', 'STORE');
      }
      await client.query('COMMIT');
      return {
        fileId: input.requestId,
        duplicate: r.outcome === 'DUPLICATE',
        sha256: sha256.toString('hex'),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
