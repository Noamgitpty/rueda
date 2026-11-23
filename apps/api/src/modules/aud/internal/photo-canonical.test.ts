/**
 * Copie CANONIQUE des photos (AUD ; ADR-204, constat F-L3-PRE-04 de la passe de la porte de la red
 * team du lot 3) : la copie nettoyée, donc son empreinte SHA-256, ne dépend que des données de
 * l'image. Attendus tirés de la norme JPEG (ISO/CEI 10918-1 : JFIF et APPn facultatifs, octets de
 * bourrage 0xFF permis devant un marqueur, tables découpables en plusieurs segments) et du format
 * WebP (bits réservés à zéro, ICCP facultatif), jamais du code testé : deux fichiers aux MÊMES
 * données d'image ont la même copie ; une donnée d'image changée change la copie.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PhotoRejectedError, preparePhoto } from './photo-checks.js';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const fingerprint = (b: Buffer): string => sha(preparePhoto(b).body);

const seg = (marker: number, data: Buffer): Buffer => {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([h, data]);
};

function jfif(density: number, thumb?: Buffer): Buffer {
  const head = Buffer.alloc(14);
  head.write('JFIF\0', 0, 'latin1');
  head.set([1, 2, 1], 5);
  head.writeUInt16BE(density, 8);
  head.writeUInt16BE(density, 10);
  head[12] = thumb === undefined ? 0 : 1;
  head[13] = thumb === undefined ? 0 : 1;
  return seg(0xe0, thumb === undefined ? head : Buffer.concat([head, thumb]));
}

const icc = (payload: string): Buffer =>
  seg(0xe2, Buffer.from(`ICC_PROFILE\0\x01\x01${payload}`, 'latin1'));
const adobe = (version: number, flags: number, transform: number): Buffer =>
  seg(0xee, Buffer.from([0x41, 0x64, 0x6f, 0x62, 0x65, 0, version, 0, flags, 0, 0, transform]));

/** Tables : deux DQT (8 bits, id 0 et 1) et deux DHT (DC 0, AC 0), chacune une seule valeur. */
const Q0 = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 2)]);
const Q1 = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(64, 3)]);
const counts = Buffer.alloc(16);
counts[0] = 1;
const H00 = Buffer.concat([Buffer.from([0x00]), counts, Buffer.from([0x04])]);
const H10 = Buffer.concat([Buffer.from([0x10]), counts, Buffer.from([0x05])]);

const FRAME = (() => {
  const sof = Buffer.alloc(9);
  sof[0] = 8;
  sof.writeUInt16BE(48, 1);
  sof.writeUInt16BE(64, 3);
  sof[5] = 1;
  sof.set([1, 0x11, 0], 6);
  return seg(0xc0, sof);
})();
const SCAN = seg(0xda, Buffer.from([1, 1, 0x00, 0, 0x3f, 0]));
/** Flux compressé avec un octet bourré (FF 00) et une reprise (FF D0). */
const DATA = Buffer.from([0x21, 0x43, 0xff, 0x00, 0x65, 0xff, 0xd0, 0x87, 0xa9]);

interface Parts {
  readonly app?: readonly Buffer[];
  readonly tables?: readonly Buffer[];
  readonly data?: Buffer;
  readonly fillBeforeEoi?: number;
  readonly extra?: readonly Buffer[];
}

