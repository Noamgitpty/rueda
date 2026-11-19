/**
 * Service des photos d'état du véhicule (US-303 ; 16 TRP-004 ; 19 US-303 ; ADR-179).
 *
 * Envoi d'une photo, fail-closed à chaque pas (rien n'est reçu tant qu'un pas n'est pas franchi) :
 *   1. corps : source = caméra de l'application (sinon PHOTO_GALLERY_FORBIDDEN), jeton, angle,
 *      empreinte de l'appareil, octets ;
 *   2. jeton de capture jugé par la base AVANT tout traitement (personne, série, angle, 120 s,
 *      usage unique ; sinon PHOTO_GALLERY_FORBIDDEN) ; bornes du pays lues en même temps ;
 *   3. envoi fermé si antivirus, coffre ou stockage sont indisponibles (503, production bêta) ;
 *   4. taille (≤ `photo_max_kb` du pays et ≤ la limite du corps JSON), type RÉEL JPEG ou WebP,
 *      dimensions (côté ≤ `photo_max_px` ; plusieurs tailles annoncées : la plus grande, N-120) ;
 *      empreinte des octets reçus = celle de l'appareil (sinon PHOTO_INVALID : transport altéré) ;
 *   5. antivirus : seul `CLEAN` du type réel libère ; panne ou délai ⇒ 503 ;
 *   6. une transaction : clé USER de la personne (coffre), commande d'ajout (jeton consommé,
 *      `file_asset`, photo ; heure serveur), chiffrement, dépôt en création seule ; tout échec
 *      annule.
 * Les octets stockés sont ceux reçus : l'empreinte enregistrée (SHA-256 des octets reçus) se
 * recalcule à l'identique sur l'objet déchiffré (`verifyFileAsset`, US-009).
 * Journaux : aucun ; jamais un identifiant, une empreinte ni une donnée personnelle.
 */
import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_BODY_LIMIT_BYTES } from '../../../../http-hardening.js';
import { isCleanScan, PhotoRejectedError, preparePhoto } from '../../../aud/index.js';
import { TRP_EVIDENCE_PIPELINE, TRP_INSPECTION_STORE } from '../tokens.js';
import { InspectionHttpError, outcomeCode } from './errors.js';
import { INSPECTION_MIME_TYPES, kindOf, parseCaptureRequest, parsePhotoUpload } from './model.js';
import type { InspectionKind } from './model.js';
import { evidenceOpen } from './ports.js';
import type { EvidencePipeline, SqlExecutor } from './ports.js';
import { EvidenceDepositError, InspectionStoreError } from './store.js';
import type { InspectionStore, InspectionViewRow } from './store.js';

/** Plus grande photo qui tient, en base64, dans le corps JSON borné de l'API (US-043). */
export const JSON_PHOTO_MAX_BYTES = Math.floor(((API_BODY_LIMIT_BYTES - 1024) * 3) / 4);

export interface InspectionView {
  readonly tripId: string;
  readonly kind: 'checkin' | 'checkout';
  readonly viewerRole: 'HOST' | 'GUEST';
  readonly timezone: string;
  readonly open: boolean;
  readonly uploads: {
    readonly open: boolean;
    readonly maxBytes: number;
    readonly maxLongSidePx: number;
    readonly mimeTypes: readonly string[];
  };
  readonly slots: InspectionViewRow['slots'];
  readonly sides: InspectionViewRow['sides'];
}

type Body = Readonly<Record<string, unknown>>;

