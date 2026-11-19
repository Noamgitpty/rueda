/**
 * US-224, durcissement argent n° 2 (migration 0152, BOARD N-364 et N-365, ADR-166 n° 7) — la
 * marque de l'alerte FIN et l'attente du choix du rail (SM-8 `FAILED → PENDING_CUSTOMER_CHOICE`)
 * contre la supersession d'une version du règlement, sur DEUX connexions réelles (une connexion par
 * client, plus une connexion d'observation en lecture seule, toutes libérées).
 *
 * Ordre d'acquisition des verrous (documenté, prouvé ici) :
 * - supersession (`core.settlement_cmd_record` v2, travailleur `settlement`) : TRIP (`FOR UPDATE`)
 *   puis LIGNES des instances (`payment_refund_instance_supersede`) ;
 * - attente du choix (`core.payment_cmd_refund_await_choice`) : TRIP puis LIGNE de l'instance ;
 * - marque de l'alerte (`core.payment_cmd_refund_mark_alerted`, 0152) : TRIP puis LIGNE de
 *   l'instance (avant 0152 : la ligne seule, d'où le cycle instance → trip contre trip → instance
 *   quand l'ordonnanceur marquait AVANT d'attendre le choix : `40P01`, N-364) ;
 * - l'ordonnanceur appelle l'attente du choix, PUIS la marque (refund-scheduler.ts).
 * Les deux scénarios : (1) la marque d'abord (l'ancien ordre de l'ordonnanceur, celui qui
 * s'interbloquait), la supersession attend le TRIP, puis l'attente du choix passe sans attendre ;
 * (2) la supersession d'abord, l'attente du choix de l'ordonnanceur attend le TRIP, puis relit
 * l'instance remplacée (`SUPERSEDED`) et la marque passe. Aucune des deux sessions ne reçoit
 * `40P01` ; l'attente est OBSERVÉE (pg_stat_activity : `wait_event_type` = `Lock`), jamais supposée
 * par un délai (`deadlock_timeout` du banc : BENCH_DEADLOCK_TIMEOUT).
 *
 * Fichier ISOLÉ (`vitest.l0.config.ts`, projet `l0-concurrence`) : mise en place VALIDÉE (COMMIT) sur
 * le compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800). Sous app_worker
 * (rôle de PRODUCTION, assertion L0-05 : withRole / connectAs), en USD (PA) et en PYG (PY).
 * Attendus : export des oracles (TJ01 / TJ02b / T03, TJ08a / TJ08b / T27, T08) et 08 SM-8, E4
 * (`attempt_no` + 1 sur la seule reprise d'un rejet confirmé) ; jamais le code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  applyStatus,
  insertTrip,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import {
  callRecord,
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';
import { settlementRecordPayload } from '@rueda/money';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;

/** Vecteurs par devise (jamais par pays). */
const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};

interface Failed {
  readonly trip: string;
  readonly v1: string;
  readonly instance: string;
}

/**
 * Mise en place VALIDÉE : trip capturé (jambes du vecteur), règlement v1, instance de remboursement
 * planifiée, envoi autorisé, issue inconnue puis rejet CONFIRMÉ (webhook signé) : instance `FAILED`,
 * `attempt_no` 1, aucune alerte posée.
 */
