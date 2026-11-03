/**
 * L0-02 — 17 §11 point 2 : écritures concurrentes dans l'index GiST, avec et sans verrou par
 * véhicule ; annulations de trip (B4). US-007 ; tests C1 et C16 (17 §11), EC-51.
 *
 * Attendu (17 §11, tableau L0 ; 17 §2.5 « Ordre global des verrous », « Reprise » ; 19 US-007) :
 * - C1, 100 poses concurrentes du même créneau, verrou consultatif par véhicule actif :
 *   exactement 1 hold, **0** `40P01`, p95 de pose < 300 ms ; les autres poses reçoivent `23P01`,
 *   traduit `VEHICLE_UNAVAILABLE` (17 §2.5 2d) ;
 * - C1 sans verrou (injection) : nombre de `40P01` consigné, rejeu correct (au plus 3 rejeux,
 *   17 §2.5 « Reprise ») : exactement 1 hold, toute autre pose finit `VEHICLE_UNAVAILABLE` ;
 * - C16, ré-acquisition (conversion d'un hold expiré) et pose concurrentes du même créneau, sans
 *   puis avec verrou : une seule occupation active ; soit trip (la pose finit
 *   `VEHICLE_UNAVAILABLE`), soit compensation `SLOT_LOST_AFTER_EXPIRY` (la pose obtient le hold) ;
 *   avec verrou, 0 `40P01` ; entrelacements forcés dans les deux ordres ;
 * - annulation de trip concurrente d'une pose sur le créneau libéré : l'annulation prend guest →
 *   véhicule → trip sans interblocage ; la pose qui attendait obtient le créneau.
 * Rôles (17 §11) : `app_api` (pose par la fixture qui tient lieu de `cmd_place_hold`, US-023),
 * `app_worker` (conversion `booking_conversion`, annulation `trip_lifecycle`). En USD (PA) et en
 * PYG (PY). C1 tourne **sans horloge virtuelle** (`platform.now()` réel, 17 §11 L0-06).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import {
  at,
  bookTrip,
  convert,
  COUNTRIES,
  expireDueHolds,
  inTx,
  insertRentOperation,
  newSlot,
  placeHold,
  receiveProof,
  slotPeriod,
  uuid,
} from '../support/avl.ts';
import type { CountryCase, Hold, Slot } from '../support/avl.ts';
import {
  activeOccupancies,
  Barrier,
  backendPid,
  cancelTripByGuest,
  ensureParties,
  lockGuestThenVehicle,
  percentile,
  lockHolds,
  placeHoldLocked,
  placeHoldTimedInTx,
  placeHoldTransactional,
  POSE_P95_MS,
  sqlState,
  waitUntilBlocked,
  withReplay,
} from '../support/concurrency.ts';
import type { PoseTiming, Replayed } from '../support/concurrency.ts';

/** C1 : 100 poses concurrentes (17 §11). */
const C1_POSES = 100;
/**
 * Connexions que la course ouvre en plus des poses : l'observateur (déjà compté dans
 * `pg_stat_activity` à la mesure), le `app_worker` de l'état final (ouvert après la fermeture des
 * poses) et une marge pour une session du banc qui s'ouvrirait pendant la course.
 */
const SPARE_CONNECTIONS = 5;
/** Courses C16 et annulation, par mode et par pays. */
const ROUNDS = 12;
const LONG = 240_000;

/** En CI, le banc a 200 connexions : le degré doit être exactement 100 (revue sécurité US-007). */
const isCi = (): boolean => process.env['CI'] !== undefined && process.env['CI'] !== '';

function expectDegree(degree: number): void {
  if (isCi()) expect(degree).toBe(C1_POSES);
  else expect(degree).toBeGreaterThanOrEqual(2);
}

const log = (line: string, data: unknown): void => {
  console.log(`[L0-02] ${line} ${JSON.stringify(data)}`);
};

async function withClients<T>(
  roles: readonly ('app_api' | 'app_worker')[],
  fn: (clients: pg.Client[]) => Promise<T>,
): Promise<T> {
  const clients: pg.Client[] = [];
  try {
    for (const role of roles) clients.push(await connectAs(role));
    return await fn(clients);
  } finally {
    await Promise.all(clients.map((cl) => releaseClient(cl)));
  }
}

interface ConnectionBudget {
  readonly max: number;
  readonly reserved: number;
  readonly used: number;
  readonly free: number;
}

/**
 * Créneaux de connexion réellement libres, mesurés au démarrage de la course (ADR-056, « Budget
 * de connexions du banc ») : `max_connections`, moins les créneaux réservés
 * (`superuser_reserved_connections`, `reserved_connections`), moins les sessions présentes dans
 * `pg_stat_activity`. Un rôle sans `pg_read_all_stats` voit les lignes des autres sessions sans
 * leur `backend_type` (NULL) : elles sont comptées, ce qui surestime l'occupation (prudent).
 */
