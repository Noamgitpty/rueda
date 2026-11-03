/**
 * L0-04 — 17 §11 point 4 : instruction 2a (expiration ciblée de 17 §2.5) : plan de l'`OR`,
 * `SKIP LOCKED` dans une CTE, filtres A3 / A6. US-007.
 *
 * Attendu (17 §11, tableau L0 ; 19 US-007) : avec 10 000 holds et 1 000 véhicules,
 * `EXPLAIN (ANALYZE, BUFFERS)` de 2a utilise **deux index** — `(vehicle_id, status)` et
 * `(guest_user_id, status)`, 17 §2.5 — sans parcours séquentiel ; un hold verrouillé par une
 * conversion à une barrière est sauté ; un hold `PAYMENT_IN_FLIGHT` avec opération non terminale
 * non encore balayée et un hold dont l'opération est `SUCCEEDED` sans disposition ne sont **pas**
 * expirés ; p95 de 2a compatible avec C1 (< 300 ms, seuil de pose de L0-02).
 * Rôles (17 §11) : `app_api` par la commande de pose (fixture qui tient lieu de
 * `cmd_place_hold` sous `cmd_hold_owner`, US-023) ; `app_worker` (`hold_expiry`, tâche
 * d'expiration). En USD (PA) et en PYG (PY).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import {
  at,
  COUNTRIES,
  EXPIRY_2A_SQL,
  expireDueHolds,
  inTx,
  insertRentOperation,
  placeHold,
  slotPeriod,
  SWEEP_GRACE_S,
  uuid,
} from '../support/avl.ts';
import type { CountryCase, Hold, Slot } from '../support/avl.ts';
import { ensureParties, percentile, placeHoldLocked, POSE_P95_MS } from '../support/concurrency.ts';

const VEHICLES = 1_000;
const HOLDS_PER_VEHICLE = 10;
const GUESTS = 5_000;
const P95_RUNS = 30;
const LONG = 240_000;

/** Instant du test (horloge virtuelle) ; les holds ciblés sont posés avant. */
const TL = '2032-02-01T12:00:00.000Z';
/** Branche « véhicule » de l'`OR` : index `(vehicle_id, status)` (17 §2.5). */
const VEHICLE_INDEXES = ['checkout_hold_vehicle_status_idx'];
/**
 * Branche « guest » : `(guest_user_id, status)` (17 §2.5) ou l'index unique partiel
 * `one_live_hold_per_guest_vehicle (guest_user_id, vehicle_id) WHERE status IN ('ACTIVE',
 * 'PAYMENT_IN_FLIGHT')`, qui couvre aussi le filtre de statut de 2a : le planificateur de
 * PostgreSQL 16 le préfère (constat de la CI, ADR-056).
 */
const GUEST_INDEXES = ['checkout_hold_guest_status_idx', 'one_live_hold_per_guest_vehicle'];

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function walk(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) walk(child, out);
  return out;
}

const slotOn = (vehicleId: string, orgId: string, day: number): Slot => {
  const start = new Date(Date.parse('2032-03-01T10:00:00.000Z') + day * 86_400_000);
  const end = new Date(start.getTime() + 86_400_000);
  return { vehicleId, orgId, start: start.toISOString(), end: end.toISOString(), bufferHours: 2 };
};

interface Scenario {
  readonly vehicleId: string;
  readonly orgId: string;
  readonly guest: string;
  readonly due: Hold;
  readonly locked: Hold;
  readonly inFlight: Hold;
  readonly paid: Hold;
  readonly notDue: Hold;
  readonly otherVehicle: Hold;
}

