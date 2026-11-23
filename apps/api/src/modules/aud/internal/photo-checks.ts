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
 *      MPF / Ultra HDR, ni vidéo de « motion photo ») ; PNG et WebP : fragments connus seulement,
 *      rien après IEND ni au-delà de la taille RIFF. L'image n'est pas décodée ;
 *   4 bis. copie CANONIQUE (ADR-204, F-L3-PRE-04 ; JPEG et WebP) : la copie est RÉÉCRITE à partir
 *      de ce que retient un décodeur, et son empreinte ne dépend d'aucun champ libre. JPEG : JFIF
 *      et Adobe RÉÉCRITS en segments canoniques (espace de couleur de libjpeg) ; orientation EXIF
 *      (2 à 8) RÉÉCRITE seule dans un APP1 EXIF canonique ; tables lues seules, emplacements par
 *      contenu, avant le scan qui les lit ; scans normalisés ; flux sans bourrage ; tout autre
 *      segment retiré. WebP : une trame, ALPH derrière un VP8X canonique. Copie jamais plus grande
 *      que le fichier reçu (plus une marge fixe). Limite (ADR-196, ADR-204) : un RÉ-ENCODAGE, ou un
 *      octet ajouté dans le flux compressé, change l'empreinte (aucune bibliothèque d'image) ;
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
// Copie CANONIQUE (ADR-204) : la copie est RÉÉCRITE à partir de ce qu'un décodeur (libjpeg,
// celui des navigateurs) retient du fichier, jamais recopiée segment par segment :
//   - espace de couleur : celui que retient libjpeg (jdapimin.c, default_decompress_parms : JFIF,
//     puis le DERNIER APP14 « Adobe » avant le premier scan, puis les identifiants des
//     composantes), RÉÉCRIT en un JFIF canonique (YCbCr) ou un Adobe canonique réduit à sa
//     transformée (RGB ; à quatre composantes, la présence d'Adobe et sa transformée) ;
//     identifiants des composantes renumérotés 1..n ;
//   - orientation : la balise EXIF Orientation (2 à 8) du premier APP1 EXIF avant le premier scan,
//     RÉÉCRITE seule dans un APP1 EXIF canonique ; 1, absente ou illisible : aucun EXIF ;
//   - tables : la dernière définition d'un emplacement l'emporte ; quantification figée au premier
//     scan de chaque composante (comme libjpeg), 16 bits ramenée à 8 bits quand toutes ses valeurs
//     y tiennent, emplacements attribués par contenu ; Huffman : emplacements STABLES par contenu
//     (une table déjà émise garde son emplacement) ; seules les tables lues sont émises, juste
//     avant le scan qui les lit, et seulement si elles manquent ; DRI émis quand il change (0 =
//     absent) ; trame séquentielle étendue compatible (8 bits, tables 8 bits, Huffman 0 et 1)
//     réécrite en trame de base ;
//   - scans : sélecteurs non lus remis à 0 ; scan séquentiel : Ss = 0, Se = 63, Ah = Al = 0 ; flux
//     sans octet de bourrage 0xFF ;
//   - retirés : tout autre APPn (GPS, XMP, ICC, MPF, IPTC, vignette JFIF…), COM, DNL, DAC, DHP, EXP,
//     JPGn, marqueurs réservés, tables non lues, et tout ce qui suit le premier EOI.
// Refusés (MALFORMED) : trame sans perte, hiérarchique ou arithmétique, plusieurs trames, plus de
// `JPEG_MAX_SCANS` scans, copie plus grande que le fichier reçu (plus `CANONICAL_MARGIN` octets :
// jamais d'amplification). Une table lue mais jamais définie reste « absente » dans la copie.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const SOF_ACCEPTED = new Set([0xc0, 0xc1, 0xc2]);
/** Scans au plus (un JPEG progressif d'appareil en a une dizaine). */
const JPEG_MAX_SCANS = 128;
/** Marge de la copie canonique sur le fichier reçu (en-têtes JFIF, Adobe, EXIF réécrits). */
const CANONICAL_MARGIN = 1024;
const JFIF_ID = Buffer.from('JFIF\0', 'latin1');
const ADOBE = Buffer.from('Adobe', 'latin1');
const EXIF_ID = Buffer.from('Exif\0\0', 'latin1');
/** JFIF canonique : version 1.01, sans unité, rapport 1:1, sans vignette. */
const CANONICAL_JFIF = Buffer.concat([JFIF_ID, Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
/**
 * Table lue par un scan mais jamais définie : quantification, libjpeg échoue ; Huffman, il prend sa
 * table standard. La copie la garde absente (même comportement des deux côtés).
 */
const UNDEFINED_TABLE = Buffer.alloc(0);

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}

const adobeSegment = (transform: number): Buffer =>
  jpegSegment(0xee, Buffer.concat([ADOBE, Buffer.from([0, 100, 0, 0, 0, 0, transform])]));

/** APP1 EXIF canonique : TIFF gros-boutiste, une seule entrée (Orientation, SHORT). */
const orientationSegment = (o: number): Buffer =>
  jpegSegment(
    0xe1,
    Buffer.concat([
      EXIF_ID,
      Buffer.from([
        0x4d,
        0x4d,
        0,
        0x2a,
        0,
        0,
        0,
        8,
        0,
        1,
        0x01,
        0x12,
        0,
        3,
        0,
        0,
        0,
        1,
        0,
        o,
        0,
        0,
      ]),
      Buffer.alloc(4),
    ]),
  );

/**
 * Orientation EXIF d'un APP1 : 0 si ce n'est pas un EXIF ; sinon la balise 0x0112 de l'IFD0
 * (1 à 8), 1 si elle est absente ou illisible.
 */
function exifOrientation(p: Buffer): number {
  if (p.length < 14 || !p.subarray(0, 6).equals(EXIF_ID)) return 0;
  const t = p.subarray(6);
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 1;
  const u16 = (o: number): number => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number): number => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  try {
    if (u16(2) !== 42) return 1;
    const ifd = u32(4);
    const n = u16(ifd);
    for (let k = 0; k < n; k += 1) {
      const e = ifd + 2 + 12 * k;
      if (u16(e) !== 0x0112) continue;
      if (u16(e + 2) !== 3 || u32(e + 4) !== 1) return 1;
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  } catch {
    return 1;
  }
  return 1;
}

/**
 * DQT : une table par emplacement (`Tq` = quatre bits de poids faible), la DERNIÈRE définition
 * l'emporte ; contenu gardé = précision et valeurs, sans l'emplacement ; une table 16 bits dont
 * toutes les valeurs tiennent sur 8 bits est ramenée à 8 bits (mêmes coefficients).
 */
function readQuant(p: Buffer, into: Map<number, Buffer>): void {
  let k = 0;
  while (k < p.length) {
    const head = p[k] ?? 0;
    const pq = head >> 4;
    if (pq > 1 || (head & 0x0f) > 3) throw new PhotoRejectedError('MALFORMED');
    const size = 1 + 64 * (pq + 1);
    if (k + size > p.length) throw new PhotoRejectedError('MALFORMED');
    let values = p.subarray(k + 1, k + size);
    let precision = pq;
    if (pq === 1) {
      const narrow = Buffer.alloc(64);
      let fits = true;
      for (let q = 0; q < 64; q += 1) {
        const v = values.readUInt16BE(2 * q);
        if (v > 255) fits = false;
        narrow[q] = v & 0xff;
      }
      if (fits) {
        values = narrow;
        precision = 0;
      }
    }
    into.set(head & 0x0f, Buffer.concat([Buffer.from([precision << 4]), values]));
    k += size;
  }
}

/** DHT : une table par (classe, emplacement), la dernière l'emporte ; contenu sans l'emplacement. */
function readHuffman(p: Buffer, into: Map<number, Buffer>): void {
  let k = 0;
  while (k < p.length) {
    const head = p[k] ?? 0;
    if (head >> 4 > 1 || (head & 0x0f) > 3 || k + 17 > p.length) {
      throw new PhotoRejectedError('MALFORMED');
    }
    let n = 0;
    for (let q = 1; q <= 16; q += 1) n += p[k + q] ?? 0;
    if (n > 256 || k + 17 + n > p.length) throw new PhotoRejectedError('MALFORMED');
    into.set(head, Buffer.concat([Buffer.from([head & 0xf0]), p.subarray(k + 1, k + 17 + n)]));
    k += 17 + n;
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

/** Taille démesurée refusée DÈS sa lecture, avant tout autre travail (L1-PM-42). */
function checkDimensions(d: Dimensions, limits: PhotoLimits): void {
  if (
    d.width > limits.maxSide ||
    d.height > limits.maxSide ||
    d.width * d.height > limits.maxPixels
  ) {
    throw new PhotoRejectedError('DIMENSIONS');
  }
}

interface JpegComponent {
  readonly id: number;
  readonly hv: number;
  readonly tq: number;
  /** Table de quantification figée au premier scan de la composante ; `undefined` avant. */
  latched: Buffer | undefined;
}

interface JpegScan {
  /** Composantes du scan : index dans la trame, tables lues (`null` : non lue par ce scan). */
  readonly comps: readonly {
    readonly index: number;
    readonly dc: Buffer | null;
    readonly ac: Buffer | null;
  }[];
  /** Composantes dont la table de quantification est figée par ce scan. */
  readonly latch: readonly number[];
  /** Ss, Se, Ah / Al (séquentiel : 0, 63, 0). */
  readonly spectral: Buffer;
  readonly dri: number;
  readonly data: Buffer;
}

interface JpegFrame {
  readonly marker: number;
  /** Précision, hauteur, largeur (5 octets). */
  readonly head: Buffer;
  readonly comps: JpegComponent[];
}

/** Résultat d'une analyse : copie, dimensions, et refus à prononcer APRÈS celui des dimensions. */
interface Parsed {
  readonly clean: Buffer;
  readonly dims: Dimensions;
  readonly invalid: boolean;
}

/**
 * Emplacements STABLES des tables de Huffman d'une classe : une table déjà présente garde son
 * emplacement ; une table manquante prend le premier emplacement dont le contenu n'est pas lu par
 * ce scan. Rend les emplacements des tables lues et les tables à émettre (emplacement, contenu).
 */
function placeHuffman(
  slots: (Buffer | null)[],
  needed: readonly Buffer[],
): { readonly at: number[]; readonly emit: [number, Buffer][] } {
  const at: number[] = needed.map((t) => slots.findIndex((x) => x !== null && x.equals(t)));
  const emit: [number, Buffer][] = [];
  needed.forEach((t, k) => {
    if ((at[k] ?? -1) >= 0) return;
    const slot = slots.findIndex(
      (x, j) => !at.includes(j) && (x === null || !needed.some((n) => n.equals(x))),
    );
    at[k] = slot;
    slots[slot] = t;
    if (t.length > 0) emit.push([slot, t]);
  });
  return { at, emit };
}

function jpegAssemble(
  frame: JpegFrame,
  scans: readonly JpegScan[],
  color: { readonly jfif: boolean; readonly adobe: number | null; readonly orientation: number },
): Buffer {
  const head: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const ids = frame.comps.map((c) => c.id);
  // espace de couleur retenu par libjpeg, réécrit sans champ libre
  if (ids.length === 3) {
    const rgb = color.jfif
      ? false
      : color.adobe !== null
        ? color.adobe === 0
        : ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42;
    head.push(rgb ? adobeSegment(0) : jpegSegment(0xe0, CANONICAL_JFIF));
  } else if (ids.length === 4 && color.adobe !== null) {
    // quatre composantes : sans Adobe, CMYK ; avec Adobe, CMYK inversé (0) ou YCCK (autre)
    head.push(adobeSegment(color.adobe === 0 ? 0 : 2));
  }
  if (color.orientation >= 2) head.push(orientationSegment(color.orientation));
  // quantification : emplacements attribués par contenu, dans l'ordre où les tables sont figées
  const qSlots: Buffer[] = [];
  const qOf: number[] = frame.comps.map(() => 0);
  for (const s of scans) {
    for (const index of s.latch) {
      const t = frame.comps[index]!.latched!;
      let slot = qSlots.findIndex((x) => x.equals(t));
      if (slot < 0) slot = qSlots.push(t) - 1;
      qOf[index] = slot;
    }
  }
  // Huffman : emplacements stables par contenu, sur toute l'image
  const slots: [(Buffer | null)[], (Buffer | null)[]] = [
    [null, null, null, null],
    [null, null, null, null],
  ];
  let maxSlot = 0;
  const body: Buffer[] = [];
  let dri = 0;
  const qSent = new Set<number>();
  let sofAt = 0;
  scans.forEach((s, n) => {
    const preQ: Buffer[] = [];
    const pre: Buffer[] = [];
    for (const index of s.latch) {
      const slot = qOf[index] ?? 0;
      const t = qSlots[slot]!;
      if (!qSent.has(slot) && t.length > 0) {
        preQ.push(
          jpegSegment(0xdb, Buffer.concat([Buffer.from([(t[0] ?? 0) | slot]), t.subarray(1)])),
        );
      }
      qSent.add(slot);
    }
    const sel = s.comps.map(() => 0);
    ([0, 1] as const).forEach((cls) => {
      const needed: Buffer[] = [];
      for (const c of s.comps) {
        const t = cls === 0 ? c.dc : c.ac;
        if (t !== null && !needed.some((x) => x.equals(t))) needed.push(t);
      }
      const { at, emit } = placeHuffman(slots[cls], needed);
      for (const [slot, t] of emit) {
        pre.push(
          jpegSegment(0xc4, Buffer.concat([Buffer.from([(cls << 4) | slot]), t.subarray(1)])),
        );
      }
      s.comps.forEach((c, k) => {
        const t = cls === 0 ? c.dc : c.ac;
        if (t === null) return;
        const slot = at[needed.findIndex((x) => x.equals(t))] ?? 0;
        maxSlot = Math.max(maxSlot, slot);
        sel[k] = (sel[k] ?? 0) | (cls === 0 ? slot << 4 : slot);
      });
    });
    if (s.dri !== dri) {
      const v = Buffer.alloc(2);
      v.writeUInt16BE(s.dri);
      pre.push(jpegSegment(0xdd, v));
      dri = s.dri;
    }
    const sos = jpegSegment(
      0xda,
      Buffer.concat([
        Buffer.from([s.comps.length]),
        ...s.comps.map((c, k) => Buffer.from([c.index + 1, sel[k] ?? 0])),
        s.spectral,
      ]),
    );
    body.push(...preQ);
    // la trame suit les tables de quantification du premier scan, avant ses tables de Huffman
    if (n === 0) sofAt = body.length;
    body.push(...pre, sos, s.data);
  });
  // trame séquentielle étendue compatible avec la trame de base : réécrite en trame de base
  const baseline =
    frame.marker === 0xc1 &&
    frame.head[0] === 8 &&
    maxSlot <= 1 &&
    qSlots.length <= 2 &&
    qSlots.every((t) => (t[0] ?? 0) === 0);
  const sof = jpegSegment(
    baseline ? 0xc0 : frame.marker,
    Buffer.concat([
      frame.head,
      Buffer.from([frame.comps.length]),
      ...frame.comps.map((c, k) => Buffer.from([k + 1, c.hv, qOf[k] ?? 0])),
    ]),
  );
  body.splice(sofAt, 0, sof);
  return Buffer.concat([...head, ...body, Buffer.from([0xff, 0xd9])]);
}

function jpeg(b: Buffer, limits: PhotoLimits): Parsed {
  let i = 2;
  let dims: Dimensions | null = null;
  let invalid = false;
  let frame: JpegFrame | null = null;
  let jfif = false;
  let adobe: number | null = null;
  let orientation: number | null = null;
  let scanned = false;
  let dri = 0;
  const quant = new Map<number, Buffer>();
  const huff = new Map<number, Buffer>();
  const scans: JpegScan[] = [];
  while (i < b.length) {
    if (b[i] !== 0xff) throw new PhotoRejectedError('MALFORMED');
    let marker = b[i + 1];
    // octets de bourrage 0xFF
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1];
    }
    if (marker === undefined) throw new PhotoRejectedError('MALFORMED');
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // TEM ou RSTn hors d'un flux : aucun pixel, retiré
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new PhotoRejectedError('MALFORMED');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new PhotoRejectedError('MALFORMED');
    const p = b.subarray(i + 4, i + 2 + len);
    if (SOF.has(marker)) {
      if (len < 7) throw new PhotoRejectedError('MALFORMED');
      dims = largest(dims, { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) });
      checkDimensions(dims, limits);
      const nf = p[5] ?? 0;
      if (
        frame !== null ||
        !SOF_ACCEPTED.has(marker) ||
        nf < 1 ||
        nf > 4 ||
        p.length < 6 + 3 * nf
      ) {
        invalid = true;
      } else {
        const comps: JpegComponent[] = [];
        for (let k = 0; k < nf; k += 1) {
          const tq = p[8 + 3 * k] ?? 0;
          if (tq > 3) invalid = true;
          comps.push({
            id: p[6 + 3 * k] ?? 0,
            hv: p[7 + 3 * k] ?? 0,
            tq: tq & 3,
            latched: undefined,
          });
        }
        frame = { marker, head: Buffer.from(p.subarray(0, 5)), comps };
      }
    } else if (marker === 0xdb) {
      readQuant(p, quant);
    } else if (marker === 0xc4) {
      readHuffman(p, huff);
    } else if (marker === 0xdd) {
      if (p.length !== 2) throw new PhotoRejectedError('MALFORMED');
      dri = p.readUInt16BE(0);
    } else if (marker === 0xda) {
      // en-tête du scan, puis données compressées jusqu'au prochain marqueur : dans le flux,
      // 0xFF n'est suivi que de 0x00 (octet bourré) ou d'un RSTn ; tout autre marqueur (table,
      // scan suivant d'un JPEG progressif, APPn, EOI) reprend l'analyse des segments
      let j = i + 2 + len;
      while (j + 1 < b.length) {
        const next = b[j + 1] ?? 0;
        if (b[j] === 0xff && next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) {
          break;
        }
        j += 1;
      }
      if (j + 1 >= b.length) throw new PhotoRejectedError('MALFORMED');
      scanned = true;
      if (scans.length >= JPEG_MAX_SCANS) throw new PhotoRejectedError('MALFORMED');
      const ns = p[0] ?? 0;
      if (frame === null || ns < 1 || ns > 4 || p.length < 4 + 2 * ns) {
        invalid = true;
      } else {
        const progressive = frame.marker === 0xc2;
        const ss = p[1 + 2 * ns] ?? 0;
        const se = p[2 + 2 * ns] ?? 0;
        const ahal = p[3 + 2 * ns] ?? 0;
        // tables lues : DC au premier passage DC, AC aux passages AC (progressif) ; les deux en
        // séquentiel (ITU T.81, G.1.2)
        const dcRead = !progressive || (ss === 0 && ahal >> 4 === 0);
        const acRead = !progressive || ss > 0;
        const comps: { index: number; dc: Buffer | null; ac: Buffer | null }[] = [];
        const latch: number[] = [];
        for (let k = 0; k < ns; k += 1) {
          const cs = p[1 + 2 * k] ?? 0;
          const t = p[2 + 2 * k] ?? 0;
          const index = frame.comps.findIndex((c) => c.id === cs);
          if (index < 0 || t >> 4 > 3 || (t & 0x0f) > 3) {
            invalid = true;
            continue;
          }
          const c = frame.comps[index]!;
          if (c.latched === undefined) {
            // table absente : contenu vide, gardé tel quel (libjpeg échoue des deux côtés)
            c.latched = quant.get(c.tq) ?? UNDEFINED_TABLE;
            latch.push(index);
          }
          comps.push({
            index,
            dc: dcRead ? (huff.get(t >> 4) ?? UNDEFINED_TABLE) : null,
            ac: acRead ? (huff.get(0x10 | (t & 0x0f)) ?? UNDEFINED_TABLE) : null,
          });
        }
        scans.push({
          comps,
          latch,
          spectral: progressive ? Buffer.from([ss, se, ahal]) : Buffer.from([0, 63, 0]),
          dri,
          data: canonicalScan(b.subarray(i + 2 + len, j)),
        });
      }
      i = j;
      continue;
    } else if (marker === 0xe0) {
      if (!scanned && p.length >= 14 && p.subarray(0, 5).equals(JFIF_ID)) jfif = true;
    } else if (marker === 0xe1) {
      // le PREMIER APP1 EXIF avant le premier scan donne l'orientation (comme les navigateurs)
      if (!scanned && orientation === null) {
        const o = exifOrientation(p);
        if (o > 0) orientation = o;
      }
    } else if (marker === 0xee) {
      // le DERNIER Adobe avant le premier scan, comme libjpeg ; seule sa transformée compte
      if (!scanned && p.length >= 12 && p.subarray(0, 5).equals(ADOBE)) adobe = p[11] ?? 0;
    }
    // tout autre segment (APPn, COM, DNL, DAC, DHP, EXP, JPGn, réservés) : retiré
    i += 2 + len;
  }
  // EOI obligatoire : rien n'est conservé après lui
  if (dims === null || b[i + 1] !== 0xd9) throw new PhotoRejectedError('MALFORMED');
  if (frame === null || scans.length === 0 || frame.comps.some((c) => c.latched === undefined)) {
    invalid = true;
  }
  if (invalid || frame === null) return { clean: Buffer.alloc(0), dims, invalid: true };
  const clean = jpegAssemble(frame, scans, { jfif, adobe, orientation: orientation ?? 1 });
  // jamais d'amplification : la copie ne dépasse pas le fichier reçu (plus une marge fixe)
  if (clean.length > b.length + CANONICAL_MARGIN) {
    return { clean: Buffer.alloc(0), dims, invalid: true };
  }
  return { clean, dims, invalid: false };
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

function png(b: Buffer, limits: PhotoLimits): Parsed {
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
      checkDimensions(dims, limits);
    }
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (dims === null || !ended) throw new PhotoRejectedError('MALFORMED');
  return { clean: Buffer.concat(out), dims, invalid: false };
}

