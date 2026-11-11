/**
 * Réception d'une photo d'annonce (US-115 ; 16 HST-012 ; 17 §5 « type MIME réel vérifié, taille
 * maximale, analyse antivirus, ré-encodage des images publiques, suppression des métadonnées GPS
 * des photos d'annonce » ; pré-mortem L1-PM-19, L1-PM-41, L1-PM-42 ; ADR-099).
 *
 * Ordre, fail-closed à chaque étape :
 *   1. taille : 1 octet au moins, `maxBytes` au plus, AVANT tout traitement (L1-PM-42) ;
 *   2. type RÉEL lu dans les octets, liste blanche JPEG, PNG, WebP (le type déclaré n'est jamais
 *      cru ; SVG, HTML, PDF, fichier inconnu : PHOTO_FORMAT ; L1-PM-41) ;
 *   3. dimensions lues dans l'en-tête, avant tout décodage : côté et surface bornés (bombe de
 *      décompression, L1-PM-42) ;
 *   4. métadonnées retirées (EXIF dont GPS, XMP, IPTC, commentaires, textes PNG ; L1-PM-19) :
 *      l'image elle-même n'est pas décodée ; les segments retirés ne portent aucun pixel ;
 *   5. antivirus (port `PhotoScanner`, Q-019 ouverte : AUCUN adaptateur réel en production, donc
 *      toujours `PHOTO_UPLOAD_UNAVAILABLE` en production, BOARD N-52) : seul `CLEAN` libère ;
 *   6. dépôt (port `PhotoStorage`, bucket public PUBLIC_LISTING, création seule) : la ligne
 *      `file_asset` est écrite d'abord par la base, dans la même transaction.
 *
 * Limite assumée (PROPOSÉ) : pas de RÉ-ENCODAGE des pixels (aucune bibliothèque d'image dans la
 * pile ; choix à faire avec le stockage réel d'US-003). Les octets servis sont ceux de l'hôte,
 * débarrassés de leurs métadonnées, sous leur type réel, depuis le bucket public (jamais
 * l'origine de l'application).
 */

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PhotoLimits {
  /** Taille maximale reçue, en octets (PROPOSÉ : 10 Mio). */
  readonly maxBytes: number;
  /** Côté maximal, en pixels (PROPOSÉ : 8 000). */
  readonly maxSide: number;
  /** Surface maximale, en pixels (PROPOSÉ : 40 millions). */
  readonly maxPixels: number;
}

export const DEFAULT_PHOTO_LIMITS: PhotoLimits = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxSide: 8_000,
  maxPixels: 40_000_000,
});

export type PhotoRejection = 'SIZE' | 'TYPE' | 'DIMENSIONS' | 'MALFORMED';

export class PhotoRejectedError extends Error {
  override readonly name = 'PhotoRejectedError';
  readonly reason: PhotoRejection;
  constructor(reason: PhotoRejection) {
    super(`photo refusée (${reason})`);
    this.reason = reason;
  }
}

/** Type réel par signature d'octets ; `null` si hors liste blanche. */
export function sniffPhotoMime(b: Buffer): PhotoMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

