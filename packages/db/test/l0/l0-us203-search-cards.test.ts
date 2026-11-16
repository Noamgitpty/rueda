/**
 * Preuves des cartes de résultats de la recherche publique (US-203, migration 0105) sous le rôle
 * de production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD (PA) et en
 * PYG (PY). Chaque test crée ses propres personnes, sessions, comptes d'hôte, lieux, véhicules et
 * annonces par les VRAIES commandes (US-107, US-115), dans une transaction ANNULÉE ; les
 * interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` n'y sont ouverts que par
 * la vraie procédure à deux personnes d'US-125, et rien ne survit au test.
 *
 * Attendus tirés de 19 US-203 (« un véhicule réservé sur le créneau n'apparaît pas » ; « le
 * montant de la caution par carte de la plateforme (`deposit_policy` du pays et de la classe) est
 * affiché » ; liste et carte montrent les mêmes véhicules), de 16 SRC-011 (caution affichée si la
 * classe ou le pays l'impose, sinon mention générique ; ni adresse exacte ni nom de famille), de
 * 08 BR-PAY-06 et T70 c (avant le checkout, seuls `COUNTRY` et `CLASS` sont évalués ; montants =
 * valeurs de test du mécanisme : `LUXE` 300,00 au PA), de 17 §3.2.3 (`deposit_policy`), §6.7
 * (« Recherche (liste + carte, une ville) p95 < 800 ms côté serveur ») et du pré-mortem du lot 2
 * (L2-PM-09, L2-PM-29, L2-PM-32), jamais du code testé.
 *
 * Fuseaux (donnée IANA, pas une constante du code) : America/Panama = UTC−5 toute l'année ;
 * America/Asuncion = UTC−3 en décembre : les dates de test sont en décembre, loin dans le futur.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { placeName } from '../support/names.ts';
import {
  benchPgVersion,
  recordPerf,
  SMOKE_SAMPLES,
  SMOKE_WARMUP,
  summarize,
  timed,
} from '../support/perf.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** Décalage UTC de décembre du fuseau du pays, en heures (donnée IANA, voir l'en-tête). */
const DECEMBER_OFFSET_H: Readonly<Record<string, number>> = { PA: -5, PY: -3 };
/** 17 §7.2 `buffer_minutes` (graine US-013) : tampon de 2 h après la fin d'un trip. */
const BUFFER_H = 2;
/** Exposant de la devise du pays (17 §7.1 : USD 2, PYG 0), donnée de test de la spécification. */
const EXPONENT: Readonly<Record<string, number>> = { USD: 2, PYG: 0 };
/** Colonnes de la recherche d'US-201 (0103), reprises telles quelles. */
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
/** Colonnes des cartes : celles d'US-201, plus la caution et l'instant du devis (0105). */
const CARD_COLUMNS = [...SEARCH_COLUMNS, 'deposit_amount_minor', 'quoted_at'].sort();

/** Montant en unités mineures d'un montant en unités majeures de 08 (valeur de test). */
const minorOf = (c: CountryCase, major: number): string => {
  const e = EXPONENT[c.currency];
  if (e === undefined) throw new Error(`devise de test sans exposant : ${c.currency}`);
  return String(BigInt(major) * 10n ** BigInt(e));
};

/** Instant UTC d'une heure locale de décembre du pays (donnée IANA de l'en-tête). */
function utcOf(c: CountryCase, local: string): string {
  const offset = DECEMBER_OFFSET_H[c.country];
  if (offset === undefined) throw new Error(`pays de test sans décalage : ${c.country}`);
  return new Date(Date.parse(`${local}:00.000Z`) - offset * 3_600_000).toISOString();
}

interface Car {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly vehicle: string;
  readonly listing: string;
  readonly city: string;
  readonly area: string;
}

