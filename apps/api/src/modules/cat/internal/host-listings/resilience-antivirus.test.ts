/**
 * US-045 — résilience de la réception des photos d'annonce (`HostListingsService.addPhoto`) face à
 * l'antivirus `FAKE` HOSTILE (`FakeUploadScanner` de `@rueda/fake-adapters/files`, scénario
 * `scan`), au niveau du consommateur.
 *
 * Ce qui est prouvé (17 §5 « Antivirus et contrôle des téléversements » : quarantaine avant usage,
 * vérification MIME réelle ; ADR-032 et 17 §6.5 point 5 : FAKE hostile ; Q-019 / DEC-FONDATEUR-20 :
 * antivirus fail-closed ; US-045) :
 * - toute issue non saine de l'analyse — panne (`UNAVAILABLE`), délai dépassé avant ou après
 *   l'analyse (`TIMEOUT_*`), refus scripté (`REFUSE` ⇒ `INFECTED`), marqueur
 *   `FAKE-MALWARE-SIGNATURE` dans les octets — est refusée (`PHOTO_UPLOAD_UNAVAILABLE` quand
 *   l'analyse n'a pas abouti, `PHOTO_FORMAT` quand elle condamne le fichier) ;
 * - rien n'est alors déposé ni compté : ni objet dans le stockage, ni ligne de photo, et aucun
 *   identifiant n'est même tiré (la ligne et le dépôt viennent APRÈS le verdict sain) ;
 * - après la reprise de l'antivirus, un nouvel envoi dépose la photo exactement une fois ;
 * - un antivirus lent (`DELAY`, horloge virtuelle) ou qui répond en double (`DUPLICATE`) ne
 *   produit qu'une photo ;
 * - panne prolongée (`setDefault`) : tous les envois refusés, puis un seul dépôt à la reprise.
 *
 * Données fictives ; pays et devise neutres (`XX` / `XXX`, comme photo-ingest.test.ts) : la
 * réception d'une photo ne dépend d'aucun pays. Aucune attente réelle.
 */
import { describe, expect, it } from 'vitest';
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import { FakeHostListingStore } from '../../testing/fake-host-listing-store.js';
import { HostListingsService } from './host-listings.service.js';

const env = { RUEDA_ENV: 'test' };
const proof = Buffer.alloc(32, 7);
const MARKER = 'FAKE-MALWARE-SIGNATURE';

/** JPEG minimal valide (SOI, APP0, SOF0, SOS, données, EOI) ; `scanData` : données du scan. */
function jpeg(scanData: Buffer = Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78])): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([h, payload]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(240, 1);
  sof.writeUInt16BE(320, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00])),
    scanData,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Photo dont les DONNÉES D'IMAGE (conservées par le nettoyage) portent le marqueur du FAKE. */
const infectedJpeg = () => jpeg(Buffer.from(`\x12\x34${MARKER}\x56`, 'latin1'));

function world() {
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
  const files = new InMemoryFileStore({ env });
  const scanner = new FakeUploadScanner({ env });
  let ids = 0;
  const svc = new HostListingsService(store, null, { scanner, storage: files }, () => {
    ids += 1;
    return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
  });
  /** Rien de déposé ni de compté, aucun identifiant tiré (aucune ligne préparée). */
  const nothingStored = () => {
    expect(store.deposited).toEqual([]);
    expect(store.listingsById.get('lst')?.photos).toBe(0);
    expect(ids).toBe(0);
  };
  /** Exactement une photo, déposée sous sa clé et lisible. */
  const exactlyOne = (photoId: string) => {
    expect(store.deposited).toEqual([`listing/lst/${photoId}`]);
    expect(store.listingsById.get('lst')?.photos).toBe(1);
    expect(files.raw('PUBLIC_LISTING', `listing/lst/${photoId}`)).toBeDefined();
  };
  return { store, files, scanner, svc, nothingStored, exactlyOne };
}

const NOT_SCANNED = [
  { kind: 'UNAVAILABLE' },
  { kind: 'TIMEOUT_BEFORE' },
  { kind: 'TIMEOUT_AFTER' },
] as const;