/** Holds ciblés de 2a sur un véhicule V* et un guest G*, posés sous `app_api`. */
async function scenario(api: pg.Client, c: CountryCase): Promise<Scenario> {
  const vehicleId = uuid();
  const orgId = uuid();
  const guest = uuid();
  const t0 = at(TL, -20); // expires_at = TL − 10 min : échu à TL
  const place = (slot: Slot, when: string, guestId: string = uuid()) =>
    inTx(api, { virtualNow: when, commit: true }, (tx) => placeHold(tx, slot, c, guestId));
  const due = await place(slotOn(vehicleId, orgId, 0), t0);
  const locked = await place(slotOn(vehicleId, orgId, 3), t0);
  const inFlight = await place(slotOn(vehicleId, orgId, 6), t0);
  const paid = await place(slotOn(vehicleId, orgId, 9), t0);
  const notDue = await place(slotOn(vehicleId, orgId, 12), at(TL, -5));
  const otherVehicle = await place(slotOn(uuid(), orgId, 0), t0, guest);
  await inTx(api, { virtualNow: at(TL, -15), commit: true }, async (tx) => {
    // T1 de cmd_start_payment : opération PENDING, borne échue à TL − 30 s, jamais balayée
    await insertRentOperation(tx, inFlight, 'PENDING');
    await tx.query('SELECT test_fixture.l0_set_payment_in_flight($1, $2::timestamptz)', [
      inFlight.holdId,
      new Date(Date.parse(TL) - 30_000).toISOString(),
    ]);
    // A6 : opération payée, pas encore disposée
    await insertRentOperation(tx, paid, 'SUCCEEDED');
  });
  return { vehicleId, orgId, guest, due, locked, inFlight, paid, notDue, otherVehicle };
}

async function statuses(tx: pg.ClientBase, s: Scenario): Promise<Record<string, string>> {
  const named: Record<string, Hold> = {
    due: s.due,
    locked: s.locked,
    inFlight: s.inFlight,
    paid: s.paid,
    notDue: s.notDue,
    otherVehicle: s.otherVehicle,
  };
  const out: Record<string, string> = {};
  for (const [name, h] of Object.entries(named)) {
    const r = await tx.query<{ status: string }>(
      'SELECT status FROM core.booking_checkout_hold WHERE id = $1',
      [h.holdId],
    );
    out[name] = r.rows[0]?.status ?? '?';
  }
  return out;
}

const EXPECTED = {
  due: 'EXPIRED',
  locked: 'ACTIVE',
  inFlight: 'PAYMENT_IN_FLIGHT',
  paid: 'ACTIVE',
  notDue: 'ACTIVE',
  otherVehicle: 'EXPIRED',
};

