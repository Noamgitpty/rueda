/**
 * US-025 — fuzz d'entrelacements C11 (L0-09) et oracle de production C12 (19 US-025 ; 17 §2.5
 * plan de test C11 et C12, §11 L0-09 ; migration 0042 ; ADR-068).
 *
 * Monde : 2 pays (PA en USD, PY en PYG) × 2 hôtes × 3 véhicules × 4 voyageurs par pays. Chaque
 * exécution vit dans sa propre période d'horloge virtuelle (2061 et après, une semaine par
 * exécution) : les créneaux ne chevauchent jamais ceux d'une autre exécution, qui est donc
 * indépendante des précédentes et rejouable seule.
 *
 * Acteurs, sous les rôles de PRODUCTION seulement (assertion L0-05 par connectAs à chaque test) :
 *   - app_api : commandes du voyageur (pose, T1 / T2, libération), forme d'appel d'ADR-056
 *     (« un appel = une instruction », contexte app.* et horloge virtuelle dans la même instruction) ;
 *   - app_worker : booking_conversion, webhook_ingest, payment_command, payment_intent_sweeper,
 *     disposition_sweeper, hold_expiry (expiration et temps 2), trip_lifecycle (annulation),
 *     booking_oracle (invariants et oracle C12, lecture seule).
 * FAKE hostile (17 §11 point 5, A7), tiré au hasard : délai après succès (T2 perdue), webhook en
 * double, perdu, hors d'ordre, tardif (après l'expiration), lecture du balayage sans réponse,
 * second débit sur un même hold (clé ignorée, lien payé deux fois), « déjà payé » à cancelOrder,
 * travailleur de conversion perdu (réparé par disposition_sweeper).
 *
 * Courses : une étape sur trois environ lance 2 ou 3 actions EN MÊME TEMPS sur des connexions
 * distinctes ; leur ordre d'achèvement est consigné. Un échec donne `RUEDA_C11_REPLAY=<graine>:<ordre>`,
 * qui rejoue l'exécution seule, courses en série dans l'ordre observé (test/support/c11.ts).
 *
 * Invariants (i) à (ix) de C11 (17 §2.5), attendus de 17 et jamais du code testé : (vii) et (viii)
 * après chaque étape, tous à la fin de chaque exécution, après quiescence. Oracle C12 à zéro sur
 * TOUTE la base du fuzz (copie dédiée de la base principale, ADR-068) toutes les 100 exécutions et
 * à la fin.
 *
 * Base : `fuzz` (bench.ts) ; fichier du groupe isolé (vitest.l0.config.ts), après les autres.
 * Durée : mode court par défaut (1 000 exécutions, CI) ; mode long explicite (`RUEDA_C11_RUNS=nightly`,
 * 10 000, tâche de nuit). Graine consignée (`[C11] graine`).
 */
import { appendFileSync } from 'node:fs';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_SETTINGS,
  SET_SESSION_CONTEXT_SQL,
  sessionSettings,
  translateDbError,
} from '../../src/index.ts';
import type { SessionContext } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot, Worker } from '../support/avl.ts';
import { formatReplay, c11Config, Rng, runSeed } from '../support/c11.ts';
import type { RaceOrders } from '../support/c11.ts';
import { cancelTripByGuest, ensureParties, registerVehicles } from '../support/concurrency.ts';
import { legsJson } from '../support/pay.ts';

const CFG = c11Config(process.env);
const DB = { database: 'fuzz' } as const;

// --- Paramètres de 17 §7.2 (graine US-013) et bornes de 17 §2.5 --------------------------------------
/** C11 (iii) et (viii), C12 : disposition au plus 20 min après la réussite connue. */
const DISPOSITION_BOUND_MIN = 20;
/** Durée d'un ordre du FAKE (T2) : 5 min. */
const ORDER_TTL_MIN = 5;
/** ORDER_TTL_SECONDS du moyen CARD du FAKE en PA (validé) ; inconnu en PY (borne de 20 min). */
const PA_ORDER_TTL_S = 300;

// --- Montants : capture des vecteurs TJ01 (USD) et TJ08a (PYG), 08 E7 ---------------------------
const vectors = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(vectors, 'TJ01'), legVector(vectors, 'TJ08a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase): ReturnType<typeof legVector> => {
  const v = CAPTURE[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);
  return v;
};

// --- Horloge virtuelle -------------------------------------------------------------------------
const ERA_BASE = Date.parse('2061-01-04T10:00:00.000Z');
const ERA_SPACING_MS = 7 * 86_400_000;
const BLOCKING_FROM = '2060-01-01T00:00:00.000Z';
const iso = (ms: number): string => new Date(ms).toISOString();
const MIN = 60_000;

/** Étapes aléatoires par exécution (hors quiescence). */
const STEPS = 18;
/** Connexions parallèles (une paire app_api / app_worker par voie). */
const LANES = 3;

// --- Appel en une instruction (ADR-056 point 4) : contexte app.*, horloge virtuelle, appel --------
const CTX_PARAMS = SESSION_SETTINGS.length * 2;
/** Référence à la CTE de contexte, pour qu'une fonction ne soit évaluée qu'après elle. */
const AFTER_CTX = '0 * pg_catalog.length(ctx.t)';

function oneStatement(
  ctx: SessionContext,
  now: string,
  expr: string,
  args: readonly unknown[],
): { text: string; values: unknown[] } {
  const settings = sessionSettings(ctx);
  const values = [...SESSION_SETTINGS.flatMap((n) => [n, settings[n]]), now, ...args];
  const body = expr.replace(/\$a([0-9]+)/g, (_m, i: string) => `$${CTX_PARAMS + 1 + Number(i)}`);
  return {
    text:
      `WITH ctx AS MATERIALIZED (${SET_SESSION_CONTEXT_SQL}, ` +
      `pg_catalog.set_config('app.virtual_now', $${CTX_PARAMS + 1}, true) AS t) ` +
      `SELECT ${body} AS result FROM ctx`,
    values,
  };
}

async function call<T>(
  client: pg.Client,
  ctx: SessionContext,
  now: string,
  expr: string,
  args: readonly unknown[] = [],
): Promise<T> {
  const { text, values } = oneStatement(ctx, now, expr, args);
  const r = await client.query<{ result: T }>(text, values);
  return r.rows[0]?.result as T;
}

const W = (workerName: Worker | 'booking_oracle'): SessionContext => ({
  kind: 'WORKER',
  workerName,
});
const G = (actorId: string): SessionContext => ({ kind: 'GUEST', actorId });

// --- Erreurs : métier (attendues), rejouables (40P01 / 40001), internes (échec) -------------------
class C11Failure extends Error {
  override readonly name = 'C11Failure';
}

interface Stats {
  outcomes: Map<string, number>;
  races: number;
  actions: number;
  deadlocks: number;
  serializationFailures: number;
  replays: number;
}

const bump = (m: Map<string, number>, k: string, n = 1): void => {
  m.set(k, (m.get(k) ?? 0) + n);
};

async function guarded<T>(stats: Stats, label: string, fn: () => Promise<T>): Promise<T | string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const e = error as { code?: string; constraint?: string; message?: string };
      const t = translateDbError(error);
      if (t.retryable && attempt < 3) {
        if (e.code === '40P01') stats.deadlocks++;
        else stats.serializationFailures++;
        stats.replays++;
        continue;
      }
      if (t.code === 'INTERNAL_ERROR' || t.retryable) {
        throw new C11Failure(
          `${label} : erreur interne ${String(e.code)} ${String(e.constraint)} ${String(e.message)}`,
        );
      }
      return `!${t.code}`;
    }
  }
}

// --- Modèle (côté test) --------------------------------------------------------------------------
type Truth = 'SUCCEEDED' | 'FAILED' | 'NEVER';
type WebhookMode = 'NORMAL' | 'DUPLICATE' | 'LOST' | 'OUT_OF_ORDER' | 'LATE';

interface FakePlan {
  readonly truth: Truth;
  readonly settleAfterMs: number;
  readonly webhook: WebhookMode;
  readonly lateMs: number;
  readonly pollUnknown: boolean;
  readonly convertLost: boolean;
  readonly convertDelayMs: number;
}

