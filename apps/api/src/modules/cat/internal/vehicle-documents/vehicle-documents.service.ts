/**
 * Service des pièces et de l'éligibilité du véhicule (US-124 ; 16 HST-019, HST-039 ; ADR-107).
 *
 * Dépôt d'une pièce ou d'une contestation, fail-closed à chaque pas (rien n'est déposé tant qu'un
 * pas n'est pas franchi ; L1-PM-41 à L1-PM-43) :
 *   1. taille : 1 octet à la plus petite de `DOCUMENT_MAX_BYTES` et de la limite du corps JSON ;
 *   2. type RÉEL lu sur les octets (JPEG, PNG, HEIC, PDF ; SVG, HTML, texte refusés) ;
 *   3. droit de déposer jugé par la base AVANT toute analyse (véhicule du compte, modifiable) ;
 *   4. antivirus : seul `CLEAN` du type réel libère ; panne ou délai ⇒ 503 ;
 *   5. une transaction : clé USER de l'hôte (coffre), ligne `file_asset` et pièce (base),
 *      chiffrement, dépôt en création seule ; tout échec annule.
 * Production : antivirus (ClamAV, DEC-FONDATEUR-20), coffre et stockage pas encore livrés ⇒ 503.
 */
import { createHash } from 'node:crypto';
import { API_BODY_LIMIT_BYTES } from '../../../../http-hardening.js';
import { HostListingHttpError, outcomeCode } from '../host-listings/errors.js';
import type { HostListingCode } from '../host-listings/errors.js';
import { FieldValidationError } from '../host-listings/model.js';
import { HostListingStoreError } from '../host-listings/store.js';
import type { HostListingStore } from '../host-listings/store.js';
import { parseClaim, parseDeclaration, parseDocumentUpload } from './model.js';
import { DOCUMENT_MAX_BYTES, documentsOpen, isCleanDocument, sniffDocumentMime } from './ports.js';
import type { DocumentMime, DocumentPipeline } from './ports.js';
import { DepositError } from './store.js';
import type { ClaimView, FileRecord, VehicleDocumentStore, VehicleEligibility } from './store.js';

