/**
 * Preuves de la recherche publique par zone, lieu, dates et heures (US-201, migration 0103) sous
 * le rôle de production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD
 * (PA) et en PYG (PY). Chaque test crée ses propres personnes, sessions, comptes d'hôte, lieux,
 * véhicules et annonces par les VRAIES commandes (US-107, US-115), dans une transaction ANNULÉE :
 * les interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` n'y sont ouverts que
 * par la vraie procédure à deux personnes d'US-125, et rien ne survit au test.
 *
 * Attendus tirés de 19 US-201 (critères 1 à 4 : « début 10:00 et fin 09:30 le même jour ⇒
 * SEARCH_DATES_INVALID », fuseau `America/Asuncion`, « seule la zone approximative, jamais
 * l'adresse exacte »), de 16 SRC-001 (début passé refusé, `SEARCH_LOCATION_REQUIRED`,
 * `SEARCH_DURATION_EXCEEDED` au-delà de 30 jours), CAL-002 (« blocage du 10 au 12, un voyageur
 * cherche le 11 : absent »), CAL-003 (préavis), de 17 §0.1 (interrupteur absent = false), §2.3
 * (sonde, période arrondie à l'heure), §7.2 (`max_trip_days` = 30, `buffer_minutes` = 120,
 * `advance_notice_minutes` = 180), de 08 BR-BOOK-03 (pas de 30 min), BR-BOOK-05 (tampon après la
 * fin), de 22 OQ-P2P-05 et du pré-mortem (L1-PM-19, L2-PM-13, L2-PM-29), jamais du code testé.
 *
 * Fuseaux (donnée IANA, pas une constante du code) : America/Panama = UTC−5 toute l'année ;
 * America/Asuncion = UTC−3 en décembre (avant comme après la suppression de l'heure d'hiver en
 * 2024) : les dates de test sont en décembre, loin dans le futur (aucune borne d'horizon).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { signedOpenParams, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { placeName } from '../support/names.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { uniquePlate } from '../support/unique.ts';

type Tx = pg.ClientBase;

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** Décalage UTC de décembre du fuseau du pays, en heures (donnée IANA, voir l'en-tête). */
const DECEMBER_OFFSET_H: Readonly<Record<string, number>> = { PA: -5, PY: -3 };
/** 17 §7.2 `buffer_minutes` (graine US-013) : tampon de 2 h après la fin d'un trip. */
const BUFFER_H = 2;
/** 17 §7.2 `max_trip_days` (graine US-013, ADM-031 « décidé (bêta) ») : 30 jours. */
const MAX_TRIP_DAYS = 30;
/** Colonnes rendues par la recherche (C0 seulement, comme la fiche publique d'US-115). */
const SEARCH_COLUMNS = [
  'area_label',
  'city',
  'currency',
  'daily_price_minor',
  'end_at',
  'fuel_type',
  'geo_public_lat',
  'geo_public_lng',
  'instant_book',
  'listing_id',
  'location_kind',
  'make_name',
  'model_name',
  'outcome',
  'seats',
  'start_at',
  'timezone',
  'transmission',
  'year',
];

/** Instant UTC d'une heure locale de décembre du pays (donnée IANA de l'en-tête). */
function utcOf(c: CountryCase, local: string): string {
  const offset = DECEMBER_OFFSET_H[c.country];
  if (offset === undefined) throw new Error(`pays de test sans décalage : ${c.country}`);
  return new Date(Date.parse(`${local}:00.000Z`) - offset * 3_600_000).toISOString();
}

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}
interface Car extends Host {
  readonly location: string;
  readonly vehicle: string;
  readonly listing: string;
  readonly city: string;
  readonly area: string;
}

