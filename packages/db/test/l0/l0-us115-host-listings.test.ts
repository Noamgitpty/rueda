/**
 * Preuves des lieux de remise, véhicules et annonces de l'hôte (US-115, migrations 0067 et 0068 ;
 * fixtures 9985) sous le rôle de production app_api (assertion L0-05 en tête de chaque connexion,
 * withRole), en USD (PA) et en PYG (PY). Chaque test crée ses propres personnes, sessions, comptes
 * d'hôte, lieux, véhicules et annonces par les VRAIES commandes.
 *
 * Attendus tirés de 19 US-115 (critères), de 16 HST-011 / HST-005 / HST-012 / PRC-001 / HST-033
 * (codes d'erreur), de 17 §3.2.3 (entités, « geo exacte servie après réservation ; geo_public
 * approximative »), §7.2 (`pyg_price_step` : 1 000 au PY, sans objet au PA), de 08 BR-LIST-05
 * (au moins 6 photos, `listing_min_photos`), SM-2, d'OQ-P2P-05, du BOARD (N-03, N-37) et du
 * pré-mortem du lot 1 (L1-PM-11, L1-PM-19, L1-PM-20), jamais du code testé :
 * - critère 1 : plaque ou VIN déjà enregistrés ⇒ VEHICLE_PLATE_DUPLICATE (casse, espaces, tirets,
 *   pays croisé pour le VIN ; création concurrente) ;
 * - critère 2 : moins de photos que le minimum ⇒ PHOTO_MIN_COUNT et l'annonce reste DRAFT ;
 * - critère 3 : un trip confirmé garde son prix quand l'hôte change le prix ; prix PYG au pas ;
 * - critère 4 : un visiteur ne voit que la zone approximative du lieu de remise ;
 * - N-37 : compte d'hôte non ACTIVE ⇒ HOST_NOT_ACTIVATED à la soumission (et pays fermé) ;
 * - réserve de la revue d'US-113 : variante d'un autre marché refusée ;
 * - L1-PM-11 : IDOR de l'hôte A contre l'hôte B (lecture, écriture, commandes) dans chaque pays ;
 * - N-03 / F-RLS-01 : clé étrangère du véhicule et gardes de blocage sur la VRAIE table.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const NAME = 'Casa de Ana';
const ADDRESS = 'Calle 50, edificio Sol, apto 12';
const CITY = 'Ciudad Uno';
const AREA = 'Barrio Norte';
// point exact de l'épingle (données fictives) et son arrondi au centième attendu (ADR-099)
const LAT = 8.983712;
const LNG = -79.519843;

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
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
    [userId, `host-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  return { userId, hash: await session(client, userId) };
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

/** Hôte : personne, compte d'hôte ouvert en libre-service (ONBOARDING) ; statut forcé au besoin. */
async function host(client: pg.ClientBase, country: string, status?: string): Promise<Host> {
  const p = await person(client, country);
  return { ...p, org: await openAccount(client, p.hash, country, status) };
}

async function openAccount(
  client: pg.ClientBase,
  hash: Buffer,
  country: string,
  status?: string,
): Promise<string> {
  const { rows } = await client.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  if (status !== undefined) {
    await client.query('SELECT test_fixture.us115_set_org_status($1, $2)', [
      rows[0].org_id,
      status,
    ]);
  }
  return rows[0].org_id;
}

interface Outcome {
  readonly outcome: string;
  readonly id: string | null;
}

async function location(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  over: { kind?: string; lat?: number | null; lng?: number | null; label?: string } = {},
): Promise<Outcome> {
  const { rows } = await client.query<{ outcome: string; location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      h.hash,
      h.org,
      over.kind ?? 'HOME',
      over.label ?? NAME,
      ADDRESS,
      CITY,
      AREA,
      over.lat === undefined ? LAT : over.lat,
      over.lng === undefined ? LNG : over.lng,
    ],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.location_id ?? null };
}

interface VehicleInput {
  readonly plate: string;
  readonly vin?: string | null;
  readonly variantId?: string | null;
  readonly year?: number;
  readonly make?: string | null;
  readonly model?: string | null;
}

async function vehicle(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  locationId: string | null,
  v: VehicleInput,
): Promise<Outcome> {
  const fallback = v.variantId === undefined || v.variantId === null;
  const { rows } = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'AUTOMATIC', 5::smallint, 'GASOLINE', 42000,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      locationId,
      v.plate,
      v.vin ?? null,
      v.variantId ?? null,
      fallback ? (v.make === undefined ? 'Marca' : v.make) : null,
      fallback ? (v.model === undefined ? 'Modelo' : v.model) : null,
      v.year ?? 2021,
    ],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.vehicle_id ?? null };
}

async function listing(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  vehicleId: string | null,
  price: number | string,
  mileage: { mode: string; km?: number | null; extra?: number | string | null } = {
    mode: 'UNLIMITED',
  },
  instant: boolean | null = null,
): Promise<Outcome> {
  const { rows } = await client.query<{ outcome: string; listing_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      h.hash,
      h.org,
      vehicleId,
      price,
      mileage.mode,
      mileage.km ?? null,
      mileage.extra ?? null,
      instant,
    ],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.listing_id ?? null };
}

async function pricing(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  listingId: string,
  price: number | string,
  mileage: { mode: string; km?: number | null; extra?: number | string | null } = {
    mode: 'UNLIMITED',
  },
): Promise<string> {
  const { rows } = await client.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_update_listing_pricing($1, $2, $3, $4, $5, $6, $7)',
    [h.hash, h.org, listingId, price, mileage.mode, mileage.km ?? null, mileage.extra ?? null],
  );
  return rows[0]?.outcome ?? '';
}

