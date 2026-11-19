/**
 * US-303 — photos guidées de l'état du véhicule, horodatage serveur et empreintes (migration 0158,
 * ADR-179 ; fixtures 9948 et 9997, aucune nouvelle). Rôles de PRODUCTION seulement (assertion L0-05
 * par `withRole`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-303 (« 19 photos sur 20 ⇒ PHOTO_TEMPLATE_INCOMPLETE » ; « l'empreinte
 * recalculée du fichier stocké égale celle enregistrée » ; « photo importée de la galerie : refus »),
 * de 16 TRP-004 (gabarit d'au moins 15 extérieures, 8 intérieures, carburant et compteur, DE CHAQUE
 * CÔTÉ ; « la série de l'un ne remplace pas celle de l'autre » ; heure serveur ; SHA-256 à la
 * réception ; PHOTO_GALLERY_FORBIDDEN), de 17 §3.2.10 / §3.2.13 (slots EXT_01 à EXT_15, INT_01 à
 * INT_08, FUEL, ODOMETER ; KEY et DAMAGE_n hors du minimum ; file_asset PRIVATE_EVIDENCE chiffré par
 * la clé du sujet) et de 17 §7.2 (`photo_max_kb` = 500, `clock_skew_flag_h` = 2, graine US-013),
 * jamais du code testé.
 *
 * Partie A (transaction ANNULÉE, app_api) : parties, fenêtre, jetons de capture, bornes, gabarit,
 * idempotence, RLS. Partie B (données VALIDÉES) : photo reçue, objet scellé par la clé du sujet,
 * puis recalcul de l'empreinte par le travailleur `evidence_verifier` (US-009). Aucun interrupteur.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { fileAad, seal, SubjectKeyStore, verifyFileAsset } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const T0 = '2035-05-02T09:17:23.000Z';
const START = '2035-06-10T15:00:00.000Z';
const END = '2035-06-13T15:00:00.000Z';
const LINES: Readonly<Record<string, readonly { type: string; amountMinor: string }[]>> = {
  USD: [{ type: 'TRIP_PRICE', amountMinor: '12000' }],
  PYG: [{ type: 'TRIP_PRICE', amountMinor: '1000000' }],
};
/** 17 §3.2.10 : gabarit minimal, dans l'ordre du gabarit (16 TRP-004). */
const REQUIRED = [
  ...Array.from({ length: 15 }, (_, i) => `EXT_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `INT_${String(i + 1).padStart(2, '0')}`),
  'FUEL',
  'ODOMETER',
];
/** 17 §7.2 (graine US-013) : 500 ko. */
const MAX_BYTES = 500 * 1000;

const VIEW = 'SELECT core.trip_inspection_view($1, $2::uuid, $3) AS v';
const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const CHECK = 'SELECT * FROM core.trip_photo_capture_check($1, $2::uuid, $3, $4::uuid, $5)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const SUBMIT = 'SELECT * FROM core.trip_cmd_submit_inspection($1, $2::uuid, $3)';

const sha = (b: Buffer): Buffer => createHash('sha256').update(b).digest();
const plus = (iso: string, s: number): string => new Date(Date.parse(iso) + s * 1000).toISOString();

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly g: Buffer;
  readonly h: Buffer;
}

async function world(tx: Tx, c: CountryCase): Promise<World> {
  const guest = uuid();
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, guest, START, END, JSON.stringify(LINES[c.currency])],
  );
  const trip = rows[0]!.trip_id;
  const holder = rows[0]!.holder_id;
  await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [trip, 'CHECKIN_OPEN']);
  return {
    trip,
    guest,
    holder,
    g: (await openSession(tx, guest)).hash,
    h: (await openSession(tx, holder)).hash,
  };
}

/** Clé USER de la personne (coffre de l'application, sous app_api, contexte de la personne). */
async function subjectKey(tx: Tx, keys: SubjectKeyStore, userId: string): Promise<Buffer> {
  await setActor(tx, { kind: 'GUEST', actorId: userId });
  const k = await keys.dekFor(tx, { type: 'USER', id: userId }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  return k.dek;
}

const capture = async (tx: Tx, who: Buffer, trip: string, slot: string, kind = 'CHECKIN') =>
  (await tx.query<Row>(CAPTURE, [who, trip, kind, slot])).rows[0]!;

async function add(
  tx: Tx,
  who: Buffer,
  trip: string,
  captureId: unknown,
  slot: string,
  o: { mime?: string; bytes?: number; body?: Buffer; device?: string | null; kind?: string } = {},
): Promise<Row> {
  const body = o.body ?? randomBytes(64);
  return (
    await tx.query<Row>(ADD, [
      who,
      trip,
      o.kind ?? 'CHECKIN',
      captureId,
      slot,
      uuid(),
      o.mime ?? 'image/jpeg',
      o.bytes ?? body.length,
      sha(body),
      o.device === undefined ? T0 : o.device,
    ])
  ).rows[0]!;
}

/** Jeton puis photo d'un angle (issue de la commande d'ajout). */
async function shoot(tx: Tx, who: Buffer, trip: string, slot: string): Promise<Row> {
  const c = await capture(tx, who, trip, slot);
  expect(c['outcome'], slot).toBe('DONE');
  return add(tx, who, trip, c['capture_id'], slot);
}

describe.each(COUNTRIES)('US-303 — photos guidées ($country, $currency)', (c: CountryCase) => {
  it('partie A : parties et IDOR, gabarit, jetons de capture (galerie refusée), bornes, gabarit incomplet, idempotence, fenêtre', async () => {
    await withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const keys = new SubjectKeyStore(new FakeKeyWrapper());
        const w = await world(tx, c);
        const other = await world(tx, c); // autre trip, autre hôte, autre voyageur
        await subjectKey(tx, keys, w.guest);
        await subjectKey(tx, keys, w.holder);

        // lecture : chaque partie de SON trip ; un autre hôte, un autre voyageur : NOT_FOUND
        for (const who of [other.h, other.g]) {
          expect((await tx.query<{ v: Row }>(VIEW, [who, w.trip, 'CHECKIN'])).rows[0]!.v).toEqual({
            outcome: 'NOT_FOUND',
          });
        }
        expect((await tx.query<{ v: Row }>(VIEW, [w.g, w.trip, 'ARRIVAL'])).rows[0]!.v).toEqual({
          outcome: 'NOT_FOUND',
        });
        const v0 = (await tx.query<{ v: Row }>(VIEW, [w.g, w.trip, 'CHECKIN'])).rows[0]!.v;
        expect(v0).toMatchObject({ outcome: 'OK', viewerRole: 'GUEST', open: true, maxKb: 500 });
        const slots = v0['slots'] as { code: string; required: boolean }[];
        expect(slots.filter((s) => s.required).map((s) => s.code)).toEqual(REQUIRED);
        expect(slots.filter((s) => !s.required).map((s) => s.code)).toEqual([
          'KEY',
          ...Array.from({ length: 10 }, (_, i) => `DAMAGE_${String(i + 1).padStart(2, '0')}`),
        ]);
        expect(
          (await tx.query<{ v: Row }>(VIEW, [w.h, w.trip, 'CHECKIN'])).rows[0]!.v['viewerRole'],
        ).toBe('HOST');

        // jeton : angle hors gabarit refusé ; échéance = heure serveur + 120 s
        expect((await capture(tx, w.g, w.trip, 'ROOF'))['outcome']).toBe('REQUEST_INVALID');
        expect((await capture(tx, other.h, w.trip, 'EXT_01'))['outcome']).toBe('NOT_FOUND');
        const t1 = await capture(tx, w.g, w.trip, 'EXT_01');
        expect(t1['outcome']).toBe('DONE');
        expect((t1['expires_at'] as Date).toISOString()).toBe(plus(T0, 120));

        // critère 3 (galerie) : sans jeton, jeton d'un autre angle, d'une autre personne : refus
        expect((await add(tx, w.g, w.trip, uuid(), 'EXT_01'))['outcome']).toBe(
          'PHOTO_GALLERY_FORBIDDEN',
        );
        expect((await add(tx, w.g, w.trip, t1['capture_id'], 'EXT_02'))['outcome']).toBe(
          'PHOTO_GALLERY_FORBIDDEN',
        );
        expect((await add(tx, w.h, w.trip, t1['capture_id'], 'EXT_01'))['outcome']).toBe(
          'PHOTO_GALLERY_FORBIDDEN',
        );
        expect(
          (await tx.query<Row>(CHECK, [w.h, w.trip, 'CHECKIN', t1['capture_id'], 'EXT_01']))
            .rows[0]!['outcome'],
        ).toBe('PHOTO_GALLERY_FORBIDDEN');
        expect(
          (await tx.query<Row>(CHECK, [w.g, w.trip, 'CHECKIN', t1['capture_id'], 'EXT_01']))
            .rows[0],
        ).toMatchObject({ outcome: 'OK', max_kb: 500, max_px: 1600 });
        // bornes : type et taille (graine de 17 §7.2)
        expect(
          (await add(tx, w.g, w.trip, t1['capture_id'], 'EXT_01', { mime: 'image/png' }))[
            'outcome'
          ],
        ).toBe('PHOTO_INVALID');
        expect(
          (await add(tx, w.g, w.trip, t1['capture_id'], 'EXT_01', { bytes: MAX_BYTES + 1 }))[
            'outcome'
          ],
        ).toBe('PHOTO_INVALID');
        // témoin : la même photo, dans les bornes, passe ; heure SERVEUR, écart d'horloge signalé
        const ok = await add(tx, w.g, w.trip, t1['capture_id'], 'EXT_01', {
          bytes: MAX_BYTES,
          device: '2001-01-01T00:00:00.000Z',
        });
        expect(ok['outcome']).toBe('DONE');
        expect((ok['received_at'] as Date).toISOString()).toBe(T0);
        expect(String(ok['storage_key'])).toMatch(
          new RegExp(`^trips/${w.trip}/inspections/[0-9a-f-]{36}/[0-9a-f-]{36}$`),
        );
        // jeton consommé : le rejeu est refusé
        expect((await add(tx, w.g, w.trip, t1['capture_id'], 'EXT_01'))['outcome']).toBe(
          'PHOTO_GALLERY_FORBIDDEN',
        );
        // jeton expiré (121 s plus tard)
        const t2 = await capture(tx, w.g, w.trip, 'EXT_02');
        await setVirtualNow(tx, plus(T0, 121));
        expect((await add(tx, w.g, w.trip, t2['capture_id'], 'EXT_02'))['outcome']).toBe(
          'PHOTO_GALLERY_FORBIDDEN',
        );
        await setVirtualNow(tx, T0);
        const v1 = (await tx.query<{ v: Row }>(VIEW, [w.h, w.trip, 'CHECKIN'])).rows[0]!.v;
        const guestSide = (v1['sides'] as { role: string; photos: Row[] }[]).find(
          (s) => s.role === 'GUEST',
        )!;
        expect(guestSide.photos).toEqual([
          expect.objectContaining({ slot: 'EXT_01', bytes: MAX_BYTES, clockSkew: true }),
        ]);

        // critère 1 : l'hôte, 24 angles sur 25 (une intérieure manquante) ⇒ incomplet
        for (const slot of REQUIRED.filter((s) => s !== 'INT_08')) {
          expect((await shoot(tx, w.h, w.trip, slot))['outcome'], slot).toBe('DONE');
        }
        const incomplete = (await tx.query<Row>(SUBMIT, [w.h, w.trip, 'CHECKIN'])).rows[0]!;
        expect(incomplete).toMatchObject({ outcome: 'PHOTO_TEMPLATE_INCOMPLETE' });
        expect(incomplete['missing']).toEqual(['INT_08']);
        // une photo facultative ne compte pas au minimum
        expect((await shoot(tx, w.h, w.trip, 'KEY'))['outcome']).toBe('DONE');
        expect((await tx.query<Row>(SUBMIT, [w.h, w.trip, 'CHECKIN'])).rows[0]!['missing']).toEqual(
          ['INT_08'],
        );
        expect((await shoot(tx, w.h, w.trip, 'INT_08'))['outcome']).toBe('DONE');
        await setVirtualNow(tx, plus(T0, 60));
        const done = (await tx.query<Row>(SUBMIT, [w.h, w.trip, 'CHECKIN'])).rows[0]!;
        expect(done['outcome']).toBe('DONE');
        expect((done['submitted_at'] as Date).toISOString()).toBe(plus(T0, 60));
        await setVirtualNow(tx, plus(T0, 90));
        const again = (await tx.query<Row>(SUBMIT, [w.h, w.trip, 'CHECKIN'])).rows[0]!;
        expect(again['outcome']).toBe('ALREADY_SUBMITTED');
        expect((again['submitted_at'] as Date).toISOString()).toBe(plus(T0, 60));
        expect((await capture(tx, w.h, w.trip, 'DAMAGE_01'))['outcome']).toBe(
          'INSPECTION_SUBMITTED',
        );
        // la série complète de l'hôte ne remplace pas celle du voyageur
        const theirs = (await tx.query<Row>(SUBMIT, [w.g, w.trip, 'CHECKIN'])).rows[0]!;
        expect(theirs['outcome']).toBe('PHOTO_TEMPLATE_INCOMPLETE');
        expect(theirs['missing']).toEqual(REQUIRED.filter((s) => s !== 'EXT_01'));

        // fenêtre : trip en cours ⇒ départ fermé, retour ouvert
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [w.trip, 'IN_PROGRESS']);
        expect((await capture(tx, w.g, w.trip, 'EXT_03'))['outcome']).toBe('INSPECTION_NOT_OPEN');
        expect((await tx.query<Row>(SUBMIT, [w.g, w.trip, 'CHECKIN'])).rows[0]!['outcome']).toBe(
          'INSPECTION_NOT_OPEN',
        );
        expect((await capture(tx, w.g, w.trip, 'EXT_03', 'CHECKOUT'))['outcome']).toBe('DONE');
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [w.trip, 'BOOKED']);
        expect((await capture(tx, w.g, w.trip, 'EXT_03', 'CHECKOUT'))['outcome']).toBe(
          'INSPECTION_NOT_OPEN',
        );
      }),
    );
  });

  it('RLS : aucune lecture ni écriture directe des tables par les rôles applicatifs', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const table of [
          'core.trip_ops_photo_slot',
          'core.trip_ops_inspection',
          'core.trip_ops_photo_capture',
          'core.trip_ops_inspection_photo',
        ]) {
          await expect(
            client.query(`SELECT 1 FROM ${table} LIMIT 1`),
            `${role} ${table}`,
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            client.query(`DELETE FROM ${table}`),
            `${role} ${table}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    }
  });

  it('partie B (critère 2) : empreinte enregistrée = SHA-256 des octets reçus, recalculée égale sur l’objet scellé ; un octet changé ⇒ refus', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const store = new InMemoryFileStore();
    const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(2048)]);
    let fileId = '';
    let key = '';
    await withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: T0, commit: true }, async (tx) => {
        const w = await world(tx, c);
        const dek = await subjectKey(tx, keys, w.guest);
        const t = await capture(tx, w.g, w.trip, 'ODOMETER');
        fileId = uuid();
        const r = (
          await tx.query<Row>(ADD, [
            w.g,
            w.trip,
            'CHECKIN',
            t['capture_id'],
            'ODOMETER',
            fileId,
            'image/jpeg',
            body.length,
            sha(body),
            T0,
          ])
        ).rows[0]!;
        expect(r['outcome']).toBe('DONE');
        key = String(r['storage_key']);
        // dépôt de l'API : chiffré par la clé USER de la personne (enveloppe liée au fichier)
        const sealed = seal(dek, body, fileAad(fileId, { type: 'USER', id: w.guest }));
        expect((await store.put('PRIVATE_EVIDENCE', key, sealed)).status).toBe('STORED');
      }),
    );
    await withRole('app_worker', (client) =>
      withTestTransaction(client, {}, async (tx) => {
        await setActor(tx, { kind: 'WORKER', worker: 'evidence_verifier' });
        const row = (
          await tx.query<{
            sha256: Buffer;
            bucket: string;
            classification: string;
            source: string;
          }>(
            `SELECT sha256, bucket, classification, source FROM core.audit_file_asset WHERE id = $1`,
            [fileId],
          )
        ).rows[0]!;
        expect(row).toMatchObject({
          bucket: 'PRIVATE_EVIDENCE',
          classification: 'C2',
          source: 'IN_APP_CAMERA',
        });
        expect(row.sha256.equals(sha(body))).toBe(true);
        const verdict = await verifyFileAsset(tx, store, keys, fileId);
        expect(verdict.status).toBe('MATCH');
        // le stockage ne contient jamais le clair
        expect(store.raw('PRIVATE_EVIDENCE', key)?.includes(body.subarray(3, 64))).toBe(false);
        store.corrupt('PRIVATE_EVIDENCE', key, 40);
        expect((await verifyFileAsset(tx, store, keys, fileId)).status).not.toBe('MATCH');
      }),
    );
  });
});
