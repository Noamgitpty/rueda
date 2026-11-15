/**
 * US-207 — machine à états du trip (migration 0099, ADR-125 ; fixture 9997). Rôles de production
 * seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au Paraguay (PYG). Chaque test
 * pose ses propres trips (parcours nominal hold → preuve → conversion d'US-024).
 *
 * Attendus tirés de 19 US-207, de 16 TRP-045, de 08 SM-1 (diagramme et invariants 1 à 4), des
 * règles de qualification 1 à 3 et de la table de décision BR-CXL (colonne « État SM-1 »), des
 * vecteurs T05, T06 et T25, de 11 EC-54 et de 17 §3.2.4, §4.5, §7.2 (`no_show_grace_minutes` = 60,
 * `overdue_detection_minutes` = 30), jamais du code testé :
 * - critère 1 : un trip IN_PROGRESS refuse toute annulation (TRIP_TRANSITION_FORBIDDEN), sans
 *   écriture ;
 * - critère 2 : T25, une annulation du voyageur reçue à T+75 min sans check-in devient
 *   GUEST_NO_SHOW (NO_SHOW_GUEST) ; bornes à T+59 et T+60 ; T05 / T06 (même état, quel que soit
 *   l'initiateur) ; règles 2 et 3 ;
 * - critère 3 : chaque transition (naissance comprise) écrit une ligne `trip_state_log` et un
 *   événement `trip.status_changed` dans la même transaction ;
 * - chaque paire hors de SM-1 est refusée (L2-PM-24) ; échéances à la minute près (L2-PM-13) ;
 *   course de deux annulations (EC-54) ; aucune écriture directe de l'état.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, newSlot, uuid } from '../support/avl.ts';
import type { CountryCase, Worker } from '../support/avl.ts';

/** 17 §7.2 : défauts PROPOSÉS au PA et au PY (graine 0009). */
const NO_SHOW_GRACE_MIN = 60;
const OVERDUE_DETECTION_MIN = 30;

