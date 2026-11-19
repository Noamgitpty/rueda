/**
 * US-222b — aides de la red team argent du lot 2 (19 US-222 critère 2 ; pré-mortem du lot 2,
 * L2-PM-38, L2-PM-39). TESTS SEULEMENT (dossier `test/`, hors de l'image de production).
 *
 * Règles de jeu : connexions sous les rôles de PRODUCTION (`connectAs` : assertion L0-05 en tête,
 * une connexion par client, libérée après chaque test) ; horloge de la base (`platform.now()`,
 * horloge virtuelle de test) ; aucun interrupteur de mise en service ouvert hors d'une transaction
 * ANNULÉE et par la vraie procédure à deux personnes (US-125) ; aucune constante de pays (pays et
 * devises lus de la configuration, montants des oracles de `docs/specs/tools/`).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setSessionContext } from '@rueda/db';
import { connectAs, releaseClient, withTestTransaction } from '@rueda/db/testing';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, expect } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../src/modules/bus/index.js';
import { reconciliationReportJson, runMoneyReconciliation } from '../../src/modules/fin/index.js';
import { countryCases } from './countries.js';

export const golden = loadGoldenVectors();
export const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
export type LegName = (typeof LEGS)[number];
export type Legs = Record<LegName, bigint>;
export type Json = Record<string, unknown>;
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
export const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
] as const;
export const ALL_CLOSED = Object.fromEntries(SWITCHES.map((k) => [k, false]));

export const iso = (ms: number): string => new Date(ms).toISOString();
export const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
export const legsText = (l: Legs): Record<string, string> =>
  Object.fromEntries(LEGS.map((k) => [k, l[k].toString()]));
export const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
export const plus = (a: Legs, b: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, a[k] + b[k]])) as unknown as Legs;
export const legsOf = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;

/**
 * Parcours par devise (jamais par pays : le pays est celui que la configuration associe à la devise
 * du vecteur, ADR-024). Trip A de 08 (USD) : capture TJ01, annulation du voyageur T03 (variation
 * TJ02b) ; trip D (PYG) : capture TJ08a, T27 (variation TJ08b). `prorata` : contre-exemple interdit
 * (08 E7 règle 1), même méthode que TJ10c de `docs/specs/tools/check_legs.py` (jambes non plateforme
 * au prorata de la capture, arrondi au demi supérieur, reste sur PLATFORM), calculé par
 * `python -I -X utf8` le 2026-11-19 (TJ10a / TJ10b redonnent exactement TJ10c) : jamais par le code.
 * `creditCap` / `card` : cascade de 08 E7 règle 10 (TJ21) de l'oracle (`cascade`, même calcul) :
 * crédit cash demandé au-delà de PLATFORM, plafonné à la jambe PLATFORM de la capture.
 */
export const JOURNEYS = [
  {
    settlement: 'T03',
    capture: 'TJ01',
    variation: 'TJ02b',
    prorata: { HOST: -9585n, INSURER: -1862n, TAX_THIRD_PARTY: 0n, PLATFORM: -7297n },
    creditAsked: 12000n,
    creditCap: 9991n,
    cardLegs: { HOST: 13125n, INSURER: 2550n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
  },
  {
    settlement: 'T27',
    capture: 'TJ08a',
    variation: 'TJ08b',
    prorata: { HOST: -547818n, INSURER: -73042n, TAX_THIRD_PARTY: 0n, PLATFORM: -379507n },
    creditAsked: 600000n,
    creditCap: 545550n,
    cardLegs: { HOST: 787500n, INSURER: 105000n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
  },
] as const;

export const CASES = JOURNEYS.map((j, i) => {
  const v = settlementVector(golden, j.settlement);
  const c = countryCases().find((x) => x.currency === v.currency);
  if (c === undefined) throw new Error(`aucun pays configuré en ${v.currency}`);
  return { country: c.country, currency: v.currency, index: i, journey: j };
});
export type Case = (typeof CASES)[number];

// --- connexions et transactions ------------------------------------------------------------------

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) {
    await c.query('ROLLBACK').catch(() => undefined);
    await releaseClient(c);
  }
});

/** Une connexion par client, sous un rôle de production (L0-05), libérée après le test. */
export async function open(role: 'app_api' | 'app_worker'): Promise<pg.Client> {
  const client = await connectAs(role); // assertion L0-05
  opened.push(client);
  return client;
}

