/**
 * US-303 — contrat des routes des photos d'état du véhicule (`/trips/{tripId}/inspections/{kind}`,
 * `/captures`, `/photos`, `/submit`) sur l'application RÉELLE (ApiModule, gardes globaux,
 * durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin et des ports (antivirus, coffre,
 * stockage) : chaque réponse est confrontée à `apps/api/openapi/openapi.json`, chaque statut
 * déclaré est exercé.
 *
 * Attendus tirés de 19 US-303 et de 16 TRP-004, jamais du code testé :
 * - gabarit incomplet (24 angles obligatoires sur 25 : une intérieure manquante) ⇒ 422
 *   PHOTO_TEMPLATE_INCOMPLETE avec l'angle manquant ; la série de l'un ne remplace pas celle de
 *   l'autre ; gabarit complet ⇒ 200, heure serveur ;
 * - photo de la galerie (source autre que la caméra, ou sans jeton de capture valide) ⇒ 422
 *   PHOTO_GALLERY_FORBIDDEN, rien n'est reçu ;
 * - empreinte rendue = SHA-256 des octets envoyés ; octets déposés chiffrés (jamais le clair) ;
 * - bornes : type réel JPEG ou WebP, taille et dimensions du pays ; sinon PHOTO_INVALID ;
 * - IDOR : toute autre personne, trip inconnu, type mal formé ⇒ la même 404 ;
 * - production (ports indisponibles) ⇒ 503 PHOTO_UPLOAD_UNAVAILABLE.
 * Les règles de la base sont prouvées sur PostgreSQL (l0-us303-inspection-photos). Données fictives.
 */
import { createHash, randomUUID } from 'node:crypto';
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import type { EvidencePipeline, EvidenceVault } from '../internal/inspection/ports.js';
import { FakeInspectionStore, TEMPLATE_V1 } from './fake-inspection-store.js';

afterAll(closeContractApps);

/** JPEG minimal valide (SOI, APP0, SOF0 aux dimensions données, SOS, données, EOI). */
function jpeg(width: number, height: number, filler = 64): Buffer {
  const seg = (marker: number, data: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([h, data]);
  };
  const sof = Buffer.alloc(9);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 1;
  sof.set([1, 0x11, 0], 6);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.alloc(filler, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);
}
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7a6a0f20000000049454e44ae426082',
  'hex',
);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Coffre FAKE : « scelle » par un préfixe et une inversion des octets (jamais le clair). */
const vault: EvidenceVault = {
  prepare: () => Promise.resolve('READY'),
  seal: (_tx, _user, _file, body) =>
    Promise.resolve({
      status: 'SEALED',
      body: Buffer.concat([Buffer.from('sealed:'), Buffer.from(body.map((b) => b ^ 0xff))]),
    }),
};

interface World {
  readonly app: ContractApp;
  readonly store: FakeInspectionStore;
  readonly files: InMemoryFileStore;
  readonly trip: string;
  readonly closed: string;
}

async function world(options: { evidence?: EvidencePipeline | null } = {}): Promise<World> {
  const store = new FakeInspectionStore();
  const files = new InMemoryFileStore();
  const evidence =
    options.evidence === null
      ? undefined
      : (options.evidence ?? { scanner: new FakeUploadScanner(), vault, files });
  const app = await startContractApp({
    trp: { store, ...(evidence !== undefined ? { evidence } : {}) },
  });
  const trip = randomUUID();
  const closed = randomUUID();
  // voyageur = voyageur du trip ; staff_sans_mfa = titulaire du compte d'hôte ; staff = étranger
  const base = { hostProof: app.hash('staff_sans_mfa'), guestProof: app.hash('voyageur') };
  store.trips.set(trip, {
    ...base,
    open: { CHECKIN: true, CHECKOUT: false },
    maxKb: 500,
    maxPx: 1600,
  });
  store.trips.set(closed, {
    ...base,
    open: { CHECKIN: false, CHECKOUT: false },
    maxKb: 500,
    maxPx: 1600,
  });
  return { app, store, files, trip, closed };
}

const guest = (w: World) => w.app.cookie('voyageur');
const host = (w: World) => w.app.cookie('staff_sans_mfa');
const stranger = (w: World) => w.app.cookie('staff');

async function capture(w: World, who: Record<string, string>, trip: string, slot: string) {
  return w.app.api.request('POST', `/trips/${trip}/inspections/checkin/captures`, {
    headers: who,
    body: { slot },
  });
}