function jpeg(p: Parts = {}): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(p.app ?? [jfif(72)]),
    ...(p.tables ?? [seg(0xdb, Buffer.concat([Q0, Q1])), seg(0xc4, Buffer.concat([H00, H10]))]),
    ...(p.extra ?? []),
    FRAME,
    SCAN,
    p.data ?? DATA,
    Buffer.alloc(p.fillBeforeEoi ?? 0, 0xff),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('F-L3-PRE-04 (ADR-204) — JPEG : mêmes données d’image, même copie', () => {
  const base = fingerprint(jpeg());

  it.each([
    ['densité JFIF 96', jpeg({ app: [jfif(96)] })],
    ['densité JFIF 300 et vignette 1 × 1', jpeg({ app: [jfif(300, Buffer.from([1, 2, 3]))] })],
    ['sans JFIF', jpeg({ app: [] })],
    ['profil ICC quelconque', jpeg({ app: [jfif(72), icc('profil-a')] })],
    ['autre profil ICC', jpeg({ app: [jfif(72), icc('profil-b'), icc('suite')] })],
    ['bourrage 0xFF avant EOI (2 octets)', jpeg({ fillBeforeEoi: 2 })],
    ['bourrage 0xFF avant EOI (7 octets)', jpeg({ fillBeforeEoi: 7 })],
    [
      'bourrage 0xFF dans le flux, devant RSTn et devant un octet bourré',
      jpeg({
        data: Buffer.from([0x21, 0x43, 0xff, 0xff, 0x00, 0x65, 0xff, 0xff, 0xff, 0xd0, 0x87, 0xa9]),
      }),
    ],
    [
      'tables découpées un segment par table, dans un autre ordre',
      jpeg({
        tables: [seg(0xc4, H10), seg(0xdb, Q1), seg(0xc4, H00), seg(0xdb, Q0)],
      }),
    ],
    [
      'table redéfinie à l’identique dans le même groupe',
      jpeg({
        tables: [
          seg(0xdb, Buffer.concat([Q0, Q1])),
          seg(0xc4, Buffer.concat([H00, H10])),
          seg(0xdb, Q0),
        ],
      }),
    ],
    [
      'segment d’extension JPG0 et marqueur réservé',
      jpeg({ extra: [seg(0xf0, Buffer.from('x')), seg(0x30, Buffer.from('y'))] }),
    ],
    [
      'octets de bourrage 0xFF entre deux segments',
      jpeg({ extra: [Buffer.from([0xff, 0xff, 0xff])] }),
    ],
  ] as const)('%s ⇒ même empreinte', (_label, body) => {
    expect(fingerprint(body)).toBe(base);
  });

  it('Adobe : version et drapeaux libres ignorés, transformée de couleur gardée', () => {
    const a = fingerprint(jpeg({ app: [adobe(100, 0, 1)] }));
    expect(fingerprint(jpeg({ app: [jfif(72), adobe(101, 0x80, 1)] }))).toBe(a);
    // une autre transformée change le rendu des pixels : autre copie
    expect(fingerprint(jpeg({ app: [adobe(100, 0, 0)] }))).not.toBe(a);
    expect(a).not.toBe(base);
  });

  it('témoins : une donnée d’image changée (flux, table, scan) change la copie ; la copie est idempotente et reste un JPEG lisible', () => {
    const others = [
      jpeg({ data: Buffer.from([0x21, 0x43, 0xff, 0x00, 0x65, 0xff, 0xd0, 0x87, 0xaa]) }),
      jpeg({
        tables: [
          seg(0xdb, Buffer.concat([Q0, Buffer.from([0x01]), Buffer.alloc(64, 4)])),
          seg(0xc4, Buffer.concat([H00, H10])),
        ],
      }),
    ];
    for (const o of others) expect(fingerprint(o)).not.toBe(base);
    const clean = preparePhoto(jpeg({ app: [jfif(96), icc('p')], fillBeforeEoi: 3 }));
    expect(preparePhoto(clean.body).body.equals(clean.body)).toBe(true);
    expect(clean.dims).toEqual({ width: 64, height: 48 });
    expect(clean.body.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(clean.body.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    // les octets du flux (octet bourré, reprise) sont intacts
    expect(clean.body.includes(DATA)).toBe(true);
  });

  it('table mal formée (DQT tronquée, DHT d’un identifiant hors norme) ⇒ MALFORMED', () => {
    for (const tables of [
      [seg(0xdb, Q0.subarray(0, 30))],
      [seg(0xc4, Buffer.concat([Buffer.from([0x24]), counts, Buffer.from([0x04])]))],
      [seg(0xdd, Buffer.from([0, 1, 2]))],
    ]) {
      expect(() => preparePhoto(jpeg({ tables }))).toThrow(PhotoRejectedError);
    }
  });
});

function chunk(type: string, data: Buffer, pad = 0): Buffer {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 === 1 ? Buffer.from([pad]) : Buffer.alloc(0)]);
}

function webp(o: { flags?: number; reserved?: number; iccp?: string; pad?: number } = {}): Buffer {
  const x = Buffer.alloc(10);
  x[0] = o.flags ?? 0;
  x[1] = o.reserved ?? 0;
  x.writeUIntLE(63, 4, 3);
  x.writeUIntLE(47, 7, 3);
  const f = Buffer.alloc(11);
  f.set([0x9d, 0x01, 0x2a], 3);
  f.writeUInt16LE(64, 6);
  f.writeUInt16LE(48, 8);
  f[10] = 0x5a;
  const body = Buffer.concat([
    chunk('VP8X', x),
    ...(o.iccp === undefined ? [] : [chunk('ICCP', Buffer.from(o.iccp, 'latin1'))]),
    chunk('VP8 ', f, o.pad ?? 0),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

describe('F-L3-PRE-04 (ADR-204) — WebP : mêmes données d’image, même copie', () => {
  const base = fingerprint(webp());

  it.each([
    ['profil ICCP (drapeau ICC posé)', webp({ flags: 0x20, iccp: 'profil-a' })],
    ['autre profil ICCP', webp({ flags: 0x20, iccp: 'profil-bb' })],
    ['drapeaux EXIF et XMP posés sans fragment', webp({ flags: 0x0c })],
    ['bits et octets réservés de VP8X', webp({ flags: 0xc1, reserved: 0x7f })],
    ['octet de bourrage non nul après un fragment impair', webp({ pad: 0xee })],
  ] as const)('%s ⇒ même empreinte', (_label, body) => {
    expect(fingerprint(body)).toBe(base);
  });

  it('témoins : le drapeau alpha ou une donnée de la trame change la copie', () => {
    expect(fingerprint(webp({ flags: 0x10 }))).not.toBe(base);
    const other = webp();
    other[other.length - 2] = 0x5b;
    expect(fingerprint(other)).not.toBe(base);
  });
});