/** 08 SM-1 : transitions du trip (hors QUOTE / HOLD et hors la boucle des modifications). */
const SM1: readonly (readonly [string, string])[] = [
  ['BOOKED', 'CHECKIN_OPEN'],
  ['BOOKED', 'CANCELLED_BY_GUEST'],
  ['BOOKED', 'CANCELLED_BY_HOST'],
  ['BOOKED', 'CANCELLED_BY_PLATFORM'],
  ['CHECKIN_OPEN', 'CANCELLED_BY_GUEST'],
  ['CHECKIN_OPEN', 'CANCELLED_BY_HOST'],
  ['CHECKIN_OPEN', 'CANCELLED_BY_PLATFORM'],
  ['CHECKIN_OPEN', 'REFUSED_AT_PICKUP'],
  ['CHECKIN_OPEN', 'NO_SHOW_GUEST'],
  ['CHECKIN_OPEN', 'NO_SHOW_HOST'],
  ['CHECKIN_OPEN', 'START_WINDOW_EXPIRED'],
  ['CHECKIN_OPEN', 'IN_PROGRESS'],
  ['START_WINDOW_EXPIRED', 'NO_SHOW_GUEST'],
  ['START_WINDOW_EXPIRED', 'NO_SHOW_HOST'],
  ['START_WINDOW_EXPIRED', 'IN_PROGRESS'],
  ['START_WINDOW_EXPIRED', 'CANCELLED_BY_HOST'],
  ['START_WINDOW_EXPIRED', 'CANCELLED_BY_PLATFORM'],
  ['START_WINDOW_EXPIRED', 'CANCELLED_BY_GUEST'],
  ['START_WINDOW_EXPIRED', 'REFUSED_AT_PICKUP'],
  ['IN_PROGRESS', 'OVERDUE'],
  ['IN_PROGRESS', 'RETURNED'],
  ['IN_PROGRESS', 'TERMINATED_EARLY'],
  ['OVERDUE', 'IN_PROGRESS'],
  ['OVERDUE', 'RETURNED'],
  ['OVERDUE', 'UNRETURNED'],
  ['UNRETURNED', 'RETURNED'],
  ['UNRETURNED', 'VEHICLE_LOST'],
  ['TERMINATED_EARLY', 'RETURNED'],
  ['TERMINATED_EARLY', 'VEHICLE_LOST'],
  ['TERMINATED_EARLY', 'POST_TRIP'],
  ['VEHICLE_LOST', 'POST_TRIP'],
  ['RETURNED', 'POST_TRIP'],
  ['POST_TRIP', 'COMPLETED'],
  ['POST_TRIP', 'IN_DISPUTE'],
  ['COMPLETED', 'IN_DISPUTE'],
  ['IN_DISPUTE', 'COMPLETED'],
];
const STATES = [
  'BOOKED',
  'CHECKIN_OPEN',
  'START_WINDOW_EXPIRED',
  'IN_PROGRESS',
  'OVERDUE',
  'RETURNED',
  'UNRETURNED',
  'TERMINATED_EARLY',
  'VEHICLE_LOST',
  'POST_TRIP',
  'COMPLETED',
  'IN_DISPUTE',
  'CANCELLED_BY_GUEST',
  'CANCELLED_BY_HOST',
  'CANCELLED_BY_PLATFORM',
  'REFUSED_AT_PICKUP',
  'NO_SHOW_GUEST',
  'NO_SHOW_HOST',
] as const;
/** Annulations et no-shows : commande d'annulation, motif dont l'état cible est celui visé (BR-CXL). */
const CANCEL_BY_TARGET: Readonly<Record<string, readonly [string, string | null] | null>> = {
  CANCELLED_BY_GUEST: ['GUEST_CANCELLED', null],
  CANCELLED_BY_HOST: ['HOST_CANCELLED', null],
  CANCELLED_BY_PLATFORM: ['PSP_FAILURE', null],
  // règle 3 : avant noShowAt, seulement avec un sous-motif constaté au retrait
  NO_SHOW_GUEST: ['GUEST_NO_SHOW', 'INVALID_LICENSE'],
  NO_SHOW_HOST: ['HOST_NO_SHOW', null],
  // motif n° 8 (CLEANLINESS_SAFETY_VALID) hors du sous-ensemble bêta : aucun motif n'y mène
  REFUSED_AT_PICKUP: null,
};
/** Motif d'une transition de cycle de vie (code libre, sauf IN_PROGRESS et TERMINATED_EARLY). */
const LIFECYCLE_REASON: Readonly<Record<string, string>> = {
  IN_PROGRESS: 'CHECKIN_VALIDATED',
  TERMINATED_EARLY: 'TERM_BREAKDOWN_NOT_GUEST',
};

const T0 = '2034-03-01T12:00:00.000Z';
let slotDay = 0;
/** Créneau propre à chaque trip (2 jours), une semaine après T0, sans recouvrement. */
function freshSlot() {
  slotDay += 4;
  const start = new Date(Date.parse('2034-03-08T15:00:00.000Z') + slotDay * 86_400_000);
  return newSlot(start.toISOString(), new Date(start.getTime() + 2 * 86_400_000).toISOString());
}

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

interface Booked {
  readonly tripId: string;
  readonly guestId: string;
  readonly occupancyId: string;
  readonly start: string;
  readonly end: string;
}

async function booked(cl: Clients, c: CountryCase): Promise<Booked> {
  const slot = freshSlot();
  const { hold, tripId } = await bookTrip(cl.api, cl.worker, slot, c, T0);
  return {
    tripId,
    guestId: hold.guestId,
    occupancyId: hold.occupancyId,
    start: slot.start,
    end: slot.end,
  };
}

type Outcome =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly code: string;
      readonly sqlstate: string | undefined;
    };

/** Appel dans un SAVEPOINT : résultat de la commande ou code métier traduit. */
async function attempt(tx: pg.ClientBase, sql: string, args: unknown[]): Promise<Outcome> {
  await tx.query('SAVEPOINT us207');
  try {
    const r = await tx.query<{ r: Record<string, unknown> }>(sql, args);
    await tx.query('RELEASE SAVEPOINT us207');
    return { ok: true, value: r.rows[0]?.r ?? {} };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us207');
    return {
      ok: false,
      code: translateDbError(error).code,
      sqlstate: (error as { code?: string }).code,
    };
  }
}

