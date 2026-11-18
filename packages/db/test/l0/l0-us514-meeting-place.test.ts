/**
 * US-514 (migration 0144, ADR-168 ; fixtures 9939, 9948, 9998) — lieux de prise et de retour, sous
 * les rôles de PRODUCTION (assertion L0-05 en tête de chaque connexion : `withRole`, `connectAs`),
 * au Panama (USD) et au Paraguay (PYG sans décimale). Tout se passe dans des transactions ANNULÉES.
 *
 * Attendus tirés de 19 US-514 (« Given une demande avec retour différent, When elle est soumise,
 * Then ONE_WAY_NOT_ALLOWED » ; « Given un trip BOOKED, When le voyageur ouvre le détail, Then
 * l'adresse exacte du lieu de remise s'affiche ; avant confirmation, seule la zone est visible » ;
 * « Given la fin du trip + review_window_days, When la purge tourne, Then l'adresse de l'hôte
 * disparaît de la vue du voyageur »), de 16 BKG-016 (retour au même lieu, one-way interdit ; trip
 * annulé ⇒ adresse retirée), de 08 BR-BOOK-09 (pas de one-way à la réservation) et de 08
 * BR-REVIEW-01 (fenêtre de 10 jours après la fin, `review_window_days` du pays, graine 0009),
 * jamais du code testé.
 *
 * Le devis du critère 1 est figé par la VRAIE commande de gel (US-208, US-226) avec les vecteurs du
 * checkout repris de l0-us223-request-checkout (TA01 en PA, D2 en PY) : ils ne servent qu'à obtenir
 * un devis du voyageur, aucun montant n'est vérifié ici. Interrupteurs ouverts par la procédure à
 * deux personnes d'US-125, dans la transaction annulée.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { APP_ROLES, OWNER_ROLES } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  approveDriver,
  checkoutPerson,
  frozenQuote,
  openSwitch,
  protectionParams,
  quoteDocs,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Person } from '../support/checkout.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';

/** Vecteurs du checkout (voir l'en-tête), seulement pour figer un devis. */
const VECTORS: Readonly<Record<string, CheckoutVector>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    total: 15_840,
    basicaPrice: '1/4',
    protection: 3_000,
    insurer: 2_100,
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    total: 1_415_002,
    basicaPrice: '3/20',
    protection: 150_000,
    insurer: 105_000,
  },
};

/** Fenêtre de 08 BR-REVIEW-01 (graine 0009 de `review_window_days`, PA et PY), en minutes. */
const WINDOW_MIN = 10 * 24 * 60;
/** Trip de la fixture 9948 (bien après la migration du banc : les paramètres y sont en vigueur). */
const T0 = '2035-05-02T09:17:23.000Z';
const TRIP_START = '2035-06-10T15:00:00.000Z';
const TRIP_END = '2035-06-13T15:00:00.000Z';
const LINES: Readonly<Record<string, readonly { type: string; amountMinor: string }[]>> = {
  USD: [{ type: 'TRIP_PRICE', amountMinor: '12000' }],
  PYG: [{ type: 'TRIP_PRICE', amountMinor: '1000000' }],
};
/** États où les lectures du voyageur rendent l'adresse (US-204, US-214) ; terminés ou annulés. */
const MEETING_STATES = ['BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE'];
const LIST_STATES = [...MEETING_STATES, 'UNRETURNED'];
const CLOSED_STATES = ['RETURNED', 'COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST'];

const RETURN_PLACE = 'SELECT * FROM core.booking_checkout_return_place($1, $2::uuid, $3::uuid)';
const MEET = 'SELECT * FROM core.catalog_guest_meeting_point($1, $2::uuid)';
const LIST = 'SELECT * FROM core.booking_guest_trips($1, NULL, $2::uuid, 200)';

const at = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** Scénario du devis : interrupteurs, barème de test, grille de protection (transaction annulée). */
function quoteScenario(cc: CountryCase) {
  return (fn: (tx: Tx, groups: Map<string, string>) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
        await openSwitch(tx, 'insurer_contract_active', cc.country);
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await protectionParams(tx, cc.country, v);
        await fn(tx, await taxGroups(tx, cc));
      }),
    );
}

async function guest(tx: Tx, cc: CountryCase): Promise<Person> {
  const p = await checkoutPerson(tx, cc.country);
  await approveDriver(tx, p, cc.country, { birth: '1990-01-01', licenseExpiry: '2030-12-31' });
  return p;
}

/** Annonce LISTED (fixture 9998) et lieu de son véhicule (fixture 9985). */
async function listing(tx: Tx, cc: CountryCase): Promise<{ listingId: string; place: string }> {
  const { rows } = await tx.query<{ listing_id: string; vehicle_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [cc.country, VECTORS[cc.country]!.daily, 'AUTOMATIC', true],
  );
  const v = await tx.query<{ home_location_id: string }>(
    'SELECT home_location_id FROM test_fixture.us115_vehicle_row($1)',
    [rows[0]!.vehicle_id],
  );
  return { listingId: rows[0]!.listing_id, place: v.rows[0]!.home_location_id };
}