interface OpM {
  readonly id: string;
  readonly holdId: string;
  readonly plan: FakePlan;
  readonly settleAt: number;
  orderExpiresAt: number | null;
  cancelled: boolean;
}

interface HoldM {
  readonly id: string;
  readonly c: CountryCase;
  readonly guest: string;
  readonly vehicle: string;
  readonly ops: string[];
  extra: number;
}

type Ev =
  | {
      readonly k: 'WEBHOOK';
      readonly at: number;
      readonly seq: number;
      readonly op: string;
      readonly status: 'SUCCEEDED' | 'FAILED';
      readonly dup: boolean;
      readonly ooo: boolean;
    }
  | {
      readonly k: 'CONVERT';
      readonly at: number;
      readonly seq: number;
      readonly op: string;
      readonly status: 'SUCCEEDED' | 'FAILED';
    };

/** Événement à planifier (son numéro d'ordre est attribué à l'application). */
type NewEv = { [K in Ev['k']]: Omit<Extract<Ev, { k: K }>, 'seq'> }[Ev['k']];

type Action =
  | { readonly k: 'POSE'; readonly c: CountryCase; readonly guest: string; readonly slot: Slot }
  | {
      readonly k: 'PAY';
      readonly hold: HoldM;
      readonly plan: FakePlan;
      readonly skipT2: boolean;
      readonly doubleClick: boolean;
    }
  | { readonly k: 'RELEASE'; readonly hold: HoldM }
  | { readonly k: 'DOUBLE_DEBIT'; readonly hold: HoldM; readonly lost: boolean }
  | {
      readonly k: 'CANCEL_TRIP';
      readonly trip: { tripId: string; guestId: string; vehicleId: string };
    }
  | { readonly k: 'EVENT'; readonly ev: Ev }
  | { readonly k: 'EXPIRY' }
  | { readonly k: 'RELEASE_CANCELLED' }
  | { readonly k: 'INTENT_SWEEP' }
  | { readonly k: 'DISPOSITION_SWEEP' }
  | { readonly k: 'CANCEL_EXEC' };

type Effect =
  | { readonly k: 'HOLD'; readonly hold: HoldM }
  | { readonly k: 'OP'; readonly op: OpM; readonly extra: boolean }
  | { readonly k: 'ORDER'; readonly op: string; readonly expiresAt: number }
  | { readonly k: 'EVENT'; readonly ev: NewEv }
  | { readonly k: 'CANCELLED'; readonly op: string };

interface Done {
  readonly label: string;
  readonly effects: Effect[];
}

interface Lane {
  api: pg.Client;
  worker: pg.Client;
}

interface CountryWorld {
  readonly c: CountryCase;
  readonly vehicles: string[];
  readonly guests: string[];
  /** Véhicule et voyageurs hors du fuzz : preuves C12 et T1, indépendantes d'un fuzz en échec. */
  readonly spareVehicle: string;
  readonly spareGuests: string[];
  readonly account: string;
}

