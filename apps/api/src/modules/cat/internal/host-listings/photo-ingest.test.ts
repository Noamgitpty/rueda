/**
 * US-115 — réception d'une photo d'annonce (16 HST-012 ; 17 §5 ; L1-PM-19, L1-PM-41, L1-PM-42 ;
 * ADR-099) : type réel, taille, dimensions avant décodage, retrait des métadonnées (EXIF dont GPS,
 * XMP, textes), antivirus fail-closed, dépôt après la ligne. Images fabriquées en mémoire,
 * données fictives (coordonnées GPS inventées).
 */
import { describe, expect, it } from 'vitest';
import { FakeUploadScanner } from '@rueda/fake-adapters/files';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { HostListingHttpError } from './errors.js';
import { HostListingsService } from './host-listings.service.js';
import {
  preparePhoto,
  PhotoRejectedError,
  sniffPhotoMime,
  UnavailablePhotoScanner,
} from './photo-ingest.js';
import { FakeHostListingStore } from '../../testing/fake-host-listing-store.js';

const GPS = Buffer.from('GPSLatitude=8.983712;GPSLongitude=-79.519843', 'latin1');

/** JPEG minimal : SOI, APP0 (JFIF), APP1 (EXIF avec GPS), COM, APP13, SOF0 320×240, SOS, données, EOI. */
function jpeg(width = 320, height = 240): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([h, payload]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), GPS])),
    seg(0xfe, Buffer.from('commentaire de l’appareil', 'utf8')),
    seg(0xed, Buffer.from('Photoshop 3.0 IPTC', 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(width = 64, height = 48): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('eXIf', GPS),
    chunk('tEXt', Buffer.from('Comment\0domicile de l’hôte', 'utf8')),
    chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>', 'latin1')),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function webp(width = 100, height = 80): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'latin1');
    h.writeUInt32LE(data.length, 4);
    return Buffer.concat([h, data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c; // EXIF + XMP annoncés
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8 = Buffer.alloc(10);
  vp8.set([0x9d, 0x01, 0x2a], 3);
  vp8.writeUInt16LE(width, 6);
  vp8.writeUInt16LE(height, 8);
  const body = Buffer.concat([
    chunk('VP8X', vp8x),
    chunk('VP8 ', vp8),
    chunk('EXIF', GPS),
    chunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1')),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

describe('type réel et liste blanche (L1-PM-41)', () => {
  it('JPEG, PNG, WebP reconnus par leurs octets ; SVG, HTML, PDF, polyglotte, inconnu refusés', () => {
    expect(sniffPhotoMime(jpeg())).toBe('image/jpeg');
    expect(sniffPhotoMime(png())).toBe('image/png');
    expect(sniffPhotoMime(webp())).toBe('image/webp');
    for (const bad of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('<!doctype html><script>alert(1)</script>'),
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('GIF89a'),
      Buffer.alloc(0),
    ]) {
      expect(() => preparePhoto(bad)).toThrow(PhotoRejectedError);
    }
  });
});

describe('métadonnées retirées, pixels conservés (L1-PM-19)', () => {
  it.each([
    ['JPEG', jpeg()],
    ['PNG', png()],
    ['WebP', webp()],
  ])(
    '%s : EXIF (GPS), XMP, IPTC, commentaires et textes retirés ; type et dimensions conservés',
    (_label, image) => {
      const clean = preparePhoto(image);
      expect(clean.body.includes(GPS)).toBe(false);
      expect(clean.body.toString('latin1')).not.toMatch(
        /GPSLatitude|Exif\0|xmpmeta|Photoshop|domicile|commentaire/,
      );
      expect(sniffPhotoMime(clean.body)).toBe(clean.mime);
      expect(clean.body.length).toBeLessThan(image.length);
      // une seconde passe ne retire plus rien (idempotent)
      expect(preparePhoto(clean.body).body.equals(clean.body)).toBe(true);
    },
  );

  it('JPEG : données compressées et marqueurs de fin intacts ; APP0 conservé', () => {
    const clean = preparePhoto(jpeg());
    expect(clean.dims).toEqual({ width: 320, height: 240 });
    expect(
      clean.body.subarray(-8).equals(Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9])),
    ).toBe(true);
    expect(clean.body.includes(Buffer.from('JFIF', 'latin1'))).toBe(true);
  });

  it('WebP : drapeaux EXIF et XMP de VP8X remis à zéro ; taille RIFF recalculée', () => {
    const clean = preparePhoto(webp());
    expect(clean.dims).toEqual({ width: 100, height: 80 });
    expect((clean.body[20] ?? 0) & 0x0c).toBe(0);
    expect(clean.body.readUInt32LE(4)).toBe(clean.body.length - 8);
  });

  it('PNG : IHDR, IDAT et IEND conservés', () => {
    const clean = preparePhoto(png());
    expect(clean.dims).toEqual({ width: 64, height: 48 });
    for (const t of ['IHDR', 'IDAT', 'IEND'])
      expect(clean.body.includes(Buffer.from(t))).toBe(true);
  });
});

describe('taille et dimensions avant décodage (L1-PM-42)', () => {
  it('fichier trop gros, image géante ou surface excessive : refusés', () => {
    expect(() =>
      preparePhoto(jpeg(), { maxBytes: 10, maxSide: 8000, maxPixels: 40_000_000 }),
    ).toThrow(/SIZE/);
    expect(() => preparePhoto(jpeg(9000, 100))).toThrow(/DIMENSIONS/);
    expect(() => preparePhoto(png(7000, 7000))).toThrow(/DIMENSIONS/);
    expect(() => preparePhoto(webp(1, 1))).not.toThrow();
  });

  it('structure tronquée ou incohérente : MALFORMED, jamais un dépôt', () => {
    expect(() => preparePhoto(jpeg().subarray(0, 30))).toThrow(PhotoRejectedError);
    expect(() => preparePhoto(png().subarray(0, 40))).toThrow(PhotoRejectedError);
  });
});

describe('service : antivirus fail-closed, ligne puis dépôt (Q-019, N-52)', () => {
  const env = { RUEDA_ENV: 'test' };
  const proof = Buffer.alloc(32, 7);
  const setup = () => {
    const store = new FakeHostListingStore();
    store.addHost(proof, { orgId: 'org', country: 'XX', currency: 'XXX', status: 'ONBOARDING' });
    store.locationsById.set('loc', {
      orgId: 'org',
      input: {
        kind: 'HOME',
        label: 'x',
        addressLine: 'x',
        city: 'x',
        areaLabel: null,
        lat: null,
        lng: null,
      },
    });
    store.vehiclesById.set('veh', {
      orgId: 'org',
      country: 'XX',
      input: {
        locationId: 'loc',
        plate: 'AB1',
        vin: null,
        variantId: null,
        makeText: 'm',
        modelText: 'm',
        year: 2020,
        trim: null,
        transmission: 'MANUAL',
        seats: 5,
        fuelType: 'GASOLINE',
        odometerKm: null,
        gpsInstalled: false,
        lienDeclared: false,
      },
    });
    store.listingsById.set('lst', {
      id: 'lst',
      orgId: 'org',
      vehicleId: 'veh',
      status: 'DRAFT',
      pricing: {
        dailyPriceMinor: 1n,
        mileageMode: 'UNLIMITED',
        includedKmPerDay: null,
        extraKmPriceMinor: null,
      },
      instantBook: true,
      photos: 0,
    });
    return store;
  };

  it('production (antivirus indisponible) : 503 PHOTO_UPLOAD_UNAVAILABLE, rien de déposé', async () => {
    const store = setup();
    const files = new InMemoryFileStore({ env });
    const svc = new HostListingsService(store, null, {
      scanner: new UnavailablePhotoScanner(),
      storage: files,
    });
    await expect(svc.addPhoto(proof, 'org', 'lst', jpeg())).rejects.toMatchObject({
      code: 'PHOTO_UPLOAD_UNAVAILABLE',
    });
    expect(store.deposited).toEqual([]);
  });

  it('FAKE sain : photo nettoyée déposée sous listing/{annonce}/{photo} ; infectée ou type trompeur : PHOTO_FORMAT', async () => {
    const store = setup();
    const files = new InMemoryFileStore({ env });
    const scanner = new FakeUploadScanner({ env });
    const svc = new HostListingsService(store, null, { scanner, storage: files });
    const r = await svc.addPhoto(proof, 'org', 'lst', jpeg());
    expect(r.code).toBe('PHOTO_ADDED');
    expect(store.deposited).toEqual([`listing/lst/${r.photoId}`]);
    const stored = await files.get('PUBLIC_LISTING', `listing/lst/${r.photoId}`);
    expect(stored.status).toBe('FOUND');
    if (stored.status === 'FOUND') expect(stored.body.includes(GPS)).toBe(false);
    const infected = Buffer.concat([
      jpeg().subarray(0, -2),
      Buffer.from('FAKE-MALWARE-SIGNATURE'),
      Buffer.from([0xff, 0xd9]),
    ]);
    await expect(svc.addPhoto(proof, 'org', 'lst', infected)).rejects.toBeInstanceOf(
      HostListingHttpError,
    );
    await expect(svc.addPhoto(proof, 'org', 'lst', Buffer.from('<svg/>'))).rejects.toMatchObject({
      code: 'PHOTO_FORMAT',
    });
    expect(store.deposited).toHaveLength(1);
  });

  it('stockage indisponible : 503, la ligne n’est pas validée (création seule, rien d’écrasé)', async () => {
    const store = setup();
    const scanner = new FakeUploadScanner({ env });
    const svc = new HostListingsService(store, null, {
      scanner,
      storage: { put: () => Promise.resolve({ status: 'UNAVAILABLE' }) },
    });
    await expect(svc.addPhoto(proof, 'org', 'lst', png())).rejects.toMatchObject({
      code: 'PHOTO_UPLOAD_UNAVAILABLE',
    });
    expect(store.listingsById.get('lst')?.photos).toBe(0);
  });
});