export interface TxOptions {
  readonly at?: string;
  readonly worker?: string;
  readonly commit?: boolean;
}
export async function inTx<T>(
  client: pg.ClientBase,
  o: TxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(o.at !== undefined ? { virtualNow: o.at } : {}),
      ...(o.commit !== undefined ? { commit: o.commit } : {}),
    },
    async (tx) => {
      if (o.worker !== undefined) await asWorker(tx, o.worker);
      return fn(tx);
    },
  );
}
export async function asWorker(tx: pg.ClientBase, workerName: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName });
}
export const sqlOf = (client: pg.ClientBase): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

/** Instruction attendue en échec, isolée par un point de sauvegarde (la transaction continue). */
export async function refused(
  tx: pg.ClientBase,
  fn: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string } | null> {
  await tx.query('SAVEPOINT rt_l2_refused');
  try {
    await fn();
    await tx.query('RELEASE SAVEPOINT rt_l2_refused');
    return null;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rt_l2_refused');
    const e = error as { code?: unknown; constraint?: unknown };
    return {
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
      ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
    };
  }
}

export interface Gate {
  readonly open: () => void;
  readonly wait: Promise<void>;
}
export function gate(): Gate {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open: () => release(), wait };
}

/**
 * Transactions du travailleur (app_worker), VALIDÉES, à l'instant virtuel `atMs`, une connexion par
 * transaction. `hold` : la transaction garde ses verrous jusqu'à l'ouverture de la porte (COMMIT
 * différé), pour une concurrence réelle et observée. `pids` : sessions ouvertes, dans l'ordre.
 */
export class TestTransactions implements WorkerTransactions {
  readonly pids: number[] = [];
  /** Résolue quand la première transaction a fini son travail et attend la porte (verrous tenus). */
  readonly reached: Promise<void>;
  #reached: () => void = () => undefined;
  constructor(
    private readonly atMs: number,
    private readonly hold?: Promise<void>,
  ) {
    this.reached = new Promise<void>((resolve) => {
      this.#reached = resolve;
    });
  }
  async run<T>(worker: string, fn: (db: SqlClient) => Promise<T>): Promise<T> {
    const client = await open('app_worker');
    return inTx(client, { at: iso(this.atMs), worker, commit: true }, async (tx) => {
      const p = await tx.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
      this.pids.push(p.rows[0]?.pid ?? -1);
      const r = await fn(sqlOf(tx));
      this.#reached();
      if (this.hold !== undefined) await this.hold;
      return r;
    });
  }
}

/**
 * Attend qu'une des sessions `pids()` soit BLOQUÉE sur un verrou (pg_stat_activity, connexion
 * d'observation du même rôle, chaque lecture dans sa propre transaction) ; ou que `done()` soit
 * vrai (la session concurrente a fini sans attendre : rendu à l'appelant, qui l'affirme). 15 s.
 */
export async function lockedOrDone(
  observer: pg.ClientBase,
  pids: () => readonly number[],
  done: () => boolean,
): Promise<'LOCKED' | 'DONE'> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (done()) return 'DONE';
    const list = [...pids()];
    if (list.length > 0) {
      const { rows } = await observer.query<{ n: number }>(
        `SELECT pg_catalog.count(*)::int AS n FROM pg_catalog.pg_stat_activity
          WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'`,
        [list],
      );
      if ((rows[0]?.n ?? 0) > 0) return 'LOCKED';
    }
    if (Date.now() > deadline) throw new Error('session concurrente ni bloquée ni terminée');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// --- personnes, sessions, interrupteurs ----------------------------------------------------------

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
export const sha = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

/** Personne inscrite par la VRAIE commande (consentements de l'inscription), compte ACTIVE. */
export async function register(
  tx: pg.ClientBase,
  country: string,
  id: string = randomUUID(),
  first = 'Ana',
  last = 'Pérez',
): Promise<string> {
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL,
                                                $8, $9::jsonb, false) AS ok`,
    [
      id,
      `rt222-${id}@example.test`,
      PHC,
      first,
      last,
      randomUUID(),
      randomBytes(32),
      country,
      SIGNUP,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  return id;
}

/** Session ouverte par la VRAIE commande. */
export async function openSession(tx: pg.ClientBase, userId: string): Promise<Buffer> {
  const hash = sha();
  const s = await tx.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, 86400, 'NONE', NULL, 'vitest') AS expires_at`,
    [randomUUID(), userId, hash],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return hash;
}

