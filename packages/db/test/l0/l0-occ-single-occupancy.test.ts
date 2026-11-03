/**
 * US-022 — table d'occupation unique (16 CAL-011, CAL-004 ; 08 BR-BOOK-05, BR-BOOK-07,
 * BR-BOOK-10 ; 17 §2.5, §3.2.4 ; C1, EC-51, EC-19 ; migration 0029, ADR-060).
 *
 * Attendu (valeurs de 19 US-022, 16 CAL-011 / CAL-004, 17 §2.5 et §7.2, jamais du code testé) :
 * - une seule exclusion GiST pour tous les canaux : un blocage de l'hôte chevauchant un trip
 *   confirmé, un hold, un autre blocage ou un tampon est refusé `VEHICLE_UNAVAILABLE`, et
 *   réciproquement ; un blocage levé (`BLOCK_REMOVED`) libère le créneau ; bornes semi-ouvertes ;
 * - tampon de 2 h (`buffer_minutes` = 120, 17 §7.2) matérialisé après la fin : retour à 12:00,
 *   départ à 13:00 indisponible, à 14:00 disponible ; tampon autonome `BUFFER` posé par
 *   `trip_lifecycle` après un trip rendu, jamais sur un trip en cours ;
 * - I-OCC : un trip `BOOKED` sans occupation `TRIP` active est refusé au COMMIT ;
 * - cloisonnement : hôte contre hôte, co-hôte hors portée, même titulaire dans un autre pays,
 *   contexte absent ou d'un autre type ⇒ `FORBIDDEN`, sans rien révéler ; lectures par compte
 *   d'hôte, portée de véhicules et pays ;
 * - concurrence C1 « quel que soit le canal » : poses de hold et blocages concurrents du même
 *   créneau ⇒ exactement une occupation, les autres `VEHICLE_UNAVAILABLE`, 0 `40P01`.
 * Rôles de production seulement (`app_api`, `app_worker` ; assertion L0-05 par connectAs /
 * withRole). En USD (PA) et en PYG (PY).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import type { SessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import {
  at,
  convert,
  COUNTRIES,
  inTx,
  insertRentOperation,
  placeHold,
  receiveProof,
  uuid,
} from '../support/avl.ts';
import type { CountryCase, Slot } from '../support/avl.ts';
import {
  activeOccupancies,
  Barrier,
  ensureParties,
  percentile,
  placeHoldLocked,
  withReplay,
} from '../support/concurrency.ts';
import type { Replayed } from '../support/concurrency.ts';
import { asActor, buildWorld, sorted } from '../support/rls.ts';
import type { CountryWorld, World } from '../support/rls.ts';

let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

/** Tampon par défaut des deux pays (17 §7.2, BR-BOOK-05 : 2 h). */
const BUFFER_MINUTES = 120;

const BLOCK = `SELECT core.booking_cmd_place_host_block($1, $2::timestamptz, $3::timestamptz) AS id`;
const UNBLOCK = `SELECT core.booking_cmd_remove_host_block($1) AS removed`;
const BUFFER = `SELECT core.booking_cmd_place_buffer($1, $2::timestamptz) AS id`;

const worldOf = (c: CountryCase): CountryWorld => {
  const x = world.countries.find((k) => k.c.country === c.country);
  if (!x) throw new Error(`pays ${c.country}`);
  return x;
};
const otherWorld = (c: CountryCase): CountryWorld => {
  const x = world.countries.find((k) => k.c.country !== c.country);
  if (!x) throw new Error('second pays');
  return x;
};
const holderA = (x: CountryWorld): SessionContext => ({
  kind: 'HOST',
  actorId: world.holderA,
  orgId: x.orgA,
});

/** Instant ISO d'un jour de 2033 (hors des périodes du monde RLS, 2031-2032). */
const d = (month: number, day: number, hour = 10): string =>
  new Date(Date.UTC(2033, month - 1, day, hour)).toISOString();

/** Tentative dans un SAVEPOINT : `OK` ou le code métier traduit (sans détail). */
async function attempt(
  tx: pg.ClientBase,
  sql: string,
  params: readonly unknown[],
): Promise<string> {
  await tx.query('SAVEPOINT attempt');
  try {
    await tx.query(sql, [...params]);
    await tx.query('RELEASE SAVEPOINT attempt');
    return 'OK';
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT attempt');
    return translateDbError(error).code;
  }
}