async function failedRefund(c: CountryCase): Promise<Failed> {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture: Legs = { ...legVector(golden, r.capture).legsMinor };
  const refund = negate({ ...legVector(golden, r.variation).legsMinor });
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
      const trip = await insertTrip(tx, c);
      // compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800)
      const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
        c.country,
      ]);
      const account = a.rows[0]?.id ?? '';
      const { operation_id: cap } = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        kind: 'CAPTURE',
        amountMinor: sum(capture),
        currency: c.currency,
        idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
        legs: capture,
      });
      expect(await applySignedStatus(tx, cap, 'SUCCEEDED')).toBe('APPLIED');
      await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [cap]);
      const v1 = await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 1 },
        recordOfVector(r.settlement),
      );
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      const idem = `${trip}:seg:v1:REFUND:${cap}:i1:a1:${uuid()}`;
      const { rows: planned } = await tx.query<{ instance_id: string; operation_id: string }>(
        `SELECT instance_id, operation_id
           FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
        [uuid(), uuid(), v1, cap, legsJson(refund), idem],
      );
      const p = planned[0];
      if (p === undefined) throw new Error('plan_refund sans résultat');
      const { rows: submitted } = await tx.query<{ outcome: string }>(
        'SELECT outcome FROM core.payment_cmd_submit_refund($1)',
        [p.instance_id],
      );
      expect(submitted[0]?.outcome).toBe('SUBMITTED');
      expect(await applyStatus(tx, p.operation_id, 'UNKNOWN', 'API_RESPONSE')).toBe('APPLIED');
      expect(await applySignedStatus(tx, p.operation_id, 'FAILED')).toBe('APPLIED');
      return { trip, v1, instance: p.instance_id };
    }),
  );
}

async function instanceOf(id: string): Promise<{ status: string; attempt_no: number }> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command' }, async (tx) => {
      const { rows } = await tx.query<{ status: string; attempt_no: number }>(
        'SELECT status, attempt_no FROM core.payment_refund_instance WHERE id = $1',
        [id],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('instance introuvable');
      return row;
    }),
  );
}

/** La marque est posée : la reposer ne change rien (FALSE), dans une transaction annulée. */
async function alreadyMarked(id: string): Promise<boolean> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command' }, async (tx) => {
      const { rows } = await tx.query<{ changed: boolean }>(
        `SELECT core.payment_cmd_refund_mark_alerted($1, 'FAILED') AS changed`,
        [id],
      );
      return rows[0]?.changed === false;
    }),
  );
}

type Settled = { ok: true } | { ok: false; err: { code?: string; constraint?: string } };
const settled = (p: Promise<unknown>): Promise<Settled> =>
  p.then(
    () => ({ ok: true as const }),
    (e: unknown) => ({ ok: false as const, err: e as { code?: string; constraint?: string } }),
  );

async function begin(client: pg.Client, worker: string): Promise<number> {
  await client.query('BEGIN');
  await setSessionContext(client, { kind: 'WORKER', workerName: worker });
  const { rows } = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
  return rows[0]?.pid ?? -1;
}

/** Attend que la session `pid` soit BLOQUÉE sur un verrou ; échoue après 10 s. */
async function waitUntilLocked(observer: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await observer.query<{ wait: string | null }>(
      'SELECT wait_event_type AS wait FROM pg_catalog.pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (rows[0]?.wait === 'Lock') return;
    if (Date.now() > deadline)
      throw new Error(`session ${String(pid)} jamais bloquée sur un verrou`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Deux connexions concurrentes et une d'observation ; toujours annulées puis libérées. */
async function withThree<T>(
  fn: (pay: pg.Client, stl: pg.Client, observer: pg.Client) => Promise<T>,
): Promise<T> {
  const pay = await connectAs('app_worker');
  const stl = await connectAs('app_worker');
  const observer = await connectAs('app_worker');
  try {
    return await fn(pay, stl, observer);
  } finally {
    for (const client of [pay, stl]) {
      await client.query('ROLLBACK').catch(() => undefined);
      await releaseClient(client);
    }
    await releaseClient(observer);
  }
}

/** Version 2 (motif FULL, T08) qui remplace v1, enregistrée sur la connexion `stl` (sans COMMIT). */
const supersede = (stl: pg.Client, c: CountryCase, f: Failed): Promise<string> => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const r1 = recordOfVector(r.settlement);
  return callRecord(
    stl,
    { tripId: f.trip, version: 2, supersedesId: f.v1 },
    settlementRecordPayload(recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1)),
  );
};

const markAlerted = async (pay: pg.Client, id: string): Promise<boolean> => {
  const { rows } = await pay.query<{ changed: boolean }>(
    `SELECT core.payment_cmd_refund_mark_alerted($1, 'FAILED') AS changed`,
    [id],
  );
  return rows[0]?.changed === true;
};

const awaitChoice = async (pay: pg.Client, id: string): Promise<string> => {
  const { rows } = await pay.query<{ outcome: string }>(
    'SELECT core.payment_cmd_refund_await_choice($1) AS outcome',
    [id],
  );
  return rows[0]?.outcome ?? '';
};

describe.each(COUNTRIES)(
  'US-224 (N-364) — marque de l’alerte et attente du choix contre la supersession, deux connexions — $country ($currency)',
  (c) => {
    it('(1) marque d’abord (ancien ordre) : la supersession attend le TRIP tenu par la marque ; l’attente du choix passe sans attendre ; aucun 40P01 ; la version 2 remplace ensuite l’instance', async () => {
      const f = await failedRefund(c);
      expect(await instanceOf(f.instance)).toEqual({ status: 'FAILED', attempt_no: 1 });
      await withThree(async (pay, stl, observer) => {
        await begin(pay, 'payment_command');
        const stlPid = await begin(stl, 'settlement');
        // pay : TRIP puis LIGNE de l'instance (0152)
        expect(await markAlerted(pay, f.instance)).toBe(true);
        // stl : attend le TRIP (avant 0152 : prenait le trip, puis attendait la ligne de l'instance)
        const racing = settled(supersede(stl, c, f));
        await waitUntilLocked(observer, stlPid);
        // pay tient déjà le trip : l'attente du choix ne forme aucun cycle (avant 0152 : 40P01)
        expect(await awaitChoice(pay, f.instance)).toBe('AWAITING_CHOICE');
        await pay.query('COMMIT');
        expect(await racing).toEqual({ ok: true });
        await stl.query('COMMIT');
      });
      // 08 SM-8 : PENDING_CUSTOMER_CHOICE (attempt_no 2), puis remplacée par la version 2
      expect(await instanceOf(f.instance)).toEqual({ status: 'SUPERSEDED', attempt_no: 2 });
      expect(await alreadyMarked(f.instance)).toBe(true);
    });

    it('(2) supersession d’abord, ordre de l’ordonnanceur (attente du choix puis marque) : l’attente du choix attend le TRIP, relit l’instance remplacée (SUPERSEDED) ; la marque passe ; aucun 40P01', async () => {
      const f = await failedRefund(c);
      await withThree(async (pay, stl, observer) => {
        await begin(stl, 'settlement');
        const payPid = await begin(pay, 'payment_command');
        // stl : TRIP puis LIGNES des instances (FAILED ⇒ SUPERSEDED), sans COMMIT
        await supersede(stl, c, f);
        const choice = pay
          .query<{ outcome: string }>(
            'SELECT core.payment_cmd_refund_await_choice($1) AS outcome',
            [f.instance],
          )
          .then((res) => res.rows[0]?.outcome ?? '');
        await waitUntilLocked(observer, payPid);
        await stl.query('COMMIT');
        // relu sous le verrou du trip : remplacée, aucune nouvelle tentative (attempt_no inchangé)
        expect(await choice).toBe('SUPERSEDED');
        expect(await markAlerted(pay, f.instance)).toBe(true);
        await pay.query('COMMIT');
      });
      expect(await instanceOf(f.instance)).toEqual({ status: 'SUPERSEDED', attempt_no: 1 });
      expect(await alreadyMarked(f.instance)).toBe(true);
    });
  },
);
