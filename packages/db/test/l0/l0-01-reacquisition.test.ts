/**
 * L0-01 — 17 §11 point 1 : réévaluation de l'exclusion à la ré-acquisition (US-006).
 *
 * Attendu (17 §11, tableau L0 ; 17 §2.5 étape 4.3, esquisse de la transaction de conversion) :
 * - avec concurrent : `23P01` levé à l'`UPDATE … SET kind = 'TRIP', active = true` ;
 *   `ROLLBACK TO SAVEPOINT` laisse la transaction utilisable ; le bloc C est validé
 *   (hold `COMPENSATED`, `payment_disposition` `COMPENSATION`, `hold_compensation` motif
 *   `SLOT_LOST_AFTER_EXPIRY`) ; erreur traduite `VEHICLE_UNAVAILABLE` (17 §2.5 2d) ;
 * - sans concurrent : ligne active, trip créé ;
 * - aucune ligne `TRIP` active hors contrainte.
 * Rôles (17 §11) : `app_worker` (conversion) ; pose du concurrent via `app_api` (fixture qui
 * tient lieu de cmd_place_hold, US-023). En USD (PA) et en PYG (PY).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import {
  at,
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

const T0 = '2031-05-05T10:00:00.000Z'; // pose du hold A ; expires_at = T0 + 10 min
const TRIP_START = '2031-05-10T10:00:00.000Z';
const TRIP_END = '2031-05-12T10:00:00.000Z';

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

/** Hold A posé à T0, opération de loyer en attente, puis expiré à T0 + 11 min (2a, hold_expiry). */
async function expiredHoldA(
  api: pg.Client,
  worker: pg.Client,
  c: CountryCase,
): Promise<{ a: Hold; opA: string }> {
  const slot = newSlot(TRIP_START, TRIP_END);
  const { a, opA } = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
    const hold = await placeHold(tx, slot, c);
    return { a: hold, opA: await insertRentOperation(tx, hold, 'PENDING') };
  });
  const deactivated = await inTx(
    worker,
    { worker: 'hold_expiry', virtualNow: at(T0, 11), commit: true },
    (tx) => expireDueHolds(tx, slot.vehicleId, a.guestId),
  );
  expect(deactivated).toBe(1);
  return { a, opA };
}