// ---- JPEG ----------------------------------------------------------------------------------
// Segments conservés : APP0 (JFIF), APP2 (profil ICC), APP14 (Adobe, transformée de couleur),
// tables et données. Retirés : APP1 (EXIF, dont GPS, et XMP), APP3 à APP13 et APP15 (IPTC,
// métadonnées d'appareils), COM (commentaire).
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee]);
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b: Buffer): { readonly clean: Buffer; readonly dims: Dimensions } {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  let dims: Dimensions | null = null;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new PhotoRejectedError('MALFORMED');
    let marker = b[i + 1];
    // octets de bourrage 0xFF
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1];
    }
    if (marker === undefined) throw new PhotoRejectedError('MALFORMED');
    if (marker === 0xd9) {
      out.push(b.subarray(i, i + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new PhotoRejectedError('MALFORMED');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new PhotoRejectedError('MALFORMED');
    const segment = b.subarray(i, i + 2 + len);
    if (SOF.has(marker)) {
      if (len < 7) throw new PhotoRejectedError('MALFORMED');
      dims = { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) {
      // début du flux compressé : tout le reste (données, marqueurs RST, EOI) est conservé
      out.push(b.subarray(i));
      break;
    }
    const metadata =
      (marker >= 0xe0 && marker <= 0xef && !JPEG_KEEP_APP.has(marker)) || marker === 0xfe;
    if (!metadata) out.push(segment);
    i += 2 + len;
  }
  if (dims === null) throw new PhotoRejectedError('MALFORMED');
  return { clean: Buffer.concat(out), dims };
}

// ---- PNG -----------------------------------------------------------------------------------
// Fragments retirés : eXIf (EXIF), tEXt, zTXt, iTXt (textes, dont XMP), tIME (date).
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function png(b: Buffer): { readonly clean: Buffer; readonly dims: Dimensions } {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  let dims: Dimensions | null = null;
  let ended = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > b.length) throw new PhotoRejectedError('MALFORMED');
    if (type === 'IHDR') {
      if (len < 8) throw new PhotoRejectedError('MALFORMED');
      dims = { width: b.readUInt32BE(i + 8), height: b.readUInt32BE(i + 12) };
    }
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (dims === null || !ended) throw new PhotoRejectedError('MALFORMED');
  return { clean: Buffer.concat(out), dims };
}

// ---- WebP ----------------------------------------------------------------------------------
// Fragments retirés : EXIF et XMP ; drapeaux correspondants de VP8X remis à zéro.
function webp(b: Buffer): { readonly clean: Buffer; readonly dims: Dimensions } {
  const chunks: Buffer[] = [];
  let i = 12;
  let dims: Dimensions | null = null;
  while (i + 8 <= b.length) {
    const type = b.subarray(i, i + 4).toString('latin1');
    const len = b.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > b.length) throw new PhotoRejectedError('MALFORMED');
    let chunk = b.subarray(i, Math.min(end, b.length));
    if (type === 'VP8X' && len >= 10) {
      chunk = Buffer.from(chunk);
      chunk[8] = (chunk[8] ?? 0) & ~0x0c; // bits EXIF (0x08) et XMP (0x04)
      dims = { width: 1 + chunk.readUIntLE(12, 3), height: 1 + chunk.readUIntLE(15, 3) };
    } else if (type === 'VP8 ' && dims === null && len >= 10) {
      dims = { width: b.readUInt16LE(i + 14) & 0x3fff, height: b.readUInt16LE(i + 16) & 0x3fff };
    } else if (type === 'VP8L' && dims === null && len >= 5) {
      const bits = b.readUInt32LE(i + 9);
      dims = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(chunk);
    i = end;
  }
  if (dims === null) throw new PhotoRejectedError('MALFORMED');
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { clean: Buffer.concat([header, body]), dims };
}

/** Photo contrôlée et nettoyée (étapes 1 à 4), prête pour l'antivirus et le dépôt. */
export interface CleanPhoto {
  readonly mime: PhotoMime;
  readonly body: Buffer;
  readonly dims: Dimensions;
}

/** Étapes 1 à 4 : taille, type réel, dimensions, retrait des métadonnées. */
export function preparePhoto(body: Buffer, limits: PhotoLimits = DEFAULT_PHOTO_LIMITS): CleanPhoto {
  if (body.length === 0 || body.length > limits.maxBytes) throw new PhotoRejectedError('SIZE');
  const mime = sniffPhotoMime(body);
  if (mime === null) throw new PhotoRejectedError('TYPE');
  let r: { clean: Buffer; dims: Dimensions };
  try {
    r = mime === 'image/jpeg' ? jpeg(body) : mime === 'image/png' ? png(body) : webp(body);
  } catch (error) {
    if (error instanceof PhotoRejectedError) throw error;
    throw new PhotoRejectedError('MALFORMED');
  }
  const { width, height } = r.dims;
  if (
    width < 1 ||
    height < 1 ||
    width > limits.maxSide ||
    height > limits.maxSide ||
    width * height > limits.maxPixels
  ) {
    throw new PhotoRejectedError('DIMENSIONS');
  }
  return { mime, body: r.clean, dims: r.dims };
}

// ---- Ports ---------------------------------------------------------------------------------

/** Verdict d'antivirus (forme du port `UploadScanner` d'AUD, 17 §5 ; FAKE : FakeUploadScanner). */
export type PhotoScanResult =
  | {
      readonly status: 'SCANNED';
      readonly report: { readonly verdict: string; readonly detectedMime: string | null };
    }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface PhotoScanner {
  scan(request: { readonly declaredMime: string; readonly body: Buffer }): Promise<PhotoScanResult>;
}

/** Stockage objet, bucket public des photos (forme du port `FileStore` d'AUD, création seule). */
export interface PhotoStorage {
  put(
    bucket: 'PUBLIC_LISTING',
    key: string,
    body: Buffer,
  ): Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | string }>;
}

/** Antivirus indisponible (production tant que Q-019 n'est pas tranchée) : rien n'est libéré. */
export class UnavailablePhotoScanner implements PhotoScanner {
  scan(): Promise<PhotoScanResult> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/** Stockage indisponible (production tant qu'US-003 ne l'a pas livré) : fail-closed. */
export class UnavailablePhotoStorage implements PhotoStorage {
  put(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/** Seul un fichier analysé, sain et du type réel attendu est libéré. */
export function isCleanScan(result: PhotoScanResult, mime: PhotoMime): boolean {
  return (
    result.status === 'SCANNED' &&
    result.report.verdict === 'CLEAN' &&
    result.report.detectedMime === mime
  );
}
