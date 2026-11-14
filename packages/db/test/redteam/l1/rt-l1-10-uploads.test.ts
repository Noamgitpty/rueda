/**
 * US-122 — red team du lot 1, passe n° 2, axe téléversements (RT-L1-A15 à A17 ; US-109, US-115,
 * US-124, ClamAV fail-closed DEC-FONDATEUR-20) : types déguisés, polyglottes, dimensions et
 * tailles hors borne, antivirus indisponible, pièce lue par un autre compte, rafales. Les
 * contrôles purs de l'API (`photo-ingest.ts`, `ports.ts`) sont joués dans la suite red team de la
 * base (groupe `l0-redteam`, après tous les autres fichiers), pour que leurs échecs ne masquent
 * pas les autres suites d'intégration. Rôles de production seulement (assertion L0-05 par
 * withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 17 §5 (« type MIME réel vérifié, taille maximale, analyse antivirus,
 * quarantaine avant usage »), 16 HST-012 et HST-039, pré-mortem L1-PM-41 à L1-PM-43 (RT-L1-A15 à
 * A17), ADR-099 et ADR-107. Les octets des images sont fabriqués ici, sans fichier de test ;
 * le fichier de test antivirus standard est construit en morceaux (jamais écrit tel quel).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import {
  DEFAULT_PHOTO_LIMITS,
  DOCUMENT_MAX_BYTES,
  UNAVAILABLE_DOCUMENTS,
  UnavailablePhotoScanner,
  documentsOpen,
  preparePhoto,
  sniffDocumentMime,
  sniffPhotoMime,
} from '../../../../../apps/api/src/modules/cat/index.ts';
import { ALL, byCountry, hostOf, otherOf, ops, rolledBack, targetOf, uuid } from './support.ts';
import type { Host, Tx } from './support.ts';
import { claimItem, first } from './support-host.ts';
import { PURPOSE, vehicleInReview } from './support-p2.ts';

/** Assertion L0-05 en tête de chaque test des contrôles purs : le rôle de production est affirmé. */
const l005 = (): Promise<void> => withRole('app_api', async () => undefined);

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

type PhotoLimits = NonNullable<Parameters<typeof preparePhoto>[1]>;
const LIMITS: PhotoLimits = { maxBytes: 4_000, maxSide: 100, maxPixels: 5_000 };
const reason = (body: Buffer, limits: PhotoLimits = LIMITS): string | null => {
  try {
    preparePhoto(body, limits);
    return null;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `ERREUR:${String(error)}`;
  }
};

describe('RT-L1-A15 — photo d’annonce : type déguisé, polyglotte (preparePhoto)', () => {
  it('témoins : un JPEG, un PNG et un WebP minimaux valides sont acceptés sous leur type réel', async () => {
    await l005();
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
      await l005();
      expect(reason(body)).toBe('TYPE');
      expect(sniffPhotoMime(body)).toBeNull();
    },
  );

  it('JPEG dont l’en-tête annonce un segment démesuré suivi de HTML : refusé (MALFORMED), jamais servi', async () => {
    await l005();
    const hostile = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('<html><script>alert(1)</script></html>'),
    ]);
    expect(reason(hostile)).toBe('MALFORMED');
  });

  it('JPEG valide suivi de HTML après EOI, PNG suivi de HTML après IEND, WebP suivi de HTML au-delà de la taille RIFF : la queue est retirée', async () => {
    await l005();
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
    await l005();
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
    await l005();
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
    await l005();
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
    await l005();
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
    await l005();
    expect(reason(body)).toBe('DIMENSIONS');
  });

  it('témoin : 70 × 70 (surface 4 900) et 100 × 50 passent', async () => {
    await l005();
    expect(reason(png(ihdr(70, 70)))).toBeNull();
    expect(reason(jpeg(sof(100, 50)))).toBeNull();
  });

  it('WebP dont la taille RIFF annoncée dépasse le fichier : refusé (MALFORMED)', async () => {
    await l005();
    const lie = webpLossless(20, 20);
    lie.writeUInt32LE(lie.readUInt32LE(4) + 1_000_000, 4);
    expect(reason(lie)).toBe('MALFORMED');
  });

  it('F2-U-01 : une image qui annonce deux tailles (deux SOF, deux IHDR) est refusée ; la première taille, celle que lit un décodeur, ne se cache pas derrière une seconde', async () => {
    await l005();
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
    await l005();
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
    await l005();
    expect(sniffDocumentMime(body)).toBeNull();
  });

  it('témoins : JPEG, PNG, PDF et HEIC reconnus d’après les octets', async () => {
    await l005();
    expect(sniffDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffDocumentMime(Buffer.concat([PNG_SIG, Buffer.alloc(4)]))).toBe('image/png');
    expect(sniffDocumentMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffDocumentMime(Buffer.concat([u32(24), Buffer.from('ftypheic')]))).toBe('image/heic');
  });

  it('L-L1-UP-02 (limite écrite dans ports.ts : seau privé, jamais l’origine) : un PDF suivi de HTML reste reconnu PDF ; la lecture n’est pas servie par l’origine de l’application', async () => {
    await l005();
    const polyglot = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    // le préfixe seul décide du type ; la protection est l'antivirus, le seau privé DOCUMENTS et la clé de l'hôte
    expect(sniffDocumentMime(polyglot)).toBe('application/pdf');
  });
});

