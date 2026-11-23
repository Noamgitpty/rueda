/**
 * US-007 (suite, N-468) — refus rapide de la pose perdante sous le verrou du véhicule (migration
 * 0179, ADR-199 ; 17 §2.5 étape 2, 2d ; ADR-056 point 4).
 *
 * Attendu (17 §2.5 2d : « violation d'exclusion (`23P01`) ⇒ 409 VEHICLE_UNAVAILABLE ; jamais de
 * DETAIL PostgreSQL dans la réponse (M9) » ; ADR-199, jamais du code testé) :
 * - créneau pris par une occupation DÉFINITIVE (hold vivant, trip) : refus aussitôt, même erreur que
 *   la contrainte (`23P01`, `vehicle_occupancy_no_overlap`, traduite `VEHICLE_UNAVAILABLE`), sans
 *   `DETAIL` (le refus rapide n'en pose aucun : c'est sa marque), rien n'est écrit ;
 * - conflit qu'un hold échu pourrait lever (2a) : le chemin complet est suivi. Hold en paiement
 *   protégé (C5) : l'insertion échoue sur l'exclusion GiST elle-même (`23P01` AVEC le `DETAIL` de
 *   PostgreSQL, que l'API ne renvoie jamais) : l'exclusion reste la garde ; hold échu non balayé
 *   (C9) : 2a l'expire et la pose réussit ;
 * - ordre des refus (ADR-199, PROPOSÉ) : un créneau définitivement pris passe avant la limite de
 *   holds vivants du voyageur ; sur un créneau libre, la limite refuse comme avant.
 * Rôles de production seulement (`app_api` voyageur, `app_worker` `hold_expiry` pour relire ;
 * assertion L0-05 par connectAs). En USD (PA) et en PYG (PY). Horloge virtuelle (`platform.now()`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot } from '../support/avl.ts';
import { ensureParties, placeHoldCommand, registerVehicles } from '../support/concurrency.ts';

interface Outcome {
  readonly holdId?: string;
  readonly code?: string;
  readonly raw?: {
    readonly code: string | undefined;
    readonly constraint: string | undefined;
    /** `DETAIL` de PostgreSQL : présent sur l'erreur de l'index, absent du refus rapide. */
    readonly hasDetail: boolean;
  };
}

/** Pose par la commande réelle, validée ; erreur traduite et marques brutes du refus. */
async function pose(
  api: pg.ClientBase,
  guestId: string,
  slot: Slot,
  when: string,
): Promise<Outcome> {
  try {
    const holdId = await inTx(api, { virtualNow: when, commit: true }, (tx) =>
      placeHoldCommand(tx, { slot, guestId, flagged: false }),
    );
    return { holdId };
  } catch (error) {
    const e = error as { code?: string; constraint?: string; detail?: string };
    return {
      code: translateDbError(error).code,
      raw: {
        code: e.code,
        constraint: e.constraint,
        hasDetail: typeof e.detail === 'string' && e.detail !== '',
      },
    };
  }
}

/** Un compte d'hôte, ses véhicules au registre de test et des voyageurs, créés et validés. */
async function world(
  api: pg.ClientBase,
  c: CountryCase,
  vehicles: number,
  guests: number,
): Promise<{ orgId: string; vehicles: string[]; guests: string[] }> {
  const orgId = uuid();
  const v = Array.from({ length: vehicles }, () => uuid());
  const g = Array.from({ length: guests }, () => uuid());
  await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, g, orgId, c);
    await registerVehicles(tx, v, orgId, c);
  });
  return { orgId, vehicles: v, guests: g };
}

/** Créneau de deux jours, `days` jours après `base`, tampon de 2 h. */
const slotOf = (vehicleId: string, orgId: string, base: string, days = 7): Slot => {
  const start = new Date(Date.parse(base) + days * 86_400_000);
  return {
    vehicleId,
    orgId,
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
    bufferHours: 2,
  };
};

/** Holds et occupations actives d'un véhicule (travailleur `hold_expiry`, lecture seule). */
async function vehicleState(
  worker: pg.ClientBase,
  vehicleId: string,
): Promise<{ holds: { guest: string; status: string }[]; active: number; total: number }> {
  return inTx(worker, { worker: 'hold_expiry' }, async (tx) => {
    const h = await tx.query<{ guest: string; status: string }>(
      `SELECT guest_user_id::text AS guest, status FROM core.booking_checkout_hold
        WHERE vehicle_id = $1 ORDER BY created_at`,
      [vehicleId],
    );
    const o = await tx.query<{ active: number; total: number }>(
      `SELECT count(*) FILTER (WHERE active)::int AS active, count(*)::int AS total
         FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1`,
      [vehicleId],
    );
    return {
      holds: h.rows,
      active: o.rows[0]?.active ?? -1,
      total: o.rows[0]?.total ?? -1,
    };
  });
}

/** Opération de loyer PENDING du hold (fixture de T1, US-024) puis PAYMENT_IN_FLIGHT. */
async function paymentInFlight(
  api: pg.ClientBase,
  holdId: string,
  c: CountryCase,
  when: string,
  until: string,
): Promise<void> {
  await inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    await tx.query(
      `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, 'CAPTURE', 'RENT', 'PENDING')`,
      [uuid(), holdId, c.country, c.currency, c.rentMinor],
    );
    await tx.query('SELECT test_fixture.l0_set_payment_in_flight($1, $2::timestamptz)', [
      holdId,
      until,
    ]);
  });
}