const returnPlace = async (
  tx: Tx,
  hash: Buffer,
  quoteId: string,
  place: string | null,
): Promise<string | undefined> =>
  (await tx.query<{ outcome: string }>(RETURN_PLACE, [hash, quoteId, place])).rows.map(
    (r) => r.outcome,
  )[0];

/** Trip BOOKED de la fixture 9948 (voyageur nommé, hôte, véhicule, lieu, annonce LISTED). */
async function trip(tx: Tx, c: CountryCase, guestId: string): Promise<string> {
  await setVirtualNow(tx, T0);
  const { rows } = await tx.query<{ trip_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, guestId, TRIP_START, TRIP_END, JSON.stringify(LINES[c.currency])],
  );
  return rows[0]!.trip_id;
}

/** Ce que voit le voyageur à l'instant `iso` : lieu exact de la fiche et détail du trip. */
async function seenAt(
  tx: Tx,
  guestId: string,
  listingId: string,
  tripId: string,
  iso: string,
): Promise<{ meeting: Row[]; detail: Row | undefined }> {
  await setVirtualNow(tx, iso);
  // session ouverte à cet instant (une session ouverte en T0 serait échue)
  const s = await openSession(tx, guestId);
  return {
    meeting: (await tx.query<Row>(MEET, [s.hash, listingId])).rows,
    detail: (await tx.query<Row>(LIST, [s.hash, tripId])).rows[0],
  };
}

