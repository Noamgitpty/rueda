/**
 * Contrôles communs des photos (AUD, US-303 ; BOARD N-120) : la règle F2-U-01 (plusieurs tailles
 * annoncées : la plus grande) s'applique aussi au WebP. Attendus tirés de N-120 (« VP8 démesuré +
 * VP8X petit »), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import { PhotoRejectedError, preparePhoto } from './photo-checks.js';

const LIMITS = { maxBytes: 1_000_000, maxSide: 1600, maxPixels: 1600 * 1600 };

function chunk(type: string, data: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** WebP : en-tête VP8X (taille annoncée) puis image VP8 (taille de l'image). */
function webp(vp8x: [number, number], vp8: [number, number]): Buffer {
  const x = Buffer.alloc(10);
  x.writeUIntLE(vp8x[0] - 1, 4, 3);
  x.writeUIntLE(vp8x[1] - 1, 7, 3);
  const f = Buffer.alloc(10);
  f.set([0x9d, 0x01, 0x2a], 3);
  f.writeUInt16LE(vp8[0], 6);
  f.writeUInt16LE(vp8[1], 8);
  const body = Buffer.concat([chunk('VP8X', x), chunk('VP8 ', f)]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

describe('N-120 — WebP : la plus grande taille annoncée est retenue', () => {
  it('VP8X petit + VP8 démesuré ⇒ DIMENSIONS', () => {
    expect(() => preparePhoto(webp([20, 20], [16_000, 16_000]), LIMITS)).toThrow(
      new PhotoRejectedError('DIMENSIONS'),
    );
  });
  it('VP8X démesuré + VP8 petit ⇒ DIMENSIONS', () => {
    expect(() => preparePhoto(webp([16_000, 20], [20, 20]), LIMITS)).toThrow(PhotoRejectedError);
  });
  it('témoin : tailles cohérentes dans les bornes ⇒ acceptée', () => {
    expect(preparePhoto(webp([1600, 1200], [1600, 1200]), LIMITS).dims).toEqual({
      width: 1600,
      height: 1200,
    });
  });
});