/** Pose d'un hold par la fixture (qui tient lieu de cmd_place_hold, US-023), en SAVEPOINT. */
async function holdAttempt(
  tx: pg.ClientBase,
  vehicleId: string,
  orgId: string,
  c: CountryCase,
  period: string,
): Promise<string> {
  return attempt(
    tx,
    `SELECT test_fixture.place_hold($1, $2, $3, $4, $5, $6, $7::tstzrange, '10 minutes'::interval)`,
    [uuid(), uuid(), uuid(), vehicleId, orgId, c.country, period],
  );
}

const occupied = async (
  tx: pg.ClientBase,
  start: string,
  end: string,
  minutes: number,
): Promise<string> => {
  const r = await tx.query<{ p: string }>(
    `SELECT core.booking_occupied_period($1::timestamptz, $2::timestamptz, $3)::text AS p`,
    [start, end, minutes],
  );
  return r.rows[0]?.p as string;
};

/** Hold (période calculée en base, tampon du pays), preuve et conversion : trip BOOKED. */
async function bookWithDbBuffer(
  c: CountryCase,
  slot: Slot,
  t0: string,
): Promise<{ tripId: string }> {
  const api = await connectAs('app_api');
  const worker = await connectAs('app_worker');
  try {
    const { hold, operationId } = await inTx(api, { virtualNow: t0, commit: true }, async (tx) => {
      const b = await tx.query<{ m: number }>('SELECT core.booking_buffer_minutes($1) AS m', [
        c.country,
      ]);
      const period = await occupied(tx, slot.start, slot.end, b.rows[0]?.m as number);
      const placed = await placeHold(tx, slot, c, uuid(), period);
      return { hold: placed, operationId: await insertRentOperation(tx, placed) };
    });
    await inTx(worker, { worker: 'webhook_ingest', virtualNow: at(t0, 2), commit: true }, (tx) =>
      receiveProof(tx, operationId),
    );
    const r = await inTx(
      worker,
      { worker: 'booking_conversion', virtualNow: at(t0, 2), commit: true },
      (tx) => convert(tx, hold, operationId),
    );
    if (r.kind !== 'TRIP') throw new Error(`conversion inattendue : ${r.kind}`);
    return { tripId: r.tripId };
  } finally {
    await releaseClient(api);
    await releaseClient(worker);
  }
}

/** Blocage validé (COMMIT) par l'hôte titulaire du compte A du pays. */
async function committedBlock(x: CountryWorld, vehicleId: string, start: string, end: string) {
  const api = await connectAs('app_api');
  try {
    return await withTestTransaction(api, { commit: true }, async (tx) => {
      await setSessionContext(tx, holderA(x));
      const r = await tx.query<{ id: string }>(BLOCK, [vehicleId, start, end]);
      return r.rows[0]?.id as string;
    });
  } finally {
    await releaseClient(api);
  }
}