// --- Un monde par pays (réutilisé : chaque exécution a sa période) --------------------------------
async function buildWorld(api: pg.Client, c: CountryCase): Promise<CountryWorld> {
  const orgs = [uuid(), uuid()];
  const vehicles = [uuid(), uuid(), uuid()];
  const guests = [uuid(), uuid(), uuid(), uuid()];
  const spareVehicle = uuid();
  const spareGuests = [uuid(), uuid()];
  const account = await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, [...guests, ...spareGuests], orgs[0] as string, c);
    await ensureParties(tx, [], orgs[1] as string, c);
    await registerVehicles(tx, vehicles.slice(0, 2), orgs[0] as string, c);
    await registerVehicles(tx, [...vehicles.slice(2), spareVehicle], orgs[1] as string, c);
    // capacités bloquantes validées (17 §2.8), comme US-024 ; ORDER_CANCEL et ORDER_TTL en PA
    const { rows } = await tx.query<{ capability: string; kind: string }>(
      `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
    );
    const q = `SELECT test_fixture.us024_set_capability('FAKE', $1, $2, $3, $4::jsonb, 'VALIDATED_SANDBOX', $5::timestamptz)`;
    for (const r of rows) {
      const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
      await tx.query(q, [c.country, '*', r.capability, JSON.stringify(value), BLOCKING_FROM]);
    }
    if (c.country === 'PA') {
      await tx.query(q, [c.country, '*', 'SUPPORTS_ORDER_CANCEL', 'true', BLOCKING_FROM]);
      await tx.query(q, [
        c.country,
        'CARD',
        'ORDER_TTL_SECONDS',
        String(PA_ORDER_TTL_S),
        BLOCKING_FROM,
      ]);
    }
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    return a.rows[0]?.id as string;
  });
  return { c, vehicles, guests, spareVehicle, spareGuests, account };
}

// --- Une exécution -------------------------------------------------------------------------------
interface RunResult {
  readonly orders: RaceOrders;
  readonly holds: number;
  readonly trips: number;
}

class Run {
  readonly rng: Rng;
  now: number;
  readonly eraStart: number;
  readonly holds: HoldM[] = [];
  readonly ops = new Map<string, OpM>();
  events: Ev[] = [];
  seq = 0;
  readonly orders: Record<number, number[]> = {};
  readonly trace: string[] = [];

  readonly worlds: readonly CountryWorld[];
  readonly lanes: readonly Lane[];
  readonly observer: pg.Client;
  readonly stats: Stats;
  readonly replayOrders: RaceOrders | undefined;

  constructor(
    seed: number,
    index: number,
    worlds: readonly CountryWorld[],
    lanes: readonly Lane[],
    observer: pg.Client,
    stats: Stats,
    replayOrders: RaceOrders | undefined,
  ) {
    this.worlds = worlds;
    this.lanes = lanes;
    this.observer = observer;
    this.stats = stats;
    this.replayOrders = replayOrders;
    this.rng = new Rng(seed);
    this.eraStart = ERA_BASE + index * ERA_SPACING_MS;
    this.now = this.eraStart;
  }

  get guests(): string[] {
    return this.worlds.flatMap((w) => w.guests);
  }
  get vehicles(): string[] {
    return this.worlds.flatMap((w) => w.vehicles);
  }
  worldOf(c: CountryCase): CountryWorld {
    return this.worlds.find((w) => w.c.country === c.country) as CountryWorld;
  }

  // ---- planification (consomme le générateur ; jamais pendant l'exécution) ----
  fakePlan(): FakePlan {
    const r = this.rng;
    const truth = r.weighted<Truth>({ SUCCEEDED: 65, FAILED: 20, NEVER: 15 });
    return {
      truth,
      settleAfterMs: r.between(10, 270) * 1000,
      webhook: r.weighted<WebhookMode>({
        NORMAL: 45,
        DUPLICATE: 15,
        LOST: 15,
        OUT_OF_ORDER: 10,
        LATE: 15,
      }),
      lateMs: r.between(10, 30) * MIN,
      pollUnknown: r.chance(0.3),
      convertLost: r.chance(0.15),
      convertDelayMs: r.between(0, 60) * 1000,
    };
  }

  slotFor(vehicle: string, k: number): Slot {
    const start = this.eraStart + 2 * 86_400_000 + k * 12 * 3_600_000;
    return {
      vehicleId: vehicle,
      orgId: '',
      start: iso(start),
      end: iso(start + 86_400_000),
      bufferHours: 2,
    };
  }

  dueEvents(): Ev[] {
    return this.events.filter((e) => e.at <= this.now).sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  async plan(kinds: Readonly<Record<string, number>>, taken: Set<number>): Promise<Action | null> {
    const r = this.rng;
    const due = this.dueEvents().filter((e) => !taken.has(e.seq));
    const weights: Record<string, number> = { ...kinds };
    if (due.length === 0) weights.EVENT = 0;
    if (this.holds.length === 0) {
      weights.PAY = 0;
      weights.RELEASE = 0;
      weights.DOUBLE_DEBIT = 0;
      weights.CANCEL_TRIP = 0;
    }
    const k = r.weighted(weights);
    switch (k) {
      case 'POSE': {
        const w = r.pick(this.worlds);
        return {
          k: 'POSE',
          c: w.c,
          guest: r.pick(w.guests),
          slot: this.slotFor(r.pick(w.vehicles), r.int(3)),
        };
      }
      case 'PAY':
        return {
          k: 'PAY',
          hold: r.pick(this.holds),
          plan: this.fakePlan(),
          skipT2: r.chance(0.1),
          doubleClick: r.chance(0.15),
        };
      case 'RELEASE':
        return { k: 'RELEASE', hold: r.pick(this.holds) };
      case 'DOUBLE_DEBIT': {
        const paid = this.holds.filter((h) => h.ops.length > 0);
        if (paid.length === 0) return null;
        return { k: 'DOUBLE_DEBIT', hold: r.pick(paid), lost: r.chance(0.15) };
      }
      case 'CANCEL_TRIP': {
        const { rows } = await this.observer.query<{ id: string; guest: string; vehicle: string }>(
          `SELECT t.id, t.guest_user_id AS guest, t.vehicle_id AS vehicle FROM core.booking_trip t
            WHERE t.source_hold_id = ANY($1::uuid[]) AND t.status = 'BOOKED' ORDER BY t.id`,
          [this.holds.map((h) => h.id)],
        );
        if (rows.length === 0) return null;
        const t = r.pick(rows);
        return { k: 'CANCEL_TRIP', trip: { tripId: t.id, guestId: t.guest, vehicleId: t.vehicle } };
      }
      case 'EVENT': {
        const ev = r.pick(due);
        taken.add(ev.seq);
        return { k: 'EVENT', ev };
      }
      default:
        return { k } as Action;
    }
  }

  // ---- exécution d'une action (aucun tirage aléatoire ici) ----
  async exec(a: Action, lane: Lane): Promise<Done> {
    const now = iso(this.now);
    const s = this.stats;
    switch (a.k) {
      case 'POSE': {
        const r = await guarded(s, 'pose', () =>
          call<string>(
            lane.api,
            G(a.guest),
            now,
            'core.booking_cmd_place_hold($a1::uuid, $a2::timestamptz, $a3::timestamptz, $a4::boolean)',
            [a.slot.vehicleId, a.slot.start, a.slot.end, false],
          ),
        );
        if (typeof r === 'string' && r.startsWith('!')) return { label: `POSE${r}`, effects: [] };
        const holdId = r as string;
        const v = captureOf(a.c);
        await lane.api.query(
          `SELECT test_fixture.us024_set_terms($1, $2::bigint, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7)`,
          [
            holdId,
            v.totalMinor.toString(),
            v.currency,
            legsJson(v.legsMinor),
            a.slot.start,
            a.slot.end,
            a.c.timezone,
          ],
        );
        const hold: HoldM = {
          id: holdId,
          c: a.c,
          guest: a.guest,
          vehicle: a.slot.vehicleId,
          ops: [],
          extra: 0,
        };
        return { label: 'POSE:OK', effects: [{ k: 'HOLD', hold }] };
      }
      case 'PAY': {
        const h = a.hold;
        const t1 = await guarded(s, 'T1', () =>
          call<Record<string, unknown>>(
            lane.api,
            G(h.guest),
            now,
            'core.booking_cmd_start_payment($a1::uuid, $a2::uuid, $a3::text)',
            [h.id, this.worldOf(h.c).account, 'CARD'],
          ),
        );
        if (typeof t1 === 'string') return { label: `T1${t1}`, effects: [] };
        const outcome = String(t1.outcome);
        if (outcome !== 'NEW_ORDER') return { label: `T1:${outcome}`, effects: [] };
        const opId = t1.operationId as string;
        const settleAt = this.now + a.plan.settleAfterMs;
        const op: OpM = {
          id: opId,
          holdId: h.id,
          plan: a.plan,
          settleAt,
          orderExpiresAt: null,
          cancelled: false,
        };
        const effects: Effect[] = [{ k: 'OP', op, extra: false }];
        let label = 'T1:NEW_ORDER';
        if (!a.skipT2) {
          const expiresAt = this.now + ORDER_TTL_MIN * MIN;
          const t2 = await guarded(s, 'T2', () =>
            call<string>(
              lane.api,
              G(h.guest),
              now,
              'core.booking_cmd_record_order($a1::uuid, $a2::uuid, $a3::text, $a4::timestamptz)',
              [h.id, opId, `fake-${opId}`, iso(expiresAt)],
            ),
          );
          label += `/T2:${String(t2)}`;
          effects.push({ k: 'ORDER', op: opId, expiresAt });
        }
        if (a.doubleClick) {
          const again = await guarded(s, 'T1 bis', () =>
            call<Record<string, unknown>>(
              lane.api,
              G(h.guest),
              now,
              'core.booking_cmd_start_payment($a1::uuid, $a2::uuid, $a3::text)',
              [h.id, this.worldOf(h.c).account, 'CARD'],
            ),
          );
          const o = typeof again === 'string' ? again : String(again.outcome);
          if (o === 'NEW_ORDER') throw new C11Failure('double clic : second ordre (VERIF_17-B1)');
          label += `/bis:${o}`;
        }
        // FAKE : issue du paiement et webhook
        const p = a.plan;
        if (p.truth !== 'NEVER' && p.webhook !== 'LOST') {
          const at = settleAt + (p.webhook === 'LATE' ? p.lateMs : 0);
          effects.push({
            k: 'EVENT',
            ev: {
              k: 'WEBHOOK',
              at,
              op: opId,
              status: p.truth,
              dup: p.webhook === 'DUPLICATE',
              ooo: p.webhook === 'OUT_OF_ORDER',
            },
          });
        }
        return { label, effects };
      }
      case 'RELEASE': {
        const r = await guarded(s, 'libération', () =>
          call<string>(
            lane.api,
            G(a.hold.guest),
            now,
            'core.booking_cmd_release_own_hold($a1::uuid)',
            [a.hold.id],
          ),
        );
        return { label: `RELEASE:${String(r)}`, effects: [] };
      }
      case 'DOUBLE_DEBIT': {
        const opId = uuid();
        const attempt = 50 + a.hold.extra;
        await guarded(s, 'second débit', () =>
          // horloge virtuelle : la réussite est connue « maintenant » (updated_at)
          call(
            lane.api,
            G(a.hold.guest),
            now,
            'test_fixture.us024_extra_operation($a1::uuid, $a2::uuid, $a3::text, $a4::integer, $a5::text)',
            [opId, a.hold.id, 'CAPTURE', attempt, 'SUCCEEDED'],
          ),
        );
        const plan: FakePlan = {
          truth: 'SUCCEEDED',
          settleAfterMs: 0,
          webhook: 'LOST',
          lateMs: 0,
          pollUnknown: false,
          convertLost: a.lost,
          convertDelayMs: 0,
        };
        const op: OpM = {
          id: opId,
          holdId: a.hold.id,
          plan,
          settleAt: this.now,
          orderExpiresAt: null,
          cancelled: false,
        };
        const effects: Effect[] = [{ k: 'OP', op, extra: true }];
        if (!a.lost)
          effects.push({
            k: 'EVENT',
            ev: { k: 'CONVERT', at: this.now, op: opId, status: 'SUCCEEDED' },
          });
        return { label: 'DOUBLE_DEBIT', effects };
      }
      case 'CANCEL_TRIP': {
        const r = await guarded(s, 'annulation', () =>
          inTx(lane.worker, { worker: 'trip_lifecycle', virtualNow: now, commit: true }, (tx) =>
            cancelTripByGuest(tx, a.trip),
          ),
        );
        return { label: `CANCEL_TRIP:${String(r)}`, effects: [] };
      }
      case 'EVENT':
        return this.execEvent(a.ev, lane, now);
      case 'EXPIRY': {
        const n = await guarded(s, 'expiration', () =>
          call<number>(lane.worker, W('hold_expiry'), now, 'core.booking_expire_due_holds(10000)'),
        );
        return { label: `EXPIRY:${Number(n) > 0 ? 'n' : '0'}`, effects: [] };
      }
      case 'RELEASE_CANCELLED': {
        const n = await guarded(s, 'temps 2', () =>
          call<number>(
            lane.worker,
            W('hold_expiry'),
            now,
            'core.booking_release_cancelled_holds(10000)',
          ),
        );
        return { label: `RELEASE_CANCELLED:${Number(n) > 0 ? 'n' : '0'}`, effects: [] };
      }
      case 'INTENT_SWEEP':
        return this.intentSweep(lane, now);
      case 'DISPOSITION_SWEEP':
        return this.dispositionSweep(lane, now);
      case 'CANCEL_EXEC':
        return this.cancelExec(lane, now);
    }
  }

  async applyStatus(
    lane: Lane,
    now: string,
    op: string,
    status: string,
    source: 'WEBHOOK' | 'POLL' | 'API_RESPONSE',
  ): Promise<string> {
    const worker: Worker = source === 'WEBHOOK' ? 'webhook_ingest' : 'payment_command';
    const r = await guarded(this.stats, `statut ${source}`, () =>
      call<string>(
        lane.worker,
        W(worker),
        now,
        'core.payment_cmd_apply_operation_status($a1::uuid, $a2::text, $a3::text, NULL, NULL)',
        [op, status, source],
      ),
    );
    return String(r);
  }

  async convertOrFail(
    lane: Lane,
    now: string,
    op: string,
    status: 'SUCCEEDED' | 'FAILED',
  ): Promise<string> {
    const fn =
      status === 'SUCCEEDED'
        ? 'core.booking_convert_payment($a1::uuid)'
        : 'core.booking_record_payment_failure($a1::uuid)';
    const r = await guarded(this.stats, 'conversion', () =>
      call<Record<string, unknown>>(lane.worker, W('booking_conversion'), now, fn, [op]),
    );
    return outcomeLabel(r);
  }

  async execEvent(ev: Ev, lane: Lane, now: string): Promise<Done> {
    const op = this.ops.get(ev.op) as OpM;
    if (ev.k === 'WEBHOOK') {
      if (op.cancelled) return { label: 'WEBHOOK:ANNULÉ', effects: [] };
      const applied = await this.applyStatus(lane, now, ev.op, ev.status, 'WEBHOOK');
      if (ev.ooo) await this.applyStatus(lane, now, ev.op, 'SUBMITTED', 'WEBHOOK');
      const effects: Effect[] = [];
      if (ev.dup) {
        effects.push({
          k: 'EVENT',
          ev: {
            k: 'WEBHOOK',
            at: this.now + 5000,
            op: ev.op,
            status: ev.status,
            dup: false,
            ooo: false,
          },
        });
      }
      if (!op.plan.convertLost) {
        effects.push({
          k: 'EVENT',
          ev: { k: 'CONVERT', at: this.now + op.plan.convertDelayMs, op: ev.op, status: ev.status },
        });
      }
      return { label: `WEBHOOK:${ev.status}:${applied}`, effects };
    }
    return {
      label: `CONVERT:${await this.convertOrFail(lane, now, ev.op, ev.status)}`,
      effects: [],
    };
  }

  /** Réponse du FAKE à getOperation (balayage) ou à cancelOrder, à l'instant courant. */
  fakeStatus(op: OpM): 'SUCCEEDED' | 'FAILED' | 'SUBMITTED' {
    if (op.cancelled) return 'SUBMITTED';
    const p = op.plan;
    if (p.truth === 'NEVER') {
      return op.orderExpiresAt !== null && this.now >= op.orderExpiresAt ? 'FAILED' : 'SUBMITTED';
    }
    return this.now >= op.settleAt ? p.truth : 'SUBMITTED';
  }

  async intentSweep(lane: Lane, now: string): Promise<Done> {
    const due = await guarded(this.stats, 'ordres à lire', () =>
      call<string[] | null>(
        lane.worker,
        W('payment_intent_sweeper'),
        now,
        `(SELECT pg_catalog.json_agg(d.operation_id ORDER BY d.operation_id) FROM core.booking_intents_due(10000 + ${AFTER_CTX}) d)`,
      ),
    );
    const mine = (Array.isArray(due) ? due : []).filter((id) => this.ops.has(id));
    const labels: string[] = [];
    for (const id of mine) {
      const op = this.ops.get(id) as OpM;
      const read = op.plan.pollUnknown ? 'UNKNOWN' : this.fakeStatus(op);
      await this.applyStatus(lane, now, id, read, 'POLL');
      const r = await guarded(this.stats, 'lecture notée', () =>
        call<Record<string, unknown>>(
          lane.worker,
          W('payment_intent_sweeper'),
          now,
          'core.booking_record_poll($a1::uuid)',
          [id],
        ),
      );
      labels.push(outcomeLabel(r));
    }
    return { label: `INTENT_SWEEP:${labels.join(',')}`, effects: [] };
  }

  async dispositionSweep(lane: Lane, now: string): Promise<Done> {
    const due = await guarded(this.stats, 'candidats', () =>
      call<string[] | null>(
        lane.worker,
        W('disposition_sweeper'),
        now,
        `(SELECT pg_catalog.json_agg(d.operation_id ORDER BY d.operation_id) FROM core.booking_disposition_candidates(10000 + ${AFTER_CTX}) d)`,
      ),
    );
    const mine = (Array.isArray(due) ? due : []).filter((id) => this.ops.has(id));
    const labels: string[] = [];
    for (const id of mine) {
      const r = await guarded(this.stats, 'réparation', () =>
        call<Record<string, unknown>>(
          lane.worker,
          W('disposition_sweeper'),
          now,
          'core.booking_disposition_repair($a1::uuid)',
          [id],
        ),
      );
      labels.push(outcomeLabel(r));
    }
    return { label: `DISPOSITION_SWEEP:${labels.join(',')}`, effects: [] };
  }

  /** Travailleur de commandes (US-061, simulé) : cancelOrder du FAKE, « déjà payé » routé vers l'étape 4. */
  async cancelExec(lane: Lane, now: string): Promise<Done> {
    const pending = await guarded(this.stats, 'commandes', () =>
      call<{ id: string; op: string }[] | null>(
        lane.worker,
        W('payment_command'),
        now,
        `(SELECT pg_catalog.json_agg(pg_catalog.json_build_object('id', c.id, 'op', c.operation_id) ORDER BY c.id) FROM core.payment_payment_command c WHERE c.status = 'PENDING' AND c.hold_id = ANY($a1::uuid[]) AND ${AFTER_CTX} = 0)`,
        [this.holds.map((h) => h.id)],
      ),
    );
    const effects: Effect[] = [];
    const labels: string[] = [];
    for (const cmd of Array.isArray(pending) ? pending : []) {
      const op = this.ops.get(cmd.op);
      if (op === undefined) continue;
      if (this.fakeStatus(op) === 'SUCCEEDED') {
        // « déjà payé » : le statut est appliqué, la conversion décide (17 §2.5 étape 6)
        await this.applyStatus(lane, now, op.id, 'SUCCEEDED', 'API_RESPONSE');
        effects.push({
          k: 'EVENT',
          ev: { k: 'CONVERT', at: this.now, op: op.id, status: 'SUCCEEDED' },
        });
        labels.push('ALREADY_PAID');
      } else {
        effects.push({ k: 'CANCELLED', op: op.id });
        labels.push('CANCELLED');
      }
      await guarded(this.stats, 'commande DONE', () =>
        inTx(lane.worker, { worker: 'payment_command', virtualNow: now, commit: true }, (tx) =>
          tx.query(
            `UPDATE core.payment_payment_command SET status = 'DONE' WHERE id = $1 AND status = 'PENDING'`,
            [cmd.id],
          ),
        ),
      );
    }
    return { label: `CANCEL_EXEC:${labels.join(',')}`, effects };
  }

  apply(done: Done): void {
    for (const l of labelsOf(done.label)) bump(this.stats.outcomes, l);
    this.trace.push(`${iso(this.now).slice(11, 19)} ${done.label}`);
    for (const e of done.effects) {
      switch (e.k) {
        case 'HOLD':
          this.holds.push(e.hold);
          break;
        case 'OP': {
          this.ops.set(e.op.id, e.op);
          const h = this.holds.find((x) => x.id === e.op.holdId);
          if (h !== undefined) {
            h.ops.push(e.op.id);
            if (e.extra) h.extra++;
          }
          break;
        }
        case 'ORDER': {
          const op = this.ops.get(e.op);
          if (op !== undefined) op.orderExpiresAt = e.expiresAt;
          break;
        }
        case 'EVENT':
          this.events.push({ ...e.ev, seq: this.seq++ } as Ev);
          break;
        case 'CANCELLED': {
          // ordre annulé par le PSP avant tout paiement : il ne sera jamais payé
          const op = this.ops.get(e.op);
          if (op !== undefined) op.cancelled = true;
          this.events = this.events.filter((x) => !(x.k === 'WEBHOOK' && x.op === e.op));
          break;
        }
      }
    }
  }

  removeEvent(ev: Ev): void {
    this.events = this.events.filter((x) => x.seq !== ev.seq);
  }

  // ---- une étape : une action seule, ou une course de 2 à 3 actions ----
  async step(n: number): Promise<void> {
    const r = this.rng;
    const actionWeights = {
      POSE: 26,
      PAY: 22,
      RELEASE: 6,
      DOUBLE_DEBIT: 4,
      CANCEL_TRIP: 3,
      EVENT: 24,
      EXPIRY: 4,
      RELEASE_CANCELLED: 2,
      INTENT_SWEEP: 4,
      DISPOSITION_SWEEP: 4,
      CANCEL_EXEC: 3,
    };
    if (r.chance(0.18)) {
      await this.tick(r.between(30, 360) * 1000);
      return;
    }
    const size = r.chance(0.35) ? r.between(2, LANES) : 1;
    const taken = new Set<number>();
    const actions: Action[] = [];
    for (let i = 0; i < size; i++) {
      const a = await this.plan(actionWeights, taken);
      if (a !== null) actions.push(a);
    }
    if (actions.length === 0) return;
    for (const a of actions) if (a.k === 'EVENT') this.removeEvent(a.ev);
    this.stats.actions += actions.length;
    if (actions.length === 1) {
      this.apply(await this.exec(actions[0] as Action, this.lanes[0] as Lane));
      await this.checkStep();
      return;
    }
    this.stats.races++;
    const results: (Done | undefined)[] = [];
    const order: number[] = [];
    const forced = this.replayOrders?.[n];
    if (forced !== undefined) {
      for (const i of forced) {
        results[i] = await this.exec(actions[i] as Action, this.lanes[0] as Lane);
        order.push(i);
      }
    } else {
      await Promise.all(
        actions.map(async (a, i) => {
          results[i] = await this.exec(a, this.lanes[i] as Lane);
          order.push(i);
        }),
      );
    }
    this.orders[n] = order;
    for (const i of order) this.apply(results[i] as Done);
    await this.checkStep();
  }

  /** Le temps passe : les travailleurs périodiques tournent (17 §2.5 : 60 s), puis les invariants. */
  async tick(ms: number): Promise<void> {
    this.now += ms;
    await this.periodic();
  }

  async periodic(): Promise<void> {
    const lane = this.lanes[0] as Lane;
    for (const a of [
      { k: 'EXPIRY' },
      { k: 'RELEASE_CANCELLED' },
      { k: 'CANCEL_EXEC' },
      { k: 'INTENT_SWEEP' },
      { k: 'DISPOSITION_SWEEP' },
    ] as Action[]) {
      this.apply(await this.exec(a, lane));
    }
    await this.checkStep();
  }

  /** Quiescence : événements en attente livrés, travailleurs actifs, jusqu'à ce que tout soit terminal. */
  async quiesce(): Promise<void> {
    const lane = this.lanes[0] as Lane;
    for (let i = 0; i < 40; i++) {
      this.now += 3 * MIN;
      for (const ev of this.dueEvents()) {
        this.removeEvent(ev);
        this.apply(await this.exec({ k: 'EVENT', ev }, lane));
      }
      await this.periodic();
      // terminé : aucun événement en attente, aucun hold vivant, aucun paiement réussi non disposé
      const live = await this.observer.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM core.booking_checkout_hold
                  WHERE id = ANY($1::uuid[]) AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT'))
              + (SELECT count(*) FROM core.payment_payment_operation o
                  WHERE o.hold_id = ANY($1::uuid[]) AND o.purpose = 'RENT' AND o.status = 'SUCCEEDED'
                    AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                     WHERE d.operation_id = o.id))::int AS n`,
        [this.holds.map((h) => h.id)],
      );
      if (this.events.length === 0 && live.rows[0]?.n === 0 && i >= 2) return;
    }
    throw new C11Failure('quiescence non atteinte en 2 h virtuelles');
  }

  // ---- invariants ----
  async checkStep(): Promise<void> {
    const { rows } = await this.observer.query<{ vii: number; viii: number }>(
      `SELECT
         (SELECT count(*)::int FROM (
            SELECT h.guest_user_id FROM core.booking_checkout_hold h
             WHERE h.guest_user_id = ANY($1::uuid[]) AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
             GROUP BY h.guest_user_id HAVING count(*) > 2) x) AS vii,
         (SELECT count(*)::int FROM core.booking_checkout_hold h
            JOIN core.payment_payment_operation o ON o.hold_id = h.id
           WHERE h.id = ANY($2::uuid[]) AND h.status = 'PAYMENT_IN_FLIGHT'
             AND o.purpose = 'RENT' AND o.status = 'SUCCEEDED'
             AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d WHERE d.operation_id = o.id)
             AND COALESCE((SELECT min(e.at) FROM core.payment_payment_operation_event e
                            WHERE e.operation_id = o.id AND e.status = 'SUCCEEDED' AND e.outcome = 'APPLIED'),
                          o.updated_at) < $3::timestamptz - make_interval(mins => $4)) AS viii`,
      [this.guests, this.holds.map((h) => h.id), iso(this.now), DISPOSITION_BOUND_MIN],
    );
    const r = rows[0];
    if (r?.vii !== 0)
      throw new C11Failure(`(vii) voyageur avec plus de 2 holds vivants (${String(r?.vii)})`);
    if (r.viii !== 0)
      throw new C11Failure(
        `(viii) hold PAYMENT_IN_FLIGHT avec paiement non disposé > 20 min (${String(r.viii)})`,
      );
  }

  async checkFinal(): Promise<{ holds: number; trips: number }> {
    const holdIds = this.holds.map((h) => h.id);
    const window = `[${iso(this.eraStart)},${iso(this.eraStart + ERA_SPACING_MS)})`;
    const { rows } = await this.observer.query<Record<string, number>>(
      `WITH h AS (SELECT * FROM core.booking_checkout_hold WHERE id = ANY($1::uuid[])),
            t AS (SELECT * FROM core.booking_trip WHERE source_hold_id = ANY($1::uuid[])),
            o AS (SELECT op.*, COALESCE((SELECT min(e.at) FROM core.payment_payment_operation_event e
                                          WHERE e.operation_id = op.id AND e.status = 'SUCCEEDED'
                                            AND e.outcome = 'APPLIED'), op.updated_at) AS known_at
                    FROM core.payment_payment_operation op
                   WHERE op.hold_id = ANY($1::uuid[]) AND op.purpose = 'RENT'
                     AND op.kind IN ('AUTH', 'CAPTURE'))
       SELECT
         (SELECT count(*)::int FROM h) AS holds_seen,
         (SELECT count(*)::int FROM t) AS trips_seen,
         (SELECT count(*)::int FROM o) AS ops_seen,
         (SELECT count(*)::int FROM h WHERE status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')) AS live_holds,
         -- (i) jamais deux occupations actives chevauchantes par véhicule
         (SELECT count(*)::int FROM core.booking_vehicle_occupancy a
            JOIN core.booking_vehicle_occupancy b
              ON b.vehicle_id = a.vehicle_id AND b.id > a.id AND b.active AND b.period && a.period
           WHERE a.active AND a.vehicle_id = ANY($2::uuid[]) AND a.period && $3::tstzrange) AS i,
         -- (ii) I-OCC : trip non terminal ⇒ exactement une occupation TRIP active de son véhicule
         (SELECT count(*)::int FROM t
           WHERE t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'UNRETURNED')
             AND (SELECT count(*) FROM core.booking_vehicle_occupancy v
                   WHERE v.kind = 'TRIP' AND v.active AND v.ref_type = 'TRIP' AND v.ref_id = t.id
                     AND v.vehicle_id = t.vehicle_id) <> 1) AS ii,
         -- (iii) toute opération SUCCEEDED : exactement une disposition, au plus 20 min après la réussite connue
         (SELECT count(*)::int FROM o WHERE o.status = 'SUCCEEDED'
             AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d WHERE d.operation_id = o.id)) AS iii_missing,
         (SELECT count(*)::int FROM o JOIN core.booking_payment_disposition d ON d.operation_id = o.id
           WHERE o.status = 'SUCCEEDED' AND d.decided_at > o.known_at + make_interval(mins => $4)) AS iii_late,
         -- (iv) aucun trip sans preuve de paiement : disposition CONVERSION d'une opération SUCCEEDED
         (SELECT count(*)::int FROM t WHERE NOT EXISTS (
            SELECT 1 FROM core.booking_payment_disposition d JOIN core.payment_payment_operation p ON p.id = d.operation_id
             WHERE d.trip_id = t.id AND d.disposition = 'CONVERSION' AND p.status = 'SUCCEEDED')) AS iv,
         -- (v) aucun hold COMPENSATED avec un trip
         (SELECT count(*)::int FROM h WHERE h.status = 'COMPENSATED'
             AND (h.converted_trip_id IS NOT NULL OR EXISTS (SELECT 1 FROM t WHERE t.source_hold_id = h.id)
                  OR EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                              WHERE d.hold_id = h.id AND d.disposition = 'CONVERSION'))) AS v,
         -- (vi) au plus une CONVERSION par hold
         (SELECT count(*)::int FROM h WHERE (SELECT count(*) FROM core.booking_payment_disposition d
                                              WHERE d.hold_id = h.id AND d.disposition = 'CONVERSION') > 1) AS vi,
         -- cohérence : un trip par hold converti, et réciproquement
         (SELECT count(*)::int FROM h WHERE h.status = 'CONVERTED'
             AND NOT EXISTS (SELECT 1 FROM t WHERE t.id = h.converted_trip_id)) AS converted_without_trip`,
      [holdIds, this.vehicles, window, DISPOSITION_BOUND_MIN],
    );
    const r = rows[0] as Record<string, number>;
    const fail = (msg: string): never => {
      throw new C11Failure(msg);
    };
    // anti-vacuité : l'observateur (booking_oracle) voit tout ce que le modèle a créé
    if (r.holds_seen !== holdIds.length)
      fail(`holds visibles ${String(r.holds_seen)} ≠ ${String(holdIds.length)}`);
    if (r.ops_seen !== this.ops.size)
      fail(`opérations visibles ${String(r.ops_seen)} ≠ ${String(this.ops.size)}`);
    if (r.live_holds !== 0) fail(`holds encore vivants après quiescence : ${String(r.live_holds)}`);
    for (const k of [
      'i',
      'ii',
      'iii_missing',
      'iii_late',
      'iv',
      'v',
      'vi',
      'converted_without_trip',
    ]) {
      if (r[k] !== 0) fail(`invariant (${k}) : ${String(r[k])}`);
    }
    return { holds: holdIds.length, trips: r.trips_seen ?? 0 };
  }

  async run(): Promise<RunResult> {
    for (let n = 0; n < STEPS; n++) await this.step(n);
    await this.quiesce();
    const f = await this.checkFinal();
    return { orders: this.orders, holds: f.holds, trips: f.trips };
  }
}