// ---- WebP ----------------------------------------------------------------------------------
// Copie CANONIQUE (ADR-204) : une image fixe, RÉÉCRITE. Gardés : une trame VP8 ou VP8L et, pour un
// VP8 avec transparence, son ALPH (octet d'en-tête : bits réservés remis à zéro) précédé d'un
// VP8X canonique (drapeau alpha seul, octets réservés à zéro, taille du canevas). Sans ALPH, le
// VP8X est retiré (sa taille est celle de la trame). Retirés : EXIF, XMP, ICCP, tout fragment
// privé ou inconnu, les octets au-delà de la taille RIFF ; octets de bourrage remis à zéro.
// Refusés (MALFORMED) : WebP animé (ANIM, ANMF ou drapeau d'animation), plusieurs trames ou
// plusieurs ALPH, ALPH sans VP8X ou avec une trame VP8L.
function webpChunk(type: string, data: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function webp(b: Buffer, limits: PhotoLimits): Parsed {
  let i = 12;
  let dims: Dimensions | null = null;
  let invalid = false;
  let canvas: Buffer | null = null;
  let alph: Buffer | null = null;
  let image: { readonly type: string; readonly data: Buffer } | null = null;
  const riff = b.readUInt32LE(4);
  if (riff < 4 || 8 + riff > b.length) throw new PhotoRejectedError('MALFORMED');
  const limit = 8 + riff;
  while (i + 8 <= limit) {
    const type = b.subarray(i, i + 4).toString('latin1');
    const len = b.readUInt32LE(i + 4);
    if (i + 8 + len > limit) throw new PhotoRejectedError('MALFORMED');
    const data = b.subarray(i + 8, i + 8 + len);
    // Taille de l'en-tête VP8X ET de chaque image VP8 / VP8L : la PLUS GRANDE est retenue (règle
    // F2-U-01 étendue au WebP, BOARD N-120 : un VP8 démesuré derrière un petit VP8X ne passe plus)
    if (type === 'VP8X' && len >= 10) {
      if (((data[0] ?? 0) & 0x02) !== 0 || canvas !== null) invalid = true;
      canvas = Buffer.from(data.subarray(4, 10));
      dims = largest(dims, { width: 1 + data.readUIntLE(4, 3), height: 1 + data.readUIntLE(7, 3) });
      checkDimensions(dims, limits);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (type === 'VP8 ' && len >= 10) {
        dims = largest(dims, {
          width: data.readUInt16LE(6) & 0x3fff,
          height: data.readUInt16LE(8) & 0x3fff,
        });
      } else if (type === 'VP8L' && len >= 5) {
        const bits = data.readUInt32LE(1);
        dims = largest(dims, { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
      }
      if (dims !== null) checkDimensions(dims, limits);
      if (image !== null) invalid = true;
      image = { type, data };
    } else if (type === 'ALPH') {
      if (alph !== null || len < 1) invalid = true;
      alph = Buffer.from(data);
      if (alph.length > 0) alph[0] = (alph[0] ?? 0) & 0x3f;
    } else if (type === 'ANIM' || type === 'ANMF') {
      invalid = true;
    }
    i += 8 + len + (len % 2);
  }
  if (dims === null || image === null) throw new PhotoRejectedError('MALFORMED');
  if (alph !== null && (canvas === null || image.type !== 'VP8 ')) invalid = true;
  if (invalid) return { clean: Buffer.alloc(0), dims, invalid: true };
  const chunks: Buffer[] = [];
  if (alph !== null && canvas !== null) {
    chunks.push(webpChunk('VP8X', Buffer.concat([Buffer.from([0x10, 0, 0, 0]), canvas])));
    chunks.push(webpChunk('ALPH', alph));
  }
  chunks.push(webpChunk(image.type, image.data));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { clean: Buffer.concat([header, body]), dims, invalid: false };
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
  let r: Parsed;
  try {
    r =
      mime === 'image/jpeg'
        ? jpeg(body, limits)
        : mime === 'image/png'
          ? png(body, limits)
          : webp(body, limits);
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
  // structure refusée (trame non acceptée, plusieurs trames, WebP animé…), jugée APRÈS les
  // dimensions : une taille démesurée reste refusée comme telle (F2-U-01)
  if (r.invalid) throw new PhotoRejectedError('MALFORMED');
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