async function session(c: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(c, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Personne inscrite (compte ACTIVE) et session ouverte par les vraies commandes. */
async function person(c: Tx, country: string): Promise<{ userId: string; hash: Buffer }> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `s201-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  return { userId, hash: await session(c, userId) };
}

async function host(c: Tx, country: string): Promise<Host> {
  const p = await person(c, country);
  const { rows } = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  // activation (US-123) forcée : l'hôte activable est l'objet du test
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [rows[0].org_id, 'ACTIVE']);
  return { ...p, org: rows[0].org_id };
}

const plate = (c: pg.ClientBase): Promise<string> => uniquePlate(c, 'S');

/**
 * Hôte, lieu épinglé (nom, adresse et point exacts connus du seul hôte), véhicule et annonce
 * publiée (US-118 forcée par la fixture d'US-115, sauf `listed: false`).
 */
async function car(
  c: Tx,
  cc: CountryCase,
  options: {
    readonly city?: string;
    readonly area?: string;
    readonly listed?: boolean;
    readonly instantBook?: boolean;
  } = {},
): Promise<Car> {
  const h = await host(c, cc.country);
  const city = options.city ?? placeName('Villa');
  const area = options.area ?? placeName('Barrio');
  const loc = await c.query<{ outcome: string; location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, 'HOME', 'Casa de Ana', 'Calle Larga', city, area, '8.987654', '-79.512345'],
  );
  if (loc.rows[0]?.outcome !== 'DONE') throw new Error(`lieu refusé : ${loc.rows[0]?.outcome}`);
  const veh = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [h.hash, h.org, loc.rows[0]?.location_id, await plate(c)],
  );
  const lst = await c.query<{ outcome: string; listing_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, NULL, NULL, $6)',
    [
      h.hash,
      h.org,
      veh.rows[0]?.vehicle_id,
      40 * cc.priceStepMinor * 100,
      'UNLIMITED',
      options.instantBook ?? null,
    ],
  );
  const location = loc.rows[0]?.location_id;
  const vehicle = veh.rows[0]?.vehicle_id;
  const listing = lst.rows[0]?.listing_id;
  if (!location || !vehicle || !listing) {
    throw new Error(
      `préparation refusée : ${loc.rows[0]?.outcome} ${veh.rows[0]?.outcome} ${lst.rows[0]?.outcome}`,
    );
  }
  if (options.listed !== false) {
    await c.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [listing, 'LISTED']);
  }
  return { ...h, location, vehicle, listing, city, area };
}

/**
 * Ouvre un interrupteur dans la transaction ANNULÉE de l'appelant par la procédure à deux
 * personnes d'US-125 (demande d'un ADMIN, approbation d'un SUPERADMIN).
 */
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

type Row = Record<string, unknown>;

async function search(
  c: Tx,
  country: string | null,
  city: string | null,
  area: string | null,
  startLocal: string | null,
  endLocal: string | null,
  limit: number | null = null,
): Promise<Row[]> {
  const { rows } = await c.query<Row>(
    `SELECT * FROM core.catalog_public_search($1, $2, $3, $4::timestamp, $5::timestamp, $6)`,
    [country, city, area, startLocal, endLocal, limit],
  );
  return rows;
}

const ids = (rows: readonly Row[]): string[] => rows.map((r) => String(r['listing_id']));
const outcomeOf = (rows: readonly Row[]): string | undefined =>
  rows.length === 1 ? String(rows[0]?.['outcome']) : undefined;

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole). */
const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

describe('US-201 — recherche publique par zone, lieu, dates et heures (0103)', () => {
  it.each(byCountry)(
    '%s (%s) : annonce LISTED d’un hôte activable trouvée ; heures dans le fuseau du pays ; zone approximative seule, jamais l’adresse exacte (critères 3 et 4)',
    async (country, currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const a = await car(tx, cc);
        const rows = await search(
          tx,
          country,
          a.city,
          a.area,
          '2036-12-10T10:00',
          '2036-12-12T10:00',
        );
        expect(ids(rows)).toEqual([a.listing]);
        const r = rows[0] ?? {};
        // critère 4 : colonnes C0 seulement ; ni nom, ni adresse, ni point exact du lieu
        expect(Object.keys(r).sort()).toEqual(SEARCH_COLUMNS);
        expect(r['outcome']).toBe('OK');
        expect(r['currency']).toBe(currency);
        expect(r['city']).toBe(a.city);
        expect(r['area_label']).toBe(a.area);
        expect(Number(r['geo_public_lat'])).toBe(8.99);
        expect(Number(r['geo_public_lng'])).toBe(-79.51);
        const flat = JSON.stringify(rows);
        expect(flat).not.toContain('Casa de Ana');
        expect(flat).not.toContain('Calle Larga');
        expect(flat).not.toContain('8.987654');
        expect(flat).not.toContain('79.512345');
        expect(flat).not.toContain(a.org);
        expect(flat).not.toContain(a.vehicle);
        // critère 3 : l'heure locale saisie est celle du fuseau du pays (America/Asuncion au PY)
        expect(r['timezone']).toBe(cc.timezone);
        expect((r['start_at'] as Date).toISOString()).toBe(utcOf(cc, '2036-12-10T10:00'));
        expect((r['end_at'] as Date).toISOString()).toBe(utcOf(cc, '2036-12-12T10:00'));
        // la zone de la ville entière (aucune zone choisie) trouve aussi l'annonce
        expect(
          ids(await search(tx, country, a.city, null, '2036-12-10T10:00', '2036-12-12T10:00')),
        ).toEqual([a.listing]);
        // une autre zone de la même ville, une autre ville, l'autre pays : rien
        expect(
          await search(
            tx,
            country,
            a.city,
            placeName('Barrio'),
            '2036-12-10T10:00',
            '2036-12-12T10:00',
          ),
        ).toEqual([]);
        expect(
          await search(
            tx,
            country,
            placeName('Villa'),
            null,
            '2036-12-10T10:00',
            '2036-12-12T10:00',
          ),
        ).toEqual([]);
        const other = COUNTRIES.find((o) => o.country !== country)?.country ?? '';
        expect(
          await search(tx, other, a.city, null, '2036-12-10T10:00', '2036-12-12T10:00'),
        ).toEqual([]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : refus SEARCH_DATES_INVALID (fin ≤ début le même jour, hors pas de 30 min, début passé), SEARCH_DURATION_EXCEEDED, SEARCH_LOCATION_REQUIRED (critère 1)',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const a = await car(tx, cc);
        const at = (s: string | null, e: string | null) =>
          search(tx, country, a.city, a.area, s, e);
        // critère 1 : début 10:00, fin 09:30 le même jour
        expect(outcomeOf(await at('2036-12-10T10:00', '2036-12-10T09:30'))).toBe(
          'SEARCH_DATES_INVALID',
        );
        expect(outcomeOf(await at('2036-12-10T10:00', '2036-12-10T10:00'))).toBe(
          'SEARCH_DATES_INVALID',
        );
        // pas de 30 min (08 BR-BOOK-03)
        expect(outcomeOf(await at('2036-12-10T10:15', '2036-12-12T10:00'))).toBe(
          'SEARCH_DATES_INVALID',
        );
        expect(outcomeOf(await at('2036-12-10T10:00', '2036-12-12T10:00:30'))).toBe(
          'SEARCH_DATES_INVALID',
        );
        // début passé (16 SRC-001 « début dans le passé → refus »)
        expect(outcomeOf(await at('2020-12-10T10:00', '2020-12-12T10:00'))).toBe(
          'SEARCH_DATES_INVALID',
        );
        expect(outcomeOf(await at(null, '2036-12-12T10:00'))).toBe('SEARCH_DATES_INVALID');
        expect(outcomeOf(await at('infinity', 'infinity'))).toBe('SEARCH_DATES_INVALID');
        // 30 jours tout juste : admis ; 30 jours et 30 min : refusés (16 SRC-001, ADM-031)
        expect(
          ids(await at('2036-12-01T10:00', `2036-12-${String(1 + MAX_TRIP_DAYS)}T10:00`)),
        ).toEqual([a.listing]);
        expect(
          outcomeOf(await at('2036-12-01T10:00', `2036-12-${String(1 + MAX_TRIP_DAYS)}T10:30`)),
        ).toBe('SEARCH_DURATION_EXCEEDED');
        // lieu : pays inconnu, ville absente ou vide
        for (const [p, city] of [
          ['XX', a.city],
          [null, a.city],
          [country, null],
          [country, '  '],
        ] as const) {
          expect(
            outcomeOf(await search(tx, p, city, null, '2036-12-10T10:00', '2036-12-12T10:00')),
          ).toBe('SEARCH_LOCATION_REQUIRED');
        }
        // une issue de refus ne porte aucune donnée d'annonce
        const refused = (await at('2036-12-10T10:00', '2036-12-10T09:30'))[0] ?? {};
        expect(Object.entries(refused).filter(([k, v]) => k !== 'outcome' && v !== null)).toEqual(
          [],
        );
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : paramètres du pays pas encore en vigueur (`max_trip_days`, `buffer_minutes`) ⇒ SEARCH_UNAVAILABLE, sans donnée (fail-closed, ADR-127)',
    async (country) => {
      await withRole('app_api', async (client) => {
        // une seconde avant la plus ancienne entrée en vigueur des deux paramètres dans le pays
        // (graine US-013) : aucune valeur n'est encore en vigueur à cet instant
        const { rows } = await client.query<{ m: Date | null }>(
          `SELECT min(valid_from) AS m FROM core.config_param_value
            WHERE scope_type = 'COUNTRY' AND country_code = $1
              AND key = ANY ('{max_trip_days,buffer_minutes}'::text[])`,
          [country],
        );
        const first = rows[0]?.m;
        if (!(first instanceof Date)) throw new Error('paramètres de recherche absents');
        const before = new Date(first.getTime() - 1000).toISOString();
        const city = placeName('Villa');
        await withTestTransaction(client, { virtualNow: before }, async (tx) => {
          const refused = await search(
            tx,
            country,
            city,
            null,
            '2036-12-10T10:00',
            '2036-12-12T10:00',
          );
          expect(outcomeOf(refused)).toBe('SEARCH_UNAVAILABLE');
          expect(
            Object.entries(refused[0] ?? {}).filter(([k, v]) => k !== 'outcome' && v !== null),
          ).toEqual([]);
        });
        // horloge courante : les paramètres sont en vigueur, la même recherche est valide (vide)
        await withTestTransaction(client, {}, async (tx) => {
          expect(
            await search(tx, country, city, null, '2036-12-10T10:00', '2036-12-12T10:00'),
          ).toEqual([]);
        });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : un créneau occupé (blocage de l’hôte, hold vivant, tampon de 2 h, préavis) écarte le véhicule ; le témoin libre reste',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const area = placeName('Barrio');
        const blocked = await car(tx, cc, { city, area });
        const held = await car(tx, cc, { city, area });
        const free = await car(tx, cc, { city, area });
        // 16 CAL-002 : blocage du 10 au 12 (jours locaux), un voyageur cherche le 11
        const b = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.catalog_cmd_place_host_block($1, $2, $3, $4::timestamp, $5::timestamp)',
          [blocked.hash, blocked.org, blocked.vehicle, '2036-12-10T00:00', '2036-12-13T00:00'],
        );
        expect(b.rows[0]?.outcome).toBe('DONE');
        // hold vivant [11 08:00, 11 18:00 + tampon) posé comme le ferait la commande de pose
        await tx.query(
          `SELECT test_fixture.occ_insert_raw($1, $2, $3, $4, 'HOLD',
                    pg_catalog.tstzrange($5::timestamptz, $6::timestamptz, '[)'))`,
          [
            uuid(),
            held.vehicle,
            held.org,
            country,
            utcOf(cc, '2036-12-11T08:00'),
            new Date(
              Date.parse(utcOf(cc, '2036-12-11T18:00')) + BUFFER_H * 3_600_000,
            ).toISOString(),
          ],
        );
        const day11 = await search(tx, country, city, area, '2036-12-11T10:00', '2036-12-11T16:00');
        expect(ids(day11)).toEqual([free.listing]);
        // le 14 : le blocage est levé, le hold fini ; tous trois disponibles
        const day14 = await search(tx, country, city, area, '2036-12-14T10:00', '2036-12-14T16:00');
        expect(ids(day14).sort()).toEqual([blocked.listing, held.listing, free.listing].sort());
        // BR-BOOK-05 : la période cherchée porte le tampon après sa fin ; 05:00–07:00 occupe le
        // véhicule jusqu'à 09:00 et chevauche le hold qui commence à 08:00
        expect(
          ids(await search(tx, country, city, area, '2036-12-11T05:00', '2036-12-11T07:00')),
        ).toEqual([free.listing]);
        // 21:00–23:00 : après la fin du hold et de son tampon (20:00)
        expect(
          ids(await search(tx, country, city, area, '2036-12-11T21:00', '2036-12-11T23:00')).sort(),
        ).toEqual([held.listing, free.listing].sort());
        // préavis du pays (180 min) : un départ dans l'heure n'est jamais proposé
        const soon = await tx.query<{ s: string; e: string }>(
          `SELECT to_char(pg_catalog.date_trunc('hour', platform.now() AT TIME ZONE $1)
                          + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI') AS s,
                  to_char(pg_catalog.date_trunc('hour', platform.now() AT TIME ZONE $1)
                          + interval '5 hours', 'YYYY-MM-DD"T"HH24:MI') AS e`,
          [cc.timezone],
        );
        const later = await tx.query<{ s: string; e: string }>(
          `SELECT to_char(pg_catalog.date_trunc('hour', platform.now() AT TIME ZONE $1)
                          + interval '5 hours', 'YYYY-MM-DD"T"HH24:MI') AS s,
                  to_char(pg_catalog.date_trunc('hour', platform.now() AT TIME ZONE $1)
                          + interval '9 hours', 'YYYY-MM-DD"T"HH24:MI') AS e`,
          [cc.timezone],
        );
        const s0 = soon.rows[0];
        const l0 = later.rows[0];
        if (!s0 || !l0) throw new Error('horloge illisible');
        expect(await search(tx, country, city, area, s0.s, s0.e)).toEqual([]);
        expect(ids(await search(tx, country, city, area, l0.s, l0.e)).sort()).toEqual(
          [blocked.listing, held.listing, free.listing].sort(),
        );
        // limite : au plus p_limit résultats
        expect(
          await search(tx, country, city, area, '2036-12-14T10:00', '2036-12-14T16:00', 2),
        ).toHaveLength(2);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : seuls les hôtes activables apparaissent : interrupteurs fermés, compte suspendu, titulaire restreint, annonce non publiée, annonce sur demande (REQUEST) ⇒ absents',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const city = placeName('Villa');
        const ok = await car(tx, cc, { city });
        const at = () => search(tx, country, city, null, '2036-12-10T10:00', '2036-12-12T10:00');
        // 17 §0.1 : interrupteurs absents ou false ⇒ recherche vide (production d'aujourd'hui)
        expect(await at()).toEqual([]);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        expect(await at()).toEqual([]);
        await openSwitch(tx, 'insurer_contract_active', country);
        // témoin : pays ouvert, hôte activable
        expect(ids(await at())).toEqual([ok.listing]);
        const suspended = await car(tx, cc, { city });
        await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [
          suspended.org,
          'SUSPENDED',
        ]);
        const restricted = await car(tx, cc, { city });
        await tx.query('SELECT test_fixture.us109_restrict_directly($1, $2)', [
          restricted.userId,
          'POLICY_VIOLATION',
        ]);
        await car(tx, cc, { city, listed: false });
        // réservation sur demande (REQUEST) : écartée tant que le mode est fermé dans le pays
        // (`booking_request_mode_enabled` faux, 0125 ; 19 US-223 DoR 2 ; ouvert : bloc US-223 en
        // fin de fichier, 0154)
        const onRequest = await car(tx, cc, { city, instantBook: false });
        const listed = await tx.query<{ instant_book: boolean }>(
          'SELECT instant_book FROM core.catalog_public_listing($1)',
          [onRequest.listing],
        );
        expect(listed.rows).toEqual([{ instant_book: false }]);
        const unlisted = await car(tx, cc, { city });
        await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          unlisted.listing,
          'UNLISTED',
        ]);
        expect(ids(await at())).toEqual([ok.listing]);
        // zones proposées : la ville et la zone de l'hôte activable seulement
        const areas = await tx.query<Row>('SELECT * FROM core.catalog_public_areas($1)', [country]);
        const mine = areas.rows.filter((r) => r['city'] === city);
        expect(mine).toEqual([
          { country_code: country, city, area_label: ok.area, timezone: cc.timezone },
        ]);
        const all = await tx.query<Row>('SELECT * FROM core.catalog_public_areas(NULL)');
        expect(all.rows.filter((r) => r['city'] === city)).toEqual(mine);
        expect(JSON.stringify(areas.rows)).not.toContain('Calle Larga');
      });
    },
  );

  it('app_worker et app_anon n’exécutent ni la recherche ni la liste des zones (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const [sql, values] of [
          [
            'SELECT * FROM core.catalog_public_search($1, $2, NULL, $3::timestamp, $3::timestamp, NULL)',
            ['PA', 'Ciudad', '2036-12-10T10:00'],
          ],
          ['SELECT * FROM core.catalog_public_areas($1)', ['PA']],
          ['SELECT core.catalog_search_host_open($1, $2)', [uuid(), 'PA']],
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

  it('app_api n’exécute pas les aides internes de la recherche (42501)', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT core.catalog_search_host_open(gen_random_uuid(), $1)',
        `SELECT core.catalog_search_param_int('max_trip_days', $1)`,
      ]) {
        await client.query('BEGIN');
        try {
          await expect(client.query(sql, ['PA']), sql).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });
  });
});

/**
 * US-223 (ouverture du mode sur demande, migration 0154, ADR-175 ; BOARD N-246) : le filtre
 * « réservation immédiate seulement » de 0103 est levé PAR PAYS, seulement quand le checkout
 * accepterait la demande. Attendus tirés de 19 US-223 DoR 2 (mode fermé : une annonce
 * `instant_book = false` n'est ni proposée par la recherche ni réservable), de 22 OQ-P2P-10 (REQUEST
 * au choix de l'hôte, expiration 4 h), de 17 §7.2 (`booking_request_expiry_hours` = 4, PROPOSÉ ;
 * `booking_request_mode_enabled` absent = faux) et de 10b S03 `web.s03.request` (« confirma en hasta
 * {count} horas »), jamais du code testé. Le paramètre n'est ouvert que dans la transaction ANNULÉE
 * du test, par la fixture 9959 (`us223c_set_request_mode`, comme la console de configuration).
 */
describe('US-223 — points d’entrée du mode sur demande (0154)', () => {
  /** 17 §7.2 `booking_request_expiry_hours` (graine 0125, PROPOSÉ ; 22 OQ-P2P-10 : 4 h). */
  const EXPIRY_HOURS = 4;
  const terms = async (c: Tx, country: string): Promise<Row[]> =>
    (await c.query<Row>('SELECT * FROM core.catalog_public_request_terms($1)', [country])).rows;
  const setMode = (c: Tx, country: string, on: boolean) =>
    c.query('SELECT test_fixture.us223c_set_request_mode($1, $2)', [country, on]);

  it.each(byCountry)(
    '%s (%s) : mode fermé ⇒ annonce sur demande absente de la recherche et des zones ; ouvert dans le pays ⇒ présente, délai de 4 h lu ; l’autre pays reste fermé ; refermé ⇒ de nouveau absente',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const instant = await car(tx, cc, { city });
        const onRequest = await car(tx, cc, { city, instantBook: false });
        const other = COUNTRIES.find((x) => x.country !== country)?.country;
        if (other === undefined) throw new Error('second pays de test absent');
        const at = () => search(tx, country, city, null, '2036-12-10T10:00', '2036-12-12T10:00');
        const areasOf = async (): Promise<Row[]> =>
          (await tx.query<Row>('SELECT * FROM core.catalog_public_areas($1)', [country])).rows
            .filter((r) => r['city'] === city)
            .sort((a, b) => String(a['area_label']).localeCompare(String(b['area_label'])));
        const area = (x: Car): Row => ({
          country_code: country,
          city,
          area_label: x.area,
          timezone: cc.timezone,
        });

        // fermé (graine 0125 : faux dans chaque pays) : rien ne change par rapport à 0103
        expect(await terms(tx, country)).toEqual([
          { request_mode_enabled: false, request_expiry_hours: null },
        ]);
        expect(ids(await at())).toEqual([instant.listing]);
        expect(await areasOf()).toEqual([area(instant)]);

        // ouvert dans CE pays : l'annonce sur demande est proposée, avec son mode (instant_book)
        await setMode(tx, country, true);
        expect(await terms(tx, country)).toEqual([
          { request_mode_enabled: true, request_expiry_hours: EXPIRY_HOURS },
        ]);
        const open = await at();
        expect(ids(open).sort()).toEqual([instant.listing, onRequest.listing].sort());
        expect(open.find((r) => r['listing_id'] === onRequest.listing)?.['instant_book']).toBe(
          false,
        );
        expect(await areasOf()).toEqual(
          [area(instant), area(onRequest)].sort((a, b) =>
            String(a['area_label']).localeCompare(String(b['area_label'])),
          ),
        );
        // le réglage est par pays : l'autre pays reste fermé
        expect(await terms(tx, other)).toEqual([
          { request_mode_enabled: false, request_expiry_hours: null },
        ]);

        // refermé (nouvelle version du réglage) : de nouveau écartée
        await setMode(tx, country, false);
        expect(ids(await at())).toEqual([instant.listing]);
        expect(await terms(tx, country)).toEqual([
          { request_mode_enabled: false, request_expiry_hours: null },
        ]);
      });
    },
  );

  it('pays inconnu ou absent ⇒ mode fermé, sans erreur (fail-closed)', async () => {
    await rolledBack(async (tx) => {
      for (const country of ['ZZ', null]) {
        expect(
          (await tx.query<Row>('SELECT * FROM core.catalog_public_request_terms($1)', [country]))
            .rows,
        ).toEqual([{ request_mode_enabled: false, request_expiry_hours: null }]);
      }
    });
  });

  it('app_worker et app_anon n’exécutent pas la lecture du mode ; app_api n’exécute pas son aide interne (42501)', async () => {
    for (const [role, sql] of [
      ['app_worker', 'SELECT * FROM core.catalog_public_request_terms($1)'],
      ['app_anon', 'SELECT * FROM core.catalog_public_request_terms($1)'],
      ['app_api', 'SELECT core.catalog_request_mode_hours($1)'],
    ] as const) {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          await expect(client.query(sql, ['PA']), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });
});