const OCC = `SELECT test_fixture.occ_insert_raw($1, $2, $3, $4, $5, $6::tstzrange)`;
const HOLD = `SELECT test_fixture.hold_insert_raw($1, $2, $3, $4, $5, $6)`;
const FREE = `[${d(1, 10)},${d(1, 12)})`; // aucun chevauchement avec le trip a1 de v1
describe.each(COUNTRIES)('US-022 — table d’occupation unique ($country, $currency)', (c) => {
  it('fonctions de période : tampon du pays = 120 min ; [début, fin + tampon) semi-ouvert ; bornes invalides refusées', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const b = await tx.query<{ m: number }>('SELECT core.booking_buffer_minutes($1) AS m', [
          c.country,
        ]);
        expect(b.rows[0]?.m).toBe(BUFFER_MINUTES);
        const r = await tx.query<{ lo: Date; hi: Date; li: boolean; ui: boolean }>(
          `SELECT lower(p) AS lo, upper(p) AS hi, lower_inc(p) AS li, upper_inc(p) AS ui
             FROM core.booking_occupied_period($1::timestamptz, $2::timestamptz, $3) AS p`,
          [d(5, 10, 8), d(5, 10, 12), BUFFER_MINUTES],
        );
        expect(r.rows[0]).toEqual({
          lo: new Date(d(5, 10, 8)),
          hi: new Date(d(5, 10, 14)),
          li: true,
          ui: false,
        });
        expect(
          await attempt(tx, 'SELECT core.booking_occupied_period($1, $1, 0)', [d(5, 10)]),
        ).toBe('INVALID_PERIOD');
        expect(
          await attempt(tx, 'SELECT core.booking_occupied_period($1, $2, -1)', [
            d(5, 10),
            d(5, 11),
          ]),
        ).toBe('INVALID_PERIOD');
      });
    });
  });

  it('blocage de l’hôte : refusé sur un trip confirmé, un hold, un blocage ; levée = créneau libéré (VEHICLE_UNAVAILABLE)', async () => {
    const x = worldOf(c);
    await withRole('app_api', async (client) => {
      // trip confirmé a1 sur v1 (BR-BOOK-07, CAL-011 : l'hôte doit annuler explicitement)
      const trip = await asActor(client, holderA(x), async (tx) => {
        const r = await tx.query<{ s: Date; e: Date }>(
          `SELECT scheduled_start AS s, scheduled_end AS e FROM core.booking_trip WHERE id = $1`,
          [x.trips.a1.id],
        );
        return r.rows[0];
      });
      expect(trip).toBeDefined();
      const inside = new Date((trip?.s as Date).getTime() + 3_600_000).toISOString();
      const after = new Date((trip?.e as Date).getTime() + 30 * 86_400_000).toISOString();

      await asActor(client, holderA(x), async (tx) => {
        expect(await attempt(tx, BLOCK, [x.v1, inside, after])).toBe('VEHICLE_UNAVAILABLE');

        const v = uuid(); // véhicule neuf du compte A (titulaire : tous les véhicules du compte)
        const blk = await tx.query<{ id: string }>(BLOCK, [v, d(3, 1), d(3, 3)]);
        const blockId = blk.rows[0]?.id as string;
        expect(blockId).toMatch(/^[0-9a-f-]{36}$/);
        // autre blocage chevauchant : refusé ; adjacent (borne haute exclue) : accepté
        expect(await attempt(tx, BLOCK, [v, d(3, 2), d(3, 4)])).toBe('VEHICLE_UNAVAILABLE');
        expect(await attempt(tx, BLOCK, [v, d(3, 3), d(3, 4)])).toBe('OK');
        // hold sur le blocage : refusé par la même exclusion
        expect(await holdAttempt(tx, v, x.orgA, c, `[${d(3, 2)},${d(3, 5)})`)).toBe(
          'VEHICLE_UNAVAILABLE',
        );
        // blocage sur un hold : refusé
        expect(await holdAttempt(tx, v, x.orgA, c, `[${d(4, 1)},${d(4, 3)})`)).toBe('OK');
        expect(await attempt(tx, BLOCK, [v, d(4, 2), d(4, 5)])).toBe('VEHICLE_UNAVAILABLE');

        // période invalide : fin <= début, ou déjà passée
        expect(await attempt(tx, BLOCK, [v, d(6, 2), d(6, 1)])).toBe('INVALID_PERIOD');
        expect(await attempt(tx, BLOCK, [v, '2001-01-01T00:00:00Z', '2001-01-02T00:00:00Z'])).toBe(
          'INVALID_PERIOD',
        );

        // lecture du calendrier : compte, pays, type et source ; aucune référence de hold
        const rows = await tx.query<{
          kind: string;
          source: string;
          org_id: string;
          country_code: string;
          active: boolean;
        }>(
          `SELECT kind, source, org_id, country_code, active FROM core.booking_vehicle_occupancy
            WHERE vehicle_id = $1 ORDER BY lower(period)`,
          [v],
        );
        expect(rows.rows).toEqual([
          {
            kind: 'HOST_BLOCK',
            source: 'MANUAL',
            org_id: x.orgA,
            country_code: c.country,
            active: true,
          },
          {
            kind: 'HOST_BLOCK',
            source: 'MANUAL',
            org_id: x.orgA,
            country_code: c.country,
            active: true,
          },
          {
            kind: 'HOLD',
            source: 'CHECKOUT',
            org_id: x.orgA,
            country_code: c.country,
            active: true,
          },
        ]);

        // levée : true, puis rejeu idempotent false ; le créneau est libre pour un hold
        const u1 = await tx.query<{ removed: boolean }>(UNBLOCK, [blockId]);
        expect(u1.rows[0]?.removed).toBe(true);
        const u2 = await tx.query<{ removed: boolean }>(UNBLOCK, [blockId]);
        expect(u2.rows[0]?.removed).toBe(false);
        const gone = await tx.query<{ active: boolean; reason: string }>(
          `SELECT active, deactivated_reason AS reason FROM core.booking_vehicle_occupancy WHERE id = $1`,
          [blockId],
        );
        expect(gone.rows).toEqual([{ active: false, reason: 'BLOCK_REMOVED' }]);
        expect(await holdAttempt(tx, v, x.orgA, c, `[${d(3, 1)},${d(3, 3)})`)).toBe('OK');
      });
    });
  });

  it('tampon de 2 h : retour à 12:00, départ à 13:00 indisponible, à 14:00 disponible (hold et blocage)', async () => {
    const x = worldOf(c);
    const slot: Slot = {
      vehicleId: uuid(),
      orgId: x.orgA,
      start: d(5, 10, 8),
      end: d(5, 10, 12),
      bufferHours: 2,
    };
    await bookWithDbBuffer(c, slot, d(5, 1));
    await withRole('app_api', async (client) => {
      await asActor(client, holderA(x), async (tx) => {
        const occ = await tx.query<{ kind: string; hi: Date }>(
          `SELECT kind, upper(period) AS hi FROM core.booking_vehicle_occupancy
            WHERE vehicle_id = $1 AND active`,
          [slot.vehicleId],
        );
        expect(occ.rows).toEqual([{ kind: 'TRIP', hi: new Date(d(5, 10, 14)) }]);
        const p13 = await occupied(tx, d(5, 10, 13), d(5, 11, 13), BUFFER_MINUTES);
        expect(await holdAttempt(tx, slot.vehicleId, x.orgA, c, p13)).toBe('VEHICLE_UNAVAILABLE');
        expect(await attempt(tx, BLOCK, [slot.vehicleId, d(5, 10, 13), d(5, 10, 18)])).toBe(
          'VEHICLE_UNAVAILABLE',
        );
        expect(await attempt(tx, BLOCK, [slot.vehicleId, d(5, 10, 14), d(5, 10, 18)])).toBe('OK');
      });
      // même départ à 14:00 par un hold (transaction distincte, le blocage ci-dessus est annulé)
      await asActor(client, holderA(x), async (tx) => {
        const p14 = await occupied(tx, d(5, 10, 14), d(5, 11, 14), BUFFER_MINUTES);
        expect(await holdAttempt(tx, slot.vehicleId, x.orgA, c, p14)).toBe('OK');
      });
    });
  });

  it('I-OCC : un trip BOOKED sans occupation TRIP active, ou dont l’occupation est désactivée, est refusé au COMMIT', async () => {
    const x = worldOf(c);
    const slot: Slot = {
      vehicleId: uuid(),
      orgId: x.orgA,
      start: d(7, 10, 8),
      end: d(7, 12, 8),
      bufferHours: 2,
    };
    const { tripId } = await bookWithDbBuffer(c, slot, d(7, 1));
    await withRole('app_worker', async (worker) => {
      const refused = async (p: Promise<unknown>, constraint: string): Promise<void> => {
        let caught: unknown;
        try {
          await p;
        } catch (error) {
          caught = error;
        }
        expect(caught, 'le COMMIT devait être refusé').toMatchObject({ code: '23000', constraint });
        expect(translateDbError(caught)).toEqual({ code: 'INVARIANT_VIOLATION', retryable: false });
      };
      await refused(
        inTx(worker, { worker: 'trip_lifecycle', commit: true }, (tx) =>
          tx.query(
            `UPDATE core.booking_vehicle_occupancy
                SET active = false, deactivated_reason = 'TRIP_TERMINAL'
              WHERE ref_id = $1 AND kind = 'TRIP'`,
            [tripId],
          ),
        ),
        'occupancy_trip_guard',
      );
      await refused(
        inTx(worker, { worker: 'booking_conversion', commit: true }, (tx) =>
          tx.query(
            `INSERT INTO core.booking_trip (id, guest_user_id, org_id, vehicle_id, country_code,
                                            currency, timezone, scheduled_start, scheduled_end, status)
             SELECT $1, guest_user_id, org_id, $2, country_code, currency, timezone,
                    $3::timestamptz, $4::timestamptz, 'BOOKED'
               FROM core.booking_trip WHERE id = $5`,
            [uuid(), uuid(), d(8, 1), d(8, 2), tripId],
          ),
        ),
        'trip_has_active_occupancy',
      );
    });
  });

  it('tampon autonome BUFFER : posé par trip_lifecycle après le retour, refusé sur un trip en cours ou par un autre acteur', async () => {
    const x = worldOf(c);
    const slot: Slot = {
      vehicleId: uuid(),
      orgId: x.orgA,
      start: d(9, 10, 8),
      end: d(9, 14, 8),
      bufferHours: 2,
    };
    const { tripId } = await bookWithDbBuffer(c, slot, d(9, 1));
    const returnedAt = d(9, 11, 9); // fin anticipée
    const worker = await connectAs('app_worker');
    try {
      // trip en cours (BOOKED) : aucun tampon autonome
      const early = await inTx(worker, { worker: 'trip_lifecycle' }, (tx) =>
        attempt(tx, BUFFER, [tripId, returnedAt]),
      );
      expect(early).toBe('INVALID_TRANSITION');
      // autre travailleur, ou rôle sans EXECUTE : refus
      const other = await inTx(worker, { worker: 'hold_expiry' }, (tx) =>
        attempt(tx, BUFFER, [tripId, returnedAt]),
      );
      expect(other).toBe('FORBIDDEN');

      // retour : trip RETURNED, occupation TRIP désactivée (état qui ne tient plus le créneau)
      const bufferId = await inTx(
        worker,
        { worker: 'trip_lifecycle', commit: true },
        async (tx) => {
          await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('veh:' || $1::text, 0))`, [
            slot.vehicleId,
          ]);
          await tx.query(`UPDATE core.booking_trip SET status = 'RETURNED' WHERE id = $1`, [
            tripId,
          ]);
          await tx.query(
            `UPDATE core.booking_vehicle_occupancy
              SET active = false, deactivated_reason = 'TRIP_TERMINAL'
            WHERE ref_id = $1 AND kind = 'TRIP' AND active`,
            [tripId],
          );
          await tx.query(
            `UPDATE core.booking_guest_occupancy SET active = false WHERE trip_id = $1`,
            [tripId],
          );
          expect(await attempt(tx, BUFFER, [tripId, d(9, 1)])).toBe('INVALID_PERIOD');
          const r = await tx.query<{ id: string }>(BUFFER, [tripId, returnedAt]);
          return r.rows[0]?.id as string;
        },
      );
      const row = await inTx(worker, { worker: 'trip_lifecycle' }, async (tx) => {
        const r = await tx.query(
          `SELECT kind, source, ref_type, ref_id, org_id, country_code, active,
                  lower(period) AS lo, upper(period) AS hi
             FROM core.booking_vehicle_occupancy WHERE id = $1`,
          [bufferId],
        );
        return r.rows[0];
      });
      expect(row).toEqual({
        kind: 'BUFFER',
        source: 'SYSTEM',
        ref_type: 'TRIP',
        ref_id: tripId,
        org_id: x.orgA,
        country_code: c.country,
        active: true,
        lo: new Date(returnedAt),
        hi: new Date(d(9, 11, 11)),
      });
    } finally {
      await releaseClient(worker);
    }
    await withRole('app_api', async (client) => {
      await expect(
        asActor(client, holderA(x), (tx) => tx.query(BUFFER, [tripId, returnedAt])),
      ).rejects.toMatchObject({ code: '42501' });
      await asActor(client, holderA(x), async (tx) => {
        expect(
          await holdAttempt(tx, slot.vehicleId, x.orgA, c, `[${d(9, 11, 10)},${d(9, 12)})`),
        ).toBe('VEHICLE_UNAVAILABLE');
        expect(
          await holdAttempt(tx, slot.vehicleId, x.orgA, c, `[${d(9, 11, 11)},${d(9, 12)})`),
        ).toBe('OK');
      });
    });
  });

  it('cloisonnement des écritures : hôte contre hôte, co-hôte hors portée, autre pays, autre acteur ⇒ FORBIDDEN', async () => {
    const x = worldOf(c);
    const y = otherWorld(c);
    const v = uuid();
    const blockId = await committedBlock(x, v, d(10, 1), d(10, 3));
    await withRole('app_api', async (client) => {
      const deny = async (ctx: SessionContext | null, sql: string, params: unknown[]) =>
        withTestTransaction(client, {}, async (tx) => {
          if (ctx !== null) await setSessionContext(tx, ctx);
          return attempt(tx, sql, params);
        });
      const free = [d(11, 1), d(11, 2)];
      // co-hôte : v1 dans sa portée, v2 non ; co-hôte retiré : rien
      expect(
        await deny({ kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, BLOCK, [x.v1, ...free]),
      ).toBe('OK');
      expect(
        await deny({ kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, BLOCK, [x.v2, ...free]),
      ).toBe('FORBIDDEN');
      expect(
        await deny({ kind: 'HOST', actorId: world.exCohost, orgId: x.orgA }, BLOCK, [
          x.v1,
          ...free,
        ]),
      ).toBe('FORBIDDEN');
      // hôte B : véhicule du compte A, ou compte A forgé dans le contexte
      const hostB: SessionContext = { kind: 'HOST', actorId: x.holderB, orgId: x.orgB };
      expect(await deny(hostB, BLOCK, [x.v1, ...free])).toBe('FORBIDDEN');
      expect(await deny(hostB, BLOCK, [v, ...free])).toBe('FORBIDDEN');
      expect(
        await deny({ kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, BLOCK, [x.v1, ...free]),
      ).toBe('FORBIDDEN');
      // même titulaire, compte d'hôte de l'autre pays : véhicule de ce pays refusé
      expect(await deny(holderA(y), BLOCK, [x.v1, ...free])).toBe('FORBIDDEN');
      // autres types d'acteur, contexte absent
      for (const ctx of [
        null,
        { kind: 'GUEST', actorId: world.guest1 },
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [c.country] },
        { kind: 'WORKER', workerName: 'trip_lifecycle' },
      ] as (SessionContext | null)[]) {
        expect(await deny(ctx, BLOCK, [v, ...free]), JSON.stringify(ctx)).toBe('FORBIDDEN');
        expect(await deny(ctx, UNBLOCK, [blockId]), JSON.stringify(ctx)).toBe('FORBIDDEN');
      }
      // levée : blocage d'un autre compte, hors portée, d'un autre pays, inconnu, ou trip
      const tripOcc = await asActor(client, holderA(x), async (tx) => {
        const r = await tx.query<{ id: string }>(
          `SELECT id FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1 AND kind = 'TRIP'`,
          [x.v1],
        );
        return r.rows[0]?.id as string;
      });
      expect(tripOcc).toBeDefined();
      expect(await deny(hostB, UNBLOCK, [blockId])).toBe('FORBIDDEN');
      expect(
        await deny({ kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, UNBLOCK, [blockId]),
      ).toBe('FORBIDDEN');
      expect(await deny(holderA(y), UNBLOCK, [blockId])).toBe('FORBIDDEN');
      expect(await deny(holderA(x), UNBLOCK, [uuid()])).toBe('FORBIDDEN');
      expect(await deny(holderA(x), UNBLOCK, [tripOcc])).toBe('FORBIDDEN');
      // rien n'a changé : le blocage est toujours actif
      const still = await asActor(client, holderA(x), async (tx) => {
        const r = await tx.query<{ active: boolean }>(
          `SELECT active FROM core.booking_vehicle_occupancy WHERE id = $1`,
          [blockId],
        );
        return r.rows;
      });
      expect(still).toEqual([{ active: true }]);
      // écriture directe : aucun droit (17 §2.3, VERIF_17-A1)
      await expect(
        asActor(client, holderA(x), (tx) =>
          tx.query(`UPDATE core.booking_vehicle_occupancy SET active = false WHERE id = $1`, [
            blockId,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('un véhicule = un compte, sans la pré-vérification : occupation d’un autre compte ⇒ 23P01 occupancy_vehicle_single_org, traduit FORBIDDEN', async () => {
    // Revue QA US-022, constat 1 : la fixture 9310 écrit SANS contrôle préalable (chemin de
    // cmd_place_hold, US-023) ; seule la contrainte de 0029 peut refuser.
    const x = worldOf(c);
    const y = otherWorld(c);
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const raw = async (
          sql: string,
          params: readonly unknown[],
        ): Promise<{
          code?: string | undefined;
          constraint?: string | undefined;
          business?: string;
        }> => {
          await tx.query('SAVEPOINT raw');
          try {
            await tx.query(sql, [...params]);
            await tx.query('RELEASE SAVEPOINT raw');
            return {};
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT raw');
            const e = error as { code?: string; constraint?: string };
            return {
              code: e.code,
              constraint: e.constraint,
              business: translateDbError(error).code,
            };
          }
        };

        // (a) v1 appartient au compte A (occupation TRIP de a1) : témoin positif, même compte
        expect(await raw(OCC, [uuid(), x.v1, x.orgA, c.country, 'HOST_BLOCK', FREE])).toEqual({});
        // autre compte du même pays, puis compte de l'autre pays : exclusion, traduite FORBIDDEN
        const single = {
          code: '23P01',
          constraint: 'occupancy_vehicle_single_org',
          business: 'FORBIDDEN',
        };
        const later = `[${d(1, 20)},${d(1, 22)})`;
        expect(await raw(OCC, [uuid(), x.v1, x.orgB, c.country, 'HOST_BLOCK', later])).toEqual(
          single,
        );
        expect(await raw(OCC, [uuid(), x.v1, y.orgA, y.c.country, 'HOLD', later])).toEqual(single);
      });
    });
  });

  it('hold et occupation de même partie, sans la pré-vérification : autre compte, pays ou véhicule ⇒ 23503 checkout_hold_occupancy_party_fk', async () => {
    // Revue QA US-022, constat 1 : la fixture 9310 écrit SANS contrôle préalable (chemin de
    // cmd_place_hold, US-023) ; seule la contrainte de 0029 peut refuser.
    const x = worldOf(c);
    const y = otherWorld(c);
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const raw = async (
          sql: string,
          params: readonly unknown[],
        ): Promise<{
          code?: string | undefined;
          constraint?: string | undefined;
          business?: string;
        }> => {
          await tx.query('SAVEPOINT raw');
          try {
            await tx.query(sql, [...params]);
            await tx.query('RELEASE SAVEPOINT raw');
            return {};
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT raw');
            const e = error as { code?: string; constraint?: string };
            return {
              code: e.code,
              constraint: e.constraint,
              business: translateDbError(error).code,
            };
          }
        };
        // (b) hold et occupation : même véhicule, même compte, même pays
        const v = uuid();
        const occ = uuid();
        expect(await raw(OCC, [occ, v, x.orgA, c.country, 'HOLD', FREE])).toEqual({});
        const party = { code: '23503', constraint: 'checkout_hold_occupancy_party_fk' };
        const pick = (r: { code?: string | undefined; constraint?: string | undefined }) => ({
          code: r.code,
          constraint: r.constraint,
        });
        // autre compte (même pays)
        expect(pick(await raw(HOLD, [uuid(), occ, uuid(), v, x.orgB, c.country]))).toEqual(party);
        // autre pays (compte de l'autre pays, clé (org_id, country_code) du hold valide)
        expect(pick(await raw(HOLD, [uuid(), occ, uuid(), v, y.orgA, y.c.country]))).toEqual(party);
        // autre véhicule
        expect(pick(await raw(HOLD, [uuid(), occ, uuid(), uuid(), x.orgA, c.country]))).toEqual(
          party,
        );
        // témoin positif : même partie
        expect(await raw(HOLD, [uuid(), occ, uuid(), v, x.orgA, c.country])).toEqual({});
      });
    });
  });

  it('cloisonnement des lectures : compte d’hôte, portée du co-hôte, pays de l’ADMIN ; voyageur et travailleur sous app_api : rien', async () => {
    const x = worldOf(c);
    const y = otherWorld(c);
    const v = uuid();
    const blockId = await committedBlock(x, v, d(12, 1), d(12, 3));
    const yBlock = await committedBlock(y, uuid(), d(12, 1), d(12, 3));
    await withRole('app_api', async (client) => {
      const seen = (ctx: SessionContext) =>
        asActor(client, ctx, async (tx) => {
          const r = await tx.query<{ id: string; vehicle_id: string; country_code: string }>(
            `SELECT id, vehicle_id, country_code FROM core.booking_vehicle_occupancy`,
          );
          return r.rows;
        });
      const a = await seen(holderA(x));
      expect(a.map((r) => r.id)).toContain(blockId);
      expect(a.map((r) => r.id)).not.toContain(yBlock);
      expect(new Set(a.map((r) => r.country_code))).toEqual(new Set([c.country]));
      // véhicules du compte A seulement (v1, v2 : trips a1, a2 ; v4 : hold h1 ; v : blocage)
      expect(a.map((r) => r.vehicle_id)).not.toContain(x.v3);
      const b = await seen({ kind: 'HOST', actorId: x.holderB, orgId: x.orgB });
      expect(b.map((r) => r.id)).not.toContain(blockId);
      expect(b.map((r) => r.vehicle_id)).not.toContain(x.v1);
      const co = await seen({ kind: 'HOST', actorId: world.cohost, orgId: x.orgA });
      expect(sorted([...new Set(co.map((r) => r.vehicle_id))])).toEqual([x.v1]);
      const admin = await seen({
        kind: 'STAFF',
        actorId: world.staff.adminAll,
        countryScope: [c.country],
      });
      expect(admin.map((r) => r.id)).toContain(blockId);
      expect(admin.map((r) => r.id)).not.toContain(yBlock);
      expect(new Set(admin.map((r) => r.country_code))).toEqual(new Set([c.country]));
      // FINANCE : aucune lecture du calendrier (ADMIN seulement, PROPOSÉ)
      const finance = await seen({
        kind: 'STAFF',
        actorId: world.staff.financeFirst,
        countryScope: COUNTRIES.map((k) => k.country),
      });
      expect(finance).toEqual([]);
      expect(await seen({ kind: 'GUEST', actorId: world.guest1 })).toEqual([]);
      expect(await seen({ kind: 'WORKER', workerName: 'trip_lifecycle' })).toEqual([]);
      const none = await withTestTransaction(client, {}, async (tx) => {
        const r = await tx.query(`SELECT id FROM core.booking_vehicle_occupancy`);
        return r.rows;
      });
      expect(none).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// C1 tous canaux : poses de hold (voyageurs) et blocages (hôte) concurrents du même créneau
// ---------------------------------------------------------------------------------------------

/** Degré : C1 à 100 poses est prouvé par L0-02 (US-007) ; ici, canaux mêlés, 40 connexions. */
const MIXED_DEGREE = 40;
/** Connexions laissées à L0-02 (100) et aux autres fichiers qui tournent en parallèle. */
const RESERVED_CONNECTIONS = 130;

describe.each(COUNTRIES)('US-022 — C1 tous canaux ($country, $currency)', (c) => {
  it('holds et blocages concurrents du même créneau : exactement une occupation, les autres VEHICLE_UNAVAILABLE, 0 40P01', async () => {
    const x = worldOf(c);
    const observer = await connectAs('app_api');
    try {
      const max = Number(
        (
          await observer.query<{ m: string }>(
            `SELECT pg_catalog.current_setting('max_connections') AS m`,
          )
        ).rows[0]?.m,
      );
      if (!Number.isInteger(max)) throw new Error('max_connections illisible');
      const degree = Math.max(4, Math.min(MIXED_DEGREE, max - RESERVED_CONNECTIONS));
      const vehicleId = uuid();
      const start = d(2, 1);
      const end = d(2, 3);
      const period = `[${start},${end})`;
      const slot: Slot = { vehicleId, orgId: x.orgA, start, end, bufferHours: 0 };
      const guests = Array.from({ length: Math.ceil(degree / 2) }, () => uuid());
      await inTx(observer, { commit: true }, (tx) => ensureParties(tx, guests, x.orgA, c));

      const clients: pg.Client[] = [];
      let results: Replayed<string>[];
      try {
        clients.push(
          ...(await Promise.all(Array.from({ length: degree }, () => connectAs('app_api')))),
        );
        const barrier = await Barrier.open(observer);
        const runs = clients.map(async (client, i) => {
          await barrier.wait(client);
          const guestId = guests[i >> 1];
          if (i % 2 === 0 && guestId !== undefined) {
            // voyageur : un appel de commande = une instruction en autocommit (ADR-056)
            return withReplay(async () => {
              await placeHoldLocked(client, { slot, c, guestId, period, vehicleLock: true });
              return 'HOLD';
            });
          }
          // hôte : forme transactionnelle de 17 §2.3 (contexte SET LOCAL, un appel, COMMIT)
          return withReplay(() =>
            withTestTransaction(client, { commit: true }, async (tx) => {
              await setSessionContext(tx, holderA(x));
              await tx.query(BLOCK, [vehicleId, start, end]);
              return 'HOST_BLOCK';
            }),
          );
        });
        try {
          await barrier.waitForWaiters(degree);
        } finally {
          await barrier.release();
        }
        results = await Promise.all(runs);
      } finally {
        await Promise.all(clients.map((cl) => releaseClient(cl)));
      }

      const active = await withRole('app_worker', (worker) =>
        inTx(worker, { worker: 'booking_conversion' }, (tx) =>
          activeOccupancies(tx, vehicleId, period),
        ),
      );
      const outcomes: Record<string, number> = {};
      for (const r of results) {
        const key = r.error ?? 'OK';
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      }
      const ms = results.map((r) => r.ms);
      const report = {
        degree,
        outcomes,
        winner: results.find((r) => r.error === undefined)?.value,
        deadlocks: results.reduce((n, r) => n + r.deadlocks, 0),
        replays: results.reduce((n, r) => n + r.replays, 0),
        p50: Math.round(percentile(ms, 0.5)),
        p95: Math.round(percentile(ms, 0.95)),
      };
      console.log(`[US-022 C1 tous canaux] ${c.country} ${JSON.stringify(report)}`);
      if (process.env['CI'] !== undefined && process.env['CI'] !== '') {
        expect(degree).toBe(MIXED_DEGREE);
      }
      expect(outcomes).toEqual({ OK: 1, VEHICLE_UNAVAILABLE: degree - 1 });
      expect(report.deadlocks).toBe(0);
      expect(report.replays).toBe(0);
      expect(active).toHaveLength(1);
      expect(active[0]?.kind).toBe(report.winner === 'HOLD' ? 'HOLD' : 'HOST_BLOCK');
    } finally {
      await releaseClient(observer);
    }
  }, 240_000);
});