async function session(c: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Hôte activable (compte ACTIVE), lieu épinglé, véhicule et annonce publiée (US-115). */
async function car(
  c: Tx,
  cc: CountryCase,
  options: { readonly city: string; readonly area: string; readonly valueClass?: string | null },
): Promise<Car> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `s203-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      randomBytes(32),
      cc.country,
      DOCS,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const hash = await session(c, userId);
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, cc.country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const loc = await c.query<{ outcome: string; location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      hash,
      org,
      'HOME',
      'Casa de Ana',
      'Calle Larga',
      options.city,
      options.area,
      '8.987654',
      '-79.512345',
    ],
  );
  if (loc.rows[0]?.outcome !== 'DONE') throw new Error(`lieu refusé : ${loc.rows[0]?.outcome}`);
  const veh = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [hash, org, loc.rows[0]?.location_id, `C${randomBytes(4).toString('hex').toUpperCase()}`],
  );
  const vehicle = veh.rows[0]?.vehicle_id;
  if (!vehicle) throw new Error(`véhicule refusé : ${veh.rows[0]?.outcome}`);
  if (options.valueClass !== undefined) {
    await c.query('SELECT test_fixture.us108_set_value_class($1, $2)', [
      vehicle,
      options.valueClass,
    ]);
  }
  const lst = await c.query<{ listing_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, NULL, NULL, NULL)',
    [hash, org, vehicle, 40 * cc.priceStepMinor * 100, 'UNLIMITED'],
  );
  const listing = lst.rows[0]?.listing_id;
  if (!listing) throw new Error('annonce refusée');
  await c.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [listing, 'LISTED']);
  return { userId, hash, org, vehicle, listing, city: options.city, area: options.area };
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

async function cards(
  c: Tx,
  country: string,
  city: string,
  area: string | null,
  startLocal: string,
  endLocal: string,
  limit: number | null = null,
): Promise<Row[]> {
  const { rows } = await c.query<Row>(
    `SELECT * FROM core.catalog_public_cards($1, $2, $3, $4::timestamp, $5::timestamp, $6)`,
    [country, city, area, startLocal, endLocal, limit],
  );
  return rows;
}

async function search(
  c: Tx,
  country: string,
  city: string,
  area: string | null,
  startLocal: string,
  endLocal: string,
): Promise<Row[]> {
  const { rows } = await c.query<Row>(
    `SELECT * FROM core.catalog_public_search($1, $2, $3, $4::timestamp, $5::timestamp, NULL)`,
    [country, city, area, startLocal, endLocal],
  );
  return rows;
}

const ids = (rows: readonly Row[]): string[] => rows.map((r) => String(r['listing_id']));
const depositOf = (rows: readonly Row[], listing: string): string | null => {
  const v = rows.find((r) => r['listing_id'] === listing)?.['deposit_amount_minor'];
  return v === null || v === undefined ? null : String(v);
};

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole). */
const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

const START = '2036-12-10T10:00';
const END = '2036-12-13T10:00';

describe('US-203 — cartes des résultats de la recherche publique (0105)', () => {
  it.each(byCountry)(
    '%s (%s) : mêmes annonces, même ordre et mêmes colonnes C0 que la recherche d’US-201, plus la caution et l’instant du devis (platform.now())',
    async (country, currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const area = placeName('Barrio');
        const cars = [
          await car(tx, cc, { city, area }),
          await car(tx, cc, { city, area }),
          await car(tx, cc, { city, area }),
        ];
        const before = await tx.query<{ now: Date }>('SELECT platform.now() AS now');
        const got = await cards(tx, country, city, area, START, END);
        const base = await search(tx, country, city, area, START, END);
        expect(ids(got)).toEqual(ids(base));
        expect(ids(got).sort()).toEqual(cars.map((x) => x.listing).sort());
        const after = await tx.query<{ now: Date }>('SELECT platform.now() AS now');
        const [t0, t1] = [
          before.rows[0]?.now.getTime() ?? NaN,
          after.rows[0]?.now.getTime() ?? NaN,
        ];
        for (const [i, r] of got.entries()) {
          expect(Object.keys(r).sort()).toEqual(CARD_COLUMNS);
          // colonnes d'US-201 identiques, une à une
          for (const k of SEARCH_COLUMNS) expect(r[k], k).toEqual(base[i]?.[k]);
          expect(r['currency']).toBe(currency);
          // horloge de la base (platform.now() suit l'horloge réelle hors horloge virtuelle) :
          // l'instant du devis est lu pendant l'appel, entre deux lectures de platform.now()
          const q = (r['quoted_at'] as Date).getTime();
          expect(q).toBeGreaterThanOrEqual(t0);
          expect(q).toBeLessThanOrEqual(t1);
        }
        // critère 4 d'US-201 maintenu : ni nom, ni adresse, ni point exact, ni compte d'hôte
        const flat = JSON.stringify(got);
        for (const secret of ['Casa de Ana', 'Calle Larga', '8.987654', '79.512345', 'Pérez']) {
          expect(flat).not.toContain(secret);
        }
        for (const x of cars) {
          expect(flat).not.toContain(x.org);
          expect(flat).not.toContain(x.vehicle);
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : caution de la plateforme du pays et de la classe affichée (LUXE) ; sans politique, classe inconnue, montant nul ou autre devise ⇒ aucun montant (mention générique) ; la version en vigueur fait foi (T70 c)',
    async (country, currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const area = placeName('Barrio');
        const luxe = await car(tx, cc, { city, area, valueClass: 'LUXE' });
        const premium = await car(tx, cc, { city, area, valueClass: 'PREMIUM' });
        const standard = await car(tx, cc, { city, area, valueClass: 'STANDARD' });
        const unknown = await car(tx, cc, { city, area, valueClass: null });
        // aucune politique (production d'aujourd'hui, avant J-ADM-031) : aucun montant
        let got = await cards(tx, country, city, area, START, END);
        expect(got).toHaveLength(4);
        for (const r of got) expect(r['deposit_amount_minor']).toBeNull();
        // 08 T70 c : LUXE ⇒ montant `deposit_amount[pays][LUXE]` (300,00, valeur de test) ;
        // version plus ancienne (200,00) supplantée par la version en vigueur
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4, $5)', [
          country,
          'LUXE',
          minorOf(cc, 200),
          currency,
          '2020-01-01T00:00:00Z',
        ]);
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4)', [
          country,
          'LUXE',
          minorOf(cc, 300),
          currency,
        ]);
        // version future (pas encore en vigueur) : sans effet
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4, $5)', [
          country,
          'LUXE',
          minorOf(cc, 900),
          currency,
          '2099-01-01T00:00:00Z',
        ]);
        // STANDARD : montant nul ⇒ aucun montant ; PREMIUM : autre devise ⇒ aucun montant
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4)', [
          country,
          'STANDARD',
          '0',
          currency,
        ]);
        const other = COUNTRIES.find((o) => o.currency !== currency)?.currency ?? '';
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4)', [
          country,
          'PREMIUM',
          minorOf(cc, 300),
          other,
        ]);
        // politique d'un autre pays pour la même classe : sans effet ici
        const otherCountry = COUNTRIES.find((o) => o.country !== country)?.country ?? '';
        await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3, $4)', [
          otherCountry,
          'PREMIUM',
          minorOf(cc, 400),
          currency,
        ]);
        got = await cards(tx, country, city, area, START, END);
        expect(depositOf(got, luxe.listing)).toBe(minorOf(cc, 300));
        expect(depositOf(got, premium.listing)).toBeNull();
        expect(depositOf(got, standard.listing)).toBeNull();
        expect(depositOf(got, unknown.listing)).toBeNull();
        // la classe n'est jamais rendue (le voyageur ne voit que le montant, BR-PAY-06)
        const flat = JSON.stringify(got);
        for (const k of ['LUXE', 'PREMIUM', 'STANDARD']) expect(flat).not.toContain(k);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : un véhicule réservé (trip confirmé) ou tenu par un hold sur le créneau n’apparaît pas ; hors créneau (tampon compris), il revient (critère 2, L2-PM-09)',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const area = placeName('Barrio');
        const booked = await car(tx, cc, { city, area });
        const held = await car(tx, cc, { city, area });
        const free = await car(tx, cc, { city, area });
        // trip confirmé [11 08:00, 12 08:00 + tampon) ; hold vivant [11 12:00, 11 18:00 + tampon)
        await tx.query(
          `SELECT test_fixture.us203_trip_occupancy($1, $2, $3,
                    pg_catalog.tstzrange($4::timestamptz, $5::timestamptz, '[)'))`,
          [
            booked.vehicle,
            booked.org,
            country,
            utcOf(cc, '2036-12-11T08:00'),
            new Date(
              Date.parse(utcOf(cc, '2036-12-12T08:00')) + BUFFER_H * 3_600_000,
            ).toISOString(),
          ],
        );
        await tx.query(
          `SELECT test_fixture.occ_insert_raw($1, $2, $3, $4, 'HOLD',
                    pg_catalog.tstzrange($5::timestamptz, $6::timestamptz, '[)'))`,
          [
            uuid(),
            held.vehicle,
            held.org,
            country,
            utcOf(cc, '2036-12-11T12:00'),
            new Date(
              Date.parse(utcOf(cc, '2036-12-11T18:00')) + BUFFER_H * 3_600_000,
            ).toISOString(),
          ],
        );
        expect(
          ids(await cards(tx, country, city, area, '2036-12-11T10:00', '2036-12-11T16:00')),
        ).toEqual([free.listing]);
        // le trip chevauche seul : le hold est fini à 20:00
        expect(
          ids(await cards(tx, country, city, area, '2036-12-12T06:00', '2036-12-12T09:00')).sort(),
        ).toEqual([held.listing, free.listing].sort());
        // après le trip et son tampon (12 10:00) : les trois
        expect(
          ids(await cards(tx, country, city, area, '2036-12-12T10:00', '2036-12-12T16:00')).sort(),
        ).toEqual([booked.listing, held.listing, free.listing].sort());
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : refus d’US-201 rendus tels quels (une ligne d’issue, aucune donnée)',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const a = await car(tx, cc, { city: placeName('Villa'), area: placeName('Barrio') });
        const refused = await cards(
          tx,
          country,
          a.city,
          a.area,
          '2036-12-10T10:00',
          '2036-12-10T09:30',
        );
        expect(refused).toHaveLength(1);
        expect(refused[0]?.['outcome']).toBe('SEARCH_DATES_INVALID');
        expect(refused[0]?.['listing_id']).toBeNull();
        expect(refused[0]?.['deposit_amount_minor']).toBeNull();
        const nowhere = await cards(tx, 'ZZ', a.city, null, START, END);
        expect(nowhere.map((r) => r['outcome'])).toEqual(['SEARCH_LOCATION_REQUIRED']);
      });
    },
  );

  it('app_worker et app_anon n’exécutent pas les cartes ; app_api n’écrit ni ne lit la caution en direct (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          await expect(
            client.query(
              'SELECT * FROM core.catalog_public_cards($1, $2, NULL, $3::timestamp, $3::timestamp, NULL)',
              ['PA', 'Ciudad', '2036-12-10T10:00'],
            ),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT * FROM core.catalog_deposit_policy',
        `INSERT INTO core.catalog_deposit_policy (id, country_code, value_class, amount_minor,
                currency, accepted_methods, covered_items)
         VALUES (gen_random_uuid(), 'PA', 'LUXE', 1, 'USD', '{CARD_PREAUTH}', '{}')`,
      ]) {
        await client.query('BEGIN');
        try {
          await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });
  });
});

// US-045 / US-203 : performance de fumée de la recherche (17 §6.7 « Recherche (liste + carte, une
// ville) p95 < 800 ms côté serveur », ADR-119, ADR-131) : cartes d'une ville de 12 annonces libres,
// sonde de disponibilité comprise ; durée consignée, alerte au tableau de bord QA au-delà de la
// cible ; le contenu lu est vérifié à chaque appel (L2-PM-32, BOARD N-16).
describe('US-203 — fumée de performance : cartes des résultats d’une ville', () => {
  const LISTINGS = 12;
  it.each(byCountry)(
    '%s (%s) : 12 annonces libres, p95 consigné, contenu exact à chaque lecture',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await openCountry(tx, country);
        const city = placeName('Villa');
        const area = placeName('Barrio');
        for (let i = 0; i < LISTINGS; i += 1) await car(tx, cc, { city, area });
        const ms: number[] = [];
        for (let i = 0; i < SMOKE_WARMUP + SMOKE_SAMPLES; i += 1) {
          const { value, ms: d } = await timed(() => cards(tx, country, city, null, START, END));
          expect(value).toHaveLength(LISTINGS);
          if (i >= SMOKE_WARMUP) ms.push(d);
        }
        const record = recordPerf({
          series: 'recherche.sequentielle',
          country,
          summary: summarize(ms),
          pgVersion: await benchPgVersion(),
          details: { warmup: SMOKE_WARMUP, listings: LISTINGS, calls: 1 },
        });
        expect(record.n).toBe(SMOKE_SAMPLES);
      });
    },
    180_000,
  );
});
