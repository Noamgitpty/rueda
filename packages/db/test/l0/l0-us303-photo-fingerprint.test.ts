/**
 * US-303 suite — empreinte de photo d'état unique, tous trips, photos d'annonce comprises
 * (migration 0176, ADR-196 ; fixture 9908 ; constat F-L3-PRE-01 de la red team du lot 3).
 * Rôles de PRODUCTION seulement (`withRole` : assertion L0-05 en tête), au Panama (USD) et au
 * Paraguay (PYG sans décimale) ; horloge virtuelle 2097 (aucune autre preuve ne l'utilise).
 *
 * Attendus (jamais le code testé) : pré-mortem du lot 3, L3-PM-03 (« refus d'une empreinte SHA-256
 * déjà enregistrée, tous trips, photos d'annonce comprises ») ; 16 TRP-004 (une photo par angle,
 * prise dans l'application, série de chaque partie) ; rapport de la red team
 * (docs/team/redteam/L3-preuves-versements.md : `PHOTO_DUPLICATE`, « comme Turo : refuser » une
 * reprise aux mêmes octets) ; 17 §2.5 (deux envois simultanés : un seul passe).
 *
 * Partie A (transaction ANNULÉE, app_api) : même série, même angle, autre partie, autre trip, autre
 * pays, photo d'annonce ; rien n'est écrit au refus et le jeton reste utilisable. Partie B (données
 * VALIDÉES, deux connexions app_api et une observatrice) : deux trips, aucun verrou commun ; le
 * second envoi attend l'index unique, puis PHOTO_DUPLICATE si le premier est validé, DONE s'il est
 * annulé. Aucun interrupteur lu ni écrit.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const T0 = '2097-03-04T08:15:42.000Z';
const START = '2097-04-10T15:00:00.000Z';
const END = '2097-04-13T15:00:00.000Z';

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const ROWS = 'SELECT * FROM test_fixture.us303_fingerprint_rows($1)';

const sha = (b: Buffer): Buffer => createHash('sha256').update(b).digest();
const rentOf = (c: CountryCase): string => (c.priceStepMinor === 1 ? '12000' : '1000000');
const keys = new SubjectKeyStore(new FakeKeyWrapper());

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly g: Buffer;
  readonly h: Buffer;
}

/** Trip dont la remise est ouverte (fixtures 9948 et 9997), clés USER des deux parties. */
async function world(tx: Tx, c: CountryCase): Promise<World> {
  const guest = uuid();
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [
      c.country,
      guest,
      START,
      END,
      JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: rentOf(c) }]),
    ],
  );
  const trip = rows[0]!.trip_id;
  const holder = rows[0]!.holder_id;
  await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [trip, 'CHECKIN_OPEN']);
  for (const [kind, id] of [
    ['GUEST', guest],
    ['HOST', holder],
  ] as const) {
    await setActor(tx, { kind, actorId: id });
    const k = await keys.dekFor(tx, { type: 'USER', id }, 'create');
    if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  }
  return {
    trip,
    guest,
    holder,
    g: (await openSession(tx, guest)).hash,
    h: (await openSession(tx, holder)).hash,
  };
}

async function capture(tx: Tx, who: Buffer, trip: string, slot: string): Promise<string> {
  const r = (await tx.query<Row>(CAPTURE, [who, trip, 'CHECKIN', slot])).rows[0]!;
  expect(r['outcome'], slot).toBe('DONE');
  return String(r['capture_id']);
}

const add = async (
  tx: Tx,
  who: Buffer,
  trip: string,
  captureId: string,
  slot: string,
  body: Buffer,
): Promise<string> =>
  String(
    (
      await tx.query<Row>(ADD, [
        who,
        trip,
        'CHECKIN',
        captureId,
        slot,
        uuid(),
        'image/jpeg',
        body.length,
        sha(body),
        T0,
      ])
    ).rows[0]!['outcome'],
  );

/** Jeton puis photo d'un angle ; rend l'issue et le jeton (pour une nouvelle prise). */
async function shoot(
  tx: Tx,
  who: Buffer,
  trip: string,
  slot: string,
  body: Buffer,
): Promise<{ outcome: string; captureId: string }> {
  const captureId = await capture(tx, who, trip, slot);
  return { outcome: await add(tx, who, trip, captureId, slot, body), captureId };
}

async function rowsOf(tx: Tx, body: Buffer): Promise<{ photos: number; files: number }> {
  const r = (await tx.query<{ photos: number; files: number }>(ROWS, [sha(body)])).rows[0]!;
  return { photos: r.photos, files: r.files };
}

const other = (c: CountryCase): CountryCase => COUNTRIES.find((x) => x.country !== c.country)!;