@Injectable()
export class InspectionService {
  constructor(
    @Inject(TRP_INSPECTION_STORE) private readonly store: InspectionStore,
    @Inject(TRP_EVIDENCE_PIPELINE) private readonly pipeline: EvidencePipeline,
  ) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof InspectionStoreError) {
        throw new InspectionHttpError('INSPECTION_UNAVAILABLE');
      }
      throw error;
    }
  }

  #kind(segment: string): InspectionKind {
    const kind = kindOf(segment);
    if (kind === null) throw new InspectionHttpError('INSPECTION_NOT_FOUND');
    return kind;
  }

  #limits(maxKb: number | null, maxPx: number | null) {
    const valid = maxKb !== null && maxKb > 0 && maxPx !== null && maxPx > 0;
    return {
      valid,
      maxBytes: valid ? Math.min(maxKb * 1000, JSON_PHOTO_MAX_BYTES) : 0,
      maxPx: valid ? maxPx : 0,
    };
  }

  async view(proof: Buffer, tripId: string, segment: string): Promise<InspectionView> {
    const kind = this.#kind(segment);
    const v = await this.#call(() => this.store.view(proof, tripId, kind));
    if (v === null) throw new InspectionHttpError('INSPECTION_NOT_FOUND');
    const limits = this.#limits(v.maxKb, v.maxPx);
    return {
      tripId,
      kind: kind === 'CHECKIN' ? 'checkin' : 'checkout',
      viewerRole: v.viewerRole,
      timezone: v.timezone,
      open: v.open,
      uploads: {
        open: v.open && limits.valid && evidenceOpen(this.pipeline),
        maxBytes: limits.maxBytes,
        maxLongSidePx: limits.maxPx,
        mimeTypes: INSPECTION_MIME_TYPES,
      },
      slots: v.slots,
      sides: v.sides,
    };
  }

  async openCapture(proof: Buffer, tripId: string, segment: string, body: Body) {
    const kind = this.#kind(segment);
    const { slot } = parseCaptureRequest(body);
    const r = await this.#call(() => this.store.openCapture(proof, tripId, kind, slot));
    if (r.outcome !== 'DONE' || r.captureId === null || r.expiresAt === null) {
      throw new InspectionHttpError(outcomeCode(r.outcome));
    }
    return { captureId: r.captureId, slot, expiresAt: r.expiresAt.toISOString() };
  }

  async addPhoto(proof: Buffer, userId: string, tripId: string, segment: string, body: Body) {
    const kind = this.#kind(segment);
    const input = parsePhotoUpload(body);
    const check = await this.#call(() =>
      this.store.captureCheck(proof, tripId, kind, input.captureId, input.slot),
    );
    if (check.outcome !== 'OK') throw new InspectionHttpError(outcomeCode(check.outcome));
    const limits = this.#limits(check.maxKb, check.maxPx);
    if (!limits.valid) throw new InspectionHttpError('INSPECTION_UNAVAILABLE');
    if (!evidenceOpen(this.pipeline)) throw new InspectionHttpError('PHOTO_UPLOAD_UNAVAILABLE');
    let mime: string;
    try {
      mime = preparePhoto(input.content, {
        maxBytes: limits.maxBytes,
        maxSide: limits.maxPx,
        maxPixels: limits.maxPx * limits.maxPx,
      }).mime;
    } catch (error) {
      if (error instanceof PhotoRejectedError) throw new InspectionHttpError('PHOTO_INVALID');
      throw error;
    }
    if (!(INSPECTION_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new InspectionHttpError('PHOTO_INVALID');
    }
    const sha256 = createHash('sha256').update(input.content).digest();
    if (!sha256.equals(input.clientSha256)) throw new InspectionHttpError('PHOTO_INVALID');
    const scan = await this.pipeline.scanner.scan({ declaredMime: mime, body: input.content });
    if (scan.status !== 'SCANNED') throw new InspectionHttpError('PHOTO_UPLOAD_UNAVAILABLE');
    if (!isCleanScan(scan, mime as 'image/jpeg' | 'image/webp')) {
      throw new InspectionHttpError('PHOTO_INVALID');
    }
    const fileId = randomUUID();
    const prepare = async (tx: SqlExecutor) => {
      if ((await this.pipeline.vault.prepare(tx, userId)) !== 'READY') {
        throw new EvidenceDepositError();
      }
    };
    const deposit = async (tx: SqlExecutor, key: string) => {
      const sealed = await this.pipeline.vault.seal(tx, userId, fileId, input.content);
      if (sealed.status !== 'SEALED') throw new EvidenceDepositError();
      const put = await this.pipeline.files.put('PRIVATE_EVIDENCE', key, sealed.body);
      if (put.status !== 'STORED') throw new EvidenceDepositError();
    };
    let r: { outcome: string; receivedAt: Date | null };
    try {
      r = await this.#call(() =>
        this.store.addPhoto(
          proof,
          tripId,
          kind,
          {
            captureId: input.captureId,
            slot: input.slot,
            fileId,
            mime,
            bytes: input.content.length,
            sha256,
            deviceCapturedAt: input.deviceCapturedAt,
          },
          prepare,
          deposit,
        ),
      );
    } catch (error) {
      if (error instanceof EvidenceDepositError) {
        throw new InspectionHttpError('PHOTO_UPLOAD_UNAVAILABLE');
      }
      throw error;
    }
    if (r.outcome !== 'DONE' || r.receivedAt === null) {
      throw new InspectionHttpError(outcomeCode(r.outcome));
    }
    return {
      fileId,
      slot: input.slot,
      sha256: sha256.toString('hex'),
      bytes: input.content.length,
      receivedAt: r.receivedAt.toISOString(),
    };
  }

  async submit(proof: Buffer, tripId: string, segment: string, body: Body) {
    const kind = this.#kind(segment);
    // corps vide attendu : la base juge la série de la session, rien n'est reçu du client
    if (Object.keys(body).length > 0) throw new InspectionHttpError('REQUEST_INVALID');
    const r = await this.#call(() => this.store.submit(proof, tripId, kind));
    if (r.outcome === 'PHOTO_TEMPLATE_INCOMPLETE') {
      throw new InspectionHttpError('PHOTO_TEMPLATE_INCOMPLETE', r.missing);
    }
    if ((r.outcome !== 'DONE' && r.outcome !== 'ALREADY_SUBMITTED') || r.submittedAt === null) {
      throw new InspectionHttpError(outcomeCode(r.outcome));
    }
    return { status: 'SUBMITTED' as const, submittedAt: r.submittedAt.toISOString() };
  }
}