async function connectionBudget(client: pg.ClientBase): Promise<ConnectionBudget> {
  const r = await client.query<{ max: number; reserved: number; used: number }>(
    `SELECT current_setting('max_connections')::int AS max,
            current_setting('superuser_reserved_connections')::int
              + coalesce(current_setting('reserved_connections', true), '0')::int AS reserved,
            (SELECT count(*)::int FROM pg_catalog.pg_stat_activity
              WHERE backend_type IS NULL OR backend_type = 'client backend') AS used`,
  );
  const { max, reserved, used } = r.rows[0] as { max: number; reserved: number; used: number };
  return { max, reserved, used, free: max - reserved - used };
}

/**
 * Degré de concurrence : 100, borné par les créneaux libres mesurés (PostgreSQL natif local). En
 * CI, L0-02 tourne seul (vitest.l0.config.ts) sur un banc à 200 connexions : le degré vaut 100.
 */
async function concurrencyDegree(client: pg.ClientBase): Promise<number> {
  const budget = await connectionBudget(client);
  const degree = Math.max(2, Math.min(C1_POSES, budget.free - SPARE_CONNECTIONS));
  log('budget de connexions', { ...budget, degree });
  // En CI, un degré inférieur à 100 échoue avant la course (revue code US-007, 2026-11-03c,
  // constat 4) ; `expectDegree` le vérifie encore après.
  if (isCi() && degree !== C1_POSES) {
    throw new Error(
      `budget de connexions : degré ${degree} au lieu de ${C1_POSES} exigé en CI ` +
        JSON.stringify(budget),
    );
  }
  return degree;
}

/**
 * Ouvre `n` connexions `app_api` en parallèle. Échoue **aussitôt** si une seule est refusée (par
 * exemple `53300`, plus de créneau libre) et ferme alors toutes celles qui ont abouti : un refus
 * ne laisse aucune connexion orpheline qui ferait échouer les cas suivants en cascade.
 */
async function connectMany(n: number): Promise<pg.Client[]> {
  const settled = await Promise.allSettled(Array.from({ length: n }, () => connectAs('app_api')));
  const clients = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const refused = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []));
  if (refused.length === 0) return clients;
  await Promise.all(clients.map((cl) => releaseClient(cl).catch(() => undefined)));
  const first = refused[0];
  const code = sqlState(first);
  const message = first instanceof Error ? first.message : String(first);
  throw new Error(
    `budget de connexions : ${refused.length} connexion(s) sur ${n} refusée(s)` +
      `${code === undefined ? '' : ` (SQLSTATE ${code})`} : ${message}`,
    { cause: first },
  );
}

/**
 * Garde-fous d'une course C1 (ADR-056, « Budget de connexions du banc ») : une pose qui ne rend
 * pas la main est arrêtée par le serveur (`statement_timeout`, `57014`) bien avant le délai du test
 * (`LONG`). Le délai est posé **après** la chauffe (dont `RESET ALL` l'effacerait) et relu sur
 * chaque connexion avant la barrière ; la forme transactionnelle ne fait aucun `RESET`. Le bloc
 * `finally` de `runC1` s'exécute donc toujours et ferme les connexions : un cas
 * bloqué ne laisse aucune connexion orpheline aux cas suivants. Avant cette échéance, l'état des
 * sessions encore actives est consigné (`[L0-02] course bloquée`).
 */
const POSE_STATEMENT_TIMEOUT_MS = 60_000;
const STALL_REPORT_MS = 30_000;

/**
 * Pose `statement_timeout` sur chaque connexion de pose, puis le relit : la course ne part pas si
 * une seule connexion n'a pas le délai attendu.
 */
async function armStatementTimeout(posers: readonly pg.Client[]): Promise<void> {
  const values = await Promise.all(
    posers.map(async (cl) => {
      await cl.query(`SELECT pg_catalog.set_config('statement_timeout', $1, false)`, [
        `${POSE_STATEMENT_TIMEOUT_MS}ms`,
      ]);
      const r = await cl.query<{ value: string; ms: number }>(
        `SELECT pg_catalog.current_setting('statement_timeout') AS value,
                (extract(epoch FROM pg_catalog.current_setting('statement_timeout')::interval)
                  * 1000)::int AS ms`,
      );
      return r.rows[0] as { value: string; ms: number };
    }),
  );
  const wrong = values.filter((v) => v.ms !== POSE_STATEMENT_TIMEOUT_MS);
  if (wrong.length > 0) {
    throw new Error(
      `statement_timeout absent sur ${wrong.length} connexion(s) sur ${posers.length} : ` +
        JSON.stringify(wrong[0]),
    );
  }
  log('garde-fou', { statementTimeout: values[0]?.value, verified: values.length });
}

/**
 * Consigne les sessions des poses encore actives : agrégat par attente, `deadlock_timeout`, puis
 * détail (attente, verrous non accordés, bloqueurs) des 20 premières.
 */