/** Membre du personnel inscrit, rôle interne du pays (fixture 9200). */
export async function staffMember(
  tx: pg.ClientBase,
  role: string,
  country: string,
): Promise<string> {
  const id = await register(tx, country, randomUUID(), 'Staff', 'Test');
  await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`, [
    randomUUID(),
    id,
    role,
    [country],
  ]);
  return id;
}

/** Session élevée (fixture 9650) ouverte à l'instant de la transaction, contexte STAFF posé. */
export async function asStaff(
  tx: pg.ClientBase,
  id: string,
  country: string,
): Promise<{ id: string; hash: Buffer }> {
  const hash = sha();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, hash]);
  await setSessionContext(tx, {
    kind: 'STAFF',
    actorId: id,
    countryScope: [country],
    sessionTokenHash: hash.toString('hex'),
  });
  return { id, hash };
}

/**
 * Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction ANNULÉE de
 * l'appelant : tête de chaîne d'audit AVANT le verrou consultatif (ordre de golive.ts, PR #200).
 */
export async function openSwitch(tx: pg.ClientBase, key: string, country: string): Promise<void> {
  const requester = await staffMember(tx, 'ADMIN', country);
  const approver = await staffMember(tx, 'SUPERADMIN', country);
  await tx.query('SELECT test_fixture.audit_chain_head_lock()');
  const r1 = await asStaff(tx, requester, country);
  const r = await tx.query<{ outcome: string; request_id: string | null }>(
    'SELECT outcome, request_id FROM core.config_cmd_request_go_live_switch($1, $2, $3, $4, $5, $6)',
    [r1.hash, randomUUID(), key, country, true, 'DEC-FONDATEUR-15'],
  );
  if (r.rows[0]?.outcome !== 'REQUESTED') throw new Error(`demande : ${r.rows[0]?.outcome}`);
  const a1 = await asStaff(tx, approver, country);
  const a = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.config_cmd_approve_go_live_switch($1, $2)',
    [a1.hash, r.rows[0].request_id],
  );
  if (a.rows[0]?.outcome !== 'APPLIED') throw new Error(`approbation : ${a.rows[0]?.outcome}`);
}

/** Valeur lue de chaque interrupteur de mise en service du pays (fail-closed : false). */
export async function switches(
  tx: pg.ClientBase,
  country: string,
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const key of SWITCHES) {
    const { rows } = await tx.query<{ on: boolean }>('SELECT core.config_go_live($1, $2) AS "on"', [
      key,
      country,
    ]);
    out[key] = rows[0]?.on === true;
  }
  return out;
}

/** Capacités bloquantes du catalogue (FAKE, pays) au statut voulu, à partir de `from`. */
export async function capabilities(
  tx: pg.ClientBase,
  country: string,
  from: string,
  only?: string,
  status: 'VALIDATED_SANDBOX' | 'UNKNOWN' = 'VALIDATED_SANDBOX',
): Promise<void> {
  const { rows } = await tx.query<{ capability: string; kind: string }>(
    `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
  );
  for (const r of rows) {
    if (only !== undefined && r.capability !== only) continue;
    const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
    await tx.query(
      `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, $4,
                                                $5::timestamptz)`,
      [country, r.capability, JSON.stringify(value), status, from],
    );
  }
}

// --- opérations de paiement (travailleur payment_command) ----------------------------------------