async function send(
  w: World,
  who: Record<string, string>,
  trip: string,
  slot: string,
  body: Buffer,
  extra: Record<string, unknown> = {},
) {
  const c = await capture(w, who, trip, slot);
  expect(c.status).toBe(201);
  return w.app.api.request('POST', `/trips/${trip}/inspections/checkin/photos`, {
    headers: who,
    body: {
      captureId: (c.json as { captureId: string }).captureId,
      slot,
      source: 'CAMERA',
      deviceCapturedAt: '2034-03-08T10:00:00.000Z',
      sha256: sha(body),
      dataBase64: body.toString('base64'),
      ...extra,
    },
  });
}

const REQUIRED = TEMPLATE_V1.filter((s) => s.required).map((s) => s.code);

describe('US-303 — routes des photos d’état du véhicule (contrat OpenAPI)', () => {
  const apps: ContractApp[] = [];

  it('lecture : gabarit (25 angles obligatoires), bornes, les deux séries ; IDOR 404 ; 401', async () => {
    const w = await world();
    apps.push(w.app);
    const r = await w.app.api.request('GET', `/trips/${w.trip}/inspections/checkin`, {
      headers: guest(w),
    });
    expect(r.status).toBe(200);
    const v = r.json as Record<string, unknown>;
    expect(v['viewerRole']).toBe('GUEST');
    expect(v['uploads']).toMatchObject({ open: true, maxLongSidePx: 1600 });
    expect((v['slots'] as { required: boolean }[]).filter((s) => s.required)).toHaveLength(25);
    expect((v['sides'] as { role: string }[]).map((s) => s.role)).toEqual(['HOST', 'GUEST']);
    for (const path of [
      `/trips/${w.trip}/inspections/checkin`,
      `/trips/${w.trip}/inspections/arrival`,
      `/trips/not-a-uuid/inspections/checkin`,
      `/trips/${randomUUID()}/inspections/checkin`,
    ]) {
      const x = await w.app.api.request('GET', path, { headers: stranger(w) });
      expect(x.status, path).toBe(404);
      expect((x.json as { code: string }).code).toBe('INSPECTION_NOT_FOUND');
    }
    const anon = await w.app.api.request('GET', `/trips/${w.trip}/inspections/checkin`);
    expect(anon.status).toBe(401);
  });

  it('critère 1 : 24 angles sur 25 ⇒ PHOTO_TEMPLATE_INCOMPLETE (une intérieure manquante) ; la série de l’hôte ne remplace pas celle du voyageur ; complète ⇒ validée, heure serveur', async () => {
    const w = await world();
    apps.push(w.app);
    const photo = jpeg(1600, 1200);
    for (const slot of REQUIRED.filter((s) => s !== 'INT_08')) {
      expect((await send(w, host(w), w.trip, slot, photo)).status, slot).toBe(201);
    }
    const incomplete = await w.app.api.request(
      'POST',
      `/trips/${w.trip}/inspections/checkin/submit`,
      {
        headers: host(w),
        body: {},
      },
    );
    expect(incomplete.status).toBe(422);
    expect(incomplete.json).toMatchObject({
      code: 'PHOTO_TEMPLATE_INCOMPLETE',
      messageKey: 'common.inspection.templateIncomplete',
      missing: ['INT_08'],
    });
    expect((await send(w, host(w), w.trip, 'INT_08', photo)).status).toBe(201);
    const done = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/submit`, {
      headers: host(w),
      body: {},
    });
    expect(done.status).toBe(200);
    expect((done.json as { status: string }).status).toBe('SUBMITTED');
    const again = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/submit`, {
      headers: host(w),
      body: {},
    });
    expect(again.json).toEqual(done.json);
    // série validée : plus aucune photo ni jeton
    const late = await capture(w, host(w), w.trip, 'KEY');
    expect(late.status).toBe(409);
    expect((late.json as { code: string }).code).toBe('INSPECTION_SUBMITTED');
    // la série du voyageur reste vide : sa validation est refusée (tous les angles manquent)
    const theirs = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/submit`, {
      headers: guest(w),
      body: {},
    });
    expect(theirs.status).toBe(422);
    expect((theirs.json as { missing: string[] }).missing).toEqual(REQUIRED);
  });

  it('critère 2 : empreinte rendue = SHA-256 des octets envoyés ; dernière photo de l’angle ; objet déposé chiffré', async () => {
    const w = await world();
    apps.push(w.app);
    const first = jpeg(800, 600, 10);
    const retake = jpeg(800, 600, 20);
    expect((await send(w, guest(w), w.trip, 'FUEL', first)).status).toBe(201);
    const r = await send(w, guest(w), w.trip, 'FUEL', retake);
    expect(r.status).toBe(201);
    const body = r.json as { fileId: string; sha256: string; bytes: number };
    expect(body.sha256).toBe(sha(retake));
    expect(body.bytes).toBe(retake.length);
    const v = await w.app.api.request('GET', `/trips/${w.trip}/inspections/checkin`, {
      headers: host(w),
    });
    const sides = (v.json as { sides: { role: string; photos: { sha256: string }[] }[] }).sides;
    expect(sides.find((s) => s.role === 'GUEST')?.photos).toEqual([
      expect.objectContaining({ slot: 'FUEL', sha256: sha(retake), fileId: body.fileId }),
    ]);
    const key = `trips/${w.trip}/inspections/CHECKIN-GUEST/${body.fileId}`;
    const raw = w.files.raw('PRIVATE_EVIDENCE', key);
    expect(raw).toBeDefined();
    expect(raw?.includes(retake)).toBe(false);
  });

  it('critère 3 : photo de la galerie refusée (source, jeton absent, consommé, d’un autre angle ou d’une autre personne)', async () => {
    const w = await world();
    apps.push(w.app);
    const photo = jpeg(640, 480);
    const gallery = await send(w, guest(w), w.trip, 'EXT_01', photo, { source: 'GALLERY' });
    expect(gallery.status).toBe(422);
    expect((gallery.json as { code: string }).code).toBe('PHOTO_GALLERY_FORBIDDEN');
    const forged = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/photos`, {
      headers: guest(w),
      body: {
        captureId: randomUUID(),
        slot: 'EXT_01',
        source: 'CAMERA',
        sha256: sha(photo),
        dataBase64: photo.toString('base64'),
      },
    });
    expect((forged.json as { code: string }).code).toBe('PHOTO_GALLERY_FORBIDDEN');
    // jeton d'un autre angle, puis jeton de l'hôte présenté par le voyageur
    const c = (await capture(w, guest(w), w.trip, 'EXT_02')).json as { captureId: string };
    const h = (await capture(w, host(w), w.trip, 'EXT_01')).json as { captureId: string };
    for (const captureId of [c.captureId, h.captureId]) {
      const x = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/photos`, {
        headers: guest(w),
        body: {
          captureId,
          slot: 'EXT_01',
          source: 'CAMERA',
          sha256: sha(photo),
          dataBase64: photo.toString('base64'),
        },
      });
      expect((x.json as { code: string }).code).toBe('PHOTO_GALLERY_FORBIDDEN');
    }
    const v = await w.app.api.request('GET', `/trips/${w.trip}/inspections/checkin`, {
      headers: guest(w),
    });
    const mine = (v.json as { sides: { role: string; photos: unknown[] }[] }).sides;
    expect(mine.find((x) => x.role === 'GUEST')?.photos).toEqual([]);
  });

  it('bornes : PNG, empreinte de transport fausse, dimensions hors du pays ⇒ PHOTO_INVALID ; corps, angle, source : 400 / 415', async () => {
    const w = await world();
    apps.push(w.app);
    for (const [label, body, extra] of [
      ['PNG', PNG, {}],
      ['empreinte', jpeg(640, 480), { sha256: 'b'.repeat(64) }],
      ['côté > photo_max_px', jpeg(1601, 1000), {}],
    ] as const) {
      const r = await send(w, guest(w), w.trip, 'EXT_03', body, extra);
      expect(r.status, label).toBe(422);
      expect((r.json as { code: string }).code, label).toBe('PHOTO_INVALID');
    }
    const badSlot = await capture(w, guest(w), w.trip, 'ROOF');
    expect(badSlot.status).toBe(400);
    const badBody = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/photos`, {
      headers: guest(w),
      body: { captureId: 'x', slot: 'EXT_01', source: 'CAMERA' },
    });
    expect(badBody.status).toBe(400);
    const badSubmit = await w.app.api.request(
      'POST',
      `/trips/${w.trip}/inspections/checkin/submit`,
      {
        headers: guest(w),
        body: { force: true },
      },
    );
    expect(badSubmit.status).toBe(400);
    for (const path of ['captures', 'photos', 'submit']) {
      const t = await w.app.api.request(
        'POST',
        `/trips/${w.trip}/inspections/checkin/${path}`,
        textBody(guest(w)),
      );
      expect(t.status, path).toBe(415);
    }
    for (const path of ['captures', 'photos', 'submit']) {
      const x = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/${path}`, {
        body: {},
      });
      expect(x.status, path).toBe(401);
      const y = await w.app.api.request(
        'POST',
        `/trips/${randomUUID()}/inspections/checkin/${path}`,
        {
          headers: guest(w),
          body:
            path === 'captures'
              ? { slot: 'EXT_01' }
              : path === 'submit'
                ? {}
                : {
                    captureId: randomUUID(),
                    slot: 'EXT_01',
                    source: 'CAMERA',
                    sha256: 'a'.repeat(64),
                    dataBase64: 'AAAA',
                  },
        },
      );
      expect(y.status, path).toBe(404);
    }
  });

  it('fenêtre : série hors de sa fenêtre ⇒ 409 INSPECTION_NOT_OPEN ; plafond de photos ⇒ 409', async () => {
    const w = await world();
    apps.push(w.app);
    const c = await capture(w, guest(w), w.closed, 'EXT_01');
    expect(c.status).toBe(409);
    expect((c.json as { code: string }).code).toBe('INSPECTION_NOT_OPEN');
    const s = await w.app.api.request('POST', `/trips/${w.closed}/inspections/checkin/submit`, {
      headers: guest(w),
      body: {},
    });
    expect((s.json as { code: string }).code).toBe('INSPECTION_NOT_OPEN');
    // jeton émis, puis fenêtre fermée avant l'envoi
    const t = (await capture(w, guest(w), w.trip, 'EXT_01')).json as { captureId: string };
    w.store.trips.get(w.trip)!.open.CHECKIN = false;
    const p = await w.app.api.request('POST', `/trips/${w.trip}/inspections/checkin/photos`, {
      headers: guest(w),
      body: {
        captureId: t.captureId,
        slot: 'EXT_01',
        source: 'CAMERA',
        sha256: sha(jpeg(10, 10)),
        dataBase64: jpeg(10, 10).toString('base64'),
      },
    });
    expect(p.status).toBe(409);
    w.store.trips.get(w.trip)!.open.CHECKIN = true;
    const series = { status: 'DRAFT' as const, submittedAt: null, photos: [] as never[] };
    w.store.series.set(`${w.trip}:CHECKIN:GUEST`, {
      ...series,
      photos: Array.from({ length: 100 }, () => ({
        slot: 'EXT_01',
        fileId: randomUUID(),
        sha256: 'a'.repeat(64),
        bytes: 1,
        receivedAt: new Date(),
      })) as never[],
    });
    const full = await capture(w, guest(w), w.trip, 'EXT_02');
    expect((full.json as { code: string }).code).toBe('PHOTO_LIMIT_REACHED');
  });

  it('production : antivirus, coffre, stockage indisponibles ⇒ 503 PHOTO_UPLOAD_UNAVAILABLE ; magasin absent ⇒ 503', async () => {
    const w = await world({ evidence: null });
    apps.push(w.app);
    const v = await w.app.api.request('GET', `/trips/${w.trip}/inspections/checkin`, {
      headers: guest(w),
    });
    expect((v.json as { uploads: { open: boolean } }).uploads.open).toBe(false);
    const r = await send(w, guest(w), w.trip, 'EXT_01', jpeg(640, 480));
    expect(r.status).toBe(503);
    expect((r.json as { code: string }).code).toBe('PHOTO_UPLOAD_UNAVAILABLE');
    const none = await startContractApp();
    apps.push(none);
    for (const [method, path, json] of [
      ['GET', `/trips/${w.trip}/inspections/checkin`, undefined],
      ['POST', `/trips/${w.trip}/inspections/checkin/captures`, { slot: 'EXT_01' }],
      ['POST', `/trips/${w.trip}/inspections/checkin/submit`, {}],
      [
        'POST',
        `/trips/${w.trip}/inspections/checkin/photos`,
        {
          captureId: randomUUID(),
          slot: 'EXT_01',
          source: 'CAMERA',
          sha256: 'a'.repeat(64),
          dataBase64: 'AAAA',
        },
      ],
    ] as const) {
      const x = await none.api.request(method, path, {
        headers: none.cookie('voyageur'),
        ...(json !== undefined ? { body: json } : {}),
      });
      expect(x.status, path).toBe(503);
      expect((x.json as { code: string }).code).toBe('INSPECTION_UNAVAILABLE');
    }
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/inspections est exercé', () => {
    expect(missingCoverage(contract, '/trips/{tripId}/inspections', coverageOf(...apps))).toEqual(
      [],
    );
  });
});
