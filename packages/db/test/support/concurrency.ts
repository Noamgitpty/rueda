/**
 * Aides des preuves de concurrence L0-02 / L0-04 (US-007, US-023) : barrière de départ par verrou
 * consultatif, attente observée dans `pg_locks`, rejeu des transactions (`40P01` / `40001`),
 * pose de hold par la commande réelle `core.booking_cmd_place_hold` (US-023) ou, pour la seule
 * injection « sans verrou par véhicule » de L0-02, par la fixture `l0_place_hold` (9002),
 * annulation de trip, percentiles.
 *
 * Toutes les connexions passent par `connectAs` (assertion L0-05 en tête). Les valeurs attendues
 * des tests viennent de 17 (§2.5, §11) et de 16 A.8, jamais de ce fichier.
 */
import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { commandCallSql, setSessionContext } from '../../src/index.ts';
import { HOLD_TTL, SWEEP_GRACE_S, uuid } from './avl.ts';
import type { CountryCase, Slot } from './avl.ts';
export {
  cascadeBackoff,
  MAX_REPLAYS,
  percentile,
  SHORT_BACKOFF,
  sqlState,
  withReplay,
} from './replay.ts';
export type { Replayed, ReplayBackoff } from './replay.ts';

/** Seuil de C1 / L0-02 : p95 de la pose < 300 ms (17 §11). */
export const POSE_P95_MS = 300;
/** pid du serveur d'une connexion (`pg.Client.processID`). */
export async function backendPid(client: pg.ClientBase): Promise<number> {
  const r = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
  return r.rows[0]?.pid as number;
}

/**
 * Attend que la session `pid` soit bloquée sur un verrou (ligne non accordée de `pg_locks`,
 * lisible par tout rôle). Sert à prouver un entrelacement : « B attend le verrou de A ».
 */
export async function waitUntilBlocked(
  observer: pg.ClientBase,
  pid: number,
  locktype: 'advisory' | 'transactionid' | 'tuple' = 'advisory',
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await observer.query<{ waiting: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
                       WHERE pid = $1 AND NOT granted AND locktype = $2) AS waiting`,
      [pid, locktype],
    );
    if (r.rows[0]?.waiting === true) return;
    if (Date.now() > deadline) {
      throw new Error(`la session ${pid} n'attend aucun verrou ${locktype} après ${timeoutMs} ms`);
    }
    await sleep(5);
  }
}

/**
 * Barrière de départ (« barrières de test (verrous consultatifs) », 19 US-007) : le meneur prend
 * un verrou consultatif exclusif de session ; chaque concurrent demande le même verrou en mode
 * partagé, puis le rend. Quand tous attendent (compté dans `pg_locks`), le meneur relâche : tous
 * partent ensemble. La clé est tirée au hasard dans [1, 2³¹ − 1] : `classid` = 0, `objid` = clé.
 */
export class Barrier {
  private readonly leader: pg.ClientBase;
  readonly key: number;

  private constructor(leader: pg.ClientBase, key: number) {
    this.leader = leader;
    this.key = key;
  }