async function reportStall(observer: pg.ClientBase, pids: readonly number[]): Promise<void> {
  const agg = await observer.query<Record<string, unknown>>(
    `SELECT a.state, a.wait_event_type, a.wait_event, count(*)::int AS n
       FROM pg_catalog.pg_stat_activity a
      WHERE a.pid = ANY($1::int[]) AND a.state IS DISTINCT FROM 'idle'
      GROUP BY 1, 2, 3 ORDER BY n DESC`,
    [pids],
  );
  const dt = await observer.query<{ value: string }>(
    `SELECT pg_catalog.current_setting('deadlock_timeout') AS value`,
  );
  log('course bloquée', { deadlockTimeout: dt.rows[0]?.value, byWait: agg.rows });
  const r = await observer.query<Record<string, unknown>>(
    `SELECT a.pid, a.state, a.wait_event_type, a.wait_event,
            pg_catalog.left(a.query, 60) AS query,
            pg_catalog.pg_blocking_pids(a.pid) AS blockers,
            (SELECT pg_catalog.array_agg(l.locktype || ':' || l.mode)
               FROM pg_catalog.pg_locks l WHERE l.pid = a.pid AND NOT l.granted) AS waiting
       FROM pg_catalog.pg_stat_activity a
      WHERE a.pid = ANY($1::int[]) AND a.state IS DISTINCT FROM 'idle'
      ORDER BY a.pid`,
    [pids],
  );
  log('course bloquée', { active: r.rows.length, of: pids.length, sessions: r.rows.slice(0, 20) });
}

/** Créneau sur l'horloge réelle : dans 7 jours, 2 jours, tampon 2 h. */
function realSlot(): Slot {
  const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 7 * 86_400_000);
  const end = new Date(start.getTime() + 2 * 86_400_000);
  return newSlot(start.toISOString(), end.toISOString());
}

interface C1Report {
  readonly degree: number;
  readonly ok: number;
  readonly outcomes: Record<string, number>;
  readonly deadlocks: number;
  readonly serializationFailures: number;
  readonly replays: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly holds: { status: string }[];
  readonly active: number;
  /** Série transactionnelle : détention du verrou du véhicule, côté serveur (ms). */
  readonly lockHold?: Record<string, number>;
}

/**
 * Forme d'appel de la pose :
 * - `autocommit` : un appel = une instruction ; l'erreur `23P01` termine la transaction sur le
 *   serveur, qui rend aussitôt le verrou (condition de validité du seuil de 300 ms, ADR-056) ;
 * - `transactional` : forme de 17 §2.3 (`BEGIN`, contexte `SET LOCAL`, appel, `COMMIT` /
 *   `ROLLBACK`) ; la pose perdante garde le verrou jusqu'au `ROLLBACK` du client. Consignée,
 *   sans seuil bloquant (revue sécurité US-007, constat 1).
 */
type CallForm = 'autocommit' | 'transactional';

const round1 = (x: number): number => Math.round(x * 10) / 10;
function stats(values: readonly number[]): Record<string, number> {
  return {
    n: values.length,
    p50: round1(percentile(values, 0.5)),
    p95: round1(percentile(values, 0.95)),
    max: round1(Math.max(...values)),
  };
}

/** Détention du verrou du véhicule (serveur) : poses perdantes, part de la commande, du client. */
function lockHoldReport(timings: readonly PoseTiming[]): Record<string, number> {
  const holds = lockHolds(timings);
  const losers = holds.filter((h) => !h.ok);
  const l = stats(losers.map((h) => h.holdMs));
  const w = stats(holds.map((h) => h.workMs));
  const k = stats(losers.map((h) => h.clientMs));
  return {
    measured: holds.length,
    loserHoldP50: l['p50'] as number,
    loserHoldP95: l['p95'] as number,
    loserHoldMax: l['max'] as number,
    workP95: w['p95'] as number,
    loserClientP95: k['p95'] as number,
    loserHoldSum: round1(losers.reduce((acc, h) => acc + h.holdMs, 0)),
  };
}

/**
 * C1 : `degree` poses du même créneau par autant de connexions `app_api`, départ commun. Le temps
 * d'une pose va du départ commun à la réponse de la commande, rejeux compris.
 */