/** Issues élémentaires d'une étiquette (`A:x/B:y`, `SWEEP:a,b`) pour l'histogramme. */
function labelsOf(label: string): string[] {
  return label.split('/').flatMap((part) => {
    const i = part.indexOf(':');
    if (i < 0) return [part];
    const head = part.slice(0, i);
    const items = part
      .slice(i + 1)
      .split(',')
      .filter((x) => x !== '');
    return items.length === 0 ? [`${head}:-`] : items.map((x) => `${head}:${x}`);
  });
}

function outcomeLabel(r: unknown): string {
  if (typeof r === 'string') return r;
  if (typeof r !== 'object' || r === null) return String(r);
  const o = r as Record<string, unknown>;
  const parts = [String(o.outcome)];
  if (typeof o.reason === 'string') parts.push(o.reason);
  if (o.reacquired === true) parts.push('REACQUIRED');
  return parts.join('+');
}

// --- Oracle C12 sous booking_oracle, transaction READ ONLY ---------------------------------------
interface OracleRow {
  check_code: string;
  violations: string;
  by_country: Record<string, number>;
}

async function oracle(client: pg.Client, now: string): Promise<OracleRow[]> {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', 'booking_oracle', true),
              pg_catalog.set_config('app.virtual_now', $1, true)`,
      [now],
    );
    const { rows } = await client.query<OracleRow>(
      'SELECT check_code, violations::text AS violations, by_country FROM core.booking_production_oracle()',
    );
    return rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

const C12 = [
  'TRIP_WITHOUT_ACTIVE_OCCUPANCY',
  'SUCCEEDED_WITHOUT_DISPOSITION',
  'COMPENSATED_HOLD_WITH_TRIP',
  'HOLD_WITH_TWO_CONVERSIONS',
  'INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP',
] as const;

const zeros = (rows: readonly OracleRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.check_code, r.violations]));

const ALL_ZERO = Object.fromEntries(C12.map((c) => [c, '0']));

// --- Connexions ----------------------------------------------------------------------------------
let lanes: Lane[] = [];
let observer: pg.Client;
let api: pg.Client;

beforeEach(async () => {
  api = await connectAs('app_api', DB);
  observer = await connectAs('app_worker', DB);
  // observateur en LECTURE SEULE (booking_oracle) : contexte de session posé une fois, aucune écriture
  await observer.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', false),
            pg_catalog.set_config('app.worker_name', 'booking_oracle', false)`,
  );
  await observer.query('SET default_transaction_read_only = on');
  lanes = [];
  for (let i = 0; i < LANES; i++) {
    lanes.push({ api: await connectAs('app_api', DB), worker: await connectAs('app_worker', DB) });
  }
});