export class VehicleDocumentsService {
  constructor(
    private readonly store: VehicleDocumentStore,
    private readonly accounts: HostListingStore,
    private readonly pipeline: DocumentPipeline,
  ) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HostListingStoreError)
        throw new HostListingHttpError('LISTING_UNAVAILABLE');
      throw error;
    }
  }

  #parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof FieldValidationError) {
        throw new HostListingHttpError('REQUEST_INVALID', error.problems);
      }
      throw error;
    }
  }

  #expect(outcome: string, success: HostListingCode): HostListingCode {
    if (outcome === 'DONE') return success;
    throw new HostListingHttpError(outcomeCode(outcome));
  }

  /** Compte d'un autre ou inconnu : 404, jamais une liste vide trompeuse. */
  async #owned(proof: Buffer, orgId: string): Promise<void> {
    const market = await this.#call(() => this.accounts.hostMarket(proof, orgId));
    if (market === null) throw new HostListingHttpError('HOST_ACCOUNT_NOT_FOUND');
  }

  /** Dépôt annoncé à l'écran AVANT l'envoi : fermé tant qu'un port est indisponible. */
  documentUploads(): { open: boolean; maxBytes: number } {
    const viaJson = Math.floor(((API_BODY_LIMIT_BYTES - 1024) * 3) / 4);
    return {
      open: documentsOpen(this.pipeline),
      maxBytes: Math.min(this.pipeline.maxBytes ?? DOCUMENT_MAX_BYTES, viaJson),
    };
  }

  async eligibility(proof: Buffer, orgId: string) {
    await this.#owned(proof, orgId);
    const vehicles: VehicleEligibility[] = await this.#call(() =>
      this.store.eligibility(proof, orgId),
    );
    return { vehicles, documentUploads: this.documentUploads() };
  }

  async declare(proof: Buffer, orgId: string, vehicleId: string, body: Record<string, unknown>) {
    const input = this.#parse(() => parseDeclaration(body));
    const outcome = await this.#call(() => this.store.declare(proof, orgId, vehicleId, input));
    return { code: this.#expect(outcome, 'VEHICLE_DECLARATION_SAVED') };
  }

  async submit(proof: Buffer, orgId: string, vehicleId: string) {
    const r = await this.#call(() => this.store.submit(proof, orgId, vehicleId));
    if (r.outcome !== 'DONE') {
      throw new HostListingHttpError(
        outcomeCode(r.outcome),
        undefined,
        r.reasons.length > 0 ? r.reasons : undefined,
      );
    }
    return { code: 'VEHICLE_ELIGIBILITY_SUBMITTED' as const, itemId: r.itemId };
  }

  /** Contrôles 1, 2 et 4 (taille, type réel, antivirus) ; le droit (3) est jugé avant l'analyse. */
  async #clean(
    content: Buffer,
    permitted: () => Promise<string>,
  ): Promise<{ mime: DocumentMime; body: Buffer }> {
    const { maxBytes } = this.documentUploads();
    if (content.length === 0 || content.length > maxBytes) {
      throw new HostListingHttpError('VEHICLE_DOCUMENT_INVALID');
    }
    const mime = sniffDocumentMime(content);
    if (mime === null) throw new HostListingHttpError('VEHICLE_DOCUMENT_INVALID');
    const allowed = await this.#call(permitted);
    if (allowed !== 'OK') throw new HostListingHttpError(outcomeCode(allowed));
    const scan = await this.pipeline.scanner.scan({ declaredMime: mime, body: content });
    if (scan.status !== 'SCANNED') throw new HostListingHttpError('VEHICLE_DOCUMENT_UNAVAILABLE');
    if (!isCleanDocument(scan, mime)) throw new HostListingHttpError('VEHICLE_DOCUMENT_INVALID');
    return { mime, body: content };
  }

  /** Clé de la personne, chiffrement et dépôt dans la transaction de la base. */
  #deposit(userId: string, fileId: string, body: Buffer) {
    return {
      prepare: async (tx: Parameters<DocumentPipeline['vault']['prepare']>[0]) => {
        if ((await this.pipeline.vault.prepare(tx, userId)) !== 'READY') throw new DepositError();
      },
      deposit: async (tx: Parameters<DocumentPipeline['vault']['prepare']>[0], key: string) => {
        const sealed = await this.pipeline.vault.seal(tx, userId, fileId, body);
        if (sealed.status !== 'SEALED') throw new DepositError();
        const put = await this.pipeline.files.put('DOCUMENTS', key, sealed.body);
        if (put.status !== 'STORED') throw new DepositError();
      },
    };
  }

  async #transact(fn: () => Promise<string>): Promise<string> {
    try {
      return await this.#call(fn);
    } catch (error) {
      if (error instanceof DepositError) {
        throw new HostListingHttpError('VEHICLE_DOCUMENT_UNAVAILABLE');
      }
      throw error;
    }
  }

  async addDocument(
    proof: Buffer,
    userId: string,
    orgId: string,
    vehicleId: string,
    body: Record<string, unknown>,
  ) {
    const input = this.#parse(() => parseDocumentUpload(body));
    const clean = await this.#clean(input.content, () =>
      this.store.documentPermitted(proof, orgId, vehicleId),
    );
    const file: FileRecord = {
      fileId: input.requestId,
      mime: clean.mime,
      bytes: clean.body.length,
      sha256: createHash('sha256').update(clean.body).digest(),
    };
    const d = this.#deposit(userId, file.fileId, clean.body);
    const outcome = await this.#transact(() =>
      this.store.addDocument(
        proof,
        orgId,
        vehicleId,
        input.type,
        input.validUntil,
        file,
        d.prepare,
        d.deposit,
      ),
    );
    return { code: this.#expect(outcome, 'VEHICLE_DOCUMENT_ADDED'), documentId: file.fileId };
  }

  async claims(proof: Buffer, orgId: string): Promise<{ claims: ClaimView[] }> {
    await this.#owned(proof, orgId);
    return { claims: await this.#call(() => this.store.claims(proof, orgId)) };
  }

  async openClaim(proof: Buffer, userId: string, orgId: string, body: Record<string, unknown>) {
    const input = this.#parse(() => parseClaim(body));
    const clean = await this.#clean(input.content, () =>
      this.store.claimPermitted(proof, orgId, input.plate, input.vin),
    );
    const file: FileRecord = {
      fileId: input.requestId,
      mime: clean.mime,
      bytes: clean.body.length,
      sha256: createHash('sha256').update(clean.body).digest(),
    };
    const d = this.#deposit(userId, file.fileId, clean.body);
    const outcome = await this.#transact(() =>
      this.store.openClaim(proof, orgId, input.plate, input.vin, file, d.prepare, d.deposit),
    );
    return { code: this.#expect(outcome, 'VEHICLE_CLAIM_OPENED'), claimId: file.fileId };
  }
}