const TRANSITION = 'SELECT core.booking_cmd_trip_transition($1, $2, $3, $4) AS r';
const CANCEL = 'SELECT core.booking_cmd_trip_cancel($1, $2, $3, $4, $5, $6) AS r';

const transition = (
  tx: pg.ClientBase,
  trip: string,
  to: string,
  reason: string,
  version?: number,
) => attempt(tx, TRANSITION, [trip, to, reason, version ?? null]);
const cancel = (
  tx: pg.ClientBase,
  trip: string,
  reason: string,
  initiator: string,
  sub: string | null = null,
  evidence: boolean | null = null,
) => attempt(tx, CANCEL, [trip, reason, initiator, sub, evidence, null]);

/** Une étape validée sous `trip_lifecycle` à l'instant `now` ; échec ⇒ erreur du test. */
async function step(
  cl: Clients,
  now: string,
  fn: (tx: pg.ClientBase) => Promise<Outcome>,
): Promise<Record<string, unknown>> {
  const out = await inTx(
    cl.worker,
    { worker: 'trip_lifecycle', virtualNow: now, commit: true },
    fn,
  );
  if (!out.ok) throw new Error(`étape refusée : ${out.code}`);
  return out.value;
}

async function tripRow(cl: Clients, tripId: string) {
  return inTx(cl.worker, { worker: 'trip_lifecycle' }, async (tx) => {
    const r = await tx.query<{
      status: string;
      cancellation_reason: string | null;
      termination_reason: string | null;
      cancel_initiator: string | null;
      no_show_at: Date | null;
      checkin_validated_at: Date | null;
      row_version: number;
    }>(
      `SELECT status, cancellation_reason, termination_reason, cancel_initiator, no_show_at,
              checkin_validated_at, row_version
         FROM core.booking_trip WHERE id = $1`,
      [tripId],
    );
    return r.rows[0];
  });
}

async function fixture<T extends pg.QueryResultRow>(
  cl: Clients,
  fn: string,
  args: unknown[],
): Promise<T[]> {
  return (await cl.worker.query<T>(`SELECT * FROM test_fixture.${fn}`, args)).rows;
}

const stateLog = (cl: Clients, trip: string) =>
  fixture<{
    from_status: string | null;
    to_status: string;
    kind: string;
    reason_code: string;
    origin: string | null;
    actor_role: string;
    settlement_id: string | null;
  }>(cl, 'us207_state_log($1)', [trip]);
const events = (cl: Clients, trip: string) =>
  fixture<{
    type: string;
    aggregate_version: string;
    actor_role: string;
    country_code: string;
    payload: Record<string, unknown>;
  }>(cl, 'us207_events($1)', [trip]);

async function occupancies(cl: Clients, b: Booked) {
  return inTx(cl.worker, { worker: 'trip_lifecycle' }, async (tx) => {
    const v = await tx.query<{ active: boolean; deactivated_reason: string | null }>(
      `SELECT active, deactivated_reason FROM core.booking_vehicle_occupancy WHERE id = $1`,
      [b.occupancyId],
    );
    const g = await tx.query<{ active: boolean }>(
      `SELECT active FROM core.booking_guest_occupancy WHERE trip_id = $1`,
      [b.tripId],
    );
    return { vehicle: v.rows[0], guest: g.rows[0]?.active };
  });
}

/** Amène un trip BOOKED jusqu'à IN_PROGRESS (check-in validé au départ). */
async function toInProgress(cl: Clients, b: Booked): Promise<void> {
  await step(cl, at(b.start, -60), (tx) =>
    transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
  );
  await step(cl, at(b.start, 5), (tx) =>
    transition(tx, b.tripId, 'IN_PROGRESS', 'CHECKIN_VALIDATED'),
  );
}

