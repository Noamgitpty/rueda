/**
 * L0-03 — 17 §11 point 3 : triggers de contrainte différés I-OCC et trigger terminal (US-006).
 *
 * Attendu (17 §11, tableau L0 ; 17 §2.5 « Invariant central I-OCC », (iii) du trigger terminal) :
 * - refus au COMMIT (message identifiable) : désactivation de l'occupation d'un trip `BOOKED`,
 *   suppression, changement de `ref_id`, création d'un trip sans occupation ;
 * - bloc C sur un hold déjà `COMPENSATED` : no-op toléré (0 ligne mise à jour, aucune erreur) ;
 * - refus de toute sortie de `CONVERTED` / `COMPENSATED` ;
 * - coût mesuré.
 * Rôle (17 §11) : `app_worker`. Codes traduits : `INVARIANT_VIOLATION`, `INVALID_TRANSITION`.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import {
  at,
  blocC,
  bookTrip,
  convert,
  COUNTRIES,
  expireDueHolds,
  inTx,
  insertRentOperation,
  newSlot,
  placeHold,
  receiveProof,
  uuid,
} from '../support/avl.ts';
import type { CountryCase, Hold } from '../support/avl.ts';

const T0 = '2031-06-01T09:00:00.000Z';
const START = '2031-06-08T09:00:00.000Z';
const END = '2031-06-10T09:00:00.000Z';

async function withClients<T>(fn: (api: pg.Client, worker: pg.Client) => Promise<T>): Promise<T> {
  const api = await connectAs('app_api');
  try {
    const worker = await connectAs('app_worker');
    try {
      return await fn(api, worker);
    } finally {
      await releaseClient(worker);
    }
  } finally {
    await releaseClient(api);
  }
}

/** Attend un refus au COMMIT par un trigger I-OCC, traduit en INVARIANT_VIOLATION. */
async function expectCommitRefused(promise: Promise<unknown>, constraint: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'le COMMIT devait être refusé').toBeDefined();
  expect(caught).toMatchObject({ code: '23000', message: expect.stringMatching(/^I-OCC: /) });
  expect((caught as { constraint?: string }).constraint).toMatch(constraint);
  expect(translateDbError(caught)).toEqual({ code: 'INVARIANT_VIOLATION', retryable: false });
}

const occupancyOf = async (worker: pg.Client, occupancyId: string) =>
  inTx(worker, { worker: 'trip_lifecycle' }, async (tx) => {
    const r = await tx.query<{ kind: string; active: boolean; ref_id: string }>(
      `SELECT kind, active, ref_id FROM core.booking_vehicle_occupancy WHERE id = $1`,
      [occupancyId],
    );
    return r.rows[0];
  });

/** Hold COMPENSATED : expiré, créneau pris par un autre guest, preuve tardive (cas C de L0-01). */
async function compensatedHold(
  api: pg.Client,
  worker: pg.Client,
  c: CountryCase,
): Promise<{ a: Hold; opA: string }> {
  const slot = newSlot(START, END);
  const { a, opA } = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
    const hold = await placeHold(tx, slot, c);
    return { a: hold, opA: await insertRentOperation(tx, hold) };
  });
  await inTx(worker, { worker: 'hold_expiry', virtualNow: at(T0, 11), commit: true }, (tx) =>
    expireDueHolds(tx, slot.vehicleId, a.guestId),
  );
  await inTx(api, { virtualNow: at(T0, 12), commit: true }, (tx) => placeHold(tx, slot, c, uuid()));
  await inTx(worker, { worker: 'webhook_ingest', virtualNow: at(T0, 13), commit: true }, (tx) =>
    receiveProof(tx, opA),
  );
  const r = await inTx(
    worker,
    { worker: 'booking_conversion', virtualNow: at(T0, 13), commit: true },
    (tx) => convert(tx, a, opA),
  );
  expect(r.kind).toBe('COMPENSATED');
  return { a, opA };
}