async function runC1(
  c: CountryCase,
  vehicleLock: boolean,
  form: CallForm = 'autocommit',
): Promise<C1Report> {
  const observer = await connectAs('app_api');
  try {
    const degree = await concurrencyDegree(observer);
    const slot = realSlot();
    const period = slotPeriod(slot);
    const guests = Array.from({ length: degree }, () => uuid());
    await inTx(observer, { commit: true }, (tx) => ensureParties(tx, guests, slot.orgId, c));

    const posers: pg.Client[] = [];
    const timings: PoseTiming[] = [];
    let results: Replayed<unknown>[];
    try {
      posers.push(...(await connectMany(degree)));
      const pids = await Promise.all(posers.map((cl) => backendPid(cl)));
      // Connexions chaudes, comme celles d'un pool de l'API : une pose annulée sur un autre
      // véhicule charge le cache des relations et les plans de la commande. Sans cela, chaque
      // pose de la course planifie 2a sous le verrou du véhicule (premier passage CI : p95 de
      // 489 à 553 ms avec verrou, contre 177 ms sans verrou).
      await Promise.all(
        posers.map((client, i) =>
          inTx(client, {}, async (tx) => {
            const warm = {
              slot: { ...slot, vehicleId: uuid() },
              c,
              guestId: guests[i] as string,
              period,
              vehicleLock,
            };
            if (form === 'autocommit') await placeHoldLocked(tx, warm);
            else await placeHoldTimedInTx(tx, warm);
          }),
        ),
      );
      // Après la chauffe : `inTx` (withTestTransaction) se termine par `RESET ALL`, qui
      // effacerait un délai posé plus tôt (revues code et qa US-007, 2026-11-03c, constat 1).
      await armStatementTimeout(posers);
      const barrier = await Barrier.open(observer);
      const runs = posers.map(async (client, i) => {
        await barrier.wait(client);
        const args = { slot, c, guestId: guests[i] as string, period, vehicleLock };
        return withReplay<unknown>(() =>
          form === 'autocommit'
            ? // un appel de commande = une instruction en autocommit : la transaction (et ses
              // verrous) se termine sur le serveur
              placeHoldLocked(client, args)
            : placeHoldTransactional(client, args, timings),
        );
      });
      try {
        await barrier.waitForWaiters(degree);
      } finally {
        await barrier.release();
      }
      const stall = setTimeout(() => {
        reportStall(observer, pids).catch((error: unknown) => {
          log('course bloquée', { diagnostic: String(error) });
        });
      }, STALL_REPORT_MS);
      try {
        results = await Promise.all(runs);
      } finally {
        clearTimeout(stall);
      }
    } finally {
      await Promise.all(posers.map((cl) => releaseClient(cl)));
    }

    const state = await withClients(['app_worker'], ([worker]) =>
      inTx(worker as pg.Client, { worker: 'booking_conversion' }, async (tx) => {
        const holds = await tx.query<{ status: string }>(
          `SELECT status FROM core.booking_checkout_hold WHERE vehicle_id = $1`,
          [slot.vehicleId],
        );
        const active = await activeOccupancies(tx, slot.vehicleId, period);
        return { holds: holds.rows, active: active.length };
      }),
    );
    const outcomes: Record<string, number> = {};
    for (const r of results) {
      const key = r.error ?? 'OK';
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    const ms = results.map((r) => r.ms);
    const sum = (f: (r: Replayed<unknown>) => number): number =>
      results.reduce((acc, r) => acc + f(r), 0);
    return {
      degree,
      ok: outcomes['OK'] ?? 0,
      outcomes,
      deadlocks: sum((r) => r.deadlocks),
      serializationFailures: sum((r) => r.serializationFailures),
      replays: sum((r) => r.replays),
      p50: Math.round(percentile(ms, 0.5)),
      p95: Math.round(percentile(ms, 0.95)),
      max: Math.round(Math.max(...ms)),
      holds: state.holds,
      active: state.active,
      ...(form === 'transactional' ? { lockHold: lockHoldReport(timings) } : {}),
    };
  } finally {
    await releaseClient(observer);
  }
}

describe.each(COUNTRIES)(
  'L0-02 — C1 : poses concurrentes du même créneau ($country, $currency)',
  (c) => {
    it(
      'sans verrou par véhicule (injection) : 40P01 consignés, rejeu correct, exactement 1 hold',
      async () => {
        const r = await runC1(c, false);
        log(`C1 sans verrou ${c.country}`, r);
        expectDegree(r.degree);
        expect(r.ok).toBe(1);
        expect(r.outcomes).toEqual({ OK: 1, VEHICLE_UNAVAILABLE: r.degree - 1 });
        expect(r.holds).toEqual([{ status: 'ACTIVE' }]);
        expect(r.active).toBe(1);
      },
      LONG,
    );

    it(
      'avec verrou par véhicule : exactement 1 hold, 0 40P01, p95 de pose < 300 ms',
      async () => {
        const r = await runC1(c, true);
        log(`C1 avec verrou ${c.country}`, r);
        expectDegree(r.degree);
        expect(r.outcomes).toEqual({ OK: 1, VEHICLE_UNAVAILABLE: r.degree - 1 });
        expect(r.deadlocks).toBe(0);
        expect(r.serializationFailures).toBe(0);
        expect(r.replays).toBe(0);
        expect(r.holds).toEqual([{ status: 'ACTIVE' }]);
        expect(r.active).toBe(1);
        expect(r.p95).toBeLessThan(POSE_P95_MS);
      },
      LONG,
    );

    it(
      'avec verrou, forme transactionnelle (17 §2.3) : exactitude exigée, temps et détention du verrou consignés',
      async () => {
        const r = await runC1(c, true, 'transactional');
        log(`C1 transactionnel avec verrou ${c.country}`, r);
        expectDegree(r.degree);
        expect(r.outcomes).toEqual({ OK: 1, VEHICLE_UNAVAILABLE: r.degree - 1 });
        expect(r.deadlocks).toBe(0);
        expect(r.holds).toEqual([{ status: 'ACTIVE' }]);
        expect(r.active).toBe(1);
        // toutes les poses sont mesurées côté serveur ; aucun seuil de temps bloquant (ADR-056)
        expect(r.lockHold?.['measured']).toBe(r.degree - 1);
      },
      LONG,
    );
  },
);

// ---------------------------------------------------------------------------------------------
// C16 : ré-acquisition + pose concurrentes
// ---------------------------------------------------------------------------------------------

const T0 = '2031-06-02T10:00:00.000Z'; // pose du hold A ; expires_at = T0 + 10 min
const TRIP_START = '2031-06-09T10:00:00.000Z';
const TRIP_END = '2031-06-11T10:00:00.000Z';
const RACE_AT = at(T0, 13);

interface C16Setup {
  readonly a: Hold;
  readonly opA: string;
  readonly guestB: string;
}

/** Hold A posé à T0, expiré à T0 + 11 min, preuve de paiement reçue à T0 + 12 min. */
async function c16Setup(api: pg.Client, worker: pg.Client, c: CountryCase): Promise<C16Setup> {
  const slot = newSlot(TRIP_START, TRIP_END);
  const { a, opA } = await inTx(api, { virtualNow: T0, commit: true }, async (tx) => {
    const hold = await placeHold(tx, slot, c);
    return { a: hold, opA: await insertRentOperation(tx, hold, 'PENDING') };
  });
  const expired = await inTx(
    worker,
    { worker: 'hold_expiry', virtualNow: at(T0, 11), commit: true },
    (tx) => expireDueHolds(tx, slot.vehicleId, a.guestId),
  );
  expect(expired).toBe(1);
  await inTx(worker, { worker: 'webhook_ingest', virtualNow: at(T0, 12), commit: true }, (tx) =>
    receiveProof(tx, opA),
  );
  const guestB = uuid();
  await inTx(api, { commit: true }, (tx) => ensureParties(tx, [guestB], slot.orgId, c));
  return { a, opA, guestB };
}

interface C16State {
  readonly holdA: string;
  readonly compensation: string | null;
  readonly holdsB: number;
  readonly active: { kind: string; ref_id: string | null }[];
  readonly trips: number;
}

async function c16State(worker: pg.Client, s: C16Setup): Promise<C16State> {
  return inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
    const a = await tx.query<{ status: string }>(
      `SELECT status FROM core.booking_checkout_hold WHERE id = $1`,
      [s.a.holdId],
    );
    const comp = await tx.query<{ reason: string }>(
      `SELECT reason FROM core.booking_hold_compensation WHERE hold_id = $1`,
      [s.a.holdId],
    );
    const b = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM core.booking_checkout_hold
        WHERE guest_user_id = $1 AND vehicle_id = $2 AND status = 'ACTIVE'`,
      [s.guestB, s.a.slot.vehicleId],
    );
    const trips = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM core.booking_trip WHERE source_hold_id = $1`,
      [s.a.holdId],
    );
    return {
      holdA: a.rows[0]?.status ?? '?',
      compensation: comp.rows[0]?.reason ?? null,
      holdsB: b.rows[0]?.n ?? 0,
      active: await activeOccupancies(tx, s.a.slot.vehicleId, slotPeriod(s.a.slot)),
      trips: trips.rows[0]?.n ?? 0,
    };
  });
}

