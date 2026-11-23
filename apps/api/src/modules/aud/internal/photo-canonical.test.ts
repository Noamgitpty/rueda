/**
 * Copie CANONIQUE des photos (AUD ; ADR-204, constat F-L3-PRE-04 de la passe de la porte de la red
 * team du lot 3, et revues de la PR 302) : la copie nettoyée, donc son empreinte SHA-256, ne dépend
 * que de ce qu'un décodeur retient de l'image. Attendus tirés de la norme JPEG (ITU T.81 : JFIF et
 * APPn facultatifs, bourrage 0xFF permis devant un marqueur, tables découpables, redéfinissables,
 * lues par le scan qui les utilise ; DRI 0 = pas d'intervalle ; Ss / Se / Ah / Al sans effet en
 * séquentiel), du décodeur libjpeg (jdapimin.c : espace de couleur par JFIF, puis le dernier Adobe,
 * puis les identifiants « R G B » ; tables de quantification figées au premier scan d'une
 * composante) et du format WebP (bits réservés à zéro, ICCP facultatif, VP8X facultatif sans
 * transparence ni animation), jamais du code testé : deux fichiers aux MÊMES données d'image ont la
 * même copie ; une donnée d'image changée change la copie.
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

/** Tables de quantification 8 bits Q(emplacement, valeur), 16 bits Q16. */
const Q = (slot: number, v: number): Buffer =>
  Buffer.concat([Buffer.from([slot]), Buffer.alloc(64, v)]);
const Q16 = (slot: number, v: number): Buffer =>
  Buffer.concat([Buffer.from([0x10 | slot]), Buffer.alloc(128, v)]);
const counts = Buffer.alloc(16);
counts[0] = 1;
/** Table de Huffman (classe, emplacement) à une valeur. */
const H = (cls: number, slot: number, v: number): Buffer =>
  Buffer.concat([Buffer.from([(cls << 4) | slot]), counts, Buffer.from([v])]);
const dqt = (...t: Buffer[]): Buffer => seg(0xdb, Buffer.concat(t));
const dht = (...t: Buffer[]): Buffer => seg(0xc4, Buffer.concat(t));
const dri = (n: number): Buffer => seg(0xdd, Buffer.from([n >> 8, n & 0xff]));

/** Trame : composantes (identifiant, échantillonnage, table de quantification). */
function sof(ids = [1, 2, 3], tq = [0, 1, 1], marker = 0xc0): Buffer {
  const p = Buffer.alloc(6 + 3 * ids.length);
  p[0] = 8;
  p.writeUInt16BE(48, 1);
  p.writeUInt16BE(64, 3);
  p[5] = ids.length;
  ids.forEach((id, k) => p.set([id, k === 0 ? 0x22 : 0x11, tq[k] ?? 0], 6 + 3 * k));
  return seg(marker, p);
}

type Sel = readonly [number, number];
const SEQ: readonly Sel[] = [
  [1, 0x00],
  [2, 0x11],
  [3, 0x11],
];

/** Scan : composantes (identifiant, Td << 4 | Ta), puis Ss, Se, Ah / Al. */
const sos = (comps: readonly Sel[] = SEQ, tail: readonly number[] = [0, 63, 0]): Buffer =>
  seg(0xda, Buffer.from([comps.length, ...comps.flat(), ...tail]));

/** Flux compressé avec un octet bourré (FF 00) et une reprise (FF D0). */
const DATA = Buffer.from([0x21, 0x43, 0xff, 0x00, 0x65, 0xff, 0xd0, 0x87, 0xa9]);
const QT = dqt(Q(0, 2), Q(1, 3));
const HT = dht(H(0, 0, 4), H(0, 1, 5), H(1, 0, 6), H(1, 1, 7));
const RGB_IDS = [0x52, 0x47, 0x42];
const RGB_SEL: readonly Sel[] = [
  [0x52, 0x00],
  [0x47, 0x11],
  [0x42, 0x11],
];

const jpeg = (...parts: Buffer[]): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])]);
/** Image de référence : JFIF, tables, trame, scan séquentiel, flux. */
const BASE = jpeg(jfif(72), QT, HT, sof(), sos(), DATA);

