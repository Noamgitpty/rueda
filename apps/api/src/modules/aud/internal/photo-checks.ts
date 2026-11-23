/**
 * Contrôles communs des photos téléversées (module AUD, socle : 17 §5 « type MIME réel vérifié,
 * taille maximale, analyse antivirus, ré-encodage des images publiques, suppression des métadonnées
 * GPS des photos d'annonce » ; pré-mortem L1-PM-19, L1-PM-41, L1-PM-42 ; ADR-099). Écrits pour les
 * photos d'annonce (US-115, CAT) et partagés depuis US-303 avec les photos d'état du véhicule
 * (TRP, ADR-179) : CAT les réexporte de `host-listings/photo-ingest.ts`, TRP les lit par l'index
 * d'AUD (dépendance du socle, 17 §2.1).
 *
 * Ordre (photos d'annonce), fail-closed à chaque étape :
 *   1. taille : 1 octet au moins, `maxBytes` au plus, AVANT tout traitement (L1-PM-42) ;
 *   2. type RÉEL lu dans les octets, liste blanche JPEG, PNG, WebP (le type déclaré n'est jamais
 *      cru ; SVG, HTML, PDF, fichier inconnu : PHOTO_FORMAT ; L1-PM-41) ;
 *   3. dimensions lues dans l'en-tête, avant tout décodage : côté et surface bornés (bombe de
 *      décompression, L1-PM-42) ; plusieurs SOF ou IHDR : la plus grande taille annoncée
 *      (F2-U-01) ;
 *   4. métadonnées retirées (EXIF dont GPS, XMP, IPTC, MPF, commentaires, textes PNG ;
 *      L1-PM-19) par LISTE BLANCHE : JPEG coupé au premier EOI (rien après : ni image secondaire
 *      MPF / Ultra HDR, ni vidéo de « motion photo »), segments APPn retirés, y compris entre deux
 *      scans ; PNG et WebP : fragments connus seulement, rien après IEND ni au-delà de la taille
 *      RIFF. L'image n'est pas décodée ; les segments retirés ne portent aucun pixel ;
 *   4 bis. copie CANONIQUE (ADR-204, F-L3-PRE-04 ; JPEG et WebP) : la copie, donc son empreinte,
 *      ne dépend que des données de l'image, jamais d'un champ libre. JPEG : en-tête JFIF (densité,
 *      vignette) et profil ICC retirés, segment Adobe réécrit (seule la transformée de couleur
 *      reste), tables de quantification et de Huffman et intervalle de reprise réécrits une table
 *      par segment et dans un ordre fixe avant chaque trame ou scan, octets de bourrage 0xFF
 *      retirés du flux, segments d'extension (JPGn) et réservés retirés. WebP : profil ICCP
 *      retiré, drapeaux de VP8X réduits à alpha et animation, octets réservés et de bourrage remis
 *      à zéro. Limite (ADR-196, ADR-204) : un RÉ-ENCODAGE, ou un bit de remplissage du flux
 *      compressé, change l'empreinte (il faudrait décoder les pixels : aucune bibliothèque d'image) ;
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
// Copie CANONIQUE (ADR-204) : seuls les segments qui portent l'image sont conservés — trames
// (SOFn), scans (SOS et flux), tables (DQT, DHT, DAC), intervalle de reprise (DRI), DNL, DHP et
// EXP (hiérarchique) — et APP14 « Adobe » réécrit (seule sa transformée de couleur décide des
// pixels). Retirés : APP0 (JFIF : densité, vignette ; facultatif pour un décodeur), APP1 (EXIF,
// dont GPS, et XMP), APP2 (profil ICC, MPF), APP3 à APP13 et APP15 (IPTC, métadonnées
// d'appareils), COM (commentaire), JPGn et marqueurs réservés, et tout ce qui suit le premier EOI.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** Segments recopiés tels quels (aucun champ libre) : SOFn, DAC, DNL, DHP, EXP. */
const JPEG_KEEP = new Set([...SOF, 0xcc, 0xdc, 0xde, 0xdf]);
const ADOBE = Buffer.from('Adobe', 'latin1');

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}

/**
 * Tables DQT, DHT et DRI d'une suite de segments, une par clé (la dernière définition l'emporte,
 * comme pour un décodeur) ; réécrites une table par segment, dans l'ordre des clés, avant le
 * segment suivant qui n'est pas une table. Découper, fusionner, réordonner ou redéfinir à
 * l'identique les tables ne change donc pas la copie.
 */
