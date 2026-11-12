/**
 * Preuves du calendrier par véhicule, des blocages de l'hôte et du préavis (US-119, migration
 * 0071) sous le rôle de production app_api (assertion L0-05 en tête de chaque connexion,
 * withRole), en USD (PA) et en PYG (PY). Chaque test crée ses propres personnes, sessions, comptes
 * d'hôte, lieux, véhicules et annonces par les VRAIES commandes (US-107, US-115).
 *
 * Attendus tirés de 19 US-119 (critères), de 16 CAL-001 / CAL-002 (« blocage chevauchant un trip :
 * refus », « blocage du 10 au 12, un voyageur cherche le 11 : absent », « hôte A contre véhicule de
 * B : rien n'est écrit »), CAL-003 (« préavis de 3 h, départ dans 2 h 59 : refus »,
 * `DATES_NOTICE_TOO_SHORT`), CAL-011 (`VEHICLE_UNAVAILABLE`), de 17 §2.3 (sonde
 * `vehicle_is_free` : NULL hors annonce publiée, période arrondie à l'heure), §3.2.3
 * (`advance_notice_minutes` du lieu), §7.2 (défaut du pays 180 min), de 08 BR-BOOK-03 (pas de
 * 30 min) et du pré-mortem du lot 1 (L1-PM-11, L1-PM-22 : blocage par commande, fuseau du pays,
 * refus sans détail d'occupation), jamais du code testé.
 *
 * Fuseaux (donnée IANA, pas une constante du code) : America/Panama = UTC−5 toute l'année ;
 * America/Asuncion = UTC−3 en décembre (avant comme après la suppression de l'heure d'hiver en
 * 2024) : les dates de test sont en décembre.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { commandCallSql, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** Décalage UTC de décembre du fuseau du pays, en heures (donnée IANA, voir l'en-tête). */
const DECEMBER_OFFSET_H: Readonly<Record<string, number>> = { PA: -5, PY: -3 };
/** Défaut du pays (17 §7.2 `advance_notice_minutes`, graine US-013) : 180 min. */
const COUNTRY_NOTICE_MIN = 180;

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}
interface Car extends Host {
  readonly location: string;
  readonly vehicle: string;
  readonly listing: string;
}