describe.each(COUNTRIES)('L0-03 — I-OCC au COMMIT ($country, $currency)', (c) => {
  it('désactiver l’occupation TRIP d’un trip BOOKED : refus au COMMIT (occupancy_trip_guard)', async () => {
    await withClients(async (api, worker) => {
      const { hold } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      await expectCommitRefused(
        inTx(
          worker,
          { worker: 'trip_lifecycle', virtualNow: at(T0, 30), commit: true },
          async (tx) => {
            const r = await tx.query(
              `UPDATE core.booking_vehicle_occupancy SET active = false, deactivated_reason = 'TRIP_TERMINAL'
              WHERE id = $1`,
              [hold.occupancyId],
            );
            expect(r.rowCount).toBe(1); // l'instruction passe : le refus est différé au COMMIT
          },
        ),
        /^occupancy_trip_guard$/,
      );
      expect(await occupancyOf(worker, hold.occupancyId)).toMatchObject({
        kind: 'TRIP',
        active: true,
      });
    });
  });

  it('supprimer l’occupation : aucun rôle n’a DELETE (42501) ; forcée, refusée ; garde DELETE en place', async () => {
    await withClients(async (api, worker) => {
      const { hold } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      await inTx(worker, { worker: 'trip_lifecycle' }, async (tx) => {
        await expect(
          tx.query(`DELETE FROM core.booking_vehicle_occupancy WHERE id = $1`, [hold.occupancyId]),
        ).rejects.toMatchObject({ code: '42501' });
      });
      // Suppression forcée par le propriétaire (fixture) : refusée dès l'instruction par la clé
      // étrangère du hold (23503), avant même le trigger différé occupancy_trip_guard.
      await inTx(worker, { worker: 'trip_lifecycle' }, async (tx) => {
        await expect(
          tx.query(`SELECT test_fixture.delete_occupancy($1) AS n`, [hold.occupancyId]),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: expect.stringMatching(/occupancy_id_fkey$/),
        });
      });
      // le garde différé couvre aussi DELETE (défense en profondeur si la FK changeait)
      const def = await inTx(worker, {}, (tx) =>
        tx.query<{ def: string }>(
          `SELECT pg_catalog.pg_get_triggerdef(t.oid) AS def
             FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid = 'core.booking_vehicle_occupancy'::regclass
              AND t.tgname = 'occupancy_trip_guard'`,
        ),
      );
      expect(def.rows[0]?.def).toMatch(
        /AFTER DELETE OR UPDATE ON core.booking_vehicle_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN \(\(old\.kind = 'TRIP'::text\)\)/,
      );
      expect(await occupancyOf(worker, hold.occupancyId)).toMatchObject({
        kind: 'TRIP',
        active: true,
      });
    });
  });

  it('changer le ref_id de l’occupation TRIP : refus au COMMIT', async () => {
    await withClients(async (api, worker) => {
      const { hold, tripId } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      await expectCommitRefused(
        inTx(worker, { worker: 'booking_conversion', commit: true }, (tx) =>
          tx.query(`UPDATE core.booking_vehicle_occupancy SET ref_id = $2 WHERE id = $1`, [
            hold.occupancyId,
            uuid(),
          ]),
        ),
        /^occupancy_trip_(guard|ref_valid)$/,
      );
      expect(await occupancyOf(worker, hold.occupancyId)).toMatchObject({ ref_id: tripId });
    });
  });

  it('créer un trip BOOKED sans occupation : refus au COMMIT (trip_has_active_occupancy)', async () => {
    await withRoleWorker(async (worker) => {
      const slot = newSlot(START, END);
      await expectCommitRefused(
        inTx(worker, { worker: 'booking_conversion', commit: true }, async (tx) => {
          const guestId = uuid();
          // US-011 : guest_user_id et (org_id, country_code) sont des clés étrangères vers IAM
          await tx.query(`SELECT test_fixture.ensure_party($1, $2, $3)`, [
            guestId,
            slot.orgId,
            c.country,
          ]);
          return tx.query(
            `INSERT INTO core.booking_trip (id, guest_user_id, org_id, vehicle_id, country_code,
                                            currency, timezone, scheduled_start, scheduled_end, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BOOKED')`,
            [
              uuid(),
              guestId,
              slot.orgId,
              slot.vehicleId,
              c.country,
              c.currency,
              c.timezone,
              START,
              END,
            ],
          );
        }),
        /^trip_has_active_occupancy$/,
      );
    });
  });

  it('occupation TRIP désignant un trip inexistant : refus au COMMIT (occupancy_trip_ref_valid)', async () => {
    await withClients(async (api) => {
      const slot = newSlot(START, END);
      const hold = await inTx(api, { virtualNow: T0, commit: true }, (tx) =>
        placeHold(tx, slot, c),
      );
      await withRoleWorker(async (worker) => {
        await expectCommitRefused(
          inTx(
            worker,
            { worker: 'booking_conversion', virtualNow: at(T0, 1), commit: true },
            (tx) =>
              tx.query(
                `UPDATE core.booking_vehicle_occupancy
                  SET kind = 'TRIP', active = true, expires_at = NULL, ref_type = 'TRIP', ref_id = $2
                WHERE id = $1`,
                [hold.occupancyId, uuid()],
              ),
          ),
          /^occupancy_trip_ref_valid$/,
        );
      });
    });
  });

  it('état terminal et occupation désactivée dans la même transaction : COMMIT accepté', async () => {
    await withClients(async (api, worker) => {
      const { hold, tripId } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      await inTx(
        worker,
        { worker: 'trip_lifecycle', virtualNow: at(T0, 60), commit: true },
        async (tx) => {
          await tx.query(
            `UPDATE core.booking_trip SET status = 'CANCELLED_BY_GUEST', cancellation_reason = 'GUEST_CANCELLED'
            WHERE id = $1`,
            [tripId],
          );
          await tx.query(
            `UPDATE core.booking_vehicle_occupancy SET active = false, deactivated_reason = 'TRIP_TERMINAL'
            WHERE id = $1`,
            [hold.occupancyId],
          );
          await tx.query(
            `UPDATE core.booking_guest_occupancy SET active = false WHERE trip_id = $1`,
            [tripId],
          );
        },
      );
      expect(await occupancyOf(worker, hold.occupancyId)).toMatchObject({
        kind: 'TRIP',
        active: false,
      });
    });
  });

  it('raccourcissement de la période d’un trip non terminal : COMMIT accepté (ligne toujours active)', async () => {
    await withClients(async (api, worker) => {
      const { hold, tripId } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      const shorterEnd = at(END, -24 * 60);
      await inTx(worker, { worker: 'trip_lifecycle', commit: true }, async (tx) => {
        await tx.query(`UPDATE core.booking_trip SET scheduled_end = $2 WHERE id = $1`, [
          tripId,
          shorterEnd,
        ]);
        await tx.query(
          `UPDATE core.booking_vehicle_occupancy
              SET period = tstzrange(lower(period), $2::timestamptz + interval '2 hours', '[)')
            WHERE id = $1`,
          [hold.occupancyId, shorterEnd],
        );
      });
      expect(await occupancyOf(worker, hold.occupancyId)).toMatchObject({
        kind: 'TRIP',
        active: true,
      });
    });
  });

  it('bloc C sur un hold déjà COMPENSATED : 0 ligne de hold mise à jour, aucune erreur', async () => {
    await withClients(async (api, worker) => {
      const { a } = await compensatedHold(api, worker, c);
      // une autre opération de loyer réussie arrive sur le même hold
      const op2 = await inTx(api, { virtualNow: at(T0, 20), commit: true }, (tx) =>
        insertRentOperation(tx, a),
      );
      await inTx(worker, { worker: 'webhook_ingest', virtualNow: at(T0, 21), commit: true }, (tx) =>
        receiveProof(tx, op2),
      );
      const r = await inTx(
        worker,
        { worker: 'booking_conversion', virtualNow: at(T0, 21), commit: true },
        (tx) => convert(tx, a, op2),
      );
      expect(r).toMatchObject({
        kind: 'COMPENSATED',
        reason: 'LATE_PAYMENT_AFTER_COMPENSATION',
        holdRowsUpdated: 0,
      });
      // le no-op explicite COMPENSATED -> COMPENSATED est toléré
      await inTx(worker, { worker: 'booking_conversion', commit: true }, async (tx) => {
        const n = await tx.query(
          `UPDATE core.booking_checkout_hold SET status = 'COMPENSATED' WHERE id = $1`,
          [a.holdId],
        );
        expect(n.rowCount).toBe(1);
      });
      const comps = await inTx(worker, { worker: 'booking_conversion' }, (tx) =>
        tx.query<{ reason: string }>(
          `SELECT reason FROM core.booking_hold_compensation WHERE hold_id = $1 ORDER BY opened_at, reason`,
          [a.holdId],
        ),
      );
      expect(comps.rows.map((x) => x.reason).sort()).toEqual([
        'LATE_PAYMENT_AFTER_COMPENSATION',
        'SLOT_LOST_AFTER_EXPIRY',
      ]);
    });
  });

  it('toute sortie de COMPENSATED est refusée (INVALID_TRANSITION)', async () => {
    await withClients(async (api, worker) => {
      const { a } = await compensatedHold(api, worker, c);
      for (const target of ['ACTIVE', 'PAYMENT_IN_FLIGHT', 'EXPIRED', 'RELEASED']) {
        await inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
          const error = await tx
            .query(`UPDATE core.booking_checkout_hold SET status = $2 WHERE id = $1`, [
              a.holdId,
              target,
            ])
            .then(
              () => undefined,
              (e: unknown) => e,
            );
          expect(error, target).toMatchObject({
            code: '23000',
            constraint: 'hold_terminal_status',
          });
          expect(translateDbError(error)).toEqual({ code: 'INVALID_TRANSITION', retryable: false });
        });
      }
    });
  });

  it('toute sortie de CONVERTED est refusée, y compris le changement de trip ou d’opération', async () => {
    await withClients(async (api, worker) => {
      const { hold } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      const attempts: [string, string][] = [
        ['status', 'EXPIRED'],
        ['status', 'COMPENSATED'],
        ['status', 'ACTIVE'],
        ['status', 'RELEASED'],
        ['converted_trip_id', uuid()],
        ['conversion_operation_id', uuid()],
      ];
      for (const [column, value] of attempts) {
        await inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
          await expect(
            tx.query(`UPDATE core.booking_checkout_hold SET ${column} = $2 WHERE id = $1`, [
              hold.holdId,
              value,
            ]),
            `${column} = ${value}`,
          ).rejects.toMatchObject({ code: '23000', constraint: 'hold_terminal_status' });
        });
      }
    });
  });

  it('hold CONVERTED sans sa disposition CONVERSION : refus au COMMIT', async () => {
    await withClients(async (api, worker) => {
      const slot = newSlot(START, END);
      const { hold, op } = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
        const h = await placeHold(tx, slot, c);
        return { hold: h, op: await insertRentOperation(tx, h) };
      });
      await inTx(worker, { worker: 'webhook_ingest', commit: true }, (tx) => receiveProof(tx, op));
      const error = await inTx(
        worker,
        { worker: 'booking_conversion', virtualNow: at(T0, 2), commit: true },
        async (tx) => {
          const tripId = uuid();
          await tx.query(
            `UPDATE core.booking_vehicle_occupancy
              SET kind = 'TRIP', active = true, expires_at = NULL, ref_type = 'TRIP', ref_id = $2
            WHERE id = $1`,
            [hold.occupancyId, tripId],
          );
          await tx.query(
            `INSERT INTO core.booking_trip (id, guest_user_id, org_id, vehicle_id, country_code,
                                          currency, timezone, scheduled_start, scheduled_end, status, source_hold_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BOOKED', $10)`,
            [
              tripId,
              hold.guestId,
              slot.orgId,
              slot.vehicleId,
              c.country,
              c.currency,
              c.timezone,
              START,
              END,
              hold.holdId,
            ],
          );
          // statut CONVERTED posé sans INSERT de payment_disposition
          await tx.query(
            `UPDATE core.booking_checkout_hold
              SET status = 'CONVERTED', converted_trip_id = $2, conversion_operation_id = $3
            WHERE id = $1`,
            [hold.holdId, tripId, op],
          );
        },
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({
        code: '23000',
        constraint: 'hold_conversion_matches_disposition',
      });
      expect(translateDbError(error)).toEqual({ code: 'INVARIANT_VIOLATION', retryable: false });
    });
  });

  it('disposition sur une opération qui n’est pas un paiement de loyer réussi : refusée', async () => {
    await withClients(async (api, worker) => {
      const slot = newSlot(START, END);
      const { hold, refund } = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
        const h = await placeHold(tx, slot, c);
        return { hold: h, refund: await insertRentOperation(tx, h, 'SUCCEEDED', 'REFUND') };
      });
      await inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
        await expect(
          blocC(tx, {
            holdId: hold.holdId,
            occupancyId: hold.occupancyId,
            operationId: refund,
            reason: 'DUPLICATE_PAYMENT',
          }),
        ).rejects.toMatchObject({ code: '23000', constraint: 'disposition_rent_payment_only' });
      });
    });
  });
});