describe.each(COUNTRIES)('US-303 suite — empreinte unique ($country, $currency)', (c) => {
  it('partie A : même fichier refusé PHOTO_DUPLICATE (autre angle, même angle, autre partie, autre trip, autre pays, photo d’annonce) ; rien n’est écrit ; le jeton reste utilisable ; témoin accepté', async () => {
    await withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const w = await world(tx, c);
        const x = await world(tx, c);
        const abroad = await world(tx, other(c));

        const body = randomBytes(2048);
        expect((await shoot(tx, w.g, w.trip, 'EXT_01', body)).outcome).toBe('DONE');
        expect(await rowsOf(tx, body)).toEqual({ photos: 1, files: 1 });

        // même série, autre angle : refus ; rien n'est écrit ; le même jeton sert ensuite
        const again = await shoot(tx, w.g, w.trip, 'EXT_02', body);
        expect(again.outcome).toBe('PHOTO_DUPLICATE');
        expect(await rowsOf(tx, body)).toEqual({ photos: 1, files: 1 });
        expect(await add(tx, w.g, w.trip, again.captureId, 'EXT_02', randomBytes(2048))).toBe(
          'DONE',
        );

        // reprise du même angle aux mêmes octets (comme Turo : une reprise est une nouvelle prise)
        expect((await shoot(tx, w.g, w.trip, 'EXT_01', body)).outcome).toBe('PHOTO_DUPLICATE');
        // l'autre partie du même trip, un autre trip, un trip d'un autre pays
        expect((await shoot(tx, w.h, w.trip, 'EXT_01', body)).outcome).toBe('PHOTO_DUPLICATE');
        expect((await shoot(tx, x.g, x.trip, 'EXT_01', body)).outcome).toBe('PHOTO_DUPLICATE');
        expect((await shoot(tx, abroad.h, abroad.trip, 'EXT_01', body)).outcome).toBe(
          'PHOTO_DUPLICATE',
        );
        expect(await rowsOf(tx, body)).toEqual({ photos: 1, files: 1 });

        // photo d'annonce déjà enregistrée (bucket PUBLIC_LISTING), même retirée : refus
        const listed = randomBytes(2048);
        await tx.query('SELECT test_fixture.us303_listing_file($1, $2)', [w.holder, sha(listed)]);
        expect((await shoot(tx, w.h, w.trip, 'EXT_03', listed)).outcome).toBe('PHOTO_DUPLICATE');
        expect(await rowsOf(tx, listed)).toEqual({ photos: 0, files: 1 });

        // témoins : d'autres octets passent, chez chacun
        for (const [who, trip] of [
          [w.h, w.trip],
          [x.g, x.trip],
          [abroad.h, abroad.trip],
        ] as const) {
          expect((await shoot(tx, who, trip, 'EXT_04', randomBytes(2048))).outcome).toBe('DONE');
        }

        // garantie en base : index UNIQUE sur l'empreinte des photos d'état
        const idx = await tx.query<{ unique: boolean; def: string }>(
          `SELECT i.indisunique AS unique, pg_catalog.pg_get_indexdef(i.indexrelid) AS def
             FROM pg_catalog.pg_index AS i
             JOIN pg_catalog.pg_class AS x ON x.oid = i.indexrelid
            WHERE x.relname = 'trip_inspection_photo_sha256_unique'`,
        );
        expect(idx.rows).toHaveLength(1);
        expect(idx.rows[0]!.unique).toBe(true);
        expect(idx.rows[0]!.def).toMatch(/trip_ops_inspection_photo USING btree \(sha256\)$/);
      }),
    );
  });

  it('partie B : deux envois simultanés du même fichier sur deux trips (deux connexions) ⇒ le second attend l’index unique ; premier validé ⇒ PHOTO_DUPLICATE, rien d’écrit, jeton intact ; premier annulé ⇒ DONE', async () => {
    const s = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: T0, commit: true }, async (tx) => ({
        a: await world(tx, c),
        b: await world(tx, c),
        d: await world(tx, c),
        e: await world(tx, c),
      })),
    );
    const begin = async (client: Tx): Promise<void> => {
      await client.query('BEGIN');
      await setVirtualNow(client, T0);
      await client.query(`SET LOCAL lock_timeout = '15s'`);
      await client.query(`SET LOCAL statement_timeout = '30s'`);
    };
    await withRole('app_api', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          // (1) premier validé : le second voit la violation d'unicité, rattrapée
          const body = randomBytes(4096);
          try {
            await begin(one);
            expect((await shoot(one, s.a.g, s.a.trip, 'EXT_01', body)).outcome).toBe('DONE');
            const pid = await backendPid(two);
            await begin(two);
            const cap = await capture(two, s.b.g, s.b.trip, 'EXT_01');
            const pending = add(two, s.b.g, s.b.trip, cap, 'EXT_01', body);
            await waitUntilBlocked(observer, pid, 'transactionid');
            await one.query('COMMIT');
            expect(await pending).toBe('PHOTO_DUPLICATE');
            // ses écritures ont été annulées au point de sauvegarde : le jeton sert encore
            expect(await rowsOf(two, body)).toEqual({ photos: 1, files: 1 });
            expect(await add(two, s.b.g, s.b.trip, cap, 'EXT_01', randomBytes(4096))).toBe('DONE');
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }

          // (2) premier annulé : le second passe, une seule photo porte l'empreinte
          const next = randomBytes(4096);
          try {
            await begin(one);
            expect((await shoot(one, s.d.g, s.d.trip, 'EXT_01', next)).outcome).toBe('DONE');
            const pid = await backendPid(two);
            await begin(two);
            const cap = await capture(two, s.e.g, s.e.trip, 'EXT_01');
            const pending = add(two, s.e.g, s.e.trip, cap, 'EXT_01', next);
            await waitUntilBlocked(observer, pid, 'transactionid');
            await one.query('ROLLBACK');
            expect(await pending).toBe('DONE');
            expect(await rowsOf(two, next)).toEqual({ photos: 1, files: 1 });
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
        }),
      ),
    );
  });
});