describe('RT-L1-A17 — antivirus : fail-closed (ClamAV, DEC-FONDATEUR-20), fichier de test standard', () => {
  it('production tant que ClamAV n’est pas livré : l’adaptateur des photos rend UNAVAILABLE et le dépôt des pièces reste fermé ; le fichier de test antivirus n’est jamais libéré', async () => {
    await l005();
    const scan = await new UnavailablePhotoScanner().scan();
    expect(scan).toEqual({ status: 'UNAVAILABLE' });
    expect(documentsOpen(UNAVAILABLE_DOCUMENTS)).toBe(false);
    // fichier de test dans une image valide (fragment IDAT conservé par le nettoyage)
    const body = png(ihdr(20, 20), pngChunk('IDAT', Buffer.from(eicar(), 'latin1')));
    const prepared = preparePhoto(body, LIMITS);
    expect(prepared.mime).toBe('image/png');
    expect(scan.status).not.toBe('SCANNED');
    const doc = await UNAVAILABLE_DOCUMENTS.scanner.scan({
      declaredMime: 'application/pdf',
      body: Buffer.from(eicar(), 'latin1'),
    });
    expect(doc.status).not.toBe('SCANNED');
  });
});

// ---------------------------------------------------------------------------------------------
// Base : bornes de la commande, rafales, lecture par un autre compte
// ---------------------------------------------------------------------------------------------
const addPhoto = (
  tx: Tx,
  h: Host,
  listing: string,
  mime: string,
  bytes: number | string,
  sha = randomBytes(32),
) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
    [h.hash, h.org, listing, uuid(), uuid(), mime, bytes, sha],
  );
const addDocument = (
  tx: Tx,
  h: Host,
  vehicle: string,
  type: string,
  mime: string,
  bytes: number,
  sha = randomBytes(32),
) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, vehicle, uuid(), type, mime, bytes, sha, null],
  );

