/**
 * US-219 — lecture des trips de l'hôte (migration 0101, ADR-128 ; fixture 9991). Rôles de
 * production seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au Paraguay (PYG).
 * Chaque test crée ses propres personnes, sessions, comptes d'hôte, lieux et véhicules par les
 * VRAIES commandes (US-107, US-115) et ses trips par le parcours hold → preuve → conversion
 * d'US-024 (`bookTrip`).
 *
 * Attendus tirés de 19 US-219 (critères 1 à 3), de 16 HDB-001 / HDB-002 (onglets À venir / En
 * cours / Terminés / Annulés, filtres par véhicule et date, statut du paiement, gains estimés de
 * la jambe HOST ; « jamais le numéro du permis »), de 17 §2.3 (`host_guest_v` : prénom, âge, note,
 * statut de vérification ; RLS-2, RLS-28 ; point 5 : rien n'est révélé d'un autre compte) et du
 * pré-mortem du lot 2 (L2-PM-10, L2-PM-35), jamais du code testé. La jambe HOST attendue est la
 * donnée d'entrée de la fixture de paiement (9001 : toute la somme sur HOST), relue telle quelle.
 *
 * Fuseaux (donnée IANA, pas une constante du code) : America/Panama = UTC−5 ; America/Asuncion =
 * UTC−3 en décembre : les dates de test sont en décembre.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient, signedOpenParams } from '../../src/testing/index.ts';
import { bookTrip, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { uniquePlate } from '../support/unique.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** Décalage UTC de décembre du fuseau du pays, en heures (donnée IANA, voir l'en-tête). */
const DECEMBER_OFFSET_H: Readonly<Record<string, number>> = { PA: -5, PY: -3 };
/** 17 `host_guest_v` et 16 HDB-002 : ce que l'hôte voit d'un trip, rien d'autre. */
const COLUMNS = [
  'booked_at',
  'currency',
  'guest_age_years',
  'guest_first_name',
  'guest_rating',
  'guest_verified',
  'host_leg_minor',
  'outcome',
  'payment_status',
  'public_ref',
  'scheduled_end',
  'scheduled_start',
  'status',
  'tab',
  'timezone',
  'trip_id',
  'vehicle_id',
];
const TRIPS =
  'SELECT * FROM core.booking_host_trips($1, $2::uuid, $3, $4::uuid, $5::date, $6::date, $7::uuid, $8)';

interface Clients {
  readonly api: pg.Client;
  readonly worker: pg.Client;
}

async function withClients<T>(fn: (c: Clients) => Promise<T>): Promise<T> {
  const api = await connectAs('app_api');
  try {
    const worker = await connectAs('app_worker');
    try {
      return await fn({ api, worker });
    } finally {
      await releaseClient(worker);
    }
  } finally {
    await releaseClient(api);
  }
}

/** Heure locale du pays (`AAAA-MM-JJTHH:MM`) en instant UTC ISO. */
const utc = (c: CountryCase, local: string): string =>
  new Date(
    Date.parse(`${local}:00Z`) - (DECEMBER_OFFSET_H[c.country] ?? 0) * 3_600_000,
  ).toISOString();

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}