describe('F-L3-PRE-04 (ADR-204) — JPEG : mêmes données d’image, même copie', () => {
  const base = fingerprint(BASE);

  it.each([
    ['densité JFIF 96', jpeg(jfif(96), QT, HT, sof(), sos(), DATA)],
    ['vignette JFIF', jpeg(jfif(300, Buffer.from([1, 2, 3])), QT, HT, sof(), sos(), DATA)],
    ['sans JFIF (identifiants 1, 2, 3 : YCbCr)', jpeg(QT, HT, sof(), sos(), DATA)],
    ['profil ICC quelconque', jpeg(jfif(72), icc('a'), QT, HT, sof(), sos(), DATA)],
    ['deux profils ICC', jpeg(jfif(72), icc('b'), icc('c'), QT, HT, sof(), sos(), DATA)],
    [
      'Adobe transformée 1 (YCbCr), version et drapeaux libres',
      jpeg(adobe(101, 0x80, 1), QT, HT, sof(), sos(), DATA),
    ],
    [
      'le dernier Adobe avant le scan l’emporte (0 puis 1)',
      jpeg(adobe(100, 0, 0), QT, HT, sof(), adobe(100, 0, 1), sos(), DATA),
    ],
    [
      'Adobe après le premier scan : ignoré',
      jpeg(jfif(72), QT, HT, sof(), sos(), DATA, adobe(100, 0, 0)),
    ],
    ['bourrage 0xFF avant EOI', jpeg(jfif(72), QT, HT, sof(), sos(), DATA, Buffer.alloc(7, 0xff))],
    [
      'bourrage 0xFF dans le flux',
      jpeg(
        jfif(72),
        QT,
        HT,
        sof(),
        sos(),
        Buffer.from([0x21, 0x43, 0xff, 0xff, 0x00, 0x65, 0xff, 0xff, 0xd0, 0x87, 0xa9]),
      ),
    ],
    [
      'bourrage 0xFF entre deux segments',
      jpeg(jfif(72), Buffer.from([0xff, 0xff]), QT, HT, sof(), sos(), DATA),
    ],
    [
      'tables découpées, un segment par table, autre ordre',
      jpeg(
        jfif(72),
        dht(H(1, 1, 7)),
        dqt(Q(1, 3)),
        dht(H(0, 0, 4)),
        dqt(Q(0, 2)),
        dht(H(1, 0, 6), H(0, 1, 5)),
        sof(),
        sos(),
        DATA,
      ),
    ],
    ['DQT après la trame', jpeg(jfif(72), HT, sof(), QT, sos(), DATA)],
    [
      'DQT répétée à l’identique avant et après la trame',
      jpeg(jfif(72), QT, HT, sof(), dqt(Q(0, 2)), QT, sos(), DATA),
    ],
    [
      'DQT 16 bits redéfinie en 8 bits (la dernière l’emporte)',
      jpeg(jfif(72), dqt(Q16(0, 9)), QT, HT, sof(), sos(), DATA),
    ],
    ['DHT copiée après le scan', jpeg(jfif(72), QT, HT, sof(), sos(), DATA, HT)],
    [
      'tables inutilisées (emplacements 2 et 3)',
      jpeg(jfif(72), QT, HT, dqt(Q(2, 8)), dht(H(0, 3, 9)), sof(), sos(), DATA),
    ],
    ['DRI 0 ajouté', jpeg(jfif(72), QT, HT, dri(0), sof(), sos(), DATA)],
    ['DRI après le dernier scan', jpeg(jfif(72), QT, HT, sof(), sos(), DATA, dri(8))],
    [
      'emplacements de tables renumérotés (quantification 3 et 2, Huffman 1 et 0)',
      jpeg(
        jfif(72),
        dqt(Q(3, 2), Q(2, 3)),
        dht(H(0, 1, 4), H(0, 0, 5), H(1, 1, 6), H(1, 0, 7)),
        sof([1, 2, 3], [3, 2, 2]),
        sos([
          [1, 0x11],
          [2, 0x00],
          [3, 0x00],
        ]),
        DATA,
      ),
    ],
    [
      'identifiants de composantes renumérotés (avec JFIF)',
      jpeg(
        jfif(72),
        QT,
        HT,
        sof([7, 8, 9]),
        sos([
          [7, 0x00],
          [8, 0x11],
          [9, 0x11],
        ]),
        DATA,
      ),
    ],
    [
      'identifiants « R G B » avec JFIF (JFIF l’emporte : YCbCr)',
      jpeg(jfif(72), QT, HT, sof(RGB_IDS), sos(RGB_SEL), DATA),
    ],
    [
      'Ss, Se, Ah / Al libres d’un scan séquentiel',
      jpeg(jfif(72), QT, HT, sof(), sos(SEQ, [5, 9, 0x31]), DATA),
    ],
    [
      'DNL, DAC, JPG0 et marqueur réservé',
      jpeg(
        jfif(72),
        QT,
        HT,
        sof(),
        seg(0xcc, Buffer.from([0x00, 0x10])),
        sos(),
        DATA,
        seg(0xdc, Buffer.alloc(2000, 7)),
        seg(0xf0, Buffer.from('x')),
        seg(0x30, Buffer.from('y')),
      ),
    ],
  ] as const)('%s ⇒ même empreinte', (_label, body) => {
    expect(fingerprint(body)).toBe(base);
  });

  it('espace de couleur gardé : RGB (Adobe 0, ou identifiants « R G B » sans JFIF ni Adobe) ≠ YCbCr ; les deux formes RGB ont la même copie', () => {
    const rgbAdobe = fingerprint(jpeg(adobe(100, 0, 0), QT, HT, sof(), sos(), DATA));
    const rgbIds = jpeg(QT, HT, sof(RGB_IDS), sos(RGB_SEL), DATA);
    expect(rgbAdobe).not.toBe(base);
    expect(fingerprint(rgbIds)).toBe(rgbAdobe);
    // l'ordre des Adobe compte : le dernier (transformée 0) l'emporte
    expect(fingerprint(jpeg(adobe(100, 0, 1), adobe(100, 0, 0), QT, HT, sof(), sos(), DATA))).toBe(
      rgbAdobe,
    );
    // la copie RGB porte un Adobe canonique (transformée 0), jamais de JFIF
    const clean = preparePhoto(rgbIds).body;
    expect(clean.includes(Buffer.from([0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0]))).toBe(
      true,
    );
    expect(clean.includes(Buffer.from('JFIF', 'latin1'))).toBe(false);
  });

  it('témoins : une donnée d’image changée change la copie (flux, table lue, intervalle de reprise, table d’une composante)', () => {
    const others = [
      jpeg(
        jfif(72),
        QT,
        HT,
        sof(),
        sos(),
        Buffer.from([0x21, 0x43, 0xff, 0x00, 0x65, 0xff, 0xd0, 0x87, 0xaa]),
      ),
      jpeg(jfif(72), dqt(Q(0, 2), Q(1, 4)), HT, sof(), sos(), DATA),
      jpeg(jfif(72), QT, dht(H(0, 0, 4), H(0, 1, 5), H(1, 0, 6), H(1, 1, 8)), sof(), sos(), DATA),
      jpeg(jfif(72), QT, HT, dri(4), sof(), sos(), DATA),
      jpeg(jfif(72), QT, HT, sof([1, 2, 3], [1, 0, 0]), sos(), DATA),
    ];
    const seen = new Set([base, ...others.map(fingerprint)]);
    expect(seen.size).toBe(others.length + 1);
  });

  it('progressif : sélecteurs non lus remis à 0 (Ta d’un scan DC, Td d’un scan AC) ; Ss / Se / Ah / Al gardés', () => {
    const prog = (dc: readonly Sel[], dcTail: readonly number[], acSel: number): Buffer =>
      jpeg(
        jfif(72),
        QT,
        HT,
        sof(undefined, undefined, 0xc2),
        sos(dc, dcTail),
        DATA,
        sos([[1, acSel]], [1, 63, 0]),
        DATA,
      );
    const DC: readonly Sel[] = [
      [1, 0x00],
      [2, 0x10],
      [3, 0x10],
    ];
    const p = fingerprint(prog(DC, [0, 0, 0], 0x00));
    expect(fingerprint(prog(DC, [0, 0, 0], 0x30))).toBe(p);
    expect(
      fingerprint(
        prog(
          [
            [1, 0x01],
            [2, 0x11],
            [3, 0x11],
          ],
          [0, 0, 0],
          0x00,
        ),
      ),
    ).toBe(p);
    expect(fingerprint(prog(DC, [0, 0, 1], 0x00))).not.toBe(p);
    expect(p).not.toBe(base);
  });

  it('la copie est idempotente, et un JPEG lisible : SOI, JFIF canonique, tables, trame, scan, flux intact, EOI', () => {
    const clean = preparePhoto(
      jpeg(jfif(96), icc('p'), QT, HT, sof(), sos(), DATA, Buffer.alloc(3, 0xff)),
    ).body;
    expect(preparePhoto(clean).body.equals(clean)).toBe(true);
    expect(clean.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(clean.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(clean.includes(DATA)).toBe(true);
    expect(clean.includes(Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))).toBe(true);
  });

  it('refusés : trame sans perte, arithmétique ou hiérarchique, deux trames, table mal formée (MALFORMED) ; deux trames dont une démesurée (DIMENSIONS)', () => {
    for (const body of [
      jpeg(QT, HT, sof(undefined, undefined, 0xc3), sos(), DATA),
      jpeg(QT, HT, sof(undefined, undefined, 0xc9), sos(), DATA),
      jpeg(QT, HT, sof(undefined, undefined, 0xc5), sos(), DATA),
      jpeg(QT, HT, sof(), sof(), sos(), DATA),
      jpeg(dqt(Q(0, 2).subarray(0, 30)), sof(), sos(), DATA),
      jpeg(dht(Buffer.concat([Buffer.from([0x24]), counts, Buffer.from([4])])), sof(), sos(), DATA),
      jpeg(QT, HT, seg(0xdd, Buffer.from([0, 1, 2])), sof(), sos(), DATA),
    ]) {
      expect(() => preparePhoto(body)).toThrow(PhotoRejectedError);
      expect(() => preparePhoto(body)).toThrow(/MALFORMED/);
    }
    const huge = Buffer.alloc(15);
    huge[0] = 8;
    huge.writeUInt16BE(60_000, 1);
    huge.writeUInt16BE(60_000, 3);
    huge[5] = 3;
    expect(() => preparePhoto(jpeg(QT, HT, sof(), seg(0xc0, huge), sos(), DATA))).toThrow(
      /DIMENSIONS/,
    );
  });
});

function chunk(type: string, data: Buffer, pad = 0): Buffer {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 === 1 ? Buffer.from([pad]) : Buffer.alloc(0)]);
}