describe.each(COUNTRIES)('US-207 — machine à états du trip ($country, $currency)', (c) => {
  it('naissance (SM-1 HOLD → BOOKED) : no_show_at figé, segment n° 1, conducteur PRIMARY, journal et trip.status_changed', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      const t = await tripRow(cl, b.tripId);
      expect(t?.status).toBe('BOOKED');
      expect(t?.no_show_at).toEqual(new Date(at(b.start, NO_SHOW_GRACE_MIN)));
      expect(t?.checkin_validated_at).toBeNull();
      expect(await fixture(cl, 'us207_segment($1)', [b.tripId])).toEqual([
        {
          seq: 1,
          lo: new Date(b.start),
          hi: new Date(b.end),
          billable_days: null,
          payment_status: 'CONFIRMED',
        },
      ]);
      expect(await fixture(cl, 'us207_driver($1)', [b.tripId])).toEqual([
        { user_id: b.guestId, role: 'PRIMARY', approved: true },
      ]);
      expect(await stateLog(cl, b.tripId)).toEqual([
        {
          from_status: null,
          to_status: 'BOOKED',
          kind: 'TRANSITION',
          reason_code: 'HOLD_CONVERTED',
          origin: null,
          actor_role: 'SYSTEM',
          settlement_id: null,
        },
      ]);
      expect(await events(cl, b.tripId)).toEqual([
        {
          type: 'trip.status_changed',
          aggregate_version: '0',
          actor_role: 'SYSTEM',
          country_code: c.country,
          payload: {
            trip_id: b.tripId,
            from: null,
            to: 'BOOKED',
            reason: 'HOLD_CONVERTED',
            settlement_id: null,
          },
        },
      ]);
    });
  });

  it('critère 1 : trip IN_PROGRESS, annulation demandée (voyageur, hôte, plateforme) ⇒ TRIP_TRANSITION_FORBIDDEN, rien n’est écrit', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      await toInProgress(cl, b);
      const before = await tripRow(cl, b.tripId);
      const logBefore = await stateLog(cl, b.tripId);
      for (const [reason, initiator] of [
        ['GUEST_CANCELLED', 'GUEST'],
        ['HOST_CANCELLED', 'HOST'],
        ['PLATFORM_TRUST_SAFETY', 'PLATFORM'],
        ['GUEST_NO_SHOW', 'SYSTEM'],
        ['HOST_NO_SHOW', 'GUEST'],
      ] as const) {
        const out = await inTx(
          cl.worker,
          { worker: 'trip_lifecycle', virtualNow: at(b.start, 120), commit: true },
          (tx) => cancel(tx, b.tripId, reason, initiator),
        );
        expect(out, reason).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });
      }
      expect(await tripRow(cl, b.tripId)).toEqual(before);
      expect(await stateLog(cl, b.tripId)).toEqual(logBefore);
      expect((await occupancies(cl, b)).vehicle?.active).toBe(true);
      // la fin forcée passe par TERMINATED_EARLY, avec un motif de fin obligatoire (invariant 4)
      const noReason = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.start, 130) },
        (tx) => transition(tx, b.tripId, 'TERMINATED_EARLY', 'GUEST_CANCELLED'),
      );
      expect(noReason).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });
      await step(cl, at(b.start, 130), (tx) =>
        transition(tx, b.tripId, 'TERMINATED_EARLY', 'TERM_BREAKDOWN_NOT_GUEST'),
      );
      expect(await tripRow(cl, b.tripId)).toMatchObject({
        status: 'TERMINATED_EARLY',
        termination_reason: 'TERM_BREAKDOWN_NOT_GUEST',
        cancellation_reason: null,
      });
    });
  });

  it('critère 2 (T25) : annulation du voyageur à T+75 min sans check-in ⇒ GUEST_NO_SHOW (NO_SHOW_GUEST), origine LATE_GUEST_CANCELLATION', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      await step(cl, at(b.start, -60), (tx) =>
        transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      // noShowAt atteint sans check-in : START_WINDOW_EXPIRED (minuterie), à la minute près
      const early = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.start, NO_SHOW_GRACE_MIN - 1) },
        (tx) => transition(tx, b.tripId, 'START_WINDOW_EXPIRED', 'NO_SHOW_AT_REACHED'),
      );
      expect(early).toMatchObject({ ok: false, code: 'REJECTED_TOO_EARLY' });
      await step(cl, at(b.start, NO_SHOW_GRACE_MIN), (tx) =>
        transition(tx, b.tripId, 'START_WINDOW_EXPIRED', 'NO_SHOW_AT_REACHED'),
      );
      const r = await step(cl, at(b.start, 75), (tx) =>
        cancel(tx, b.tripId, 'GUEST_CANCELLED', 'GUEST'),
      );
      expect(r).toMatchObject({
        status: 'NO_SHOW_GUEST',
        reason: 'GUEST_NO_SHOW',
        origin: 'LATE_GUEST_CANCELLATION',
        requestedReason: 'GUEST_CANCELLED',
      });
      expect(await tripRow(cl, b.tripId)).toMatchObject({
        status: 'NO_SHOW_GUEST',
        cancellation_reason: 'GUEST_NO_SHOW',
        cancel_initiator: 'GUEST',
      });
      // le créneau est libéré dans la même transaction (I-OCC)
      expect(await occupancies(cl, b)).toEqual({
        vehicle: { active: false, deactivated_reason: 'TRIP_TERMINAL' },
        guest: false,
      });
      const log = await stateLog(cl, b.tripId);
      expect(log.at(-1)).toMatchObject({
        from_status: 'START_WINDOW_EXPIRED',
        to_status: 'NO_SHOW_GUEST',
        reason_code: 'GUEST_NO_SHOW',
        origin: 'LATE_GUEST_CANCELLATION',
        actor_role: 'GUEST',
      });
      const ev = await events(cl, b.tripId);
      expect(ev.filter((e) => e.type === 'trip.cancellation.qualified')).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            trip_id: b.tripId,
            requested_reason: 'GUEST_CANCELLED',
            reason: 'GUEST_NO_SHOW',
            origin: 'LATE_GUEST_CANCELLATION',
            initiator: 'GUEST',
            to: 'NO_SHOW_GUEST',
          }),
        }),
      ]);
      // état terminal : un second événement (passage automatique à T+72 h) est refusé (EC-54)
      const late = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.start, 72 * 60) },
        (tx) => cancel(tx, b.tripId, 'GUEST_NO_SHOW', 'SYSTEM'),
      );
      expect(late).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });
    });
  });

  it('règle 1 à la minute près : T+59 ⇒ CANCELLED_BY_GUEST ; T+60 exactement ⇒ requalifiée GUEST_NO_SHOW (depuis CHECKIN_OPEN)', async () => {
    await withClients(async (cl) => {
      for (const [minute, status, reason, origin] of [
        [NO_SHOW_GRACE_MIN - 1, 'CANCELLED_BY_GUEST', 'GUEST_CANCELLED', 'EVENT'],
        [NO_SHOW_GRACE_MIN, 'NO_SHOW_GUEST', 'GUEST_NO_SHOW', 'LATE_GUEST_CANCELLATION'],
      ] as const) {
        const b = await booked(cl, c);
        await step(cl, at(b.start, -60), (tx) =>
          transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
        );
        const r = await step(cl, at(b.start, minute), (tx) =>
          cancel(tx, b.tripId, 'GUEST_CANCELLED', 'GUEST'),
        );
        expect(r, `T+${minute}`).toMatchObject({ status, reason, origin });
      }
    });
  });

  it('T05 / T06 : no-show déclaré par l’hôte (T+70 min) ou automatiquement (T+72 h) ⇒ même état NO_SHOW_GUEST et même motif', async () => {
    await withClients(async (cl) => {
      const results: Record<string, unknown>[] = [];
      for (const [minute, initiator] of [
        [70, 'HOST'],
        [72 * 60, 'SYSTEM'],
      ] as const) {
        const b = await booked(cl, c);
        await step(cl, at(b.start, -60), (tx) =>
          transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
        );
        await step(cl, at(b.start, NO_SHOW_GRACE_MIN), (tx) =>
          transition(tx, b.tripId, 'START_WINDOW_EXPIRED', 'NO_SHOW_AT_REACHED'),
        );
        const r = await step(cl, at(b.start, minute), (tx) =>
          cancel(tx, b.tripId, 'GUEST_NO_SHOW', initiator),
        );
        results.push({ status: r.status, reason: r.reason, origin: r.origin });
      }
      expect(results[0]).toEqual({
        status: 'NO_SHOW_GUEST',
        reason: 'GUEST_NO_SHOW',
        origin: 'EVENT',
      });
      expect(results[1]).toEqual(results[0]);
    });
  });

  it('règles 2 et 3 : no-show avant noShowAt refusé (REJECTED_TOO_EARLY) sauf constat au retrait ; annulation de l’hôte « à cause du voyageur » sans preuve ⇒ HOST_CANCELLED', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      await step(cl, at(b.start, -60), (tx) =>
        transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      const tooEarly = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.start, 30) },
        (tx) => cancel(tx, b.tripId, 'GUEST_NO_SHOW', 'HOST'),
      );
      expect(tooEarly).toMatchObject({ ok: false, code: 'REJECTED_TOO_EARLY' });
      const pickup = await step(cl, at(b.start, 30), (tx) =>
        cancel(tx, b.tripId, 'GUEST_NO_SHOW', 'HOST', 'INVALID_LICENSE'),
      );
      expect(pickup).toMatchObject({
        status: 'NO_SHOW_GUEST',
        reason: 'GUEST_NO_SHOW',
        origin: 'PICKUP_CHECK',
      });

      const b2 = await booked(cl, c);
      await step(cl, at(b2.start, -60), (tx) =>
        transition(tx, b2.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      const noEvidence = await step(cl, at(b2.start, 10), (tx) =>
        cancel(tx, b2.tripId, 'HOST_CANCELLED_DUE_TO_GUEST', 'HOST', 'INVALID_LICENSE', false),
      );
      expect(noEvidence).toMatchObject({
        status: 'CANCELLED_BY_HOST',
        reason: 'HOST_CANCELLED',
        origin: 'REQUALIFIED_NO_EVIDENCE',
      });

      const b3 = await booked(cl, c);
      await step(cl, at(b3.start, -60), (tx) =>
        transition(tx, b3.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      const withEvidence = await step(cl, at(b3.start, 10), (tx) =>
        cancel(tx, b3.tripId, 'HOST_CANCELLED_DUE_TO_GUEST', 'HOST', 'INVALID_LICENSE', true),
      );
      expect(withEvidence).toMatchObject({
        status: 'NO_SHOW_GUEST',
        reason: 'HOST_CANCELLED_DUE_TO_GUEST',
        origin: 'EVENT',
      });
    });
  });

  it('critère 3 : chaque transition d’un trip complet écrit sa ligne de journal et son trip.status_changed ; OVERDUE à fin + 30 min exactement', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      await toInProgress(cl, b);
      const tooEarly = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.end, OVERDUE_DETECTION_MIN - 1) },
        (tx) => transition(tx, b.tripId, 'OVERDUE', 'OVERDUE_DETECTED'),
      );
      expect(tooEarly).toMatchObject({ ok: false, code: 'REJECTED_TOO_EARLY' });
      await step(cl, at(b.end, OVERDUE_DETECTION_MIN), (tx) =>
        transition(tx, b.tripId, 'OVERDUE', 'OVERDUE_DETECTED'),
      );
      expect((await occupancies(cl, b)).vehicle?.active).toBe(true);
      await step(cl, at(b.end, 90), (tx) =>
        transition(tx, b.tripId, 'RETURNED', 'CHECKOUT_COMPLETED'),
      );
      expect(await occupancies(cl, b)).toEqual({
        vehicle: { active: false, deactivated_reason: 'TRIP_TERMINAL' },
        guest: false,
      });
      await step(cl, at(b.end, 120), (tx) =>
        transition(tx, b.tripId, 'POST_TRIP', 'OPERATIONAL_WINDOWS_OPEN'),
      );
      await step(cl, at(b.end, 10 * 24 * 60), (tx) =>
        transition(tx, b.tripId, 'COMPLETED', 'OPERATIONAL_WINDOWS_CLOSED'),
      );
      const path = [
        [null, 'BOOKED', 'HOLD_CONVERTED'],
        ['BOOKED', 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'],
        ['CHECKIN_OPEN', 'IN_PROGRESS', 'CHECKIN_VALIDATED'],
        ['IN_PROGRESS', 'OVERDUE', 'OVERDUE_DETECTED'],
        ['OVERDUE', 'RETURNED', 'CHECKOUT_COMPLETED'],
        ['RETURNED', 'POST_TRIP', 'OPERATIONAL_WINDOWS_OPEN'],
        ['POST_TRIP', 'COMPLETED', 'OPERATIONAL_WINDOWS_CLOSED'],
      ] as const;
      expect(
        (await stateLog(cl, b.tripId)).map((l) => [l.from_status, l.to_status, l.reason_code]),
      ).toEqual(path);
      const ev = await events(cl, b.tripId);
      expect(ev.every((e) => e.type === 'trip.status_changed')).toBe(true);
      expect(ev.map((e) => [e.payload.from, e.payload.to, e.payload.reason])).toEqual(path);
      // aggregate_version = row_version du trip après la transition (croissant)
      const versions = ev.map((e) => Number(e.aggregate_version));
      expect([...versions].sort((x, y) => x - y)).toEqual(versions);
      expect(new Set(versions).size).toBe(versions.length);
      const t = await tripRow(cl, b.tripId);
      expect(t?.checkin_validated_at).toEqual(new Date(at(b.start, 5)));
      expect(Number(versions.at(-1))).toBe(t?.row_version);
    });
  });

  it('L2-PM-24 : la table des transitions est SM-1, et CHAQUE paire hors de SM-1 est refusée (TRIP_TRANSITION_FORBIDDEN), y compris vers BOOKED', async () => {
    await withClients(async (cl) => {
      const table = await fixture<{ from_status: string; to_status: string; via: string }>(
        cl,
        'us207_transitions()',
        [],
      );
      expect(table.map((r) => `${r.from_status}>${r.to_status}`).sort()).toEqual(
        SM1.map(([f, t]) => `${f}>${t}`).sort(),
      );
      for (const r of table) {
        expect(r.via, `${r.from_status}>${r.to_status}`).toBe(
          r.to_status in CANCEL_BY_TARGET ? 'CANCEL' : 'TRANSITION',
        );
      }
      const allowed = new Set(SM1.map(([f, t]) => `${f}>${t}`));
      const b = await booked(cl, c);
      let refused = 0;
      for (const from of STATES) {
        for (const to of STATES) {
          if (allowed.has(`${from}>${to}`)) continue;
          const out = await inTx(
            cl.worker,
            { worker: 'trip_lifecycle', virtualNow: at(b.start, -120) },
            async (tx) => {
              await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [b.tripId, from]);
              const viaCancel = CANCEL_BY_TARGET[to];
              if (to in CANCEL_BY_TARGET) {
                if (viaCancel === null || viaCancel === undefined) {
                  return transition(tx, b.tripId, to, 'TEST_EVENT');
                }
                return cancel(tx, b.tripId, viaCancel[0], 'SYSTEM', viaCancel[1]);
              }
              return transition(tx, b.tripId, to, LIFECYCLE_REASON[to] ?? 'TEST_EVENT');
            },
          );
          expect(out, `${from} -> ${to}`).toMatchObject({
            ok: false,
            code: 'TRIP_TRANSITION_FORBIDDEN',
          });
          refused += 1;
        }
      }
      expect(refused).toBe(STATES.length * STATES.length - SM1.length);
      // une annulation ne passe jamais par la commande de cycle de vie, même sur une paire de SM-1
      const viaTransition = await inTx(
        cl.worker,
        { worker: 'trip_lifecycle', virtualNow: at(b.start, -120) },
        (tx) => transition(tx, b.tripId, 'CANCELLED_BY_GUEST', 'GUEST_CANCELLED'),
      );
      expect(viaTransition).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });
      expect(await tripRow(cl, b.tripId)).toMatchObject({ status: 'BOOKED' });
      expect(await stateLog(cl, b.tripId)).toHaveLength(1);
    });
  });

  it('écriture par commandes seulement : UPDATE direct de l’état refusé (42501) ; autre travailleur ou app_api : FORBIDDEN ; row_version périmée : TRIP_CONCURRENT_UPDATE', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      for (const sql of [
        `UPDATE core.booking_trip SET status = 'CANCELLED_BY_GUEST' WHERE id = $1`,
        `UPDATE core.booking_trip SET cancellation_reason = 'GUEST_CANCELLED' WHERE id = $1`,
        `UPDATE core.booking_trip SET termination_reason = 'TERM_GUEST_FAULT' WHERE id = $1`,
      ]) {
        const out = await inTx(cl.worker, { worker: 'trip_lifecycle' }, (tx) =>
          attempt(tx, `${sql} RETURNING '{}'::jsonb AS r`, [b.tripId]),
        );
        expect(out, sql).toMatchObject({ ok: false, sqlstate: '42501' });
      }
      for (const w of ['booking_conversion', 'hold_expiry', 'outbox_relay'] as Worker[]) {
        const out = await inTx(cl.worker, { worker: w }, (tx) =>
          transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
        );
        expect(out, w).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        const out2 = await inTx(cl.worker, { worker: w }, (tx) =>
          cancel(tx, b.tripId, 'GUEST_CANCELLED', 'GUEST'),
        );
        expect(out2, w).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      }
      const api = await inTx(cl.api, {}, (tx) =>
        transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      expect(api).toMatchObject({ ok: false, sqlstate: '42501' });
      // trip inconnu : la même réponse qu'une paire interdite (rien n'est révélé)
      const unknown = await inTx(cl.worker, { worker: 'trip_lifecycle' }, (tx) =>
        transition(tx, uuid(), 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED'),
      );
      expect(unknown).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });

      const version = (await tripRow(cl, b.tripId))?.row_version as number;
      const stale = await inTx(cl.worker, { worker: 'trip_lifecycle', virtualNow: T0 }, (tx) =>
        transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', version + 1),
      );
      expect(stale).toMatchObject({ ok: false, code: 'TRIP_CONCURRENT_UPDATE' });
      const fresh = await step(cl, T0, (tx) =>
        transition(tx, b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', version),
      );
      expect(fresh).toMatchObject({ status: 'CHECKIN_OPEN', rowVersion: version + 1 });
      // motif ou initiateur hors de la table de décision
      for (const [reason, initiator] of [
        ['GUEST_REQUEST', 'GUEST'],
        ['GUEST_CANCELLED', 'ANYONE'],
      ] as const) {
        const out = await inTx(cl.worker, { worker: 'trip_lifecycle', virtualNow: T0 }, (tx) =>
          cancel(tx, b.tripId, reason, initiator),
        );
        expect(out, reason).toMatchObject({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' });
      }
    });
  });

  it('EC-54 : deux annulations simultanées (voyageur et hôte) : une seule gagne, l’autre est refusée ; un seul journal d’annulation, un seul événement', async () => {
    const first = await withClients(async (cl) => booked(cl, c));
    const w1 = await connectAs('app_worker');
    const w2 = await connectAs('app_worker');
    try {
      const now = at(first.start, -24 * 60);
      const run = (w: pg.Client, reason: string, initiator: string) =>
        inTx(w, { worker: 'trip_lifecycle', virtualNow: now, commit: true }, (tx) =>
          cancel(tx, first.tripId, reason, initiator),
        );
      const results = await Promise.all([
        run(w1, 'GUEST_CANCELLED', 'GUEST'),
        run(w2, 'HOST_CANCELLED', 'HOST'),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        expect.objectContaining({ ok: false, code: 'TRIP_TRANSITION_FORBIDDEN' }),
      ]);
      await withClients(async (cl) => {
        const log = await stateLog(cl, first.tripId);
        expect(log).toHaveLength(2);
        const ev = await events(cl, first.tripId);
        expect(ev.filter((e) => e.type === 'trip.cancellation.qualified')).toHaveLength(1);
        expect(ev.filter((e) => e.type === 'trip.status_changed')).toHaveLength(2);
      });
    } finally {
      await releaseClient(w1);
      await releaseClient(w2);
    }
  });

  it('raccourcissement de la période par trip_lifecycle : le segment suit, l’état ne change pas', async () => {
    await withClients(async (cl) => {
      const b = await booked(cl, c);
      const shorter = at(b.end, -24 * 60);
      await inTx(cl.worker, { worker: 'trip_lifecycle', commit: true }, (tx) =>
        tx.query(`UPDATE core.booking_trip SET scheduled_end = $2 WHERE id = $1`, [
          b.tripId,
          shorter,
        ]),
      );
      expect(await fixture(cl, 'us207_segment($1)', [b.tripId])).toMatchObject([
        { seq: 1, lo: new Date(b.start), hi: new Date(shorter) },
      ]);
      expect(await stateLog(cl, b.tripId)).toHaveLength(1);
    });
  });
});