function readTables(marker: number, p: Buffer, into: Map<string, Buffer>): void {
  if (marker === 0xdd) {
    if (p.length !== 2) throw new PhotoRejectedError('MALFORMED');
    into.set('R', jpegSegment(0xdd, p));
    return;
  }
  let k = 0;
  while (k < p.length) {
    const head = p[k] ?? 0;
    if (head >> 4 > 1 || (head & 0x0f) > 3) throw new PhotoRejectedError('MALFORMED');
    let size = 1 + 64 * (head >> 4 === 1 ? 2 : 1);
    if (marker === 0xc4) {
      if (k + 17 > p.length) throw new PhotoRejectedError('MALFORMED');
      let n = 0;
      for (let q = 1; q <= 16; q += 1) n += p[k + q] ?? 0;
      size = 17 + n;
    }
    if (k + size > p.length) throw new PhotoRejectedError('MALFORMED');
    const key = (marker === 0xdb ? 'Q' : 'H') + head.toString(16).padStart(2, '0');
    into.set(key, jpegSegment(marker, p.subarray(k, k + size)));
    k += size;
  }
}

/**
 * Flux compressé d'un scan, sans bourrage : une suite d'octets 0xFF se réduit à un seul devant
 * 0x00 (octet bourré) ou un RSTn, et disparaît devant le marqueur qui termine le scan.
 */
function canonicalScan(data: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  let n = 0;
  let k = 0;
  while (k < data.length) {
    const v = data[k] ?? 0;
    if (v !== 0xff) {
      out[n++] = v;
      k += 1;
      continue;
    }
    while (k < data.length && data[k] === 0xff) k += 1;
    if (k >= data.length) break;
    out[n++] = 0xff;
    out[n++] = data[k] ?? 0;
    k += 1;
  }
  return out.subarray(0, n);
}

/**
 * Plusieurs tailles annoncées (deux SOF JPEG, deux IHDR PNG ; red team du lot 1, F2-U-01) : la
 * PLUS GRANDE de chaque côté est retenue, quel que soit son rang. Un décodeur peut lire la
 * première comme la dernière ; aucune ne se cache derrière une autre (fail-closed).
 */
function largest(prev: Dimensions | null, next: Dimensions): Dimensions {
  if (prev === null) return next;
  return {
    width: Math.max(prev.width, next.width),
    height: Math.max(prev.height, next.height),
  };
}

function jpeg(b: Buffer): { readonly clean: Buffer; readonly dims: Dimensions } {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  let dims: Dimensions | null = null;
  // segment Adobe canonique, émis une fois avant la première trame ; `true` une fois émis
  let adobe: Buffer | null = null;
  let adobeDone = false;
  const tables = new Map<string, Buffer>();
  const flush = (): void => {
    for (const key of [...tables.keys()].sort()) out.push(tables.get(key)!);
    tables.clear();
  };
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
      flush();
      out.push(b.subarray(i, i + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // TEM ou RSTn hors d'un flux : aucun pixel, retiré
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new PhotoRejectedError('MALFORMED');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new PhotoRejectedError('MALFORMED');
    const segment = b.subarray(i, i + 2 + len);
    if (SOF.has(marker)) {
      if (len < 7) throw new PhotoRejectedError('MALFORMED');
      dims = largest(dims, { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) });
    }
    if (marker === 0xda) {
      // en-tête du scan, puis données compressées jusqu'au prochain marqueur : dans le flux,
      // 0xFF n'est suivi que de 0x00 (octet bourré) ou d'un RSTn ; tout autre marqueur (table,
      // scan suivant d'un JPEG progressif, APPn, EOI) reprend l'analyse des segments
      flush();
      out.push(segment);
      let j = i + 2 + len;
      while (j + 1 < b.length) {
        const next = b[j + 1] ?? 0;
        if (b[j] === 0xff && next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) {
          break;
        }
        j += 1;
      }
      if (j + 1 >= b.length) throw new PhotoRejectedError('MALFORMED');
      out.push(canonicalScan(b.subarray(i + 2 + len, j)));
      i = j;
      continue;
    }
    const payload = segment.subarray(4);
    if (marker === 0xdb || marker === 0xc4 || marker === 0xdd) {
      readTables(marker, payload, tables);
    } else if (marker === 0xee) {
      // Adobe : version et drapeaux libres ; seule la transformée de couleur (12e octet) reste
      if (
        !adobeDone &&
        adobe === null &&
        payload.length >= 12 &&
        payload.subarray(0, 5).equals(ADOBE)
      ) {
        adobe = jpegSegment(
          0xee,
          Buffer.concat([ADOBE, Buffer.from([0, 100, 0, 0, 0, 0, payload[11] ?? 0])]),
        );
      }
    } else if (JPEG_KEEP.has(marker)) {
      if (SOF.has(marker) && !adobeDone) {
        if (adobe !== null) out.push(adobe);
        adobeDone = true;
      }
      flush();
      out.push(segment);
    }
    i += 2 + len;
  }
  // EOI obligatoire : rien n'est conservé après lui
  if (dims === null || b[i + 1] !== 0xd9) throw new PhotoRejectedError('MALFORMED');
  return { clean: Buffer.concat(out), dims };
}