describe.each(COUNTRIES)('US-514 — lieux de prise et de retour ($country, $currency)', (cc) => {
  it('critère 1 : lieu de retour différent du lieu de prise ⇒ ONE_WAY_NOT_ALLOWED ; absent ou identique ⇒ DONE ; devis d’autrui ou inconnu ⇒ QUOTE_NOT_FOUND ; sans session ⇒ AUTH_REQUIRED', async () => {
    await quoteScenario(cc)(async (tx, groups) => {
      const v = VECTORS[cc.country]!;
      const p = await guest(tx, cc);
      const other = await guest(tx, cc);
      const mine = await listing(tx, cc);
      const elsewhere = await listing(tx, cc);
      expect(elsewhere.place).not.toBe(mine.place);
      const d = quoteDocs(cc, v, groups, Date.parse(START), Date.parse(NOW));
      const quoteId = await frozenQuote(tx, p, mine.listingId, d);

      // retour au même lieu (par défaut, ou nommé) : accepté
      expect(await returnPlace(tx, p.hash, quoteId, null)).toBe('DONE');
      expect(await returnPlace(tx, p.hash, quoteId, mine.place)).toBe('DONE');
      // lieu d'un autre véhicule, ou lieu inconnu : one-way, refusé
      expect(await returnPlace(tx, p.hash, quoteId, elsewhere.place)).toBe('ONE_WAY_NOT_ALLOWED');
      expect(await returnPlace(tx, p.hash, quoteId, uuid())).toBe('ONE_WAY_NOT_ALLOWED');
      // devis d'un autre voyageur ou inconnu : même réponse, aucun oracle sur le lieu
      expect(await returnPlace(tx, other.hash, quoteId, mine.place)).toBe('QUOTE_NOT_FOUND');
      expect(await returnPlace(tx, other.hash, quoteId, uuid())).toBe('QUOTE_NOT_FOUND');
      expect(await returnPlace(tx, p.hash, uuid(), mine.place)).toBe('QUOTE_NOT_FOUND');
      // session inconnue
      expect(await returnPlace(tx, randomBytes(32), quoteId, mine.place)).toBe('AUTH_REQUIRED');
      // la lecture ne rend jamais le lieu lui-même
      const raw = await tx.query<Row>(RETURN_PLACE, [p.hash, quoteId, uuid()]);
      expect(raw.fields.map((f) => f.name)).toEqual(['outcome']);
    });
  });

  it('critère 2 : trip BOOKED ⇒ l’adresse exacte est rendue au seul voyageur (fiche et détail du trip) ; la fiche publique ne la contient jamais ; trip terminé ou annulé ⇒ retirée', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guestId = uuid();
        const tripId = await trip(tx, cc, guestId);
        const listingId = (
          await tx.query<{ l: string }>('SELECT test_fixture.us514_trip_listing($1) AS l', [tripId])
        ).rows[0]!.l;
        const before = at(TRIP_START, -24 * 60);
        const seen = await seenAt(tx, guestId, listingId, tripId, before);
        expect(seen.meeting).toHaveLength(1);
        const address = seen.meeting[0]!['address_line'];
        expect(address).toEqual(expect.any(String));
        expect(seen.detail).toMatchObject({ tab: 'UPCOMING', place_address: address });

        // autre personne (sans trip de ce véhicule) : rien
        const stranger = uuid();
        await trip(tx, cc, stranger);
        await setVirtualNow(tx, before);
        const s = await openSession(tx, stranger);
        expect((await tx.query<Row>(MEET, [s.hash, listingId])).rows).toEqual([]);
        expect((await tx.query<Row>(LIST, [s.hash, tripId])).rows).toEqual([]);

        // visiteur : la fiche publique ne porte ni le libellé ni l'adresse
        const pub = await tx.query<Row>('SELECT * FROM core.catalog_public_listing($1)', [
          listingId,
        ]);
        expect(JSON.stringify(pub.rows)).not.toContain(String(address));

        // trip terminé ou annulé : plus d'adresse, ni sur la fiche ni dans le détail
        for (const status of CLOSED_STATES) {
          await tx.query('SAVEPOINT us514_status');
          await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [tripId, status]);
          const closed = await seenAt(tx, guestId, listingId, tripId, before);
          expect(closed.meeting, status).toEqual([]);
          expect(closed.detail?.['place_address'], status).toBeNull();
          await tx.query('ROLLBACK TO SAVEPOINT us514_status');
        }
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 3 : au-delà de la fin prévue + review_window_days, l’adresse disparaît de la vue du voyageur (fiche et détail), quel que soit l’état ; libellé et ville restent ; paramètre absent ⇒ jamais rendue', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guestId = uuid();
        const tripId = await trip(tx, cc, guestId);
        const listingId = (
          await tx.query<{ l: string }>('SELECT test_fixture.us514_trip_listing($1) AS l', [tripId])
        ).rows[0]!.l;
        const inside = at(TRIP_END, WINDOW_MIN - 1);
        const outside = at(TRIP_END, WINDOW_MIN + 1);
        for (const status of LIST_STATES) {
          await tx.query('SAVEPOINT us514_status');
          await setVirtualNow(tx, T0);
          if (status !== 'BOOKED') {
            await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [tripId, status]);
          }
          const a = await seenAt(tx, guestId, listingId, tripId, inside);
          expect(a.detail?.['place_address'], `${status} dans la fenêtre`).toEqual(
            expect.any(String),
          );
          expect(a.meeting, `${status} dans la fenêtre`).toHaveLength(
            MEETING_STATES.includes(status) ? 1 : 0,
          );
          const b = await seenAt(tx, guestId, listingId, tripId, outside);
          expect(b.meeting, `${status} après la fenêtre`).toEqual([]);
          expect(b.detail, `${status} après la fenêtre`).toMatchObject({
            item_id: tripId,
            place_address: null,
            place_label: a.detail?.['place_label'],
            place_city: a.detail?.['place_city'],
          });
          await tx.query('ROLLBACK TO SAVEPOINT us514_status');
        }

        // paramètre du pays fermé (absent) : fail-closed, aucune adresse même dans la fenêtre
        await setVirtualNow(tx, at(TRIP_START, -24 * 60));
        await tx.query('SELECT test_fixture.us514_close_review_window($1)', [cc.country]);
        const closed = await seenAt(tx, guestId, listingId, tripId, at(TRIP_START, -23 * 60));
        expect(closed.meeting).toEqual([]);
        expect(closed.detail).toMatchObject({ tab: 'UPCOMING', place_address: null });
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-514 — lieu figé à la réservation et droits (0144)', () => {
  it('aucun rôle applicatif ni propriétaire de commandes ne peut modifier un lieu ni le lieu d’un véhicule', async () => {
    const roles = [...APP_ROLES, ...OWNER_ROLES];
    const columns: [string, string][] = [
      ...['kind', 'place_label', 'address_line', 'city', 'area_label', 'geo', 'geo_public'].map(
        (c): [string, string] => ['core.catalog_location', c],
      ),
      ['core.catalog_vehicle', 'home_location_id'],
    ];
    await withRole('app_api', async (client) => {
      const writable: string[] = [];
      for (const role of roles) {
        for (const [table, column] of columns) {
          const { rows } = await client.query<{ ok: boolean }>(
            `SELECT pg_catalog.has_column_privilege($1::name, $2::regclass, $3::text, 'UPDATE') AS ok`,
            [role, table, column],
          );
          if (rows[0]?.ok === true) writable.push(`${role} ${table}.${column}`);
        }
      }
      expect(writable).toEqual([]);
    });
  });

  it('app_worker et app_anon n’exécutent pas la lecture du lieu de retour (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          await expect(
            client.query(RETURN_PLACE, [randomBytes(32), uuid(), uuid()]),
            role,
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });
});