describe('L0-03 — coût mesuré des triggers différés', () => {
  it('50 conversions dans une transaction : COMMIT avec ~150 vérifications différées', async () => {
    const c = COUNTRIES[0];
    await withClients(async (api, worker) => {
      const pairs = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
        const out: { hold: Hold; op: string }[] = [];
        for (let i = 0; i < 50; i++) {
          const h = await placeHold(tx, newSlot(START, END), c);
          out.push({ hold: h, op: await insertRentOperation(tx, h) });
        }
        return out;
      });
      await inTx(worker, { worker: 'webhook_ingest', commit: true }, async (tx) => {
        for (const p of pairs) await receiveProof(tx, p.op);
      });
      let commitMs = 0;
      await inTx(worker, { worker: 'booking_conversion', virtualNow: at(T0, 2) }, async (tx) => {
        for (const p of pairs) expect((await convert(tx, p.hold, p.op)).kind).toBe('TRIP');
        const started = performance.now();
        await tx.query('SET CONSTRAINTS ALL IMMEDIATE'); // déclenche les vérifications différées
        commitMs = performance.now() - started;
      });
      // Mesure consignée (17 §11 L0-03 « coût mesuré ») ; borne large, pas un objectif de performance.
      console.info(`[L0-03] vérifications différées de 50 conversions : ${commitMs.toFixed(1)} ms`);
      expect(commitMs).toBeLessThan(10_000);
    });
  });
});

async function withRoleWorker<T>(fn: (worker: pg.Client) => Promise<T>): Promise<T> {
  const worker = await connectAs('app_worker');
  try {
    return await fn(worker);
  } finally {
    await releaseClient(worker);
  }
}