async function readState(worker: pg.Client, a: Hold) {
  return inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
    const hold = await tx.query<{ status: string; converted_trip_id: string | null }>(
      `SELECT status, converted_trip_id FROM core.booking_checkout_hold WHERE id = $1`,
      [a.holdId],
    );
    const occ = await tx.query<{
      kind: string;
      active: boolean;
      ref_id: string | null;
      deactivated_reason: string | null;
    }>(
      `SELECT kind, active, ref_id, deactivated_reason FROM core.booking_vehicle_occupancy WHERE id = $1`,
      [a.occupancyId],
    );
    const dispositions = await tx.query<{ disposition: string; trip_id: string | null }>(
      `SELECT disposition, trip_id FROM core.booking_payment_disposition WHERE hold_id = $1`,
      [a.holdId],
    );
    const compensations = await tx.query<{ reason: string; status: string; action: string }>(
      `SELECT reason, status, action FROM core.booking_hold_compensation WHERE hold_id = $1`,
      [a.holdId],
    );
    const trips = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM core.booking_trip WHERE source_hold_id = $1`,
      [a.holdId],
    );
    // occupations actives qui chevauchent le créneau du véhicule (exclusion : au plus une)
    const activeOnSlot = await tx.query<{ kind: string; ref_id: string | null }>(
      `SELECT o.kind, o.ref_id
         FROM core.booking_vehicle_occupancy o
         JOIN core.booking_vehicle_occupancy a ON a.id = $1
        WHERE o.vehicle_id = a.vehicle_id AND o.active AND o.period && a.period`,
      [a.occupancyId],
    );
    return {
      hold: hold.rows[0],
      occ: occ.rows[0],
      dispositions: dispositions.rows,
      compensations: compensations.rows,
      trips: trips.rows,
      activeOnSlot: activeOnSlot.rows,
    };
  });
}

describe.each(COUNTRIES)(
  'L0-01 — ré-acquisition sous la contrainte d’exclusion ($country, $currency)',
  (c) => {
    it('avec concurrent actif : 23P01 à l’UPDATE, ROLLBACK TO SAVEPOINT, bloc C validé, aucun trip', async () => {
      await withClients(async (api, worker) => {
        const { a, opA } = await expiredHoldA(api, worker, c);
        // un autre guest pose un hold actif sur le même créneau (via app_api)
        const b = await inTx(api, { virtualNow: at(T0, 12), commit: true }, (tx) =>
          placeHold(tx, a.slot, c, uuid()),
        );
        // la preuve de paiement de A arrive après l'expiration
        await inTx(
          worker,
          { worker: 'webhook_ingest', virtualNow: at(T0, 13), commit: true },
          (tx) => receiveProof(tx, opA),
        );

        const result = await inTx(
          worker,
          { worker: 'booking_conversion', virtualNow: at(T0, 13), commit: true },
          async (tx) => {
            const r = await convert(tx, a, opA);
            // la transaction reste utilisable après ROLLBACK TO SAVEPOINT et le bloc C
            const alive = await tx.query<{ ok: number }>('SELECT 1 AS ok');
            expect(alive.rows[0]?.ok).toBe(1);
            return r;
          },
        );

        expect(result.kind).toBe('COMPENSATED');
        if (result.kind !== 'COMPENSATED') return;
        expect(result.rawCause).toEqual({
          code: '23P01',
          constraint: 'vehicle_occupancy_no_overlap',
        });
        expect(result.cause).toEqual({ code: 'VEHICLE_UNAVAILABLE', retryable: false });
        expect(result.reason).toBe('SLOT_LOST_AFTER_EXPIRY');
        expect(result.holdRowsUpdated).toBe(1);

        const s = await readState(worker, a);
        expect(s.hold?.status).toBe('COMPENSATED');
        expect(s.hold?.converted_trip_id).toBeNull();
        expect(s.dispositions).toEqual([{ disposition: 'COMPENSATION', trip_id: null }]);
        expect(s.compensations).toEqual([
          { reason: 'SLOT_LOST_AFTER_EXPIRY', status: 'OPEN', action: 'REFUND_API' },
        ]);
        expect(s.trips).toEqual([]);
        // l'occupation de A est restée un HOLD inactif (le SAVEPOINT a annulé la conversion)
        expect(s.occ).toMatchObject({
          kind: 'HOLD',
          active: false,
          deactivated_reason: 'HOLD_COMPENSATED',
        });
        // une seule occupation active sur le créneau : celle du hold B ; aucune ligne TRIP active
        expect(s.activeOnSlot).toEqual([{ kind: 'HOLD', ref_id: b.holdId }]);
      });
    });

    it('avec concurrent : l’UPDATE lève 23P01 sur l’instruction elle-même (pas au COMMIT)', async () => {
      await withClients(async (api, worker) => {
        const { a } = await expiredHoldA(api, worker, c);
        await inTx(api, { virtualNow: at(T0, 12), commit: true }, (tx) =>
          placeHold(tx, a.slot, c, uuid()),
        );
        await inTx(worker, { worker: 'booking_conversion', virtualNow: at(T0, 13) }, async (tx) => {
          await tx.query('SAVEPOINT reacquire');
          await expect(
            tx.query(
              `UPDATE core.booking_vehicle_occupancy
                SET kind = 'TRIP', active = true, expires_at = NULL, deactivated_reason = NULL,
                    ref_type = 'TRIP', ref_id = $2
              WHERE id = $1 AND kind = 'HOLD'`,
              [a.occupancyId, uuid()],
            ),
          ).rejects.toMatchObject({ code: '23P01', constraint: 'vehicle_occupancy_no_overlap' });
          await tx.query('ROLLBACK TO SAVEPOINT reacquire');
          const occ = await tx.query<{ kind: string; active: boolean }>(
            `SELECT kind, active FROM core.booking_vehicle_occupancy WHERE id = $1`,
            [a.occupancyId],
          );
          expect(occ.rows[0]).toEqual({ kind: 'HOLD', active: false });
        });
      });
    });

    it('sans concurrent : ré-acquisition réussie, occupation TRIP active, trip BOOKED', async () => {
      await withClients(async (api, worker) => {
        const { a, opA } = await expiredHoldA(api, worker, c);
        await inTx(
          worker,
          { worker: 'webhook_ingest', virtualNow: at(T0, 13), commit: true },
          (tx) => receiveProof(tx, opA),
        );
        const result = await inTx(
          worker,
          { worker: 'booking_conversion', virtualNow: at(T0, 13), commit: true },
          (tx) => convert(tx, a, opA),
        );
        expect(result).toMatchObject({ kind: 'TRIP', reacquired: true });
        if (result.kind !== 'TRIP') return;

        const s = await readState(worker, a);
        expect(s.hold).toEqual({ status: 'CONVERTED', converted_trip_id: result.tripId });
        expect(s.occ).toEqual({
          kind: 'TRIP',
          active: true,
          ref_id: result.tripId,
          deactivated_reason: null,
        });
        expect(s.trips).toEqual([{ id: result.tripId, status: 'BOOKED' }]);
        expect(s.dispositions).toEqual([{ disposition: 'CONVERSION', trip_id: result.tripId }]);
        expect(s.compensations).toEqual([]);
        expect(s.activeOnSlot).toEqual([{ kind: 'TRIP', ref_id: result.tripId }]);
      });
    });

    it('rejeu de la même preuve après conversion : renvoie la disposition, aucun second trip', async () => {
      await withClients(async (api, worker) => {
        const { a, opA } = await expiredHoldA(api, worker, c);
        await inTx(
          worker,
          { worker: 'webhook_ingest', virtualNow: at(T0, 13), commit: true },
          (tx) => receiveProof(tx, opA),
        );
        const conv = {
          worker: 'booking_conversion',
          virtualNow: at(T0, 13),
          commit: true,
        } as const;
        await inTx(worker, conv, (tx) => convert(tx, a, opA));
        const replay = await inTx(worker, conv, (tx) => convert(tx, a, opA));
        expect(replay).toEqual({ kind: 'REPLAY', disposition: 'CONVERSION' });
        const s = await readState(worker, a);
        expect(s.trips).toHaveLength(1);
      });
    });
  },
);