afterEach(async () => {
  for (const l of lanes) {
    await releaseClient(l.worker);
    await releaseClient(l.api);
  }
  await releaseClient(observer);
  await releaseClient(api);
});

let worlds: CountryWorld[] = [];
let lastNow = ERA_BASE;

describe('US-025 — fuzz C11 (L0-09) et oracle C12, PA (USD) et PY (PYG)', () => {
  beforeAll(async () => {
    const setup = await connectAs('app_api', DB);
    try {
      worlds = [];
      for (const c of COUNTRIES) worlds.push(await buildWorld(setup, c));
    } finally {
      await releaseClient(setup);
    }
  });

  it(
    `C11 : ${String(CFG.runs)} exécution(s), invariants (i) à (ix), graine de chaque échec rejouable`,
    async () => {
      // l'horloge virtuelle passe par la même instruction que l'appel (forme d'ADR-056)
      const probe = await call<string>(
        lanes[0]?.worker as pg.Client,
        W('booking_oracle'),
        iso(ERA_BASE),
        `pg_catalog.to_char(platform.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      );
      expect(probe).toBe(iso(ERA_BASE));

      const stats: Stats = {
        outcomes: new Map(),
        races: 0,
        actions: 0,
        deadlocks: 0,
        serializationFailures: 0,
        replays: 0,
      };
      const started = performance.now();
      const failures: { seed: number; replay: string; error: string; trace: string[] }[] = [];
      let holds = 0;
      let trips = 0;
      console.info(
        `[C11] graine ${String(CFG.seed)}, ${String(CFG.runs)} exécution(s)${CFG.replay !== undefined ? `, rejeu ${String(CFG.replay.seed)}` : ''}`,
      );
      for (let i = 0; i < CFG.runs; i++) {
        const seed = CFG.replay?.seed ?? runSeed(CFG.seed, i);
        const run = new Run(seed, i, worlds, lanes, observer, stats, CFG.replay?.orders);
        try {
          const r = await run.run();
          holds += r.holds;
          trips += r.trips;
        } catch (error) {
          const replay = formatReplay(seed, run.orders);
          failures.push({
            seed,
            replay,
            error: (error as Error).message,
            trace: run.trace.slice(-60),
          });
          console.error(
            `[C11] ÉCHEC exécution ${String(i)} : ${(error as Error).message}\n  rejouer : RUEDA_C11_REPLAY=${replay}\n  ${run.trace.slice(-60).join('\n  ')}`,
          );
          if (CFG.failuresFile !== undefined) {
            appendFileSync(CFG.failuresFile, `${JSON.stringify(failures.at(-1))}\n`);
          }
          break;
        }
        lastNow = run.now;
        if ((i + 1) % 100 === 0) {
          expect(
            zeros(await oracle(observer, iso(run.now))),
            `oracle C12 après ${String(i + 1)} exécutions`,
          ).toEqual(ALL_ZERO);
          console.info(
            `[C11] ${String(i + 1)} exécutions, ${((performance.now() - started) / 1000).toFixed(1)} s`,
          );
        }
      }
      const seconds = (performance.now() - started) / 1000;
      const histogram = Object.fromEntries(
        [...stats.outcomes.entries()].sort((a, b) => b[1] - a[1]),
      );
      console.info(
        `[C11] ${String(CFG.runs)} exécutions en ${seconds.toFixed(1)} s ; actions ${String(stats.actions)}, courses ${String(stats.races)}, ` +
          `holds ${String(holds)}, trips ${String(trips)} ; 40P01 ${String(stats.deadlocks)}, 40001 ${String(stats.serializationFailures)}, rejeux ${String(stats.replays)}`,
      );
      console.info(`[C11] issues ${JSON.stringify(histogram)}`);
      expect(failures).toEqual([]);
      if (CFG.replay === undefined && CFG.runs >= 200) {
        // le fuzz exerce bien les chemins de 17 §2.5 (sinon il ne prouverait rien)
        const seen = (prefix: string): number =>
          [...stats.outcomes.entries()]
            .filter(([k]) => k.includes(prefix))
            .reduce((s, [, n]) => s + n, 0);
        expect(stats.races).toBeGreaterThan(CFG.runs);
        for (const p of [
          'CONVERTED',
          'COMPENSATED',
          'POSE:OK',
          'T1:NEW_ORDER',
          'POSE!VEHICLE_UNAVAILABLE',
        ]) {
          expect(seen(p), p).toBeGreaterThan(0);
        }
      }
      expect(zeros(await oracle(observer, iso(lastNow + 60 * MIN)))).toEqual(ALL_ZERO);
    },
    Math.max(120_000, CFG.runs * 1_500),
  );

  // -----------------------------------------------------------------------------------------------
  // C12 : oracle de production — chaque contrôle détecte sa violation, alerte P1, lecture seule
  // -----------------------------------------------------------------------------------------------
  it.each(COUNTRIES)(
    'C12 ($country) : 0 partout sur la base saine ; chaque contrôle compte sa violation forgée ; alerte P1 par comptes',
    async (c) => {
      const T = ERA_BASE - 30 * 86_400_000 + (c.country === 'PA' ? 0 : 3 * 86_400_000);
      const w = worlds.find((x) => x.c.country === c.country) as CountryWorld;
      const lane = lanes[0] as Lane;
      // un trip converti de référence, par les commandes et les travailleurs réels
      const g = w.spareGuests[0] as string;
      const slot: Slot = {
        vehicleId: w.spareVehicle,
        orgId: '',
        start: iso(T + 2 * 86_400_000),
        end: iso(T + 3 * 86_400_000),
        bufferHours: 2,
      };
      const holdId = await call<string>(
        lane.api,
        G(g),
        iso(T),
        'core.booking_cmd_place_hold($a1::uuid, $a2::timestamptz, $a3::timestamptz, $a4::boolean)',
        [slot.vehicleId, slot.start, slot.end, false],
      );
      const v = captureOf(c);
      await lane.api.query(
        `SELECT test_fixture.us024_set_terms($1, $2::bigint, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7)`,
        [
          holdId,
          v.totalMinor.toString(),
          v.currency,
          legsJson(v.legsMinor),
          slot.start,
          slot.end,
          c.timezone,
        ],
      );
      const t1 = await call<Record<string, unknown>>(
        lane.api,
        G(g),
        iso(T + MIN),
        'core.booking_cmd_start_payment($a1::uuid, $a2::uuid, $a3::text)',
        [holdId, w.account, 'CARD'],
      );
      expect(t1.outcome).toBe('NEW_ORDER');
      const op = t1.operationId as string;
      expect(
        await call<string>(
          lane.worker,
          W('webhook_ingest'),
          iso(T + 2 * MIN),
          'core.payment_cmd_apply_operation_status($a1::uuid, $a2::text, $a3::text, NULL, NULL)',
          [op, 'SUCCEEDED', 'WEBHOOK'],
        ),
      ).toBe('APPLIED');
      const conv = await call<Record<string, unknown>>(
        lane.worker,
        W('booking_conversion'),
        iso(T + 2 * MIN),
        'core.booking_convert_payment($a1::uuid)',
        [op],
      );
      expect(conv.outcome).toBe('CONVERTED');
      const tripId = conv.tripId as string;

      const at = iso(T + 3 * MIN);
      // base saine (le fuzz a laissé ses données) : 0 pour chacun des cinq contrôles, sur TOUTE la base
      const clean = await oracle(observer, at);
      expect(clean.map((r) => r.check_code)).toEqual([...C12]);
      expect(zeros(clean)).toEqual(ALL_ZERO);

      // chaque violation forgée DANS une transaction annulée : comptée par son seul contrôle et par pays
      const forged = async (check: (typeof C12)[number]): Promise<Record<string, string>> =>
        inTx(lane.worker, { worker: 'booking_oracle', virtualNow: at }, async (tx) => {
          await tx.query(`SELECT test_fixture.us025_forge_c12($1, $2)`, [check, tripId]);
          const { rows } = await tx.query<OracleRow>(
            'SELECT check_code, violations::text AS violations, by_country FROM core.booking_production_oracle()',
          );
          const row = rows.find((x) => x.check_code === check);
          expect(row?.by_country, check).toEqual({ [c.country]: 1 });
          return zeros(rows);
        });
      for (const check of C12.filter((x) => x !== 'SUCCEEDED_WITHOUT_DISPOSITION')) {
        expect(await forged(check), check).toEqual({ ...ALL_ZERO, [check]: '1' });
      }
      // paiement réussi sans disposition : compté au-delà de 20 min seulement (17 §2.5)
      await inTx(lane.worker, { worker: 'booking_oracle', virtualNow: at }, async (tx) => {
        await tx.query(`SELECT test_fixture.us025_forge_c12('SUCCEEDED_WITHOUT_DISPOSITION', $1)`, [
          tripId,
        ]);
        const count = async (when: number): Promise<string | undefined> => {
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(when)]);
          const { rows } = await tx.query<OracleRow>(
            'SELECT check_code, violations::text AS violations, by_country FROM core.booking_production_oracle()',
          );
          return zeros(rows).SUCCEEDED_WITHOUT_DISPOSITION;
        };
        expect(await count(T + 3 * MIN + 19 * MIN)).toBe('0');
        expect(await count(T + 3 * MIN + 20 * MIN)).toBe('1');
        // alerte P1 : une seule, comptes seulement, rien d'identifiant
        const report = (
          await tx.query<{ r: Record<string, unknown> }>(
            'SELECT core.booking_production_oracle_alert() AS r',
          )
        ).rows[0]?.r;
        expect(report).toMatchObject({
          violations: 1,
          alerted: true,
          checks: {
            ...Object.fromEntries(C12.map((k) => [k, 0])),
            SUCCEEDED_WITHOUT_DISPOSITION: 1,
          },
        });
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'outbox_relay', true)`);
        const { rows: ev } = await tx.query<{
          type: string;
          country_code: string | null;
          payload: Record<string, unknown>;
        }>(
          `SELECT type, country_code, payload FROM core.outbox_outbox_event WHERE aggregate_id = $1`,
          [report?.alert_id],
        );
        expect(ev).toHaveLength(1);
        expect(ev[0]).toMatchObject({
          type: 'booking.alert.production_oracle',
          country_code: null,
        });
        expect(ev[0]?.payload).toMatchObject({
          severity: 'P1',
          violations: 1,
          by_country: { SUCCEEDED_WITHOUT_DISPOSITION: { [c.country]: 1 } },
        });
        const text = JSON.stringify(ev[0]?.payload);
        for (const id of [tripId, holdId, op, g, slot.vehicleId]) expect(text).not.toContain(id);
      });
      // rien n'a été validé : la base est de nouveau saine ; base saine ⇒ aucune alerte
      expect(zeros(await oracle(observer, at))).toEqual(ALL_ZERO);
      const quiet = await inTx(
        lane.worker,
        { worker: 'booking_oracle', virtualNow: at },
        async (tx) =>
          (
            await tx.query<{ r: Record<string, unknown> }>(
              'SELECT core.booking_production_oracle_alert() AS r',
            )
          ).rows[0]?.r,
      );
      expect(quiet).toMatchObject({ violations: 0, alerted: false, alert_id: null });
    },
    120_000,
  );

  it('C12 : lecture seule (STABLE, READ ONLY), aucune donnée personnelle, réservé au travailleur booking_oracle', async () => {
    const lane = lanes[0] as Lane;
    const at = iso(ERA_BASE);
    // tout autre contexte : refus explicite (jamais des zéros trompeurs sous la RLS)
    for (const ctx of [W('booking_conversion'), W('disposition_sweeper'), W('outbox_relay')]) {
      await expect(
        inTx(
          lane.worker,
          { worker: (ctx as { workerName: Worker }).workerName, virtualNow: at },
          (tx) => tx.query('SELECT * FROM core.booking_production_oracle()'),
        ),
      ).rejects.toMatchObject({ code: '42501', constraint: 'oracle_forbidden' });
    }
    await expect(
      inTx(lane.worker, { virtualNow: at }, (tx) =>
        tx.query('SELECT * FROM core.booking_production_oracle()'),
      ),
    ).rejects.toMatchObject({ code: '42501', constraint: 'oracle_forbidden' });
    // app_api et app_anon : aucun EXECUTE
    for (const fn of [
      'core.booking_production_oracle()',
      'core.booking_production_oracle_alert()',
    ]) {
      await expect(inTx(lane.api, {}, (tx) => tx.query(`SELECT ${fn}`))).rejects.toMatchObject({
        code: '42501',
      });
    }
    const anon = await connectAs('app_anon', DB);
    try {
      await expect(
        anon.query('SELECT * FROM core.booking_production_oracle()'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await releaseClient(anon);
    }
    // READ ONLY : l'oracle tourne dans une transaction en lecture seule (helper `oracle`)
    expect((await oracle(observer, at)).length).toBe(5);
    // définitions : STABLE et SECURITY INVOKER (aucune élévation, liste blanche RLS-15 inchangée)
    const { rows } = await observer.query<{ fn: string; volatile: string; definer: boolean }>(
      `SELECT p.proname AS fn, p.provolatile AS volatile, p.prosecdef AS definer
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'core' AND p.proname LIKE 'booking_production_oracle%' ORDER BY 1`,
    );
    expect(rows).toEqual([
      { fn: 'booking_production_oracle', volatile: 's', definer: false },
      { fn: 'booking_production_oracle_alert', volatile: 'v', definer: false },
    ]);
    // aucune donnée personnelle : le travailleur de l'oracle ne voit aucune table IAM ni KYC
    for (const tbl of ['core.iam_user_account', 'core.iam_organization']) {
      const r = await observer
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tbl}`)
        .catch((e: { code?: string }) => ({ rows: [{ n: e.code === '42501' ? 0 : -1 }] }));
      expect(r.rows[0]?.n, tbl).toBe(0);
    }
    // le corps ne lit que des identifiants, statuts, horodatages et pays
    const body = await observer.query<{ src: string }>(
      `SELECT p.prosrc AS src FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'core' AND p.proname = 'booking_production_oracle'`,
    );
    for (const pii of [
      'guest_user_id',
      'email',
      'legal_',
      'phone',
      'iam_',
      'kyc_',
      'raw_ref',
      'payload',
    ]) {
      expect(body.rows[0]?.src, pii).not.toContain(pii);
    }
  });

  // -----------------------------------------------------------------------------------------------
  // Report de la revue sécurité d'US-024 : garde d'environnement de T1 fail-closed sur NULL (0042)
  // -----------------------------------------------------------------------------------------------
  it.each(COUNTRIES)(
    'T1 ($country) : platform.deployment_env() NULL vaut « production » (FAKE et SANDBOX refusés)',
    async (c) => {
      const T = ERA_BASE - 60 * 86_400_000 + (c.country === 'PA' ? 0 : 3 * 86_400_000);
      const w = worlds.find((x) => x.c.country === c.country) as CountryWorld;
      const g = w.spareGuests[1] as string;
      const slot: Slot = {
        vehicleId: w.spareVehicle,
        orgId: '',
        start: iso(T + 2 * 86_400_000),
        end: iso(T + 3 * 86_400_000),
        bufferHours: 2,
      };
      const holdId = await call<string>(
        api,
        G(g),
        iso(T),
        'core.booking_cmd_place_hold($a1::uuid, $a2::timestamptz, $a3::timestamptz, $a4::boolean)',
        [slot.vehicleId, slot.start, slot.end, false],
      );
      const v = captureOf(c);
      await api.query(
        `SELECT test_fixture.us024_set_terms($1, $2::bigint, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7)`,
        [
          holdId,
          v.totalMinor.toString(),
          v.currency,
          legsJson(v.legsMinor),
          slot.start,
          slot.end,
          c.timezone,
        ],
      );
      const sandbox = (
        await api.query<{ id: string }>(
          `SELECT test_fixture.us024_psp_account_of('DLOCAL', $1, 'SANDBOX') AS id`,
          [c.country],
        )
      ).rows[0]?.id as string;
      const t1 = async (
        account: string,
        env: string,
      ): Promise<{ code: string; constraint: string | undefined } | string> => {
        try {
          return await inTx(api, { virtualNow: iso(T + MIN) }, async (tx) => {
            await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', $1, true)`, [
              env,
            ]);
            const r = await tx.query<{ env: string | null }>(
              'SELECT platform.deployment_env() AS env',
            );
            expect(r.rows[0]?.env ?? null, env).toBe(env === '__null__' ? null : env);
            const { text, values } = oneStatement(
              G(g),
              iso(T + MIN),
              'core.booking_cmd_start_payment($a1::uuid, $a2::uuid, $a3::text)',
              [holdId, account, 'CARD'],
            );
            const out = await tx.query<{ result: Record<string, unknown> }>(text, values);
            return String(out.rows[0]?.result.outcome);
          });
        } catch (error) {
          const e = error as { code?: string; constraint?: string };
          return { code: translateDbError(error).code, constraint: e.constraint };
        }
      };
      // environnement NULL : FAKE refusé (C19) ; compte SANDBOX refusé (LIVE exigé)
      expect(await t1(w.account, '__null__')).toEqual({
        code: 'FAKE_FORBIDDEN_IN_PRODUCTION',
        constraint: 'psp_account_fake_forbidden',
      });
      expect(await t1(sandbox, '__null__')).toEqual({
        code: 'PSP_ACCOUNT_INACTIVE',
        constraint: 'payment_operation_account_active',
      });
      // témoins : mêmes refus en production ; en test, le FAKE passe (transaction annulée)
      expect(await t1(w.account, 'production')).toMatchObject({
        code: 'FAKE_FORBIDDEN_IN_PRODUCTION',
      });
      expect(await t1(sandbox, 'production')).toMatchObject({ code: 'PSP_ACCOUNT_INACTIVE' });
      expect(await t1(w.account, 'test')).toBe('NEW_ORDER');
    },
    60_000,
  );
});
