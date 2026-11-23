/**
 * Preuves de la fiche du véhicule (US-204, migration 0106, ADR-132 ; fixture 9979) sous les rôles
 * de production (assertion L0-05 en tête de chaque connexion : `withRole`, `connectAs`), en USD
 * (PA) et en PYG (PY). Personnes, sessions, comptes d'hôte, lieux, véhicules, annonces et photos
 * sont créés par les VRAIES commandes (US-107, US-115, US-119) ; les interrupteurs
 * `p2p_private_hosts_enabled` et `insurer_contract_active` ne sont ouverts que par la procédure à
 * deux personnes d'US-125, dans une transaction ANNULÉE ; les trips du critère 3 passent par le
 * parcours hold → preuve → conversion d'US-024 (`bookTrip`).
 *
 * Attendus tirés de 19 US-204 (« Given 8 photos approuvées, When la galerie s'ouvre, Then l'ordre
 * est celui de l'hôte » ; « Given un préavis de l'hôte non respecté, When le voyageur choisit
 * l'heure, Then DATES_NOTICE_TOO_SHORT » ; « Given un visiteur non réservé, When il ouvre la
 * fiche, Then l'adresse exacte du lieu de remise n'est pas dans la réponse API ; après BOOKED,
 * adresse et consignes de rendez-vous sont affichées au voyageur seulement »), de 16 LST-002,
 * LST-006 (« Given un préavis de 3 h, When il choisit un départ dans 2 h, Then
 * DATES_NOTICE_TOO_SHORT » ; LST-008 DIFFÉRÉ : dates occupées refusées), LST-007, de 08 BR-BOOK-02,
 * BR-BOOK-03, BR-BOOK-04, BR-BOOK-05, et du pré-mortem du lot 2 (L2-PM-29), jamais du code testé.
 *
 * Fuseaux (donnée IANA, pas une constante du code) : America/Panama = UTC−5 ; America/Asuncion =
 * UTC−3 en décembre : les dates du critère 3 sont en décembre.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  connectAs,
  releaseClient,
  signedOpenParams,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { bookTrip, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { placeName } from '../support/names.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { uniquePlate } from '../support/unique.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** Décalage UTC de décembre du fuseau du pays, en heures (donnée IANA, voir l'en-tête). */
const DECEMBER_OFFSET_H: Readonly<Record<string, number>> = { PA: -5, PY: -3 };
/** Préavis choisi par l'hôte (16 LST-006 : « un préavis de 3 h »), en minutes. */
const NOTICE_MIN = 180;
/** Libellé, adresse et point exacts du lieu (C2) : jamais rendus avant BOOKED. */
const PLACE = 'Casa de Ana';
const ADDRESS = 'Calle Larga';
const EXACT = ['8.987654', '79.512345'];
const ACTIVE_TRIP = ['BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE'];

const GALLERY = 'SELECT * FROM core.catalog_public_gallery($1::uuid)';
const SLOT = 'SELECT * FROM core.catalog_public_slot_check($1::uuid, $2::timestamp, $3::timestamp)';
const MEET = 'SELECT * FROM core.catalog_guest_meeting_point($1, $2::uuid)';

/** Instant UTC ISO d'une heure locale de décembre du pays (donnée IANA de l'en-tête). */
const utc = (c: CountryCase, local: string): string =>
  new Date(
    Date.parse(`${local}:00Z`) - (DECEMBER_OFFSET_H[c.country] ?? 0) * 3_600_000,
  ).toISOString();

interface Person {
  readonly userId: string;
  readonly hash: Buffer;
}

interface Car extends Person {
  readonly org: string;
  readonly location: string;
  readonly vehicle: string;
  readonly listing: string;
  readonly city: string;
  readonly area: string;
}