// ---- PNG -----------------------------------------------------------------------------------
// LISTE BLANCHE : fragments critiques et de rendu seulement. Tout autre fragment est retiré :
// eXIf (EXIF), tEXt, zTXt, iTXt (textes, dont XMP), tIME (date), caBX (JUMBF, C2PA), fragments
// privés ou inconnus ; rien après IEND.
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'pHYs',
  'sBIT',
  'bKGD',
  'hIST',
]);

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
      dims = largest(dims, { width: b.readUInt32BE(i + 8), height: b.readUInt32BE(i + 12) });
    }
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
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
// LISTE BLANCHE : VP8X, VP8, VP8L, ALPH, ANIM, ANMF. Retirés : EXIF, XMP, ICCP (profil ICC, charge
// libre : copie canonique, ADR-204) et tout autre fragment (privé, inconnu), et les octets au-delà
// de la taille RIFF ; drapeaux de VP8X réduits à alpha (0x10) et animation (0x02), octets réservés
// et octet de bourrage d'un fragment impair remis à zéro.
const WEBP_KEEP = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF']);

function webp(b: Buffer): { readonly clean: Buffer; readonly dims: Dimensions } {
  const chunks: Buffer[] = [];
  let i = 12;
  let dims: Dimensions | null = null;
  const riff = b.readUInt32LE(4);
  if (riff < 4 || 8 + riff > b.length) throw new PhotoRejectedError('MALFORMED');
  const limit = 8 + riff;
  while (i + 8 <= limit) {
    const type = b.subarray(i, i + 4).toString('latin1');
    const len = b.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > limit) throw new PhotoRejectedError('MALFORMED');
    let chunk = b.subarray(i, Math.min(end, limit));
    // Taille de l'en-tête VP8X ET de chaque image VP8 / VP8L : la PLUS GRANDE est retenue (règle
    // F2-U-01 étendue au WebP, BOARD N-120 : un VP8 démesuré derrière un petit VP8X ne passe plus)
    if (type === 'VP8X' && len >= 10) {
      chunk = Buffer.from(chunk);
      // seuls alpha (0x10) et animation (0x02) décident du rendu : ICC (0x20), EXIF (0x08), XMP
      // (0x04), bits et octets réservés remis à zéro
      chunk[8] = (chunk[8] ?? 0) & 0x12;
      chunk.fill(0, 9, 12);
      dims = largest(dims, {
        width: 1 + chunk.readUIntLE(12, 3),
        height: 1 + chunk.readUIntLE(15, 3),
      });
    } else if (type === 'VP8 ' && len >= 10) {
      dims = largest(dims, {
        width: b.readUInt16LE(i + 14) & 0x3fff,
        height: b.readUInt16LE(i + 16) & 0x3fff,
      });
    } else if (type === 'VP8L' && len >= 5) {
      const bits = b.readUInt32LE(i + 9);
      dims = largest(dims, { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
    }
    // fragment de longueur impaire en fin de fichier sans octet de bourrage : bourrage ajouté
    if (chunk.length < end - i)
      chunk = Buffer.concat([chunk, Buffer.alloc(end - i - chunk.length)]);
    // octet de bourrage d'un fragment impair : libre, remis à zéro
    if (len % 2 === 1 && chunk[8 + len] !== 0) {
      chunk = Buffer.from(chunk);
      chunk[8 + len] = 0;
    }
    if (WEBP_KEEP.has(type)) chunks.push(chunk);
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
