/**
 * Données des routes des photos d'état du véhicule (US-303, ADR-179) : type de série dans l'URL,
 * angle du gabarit, corps des demandes. Lecture STRICTE : toute forme inattendue ⇒
 * `REQUEST_INVALID` (ou `PHOTO_GALLERY_FORBIDDEN` pour une source autre que la caméra de
 * l'application) ; aucune valeur n'est devinée.
 */
import { InspectionHttpError } from './errors.js';

export type InspectionKind = 'CHECKIN' | 'CHECKOUT';
export type InspectionRole = 'HOST' | 'GUEST';

/** Segment de l'URL (`checkin`, `checkout`) → type de série ; sinon `null`. */
export function kindOf(segment: string): InspectionKind | null {
  if (segment === 'checkin') return 'CHECKIN';
  if (segment === 'checkout') return 'CHECKOUT';
  return null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Forme d'un angle du gabarit (la liste fermée fait foi en base, `trip_photo_slot`). */
export const SLOT = /^(EXT_[0-9]{2}|INT_[0-9]{2}|FUEL|ODOMETER|KEY|DAMAGE_[0-9]{2})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Types réels admis pour une photo d'état (capture du canevas : JPEG, ou WebP). */
export const INSPECTION_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;

type Body = Readonly<Record<string, unknown>>;

function only(body: Body, keys: readonly string[]): void {
  for (const k of Object.keys(body)) {
    if (!keys.includes(k)) throw new InspectionHttpError('REQUEST_INVALID');
  }
}

/** `POST …/captures` : `{ slot }`. */
export function parseCaptureRequest(body: Body): { readonly slot: string } {
  only(body, ['slot']);
  const slot = body['slot'];
  if (typeof slot !== 'string' || !SLOT.test(slot))
    throw new InspectionHttpError('REQUEST_INVALID');
  return { slot };
}

export interface PhotoUpload {
  readonly captureId: string;
  readonly slot: string;
  /** Heure de l'appareil, indicative (l'heure serveur fait foi) ; `null` si absente. */
  readonly deviceCapturedAt: Date | null;
  /** SHA-256 des octets calculé par l'appareil (contrôle du transport). */
  readonly clientSha256: Buffer;
  readonly content: Buffer;
}

/**
 * `POST …/photos` : `{ captureId, slot, source: 'CAMERA', deviceCapturedAt?, sha256, dataBase64 }`.
 * Source autre que la caméra de l'application (galerie, fichier) : `PHOTO_GALLERY_FORBIDDEN`.
 */
export function parsePhotoUpload(body: Body): PhotoUpload {
  only(body, ['captureId', 'slot', 'source', 'deviceCapturedAt', 'sha256', 'dataBase64']);
  if (body['source'] !== 'CAMERA') throw new InspectionHttpError('PHOTO_GALLERY_FORBIDDEN');
  const captureId = body['captureId'];
  const slot = body['slot'];
  const sha = body['sha256'];
  const data = body['dataBase64'];
  const device = body['deviceCapturedAt'];
  if (
    typeof captureId !== 'string' ||
    !UUID.test(captureId) ||
    typeof slot !== 'string' ||
    !SLOT.test(slot) ||
    typeof sha !== 'string' ||
    !HEX64.test(sha) ||
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !BASE64.test(data)
  ) {
    throw new InspectionHttpError('REQUEST_INVALID');
  }
  let deviceCapturedAt: Date | null = null;
  if (device !== undefined && device !== null) {
    const d = typeof device === 'string' && device.length <= 40 ? new Date(device) : null;
    if (d === null || !Number.isFinite(d.getTime())) {
      throw new InspectionHttpError('REQUEST_INVALID');
    }
    deviceCapturedAt = d;
  }
  return {
    captureId,
    slot,
    deviceCapturedAt,
    clientSha256: Buffer.from(sha, 'hex'),
    content: Buffer.from(data, 'base64'),
  };
}