async function session(client: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Personne inscrite (compte ACTIVE) et session ouverte par les vraies commandes. */
async function person(
  client: pg.ClientBase,
  country: string,
): Promise<{ userId: string; hash: Buffer }> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `cal-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  return { userId, hash: await session(client, userId) };
}

async function host(client: pg.ClientBase, country: string): Promise<Host> {
  const p = await person(client, country);
  const { rows } = await client.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  // activation (US-123) forcée : un hold exige un compte d'hôte ACTIVE
  await client.query('SELECT test_fixture.us115_set_org_status($1, $2)', [
    rows[0].org_id,
    'ACTIVE',
  ]);
  return { ...p, org: rows[0].org_id };
}

const plate = (): string => `C${randomBytes(4).toString('hex').toUpperCase()}`;

/** Hôte, lieu, véhicule et annonce ; annonce publiée (US-118) forcée sauf `listed: false`. */
async function car(
  client: pg.ClientBase,
  c: CountryCase,
  options: { readonly listed?: boolean; readonly owner?: Host } = {},
): Promise<Car> {
  const h = options.owner ?? (await host(client, c.country));
  const loc = await client.query<{ outcome: string; location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, 'HOME', 'Casa', 'Calle 1', 'Ciudad', null, null, null],
  );
  const veh = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [h.hash, h.org, loc.rows[0]?.location_id, plate()],
  );
  const lst = await client.query<{ outcome: string; listing_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, NULL, NULL, NULL)',
    [h.hash, h.org, veh.rows[0]?.vehicle_id, 40 * c.priceStepMinor * 100, 'UNLIMITED'],
  );
  const location = loc.rows[0]?.location_id;
  const vehicle = veh.rows[0]?.vehicle_id;
  const listing = lst.rows[0]?.listing_id;
  if (!location || !vehicle || !listing) throw new Error('préparation du véhicule refusée');
  if (options.listed !== false) {
    await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [listing, 'LISTED']);
  }
  return { ...h, location, vehicle, listing };
}

interface Outcome {
  readonly outcome: string;
  readonly id: string | null;
}

async function block(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  vehicleId: string,
  startLocal: string,
  endLocal: string,
): Promise<Outcome> {
  const { rows } = await client.query<{ outcome: string; block_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_place_host_block($1, $2, $3, $4::timestamp, $5::timestamp)',
    [h.hash, h.org, vehicleId, startLocal, endLocal],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.block_id ?? null };
}

async function unblock(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  vehicleId: string,
  blockId: string,
): Promise<string> {
  const { rows } = await client.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_remove_host_block($1, $2, $3, $4)',
    [h.hash, h.org, vehicleId, blockId],
  );
  return rows[0]?.outcome ?? '';
}

async function setNotice(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  locationId: string,
  minutes: number | null,
): Promise<string> {
  const { rows } = await client.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_set_location_notice($1, $2, $3, $4)',
    [h.hash, h.org, locationId, minutes],
  );
  return rows[0]?.outcome ?? '';
}

interface Header {
  outcome: string;
  timezone: string | null;
  listed: boolean | null;
  location_id: string | null;
  notice_minutes: number | null;
  effective_notice_minutes: number | null;
}

async function header(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  vehicleId: string,
): Promise<Header | undefined> {
  const { rows } = await client.query<Header>(
    'SELECT * FROM core.catalog_host_vehicle_calendar($1, $2, $3)',
    [h.hash, h.org, vehicleId],
  );
  return rows[0];
}

interface OccRow extends Record<string, unknown> {
  occupancy_id: string;
  kind: string;
  source: string;
  starts_at: Date;
  ends_at: Date;
  start_local: string;
  end_local: string;
  removable: boolean;
}

async function occupancies(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  vehicleId: string,
): Promise<OccRow[]> {
  const { rows } = await client.query<OccRow>(
    'SELECT * FROM core.catalog_host_vehicle_occupancies($1, $2, $3)',
    [h.hash, h.org, vehicleId],
  );
  return rows;
}

async function isFree(
  client: pg.ClientBase,
  vehicleId: string,
  period: string,
): Promise<boolean | null> {
  const { rows } = await client.query<{ free: boolean | null }>(
    'SELECT core.catalog_vehicle_is_free($1, $2::tstzrange) AS free',
    [vehicleId, period],
  );
  return rows[0]?.free ?? null;
}

/** Instant UTC d'une heure locale de décembre du pays (donnée IANA de l'en-tête). */
function utcOf(c: CountryCase, local: string): string {
  const offset = DECEMBER_OFFSET_H[c.country];
  if (offset === undefined) throw new Error(`pays de test sans décalage : ${c.country}`);
  return new Date(Date.parse(`${local}:00.000Z`) - offset * 3_600_000).toISOString();
}

/** Pose d'un hold par la commande réelle, sous le contexte du voyageur, à l'horloge `now`. */
async function hold(
  client: pg.ClientBase,
  guestId: string,
  vehicleId: string,
  now: string,
  startMinutes: number,
): Promise<string> {
  const start = new Date(Date.parse(now) + startMinutes * 60_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 86_400_000).toISOString();
  return withTestTransaction(client, { virtualNow: now }, async (tx) => {
    const { text, values } = commandCallSql(
      { kind: 'GUEST', actorId: guestId },
      'core.booking_cmd_place_hold',
      [
        { value: vehicleId, type: 'uuid' },
        { value: start, type: 'timestamptz' },
        { value: end, type: 'timestamptz' },
        { value: false, type: 'boolean' },
      ],
    );
    return tx.query(text, values).then(
      () => 'OK',
      (e: unknown) => translateDbError(e).code,
    );
  });
}

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);

// ---------------------------------------------------------------------------------------------
describe('critère 1 — un trip confirmé apparaît au calendrier en ≤ 5 s (16 CAL-001, NFR-13)', () => {
  it.each(byCountry)(
    '%s (%s) : trip BOOKED ⇒ ligne TRIP au calendrier rouvert, bornes locales du véhicule, aucune donnée du voyageur',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const t0 = Date.now();
        await client.query(
          'SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)',
          [
            uuid(),
            uuid(),
            a.org,
            a.vehicle,
            c.country,
            c.currency,
            c.timezone,
            utcOf(c, '2036-12-20T10:00'),
            utcOf(c, '2036-12-23T10:00'),
          ],
        );
        const rows = await occupancies(client, a, a.vehicle);
        expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: 'TRIP',
          start_local: '2036-12-20T10:00',
          end_local: '2036-12-23T10:00',
          removable: false,
        });
        // colonnes rendues : type, source, bornes, levée possible ; jamais le voyageur ni ref_id
        expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
          'end_local',
          'ends_at',
          'kind',
          'occupancy_id',
          'removable',
          'source',
          'start_local',
          'starts_at',
        ]);
        expect(await header(client, a, a.vehicle)).toMatchObject({
          outcome: 'DONE',
          timezone: c.timezone,
          listed: true,
          location_id: a.location,
          notice_minutes: null,
          effective_notice_minutes: COUNTRY_NOTICE_MIN,
        });
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 2 — blocages par commande : chevauchement refusé ; véhicule absent de la recherche (16 CAL-002, CAL-011)', () => {
  it.each(byCountry)(
    '%s (%s) : blocage chevauchant un trip ⇒ VEHICLE_UNAVAILABLE, rien n’est écrit',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        await client.query(
          'SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)',
          [
            uuid(),
            uuid(),
            a.org,
            a.vehicle,
            c.country,
            c.currency,
            c.timezone,
            utcOf(c, '2036-12-20T10:00'),
            utcOf(c, '2036-12-23T10:00'),
          ],
        );
        const r = await block(client, a, a.vehicle, '2036-12-21T00:00', '2036-12-22T00:00');
        expect(r).toEqual({ outcome: 'VEHICLE_UNAVAILABLE', id: null });
        // bord semi-ouvert : un blocage qui finit au début du trip est accepté
        expect(
          (await block(client, a, a.vehicle, '2036-12-19T00:00', '2036-12-20T10:00')).outcome,
        ).toBe('DONE');
        expect((await occupancies(client, a, a.vehicle)).map((o) => o.kind)).toEqual([
          'HOST_BLOCK',
          'TRIP',
        ]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : blocage du 10 au 12 (jours locaux) ⇒ le 11 le véhicule est absent (sonde NULL / false), libre le 14 ; levée ⇒ libre ; bornes en heure locale du pays',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        // jours du 10 au 12 inclus : [10 00:00, 13 00:00) local
        const r = await block(client, a, a.vehicle, '2036-12-10T00:00', '2036-12-13T00:00');
        expect(r.outcome).toBe('DONE');
        const [row] = await occupancies(client, a, a.vehicle);
        expect(row).toMatchObject({
          occupancy_id: r.id,
          kind: 'HOST_BLOCK',
          source: 'MANUAL',
          start_local: '2036-12-10T00:00',
          end_local: '2036-12-13T00:00',
          removable: true,
        });
        expect(row?.starts_at.toISOString()).toBe(utcOf(c, '2036-12-10T00:00'));
        expect(row?.ends_at.toISOString()).toBe(utcOf(c, '2036-12-13T00:00'));
        const day11 = `[${utcOf(c, '2036-12-11T10:00')},${utcOf(c, '2036-12-11T18:00')})`;
        const day14 = `[${utcOf(c, '2036-12-14T10:00')},${utcOf(c, '2036-12-14T18:00')})`;
        expect(await isFree(client, a.vehicle, day11)).toBe(false);
        expect(await isFree(client, a.vehicle, day14)).toBe(true);
        // période arrondie à l'heure (17 §2.3) : une fin à 00:01 le 10 touche le blocage
        expect(
          await isFree(
            client,
            a.vehicle,
            `[${utcOf(c, '2036-12-09T22:00')},${utcOf(c, '2036-12-10T00:01')})`,
          ),
        ).toBe(false);
        expect(
          await isFree(
            client,
            a.vehicle,
            `[${utcOf(c, '2036-12-09T22:00')},${utcOf(c, '2036-12-10T00:00')})`,
          ),
        ).toBe(true);
        // hold d'un voyageur sur le 11 : refusé
        const guest = await person(client, c.country);
        const now = utcOf(c, '2036-12-01T12:00');
        const minutesTo11 = (Date.parse(utcOf(c, '2036-12-11T10:00')) - Date.parse(now)) / 60_000;
        expect(await hold(client, guest.userId, a.vehicle, now, minutesTo11)).toBe(
          'VEHICLE_UNAVAILABLE',
        );
        // levée : le créneau est libéré ; seconde levée : BLOCK_NOT_FOUND
        expect(await unblock(client, a, a.vehicle, r.id ?? '')).toBe('DONE');
        expect(await unblock(client, a, a.vehicle, r.id ?? '')).toBe('BLOCK_NOT_FOUND');
        expect(await occupancies(client, a, a.vehicle)).toEqual([]);
        expect(await isFree(client, a.vehicle, day11)).toBe(true);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : blocage par heure au pas de 30 min ; pas hors grille ou période inversée ⇒ INVALID_PERIOD ; véhicule non publié ⇒ VEHICLE_NOT_LISTED et sonde NULL',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        expect(
          (await block(client, a, a.vehicle, '2036-12-05T08:30', '2036-12-05T12:00')).outcome,
        ).toBe('DONE');
        for (const [s, e] of [
          ['2036-12-06T08:15', '2036-12-06T12:00'],
          ['2036-12-06T08:00', '2036-12-06T08:00'],
          ['2036-12-06T12:00', '2036-12-06T08:00'],
          ['2036-12-06T08:00:30', '2036-12-06T12:00'],
        ] as const) {
          expect((await block(client, a, a.vehicle, s, e)).outcome, `${s} → ${e}`).toBe(
            'INVALID_PERIOD',
          );
        }
        const draftCar = await car(client, c, { listed: false });
        expect(
          (await block(client, draftCar, draftCar.vehicle, '2036-12-05T00:00', '2036-12-06T00:00'))
            .outcome,
        ).toBe('VEHICLE_NOT_LISTED');
        expect(
          await isFree(
            client,
            draftCar.vehicle,
            `[${utcOf(c, '2036-12-05T10:00')},${utcOf(c, '2036-12-05T12:00')})`,
          ),
        ).toBeNull();
        expect(await isFree(client, uuid(), '[2036-12-05T10:00Z,2036-12-05T12:00Z)')).toBeNull();
        expect((await header(client, draftCar, draftCar.vehicle))?.listed).toBe(false);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : concurrence — deux blocages simultanés sur le même créneau : un seul DONE ; blocage contre hold simultanés : une seule occupation',
    async (_country, _currency, c) => {
      await withRole('app_api', async (x) => {
        await withRole('app_api', async (y) => {
          const a = await car(x, c);
          const [r1, r2] = await Promise.all([
            block(x, a, a.vehicle, '2036-12-15T00:00', '2036-12-16T00:00'),
            block(y, a, a.vehicle, '2036-12-15T12:00', '2036-12-17T00:00'),
          ]);
          expect([r1.outcome, r2.outcome].sort()).toEqual(['DONE', 'VEHICLE_UNAVAILABLE']);
          expect(await occupancies(x, a, a.vehicle)).toHaveLength(1);

          const b = await car(x, c);
          const guest = await person(x, c.country);
          // même créneau de deux jours, dans 30 jours (au-delà du préavis) : instants UTC pour le
          // hold, heures locales du véhicule (fuseau du pays) pour le blocage
          const startUtc = new Date(
            Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 30 * 86_400_000,
          );
          const endUtc = new Date(startUtc.getTime() + 2 * 86_400_000);
          const local = await x.query<{ s: string; e: string }>(
            `SELECT to_char(($1::timestamptz) AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS s,
                    to_char(($2::timestamptz) AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS e`,
            [startUtc.toISOString(), endUtc.toISOString(), c.timezone],
          );
          const [h1, b1] = await Promise.all([
            withTestTransaction(y, { commit: true }, async (tx) => {
              const { text, values } = commandCallSql(
                { kind: 'GUEST', actorId: guest.userId },
                'core.booking_cmd_place_hold',
                [
                  { value: b.vehicle, type: 'uuid' },
                  { value: startUtc.toISOString(), type: 'timestamptz' },
                  { value: endUtc.toISOString(), type: 'timestamptz' },
                  { value: false, type: 'boolean' },
                ],
              );
              return tx.query(text, values).then(
                () => 'OK',
                (e: unknown) => translateDbError(e).code,
              );
            }),
            block(x, b, b.vehicle, local.rows[0]?.s ?? '', local.rows[0]?.e ?? '').then(
              (r) => r.outcome,
            ),
          ]);
          // exactement un gagnant (hold OK ou blocage DONE), l'autre VEHICLE_UNAVAILABLE
          expect(
            [h1, b1].filter((o) => o === 'OK' || o === 'DONE'),
            `${h1},${b1}`,
          ).toHaveLength(1);
          expect(
            [h1, b1].filter((o) => o === 'VEHICLE_UNAVAILABLE'),
            `${h1},${b1}`,
          ).toHaveLength(1);
          expect(await occupancies(x, b, b.vehicle)).toHaveLength(1);
        });
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 3 — préavis par lieu de remise (16 CAL-003, 08 BR-BOOK-04)', () => {
  it.each(byCountry)(
    '%s (%s) : préavis de 3 h fixé par l’hôte ⇒ départ dans 2 h 59 refusé (DATES_NOTICE_TOO_SHORT), dans 3 h accepté ; 6 h ⇒ 5 h 59 refusé ; retour au défaut du pays',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const guest = await person(client, c.country);
        const now = '2036-11-02T15:00:00.000Z';
        expect(await setNotice(client, a, a.location, 180)).toBe('DONE');
        expect((await header(client, a, a.vehicle))?.notice_minutes).toBe(180);
        expect(await hold(client, guest.userId, a.vehicle, now, 179)).toBe(
          'DATES_NOTICE_TOO_SHORT',
        );
        expect(await hold(client, guest.userId, a.vehicle, now, 180)).toBe('OK');
        expect(await setNotice(client, a, a.location, 360)).toBe('DONE');
        expect(await hold(client, guest.userId, a.vehicle, now, 359)).toBe(
          'DATES_NOTICE_TOO_SHORT',
        );
        expect(await hold(client, guest.userId, a.vehicle, now, 360)).toBe('OK');
        // NULL : défaut du pays (180 min, 17 §7.2)
        expect(await setNotice(client, a, a.location, null)).toBe('DONE');
        expect(await header(client, a, a.vehicle)).toMatchObject({
          notice_minutes: null,
          effective_notice_minutes: COUNTRY_NOTICE_MIN,
        });
        expect(await hold(client, guest.userId, a.vehicle, now, COUNTRY_NOTICE_MIN - 1)).toBe(
          'DATES_NOTICE_TOO_SHORT',
        );
        expect(await hold(client, guest.userId, a.vehicle, now, COUNTRY_NOTICE_MIN)).toBe('OK');
        // hors bornes (60 à 10 080) ou hors pas de 30 min : NOTICE_INVALID, rien n'est changé
        for (const m of [0, 30, 45, 10_110, -60]) {
          expect(await setNotice(client, a, a.location, m), String(m)).toBe('NOTICE_INVALID');
        }
        expect((await header(client, a, a.vehicle))?.notice_minutes).toBeNull();
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('L1-PM-22 — contexte app.* de l’hôte effacé après la commande, dans la MÊME transaction', () => {
  /** Contexte lu dans la transaction ouverte (jamais après sa fin : set_config(…, true) retombe). */
  async function contextIn(client: pg.ClientBase) {
    const { rows } = await client.query<{
      kind: string | null;
      actor: string | null;
      org: string | null;
    }>('SELECT app.actor_kind() AS kind, app.actor_id()::text AS actor, app.org_id()::text AS org');
    return rows[0];
  }
  const EMPTY = { kind: null, actor: null, org: null };

  it.each(byCountry)(
    '%s (%s) : BEGIN, commande, lecture, ROLLBACK — succès, VEHICLE_UNAVAILABLE, INVALID_PERIOD de la base, levée',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const kept = await block(client, a, a.vehicle, '2036-12-01T00:00', '2036-12-02T00:00');
        expect(kept.outcome).toBe('DONE');
        const cases: [string, string, string, string][] = [
          ['succès', '2036-12-05T00:00', '2036-12-06T00:00', 'DONE'],
          ['créneau pris', '2036-12-01T10:00', '2036-12-01T12:00', 'VEHICLE_UNAVAILABLE'],
          // forme valide, période déjà écoulée : refus de la commande de 0056 (chemin d'erreur)
          ['période écoulée', '2001-01-01T00:00', '2001-01-02T00:00', 'INVALID_PERIOD'],
        ];
        for (const [label, s, e, expected] of cases) {
          await client.query('BEGIN');
          try {
            expect(await contextIn(client), `${label} : avant`).toEqual(EMPTY);
            expect((await block(client, a, a.vehicle, s, e)).outcome, label).toBe(expected);
            expect(await contextIn(client), `${label} : après`).toEqual(EMPTY);
          } finally {
            await client.query('ROLLBACK');
          }
        }
        // levée (0071 6.2) : même preuve, succès puis blocage inconnu
        await client.query('BEGIN');
        try {
          expect(await unblock(client, a, a.vehicle, kept.id ?? '')).toBe('DONE');
          expect(await contextIn(client), 'levée').toEqual(EMPTY);
        } finally {
          await client.query('ROLLBACK');
        }
        // rien n'a été écrit par les transactions annulées
        expect((await occupancies(client, a, a.vehicle)).map((o) => o.occupancy_id)).toEqual([
          kept.id,
        ]);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('levée : seul un blocage manuel actif de CE véhicule (0056, 0071 6.2)', () => {
  it.each(byCountry)(
    '%s (%s) : identifiant d’une occupation TRIP ou HOLD du compte, ou blocage d’un autre véhicule du compte ⇒ BLOCK_NOT_FOUND, rien n’est levé',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const second = await car(client, c, { owner: a });
        await client.query(
          'SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)',
          [
            uuid(),
            uuid(),
            a.org,
            a.vehicle,
            c.country,
            c.currency,
            c.timezone,
            utcOf(c, '2036-12-20T10:00'),
            utcOf(c, '2036-12-23T10:00'),
          ],
        );
        // hold validé, à l'horloge réelle, dans 30 jours (au-delà du préavis)
        const guest = await person(client, c.country);
        const startUtc = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 30 * 86_400_000);
        await withTestTransaction(client, { commit: true }, async (tx) => {
          const { text, values } = commandCallSql(
            { kind: 'GUEST', actorId: guest.userId },
            'core.booking_cmd_place_hold',
            [
              { value: a.vehicle, type: 'uuid' },
              { value: startUtc.toISOString(), type: 'timestamptz' },
              {
                value: new Date(startUtc.getTime() + 86_400_000).toISOString(),
                type: 'timestamptz',
              },
              { value: false, type: 'boolean' },
            ],
          );
          await tx.query(text, values);
        });
        const otherBlock = await block(
          client,
          a,
          second.vehicle,
          '2036-12-05T00:00',
          '2036-12-06T00:00',
        );
        expect(otherBlock.outcome).toBe('DONE');
        const mine = await occupancies(client, a, a.vehicle);
        expect(mine.map((o) => o.kind).sort()).toEqual(['HOLD', 'TRIP']);
        for (const o of mine) {
          expect(await unblock(client, a, a.vehicle, o.occupancy_id), o.kind).toBe(
            'BLOCK_NOT_FOUND',
          );
        }
        expect(await unblock(client, a, a.vehicle, otherBlock.id ?? '')).toBe('BLOCK_NOT_FOUND');
        // tout est toujours actif
        expect((await occupancies(client, a, a.vehicle)).map((o) => o.kind).sort()).toEqual([
          'HOLD',
          'TRIP',
        ]);
        expect((await occupancies(client, a, second.vehicle)).map((o) => o.occupancy_id)).toEqual([
          otherBlock.id,
        ]);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('préavis : plancher de la classe et paramètre absent (08 BR-BOOK-04, 17 §7.2, fail-closed)', () => {
  it.each(byCountry)(
    '%s (%s) : véhicule LUXE, préavis de l’hôte 3 h ⇒ en vigueur 1 440 min (17 §7.2) : départ dans 23 h 59 refusé, dans 24 h accepté',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        await client.query('SELECT test_fixture.us119_set_vehicle_class($1, $2)', [
          a.vehicle,
          'LUXE',
        ]);
        expect(await setNotice(client, a, a.location, 180)).toBe('DONE');
        expect(await header(client, a, a.vehicle)).toMatchObject({
          notice_minutes: 180,
          effective_notice_minutes: 1_440,
        });
        const guest = await person(client, c.country);
        const now = '2036-11-02T15:00:00.000Z';
        expect(await hold(client, guest.userId, a.vehicle, now, 1_439)).toBe(
          'DATES_NOTICE_TOO_SHORT',
        );
        expect(await hold(client, guest.userId, a.vehicle, now, 1_440)).toBe('OK');
        // préavis de l'hôte au-dessus du plancher : le sien s'applique
        expect(await setNotice(client, a, a.location, 2_880)).toBe('DONE');
        expect((await header(client, a, a.vehicle))?.effective_notice_minutes).toBe(2_880);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : défaut du pays fermé et aucun préavis de l’hôte ⇒ préavis en vigueur NULL, pose du hold PARAM_MISSING (transaction annulée)',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const guest = await person(client, c.country);
        const now = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 60_000).toISOString();
        await withTestTransaction(client, { virtualNow: now }, async (tx) => {
          const closed = await tx.query<{ n: number }>(
            'SELECT test_fixture.us119_close_country_notice($1) AS n',
            [c.country],
          );
          expect(closed.rows[0]?.n).toBe(1);
          expect(await header(tx, a, a.vehicle)).toMatchObject({
            outcome: 'DONE',
            notice_minutes: null,
            effective_notice_minutes: null,
          });
          const start = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
          const { text, values } = commandCallSql(
            { kind: 'GUEST', actorId: guest.userId },
            'core.booking_cmd_place_hold',
            [
              { value: a.vehicle, type: 'uuid' },
              { value: start, type: 'timestamptz' },
              {
                value: new Date(Date.parse(start) + 86_400_000).toISOString(),
                type: 'timestamptz',
              },
              { value: false, type: 'boolean' },
            ],
          );
          const code = await tx.query(text, values).then(
            () => 'OK',
            (e: unknown) => translateDbError(e).code,
          );
          expect(code).toBe('PARAM_MISSING');
        });
        // annulé : le défaut du pays est de nouveau en vigueur
        expect((await header(client, a, a.vehicle))?.effective_notice_minutes).toBe(
          COUNTRY_NOTICE_MIN,
        );
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('L1-PM-11 / L1-PM-22 — cloisonnement entre hôtes, par pays', () => {
  it.each(byCountry)(
    '%s (%s) : l’hôte B ne lit, ne bloque, ne lève ni ne règle rien chez A (même réponse qu’un identifiant inconnu) ; même titulaire dans l’autre pays',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await car(client, c);
        const b = await car(client, c);
        const r = await block(client, a, a.vehicle, '2036-12-08T00:00', '2036-12-09T00:00');
        expect(r.outcome).toBe('DONE');
        // B contre le véhicule, le blocage et le lieu de A, avec son propre compte
        expect((await header(client, b, a.vehicle))?.outcome).toBe('VEHICLE_NOT_FOUND');
        expect(await occupancies(client, b, a.vehicle)).toEqual([]);
        expect(
          (await block(client, b, a.vehicle, '2036-12-10T00:00', '2036-12-11T00:00')).outcome,
        ).toBe('VEHICLE_NOT_FOUND');
        expect(await unblock(client, b, a.vehicle, r.id ?? '')).toBe('VEHICLE_NOT_FOUND');
        // le blocage de A sur le véhicule de B : inconnu pour ce véhicule
        expect(await unblock(client, b, b.vehicle, r.id ?? '')).toBe('BLOCK_NOT_FOUND');
        expect(await setNotice(client, b, a.location, 240)).toBe('LOCATION_NOT_FOUND');
        // B avec le compte de A (jamais un de ses comptes) : FORBIDDEN, comme un compte inconnu
        expect((await header(client, { hash: b.hash, org: a.org }, a.vehicle))?.outcome).toBe(
          'FORBIDDEN',
        );
        expect(
          (
            await block(
              client,
              { hash: b.hash, org: a.org },
              a.vehicle,
              '2036-12-10T00:00',
              '2036-12-11T00:00',
            )
          ).outcome,
        ).toBe('FORBIDDEN');
        // sans session valide
        expect(
          (await header(client, { hash: randomBytes(32), org: a.org }, a.vehicle))?.outcome,
        ).toBe('AUTH_REQUIRED');
        // même titulaire, son compte d'hôte de l'AUTRE pays : le véhicule, le lieu et le blocage
        // de son compte de ce pays sont inconnus de ce compte-là
        const other = COUNTRIES.find((x) => x.country !== c.country);
        if (other === undefined) throw new Error('un seul pays de test');
        const opened = await client.query<{ outcome: string; org_id: string | null }>(
          'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
          [a.hash, other.country, 'INDIVIDUAL'],
        );
        expect(opened.rows[0]?.outcome).toBe('DONE');
        const elsewhere = { hash: a.hash, org: opened.rows[0]?.org_id ?? '' };
        expect((await header(client, elsewhere, a.vehicle))?.outcome).toBe('VEHICLE_NOT_FOUND');
        expect(await occupancies(client, elsewhere, a.vehicle)).toEqual([]);
        expect(
          (await block(client, elsewhere, a.vehicle, '2036-12-10T00:00', '2036-12-11T00:00'))
            .outcome,
        ).toBe('VEHICLE_NOT_FOUND');
        expect(await unblock(client, elsewhere, a.vehicle, r.id ?? '')).toBe('VEHICLE_NOT_FOUND');
        expect(await setNotice(client, elsewhere, a.location, 240)).toBe('LOCATION_NOT_FOUND');
        // rien n'a changé chez A
        expect((await occupancies(client, a, a.vehicle)).map((o) => o.occupancy_id)).toEqual([
          r.id,
        ]);
        expect((await header(client, a, a.vehicle))?.notice_minutes).toBeNull();
      });
    },
  );

  it('app_worker et app_anon n’exécutent ni les commandes du calendrier ni la sonde (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        const token = randomBytes(32);
        for (const [sql, values] of [
          [
            'SELECT * FROM core.catalog_cmd_place_host_block($1, $2, $3, $4::timestamp, $4::timestamp)',
            [token, uuid(), uuid(), '2036-12-01T00:00'],
          ],
          [
            'SELECT * FROM core.catalog_host_vehicle_occupancies($1, $2, $3)',
            [token, uuid(), uuid()],
          ],
          ['SELECT core.catalog_vehicle_is_free($1, NULL)', [uuid()]],
        ] as const) {
          await client.query('BEGIN');
          try {
            await expect(client.query(sql, [...values]), `${role} ${sql}`).rejects.toMatchObject({
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