const FAST_REFUSAL = {
  code: 'VEHICLE_UNAVAILABLE',
  raw: { code: '23P01', constraint: 'vehicle_occupancy_no_overlap', hasDetail: false },
} as const;

let api: pg.Client;
let worker: pg.Client;

// connexions ouvertes par test : chaque test fait ainsi son assertion L0-05 (setup-l0-05)
beforeEach(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterEach(async () => {
  await releaseClient(worker);
  await releaseClient(api);
});

describe.each(COUNTRIES)('US-007 — refus rapide de la pose perdante ($country, $currency)', (c) => {
  it('hold vivant de A : la pose de B est refusée aussitôt (23P01, sans DETAIL), rien n’est écrit', async () => {
    const T0 = '2034-07-02T10:00:00.000Z';
    const w = await world(api, c, 1, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    expect((await pose(api, a, slot, T0)).code).toBeUndefined();
    const before = await vehicleState(worker, slot.vehicleId);

    // même créneau, puis chevauchement partiel (un jour plus tard) : refus rapide les deux fois
    expect(await pose(api, b, slot, at(T0, 1))).toEqual(FAST_REFUSAL);
    const shifted = { ...slot, start: at(slot.start, 24 * 60), end: at(slot.end, 24 * 60) };
    expect(await pose(api, b, shifted, at(T0, 2))).toEqual(FAST_REFUSAL);

    expect(await vehicleState(worker, slot.vehicleId)).toEqual(before);
    expect(before).toEqual({ holds: [{ guest: a, status: 'ACTIVE' }], active: 1, total: 1 });

    // hors du créneau occupé (tampon compris) : la pose de B passe
    const after = slotOf(slot.vehicleId, w.orgId, T0, 10);
    expect((await pose(api, b, after, at(T0, 3))).code).toBeUndefined();
  });

  it('trip BOOKED sur le créneau : refus rapide (23P01, sans DETAIL), aucun hold posé', async () => {
    const T0 = '2034-07-04T10:00:00.000Z';
    const w = await world(api, c, 1, 1);
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    await bookTrip(api, worker, slot, c, T0);
    const before = await vehicleState(worker, slot.vehicleId);

    expect(await pose(api, w.guests[0] as string, slot, at(T0, 5))).toEqual(FAST_REFUSAL);
    expect(await vehicleState(worker, slot.vehicleId)).toEqual(before);
  });

  it('hold en paiement protégé après expires_at (C5) : chemin complet, refus par l’exclusion GiST elle-même (23P01 avec DETAIL)', async () => {
    const T0 = '2034-07-06T10:00:00.000Z';
    const w = await world(api, c, 1, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const holdA = (await pose(api, a, slot, T0)).holdId as string;
    // T1 à T0 + 8 min : borne provisoire T0 + 14 min ; à T0 + 12 min, A est échu mais protégé
    await paymentInFlight(api, holdA, c, at(T0, 8), at(T0, 14));

    const racing = await pose(api, b, slot, at(T0, 12));
    expect(racing).toEqual({
      code: 'VEHICLE_UNAVAILABLE',
      raw: { code: '23P01', constraint: 'vehicle_occupancy_no_overlap', hasDetail: true },
    });
    expect(await vehicleState(worker, slot.vehicleId)).toEqual({
      holds: [{ guest: a, status: 'PAYMENT_IN_FLIGHT' }],
      active: 1,
      total: 1,
    });
  });

  it('hold échu non balayé (C9) : pas de refus rapide, 2a l’expire et la pose de B réussit', async () => {
    const T0 = '2034-07-08T10:00:00.000Z';
    const w = await world(api, c, 1, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    expect((await pose(api, a, slot, T0)).code).toBeUndefined();
    // hold_ttl_minutes = 10 (17 §7.2) : échu à T0 + 10 min, aucune tâche d'expiration lancée
    const later = await pose(api, b, slot, at(T0, 11));
    expect(later.code).toBeUndefined();
    expect(await vehicleState(worker, slot.vehicleId)).toEqual({
      holds: [
        { guest: a, status: 'EXPIRED' },
        { guest: b, status: 'ACTIVE' },
      ],
      active: 1,
      total: 2,
    });
  });

  it('ordre des refus (ADR-199) : créneau pris ⇒ VEHICLE_UNAVAILABLE avant la limite de holds ; créneau libre ⇒ HOLD_LIMIT_REACHED', async () => {
    const T0 = '2034-07-10T10:00:00.000Z';
    const taken = await world(api, c, 1, 1);
    const elsewhere = await world(api, c, 3, 1);
    const holder = taken.guests[0] as string;
    const guest = elsewhere.guests[0] as string;
    const takenSlot = slotOf(taken.vehicles[0] as string, taken.orgId, T0);
    expect((await pose(api, holder, takenSlot, T0)).code).toBeUndefined();
    // max_active_holds_per_guest = 2 (17 §7.2) : deux holds vivants du voyageur ailleurs
    for (const v of elsewhere.vehicles.slice(0, 2)) {
      expect((await pose(api, guest, slotOf(v, elsewhere.orgId, T0), T0)).code).toBeUndefined();
    }
    expect(await pose(api, guest, takenSlot, at(T0, 1))).toEqual(FAST_REFUSAL);
    const free = slotOf(elsewhere.vehicles[2] as string, elsewhere.orgId, T0);
    const limited = await pose(api, guest, free, at(T0, 1));
    expect(limited.code).toBe('HOLD_LIMIT_REACHED');
    expect(limited.raw).toMatchObject({ code: '55000', constraint: 'hold_guest_limit' });
  });
});