async function photo(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string },
  listingId: string,
  mime = 'image/jpeg',
): Promise<{ outcome: string; photo_id: string | null; storage_key: string | null }> {
  const { rows } = await client.query<{
    outcome: string;
    photo_id: string | null;
    storage_key: string | null;
  }>('SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)', [
    h.hash,
    h.org,
    listingId,
    uuid(),
    uuid(),
    mime,
    123_456,
    randomBytes(32),
  ]);
  return rows[0] ?? { outcome: '', photo_id: null, storage_key: null };
}

async function submit(client: pg.ClientBase, h: { hash: Buffer; org: string }, id: string) {
  const { rows } = await client.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
    [h.hash, h.org, id],
  );
  return rows[0]?.outcome ?? '';
}

async function remove(client: pg.ClientBase, h: { hash: Buffer; org: string }, id: string) {
  const { rows } = await client.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_delete_listing($1, $2, $3)',
    [h.hash, h.org, id],
  );
  return rows[0]?.outcome ?? '';
}

async function listingRow(client: pg.ClientBase, id: string) {
  const { rows } = await client.query<{
    status: string;
    daily_price_minor: string;
    currency: string;
    country_code: string;
    submitted_at: Date | null;
  }>('SELECT * FROM test_fixture.us115_listing_row($1)', [id]);
  return rows[0];
}

/** Plaque unique de test (2 à 12 caractères A-Z0-9 une fois normalisée). */
const plate = (): string => `Q${randomBytes(4).toString('hex').toUpperCase()}`;
/** VIN ISO 3779 de test (17 caractères, ni I, O ni Q). */
const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};

/** Variante ACTIVE de la graine, commune aux pays (market nul), et une année de production. */
async function commonVariant(client: pg.ClientBase): Promise<{ id: string; year: number }> {
  const { rows } = await client.query<{ id: string; year_from: number }>(
    `SELECT v.id, v.year_from
       FROM core.catalog_vehicle_variant v
       JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
       JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
      WHERE v.status = 'ACTIVE' AND v.market IS NULL
      ORDER BY v.id LIMIT 1`,
  );
  if (!rows[0]) throw new Error('graine du catalogue vide');
  return { id: rows[0].id, year: rows[0].year_from };
}

/** Hôte complet : compte, lieu, véhicule (hors catalogue), annonce DRAFT au prix donné. */
async function draft(
  client: pg.ClientBase,
  c: CountryCase,
  price: number,
  status?: string,
): Promise<Host & { location: string; vehicle: string; listing: string }> {
  const h = await host(client, c.country, status);
  const loc = await location(client, h);
  const veh = await vehicle(client, h, loc.id, { plate: plate() });
  const lst = await listing(client, h, veh.id, price);
  if (!loc.id || !veh.id || !lst.id)
    throw new Error(`préparation : ${loc.outcome} ${veh.outcome} ${lst.outcome}`);
  return { ...h, location: loc.id, vehicle: veh.id, listing: lst.id };
}

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** Prix journalier valable dans chaque pays : multiple du pas du pays (17 §7.2). */
const priceOf = (c: CountryCase, units: number): number => units * c.priceStepMinor;

const TABLES = [
  'catalog_deposit_policy',
  'catalog_listing',
  'catalog_listing_photo',
  'catalog_location',
  'catalog_vehicle',
] as const;

