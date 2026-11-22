/**
 * US-313 — red team du lot 3, RT-L3-P06 (19 US-313 critère 2 ; risque L3-PM-06) : une photo d'état
 * portant une géolocalisation EXIF, reçue par le service REEL des photos d'état (`InspectionService`,
 * US-303) avec le FAKE du magasin et des ports (antivirus, coffre, stockage). TESTS SEULEMENT
 * (aucun correctif). Sans base : `pnpm --filter @rueda/api test:unit`. Rapport :
 * docs/team/redteam/L3-preuves-versements.md.
 *
 * Attendus (jamais le code testé) :
 * - 19 US-303 critère 2 (« l'empreinte du fichier stocké égale celle enregistrée ») et pré-mortem
 *   L3-PM-06 (« EXIF retiré de la copie servie ; position lue par l'ops seulement ») : la photo est
 *   nettoyée par l'étape 4 de `preparePhoto` (retrait des métadonnées, 17 §5), l'objet déposé en
 *   `PRIVATE_EVIDENCE` est ce que le dossier de preuve (US-308) relit, déchiffre et range dans
 *   l'archive remise au demandeur (ops, puis l'assureur partenaire : 19 US-308) ;
 * - témoin : la copie nettoyée par `preparePhoto` ne porte aucune métadonnée EXIF.
 *
 * Constat F-L3-PRE-02 : le service nettoie la photo pour juger son type et ses dimensions, mais
 * ÉCARTE la copie nettoyée : l'empreinte, le coffre et le stockage reçoivent les octets d'ORIGINE
 * (`input.content`), EXIF et position GPS compris. Le dossier de preuve les range tels quels.
 */
import { createHash, randomUUID } from 'node:crypto';
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { preparePhoto } from '../../../aud/index.js';
import { InspectionService } from '../../internal/inspection/inspection.service.js';
import type { EvidencePipeline, EvidenceVault } from '../../internal/inspection/ports.js';
import { FakeInspectionStore } from '../fake-inspection-store.js';

/** Position fictive, reconnaissable dans les octets (jamais une vraie adresse). */
const GPS = 'GPSLatitude=00.0000N;GPSLongitude=000.0000W;RT-L3-P06';

/** JPEG minimal valide (SOI, APP1 EXIF, SOF0, SOS, données, EOI) portant `GPS` dans l'EXIF. */
function jpegWithGps(): Buffer {
  const seg = (marker: number, data: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([h, data]);
  };
  const sof = Buffer.alloc(9);
  sof[0] = 8;
  sof.writeUInt16BE(600, 1);
  sof.writeUInt16BE(800, 3);
  sof[5] = 1;
  sof.set([1, 0x11, 0], 6);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe1, Buffer.from(`Exif\0\0${GPS}`, 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.alloc(32, 0x11),
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
const unseal = (stored: Buffer): Buffer =>
  Buffer.from(stored.subarray(PREFIX.length).map((b) => b ^ 0xff));

/** Dépose une photo d'état par le service réel ; rend les octets REÇUS par le stockage, en clair. */
async function deposit(original: Buffer): Promise<{ stored: Buffer; sha256: string }> {
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
  const sent = createHash('sha256').update(original).digest('hex');
  const r = await service.addPhoto(proof, randomUUID(), trip, 'checkin', {
    captureId: cap.captureId,
    slot: 'EXT_01',
    source: 'CAMERA',
    sha256: sent,
    dataBase64: original.toString('base64'),
  });
  // clé de stockage : celle du magasin FAKE (série du voyageur, départ), identifiant du fichier rendu
  const raw = files.raw('PRIVATE_EVIDENCE', `trips/${trip}/inspections/CHECKIN-GUEST/${r.fileId}`);
  if (raw === undefined) throw new Error('objet absent du stockage');
  return { stored: unseal(raw), sha256: r.sha256 };
}

describe('RT-L3-P06 (L3-PM-06) — géolocalisation EXIF d’une photo d’état', () => {
  const original = jpegWithGps();

  it('témoin : la copie nettoyée par preparePhoto ne porte aucune métadonnée EXIF', () => {
    const clean = preparePhoto(original, {
      maxBytes: 500_000,
      maxSide: 1600,
      maxPixels: 1600 * 1600,
    });
    expect(original.includes(GPS)).toBe(true);
    expect(clean.body.includes(GPS)).toBe(false);
    expect(clean.body.includes('Exif')).toBe(false);
  });

  it('observation : l’objet déposé en PRIVATE_EVIDENCE est l’original, EXIF et position compris ; l’empreinte rendue est celle de l’original', async () => {
    const out = await deposit(original);
    // CONSTAT F-L3-PRE-02 → suite : la copie nettoyée est écartée (inspection.service.ts, addPhoto)
    expect(out.stored.equals(original)).toBe(true);
    expect(out.stored.includes(GPS)).toBe(true);
    expect(out.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  });

  // CONSTAT F-L3-PRE-02 → suite : empreinte, coffre et stockage reçoivent `preparePhoto(...).body`
  // (copie nettoyée) ; l'original, s'il doit être gardé, l'est dans un champ à accès restreint
  it.fails(
    'CONSTAT F-L3-PRE-02 : l’objet déposé ne porte aucune géolocalisation EXIF',
    async () => {
      const out = await deposit(original);
      expect(out.stored.length).toBeGreaterThan(0);
      expect(out.stored.includes(GPS)).toBe(false);
      expect(out.stored.includes('Exif')).toBe(false);
    },
  );
});
