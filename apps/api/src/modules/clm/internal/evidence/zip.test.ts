/**
 * Archive ZIP du dossier de preuve (US-308, ADR-184). Oracles indépendants du code testé : vecteur
 * CRC-32 de l'ISO 3309 / ITU-T V.42 (« 123456789 » ⇒ 0xCBF43926), table CRC-32 recalculée ici, et
 * lecture de l'archive par le répertoire central d'après la spécification PKWARE APPNOTE 4.3.
 */
import { describe, expect, it } from 'vitest';
import { buildZip, isSafeZipPath, ZipInputError } from './zip.js';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

interface Read {
  readonly name: string;
  readonly data: Buffer;
  readonly crc: number;
  readonly method: number;
  readonly flags: number;
  readonly date: number;
  readonly time: number;
}

/** Lecture par le répertoire central (fin d'archive → entrées → en-têtes locaux). */
function readZip(zip: Buffer): Read[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Read[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const size = zip.readUInt32LE(local + 22);
    const lName = zip.readUInt16LE(local + 26);
    const lExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    out.push({
      name,
      data: zip.subarray(start, start + size),
      crc: zip.readUInt32LE(p + 16),
      method: zip.readUInt16LE(p + 10),
      flags: zip.readUInt16LE(p + 8),
      date: zip.readUInt16LE(p + 14),
      time: zip.readUInt16LE(p + 12),
    });
    p += 46 + nameLen;
  }
  return out;
}

describe('buildZip', () => {
  const at = new Date('2035-07-01T09:00:00.000Z');

  it('vecteur CRC-32 « 123456789 » ⇒ CBF43926 ; octets stockés à l’identique, noms UTF-8', () => {
    expect(crc(Buffer.from('123456789'))).toBe(0xcbf43926);
    const entries = [
      { path: 'manifest.json', data: Buffer.from('{"schema": "clm.evidence/1"}') },
      { path: 'photos/CHECKIN/GUEST/01-EXT_01-a.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0, 1]) },
      { path: 'contract/contract-v1.pdf', data: Buffer.from('%PDF-1.7\n') },
    ];
    const zip = buildZip(entries, at);
    const read = readZip(zip);
    expect(read.map((r) => r.name)).toEqual(entries.map((e) => e.path));
    for (const [i, r] of read.entries()) {
      expect(r.data.equals(entries[i]!.data)).toBe(true);
      expect(r.crc).toBe(crc(entries[i]!.data));
      expect(r.method).toBe(0);
      expect(r.flags & 0x0800).toBe(0x0800);
      // 2035-07-01 09:00:00 UTC en date et heure MS-DOS
      expect(r.date).toBe(((2035 - 1980) << 9) | (7 << 5) | 1);
      expect(r.time).toBe(9 << 11);
    }
  });

  it('déterministe : mêmes entrées, même heure ⇒ mêmes octets', () => {
    const e = [{ path: 'manifest.json', data: Buffer.from('x') }];
    expect(buildZip(e, at).equals(buildZip(e, at))).toBe(true);
  });

  it('chemins refusés : absolu, remontée, vide, en double ; aucune entrée', () => {
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a//b', '', 'a/./b', 'a\\b']) {
      expect(isSafeZipPath(bad), bad).toBe(false);
      expect(() => buildZip([{ path: bad, data: Buffer.alloc(1) }], at)).toThrow(ZipInputError);
    }
    expect(() =>
      buildZip(
        [
          { path: 'a.txt', data: Buffer.alloc(1) },
          { path: 'a.txt', data: Buffer.alloc(1) },
        ],
        at,
      ),
    ).toThrow(ZipInputError);
    expect(() => buildZip([], at)).toThrow(ZipInputError);
    expect(() =>
      buildZip([{ path: 'a', data: Buffer.alloc(1) }], new Date('1970-01-01T00:00:00Z')),
    ).toThrow(ZipInputError);
  });
});