describe.each(COUNTRIES)('L0-04 — instruction 2a sur 10 000 holds ($country, $currency)', (c) => {
  it(
    'deux index sans parcours séquentiel, hold verrouillé sauté, A3 / A6 respectés, p95 < 300 ms',
    async () => {
      const api = await connectAs('app_api');
      const worker = await connectAs('app_worker');
      const conversion = await connectAs('app_worker');
      try {
        // Volume : 10 000 holds sur 1 000 véhicules, puis statistiques du planificateur
        const seeded = await inTx(api, { virtualNow: TL, commit: true }, async (tx) => {
          const orgId = uuid();
          const r = await tx.query<{ n: number }>(
            `SELECT test_fixture.l0_seed_expiry_bench($1, $2, $3, $4::bigint, $5, $6, $7) AS n`,
            [orgId, c.country, c.currency, c.rentMinor, VEHICLES, HOLDS_PER_VEHICLE, GUESTS],
          );
          return r.rows[0]?.n;
        });
        expect(seeded).toBe(VEHICLES * HOLDS_PER_VEHICLE);
        const s = await scenario(api, c);
        await inTx(api, { commit: true }, (tx) => tx.query('SELECT test_fixture.l0_analyze()'));

        // Barrière : une conversion tient le verrou de ligne du hold `locked` (17 §2.5 étape 4.1)
        await conversion.query('BEGIN');
        try {
          await conversion.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'booking_conversion', true)`,
          );
          const lockedRow = await conversion.query(
            'SELECT id FROM core.booking_checkout_hold WHERE id = $1 FOR UPDATE',
            [s.locked.holdId],
          );
          expect(lockedRow.rowCount).toBe(1);

          // (1) tâche d'expiration, app_worker `hold_expiry`
          const byWorker = await inTx(
            worker,
            { worker: 'hold_expiry', virtualNow: TL },
            async (tx) => {
              const n = await expireDueHolds(tx, s.vehicleId, s.guest);
              return { n, st: await statuses(tx, s) };
            },
          );
          expect(byWorker.n).toBe(2);
          expect(byWorker.st).toEqual(EXPECTED);

          // (2) commande de pose sous app_api : 2a, puis insertion sur un créneau libre de V*
          const pose = await inTx(api, { virtualNow: TL }, async (tx) => {
            const slot = slotOn(s.vehicleId, s.orgId, 20);
            await ensureParties(tx, [s.guest], s.orgId, c);
            return placeHoldLocked(tx, {
              slot,
              c,
              guestId: s.guest,
              period: slotPeriod(slot),
              vehicleLock: true,
            });
          });
          expect([...pose.expired].sort()).toEqual([s.due.holdId, s.otherVehicle.holdId].sort());

          // (3) plan : EXPLAIN (ANALYZE, BUFFERS) de 2a, sous app_worker `hold_expiry`
          const plan = await inTx(worker, { worker: 'hold_expiry', virtualNow: TL }, async (tx) => {
            const r = await tx.query<{ 'QUERY PLAN': unknown }>(
              `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${EXPIRY_2A_SQL}`,
              [s.vehicleId, s.guest, SWEEP_GRACE_S],
            );
            const raw = r.rows[0]?.['QUERY PLAN'];
            const json = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
              Plan: PlanNode;
              'Execution Time': number;
            }[];
            return json[0] as { Plan: PlanNode; 'Execution Time': number };
          });
          const nodes = walk(plan.Plan);
          const scans = nodes
            .filter((n) => n['Relation Name'] !== undefined || n['Index Name'] !== undefined)
            .map((n) => `${n['Node Type']}:${n['Index Name'] ?? n['Relation Name'] ?? ''}`);
          const seqScans = nodes.filter((n) => n['Node Type'] === 'Seq Scan');
          const usedIndexes = new Set(nodes.map((n) => n['Index Name']).filter(Boolean));

          // (4) p95 de 2a (transactions annulées, verrou de la conversion toujours tenu)
          const ms: number[] = [];
          for (let i = 0; i < P95_RUNS; i++) {
            await inTx(worker, { worker: 'hold_expiry', virtualNow: TL }, async (tx) => {
              const started = performance.now();
              await expireDueHolds(tx, s.vehicleId, s.guest);
              ms.push(performance.now() - started);
            });
          }
          const p95 = Math.round(percentile(ms, 0.95) * 100) / 100;
          console.log(
            `[L0-04] ${c.country} ${JSON.stringify({
              holds: seeded,
              vehicles: VEHICLES,
              executionTimeMs: plan['Execution Time'],
              scans,
              p95Ms: p95,
            })}`,
          );
          // deux index distincts, un par branche de l'OR, combinés dans un BitmapOr
          expect(
            nodes.some((n) => n['Node Type'] === 'BitmapOr'),
            scans.join(', '),
          ).toBe(true);
          expect(
            VEHICLE_INDEXES.some((i) => usedIndexes.has(i)),
            scans.join(', '),
          ).toBe(true);
          expect(
            GUEST_INDEXES.some((i) => usedIndexes.has(i)),
            scans.join(', '),
          ).toBe(true);
          expect(seqScans, scans.join(', ')).toEqual([]);
          expect(p95).toBeLessThan(POSE_P95_MS);
        } finally {
          await conversion.query('ROLLBACK');
          await conversion.query('RESET ALL');
        }

        // Le verrou rendu, le hold `locked` est expirable : il était bien sauté, pas exclu
        const after = await inTx(worker, { worker: 'hold_expiry', virtualNow: TL }, (tx) =>
          expireDueHolds(tx, s.vehicleId, s.guest),
        );
        expect(after).toBe(3);
      } finally {
        await releaseClient(conversion);
        await releaseClient(worker);
        await releaseClient(api);
      }
    },
    LONG,
  );
});