// ---------------------------------------------------------------------------------------------
describe('socle (0067) : RLS, droits, propriétaires', () => {
  it('cinq tables : RLS ENABLE + FORCE, propriétaire migrator, politiques des seuls propriétaires NOLOGIN', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          relname: string;
          rls: boolean;
          force: boolean;
          owner: string;
          policies: string[];
        }>(
          `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                  ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                                 SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                                   FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',')
                          FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'core' AND c.relname = ANY ($1::text[])
            ORDER BY c.relname`,
          [[...TABLES]],
        );
        expect(rows.map((r) => r.relname)).toEqual([...TABLES]);
        const expected: Record<(typeof TABLES)[number], string[]> = {
          catalog_deposit_policy: ['migrator_all:migrator'],
          catalog_listing: [
            'catalog_cmd_all:catalog_cmd_owner',
            'cmd_hold_read:cmd_hold_owner',
            'migrator_all:migrator',
          ],
          catalog_listing_photo: ['catalog_cmd_all:catalog_cmd_owner', 'migrator_all:migrator'],
          catalog_location: ['catalog_cmd_all:catalog_cmd_owner', 'migrator_all:migrator'],
          catalog_vehicle: [
            'catalog_cmd_all:catalog_cmd_owner',
            'cmd_hold_read:cmd_hold_owner',
            'migrator_all:migrator',
            'policy_fn_read:policy_fn_owner',
          ],
        };
        for (const r of rows) {
          expect(r, r.relname).toMatchObject({ rls: true, force: true, owner: 'migrator' });
          expect(r.policies, r.relname).toEqual(expected[r.relname as (typeof TABLES)[number]]);
        }
      },
      { database: 'production' },
    );
  });

  it('aucun droit d’app_api, d’app_worker ni d’app_anon sur ces tables (lecture et écriture : 42501)', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        const grants = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM pg_catalog.pg_class c
             CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
            WHERE c.relnamespace = 'core'::regnamespace AND c.relname = ANY ($1::text[])
              AND (x.grantee = 0 OR pg_catalog.pg_get_userbyid(x.grantee) IN ('app_api', 'app_worker', 'app_anon'))`,
          [[...TABLES]],
        );
        expect(grants.rows[0]?.n, role).toBe(0);
        for (const t of TABLES) {
          await client.query('BEGIN');
          try {
            await expect(
              client.query(`SELECT id FROM core.${t}`),
              `${role} ${t}`,
            ).rejects.toMatchObject({
              code: '42501',
            });
          } finally {
            await client.query('ROLLBACK');
          }
          await client.query('BEGIN');
          try {
            await expect(
              client.query(`INSERT INTO core.${t} (id) VALUES (gen_random_uuid())`),
              `${role} ${t}`,
            ).rejects.toMatchObject({ code: '42501' });
          } finally {
            await client.query('ROLLBACK');
          }
        }
      });
    }
  });

  it('N-03 : clés étrangères (vehicle_id, org_id, country_code) vers catalog_vehicle sur l’occupation, le hold et le trip, validées (base de production)', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          rel: string;
          name: string;
          frel: string;
          def: string;
          validated: boolean;
        }>(
          `SELECT c.conrelid::regclass::text AS rel, c.conname AS name,
                  c.confrelid::regclass::text AS frel, pg_catalog.pg_get_constraintdef(c.oid) AS def,
                  c.convalidated AS validated
             FROM pg_catalog.pg_constraint c
            WHERE c.contype = 'f' AND c.conname IN ('occupancy_catalog_vehicle_fk',
                  'checkout_hold_catalog_vehicle_fk', 'trip_catalog_vehicle_fk', 'trip_catalog_listing_fk')
            ORDER BY c.conname`,
        );
        const party =
          'FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)';
        expect(rows).toEqual([
          {
            rel: 'core.booking_checkout_hold',
            name: 'checkout_hold_catalog_vehicle_fk',
            frel: 'core.catalog_vehicle',
            def: party,
            validated: true,
          },
          {
            rel: 'core.booking_vehicle_occupancy',
            name: 'occupancy_catalog_vehicle_fk',
            frel: 'core.catalog_vehicle',
            def: party,
            validated: true,
          },
          {
            rel: 'core.booking_trip',
            name: 'trip_catalog_listing_fk',
            frel: 'core.catalog_listing',
            def: 'FOREIGN KEY (listing_id) REFERENCES core.catalog_listing(id)',
            validated: true,
          },
          {
            rel: 'core.booking_trip',
            name: 'trip_catalog_vehicle_fk',
            frel: 'core.catalog_vehicle',
            def: party,
            validated: true,
          },
        ]);
      },
      { database: 'production' },
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('critère 1 — plaque ou VIN déjà enregistrés : VEHICLE_PLATE_DUPLICATE (L1-PM-20)', () => {
  it.each(byCountry)(
    '%s (%s) : même plaque (casse, espaces, tirets, points) chez un autre hôte du pays, même VIN partout ; homoglyphe refusé ; création concurrente',
    async (_country, _currency, c) => {
      const other = COUNTRIES.find((k) => k.country !== c.country);
      if (!other) throw new Error('second pays');
      await withRole('app_api', async (client) => {
        const a = await host(client, c.country);
        const b = await host(client, c.country);
        const z = await host(client, other.country);
        const la = (await location(client, a)).id;
        const lb = (await location(client, b)).id;
        const lz = (await location(client, z)).id;
        const p = `ab${randomBytes(3).toString('hex')}`;
        const v = vin();
        const first = await vehicle(client, a, la, { plate: p, vin: v.toLowerCase() });
        expect(first.outcome).toBe('DONE');
        // stockés normalisés (17 §3.2.3 UQ (country_code, plate))
        const row = await client.query<{ plate: string; vin: string; country_code: string }>(
          'SELECT plate, vin, country_code FROM test_fixture.us115_vehicle_row($1)',
          [first.id],
        );
        expect(row.rows[0]).toEqual({ plate: p.toUpperCase(), vin: v, country_code: c.country });
        for (const variant of [
          p.toUpperCase(),
          ` ${p.slice(0, 2)}-${p.slice(2)} `,
          `${p.slice(0, 2)}.${p.slice(2)}`,
        ]) {
          expect((await vehicle(client, b, lb, { plate: variant })).outcome, variant).toBe(
            'VEHICLE_PLATE_DUPLICATE',
          );
        }
        // même hôte : même refus (une voiture, une annonce)
        expect((await vehicle(client, a, la, { plate: p })).outcome).toBe(
          'VEHICLE_PLATE_DUPLICATE',
        );
        // VIN : unique dans tous les pays (un même véhicule physique), espaces et casse compris
        expect(
          (await vehicle(client, z, lz, { plate: plate(), vin: `${v.slice(0, 8)} ${v.slice(8)}` }))
            .outcome,
        ).toBe('VEHICLE_PLATE_DUPLICATE');
        // la même plaque dans l'autre pays est une autre voiture (UQ par pays)
        expect((await vehicle(client, z, lz, { plate: p })).outcome).toBe('DONE');
        // caractère étranger (homoglyphe cyrillique « А ») : refusé, jamais retiré en silence
        expect((await vehicle(client, b, lb, { plate: `А${p.slice(1)}` })).outcome).toBe(
          'VEHICLE_FIELD_REQUIRED',
        );
        // VIN mal formé (I, O, Q interdits par ISO 3779) pour un véhicule récent
        expect(
          (await vehicle(client, b, lb, { plate: plate(), vin: 'IOQ45678901234567' })).outcome,
        ).toBe('VEHICLE_FIELD_REQUIRED');
      });
      // deux créations concurrentes de la même plaque : une seule réussit
      await withRole('app_api', async (x) => {
        await withRole('app_api', async (y) => {
          const a = await host(x, c.country);
          const b = await host(y, c.country);
          const la = (await location(x, a)).id;
          const lb = (await location(y, b)).id;
          const p = plate();
          const [r1, r2] = await Promise.all([
            vehicle(x, a, la, { plate: p }),
            vehicle(y, b, lb, { plate: p }),
          ]);
          expect([r1.outcome, r2.outcome].sort()).toEqual(['DONE', 'VEHICLE_PLATE_DUPLICATE']);
        });
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('variante du catalogue : statut et marché du compte d’hôte (ADR-094, réserve de la revue d’US-113)', () => {
  it.each(byCountry)(
    '%s (%s) : variante commune acceptée (classe de valeur reprise) ; variante d’un autre marché ⇒ CATALOG_VARIANT_NOT_FOUND ; année hors production ⇒ CATALOG_VARIANT_NOT_FOUND ; repli texte avec variante ⇒ VEHICLE_FIELD_REQUIRED',
    async (_country, _currency, c) => {
      const other = COUNTRIES.find((k) => k.country !== c.country);
      if (!other) throw new Error('second pays');
      await withRole('app_api', async (client) => {
        const h = await host(client, c.country);
        const loc = (await location(client, h)).id;
        const common = await commonVariant(client);
        const ok = await vehicle(client, h, loc, {
          plate: plate(),
          variantId: common.id,
          year: common.year,
        });
        expect(ok.outcome).toBe('DONE');
        const row = await client.query<{
          variant_id: string;
          plate_category: string;
          eligibility_status: string;
        }>(
          'SELECT variant_id, plate_category, eligibility_status FROM test_fixture.us115_vehicle_row($1)',
          [ok.id],
        );
        // particulier seulement (DEC-FONDATEUR-13) ; éligibilité à l'assureur : US-124
        expect(row.rows[0]).toEqual({
          variant_id: common.id,
          plate_category: 'PARTICULAR',
          eligibility_status: 'PENDING',
        });
        expect(
          (
            await vehicle(client, h, loc, {
              plate: plate(),
              variantId: common.id,
              year: common.year - 1,
            })
          ).outcome,
        ).toBe('CATALOG_VARIANT_NOT_FOUND');
        expect((await vehicle(client, h, loc, { plate: plate(), variantId: uuid() })).outcome).toBe(
          'CATALOG_VARIANT_NOT_FOUND',
        );
        // variantes propres à un marché, créées dans une transaction annulée (aucune trace)
        await withTestTransaction(client, {}, async (tx) => {
          const mine = await tx.query<{ variant_id: string; year_from: number }>(
            'SELECT * FROM test_fixture.us115_market_variant($1)',
            [c.country],
          );
          const theirs = await tx.query<{ variant_id: string; year_from: number }>(
            'SELECT * FROM test_fixture.us115_market_variant($1)',
            [other.country],
          );
          const m = mine.rows[0];
          const t = theirs.rows[0];
          if (!m || !t) throw new Error('variantes de marché');
          expect(
            (
              await vehicle(tx, h, loc, {
                plate: plate(),
                variantId: m.variant_id,
                year: m.year_from,
              })
            ).outcome,
          ).toBe('DONE');
          expect(
            (
              await vehicle(tx, h, loc, {
                plate: plate(),
                variantId: t.variant_id,
                year: t.year_from,
              })
            ).outcome,
          ).toBe('CATALOG_VARIANT_NOT_FOUND');
        });
        // une variante ET un repli texte : refusé (17 §3.2.3, repli seulement sans variante)
        const both = await client.query<{ outcome: string }>(
          `SELECT outcome FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, $5, 'Marca', 'Modelo',
                  $6, NULL, 'MANUAL', 5::smallint, 'DIESEL', NULL, NULL, NULL)`,
          [h.hash, h.org, loc, plate(), common.id, common.year],
        );
        expect(both.rows[0]?.outcome).toBe('VEHICLE_FIELD_REQUIRED');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 2 — photos : PHOTO_MIN_COUNT, l’annonce reste DRAFT ; N-37 : HOST_NOT_ACTIVATED', () => {
  it.each(byCountry)(
    '%s (%s) : 5 photos ⇒ PHOTO_MIN_COUNT ; photos refusées non comptées ; 6 photos et compte ONBOARDING ⇒ HOST_NOT_ACTIVATED ; compte ACTIVE et pays fermé ⇒ HOST_NOT_ACTIVATED ; toujours DRAFT, rien de journalisé',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        for (let i = 0; i < 5; i += 1)
          expect((await photo(client, h, h.listing)).outcome).toBe('DONE');
        expect(await submit(client, h, h.listing)).toBe('PHOTO_MIN_COUNT');
        expect((await listingRow(client, h.listing))?.status).toBe('DRAFT');
        // fichiers : bucket public, C0, téléversement de l'hôte, positions 0 à 4
        const files = await client.query<{
          photo_position: number;
          status: string;
          bucket: string;
          storage_key: string;
          mime: string;
          classification: string;
          source: string;
          uploader_user_id: string;
        }>('SELECT * FROM test_fixture.us115_photo_files($1)', [h.listing]);
        expect(files.rows.map((r) => r.photo_position)).toEqual([0, 1, 2, 3, 4]);
        for (const f of files.rows) {
          expect(f).toMatchObject({
            status: 'PENDING',
            bucket: 'PUBLIC_LISTING',
            mime: 'image/jpeg',
            classification: 'C0',
            source: 'HOST_UPLOAD',
            uploader_user_id: h.userId,
          });
          expect(f.storage_key.startsWith(`listing/${h.listing}/`)).toBe(true);
        }
        // type hors liste : refusé, rien n'est écrit
        expect((await photo(client, h, h.listing, 'image/svg+xml')).outcome).toBe('PHOTO_FORMAT');
        expect((await photo(client, h, h.listing, 'text/html')).outcome).toBe('PHOTO_FORMAT');
        expect((await photo(client, h, h.listing, 'image/png')).outcome).toBe('DONE');
        // 6 photos, compte d'hôte ONBOARDING (N-37) : refus, l'annonce reste en brouillon
        expect(await submit(client, h, h.listing)).toBe('HOST_NOT_ACTIVATED');
        expect((await listingRow(client, h.listing))?.status).toBe('DRAFT');
        // compte ACTIVE, mais p2p_private_hosts_enabled[pays] = false (graine, jamais écrit ici) :
        // même refus (16 HST-005), l'annonce reste DRAFT
        await client.query('SELECT test_fixture.us115_set_org_status($1, $2)', [h.org, 'ACTIVE']);
        const open = await client.query<{ on: boolean }>(
          `SELECT core.config_go_live('p2p_private_hosts_enabled', $1) AS on`,
          [c.country],
        );
        expect(open.rows[0]?.on).toBe(false);
        expect(await submit(client, h, h.listing)).toBe('HOST_NOT_ACTIVATED');
        const after = await listingRow(client, h.listing);
        expect(after?.status).toBe('DRAFT');
        expect(after?.submitted_at).toBeNull();
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : SM-2 — suppression d’un brouillon (DELETED, terminal) ; toute autre transition ⇒ LISTING_TRANSITION_FORBIDDEN',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        // une annonce par véhicule
        expect((await listing(client, h, h.vehicle, priceOf(c, 40))).outcome).toBe(
          'LISTING_EXISTS',
        );
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          h.listing,
          'LISTED',
        ]);
        expect(await remove(client, h, h.listing)).toBe('LISTING_TRANSITION_FORBIDDEN');
        expect(await submit(client, h, h.listing)).toBe('LISTING_TRANSITION_FORBIDDEN');
        expect((await photo(client, h, h.listing)).outcome).toBe('LISTING_TRANSITION_FORBIDDEN');
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          h.listing,
          'DRAFT',
        ]);
        expect(await remove(client, h, h.listing)).toBe('DONE');
        expect((await listingRow(client, h.listing))?.status).toBe('DELETED');
        expect(await remove(client, h, h.listing)).toBe('LISTING_TRANSITION_FORBIDDEN');
        expect(await pricing(client, h, h.listing, priceOf(c, 50))).toBe(
          'LISTING_TRANSITION_FORBIDDEN',
        );
        expect(await submit(client, h, h.listing)).toBe('LISTING_TRANSITION_FORBIDDEN');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : supprimer puis recréer — l’annonce DELETED libère son véhicule (une seule annonce non supprimée par véhicule)',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        expect(await remove(client, h, h.listing)).toBe('DONE');
        // le véhicule redevient « sans annonce » dans l'espace de l'hôte
        const before = await client.query<{ vehicle_id: string; listing_id: string | null }>(
          'SELECT vehicle_id, listing_id FROM core.catalog_host_vehicles($1, $2)',
          [h.hash, h.org],
        );
        expect(before.rows).toEqual([{ vehicle_id: h.vehicle, listing_id: null }]);
        const again = await listing(client, h, h.vehicle, priceOf(c, 45));
        expect(again.outcome).toBe('DONE');
        expect(again.id).not.toBe(h.listing);
        expect((await listingRow(client, h.listing))?.status).toBe('DELETED');
        expect((await listingRow(client, again.id ?? ''))?.status).toBe('DRAFT');
        const after = await client.query<{ vehicle_id: string; listing_id: string | null }>(
          'SELECT vehicle_id, listing_id FROM core.catalog_host_vehicles($1, $2)',
          [h.hash, h.org],
        );
        expect(after.rows).toEqual([{ vehicle_id: h.vehicle, listing_id: again.id }]);
        // une seconde annonce vivante sur le même véhicule reste refusée
        expect((await listing(client, h, h.vehicle, priceOf(c, 40))).outcome).toBe(
          'LISTING_EXISTS',
        );
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 3 — prix : trip confirmé inchangé ; pas du prix du pays (PRC-001, BR-PRICE-14)', () => {
  it.each(byCountry)(
    '%s (%s) : trip confirmé à 40 unités par jour, prix passé à 50 : le trip garde son montant ; l’annonce porte le nouveau prix',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const forty = priceOf(c, 4000);
        const fifty = priceOf(c, 5000);
        const h = await draft(client, c, forty, 'ACTIVE');
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          h.listing,
          'LISTED',
        ]);
        // trip confirmé de 3 jours sur ce véhicule, payé au prix d'alors (fixture : la conversion
        // réelle exige un PSP, lot C)
        const trip = uuid();
        await client.query(
          'SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)',
          [
            trip,
            uuid(),
            h.org,
            h.vehicle,
            c.country,
            c.currency,
            c.timezone,
            '2036-03-01T10:00:00Z',
            '2036-03-04T10:00:00Z',
          ],
        );
        await client.query('SELECT test_fixture.rls_insert_trip_operation($1, $2, $3)', [
          uuid(),
          trip,
          3 * forty,
        ]);
        expect(await pricing(client, h, h.listing, fifty)).toBe('DONE');
        const paid = await client.query<{ paid: string }>(
          'SELECT test_fixture.us115_trip_paid($1) AS paid',
          [trip],
        );
        expect(paid.rows[0]?.paid).toBe(String(3 * forty));
        expect(await listingRow(client, h.listing)).toMatchObject({
          daily_price_minor: String(fifty),
          currency: c.currency,
          status: 'LISTED',
        });
        // la commande ne peut rien écrire d'autre que l'annonce : aucun droit sur trips ni argent
        const rights = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM unnest(ARRAY['core.booking_trip', 'core.payment_payment_operation',
                               'core.settlement_settlement_line']) AS t(rel),
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p(priv)
            WHERE pg_catalog.has_table_privilege('catalog_cmd_owner', t.rel, p.priv)
               OR (p.priv <> 'DELETE'
                   AND pg_catalog.has_any_column_privilege('catalog_cmd_owner', t.rel, p.priv))`,
        );
        expect(rights.rows[0]?.n).toBe(0);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : plafond de cohérence du pays (16 PRC-001) — au plafond : accepté ; un pas au-dessus et 10^18 : PRICE_INVALID ; prix du km au-delà : MILEAGE_CONFIG_INVALID',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const ceiling = async (key: string): Promise<bigint> => {
          const { rows } = await client.query<{ v: string }>(
            `SELECT value #>> '{}' AS v FROM core.config_param_value
              WHERE key = $1 AND country_code = $2 AND scope_type = 'COUNTRY'
              ORDER BY valid_from DESC LIMIT 1`,
            [key, c.country],
          );
          if (!rows[0]) throw new Error(`${key} absent pour ${c.country}`);
          return BigInt(rows[0].v);
        };
        const maxDaily = await ceiling('price_ceiling_daily_minor');
        const maxKm = await ceiling('price_ceiling_extra_km_minor');
        const step = BigInt(c.priceStepMinor);
        // le plafond est lui-même au pas du pays, et sous la borne structurelle de 10^13
        expect(maxDaily % step).toBe(0n);
        expect(maxDaily <= 10_000_000_000_000n && maxKm <= 10_000_000_000_000n).toBe(true);
        const h = await draft(client, c, priceOf(c, 40));
        expect(await pricing(client, h, h.listing, String(maxDaily))).toBe('DONE');
        expect(await pricing(client, h, h.listing, String(maxDaily + step))).toBe('PRICE_INVALID');
        expect(await pricing(client, h, h.listing, '1000000000000000000')).toBe('PRICE_INVALID');
        expect((await listing(client, h, h.vehicle, '1000000000000000000')).outcome).not.toBe(
          'DONE',
        );
        expect((await listingRow(client, h.listing))?.daily_price_minor).toBe(String(maxDaily));
        const km = (extra: string) =>
          pricing(client, h, h.listing, priceOf(c, 40), { mode: 'INCLUDED', km: 200, extra });
        expect(await km(String(maxKm))).toBe('DONE');
        expect(await km(String(maxKm + 1n))).toBe('MILEAGE_CONFIG_INVALID');
        expect(await km('1000000000000000000')).toBe('MILEAGE_CONFIG_INVALID');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : plafond absent ou nul ⇒ PARAM_MISSING (fail-closed), rien d’écrit',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        for (const key of ['price_ceiling_daily_minor', 'price_ceiling_extra_km_minor']) {
          await client.query('BEGIN');
          try {
            await client.query('SELECT test_fixture.us115_price_ceiling_version($1, $2, $3)', [
              key,
              c.country,
              JSON.stringify('0'),
            ]);
            expect(await pricing(client, h, h.listing, priceOf(c, 50)), key).toBe('PARAM_MISSING');
          } finally {
            await client.query('ROLLBACK');
          }
        }
        expect((await listingRow(client, h.listing))?.daily_price_minor).toBe(
          String(priceOf(c, 40)),
        );
        expect(await pricing(client, h, h.listing, priceOf(c, 50))).toBe('DONE');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : prix au pas du pays (entier, > 0) ; distance incluse validée (MILEAGE_CONFIG_INVALID) ; REQUEST refusé pour un lieu aéroport',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 250));
        // hors pas : refusé là où le pas s'applique (PYG : 250 500), accepté sinon
        const off = priceOf(c, 250) + 500;
        expect(await pricing(client, h, h.listing, off)).toBe(
          c.priceStepMinor > 500 ? 'PRICE_INVALID' : 'DONE',
        );
        for (const bad of [0, -100])
          expect(await pricing(client, h, h.listing, bad), String(bad)).toBe('PRICE_INVALID');
        expect(await pricing(client, h, h.listing, priceOf(c, 300))).toBe('DONE');
        // distance incluse : km par jour > 0 et prix du km ≥ 0 (devise du pays, entier)
        expect(
          await pricing(client, h, h.listing, priceOf(c, 300), {
            mode: 'INCLUDED',
            km: 250,
            extra: priceOf(c, 1),
          }),
        ).toBe('DONE');
        expect(
          await pricing(client, h, h.listing, priceOf(c, 300), {
            mode: 'INCLUDED',
            km: 0,
            extra: 1,
          }),
        ).toBe('MILEAGE_CONFIG_INVALID');
        expect(
          await pricing(client, h, h.listing, priceOf(c, 300), {
            mode: 'INCLUDED',
            km: 250,
            extra: null,
          }),
        ).toBe('MILEAGE_CONFIG_INVALID');
        expect(
          await pricing(client, h, h.listing, priceOf(c, 300), { mode: 'UNLIMITED', km: 250 }),
        ).toBe('MILEAGE_CONFIG_INVALID');
        expect(await pricing(client, h, h.listing, priceOf(c, 300), { mode: 'PER_TRIP' })).toBe(
          'MILEAGE_CONFIG_INVALID',
        );
        expect(await listingRow(client, h.listing)).toMatchObject({
          daily_price_minor: String(priceOf(c, 300)),
          currency: c.currency,
          country_code: c.country,
        });
        // lieu aéroport : mode REQUEST refusé (17 §3.2.3, OQ-P2P-10), INSTANT accepté
        const airport = (await location(client, h, { kind: 'AIRPORT' })).id;
        const v = (await vehicle(client, h, airport, { plate: plate() })).id;
        expect(
          (await listing(client, h, v, priceOf(c, 300), { mode: 'UNLIMITED' }, false)).outcome,
        ).toBe('REQUEST_MODE_NOT_ALLOWED');
        expect(
          (await listing(client, h, v, priceOf(c, 300), { mode: 'UNLIMITED' }, true)).outcome,
        ).toBe('DONE');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 4 — lieu de remise : zone approximative seulement avant confirmation (OQ-P2P-05, L1-PM-19)', () => {
  it.each(byCountry)(
    '%s (%s) : annonce LISTED vue d’un visiteur : ville, zone et point arrondi ; jamais libellé, adresse, point exact, plaque, VIN ; annonce non publiée : rien',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        const publicView = async (id: string) =>
          (
            await client.query<Record<string, unknown>>(
              'SELECT * FROM core.catalog_public_listing($1)',
              [id],
            )
          ).rows;
        // brouillon : invisible
        expect(await publicView(h.listing)).toEqual([]);
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          h.listing,
          'LISTED',
        ]);
        const rows = await publicView(h.listing);
        expect(rows).toHaveLength(1);
        const r = rows[0] ?? {};
        expect(Object.keys(r).sort()).toEqual(
          [
            'listing_id',
            'country_code',
            'daily_price_minor',
            'currency',
            'mileage_mode',
            'included_km_per_day',
            'extra_km_price_minor',
            'instant_book',
            'variant_id',
            'make_name',
            'model_name',
            'year',
            'transmission',
            'seats',
            'fuel_type',
            'location_kind',
            'city',
            'area_label',
            'geo_public_lat',
            'geo_public_lng',
            'timezone',
          ].sort(),
        );
        expect(r).toMatchObject({ city: CITY, area_label: AREA, country_code: c.country });
        // arrondi au centième de degré (≈ 1,1 km)
        expect(Number(r['geo_public_lat'])).toBeCloseTo(8.98, 10);
        expect(Number(r['geo_public_lng'])).toBeCloseTo(-79.52, 10);
        const text = JSON.stringify(r);
        for (const secret of [
          NAME,
          ADDRESS,
          'Calle 50',
          String(LAT),
          String(LNG),
          '8.983',
          '79.519',
        ]) {
          expect(text, secret).not.toContain(secret);
        }
        const v = await client.query<{ plate: string; vin: string | null }>(
          'SELECT plate, vin FROM test_fixture.us115_vehicle_row($1)',
          [h.vehicle],
        );
        expect(text).not.toContain(v.rows[0]?.plate ?? '<plaque>');
        // l'hôte, lui, relit son lieu exact (sa propre donnée)
        const own = await client.query<{
          place_label: string;
          address_line: string;
          geo_lat: string;
          geo_lng: string;
        }>(
          'SELECT place_label, address_line, geo_lat, geo_lng FROM core.catalog_host_locations($1, $2)',
          [h.hash, h.org],
        );
        expect(own.rows).toHaveLength(1);
        expect(own.rows[0]).toMatchObject({ place_label: NAME, address_line: ADDRESS });
        expect(Number(own.rows[0]?.geo_lat)).toBeCloseTo(LAT, 6);
        expect(Number(own.rows[0]?.geo_lng)).toBeCloseTo(LNG, 6);
        // lieu sans épingle : aucun point public (fail-closed, PROPOSÉ)
        const loc = await location(client, h, { lat: null, lng: null });
        const veh = await vehicle(client, h, loc.id, { plate: plate() });
        const lst = await listing(client, h, veh.id, priceOf(c, 40));
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          lst.id,
          'LISTED',
        ]);
        const nopin = (await publicView(lst.id ?? ''))[0];
        expect(nopin).toMatchObject({ geo_public_lat: null, geo_public_lng: null, city: CITY });
        // épingle à moitié posée : refus
        expect((await location(client, h, { lat: LAT, lng: null })).outcome).toBe(
          'LOCATION_FIELD_INVALID',
        );
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('L1-PM-11 — IDOR : l’hôte A contre l’hôte B (lieux, véhicules, annonces, photos)', () => {
  it.each(byCountry)(
    '%s (%s) : B ne lit ni ne modifie rien de A, par aucune commande ; un objet de A sous le compte de B répond comme un objet inexistant',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await draft(client, c, priceOf(c, 40));
        const b = await draft(client, c, priceOf(c, 40));
        // B demande le compte de A : FORBIDDEN (commandes), 0 ligne (lectures)
        const bOnA = { hash: b.hash, org: a.org };
        expect((await location(client, bOnA)).outcome).toBe('FORBIDDEN');
        expect((await vehicle(client, bOnA, a.location, { plate: plate() })).outcome).toBe(
          'FORBIDDEN',
        );
        expect((await listing(client, bOnA, a.vehicle, priceOf(c, 40))).outcome).toBe('FORBIDDEN');
        expect(await pricing(client, bOnA, a.listing, priceOf(c, 1))).toBe('FORBIDDEN');
        expect((await photo(client, bOnA, a.listing)).outcome).toBe('FORBIDDEN');
        expect(await submit(client, bOnA, a.listing)).toBe('FORBIDDEN');
        expect(await remove(client, bOnA, a.listing)).toBe('FORBIDDEN');
        for (const fn of [
          'catalog_host_locations',
          'catalog_host_vehicles',
          'catalog_host_listings',
        ]) {
          const { rows } = await client.query(`SELECT * FROM core.${fn}($1, $2)`, [b.hash, a.org]);
          expect(rows, fn).toEqual([]);
        }
        // B, sous SON compte, vise les objets de A : même réponse qu'un identifiant inconnu
        expect((await vehicle(client, b, a.location, { plate: plate() })).outcome).toBe(
          'LOCATION_NOT_FOUND',
        );
        expect((await vehicle(client, b, uuid(), { plate: plate() })).outcome).toBe(
          'LOCATION_NOT_FOUND',
        );
        expect((await listing(client, b, a.vehicle, priceOf(c, 40))).outcome).toBe(
          'VEHICLE_NOT_FOUND',
        );
        expect((await listing(client, b, uuid(), priceOf(c, 40))).outcome).toBe(
          'VEHICLE_NOT_FOUND',
        );
        for (const id of [a.listing, uuid()]) {
          expect(await pricing(client, b, id, priceOf(c, 1))).toBe('LISTING_NOT_FOUND');
          expect((await photo(client, b, id)).outcome).toBe('LISTING_NOT_FOUND');
          expect(await submit(client, b, id)).toBe('LISTING_NOT_FOUND');
          expect(await remove(client, b, id)).toBe('LISTING_NOT_FOUND');
        }
        // les lectures de B ne contiennent que ses lignes
        const vehicles = await client.query<{ vehicle_id: string }>(
          'SELECT vehicle_id FROM core.catalog_host_vehicles($1, $2)',
          [b.hash, b.org],
        );
        expect(vehicles.rows.map((r) => r.vehicle_id)).toEqual([b.vehicle]);
        const listings = await client.query<{ listing_id: string }>(
          'SELECT listing_id FROM core.catalog_host_listings($1, $2)',
          [b.hash, b.org],
        );
        expect(listings.rows.map((r) => r.listing_id)).toEqual([b.listing]);
        // A est intact
        expect(await listingRow(client, a.listing)).toMatchObject({
          status: 'DRAFT',
          daily_price_minor: String(priceOf(c, 40)),
        });
        // session invalide : AUTH_REQUIRED, rien de lu
        const forged = newToken().hash;
        expect((await location(client, { hash: forged, org: a.org })).outcome).toBe(
          'AUTH_REQUIRED',
        );
        expect(await submit(client, { hash: forged, org: a.org }, a.listing)).toBe('AUTH_REQUIRED');
        const none = await client.query('SELECT * FROM core.catalog_host_listings($1, $2)', [
          forged,
          a.org,
        ]);
        expect(none.rows).toEqual([]);
      });
    },
  );

  it('une même personne hôte dans les deux pays : chaque compte ne voit et n’écrit que dans son pays', async () => {
    await withRole('app_api', async (client) => {
      const [first, second] = COUNTRIES;
      const p = await person(client, first.country);
      const orgs = [
        await openAccount(client, p.hash, first.country),
        await openAccount(client, p.hash, second.country),
      ];
      const l1 = (await location(client, { hash: p.hash, org: orgs[0] as string })).id;
      // le lieu du premier pays n'est pas un lieu du compte du second
      expect(
        (await vehicle(client, { hash: p.hash, org: orgs[1] as string }, l1, { plate: plate() }))
          .outcome,
      ).toBe('LOCATION_NOT_FOUND');
      const seen = await client.query<{ location_id: string }>(
        'SELECT location_id FROM core.catalog_host_locations($1, $2)',
        [p.hash, orgs[1]],
      );
      expect(seen.rows).toEqual([]);
      const row = await client.query<{ country_code: string; timezone: string }>(
        'SELECT country_code, timezone FROM test_fixture.us115_location_row($1)',
        [l1],
      );
      // pays et fuseau : ceux du compte d'hôte, jamais une saisie
      expect(row.rows[0]).toEqual({ country_code: first.country, timezone: first.timezone });
    });
  });

  it.each(byCountry)(
    '%s (%s) : compte d’hôte suspendu : aucune écriture (HOST_ACCOUNT_SUSPENDED), lecture de ses lignes conservée',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await draft(client, c, priceOf(c, 40));
        await client.query('SELECT test_fixture.us115_set_org_status($1, $2)', [
          h.org,
          'SUSPENDED',
        ]);
        expect((await location(client, h)).outcome).toBe('HOST_ACCOUNT_SUSPENDED');
        expect((await vehicle(client, h, h.location, { plate: plate() })).outcome).toBe(
          'HOST_ACCOUNT_SUSPENDED',
        );
        expect(await pricing(client, h, h.listing, priceOf(c, 50))).toBe('HOST_ACCOUNT_SUSPENDED');
        expect((await photo(client, h, h.listing)).outcome).toBe('HOST_ACCOUNT_SUSPENDED');
        const own = await client.query('SELECT * FROM core.catalog_host_listings($1, $2)', [
          h.hash,
          h.org,
        ]);
        expect(own.rows).toHaveLength(1);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('F-RLS-01 / N-03 — gardes de blocage sur la VRAIE table du catalogue', () => {
  it.each(byCountry)(
    '%s (%s) : B bloque son véhicule publié ; A ne bloque pas le véhicule de B (squatting) ; un véhicule non publié ou inconnu : refusé',
    async (_country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const a = await draft(client, c, priceOf(c, 40), 'ACTIVE');
        const b = await draft(client, c, priceOf(c, 40), 'ACTIVE');
        await client.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          b.listing,
          'LISTED',
        ]);
        const block = async (who: Host, vehicleId: string, day: number): Promise<string> =>
          withTestTransaction(client, {}, async (tx) => {
            await setSessionContext(tx, { kind: 'HOST', actorId: who.userId, orgId: who.org });
            try {
              await tx.query(
                'SELECT core.booking_cmd_place_host_block($1, $2::timestamptz, $3::timestamptz)',
                [
                  vehicleId,
                  `2036-05-${String(day).padStart(2, '0')}T10:00:00Z`,
                  `2036-05-${String(day + 1).padStart(2, '0')}T10:00:00Z`,
                ],
              );
              return 'OK';
            } catch (error) {
              return translateDbError(error).code;
            }
          });
        expect(await block(b, b.vehicle, 10), 'témoin : B bloque son véhicule publié').toBe('OK');
        expect(await block(a, b.vehicle, 12), 'squatting').toBe('FORBIDDEN');
        // véhicule de A non publié (DRAFT) : aucun blocage (booking_vehicle_party : annonce LISTED)
        expect(await block(a, a.vehicle, 14)).toBe('FORBIDDEN');
        expect(await block(a, uuid(), 16)).toBe('FORBIDDEN');
      });
    },
  );
});