/** Une seule issue cohérente : trip de A XOR hold de B, une seule occupation active. */
function expectC16Consistent(
  st: C16State,
  conv: Replayed<{ kind: string }>,
  pose: Replayed<unknown>,
): void {
  expect(st.active).toHaveLength(1);
  if (st.holdA === 'CONVERTED') {
    expect(conv.value?.kind).toBe('TRIP');
    expect(st.trips).toBe(1);
    expect(st.active[0]?.kind).toBe('TRIP');
    expect(pose.error).toBe('VEHICLE_UNAVAILABLE');
    expect(pose.raw?.code).toBe('23P01');
    expect(st.holdsB).toBe(0);
  } else {
    expect(st.holdA).toBe('COMPENSATED');
    expect(conv.value?.kind).toBe('COMPENSATED');
    expect(st.compensation).toBe('SLOT_LOST_AFTER_EXPIRY');
    expect(st.trips).toBe(0);
    expect(pose.error).toBeUndefined();
    expect(st.holdsB).toBe(1);
    expect(st.active[0]?.kind).toBe('HOLD');
  }
}

/** Une course C16 : conversion de A et pose de B partent ensemble (barrière). */
async function c16Race(
  clients: pg.Client[],
  c: CountryCase,
  vehicleLock: boolean,
): Promise<{ conv: Replayed<{ kind: string }>; pose: Replayed<unknown>; st: C16State }> {
  const [api, worker, observer] = clients as [pg.Client, pg.Client, pg.Client];
  const s = await c16Setup(api, worker, c);
  const barrier = await Barrier.open(observer);
  const convRun = (async () => {
    await barrier.wait(worker);
    return withReplay(() =>
      inTx(worker, { worker: 'booking_conversion', virtualNow: RACE_AT, commit: true }, (tx) =>
        convert(tx, s.a, s.opA, { vehicleLock }),
      ),
    );
  })();
  const poseRun = (async () => {
    await barrier.wait(api);
    return withReplay(() =>
      inTx(api, { virtualNow: RACE_AT, commit: true }, (tx) =>
        placeHoldLocked(tx, {
          slot: s.a.slot,
          c,
          guestId: s.guestB,
          period: slotPeriod(s.a.slot),
          vehicleLock,
        }),
      ),
    );
  })();
  try {
    await barrier.waitForWaiters(2);
  } finally {
    await barrier.release();
  }
  const [conv, pose] = await Promise.all([convRun, poseRun]);
  return { conv, pose, st: await c16State(worker, s) };
}