  static async open(leader: pg.ClientBase): Promise<Barrier> {
    const key = randomInt(1, 2 ** 31 - 1);
    await leader.query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [key]);
    return new Barrier(leader, key);
  }

  /** Appelée par un concurrent, hors transaction : bloque jusqu'à `release`. */
  async wait(client: pg.ClientBase): Promise<void> {
    await client.query('SELECT pg_catalog.pg_advisory_lock_shared($1::bigint)', [this.key]);
    await client.query('SELECT pg_catalog.pg_advisory_unlock_shared($1::bigint)', [this.key]);
  }

  /** Attend que `n` concurrents soient bloqués sur la barrière. */
  async waitForWaiters(n: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.leader.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_catalog.pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND classid = 0
            AND objid = $1::bigint::oid AND objsubid = 1`,
        [this.key],
      );
      if ((r.rows[0]?.n ?? 0) >= n) return;
      if (Date.now() > deadline) {
        throw new Error(
          `barrière : ${r.rows[0]?.n ?? 0} concurrents sur ${n} après ${timeoutMs} ms`,
        );
      }
      await sleep(5);
    }
  }

  async release(): Promise<void> {
    await this.leader.query('SELECT pg_catalog.pg_advisory_unlock($1::bigint)', [this.key]);
  }
}

/** Comptes du voyageur et compte d'hôte, créés avant la course (FK IAM depuis US-011). */
export async function ensureParties(
  tx: pg.ClientBase,
  guestIds: readonly string[],
  orgId: string,
  c: CountryCase,
): Promise<void> {
  await tx.query('SELECT test_fixture.l0_ensure_parties($1::uuid[], $2, $3)', [
    guestIds,
    orgId,
    c.country,
  ]);
}

export interface PoseArgs {
  readonly slot: Slot;
  readonly c: CountryCase;
  readonly guestId: string;
  readonly period: string;
  /** `false` = injection de L0-02 : pose sans le verrou consultatif du véhicule. */
  readonly vehicleLock: boolean;
}

export interface Pose {
  readonly holdId: string;
  readonly occupancyId: string;
  /** Holds expirés par l'instruction 2a de cette pose. */
  readonly expired: readonly string[];
}

/** Enregistre des véhicules (registre de test 9750, qui tient lieu du catalogue, US-115). */
export async function registerVehicles(
  tx: pg.ClientBase,
  vehicleIds: readonly string[],
  orgId: string,
  c: CountryCase,
): Promise<void> {
  for (const v of vehicleIds) {
    await tx.query('SELECT test_fixture.register_vehicle($1, $2, $3)', [v, orgId, c.country]);
  }
}

/**
 * Pose RÉELLE (US-023) : `core.booking_cmd_place_hold` sous `app_api`, contexte du voyageur et
 * appel dans UNE instruction (`commandCallSql`, ADR-056 point 4). Hors transaction : autocommit ;
 * dans la transaction ouverte de l'appelant : même instruction, contexte local à la transaction.
 * Renvoie l'identifiant du hold.
 */
export async function placeHoldCommand(
  client: pg.ClientBase,
  a: { readonly slot: Slot; readonly guestId: string; readonly flagged?: boolean | null },
): Promise<string> {
  const { text, values } = commandCallSql(
    { kind: 'GUEST', actorId: a.guestId },
    'core.booking_cmd_place_hold',
    [
      { value: a.slot.vehicleId, type: 'uuid' },
      { value: a.slot.start, type: 'timestamptz' },
      { value: a.slot.end, type: 'timestamptz' },
      { value: a.flagged === undefined ? false : a.flagged, type: 'boolean' },
    ],
  );
  const r = await client.query<{ result: string }>(text, values);
  return r.rows[0]?.result as string;
}

/**
 * Pose par la fixture `l0_place_hold` (9002) : verrous, 2a, insertion, sous `app_api`, dans la
 * transaction de l'appelant. Sert à l'INJECTION de L0-02 (`vehicleLock: false`), que la commande
 * réelle ne permet pas, et aux poses de mise en place qui choisissent leurs identifiants.
 */
export async function placeHoldLocked(tx: pg.ClientBase, a: PoseArgs): Promise<Pose> {
  const holdId = uuid();
  const occupancyId = uuid();
  const r = await tx.query<{ expired: string[] }>(
    `SELECT test_fixture.l0_place_hold($1, $2, $3, $4, $5, $6, $7::tstzrange, $8::interval, $9, $10)
              AS expired`,
    [
      holdId,
      occupancyId,
      a.guestId,
      a.slot.vehicleId,
      a.slot.orgId,
      a.c.country,
      a.period,
      HOLD_TTL,
      a.vehicleLock,
      SWEEP_GRACE_S,
    ],
  );
  return { holdId, occupancyId, expired: r.rows[0]?.expired ?? [] };
}

/** Instants serveur d'une pose mesurée (ms epoch, horloge de la base). */
export interface PoseTiming {
  /** Obtention du verrou du véhicule (ou du guest, sans verrou de véhicule). */
  readonly lockedAtMs: number;
  /** Fin de la commande (avant le COMMIT / ROLLBACK du client). */
  readonly doneAtMs: number;
  /** Pose gagnante (hold créé) ; `false` : perdante (`23P01`). */
  readonly ok: boolean;
}

/**
 * Appel de la pose RÉELLE mesurée (`test_fixture.l0_cmd_place_hold_timed`, 9750) dans la
 * transaction déjà ouverte de l'appelant, contexte du voyageur déjà posé.
 */
export async function placeHoldTimedInTx(
  tx: pg.ClientBase,
  a: PoseArgs,
): Promise<Omit<PoseTiming, 'ok'>> {
  const r = await tx.query<{ t: string }>(
    `SELECT test_fixture.l0_cmd_place_hold_timed($1, $2::timestamptz, $3::timestamptz) AS t`,
    [a.slot.vehicleId, a.slot.start, a.slot.end],
  );
  return JSON.parse(r.rows[0]?.t ?? '{}') as Omit<PoseTiming, 'ok'>;
}

/**
 * Pose sous la forme d'appel de 17 §2.3 : transaction explicite (`BEGIN`, contexte `app.*` par
 * `SET LOCAL`, appel de la commande, `COMMIT` ; `ROLLBACK` sur erreur). Une pose perdante garde
 * donc ses verrous jusqu'au `ROLLBACK` du client. Les instants serveur sont déposés dans `sink`,
 * succès comme échec (HINT de la fixture mesurée), puis l'erreur éventuelle est relancée.
 */
export async function placeHoldTransactional(
  client: pg.ClientBase,
  a: PoseArgs,
  sink: PoseTiming[],
): Promise<void> {
  await client.query('BEGIN');
  try {
    await setSessionContext(client, { kind: 'GUEST', actorId: a.guestId });
    const t = await placeHoldTimedInTx(client, a);
    await client.query('COMMIT');
    sink.push({ ...t, ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === 'string' && hint.startsWith('{')) {
      sink.push({ ...(JSON.parse(hint) as object), ok: false } as PoseTiming);
    }
    throw error;
  }
}

/**
 * Détention du verrou du véhicule mesurée côté serveur : le verrou passe au suivant dès qu'il
 * est rendu, donc détention(i) = obtention(i + 1) − obtention(i), dans l'ordre d'obtention (la
 * dernière pose n'a pas de suivant). `workMs` = fin de commande − obtention ; le reste de la
 * détention (`clientMs`) est l'aller-retour jusqu'au COMMIT / ROLLBACK du client.
 */
export function lockHolds(
  timings: readonly PoseTiming[],
): { holdMs: number; workMs: number; clientMs: number; ok: boolean }[] {
  const sorted = [...timings].sort((x, y) => x.lockedAtMs - y.lockedAtMs);
  return sorted.slice(0, -1).map((t, i) => {
    const holdMs = (sorted[i + 1] as PoseTiming).lockedAtMs - t.lockedAtMs;
    const workMs = t.doneAtMs - t.lockedAtMs;
    return { holdMs, workMs, clientMs: holdMs - workMs, ok: t.ok };
  });
}

/** Verrous consultatifs dans l'ordre global de 17 §2.5 : guest, puis véhicule. */
export async function lockGuestThenVehicle(
  tx: pg.ClientBase,
  guestId: string,
  vehicleId: string,
): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('guest:' || $1::text, 0))`, [
    guestId,
  ]);
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('veh:' || $1::text, 0))`, [
    vehicleId,
  ]);
}

/**
 * Annulation d'un trip par le voyageur (17 §2.5, VERIF_17-B4), sous le travailleur
 * `trip_lifecycle` : verrou du guest du trip, puis du véhicule, puis ligne `trip`
 * (`FOR UPDATE`) ; aucune ligne de hold. Le trip passe `CANCELLED_BY_GUEST` (état terminal de
 * SM-1), son occupation est désactivée (`TRIP_TERMINAL`), l'occupation du voyageur aussi.
 */
export async function cancelTripByGuest(
  tx: pg.ClientBase,
  trip: { readonly tripId: string; readonly guestId: string; readonly vehicleId: string },
): Promise<'CANCELLED' | 'NOOP'> {
  await lockGuestThenVehicle(tx, trip.guestId, trip.vehicleId);
  const t = await tx.query<{ status: string }>(
    `SELECT status FROM core.booking_trip WHERE id = $1 FOR UPDATE`,
    [trip.tripId],
  );
  if (t.rows[0]?.status !== 'BOOKED') return 'NOOP';
  await tx.query(
    `UPDATE core.booking_trip SET status = 'CANCELLED_BY_GUEST', cancellation_reason = 'GUEST_REQUEST'
      WHERE id = $1`,
    [trip.tripId],
  );
  await tx.query(
    `UPDATE core.booking_vehicle_occupancy SET active = false, deactivated_reason = 'TRIP_TERMINAL'
      WHERE ref_id = $1 AND kind = 'TRIP' AND active`,
    [trip.tripId],
  );
  await tx.query(`UPDATE core.booking_guest_occupancy SET active = false WHERE trip_id = $1`, [
    trip.tripId,
  ]);
  return 'CANCELLED';
}

/** Occupations actives d'un véhicule qui chevauchent `period` (exclusion : au plus une). */
export async function activeOccupancies(
  tx: pg.ClientBase,
  vehicleId: string,
  period: string,
): Promise<{ id: string; kind: string; ref_id: string | null }[]> {
  const r = await tx.query<{ id: string; kind: string; ref_id: string | null }>(
    `SELECT id, kind, ref_id FROM core.booking_vehicle_occupancy
      WHERE vehicle_id = $1 AND active AND period && $2::tstzrange`,
    [vehicleId, period],
  );
  return r.rows;
}