describe.each(byCountry)(
  'RT-L1-A15 / A16 — commandes de dépôt de la base (%s)',
  (_country, _currency, cc) => {
    it('photo : type déclaré hors liste blanche, taille nulle ou négative, empreinte de longueur fausse : PHOTO_FORMAT, aucune ligne', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        for (const mime of [
          'image/svg+xml',
          'text/html',
          'application/pdf',
          'application/x-msdownload',
          'image/gif',
        ]) {
          expect((await addPhoto(tx, t.host, t.listing, mime, 1000)).outcome, mime).toBe(
            'PHOTO_FORMAT',
          );
        }
        for (const bytes of [0, -1]) {
          expect(
            (await addPhoto(tx, t.host, t.listing, 'image/jpeg', bytes)).outcome,
            `${bytes} octets`,
          ).toBe('PHOTO_FORMAT');
        }
        expect(
          (await addPhoto(tx, t.host, t.listing, 'image/jpeg', 1000, randomBytes(31))).outcome,
        ).toBe('PHOTO_FORMAT');
        expect((await addPhoto(tx, t.host, t.listing, 'image/jpeg', 1000)).outcome, 'témoin').toBe(
          'DONE',
        );
      });
    });

    it('pièce : type déclaré hors liste blanche, taille hors de 1 à 10 485 760, type de pièce inconnu, date folle : VEHICLE_DOCUMENT_INVALID', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
        for (const mime of ['image/svg+xml', 'text/html', 'application/zip', 'image/webp']) {
          expect(
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', mime, 1000)).outcome,
            mime,
          ).toBe('VEHICLE_DOCUMENT_INVALID');
        }
        for (const bytes of [0, -5, 10_485_761, 2 ** 40]) {
          expect(
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', bytes)).outcome,
            `${bytes} octets`,
          ).toBe('VEHICLE_DOCUMENT_INVALID');
        }
        expect(
          (await addDocument(tx, t.host, t.vehicle, 'AUTRE', 'application/pdf', 1000)).outcome,
        ).toBe('VEHICLE_DOCUMENT_INVALID');
        expect(
          (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', 10_485_760))
            .outcome,
          'témoin à la borne',
        ).toBe('DONE');
      });
    });

    it('F2-U-02 (a) : la base ne laisse pas déclarer une photo de 10 Gio (la taille est bornée comme pour une pièce, défense en profondeur)', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        const r = await addPhoto(tx, t.host, t.listing, 'image/jpeg', String(10n * 1024n ** 3n));
        expect(r.outcome).toBe('PHOTO_FORMAT');
      });
    });

    it('F2-U-02 (b) : une annonce ne reçoit pas plus de 100 photos (PROPOSÉ ; plafond par annonce) ', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        let accepted = 0;
        for (let i = 0; i < 101; i += 1) {
          if ((await addPhoto(tx, t.host, t.listing, 'image/jpeg', 100_000)).outcome === 'DONE')
            accepted += 1;
        }
        expect(accepted).toBeLessThanOrEqual(100);
      });
    });

    it('F2-U-02 (c) : un véhicule ne reçoit pas plus de 20 dépôts de pièces en une minute (PROPOSÉ ; rafale de dépôts)', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
        let accepted = 0;
        for (let i = 0; i < 40; i += 1) {
          if (
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', 10_485_760))
              .outcome === 'DONE'
          )
            accepted += 1;
        }
        expect(accepted).toBeLessThanOrEqual(20);
      });
    });

    it('A15 — un autre hôte, un voyageur et une session absente ne déposent ni photo ni pièce sur l’annonce ou le véhicule d’autrui', async () => {
      await rolledBack(async (tx) => {
        const victim = await targetOf(tx, cc);
        const intruder = await hostOf(tx, cc.country);
        const guest = await hostOf(tx, otherOf(cc).country);
        for (const [who, h] of [
          ['hôte du même pays', intruder],
          ['hôte de l’autre pays', guest],
        ] as const) {
          const asVictim: Host = { ...h, org: victim.host.org };
          expect(
            (await addPhoto(tx, asVictim, victim.listing, 'image/jpeg', 1000)).outcome,
            who,
          ).not.toBe('DONE');
          expect(
            (await addDocument(tx, asVictim, victim.vehicle, 'TITLE', 'application/pdf', 1000))
              .outcome,
            who,
          ).not.toBe('DONE');
        }
        const forged: Host = { ...victim.host, hash: randomBytes(32) };
        expect((await addPhoto(tx, forged, victim.listing, 'image/jpeg', 1000)).outcome).not.toBe(
          'DONE',
        );
        expect(
          (await addDocument(tx, forged, victim.vehicle, 'TITLE', 'application/pdf', 1000)).outcome,
        ).not.toBe('DONE');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-A15 — pièce du véhicule : lue seulement par l’ops couvert (%s)',
  (country, _currency, cc) => {
    it('SUPPORT, FINANCE et OPS de l’autre pays ne lisent pas le dossier d’éligibilité (pièces) ; témoin : l’OPS du pays qui a pris l’élément le lit', async () => {
      await rolledBack(async (tx) => {
        const host = await hostOf(tx, country);
        const item = await vehicleInReview(tx, host, cc);
        const read = async (s: { hash: Buffer }) =>
          first<{ outcome: string; body: unknown }>(
            tx,
            'SELECT * FROM core.support_staff_vehicle_eligibility($1, $2, $3, $4)',
            [s.hash, uuid(), item, PURPOSE],
          );
        const denied = [
          await ops(tx, 'SUPPORT_AGENT', ALL),
          await ops(tx, 'FINANCE', ALL),
          await ops(tx, 'OPS_AGENT', [otherOf(cc).country]),
        ];
        for (const s of denied) {
          const r = await read(s);
          expect(r.outcome).not.toBe('GRANTED');
          expect(r.body ?? null).toBeNull();
        }
        const agent = await ops(tx, 'OPS_AGENT', [country]);
        await claimItem(tx, agent, item);
        expect((await read(agent)).outcome).toBe('GRANTED');
      });
    });
  },
);