/** Personne inscrite (compte ACTIVE), session ouverte, compte d'hôte ACTIVE (vraies commandes). */
async function host(tx: pg.ClientBase, country: string): Promise<Host> {
  const userId = uuid();
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `us219-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const t = newToken();
  const s = await tx.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(tx, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  const { rows } = await tx.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [t.hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [rows[0].org_id, 'ACTIVE']);
  return { userId, hash: t.hash, org: rows[0].org_id };
}

const plate = (c: pg.ClientBase): Promise<string> => uniquePlate(c, 'H');

/** Lieu et véhicule du compte (vraies commandes d'US-115). */
async function vehicle(tx: pg.ClientBase, h: Host): Promise<string> {
  const loc = await tx.query<{ location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, 'HOME', 'Casa', 'Calle 1', 'Ciudad', null, null, null],
  );
  const veh = await tx.query<{ vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [h.hash, h.org, loc.rows[0]?.location_id, await plate(tx)],
  );
  const id = veh.rows[0]?.vehicle_id;
  if (!id) throw new Error('véhicule refusé');
  return id;
}

interface World {
  readonly a: Host;
  readonly b: Host;
  readonly carA: string;
  readonly carA2: string;
  readonly carB: string;
  /** trip de A confirmé à 10:00, début le 12 décembre (le plus proche) */
  readonly soon: { readonly tripId: string; readonly guestId: string };
  /** trip de A confirmé avant, début le 20 décembre */
  readonly later: { readonly tripId: string; readonly guestId: string };
  /** trip de A sur son second véhicule, début le 16 décembre */
  readonly other: { readonly tripId: string; readonly guestId: string };
  /** trip de B */
  readonly tripB: string;
  /** 10:01, heure locale du pays (l'hôte rafraîchit) */
  readonly refresh: string;
}

const slot = (
  c: CountryCase,
  vehicleId: string,
  orgId: string,
  start: string,
  end: string,
): Slot => ({
  vehicleId,
  orgId,
  start: utc(c, start),
  end: utc(c, end),
  bufferHours: 2,
});

async function world(cl: Clients, c: CountryCase): Promise<World> {
  const setup = utc(c, '2026-12-10T08:00');
  const { a, b, carA, carA2, carB } = await inTx(
    cl.api,
    { virtualNow: setup, commit: true },
    async (tx) => {
      const ha = await host(tx, c.country);
      const hb = await host(tx, c.country);
      return {
        a: ha,
        b: hb,
        carA: await vehicle(tx, ha),
        carA2: await vehicle(tx, ha),
        carB: await vehicle(tx, hb),
      };
    },
  );
  const book = async (car: string, org: string, start: string, end: string, t0: string) => {
    const r = await bookTrip(cl.api, cl.worker, slot(c, car, org, start, end), c, utc(c, t0));
    return { tripId: r.tripId, guestId: r.hold.guestId };
  };
  // confirmation = preuve et conversion à t0 + 2 min (bookTrip) : « later » à 09:00, « soon » à 10:00
  const later = await book(carA, a.org, '2026-12-20T09:00', '2026-12-22T09:00', '2026-12-10T08:58');
  const other = await book(
    carA2,
    a.org,
    '2026-12-16T09:00',
    '2026-12-17T09:00',
    '2026-12-10T09:10',
  );
  const soon = await book(carA, a.org, '2026-12-12T09:00', '2026-12-13T09:00', '2026-12-10T09:58');
  const tripB = (
    await book(carB, b.org, '2026-12-11T09:00', '2026-12-12T09:00', '2026-12-10T09:20')
  ).tripId;
  return {
    a,
    b,
    carA,
    carA2,
    carB,
    soon,
    later,
    other,
    tripB,
    refresh: utc(c, '2026-12-10T10:01'),
  };
}

type Row = Record<string, unknown>;

async function trips(
  tx: pg.ClientBase,
  h: Host,
  org: string,
  options: {
    readonly tab?: string | null;
    readonly vehicle?: string | null;
    readonly from?: string | null;
    readonly to?: string | null;
    readonly trip?: string | null;
    readonly limit?: number;
  } = {},
): Promise<Row[]> {
  const { rows } = await tx.query<Row>(TRIPS, [
    h.hash,
    org,
    options.tab ?? null,
    options.vehicle ?? null,
    options.from ?? null,
    options.to ?? null,
    options.trip ?? null,
    options.limit ?? 200,
  ]);
  return rows;
}

describe.each(COUNTRIES)('US-219 — trips de l’hôte ($country, $currency)', (c) => {
  it('critère 1 : confirmation à 10:00, rafraîchissement à 10:01 ⇒ le trip est en tête des prochaines remises, avec la jambe HOST de la conversion', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      await inTx(cl.api, { virtualNow: w.refresh }, async (tx) => {
        const rows = await trips(tx, w.a, w.a.org, { tab: 'UPCOMING' });
        expect(rows.map((r) => r['trip_id'])).toEqual([
          w.soon.tripId,
          w.other.tripId,
          w.later.tripId,
        ]);
        const first = rows[0] ?? {};
        expect(first).toMatchObject({
          outcome: 'DONE',
          tab: 'UPCOMING',
          status: 'BOOKED',
          vehicle_id: w.carA,
          scheduled_start: new Date(utc(c, '2026-12-12T09:00')),
          scheduled_end: new Date(utc(c, '2026-12-13T09:00')),
          timezone: c.timezone,
          payment_status: 'CONFIRMED',
          currency: c.currency,
          // jambe HOST de l'opération de conversion (donnée de la fixture 9001), jamais recalculée
          host_leg_minor: c.rentMinor,
          booked_at: new Date(utc(c, '2026-12-10T10:00')),
        });
        // sans onglet : à venir d'abord, prochaine remise en tête
        expect((await trips(tx, w.a, w.a.org))[0]?.['trip_id']).toBe(w.soon.tripId);
      });
    });
  });

  it('critère 2 : l’hôte voit prénom, âge, note et vérification du voyageur, jamais son identifiant, son nom, son permis ni une pièce', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      await inTx(cl.api, { virtualNow: w.refresh }, async (tx) => {
        // voyageur né le 11 décembre 1996 : 29 ans révolus le 10 décembre 2026 (date locale)
        await tx.query('SELECT test_fixture.us219_guest_profile($1, $2::date, $3, true, false)', [
          w.soon.guestId,
          '1996-12-11',
          c.country,
        ]);
        const [row] = await trips(tx, w.a, w.a.org, { trip: w.soon.tripId });
        expect(Object.keys(row ?? {}).sort()).toEqual(COLUMNS);
        expect(row).toMatchObject({
          trip_id: w.soon.tripId,
          guest_first_name: 'Fixture',
          guest_age_years: 29,
          guest_rating: null,
          guest_verified: true,
        });
        expect(JSON.stringify(row)).not.toContain(w.soon.guestId);
        expect(JSON.stringify(row)).not.toContain('Guest');
        // voyageur sans vérification d'identité approuvée
        const [unverified] = await trips(tx, w.a, w.a.org, { trip: w.later.tripId });
        expect(unverified?.['guest_verified']).toBe(false);
        // compte pseudonymisé (droit à l'effacement) : ni prénom ni âge
        await tx.query('SELECT test_fixture.us219_guest_profile($1, $2::date, $3, false, true)', [
          w.later.guestId,
          '1990-01-01',
          c.country,
        ]);
        const [erased] = await trips(tx, w.a, w.a.org, { trip: w.later.tripId });
        expect(erased).toMatchObject({ guest_first_name: null, guest_age_years: null });
        // app_api ne lit toujours ni l'identifiant du voyageur ni le dossier d'identité
        await tx.query('SAVEPOINT us219');
        await expect(
          tx.query('SELECT guest_user_id FROM core.booking_trip LIMIT 1'),
        ).rejects.toMatchObject({ code: '42501' });
        await tx.query('ROLLBACK TO SAVEPOINT us219');
        await expect(
          tx.query('SELECT status FROM core.kyc_identity_verification LIMIT 1'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });
  });

  it('critère 3 : l’hôte A appelle les trips de l’hôte B ⇒ 0 trip (FORBIDDEN, rien n’est révélé) ; un trip de B demandé par son identifiant sur le compte de A ⇒ 0 ligne', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      await inTx(cl.api, { virtualNow: w.refresh }, async (tx) => {
        // compte de B demandé avec la session de A
        expect(await trips(tx, w.a, w.b.org)).toEqual([
          expect.objectContaining({ outcome: 'FORBIDDEN', trip_id: null }),
        ]);
        expect(await trips(tx, w.a, w.b.org, { trip: w.tripB })).toHaveLength(1);
        expect((await trips(tx, w.a, w.b.org, { trip: w.tripB }))[0]?.['trip_id']).toBeNull();
        // trip de B par son identifiant, sur le compte de A ; véhicule de B en filtre
        expect(await trips(tx, w.a, w.a.org, { trip: w.tripB })).toEqual([]);
        expect(await trips(tx, w.a, w.a.org, { vehicle: w.carB })).toEqual([]);
        // B ne voit que son trip
        expect((await trips(tx, w.b, w.b.org)).map((r) => r['trip_id'])).toEqual([w.tripB]);
        // session inconnue : FORBIDDEN, aucun trip
        const ghost = { ...w.a, hash: newToken().hash };
        expect(await trips(tx, ghost, w.a.org)).toEqual([
          expect.objectContaining({ outcome: 'FORBIDDEN', trip_id: null }),
        ]);
      });
    });
  });

  it('onglets, filtres et gains : en cours, terminés, annulés (jambe HOST masquée) ; véhicule ; période locale ; saisie invalide refusée', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      // états posés DANS une transaction annulée (fixture d'US-207, exemptée de la garde)
      await inTx(cl.api, { virtualNow: w.refresh }, async (tx) => {
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
          w.later.tripId,
          'IN_PROGRESS',
        ]);
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
          w.other.tripId,
          'COMPLETED',
        ]);
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
          w.soon.tripId,
          'CANCELLED_BY_GUEST',
        ]);
        const tabOf = async (tab: string) =>
          (await trips(tx, w.a, w.a.org, { tab })).map((r) => [r['trip_id'], r['host_leg_minor']]);
        expect(await tabOf('UPCOMING')).toEqual([]);
        expect(await tabOf('IN_PROGRESS')).toEqual([[w.later.tripId, c.rentMinor]]);
        expect(await tabOf('DONE')).toEqual([[w.other.tripId, c.rentMinor]]);
        expect(await tabOf('CANCELLED')).toEqual([[w.soon.tripId, null]]);
      });
      await inTx(cl.api, { virtualNow: w.refresh }, async (tx) => {
        const ids = async (o: Parameters<typeof trips>[3]) =>
          (await trips(tx, w.a, w.a.org, o)).map((r) => r['trip_id']);
        expect(await ids({ vehicle: w.carA2 })).toEqual([w.other.tripId]);
        // période locale : le 13 décembre chevauche « soon » (12 → 13 à 09:00) seulement
        expect(await ids({ from: '2026-12-13', to: '2026-12-13' })).toEqual([w.soon.tripId]);
        expect(await ids({ from: '2026-12-14', to: '2026-12-19' })).toEqual([w.other.tripId]);
        expect(await ids({ from: '2026-12-21' })).toEqual([w.later.tripId]);
        expect(await ids({ to: '2026-12-11' })).toEqual([]);
        expect(await ids({ limit: 1 })).toEqual([w.soon.tripId]);
        for (const bad of [
          { tab: 'ARCHIVED' },
          { limit: 0 },
          { limit: 201 },
          { from: '2026-12-20', to: '2026-12-19' },
        ]) {
          expect(await trips(tx, w.a, w.a.org, bad)).toEqual([
            expect.objectContaining({ outcome: 'REQUEST_INVALID', trip_id: null }),
          ]);
        }
      });
    });
  });
});