export interface RecordInput {
  readonly id?: string;
  readonly tripId: string;
  readonly accountId: string;
  readonly kind?: string;
  readonly purpose?: string;
  readonly method?: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly idemPlain?: string;
  /** Jambes telles que l'attaquant les écrit (texte JSON brut accepté pour les formes hostiles). */
  readonly legs: Legs | Json | null;
  readonly settlementId?: string | null;
  readonly settlementVersion?: number | null;
}
const legsJsonOf = (l: Legs | Json | null): string | null => {
  if (l === null) return null;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(l).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
    ),
  );
};
/** `core.payment_cmd_record_operation` (sous payment_command), montants et jambes de l'appelant. */
export async function recordOperation(
  tx: pg.ClientBase,
  r: RecordInput,
): Promise<{ operation_id: string; replayed: boolean }> {
  const id = r.id ?? randomUUID();
  const idem = r.idemPlain ?? `trip:${r.tripId}:${r.kind ?? 'CAPTURE'}:${id}`;
  const { rows } = await tx.query<{ operation_id: string; replayed: boolean }>(
    `SELECT operation_id, replayed
       FROM core.payment_cmd_record_operation($1, NULL, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9,
                                              $10::jsonb, $11::uuid, $12::integer)`,
    [
      id,
      r.tripId,
      r.accountId,
      r.method ?? 'CARD',
      r.kind ?? 'CAPTURE',
      r.purpose ?? 'RENT',
      r.amountMinor.toString(),
      r.currency,
      idem,
      legsJsonOf(r.legs),
      r.settlementId ?? null,
      r.settlementVersion ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('record_operation sans résultat');
  return row;
}

/** Statut appliqué par la VRAIE commande, preuve signée de la fixture 9940 (webhook reçu). */
export async function signedStatus(
  tx: pg.ClientBase,
  operationId: string,
  status: 'SUCCEEDED' | 'FAILED',
): Promise<string> {
  const { rows } = await tx.query<{ o: string }>(
    `SELECT core.payment_cmd_apply_operation_status($1, $2, 'WEBHOOK',
              test_fixture.us049_signed_webhook($1, $2), NULL) AS o`,
    [operationId, status],
  );
  return rows[0]?.o ?? '';
}

/** Soldes par jambe du trip (segment 1), sous payment_command, dans la transaction donnée. */
export async function balancesIn(
  tx: pg.ClientBase,
  trip: string,
): Promise<{ captured: Legs; refunded: Legs }> {
  const { rows } = await tx.query<{ leg: LegName; captured: string; refunded: string }>(
    `SELECT leg, captured_minor::text AS captured, refunded_minor::text AS refunded
       FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const pick = (f: 'captured' | 'refunded'): Legs => {
    const out: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
    for (const r of rows) out[r.leg] = BigInt(r[f]);
    return out;
  };
  return { captured: pick('captured'), refunded: pick('refunded') };
}

/**
 * Trip capturé aux jambes de la capture de l'oracle, dans la transaction de l'appelant (déjà sous
 * payment_command) : trip de fixture, compte FAKE ACTIVE du pays (fixture 9800, réutilisé), capture
 * enregistrée par la VRAIE commande, preuve signée, report sur les soldes.
 */
export async function capturedTripIn(
  tx: pg.ClientBase,
  c: Case,
  startMs: number,
  days: number,
): Promise<{ trip: string; guest: string; account: string; capture: string }> {
  const trip = randomUUID();
  const guest = randomUUID();
  const capture = legsOf(c.journey.capture);
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
    trip,
    guest,
    randomUUID(),
    randomUUID(),
    c.country,
    c.currency,
    iso(startMs),
    iso(startMs + days * DAY),
  ]);
  const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
    c.country,
  ]);
  const account = a.rows[0]?.id;
  if (account === undefined) throw new Error('compte FAKE du pays introuvable');
  const op = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    amountMinor: sum(capture),
    currency: c.currency,
    legs: capture,
  });
  expect(await signedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [op.operation_id],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
  return { trip, guest, account, capture: op.operation_id };
}

// --- invariant par jambe (US-217, rapprochement FIN, oracle C12) ---------------------------------

export interface TripFacts {
  readonly captured: string;
  readonly collected: string | null;
  readonly collected_legs: string | null;
}

/**
 * Invariant par jambe, dans la transaction de l'appelant (sous app_worker ; l'état de l'attaque,
 * validé ou non, est donc lu) : faits de chaque trip touché (Σ capturé = Σ encaissé = Σ jambes des
 * encaissements = `expectCaptured`), puis TOUS les contrôles FIN du rapprochement nocturne et
 * l'oracle C12 sur toute la base : 0 écart ; interrupteurs du pays fermés.
 */
export async function invariantIn(
  tx: pg.ClientBase,
  country: string,
  trips: readonly { trip: string; captured: bigint }[],
): Promise<void> {
  await asWorker(tx, 'reconciliation');
  for (const t of trips) {
    const { rows } = await tx.query<TripFacts>(
      `SELECT captured_minor::text AS captured, collected_minor::text AS collected,
              collected_legs_minor::text AS collected_legs
         FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`,
      [t.trip],
    );
    expect(rows, `faits du trip ${t.trip}`).toEqual([
      {
        captured: t.captured.toString(),
        collected: t.captured.toString(),
        collected_legs: t.captured.toString(),
      },
    ]);
  }
  const report = await runMoneyReconciliation(sqlOf(tx));
  const json = reconciliationReportJson(report);
  expect(json.violations, JSON.stringify(json.checks)).toBe('0');
  await asWorker(tx, 'booking_oracle');
  const c12 = await tx.query<{ check_code: string; violations: string }>(
    'SELECT check_code, violations::text AS violations FROM core.booking_production_oracle()',
  );
  expect(c12.rows.length).toBeGreaterThan(0);
  for (const r of c12.rows) expect(r.violations, r.check_code).toBe('0');
  expect(await switches(tx, country)).toEqual(ALL_CLOSED);
}

/** Invariant par jambe sur une connexion app_worker neuve (transaction annulée). */
export async function invariant(
  country: string,
  trips: readonly { trip: string; captured: bigint }[] = [],
): Promise<void> {
  const worker = await open('app_worker');
  await inTx(worker, {}, (tx) => invariantIn(tx, country, trips));
}
