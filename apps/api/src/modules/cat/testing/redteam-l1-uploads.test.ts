/**
 * US-122 — red team du lot 1, passe n° 2, axe téléversements (RT-L1-A15 à A17 ; US-109, US-115,
 * US-124, ClamAV fail-closed DEC-FONDATEUR-20) : types déguisés, polyglottes, dimensions et
 * tailles hors borne, antivirus indisponible, pièce lue par un autre compte, rafales. Contrôles purs de l'API (`photo-ingest.ts`, `ports.ts`), sans base : joués ici
 * (module CAT, imports internes licites) ; les commandes de la base sont jouées dans
 * packages/db/test/redteam/l1/rt-l1-10-uploads.test.ts. Rapport : docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 17 §5 (« type MIME réel vérifié, taille maximale, analyse antivirus,
 * quarantaine avant usage »), 16 HST-012 et HST-039, pré-mortem L1-PM-41 à L1-PM-43 (RT-L1-A15 à
 * A17), ADR-099 et ADR-107. Les octets des images sont fabriqués ici, sans fichier de test ;
 * le fichier de test antivirus standard est construit en morceaux (jamais écrit tel quel).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_LIMITS,
  PhotoRejectedError,
  UnavailablePhotoScanner,
  isCleanScan,
  preparePhoto,
  sniffPhotoMime,
} from '../internal/host-listings/photo-ingest.js';
import type { PhotoLimits, PhotoScanResult } from '../internal/host-listings/photo-ingest.js';
import {
  DOCUMENT_MAX_BYTES,
  UNAVAILABLE_DOCUMENTS,
  documentsOpen,
  isCleanDocument,
  sniffDocumentMime,
} from '../internal/vehicle-documents/ports.js';

// ---------------------------------------------------------------------------------------------
// Fabrique d'images minimales (octets exacts ; aucun fichier de test)
// ---------------------------------------------------------------------------------------------
const u16 = (n: number): Buffer => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Segment SOF0 à un composant (hauteur puis largeur, comme la norme JPEG). */
const sof = (w: number, h: number): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xc0]),
    u16(11),
    Buffer.from([8]),
    u16(h),
    u16(w),
    Buffer.from([1, 1, 0x11, 0]),
  ]);
const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
const app = (marker: number, payload: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0xff, marker]), u16(payload.length + 2), payload]);
const jpeg = (...segments: Buffer[]): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    sos,
    Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);

const pngChunk = (type: string, data: Buffer): Buffer =>
  Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
const ihdr = (w: number, h: number): Buffer =>
  pngChunk('IHDR', Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]));
const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const png = (...chunks: Buffer[]): Buffer =>
  Buffer.concat([
    PNG_SIG,
    ...chunks,
    pngChunk('IDAT', Buffer.from([0x78])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

/** WebP sans perte (VP8L) d'une taille déclarée. */
const webpLossless = (w: number, h: number, trailing = Buffer.alloc(0)): Buffer => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const data = Buffer.concat([Buffer.from([0x2f]), u32le(bits)]);
  const chunk = Buffer.concat([
    Buffer.from('VP8L', 'latin1'),
    u32le(data.length),
    data,
    Buffer.alloc(1),
  ]);
  return Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    u32le(chunk.length + 4),
    Buffer.from('WEBP', 'latin1'),
    chunk,
    trailing,
  ]);
};

/** Fichier de test antivirus standard : construit en trois morceaux, jamais commité tel quel. */
const eicar = (): string =>
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

const LIMITS: PhotoLimits = { maxBytes: 4_000, maxSide: 100, maxPixels: 5_000 };
const reason = (body: Buffer, limits: PhotoLimits = LIMITS): string | null => {
  try {
    preparePhoto(body, limits);
    return null;
  } catch (error) {
    return error instanceof PhotoRejectedError ? error.reason : `ERREUR:${String(error)}`;
  }
};

