/**
 * US-313 — red team du lot 3, passe de la porte : VARIANTES contre le correctif #291 (US-303,
 * empreinte de la copie nettoyée, index unique `trip_inspection_photo_sha256_unique`, F-L3-PRE-01).
 * RT-L3-P03 ; risque L3-PM-03. TESTS SEULEMENT (aucun correctif). Sans base : le service RÉEL des
 * photos d'état (`InspectionService`) avec le FAKE du magasin et des ports, comme `l3-photo-exif`.
 * Rapport : docs/team/redteam/L3-porte.md.
 *
 * Attendus (jamais le code testé) : 16 TRP-004 (« une photo ne sert qu'une fois ») ; ADR-196
 * (l'empreinte est celle de la copie NETTOYÉE ; elle « ne change pas quand on modifie un octet de
 * métadonnée : la garde ne se contourne pas en retouchant l'EXIF ») ; la limite assumée par ADR-196
 * est le RÉ-ENCODAGE des pixels (empreinte perceptuelle : suite au BOARD), pas une retouche
 * d'octets sans toucher à un pixel.
 *
 * Variantes : un JPEG dont les octets de pixels sont IDENTIQUES et dont seuls changent un champ de
 * densité de l'en-tête JFIF, une vignette JFIF, un segment APP2 « ICC_PROFILE » de charge quelconque
 * (conservé par la liste blanche), ou des octets de bourrage 0xFF avant le marqueur de fin (permis
 * par la norme JPEG, conservés dans le flux de données). Chaque variante a une empreinte DIFFÉRENTE
 * de la copie nettoyée de l'original : l'index unique ne les reconnaît pas, la même prise de vue
 * remplit autant d'angles ou de trips qu'on veut de variantes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { InspectionService } from '../../internal/inspection/inspection.service.js';
import type { EvidencePipeline, EvidenceVault } from '../../internal/inspection/ports.js';
import { FakeInspectionStore } from '../fake-inspection-store.js';

const seg = (marker: number, data: Buffer): Buffer => {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([h, data]);
};

/** Pixels (en-tête de trame, en-tête de scan et données) : IDENTIQUES pour toutes les variantes. */
const PIXELS = (() => {
  const sof = Buffer.alloc(9);
  sof[0] = 8;
  sof.writeUInt16BE(600, 1);
  sof.writeUInt16BE(800, 3);
  sof[5] = 1;
  sof.set([1, 0x11, 0], 6);
  return {
    frame: seg(0xc0, sof),
    scanHeader: seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    data: Buffer.alloc(32, 0x11),
  };
})();

/** JFIF : version 1.01, unité, densité (x, y), vignette éventuelle (largeur, hauteur, RGB). */
function jfif(density: number, thumb?: Buffer): Buffer {
  const head = Buffer.alloc(14);
  head.write('JFIF\0', 0, 'latin1');
  head.set([1, 1, 1], 5);
  head.writeUInt16BE(density, 8);
  head.writeUInt16BE(density, 10);
  const tw = thumb === undefined ? 0 : 1;
  head[12] = tw;
  head[13] = tw;
  return seg(0xe0, thumb === undefined ? head : Buffer.concat([head, thumb]));
}

const icc = (payload: Buffer): Buffer =>
  seg(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), payload]));

function jpeg(parts: { app?: Buffer[]; fill?: number }): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(parts.app ?? [jfif(72)]),
    PIXELS.frame,
    PIXELS.scanHeader,
    PIXELS.data,
    Buffer.alloc(parts.fill ?? 0, 0xff),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Coffre FAKE : « scelle » par un préfixe et une inversion des octets (jamais le clair). */
const PREFIX = 'sealed:';
const vault: EvidenceVault = {
  prepare: () => Promise.resolve('READY'),
  seal: (_tx, _user, _file, body) =>
    Promise.resolve({
      status: 'SEALED',
      body: Buffer.concat([Buffer.from(PREFIX), Buffer.from(body.map((b) => b ^ 0xff))]),
    }),
};