describe.each(COUNTRIES)(
  'L0-02 — C16 : ré-acquisition et pose concurrentes ($country, $currency)',
  (c) => {
    for (const vehicleLock of [false, true]) {
      it(
        `${ROUNDS} courses ${vehicleLock ? 'avec' : 'sans (injection)'} verrou par véhicule : une seule issue, rejeu correct`,
        async () => {
          await withClients(['app_api', 'app_worker', 'app_api'], async (clients) => {
            let deadlocks = 0;
            let replays = 0;
            const issues: Record<string, number> = {};
            for (let round = 0; round < ROUNDS; round++) {
              const { conv, pose, st } = await c16Race(clients, c, vehicleLock);
              expect(conv.error).toBeUndefined();
              expectC16Consistent(st, conv, pose);
              deadlocks += conv.deadlocks + pose.deadlocks;
              replays += conv.replays + pose.replays;
              issues[st.holdA] = (issues[st.holdA] ?? 0) + 1;
            }
            log(`C16 ${vehicleLock ? 'avec' : 'sans'} verrou ${c.country}`, {
              rounds: ROUNDS,
              deadlocks,
              replays,
              issues,
            });
            if (vehicleLock) {
              expect(deadlocks).toBe(0);
              expect(replays).toBe(0);
            }
          });
        },
        LONG,
      );
    }

    it('entrelacement forcé, conversion d’abord : la pose attend le verrou du véhicule puis reçoit 23P01', async () => {
      await withClients(['app_api', 'app_worker', 'app_api'], async ([api, worker, observer]) => {
        const s = await c16Setup(api as pg.Client, worker as pg.Client, c);
        const apiPid = await backendPid(api as pg.Client);
        let poseRun: Promise<Replayed<unknown>> | undefined;
        const conv = await inTx(
          worker as pg.Client,
          { worker: 'booking_conversion', virtualNow: RACE_AT, commit: true },
          async (tx) => {
            await lockGuestThenVehicle(tx, s.a.guestId, s.a.slot.vehicleId);
            poseRun = withReplay(() =>
              inTx(api as pg.Client, { virtualNow: RACE_AT, commit: true }, (tx2) =>
                placeHoldLocked(tx2, {
                  slot: s.a.slot,
                  c,
                  guestId: s.guestB,
                  period: slotPeriod(s.a.slot),
                  vehicleLock: true,
                }),
              ),
            );
            await waitUntilBlocked(observer as pg.Client, apiPid);
            return convert(tx, s.a, s.opA); // verrous ré-entrants
          },
        );
        const pose = await (poseRun as Promise<Replayed<unknown>>);
        expect(conv.kind).toBe('TRIP');
        expect(pose.deadlocks).toBe(0);
        expect(pose.error).toBe('VEHICLE_UNAVAILABLE');
        expect(pose.raw).toEqual({ code: '23P01', constraint: 'vehicle_occupancy_no_overlap' });
        const st = await c16State(worker as pg.Client, s);
        expect(st.holdA).toBe('CONVERTED');
        expect(st.active).toHaveLength(1);
        expect(st.holdsB).toBe(0);
      });
    });

    it('entrelacement forcé, pose d’abord : la conversion attend puis compense SLOT_LOST_AFTER_EXPIRY', async () => {
      await withClients(['app_api', 'app_worker', 'app_api'], async ([api, worker, observer]) => {
        const s = await c16Setup(api as pg.Client, worker as pg.Client, c);
        const workerPid = await backendPid(worker as pg.Client);
        let convRun: Promise<Replayed<{ kind: string; reason?: string }>> | undefined;
        await inTx(api as pg.Client, { virtualNow: RACE_AT, commit: true }, async (tx) => {
          await lockGuestThenVehicle(tx, s.guestB, s.a.slot.vehicleId);
          convRun = withReplay(() =>
            inTx(
              worker as pg.Client,
              { worker: 'booking_conversion', virtualNow: RACE_AT, commit: true },
              (tx2) => convert(tx2, s.a, s.opA),
            ),
          );
          await waitUntilBlocked(observer as pg.Client, workerPid);
          return placeHoldLocked(tx, {
            slot: s.a.slot,
            c,
            guestId: s.guestB,
            period: slotPeriod(s.a.slot),
            vehicleLock: true,
          });
        });
        const conv = await (convRun as Promise<Replayed<{ kind: string; reason?: string }>>);
        expect(conv.deadlocks).toBe(0);
        expect(conv.error).toBeUndefined();
        expect(conv.value?.kind).toBe('COMPENSATED');
        expect(conv.value?.reason).toBe('SLOT_LOST_AFTER_EXPIRY');
        const st = await c16State(worker as pg.Client, s);
        expect(st.holdA).toBe('COMPENSATED');
        expect(st.holdsB).toBe(1);
        expect(st.active).toHaveLength(1);
        expect(st.active[0]?.kind).toBe('HOLD');
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Annulation de trip (B4) concurrente d'une pose sur le créneau libéré
// ---------------------------------------------------------------------------------------------

const CANCEL_AT = at(T0, 30);

interface Booked {
  readonly tripId: string;
  readonly guestId: string;
  readonly slot: Slot;
  readonly guestB: string;
}

async function booked(api: pg.Client, worker: pg.Client, c: CountryCase): Promise<Booked> {
  const slot = newSlot(TRIP_START, TRIP_END);
  const { hold, tripId } = await bookTrip(api, worker, slot, c, T0);
  const guestB = uuid();
  await inTx(api, { commit: true }, (tx) => ensureParties(tx, [guestB], slot.orgId, c));
  return { tripId, guestId: hold.guestId, slot, guestB };
}

async function cancelState(worker: pg.Client, b: Booked) {
  return inTx(worker, { worker: 'trip_lifecycle' }, async (tx) => {
    const t = await tx.query<{ status: string }>(
      `SELECT status FROM core.booking_trip WHERE id = $1`,
      [b.tripId],
    );
    const g = await tx.query<{ active: boolean }>(
      `SELECT active FROM core.booking_guest_occupancy WHERE trip_id = $1`,
      [b.tripId],
    );
    return {
      trip: t.rows[0]?.status,
      guestOccupancyActive: g.rows[0]?.active,
      active: await activeOccupancies(tx, b.slot.vehicleId, slotPeriod(b.slot)),
    };
  });
}

const cancelArgs = (b: Booked) => ({
  tripId: b.tripId,
  guestId: b.guestId,
  vehicleId: b.slot.vehicleId,
});

describe.each(COUNTRIES)(
  'L0-02 — annulation de trip et pose concurrentes ($country, $currency)',
  (c) => {
    it('l’annulation tient guest → véhicule → trip ; la pose attend, puis obtient le créneau libéré', async () => {
      await withClients(['app_api', 'app_worker', 'app_api'], async ([api, worker, observer]) => {
        const b = await booked(api as pg.Client, worker as pg.Client, c);
        const apiPid = await backendPid(api as pg.Client);
        let poseRun: Promise<Replayed<unknown>> | undefined;
        const cancelled = await inTx(
          worker as pg.Client,
          { worker: 'trip_lifecycle', virtualNow: CANCEL_AT, commit: true },
          async (tx) => {
            await lockGuestThenVehicle(tx, b.guestId, b.slot.vehicleId);
            poseRun = withReplay(() =>
              inTx(api as pg.Client, { virtualNow: CANCEL_AT, commit: true }, (tx2) =>
                placeHoldLocked(tx2, {
                  slot: b.slot,
                  c,
                  guestId: b.guestB,
                  period: slotPeriod(b.slot),
                  vehicleLock: true,
                }),
              ),
            );
            await waitUntilBlocked(observer as pg.Client, apiPid);
            return cancelTripByGuest(tx, cancelArgs(b));
          },
        );
        const pose = await (poseRun as Promise<Replayed<unknown>>);
        expect(cancelled).toBe('CANCELLED');
        expect(pose.deadlocks).toBe(0);
        expect(pose.error).toBeUndefined();
        const st = await cancelState(worker as pg.Client, b);
        expect(st.trip).toBe('CANCELLED_BY_GUEST');
        expect(st.guestOccupancyActive).toBe(false);
        expect(st.active).toHaveLength(1);
        expect(st.active[0]?.kind).toBe('HOLD');
      });
    });

    it('la pose tient le verrou du véhicule : 23P01 sur le trip encore actif, puis l’annulation passe', async () => {
      await withClients(['app_api', 'app_worker', 'app_api'], async ([api, worker, observer]) => {
        const b = await booked(api as pg.Client, worker as pg.Client, c);
        const workerPid = await backendPid(worker as pg.Client);
        let cancelRun: Promise<Replayed<'CANCELLED' | 'NOOP'>> | undefined;
        let poseError: unknown;
        try {
          await inTx(api as pg.Client, { virtualNow: CANCEL_AT, commit: true }, async (tx) => {
            await lockGuestThenVehicle(tx, b.guestB, b.slot.vehicleId);
            cancelRun = withReplay(() =>
              inTx(
                worker as pg.Client,
                { worker: 'trip_lifecycle', virtualNow: CANCEL_AT, commit: true },
                (tx2) => cancelTripByGuest(tx2, cancelArgs(b)),
              ),
            );
            await waitUntilBlocked(observer as pg.Client, workerPid);
            return placeHoldLocked(tx, {
              slot: b.slot,
              c,
              guestId: b.guestB,
              period: slotPeriod(b.slot),
              vehicleLock: true,
            });
          });
        } catch (error) {
          poseError = error;
        }
        expect(sqlState(poseError)).toBe('23P01');
        const cancel = await (cancelRun as Promise<Replayed<'CANCELLED' | 'NOOP'>>);
        expect(cancel.deadlocks).toBe(0);
        expect(cancel.value).toBe('CANCELLED');
        const st = await cancelState(worker as pg.Client, b);
        expect(st.trip).toBe('CANCELLED_BY_GUEST');
        expect(st.active).toHaveLength(0);
      });
    });

    it(
      `${ROUNDS} courses annulation / pose avec verrou : 0 40P01, une seule occupation active au plus`,
      async () => {
        await withClients(['app_api', 'app_worker', 'app_api'], async ([api, worker, observer]) => {
          let deadlocks = 0;
          const issues: Record<string, number> = {};
          for (let round = 0; round < ROUNDS; round++) {
            const b = await booked(api as pg.Client, worker as pg.Client, c);
            const barrier = await Barrier.open(observer as pg.Client);
            const cancelRun = (async () => {
              await barrier.wait(worker as pg.Client);
              return withReplay(() =>
                inTx(
                  worker as pg.Client,
                  { worker: 'trip_lifecycle', virtualNow: CANCEL_AT, commit: true },
                  (tx) => cancelTripByGuest(tx, cancelArgs(b)),
                ),
              );
            })();
            const poseRun = (async () => {
              await barrier.wait(api as pg.Client);
              return withReplay(() =>
                inTx(api as pg.Client, { virtualNow: CANCEL_AT, commit: true }, (tx) =>
                  placeHoldLocked(tx, {
                    slot: b.slot,
                    c,
                    guestId: b.guestB,
                    period: slotPeriod(b.slot),
                    vehicleLock: true,
                  }),
                ),
              );
            })();
            try {
              await barrier.waitForWaiters(2);
            } finally {
              await barrier.release();
            }
            const [cancel, pose] = await Promise.all([cancelRun, poseRun]);
            deadlocks += cancel.deadlocks + pose.deadlocks;
            expect(cancel.value).toBe('CANCELLED');
            const st = await cancelState(worker as pg.Client, b);
            expect(st.trip).toBe('CANCELLED_BY_GUEST');
            if (pose.error === undefined) {
              expect(st.active).toHaveLength(1);
              expect(st.active[0]?.kind).toBe('HOLD');
            } else {
              expect(pose.error).toBe('VEHICLE_UNAVAILABLE');
              expect(st.active).toHaveLength(0);
            }
            const key = pose.error ?? 'HOLD';
            issues[key] = (issues[key] ?? 0) + 1;
          }
          log(`annulation / pose ${c.country}`, { rounds: ROUNDS, deadlocks, issues });
          expect(deadlocks).toBe(0);
        });
      },
      LONG,
    );
  },
);

// ---------------------------------------------------------------------------------------------
// Interblocage déterministe : l'ordre inversé de 17 §2.5 interbloque, le rejeu le résout
// (revue sécurité US-007, constat 4)
// ---------------------------------------------------------------------------------------------

const LOCK_GUEST = `SELECT pg_advisory_xact_lock(hashtextextended('guest:' || $1::text, 0))`;
const LOCK_VEHICLE = `SELECT pg_advisory_xact_lock(hashtextextended('veh:' || $1::text, 0))`;

describe.each(COUNTRIES)(
  'L0-02 — interblocage déterministe, ordre inversé ($country, $currency)',
  () => {
    it('guest → véhicule contre véhicule → guest : un 40P01 réel, rejoué par withReplay, les deux transactions aboutissent', async () => {
      await withClients(['app_api', 'app_api', 'app_api'], async ([a, b, observer]) => {
        const guest = uuid();
        const vehicle = uuid();
        const pidA = await backendPid(a as pg.Client);
        let attemptsA = 0;
        let attemptsB = 0;
        let bHasVehicle: () => void = () => undefined;
        const vehicleTaken = new Promise<void>((resolve) => {
          bHasVehicle = resolve;
        });
        const started = performance.now();
        // A : ordre de 17 §2.5 (guest, puis véhicule)
        const runA = withReplay(() =>
          inTx(a as pg.Client, { commit: true }, async (tx) => {
            attemptsA++;
            await tx.query(LOCK_GUEST, [guest]);
            if (attemptsA === 1) await vehicleTaken;
            await tx.query(LOCK_VEHICLE, [vehicle]);
            return 'A';
          }),
        );
        // B : ordre INVERSÉ (véhicule, puis guest) ; à la première tentative, attend que A soit
        // bloqué sur le verrou du véhicule avant de demander celui du guest : cycle certain
        const runB = withReplay(() =>
          inTx(b as pg.Client, { commit: true }, async (tx) => {
            attemptsB++;
            await tx.query(LOCK_VEHICLE, [vehicle]);
            if (attemptsB === 1) {
              bHasVehicle();
              await waitUntilBlocked(observer as pg.Client, pidA);
            }
            await tx.query(LOCK_GUEST, [guest]);
            return 'B';
          }),
        );
        const [ra, rb] = await Promise.all([runA, runB]);
        log('interblocage déterministe', {
          deadlocks: ra.deadlocks + rb.deadlocks,
          victim: ra.deadlocks > 0 ? 'A' : 'B',
          ms: Math.round(performance.now() - started),
        });
        expect(ra.value).toBe('A');
        expect(rb.value).toBe('B');
        expect(ra.deadlocks + rb.deadlocks).toBe(1);
        expect(ra.replays + rb.replays).toBe(1);
        expect(ra.error ?? rb.error).toBeUndefined();
      });
    });
  },
);