/** Personne inscrite (compte ACTIVE) et session ouverte (vraies commandes d'US-102 et d'IAM). */
async function person(c: Tx, country: string, first = 'Ana'): Promise<Person> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, 'Pérez', 'es', $5, $6, 86400, NULL,
                                                $7, $8::jsonb, false) AS ok`,
    [
      userId,
      `s204-${userId}@example.test`,
      phcArgon2id(),
      first,
      uuid(),
      randomBytes(32),
      country,
      DOCS,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(c, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { userId, hash: t.hash };
}

/**
 * Hôte activable (compte ACTIVE), lieu épinglé avec le préavis de l'hôte, véhicule et annonce ;
 * `photos` photos ajoutées en brouillon (US-115), puis annonce publiée.
 */
async function car(c: Tx, cc: CountryCase, photos = 0): Promise<Car & { photoIds: string[] }> {
  const host = await person(c, cc.country);
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [host.hash, cc.country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const city = placeName('Villa');
  const area = placeName('Barrio');
  const loc = await c.query<{ outcome: string; location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [host.hash, org, 'HOME', PLACE, ADDRESS, city, area, '8.987654', '-79.512345'],
  );
  const location = loc.rows[0]?.location_id;
  if (!location) throw new Error(`lieu refusé : ${loc.rows[0]?.outcome}`);
  const notice = await c.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_set_location_notice($1, $2, $3, $4)',
    [host.hash, org, location, NOTICE_MIN],
  );
  if (notice.rows[0]?.outcome !== 'DONE') throw new Error(`préavis : ${notice.rows[0]?.outcome}`);
  const veh = await c.query<{ vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [host.hash, org, location, await uniquePlate(c, 'C')],
  );
  const vehicle = veh.rows[0]?.vehicle_id;
  if (!vehicle) throw new Error('véhicule refusé');
  const lst = await c.query<{ listing_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, NULL, NULL, NULL)',
    [host.hash, org, vehicle, 40 * cc.priceStepMinor * 100, 'UNLIMITED'],
  );
  const listing = lst.rows[0]?.listing_id;
  if (!listing) throw new Error('annonce refusée');
  const photoIds: string[] = [];
  for (let i = 0; i < photos; i += 1) {
    const p = await c.query<{ outcome: string; photo_id: string | null }>(
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [host.hash, org, listing, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    if (p.rows[0]?.outcome !== 'DONE' || !p.rows[0].photo_id) throw new Error('photo refusée');
    photoIds.push(p.rows[0].photo_id);
  }
  await c.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [listing, 'LISTED']);
  return { ...host, org, location, vehicle, listing, city, area, photoIds };
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction annulée. */
async function openSwitch(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
): Promise<void> {
  const actor = async (role: string): Promise<StaffActor> => {
    const id = await rlsStaff(c, role, [country]);
    return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope: [country] };
  };
  const requester = await actor('ADMIN');
  const approver = await freshSession(c, await actor('SUPERADMIN'));
  const r = await requestSwitch(c, requester, key, country, true);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(c, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

async function openCountry(c: Tx, country: string): Promise<void> {
  await openSwitch(c, 'p2p_private_hosts_enabled', country);
  await openSwitch(c, 'insurer_contract_active', country);
}

/**
 * Heure locale du pays à `hours` heures de la prochaine heure pleine (horloge de la base,
 * `platform.now()`), au format `AAAA-MM-JJTHH:MM` : toujours au pas de 30 min et dans le futur.
 */
async function localFromNow(c: Tx, cc: CountryCase, hours: number): Promise<string> {
  const { rows } = await c.query<{ t: string }>(
    `SELECT pg_catalog.to_char(pg_catalog.date_trunc('hour', platform.now() AT TIME ZONE $1)
                               + pg_catalog.make_interval(hours => $2 + 1),
                               'YYYY-MM-DD"T"HH24:MI') AS t`,
    [cc.timezone, hours],
  );
  const t = rows[0]?.t;
  if (t === undefined) throw new Error('horloge illisible');
  return t;
}

async function slot(c: Tx, listing: string, start: string, end: string): Promise<Row[]> {
  return (await c.query<Row>(SLOT, [listing, start, end])).rows;
}

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole). */
const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

describe.each(COUNTRIES)('US-204 — fiche du véhicule ($country, $currency)', (cc) => {
  it('critère 1 : 8 photos ⇒ la galerie les rend dans l’ordre de l’hôte, clé du bucket public seulement ; refusée ou retirée ⇒ écartée, le reste intact ; annonce non publiée ⇒ aucune', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 8);
      const { rows } = await tx.query<Row>(GALLERY, [x.listing]);
      expect(rows.map((r) => r['photo_id'])).toEqual(x.photoIds);
      expect(rows.map((r) => r['photo_order'])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      for (const r of rows) {
        expect(Object.keys(r).sort()).toEqual(['photo_id', 'photo_order', 'storage_key']);
        expect(r['storage_key']).toBe(`listing/${x.listing}/${String(r['photo_id'])}`);
      }
      // une photo refusée par l'ops et une photo retirée par l'hôte : les six autres, même ordre
      const [p0, p1, p2, p3, p4, p5, p6, p7] = x.photoIds;
      await tx.query('SELECT test_fixture.us204_set_photo($1, $2, $3)', [p2, 'REJECTED', false]);
      await tx.query('SELECT test_fixture.us204_set_photo($1, $2, $3)', [p5, 'APPROVED', true]);
      await tx.query('SELECT test_fixture.us204_set_photo($1, $2, $3)', [p6, 'APPROVED', false]);
      const after = await tx.query<Row>(GALLERY, [x.listing]);
      expect(after.rows.map((r) => r['photo_id'])).toEqual([p0, p1, p3, p4, p6, p7]);
      // annonce retirée ou inconnue : aucune photo
      await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
        x.listing,
        'UNLISTED',
      ]);
      expect((await tx.query<Row>(GALLERY, [x.listing])).rows).toEqual([]);
      expect((await tx.query<Row>(GALLERY, [uuid()])).rows).toEqual([]);
    });
  });

  it('critère 2 : préavis de 3 h de l’hôte, départ dans moins de 3 h ⇒ DATES_NOTICE_TOO_SHORT (préavis rendu) ; au-delà ⇒ OK, instants dans le fuseau du véhicule', async () => {
    await rolledBack(async (tx) => {
      await openCountry(tx, cc.country);
      const x = await car(tx, cc);
      // départ dans 1 à 2 h (prochaine heure pleine + 1 h), retour le lendemain : préavis manqué
      const early = await localFromNow(tx, cc, 1);
      const earlyEnd = await localFromNow(tx, cc, 25);
      const refused = await slot(tx, x.listing, early, earlyEnd);
      expect(refused).toEqual([
        {
          outcome: 'DATES_NOTICE_TOO_SHORT',
          start_at: null,
          end_at: null,
          timezone: null,
          notice_minutes: NOTICE_MIN,
        },
      ]);
      // départ dans 3 h ou plus : accepté
      const start = await localFromNow(tx, cc, 3);
      const end = await localFromNow(tx, cc, 27);
      const ok = await slot(tx, x.listing, start, end);
      expect(ok).toHaveLength(1);
      expect(ok[0]).toMatchObject({ outcome: 'OK', timezone: cc.timezone, notice_minutes: 180 });
      const { rows } = await tx.query<{ s: Date; e: Date }>(
        `SELECT $1::timestamp AT TIME ZONE $3 AS s, $2::timestamp AT TIME ZONE $3 AS e`,
        [start, end, cc.timezone],
      );
      expect(ok[0]?.['start_at']).toEqual(rows[0]?.s);
      expect(ok[0]?.['end_at']).toEqual(rows[0]?.e);
    });
  });

  it('dates occupées (trip, tampon) ou hôte non activable ⇒ DATES_UNAVAILABLE sans détail ; refus de la recherche repris ; annonce inconnue ou non publiée ⇒ LISTING_NOT_FOUND', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc);
      const start = await localFromNow(tx, cc, 48);
      const end = await localFromNow(tx, cc, 72);
      // pays fermé (interrupteurs à false, défaut de production) : jamais réservable
      expect((await slot(tx, x.listing, start, end)).map((r) => r['outcome'])).toEqual([
        'DATES_UNAVAILABLE',
      ]);
      await openCountry(tx, cc.country);
      expect((await slot(tx, x.listing, start, end)).map((r) => r['outcome'])).toEqual(['OK']);
      // trip confirmé qui finit 1 h avant le départ demandé : son occupation court jusqu'à sa fin
      // plus le tampon de 2 h (`buffer_minutes`, BR-BOOK-05, comme la conversion la pose), donc
      // jusqu'à 1 h après le départ demandé
      const { rows: p } = await tx.query<{ period: string }>(
        `SELECT pg_catalog.tstzrange(($1::timestamp AT TIME ZONE $2) - interval '1 day',
                                     ($1::timestamp AT TIME ZONE $2) + interval '1 hour',
                                     '[)')::text AS period`,
        [start, cc.timezone],
      );
      await tx.query('SELECT test_fixture.us203_trip_occupancy($1, $2, $3, $4::tstzrange)', [
        x.vehicle,
        x.org,
        cc.country,
        p[0]?.period,
      ]);
      const busy = await slot(tx, x.listing, start, end);
      expect(busy).toEqual([
        {
          outcome: 'DATES_UNAVAILABLE',
          start_at: null,
          end_at: null,
          timezone: null,
          notice_minutes: null,
        },
      ]);
      // mêmes refus que la recherche (US-201) : hors pas de 30 min, fin avant début, durée
      const quarter = start.replace(/:00$/, ':15');
      for (const [s, e, code] of [
        [quarter, end, 'SEARCH_DATES_INVALID'],
        [end, start, 'SEARCH_DATES_INVALID'],
        [start, start, 'SEARCH_DATES_INVALID'],
        [start, await localFromNow(tx, cc, 24 * 400), 'SEARCH_DURATION_EXCEEDED'],
      ] as const) {
        expect(
          (await slot(tx, x.listing, s, e)).map((r) => r['outcome']),
          `${s} ${e}`,
        ).toEqual([code]);
      }
      expect((await slot(tx, uuid(), start, end)).map((r) => r['outcome'])).toEqual([
        'LISTING_NOT_FOUND',
      ]);
      await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
        x.listing,
        'UNLISTED',
      ]);
      expect((await slot(tx, x.listing, start, end)).map((r) => r['outcome'])).toEqual([
        'LISTING_NOT_FOUND',
      ]);
    });
  });

  it('critère 3 : le lieu exact (libellé, adresse) n’est rendu qu’au voyageur d’un trip BOOKED de ce véhicule ; visiteur, autre voyageur, session invalide, trip annulé ou terminé ⇒ rien ; la fiche publique ne le contient jamais', async () => {
    const api = await connectAs('app_api');
    try {
      const worker = await connectAs('app_worker');
      try {
        const setup = utc(cc, '2026-12-10T08:00');
        const w = await inTx(api, { virtualNow: setup, commit: true }, async (tx) => ({
          car: await car(tx, cc),
          guest: await person(tx, cc.country, 'Luis'),
          other: await person(tx, cc.country, 'Rosa'),
        }));
        const booked = await bookTrip(
          api,
          worker,
          {
            vehicleId: w.car.vehicle,
            orgId: w.car.org,
            start: utc(cc, '2026-12-12T09:00'),
            end: utc(cc, '2026-12-14T09:00'),
            bufferHours: 2,
          },
          cc,
          utc(cc, '2026-12-10T09:00'),
          w.guest.userId,
        );
        const later = utc(cc, '2026-12-10T10:00');
        await inTx(api, { virtualNow: later }, async (tx) => {
          const mine = (await tx.query<Row>(MEET, [w.guest.hash, w.car.listing])).rows;
          expect(mine).toEqual([
            {
              place_label: PLACE,
              address_line: ADDRESS,
              city: w.car.city,
              area_label: w.car.area,
              location_kind: 'HOME',
            },
          ]);
          // ni le point exact, ni le compte d'hôte, ni le trip
          const flat = JSON.stringify(mine);
          for (const secret of [...EXACT, w.car.org, booked.tripId]) {
            expect(flat).not.toContain(secret);
          }
          // autre voyageur, l'hôte lui-même, session inconnue : rien
          for (const hash of [w.other.hash, w.car.hash, randomBytes(32)]) {
            expect((await tx.query<Row>(MEET, [hash, w.car.listing])).rows).toEqual([]);
          }
          // visiteur (fiche publique, US-115) : ni libellé, ni adresse, ni point exact
          const pub = await tx.query<Row>('SELECT * FROM core.catalog_public_listing($1)', [
            w.car.listing,
          ]);
          expect(pub.rows).toHaveLength(1);
          const shown = JSON.stringify(pub.rows);
          for (const secret of [PLACE, ADDRESS, ...EXACT]) expect(shown).not.toContain(secret);
        });
        // états confirmés et non terminés : adresse rendue ; annulé ou terminé : plus rien
        for (const status of [...ACTIVE_TRIP, 'CANCELLED_BY_GUEST', 'RETURNED', 'COMPLETED']) {
          await inTx(api, { virtualNow: later }, async (tx) => {
            await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
              booked.tripId,
              status,
            ]);
            const rows = (await tx.query<Row>(MEET, [w.guest.hash, w.car.listing])).rows;
            expect(rows.length, status).toBe(ACTIVE_TRIP.includes(status) ? 1 : 0);
          });
        }
      } finally {
        await releaseClient(worker);
      }
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-204 — droits des fonctions de la fiche (0106)', () => {
  it('app_worker et app_anon n’exécutent ni la galerie, ni le contrôle des dates, ni le lieu exact (42501)', async () => {
    const calls: [string, unknown[]][] = [
      [GALLERY, [uuid()]],
      [SLOT, [uuid(), '2036-12-10T10:00', '2036-12-11T10:00']],
      [MEET, [randomBytes(32), uuid()]],
    ];
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const [sql, args] of calls) {
          await client.query('BEGIN');
          try {
            await expect(client.query(sql, args), `${role} ${sql}`).rejects.toMatchObject({
              code: '42501',
            });
          } finally {
            await client.query('ROLLBACK');
          }
        }
      });
    }
  });
});