const riff = (...chunks: Buffer[]): Buffer => {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
};

function vp8x(flags = 0, reserved = 0): Buffer {
  const x = Buffer.alloc(10);
  x[0] = flags;
  x[1] = reserved;
  x.writeUIntLE(63, 4, 3);
  x.writeUIntLE(47, 7, 3);
  return chunk('VP8X', x);
}

function vp8(last = 0x5a, pad = 0): Buffer {
  const f = Buffer.alloc(11);
  f.set([0x9d, 0x01, 0x2a], 3);
  f.writeUInt16LE(64, 6);
  f.writeUInt16LE(48, 8);
  f[10] = last;
  return chunk('VP8 ', f, pad);
}

describe('F-L3-PRE-04 (ADR-204) — WebP : mêmes données d’image, même copie', () => {
  const base = fingerprint(riff(vp8x(), vp8()));
  const alpha = fingerprint(riff(vp8x(0x10), chunk('ALPH', Buffer.from([0x00, 1, 2])), vp8()));

  it.each([
    ['sans VP8X (ni transparence ni animation)', riff(vp8())],
    [
      'profil ICCP (drapeau ICC posé)',
      riff(vp8x(0x20), chunk('ICCP', Buffer.from('profil-a')), vp8()),
    ],
    ['autre profil ICCP', riff(vp8x(0x20), chunk('ICCP', Buffer.from('profil-bb')), vp8())],
    [
      'drapeaux EXIF et XMP posés, fragments EXIF et XMP',
      riff(vp8x(0x0c), vp8(), chunk('EXIF', Buffer.from('gps')), chunk('XMP ', Buffer.from('x'))),
    ],
    ['bits et octets réservés de VP8X', riff(vp8x(0xc1, 0x7f), vp8())],
    ['drapeau alpha sans ALPH', riff(vp8x(0x10), vp8())],
    ['octet de bourrage non nul après un fragment impair', riff(vp8x(), vp8(0x5a, 0xee))],
  ] as const)('%s ⇒ même empreinte', (_label, body) => {
    expect(fingerprint(body)).toBe(base);
  });

  it('transparence : ALPH gardé avec un VP8X canonique ; bits réservés de l’ALPH, autres drapeaux et ordre ignorés', () => {
    expect(alpha).not.toBe(base);
    expect(fingerprint(riff(vp8x(0x3c, 9), vp8(), chunk('ALPH', Buffer.from([0xc0, 1, 2]))))).toBe(
      alpha,
    );
    expect(fingerprint(riff(vp8x(0x10), chunk('ALPH', Buffer.from([0x00, 1, 3])), vp8()))).not.toBe(
      alpha,
    );
  });

  it('témoin : une donnée de la trame change la copie', () => {
    expect(fingerprint(riff(vp8x(), vp8(0x5b)))).not.toBe(base);
  });

  it('refusés (MALFORMED) : WebP animé (drapeau, ANIM, ANMF), deux trames, ALPH sans VP8X', () => {
    for (const body of [
      riff(vp8x(0x02), vp8()),
      riff(vp8x(), chunk('ANIM', Buffer.alloc(6)), vp8()),
      riff(vp8x(), chunk('ANMF', Buffer.alloc(16)), vp8()),
      riff(vp8x(), vp8(), vp8()),
      riff(chunk('ALPH', Buffer.from([0, 1])), vp8()),
    ]) {
      expect(() => preparePhoto(body)).toThrow(/MALFORMED/);
    }
  });
});