/** Dépose une photo d'état par le service réel ; rend l'empreinte enregistrée (copie nettoyée). */
async function fingerprintOf(original: Buffer): Promise<string> {
  const store = new FakeInspectionStore();
  const files = new InMemoryFileStore();
  const pipeline: EvidencePipeline = { scanner: new FakeUploadScanner(), vault, files };
  const service = new InspectionService(store, pipeline);
  const trip = randomUUID();
  const proof = Buffer.alloc(32, 1);
  store.trips.set(trip, {
    hostProof: Buffer.alloc(32, 2).toString('hex'),
    guestProof: proof.toString('hex'),
    open: { CHECKIN: true, CHECKOUT: false, INCIDENT: false, TRAFFIC: false },
    maxKb: 500,
    maxPx: 1600,
  });
  const cap = await service.openCapture(proof, trip, 'checkin', { slot: 'EXT_01' });
  const r = await service.addPhoto(proof, randomUUID(), trip, 'checkin', {
    captureId: cap.captureId,
    slot: 'EXT_01',
    source: 'CAMERA',
    sha256: createHash('sha256').update(original).digest('hex'),
    dataBase64: original.toString('base64'),
  });
  return r.sha256;
}

const VARIANTS: readonly (readonly [string, Buffer])[] = [
  ['densité JFIF 96 au lieu de 72', jpeg({ app: [jfif(96)] })],
  ['vignette JFIF de 1 × 1 pixel', jpeg({ app: [jfif(72, Buffer.from([10, 20, 30]))] })],
  [
    'segment ICC_PROFILE de charge quelconque',
    jpeg({ app: [jfif(72), icc(Buffer.from('rt-l3-a'))] }),
  ],
  ['autre charge ICC_PROFILE', jpeg({ app: [jfif(72), icc(Buffer.from('rt-l3-b'))] })],
  ['deux octets de bourrage 0xFF avant le marqueur de fin', jpeg({ fill: 2 })],
  ['sept octets de bourrage 0xFF avant le marqueur de fin', jpeg({ fill: 7 })],
];

describe('RT-L3-P03 (L3-PM-03) — variantes de la même prise de vue contre l’empreinte de la copie nettoyée', () => {
  const original = jpeg({});

  it('témoin : le même fichier renvoyé donne la même empreinte (la garde reconnaît l’égalité d’octets)', async () => {
    expect(await fingerprintOf(original)).toBe(await fingerprintOf(Buffer.from(original)));
  });

  it('témoin : les segments EXIF et les commentaires, eux, ne changent pas l’empreinte (le correctif de la PR 291 tient)', async () => {
    const withExif = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jfif(72),
      seg(0xe1, Buffer.from('Exif\0\0RT-L3-VARIANTE', 'latin1')),
      seg(0xfe, Buffer.from('commentaire', 'latin1')),
      PIXELS.frame,
      PIXELS.scanHeader,
      PIXELS.data,
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(await fingerprintOf(withExif)).toBe(await fingerprintOf(original));
  });

  // CORRIGÉ (ADR-204, copie canonique) : l'observation de l'attaque devient la preuve du refus. Les
  // variantes sont inchangées ; chacune a l'empreinte de l'original, que l'index unique
  // `trip_inspection_photo_sha256_unique` refuse déjà (PHOTO_DUPLICATE)
  it('preuve du refus F-L3-PRE-04 : chaque variante, pixels identiques, a l’empreinte de l’original ; l’index unique les refuse toutes', async () => {
    const base = await fingerprintOf(original);
    for (const [label, body] of VARIANTS) {
      // l'octet envoyé diffère bien de l'original (l'attaque est jouée)
      expect(body.equals(original), label).toBe(false);
      expect(await fingerprintOf(body), label).toBe(base);
    }
  });

  // CONSTAT F-L3-PRE-04 : l'empreinte est celle des octets de la copie nettoyée, qui garde des
  // champs libres (densité et vignette JFIF, charge d'un segment ICC, bourrage du flux) ; correction
  // attendue : une copie CANONIQUE (champs libres normalisés ou retirés, bourrage supprimé) dont
  // l'empreinte ne dépend que des pixels. CORRIGÉ (ADR-204) : inversé en test de comportement, attaque
  // et attendu inchangés
  it('CONSTAT F-L3-PRE-04 (corrigé) : des octets de pixels identiques donnent la même empreinte, quelle que soit la retouche des champs libres (densité, vignette, profil ICC, bourrage)', async () => {
    const base = await fingerprintOf(original);
    const fingerprints = await Promise.all(VARIANTS.map(([, body]) => fingerprintOf(body)));
    expect(new Set([base, ...fingerprints]).size).toBe(1);
  });
});