describe('antivirus hostile : photo d’annonce fail-closed, puis un seul dépôt à la reprise (US-045)', () => {
  it.each(NOT_SCANNED)(
    'analyse non aboutie ($kind) : PHOTO_UPLOAD_UNAVAILABLE, rien de déposé ; reprise ⇒ une photo',
    async (step) => {
      const w = world();
      w.scanner.script.script('scan', step);
      await expect(w.svc.addPhoto(proof, 'org', 'lst', jpeg())).rejects.toMatchObject({
        code: 'PHOTO_UPLOAD_UNAVAILABLE',
      });
      w.nothingStored();
      const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
      expect(r.code).toBe('PHOTO_ADDED');
      w.exactlyOne(r.photoId);
      expect(w.scanner.script.calls('scan')).toBe(2);
    },
  );

  it('verdict INFECTED scripté (REFUSE) : PHOTO_FORMAT, rien de déposé ; reprise ⇒ une photo', async () => {
    const w = world();
    w.scanner.script.script('scan', { kind: 'REFUSE', reason: 'Fake.Test.Signature' });
    await expect(w.svc.addPhoto(proof, 'org', 'lst', jpeg())).rejects.toMatchObject({
      code: 'PHOTO_FORMAT',
    });
    w.nothingStored();
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    w.exactlyOne(r.photoId);
  });

  it('marqueur FAKE-MALWARE-SIGNATURE dans l’image : PHOTO_FORMAT à chaque envoi, jamais déposée ; une photo saine passe ensuite une fois', async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) {
      await expect(w.svc.addPhoto(proof, 'org', 'lst', infectedJpeg())).rejects.toMatchObject({
        code: 'PHOTO_FORMAT',
      });
    }
    w.nothingStored();
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    w.exactlyOne(r.photoId);
    const stored = w.files.raw('PUBLIC_LISTING', `listing/lst/${r.photoId}`);
    expect(stored?.includes(Buffer.from(MARKER, 'latin1'))).toBe(false);
  });

  it('pannes enchaînées (panne, délais, refus) puis reprise : un seul dépôt sur six envois', async () => {
    const w = world();
    w.scanner.script.script(
      'scan',
      { kind: 'UNAVAILABLE' },
      { kind: 'TIMEOUT_BEFORE' },
      { kind: 'TIMEOUT_AFTER' },
      { kind: 'REFUSE', reason: 'Fake.Test.Signature' },
      { kind: 'UNAVAILABLE' },
    );
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await w.svc.addPhoto(proof, 'org', 'lst', jpeg()).then(
        () => codes.push('PHOTO_ADDED'),
        (e: { code: string }) => codes.push(e.code),
      );
    }
    expect(codes).toEqual([
      'PHOTO_UPLOAD_UNAVAILABLE',
      'PHOTO_UPLOAD_UNAVAILABLE',
      'PHOTO_UPLOAD_UNAVAILABLE',
      'PHOTO_FORMAT',
      'PHOTO_UPLOAD_UNAVAILABLE',
    ]);
    w.nothingStored();
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    w.exactlyOne(r.photoId);
    expect(w.scanner.script.pending('scan')).toBe(0);
  });

  it('panne prolongée (setDefault UNAVAILABLE) : vingt envois refusés, rien de déposé ; reprise ⇒ une photo', async () => {
    const w = world();
    w.scanner.script.setDefault('scan', { kind: 'UNAVAILABLE' });
    for (let i = 0; i < 20; i += 1) {
      await expect(w.svc.addPhoto(proof, 'org', 'lst', jpeg())).rejects.toMatchObject({
        code: 'PHOTO_UPLOAD_UNAVAILABLE',
      });
    }
    w.nothingStored();
    expect(w.scanner.script.calls('scan')).toBe(20);
    w.scanner.script.setDefault('scan', { kind: 'OK' });
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    w.exactlyOne(r.photoId);
  });

  it('antivirus lent (DELAY, horloge virtuelle) : photo saine déposée une fois', async () => {
    const w = world();
    const before = w.scanner.clock.nowMs();
    w.scanner.script.script('scan', { kind: 'DELAY', ms: 45_000 });
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    expect(w.scanner.clock.nowMs() - before).toBe(45_000);
    w.exactlyOne(r.photoId);
  });

  it('antivirus lent sur une photo infectée : le délai ne change pas le verdict, rien de déposé', async () => {
    const w = world();
    w.scanner.script.script('scan', { kind: 'DELAY', ms: 45_000 });
    await expect(w.svc.addPhoto(proof, 'org', 'lst', infectedJpeg())).rejects.toMatchObject({
      code: 'PHOTO_FORMAT',
    });
    w.nothingStored();
  });

  it('réponse en double de l’antivirus (DUPLICATE) : une seule photo', async () => {
    const w = world();
    w.scanner.script.script('scan', { kind: 'DUPLICATE' });
    const r = await w.svc.addPhoto(proof, 'org', 'lst', jpeg());
    w.exactlyOne(r.photoId);
  });
});