describe('RT-L1-A15 — photo d’annonce : type déguisé, polyglotte (preparePhoto)', () => {
  it('témoins : un JPEG, un PNG et un WebP minimaux valides sont acceptés sous leur type réel', async () => {
    expect(preparePhoto(jpeg(sof(20, 20)), LIMITS).mime).toBe('image/jpeg');
    expect(preparePhoto(png(ihdr(20, 20)), LIMITS).mime).toBe('image/png');
    expect(preparePhoto(webpLossless(20, 20), LIMITS).mime).toBe('image/webp');
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['SVG précédé de blancs', Buffer.from('   \n<svg onload="alert(1)"/>')],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['PHP', Buffer.from('<?php system($_GET["c"]); ?>')],
    ['PDF', Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj')],
    ['GIF avec script', Buffer.from('GIF89a/*<script>alert(1)</script>*/')],
    ['archive ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ['exécutable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1')],
    ['TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0])],
    [
      'RIFF qui n’est pas WebP',
      Buffer.concat([Buffer.from('RIFF'), u32le(8), Buffer.from('AVI LIST')]),
    ],
    ['texte JSON', Buffer.from('{"image":"png"}')],
  ])(
    '%s déposé comme image : refusé (TYPE), le type déclaré n’est jamais cru',
    async (_name, body) => {
      expect(reason(body)).toBe('TYPE');
      expect(sniffPhotoMime(body)).toBeNull();
    },
  );

  it('JPEG dont l’en-tête annonce un segment démesuré suivi de HTML : refusé (MALFORMED), jamais servi', async () => {
    const hostile = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('<html><script>alert(1)</script></html>'),
    ]);
    expect(reason(hostile)).toBe('MALFORMED');
  });

  it('JPEG valide suivi de HTML après EOI, PNG suivi de HTML après IEND, WebP suivi de HTML au-delà de la taille RIFF : la queue est retirée', async () => {
    const tail = Buffer.from('<script>alert(1)</script>');
    const j = preparePhoto(Buffer.concat([jpeg(sof(20, 20)), tail]), LIMITS);
    const p = preparePhoto(Buffer.concat([png(ihdr(20, 20)), tail]), LIMITS);
    const w = preparePhoto(webpLossless(20, 20, tail), LIMITS);
    for (const [name, r] of [
      ['JPEG', j],
      ['PNG', p],
      ['WebP', w],
    ] as const) {
      expect(r.body.includes(Buffer.from('<script'))).toBe(false);
      expect(r.mime, name).toMatch(/^image\//);
    }
  });

  it('PNG : fragments de texte (tEXt, iTXt, eXIf, privé) portant du HTML ou du GPS sont retirés', async () => {
    const hostile = png(
      ihdr(20, 20),
      pngChunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>')),
      pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>gps</x:xmpmeta>')),
      pngChunk('eXIf', Buffer.from('Exif\0\0GPS')),
      pngChunk('prVt', Buffer.from('<img src=x onerror=alert(1)>')),
    );
    const r = preparePhoto(hostile, LIMITS);
    for (const needle of ['<script', 'xmpmeta', 'Exif', 'onerror']) {
      expect(r.body.includes(Buffer.from(needle)), needle).toBe(false);
    }
  });

  it('JPEG : EXIF, XMP et commentaire portant du HTML ou du GPS sont retirés', async () => {
    const hostile = jpeg(
      app(0xe1, Buffer.from('Exif\0\0GPSLatitude')),
      app(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>')),
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        u16(2 + 25),
        Buffer.from('<script>alert(1)</script>'),
      ]),
      sof(20, 20),
    );
    const r = preparePhoto(hostile, LIMITS);
    for (const needle of ['GPSLatitude', 'xmpmeta', '<script']) {
      expect(r.body.includes(Buffer.from(needle)), needle).toBe(false);
    }
  });

  it('L-L1-UP-01 (limite assumée, ADR-099 : pas de ré-encodage) : un JPEG valide qui porte du texte dans APP0 est servi sous son type réel image/jpeg, jamais comme page', async () => {
    const r = preparePhoto(
      jpeg(app(0xe0, Buffer.from('JFIF\0<script>alert(1)</script>')), sof(20, 20)),
      LIMITS,
    );
    // le contenu n'est pas ré-encodé (limite écrite) : la défense est le type réel et le seau public séparé
    expect(r.mime).toBe('image/jpeg');
    expect(r.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  });
});

describe('RT-L1-A16 — photo d’annonce : taille et dimensions hors borne (preparePhoto)', () => {
  it('taille jugée AVANT tout traitement : un corps trop gros ou vide est refusé (SIZE) même s’il est illisible', async () => {
    expect(reason(Buffer.alloc(LIMITS.maxBytes + 1, 0x41))).toBe('SIZE');
    expect(reason(Buffer.concat([PNG_SIG, Buffer.alloc(LIMITS.maxBytes)]))).toBe('SIZE');
    expect(reason(Buffer.alloc(0))).toBe('SIZE');
  });

  it.each([
    ['PNG de 101 × 1 (côté)', png(ihdr(101, 1))],
    ['PNG de 80 × 80 (surface 6 400)', png(ihdr(80, 80))],
    ['PNG 0 × 0', png(ihdr(0, 0))],
    ['PNG de 4 294 967 295 × 4 294 967 295', png(ihdr(0xffffffff, 0xffffffff))],
    ['JPEG de 101 × 1', jpeg(sof(101, 1))],
    ['JPEG de 65 535 × 65 535', jpeg(sof(0xffff, 0xffff))],
    ['WebP de 16 384 × 16 384', webpLossless(16_384, 16_384)],
  ])('%s : refusé (DIMENSIONS) avant tout décodage', async (_name, body) => {
    expect(reason(body)).toBe('DIMENSIONS');
  });

  it('témoin : 70 × 70 (surface 4 900) et 100 × 50 passent', async () => {
    expect(reason(png(ihdr(70, 70)))).toBeNull();
    expect(reason(jpeg(sof(100, 50)))).toBeNull();
  });

  it('WebP dont la taille RIFF annoncée dépasse le fichier : refusé (MALFORMED)', async () => {
    const lie = webpLossless(20, 20);
    lie.writeUInt32LE(lie.readUInt32LE(4) + 1_000_000, 4);
    expect(reason(lie)).toBe('MALFORMED');
  });

  it('F2-U-01 : une image qui annonce deux tailles (deux SOF, deux IHDR) est refusée ; la première taille, celle que lit un décodeur, ne se cache pas derrière une seconde', async () => {
    // témoin : la taille démesurée annoncée EN SECOND est bien vue
    expect(reason(jpeg(sof(20, 20), sof(0xffff, 0xffff)))).toBe('DIMENSIONS');
    expect(reason(png(ihdr(20, 20), ihdr(0xffffff, 0xffffff)))).toBe('DIMENSIONS');
    // attaque : la taille démesurée est annoncée EN PREMIER, une taille anodine en second
    expect(
      reason(jpeg(sof(0xffff, 0xffff), sof(20, 20)), LIMITS),
      'JPEG à deux SOF',
    ).not.toBeNull();
    expect(
      reason(png(ihdr(0xffffff, 0xffffff), ihdr(20, 20)), LIMITS),
      'PNG à deux IHDR',
    ).not.toBeNull();
  });

  it('bornes par défaut de l’API : jamais plus que la borne de la base pour une pièce (10 485 760 octets, 0077)', async () => {
    expect(DOCUMENT_MAX_BYTES).toBeLessThanOrEqual(10_485_760);
    expect(DEFAULT_PHOTO_LIMITS.maxBytes).toBeLessThanOrEqual(10_485_760);
  });
});

describe('RT-L1-A15 — pièce du véhicule : type déguisé (sniffDocumentMime)', () => {
  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['HTML', Buffer.from('<html><script>alert(1)</script></html>')],
    ['PDF précédé d’un blanc', Buffer.from(' %PDF-1.7')],
    ['archive ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['exécutable', Buffer.from('MZ\x90\x00', 'latin1')],
    ['GIF', Buffer.from('GIF89a')],
    ['ftyp d’une vidéo MP4', Buffer.concat([u32(24), Buffer.from('ftypisom')])],
    ['texte', Buffer.from('titre de propriété')],
  ])('%s déposé comme pièce : refusé (type réel inconnu)', async (_name, body) => {
    expect(sniffDocumentMime(body)).toBeNull();
  });

  it('témoins : JPEG, PNG, PDF et HEIC reconnus d’après les octets', async () => {
    expect(sniffDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffDocumentMime(Buffer.concat([PNG_SIG, Buffer.alloc(4)]))).toBe('image/png');
    expect(sniffDocumentMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffDocumentMime(Buffer.concat([u32(24), Buffer.from('ftypheic')]))).toBe('image/heic');
  });

  it('L-L1-UP-02 (limite écrite dans ports.ts : seau privé, jamais l’origine) : un PDF suivi de HTML reste reconnu PDF ; la lecture n’est pas servie par l’origine de l’application', async () => {
    const polyglot = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    // le préfixe seul décide du type ; la protection est l'antivirus, le seau privé DOCUMENTS et la clé de l'hôte
    expect(sniffDocumentMime(polyglot)).toBe('application/pdf');
  });
});

describe('RT-L1-A17 — antivirus : fail-closed (ClamAV, DEC-FONDATEUR-20), fichier de test standard', () => {
  const clean = (mime: string): PhotoScanResult => ({
    status: 'SCANNED',
    report: { verdict: 'CLEAN', detectedMime: mime },
  });

  it('seul SCANNED + CLEAN + type réel identique libère ; panne, délai, infecté, type discordant, verdict ou statut inconnu : quarantaine', async () => {
    const cases: readonly [string, PhotoScanResult, boolean][] = [
      ['sain', clean('image/png'), true],
      ['antivirus indisponible', { status: 'UNAVAILABLE' }, false],
      ['délai dépassé', { status: 'TIMEOUT' }, false],
      [
        'infecté',
        { status: 'SCANNED', report: { verdict: 'INFECTED', detectedMime: 'image/png' } },
        false,
      ],
      ['type discordant', clean('application/pdf'), false],
      [
        'type inconnu',
        { status: 'SCANNED', report: { verdict: 'CLEAN', detectedMime: null } },
        false,
      ],
      [
        'verdict en minuscules',
        { status: 'SCANNED', report: { verdict: 'clean', detectedMime: 'image/png' } },
        false,
      ],
      [
        'verdict inconnu',
        { status: 'SCANNED', report: { verdict: 'SUSPICIOUS', detectedMime: 'image/png' } },
        false,
      ],
      [
        'statut inconnu porteur d’un rapport sain',
        { status: 'PARTIAL', report: clean('image/png') } as unknown as PhotoScanResult,
        false,
      ],
    ];
    for (const [name, scan, released] of cases) {
      expect(isCleanScan(scan, 'image/png'), name).toBe(released);
      expect(isCleanDocument(scan, 'image/png' as never), name).toBe(released);
    }
  });

  it('résultat d’antivirus sans rapport (adaptateur défaillant) : jamais libéré, jamais une exception qui laisserait passer', async () => {
    const broken = { status: 'SCANNED' } as unknown as PhotoScanResult;
    let released: boolean | 'ERREUR';
    try {
      released = isCleanScan(broken, 'image/png');
    } catch {
      released = 'ERREUR';
    }
    expect(released).not.toBe(true);
  });

  it('production tant que ClamAV n’est pas livré : l’adaptateur des photos rend UNAVAILABLE et le dépôt des pièces reste fermé ; le fichier de test antivirus n’est jamais libéré', async () => {
    const scan = await new UnavailablePhotoScanner().scan();
    expect(scan).toEqual({ status: 'UNAVAILABLE' });
    expect(documentsOpen(UNAVAILABLE_DOCUMENTS)).toBe(false);
    // fichier de test dans une image valide (fragment IDAT conservé par le nettoyage)
    const body = png(ihdr(20, 20), pngChunk('IDAT', Buffer.from(eicar(), 'latin1')));
    const prepared = preparePhoto(body, LIMITS);
    expect(prepared.mime).toBe('image/png');
    expect(isCleanScan(scan, prepared.mime)).toBe(false);
    const doc = await UNAVAILABLE_DOCUMENTS.scanner.scan({
      declaredMime: 'application/pdf',
      body: Buffer.from(eicar(), 'latin1'),
    });
    expect(isCleanDocument(doc, 'application/pdf')).toBe(false);
  });
});
