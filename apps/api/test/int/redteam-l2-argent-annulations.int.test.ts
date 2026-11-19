/**
 * US-222b — red team argent du lot 2, axe « annulations et remboursements » (19 US-222 critère 2,
 * scénarios 5 « double annulation simultanée », 6 « double remboursement », 7 « ventilation au
 * prorata » au remboursement ; pré-mortem L2 : RT-L2-M04, M06, M07, M14 ; risques L2-PM-01,
 * L2-PM-04, L2-PM-05, L2-PM-16). Rapport : docs/team/redteam/L2-argent.md.
 *
 * Joué en CI contre le PSP `FAKE`, sous les rôles de PRODUCTION (`connectAs` : L0-05), en USD (PA)
 * et en PYG (PY), avec les VRAIS services : demande de la console (`iam_staff_cmd_manual_action`),
 * `TripCancellationProcessor`, `RefundScheduler`, adaptateur FAKE du port. Concurrence RÉELLE : deux
 * connexions, l'attente de la seconde sur un verrou est OBSERVÉE (pg_stat_activity) avant que la
 * première ne valide ; toutes les connexions sont libérées après chaque test. Données VALIDÉES
 * (comme le parcours doré US-221, horloge virtuelle 2053, un trip et un véhicule propres à chaque
 * monde) ; les attaques qui écriraient hors de la règle sont jouées dans des transactions ANNULÉES.
 * Après chaque scénario : invariant par jambe (faits du rapprochement, contrôles FIN, oracle C12).
 *
 * Attendus : vecteurs T03 / TJ01 / TJ02b (USD) et T27 / TJ08a / TJ08b (PYG) de l'export des
 * oracles ; contre-exemple au prorata (méthode de TJ10c, `check_legs.py`) ; codes de 0121, 0124,
 * 0152 et d'ADR-150 ; jamais le code testé.
 */
import { randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { settlementVector } from '@rueda/money/golden-vectors';
import { toTrip } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { AlertChannel, OpsAlert } from '../../src/modules/bus/index.js';
import {
  RefundScheduler,
  TripCancellationProcessor,
  type CancellationFacts,
} from '../../src/modules/stl/index.js';
import {
  PaymentError,
  PgRefundOrders,
  type DueRefund,
  type OperationResult,
  type PaymentConnectorRegistry,
  type PaymentProvider,
  type ProviderOperation,
  type RefundRequest,
} from '../../src/modules/pay/index.js';
import {
  CASES,
  DAY,
  MINUTE,
  TestTransactions,
  asStaff,
  capturedTripIn,
  gate,
  golden,
  inTx,
  invariant,
  invariantIn,
  iso,
  legsOf,
  lockedOrDone,
  negate,
  open,
  recordOperation,
  refused,
  signedStatus,
  sqlOf,
  staffMember,
  sum,
  type Case,
  type LegName,
  type Legs,
} from '../support/redteam-l2.js';

class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    this.sent.push(alert);
    return Promise.resolve();
  }
}
const registry = (p: unknown): PaymentConnectorRegistry => ({
  get: (provider) => (provider === 'FAKE' ? (p as PaymentProvider) : undefined),
});

/**
 * PSP de remboursement enregistreur : capacités déclarées (montant par jambe, en-tête
 * d'idempotence, recherche par notre clé), garde chaque ordre reçu ; `getOperation` rend l'ordre
 * déjà reçu (PENDING), jamais un second envoi (17 §2.8, T51).
 */
class RecordingRefundPsp {
  readonly refunds: RefundRequest[] = [];
  readonly lookups: number[] = [];
  capabilities() {
    return {
      bool: (name: string) =>
        name === 'SUPPORTS_IDEMPOTENCY_HEADER' ||
        name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF' ||
        name === 'SUPPORTS_PER_LEG_AMOUNTS' ||
        name === 'SUPPORTS_REFUND',
    };
  }
  refund(req: RefundRequest): Promise<OperationResult> {
    this.refunds.push(req);
    return Promise.resolve({ providerReference: `psp-${randomUUID()}`, status: 'PENDING' });
  }
  getOperation(q: { merchantReference?: string }): Promise<ProviderOperation | null> {
    this.lookups.push(1);
    const r = this.refunds.find((x) => x.idempotencyKey === q.merchantReference);
    return Promise.resolve(
      r === undefined
        ? null
        : {
            providerReference: `psp-${r.idempotencyKey.slice(0, 8)}`,
            merchantReference: r.idempotencyKey,
            status: 'PENDING',
            amountMinor: r.amountMinor,
            currency: r.currency,
            legs: r.legs,
          },
    );
  }
}

interface World {
  trip: string;
  guest: string;
  capture: string;
  account: string;
  cancellation?: string;
  settlement?: string;
  refundOp?: string;
}

describe.each(CASES)(
  'RT-L2-ARG — annulations et remboursements ($country, $currency)',
  (c: Case) => {
    const capture = legsOf(c.journey.capture);
    const variation = legsOf(c.journey.variation);
    const refund = negate(variation);
    const total = sum(capture);
    const prorata = c.journey.prorata as Legs;
    const vector = settlementVector(golden, c.journey.settlement);
    const REQUESTED_AT_MS = Date.UTC(2053, 7, 14, 12, 0, 0) + c.index * 7 * DAY;
    const tripOf = (f: CancellationFacts): ReturnType<typeof toTrip> => ({
      ...toTrip(vector.trip),
      startAtMs: f.startAtMs,
      bookedAtMs: f.bookedAtMs,
    });
    const w: Partial<World> = {};
    const world = (): World => {
      if (w.cancellation === undefined) throw new Error('étape précédente en échec : aucun monde');
      return w as World;
    };

    /** Lecture sous un travailleur (transaction annulée). */
    const read = async <R extends pg.QueryResultRow>(
      worker: string,
      sql: string,
      params: unknown[],
    ): Promise<R[]> => {
      const client = await open('app_worker');
      return inTx(client, { worker }, async (tx) => (await tx.query<R>(sql, params)).rows);
    };
    const refundOrders = async (trip: string) =>
      read<{ id: string; status: string; leg: LegName; v: string }>(
        'payment_command',
        `SELECT o.id, o.status, l.leg, l.amount_minor::text AS v
         FROM core.payment_payment_operation AS o
         JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
        WHERE o.trip_id = $1 AND o.kind = 'REFUND'`,
        [trip],
      );
    const dueOf = async (trip: string): Promise<{ status: string; due: DueRefund | undefined }> => {
      const client = await open('app_worker');
      return inTx(client, { worker: 'payment_command' }, async (tx) => {
        const all = await new PgRefundOrders(sqlOf(tx)).due(500);
        const inst = await tx.query<{ id: string; status: string }>(
          'SELECT id, status FROM core.payment_refund_instance WHERE trip_id = $1',
          [trip],
        );
        expect(inst.rows).toHaveLength(1);
        const i = inst.rows[0]!;
        return { status: i.status, due: all.find((d) => d.instanceId === i.id) };
      });
    };

    /** Demande de la console sur une connexion app_api dans une transaction ouverte par l'appelant. */
    const SQL_ACT = `SELECT outcome, detail, domain_ref
       FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, '{}'::uuid[])`;
    const begin = async (
      client: pg.Client,
      staff: string,
    ): Promise<{ hash: Buffer; pid: number }> => {
      await client.query('BEGIN');
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        iso(REQUESTED_AT_MS),
      ]);
      const s = await asStaff(client, staff, c.country);
      const p = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
      return { hash: s.hash, pid: p.rows[0]?.pid ?? -1 };
    };
    const act = (
      client: pg.ClientBase,
      hash: Buffer,
      action: string,
      trip: string,
      input: Record<string, unknown> = {},
    ) =>
      client
        .query<{ outcome: string; detail: string | null; domain_ref: string | null }>(SQL_ACT, [
          hash,
          randomUUID(),
          action,
          trip,
          'Red team US-222b : demande de la console',
          JSON.stringify(input),
        ])
        .then((r) => r.rows[0]);

    it('S5 : double annulation simultanée (deux agents OPS, deux connexions, attente observée) ⇒ une seule demande, la seconde CANCELLATION_PENDING ; deux processeurs concurrents (attente observée) ⇒ SETTLED une fois, l’autre SKIPPED ; un règlement, un seul ordre REFUND aux jambes EXPLICITES de l’oracle ; invariant par jambe', async () => {
      const start = REQUESTED_AT_MS - (vector.event.requestedAtMinutes ?? 0) * MINUTE;
      const bookedAt = start + vector.trip.bookedAtMinutes * MINUTE;
      const worker = await open('app_worker');
      const made = await inTx(
        worker,
        { worker: 'payment_command', at: iso(bookedAt), commit: true },
        (tx) => capturedTripIn(tx, c, start, vector.trip.days),
      );
      Object.assign(w, made);
      const api = await open('app_api');
      const [opsA, opsB] = await inTx(api, { commit: true }, async (tx) => [
        await staffMember(tx, 'OPS_AGENT', c.country),
        await staffMember(tx, 'OPS_AGENT', c.country),
      ]);

      const a = await open('app_api');
      const b = await open('app_api');
      const observer = await open('app_api');
      const sa = await begin(a, opsA);
      const sb = await begin(b, opsB);
      const first = await act(a, sa.hash, 'CANCEL_TRIP_GUEST', made.trip);
      expect(first?.outcome).toBe('DONE');
      let bDone = false;
      const second = act(b, sb.hash, 'CANCEL_TRIP_HOST', made.trip).finally(() => {
        bDone = true;
      });
      expect(
        await lockedOrDone(
          observer,
          () => [sb.pid],
          () => bDone,
        ),
      ).toBe('LOCKED');
      await a.query('COMMIT');
      expect(await second).toMatchObject({ outcome: 'REFUSED', detail: 'CANCELLATION_PENDING' });
      await b.query('COMMIT');
      w.cancellation = String(first?.domain_ref);

      // deux processeurs : A garde ses verrous jusqu'à l'ouverture de la porte, B attend
      const g = gate();
      const txA = new TestTransactions(REQUESTED_AT_MS + MINUTE, g.wait);
      const txB = new TestTransactions(REQUESTED_AT_MS + MINUTE);
      const alerts = new Alerts();
      const pA = new TripCancellationProcessor({ transactions: txA, alerts, tripOf });
      const pB = new TripCancellationProcessor({ transactions: txB, alerts, tripOf });
      const runA = pA.process(w.cancellation);
      await Promise.race([txA.reached, runA]);
      let pBDone = false;
      const runB = pB.process(w.cancellation).finally(() => {
        pBDone = true;
      });
      const wobs = await open('app_worker');
      let seen: 'LOCKED' | 'DONE';
      try {
        seen = await lockedOrDone(
          wobs,
          () => txB.pids,
          () => pBDone,
        );
      } finally {
        g.open();
      }
      expect(await runA).toEqual({ outcome: 'SETTLED', costBearer: 'GUEST', orders: 1 });
      expect(await runB).toEqual({ outcome: 'SKIPPED' });
      expect(seen).toBe('LOCKED');
      expect(alerts.sent).toEqual([]);

      const row = await read<{ status: string; settlement_id: string | null }>(
        'settlement',
        'SELECT status, settlement_id FROM test_fixture.us215_cancellation($1)',
        [w.cancellation],
      );
      expect(row[0]?.status).toBe('SETTLED');
      w.settlement = row[0]!.settlement_id!;
      const legs = await read<{ leg: LegName; v: string }>(
        'settlement',
        `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
        WHERE settlement_id = $1`,
        [w.settlement],
      );
      expect(Object.fromEntries(legs.map((r) => [r.leg, BigInt(r.v)]))).toEqual(variation);
      const orders = await refundOrders(made.trip);
      expect(new Set(orders.map((o) => o.id)).size).toBe(1);
      expect(Object.fromEntries(orders.map((r) => [r.leg, BigInt(r.v)]))).toEqual(refund);
      expect(Object.fromEntries(orders.map((r) => [r.leg, BigInt(r.v)]))).not.toEqual(prorata);
      w.refundOp = orders[0]!.id;
      await invariant(c.country, [{ trip: made.trip, captured: total }]);
    });

    it('S7 : PSP sans montant par jambe (capacité SUPPORTS_PER_LEG_AMOUNTS non validée) ⇒ remboursement refusé (UNSUPPORTED_CAPABILITY, revue FIN), rien n’est émis, l’instance reste PLANNED ; ordre au prorata (TJ10c) refusé en base, montants explicites acceptés ; invariant par jambe', async () => {
      const x = world();
      const planned = await dueOf(x.trip);
      expect(planned.status).toBe('PLANNED');
      if (planned.due === undefined) throw new Error('remboursement absent de la file');
      // connecteur qui applique le contrat du port comme l'adaptateur FAKE réel (prouvé sans base
      // par pay/testing/redteam/l2-argent-adaptateur.test.ts) : capacité non validée ⇒
      // UNSUPPORTED_CAPABILITY sans appel au PSP
      let calls = 0;
      const noPerLeg = {
        capabilities: () => ({
          bool: (name: string) =>
            name === 'SUPPORTS_IDEMPOTENCY_HEADER' || name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF',
        }),
        refund: (): Promise<OperationResult> => {
          calls++;
          return Promise.reject(
            new PaymentError('UNSUPPORTED_CAPABILITY', 'SUPPORTS_PER_LEG_AMOUNTS non validée'),
          );
        },
      };
      const alerts = new Alerts();
      const out = await new RefundScheduler({
        transactions: new TestTransactions(REQUESTED_AT_MS + 2 * MINUTE),
        alerts,
        connectors: registry(noPerLeg),
      }).process(planned.due);
      expect(out).toMatchObject({
        step: 'ATTENTION',
        alert: { code: 'FIN_REFUND_FAILED', errorCode: 'UNSUPPORTED_CAPABILITY' },
      });
      expect(calls).toBe(1);
      // transaction de l'envoi annulée : rien d'émis, l'instance reste PLANNED, l'ordre PENDING
      expect((await dueOf(x.trip)).status).toBe('PLANNED');
      const still = await refundOrders(x.trip);
      expect(new Set(still.map((o) => o.status))).toEqual(new Set(['PENDING']));

      // en base : ordre au prorata (somme juste, jambes fausses) refusé ; montants explicites admis
      const worker = await open('app_worker');
      await inTx(
        worker,
        { worker: 'payment_command', at: iso(REQUESTED_AT_MS + 2 * MINUTE) },
        async (tx) => {
          expect(sum(prorata)).toBe(sum(variation));
          await tx.query('SAVEPOINT rt_l2_prorata');
          // l'ordre du processeur est d'abord mis en échec (preuve signée FAILED) : seul l'ordre
          // de l'attaquant est jugé par la garde
          expect(await signedStatus(tx, x.refundOp!, 'FAILED')).toBe('APPLIED');
          const order = (legs: Legs) =>
            recordOperation(tx, {
              tripId: x.trip,
              accountId: x.account,
              kind: 'REFUND',
              amountMinor: sum(legs),
              currency: c.currency,
              legs,
              settlementId: x.settlement!,
              settlementVersion: 1,
            });
          expect(await refused(tx, () => order(negate(prorata)))).toEqual({
            code: '55000',
            constraint: 'leg_refund_exceeds_settlement',
          });
          expect((await order(refund)).replayed).toBe(false);
          await tx.query('ROLLBACK TO SAVEPOINT rt_l2_prorata');
          await invariantIn(tx, c.country, [{ trip: x.trip, captured: total }]);
        },
      );
    });

    it('S6 : double remboursement : second ordre du même règlement (nouvelle clé) ⇒ refusé, remboursement > encaissé ⇒ refusé ; deux ordonnanceurs concurrents (attente observée) ⇒ un seul envoi au PSP, l’autre DUPLICATE ; rejeu d’un ordre en vol ⇒ lecture d’abord, aucun second envoi (L2-PM-01) ; preuve signée, report une fois, second report DUPLICATE ; soldes = capture − remboursement de l’oracle ; invariant par jambe', async () => {
      const x = world();
      // en base, transaction annulée
      const worker = await open('app_worker');
      await inTx(
        worker,
        { worker: 'payment_command', at: iso(REQUESTED_AT_MS + 3 * MINUTE) },
        async (tx) => {
          const order = (legs: Legs) =>
            recordOperation(tx, {
              tripId: x.trip,
              accountId: x.account,
              kind: 'REFUND',
              amountMinor: sum(legs),
              currency: c.currency,
              legs,
              settlementId: x.settlement!,
              settlementVersion: 1,
            });
          for (const legs of [refund, capture]) {
            const e = await refused(tx, () => order(legs));
            expect(e?.code, JSON.stringify(Object.values(legs).map(String))).toBe('55000');
            expect(['refund_exceeds_collected', 'leg_refund_exceeds_settlement']).toContain(
              e?.constraint,
            );
          }
          // remboursement sans règlement : refusé
          expect(
            await refused(tx, () =>
              recordOperation(tx, {
                tripId: x.trip,
                accountId: x.account,
                kind: 'REFUND',
                amountMinor: sum(refund),
                currency: c.currency,
                legs: refund,
              }),
            ),
          ).toEqual({ code: '55000', constraint: 'leg_refund_without_settlement' });
          await invariantIn(tx, c.country, [{ trip: x.trip, captured: total }]);
        },
      );

      // deux ordonnanceurs : A garde les verrous du trip PENDANT l'appel au PSP, B attend
      const planned = await dueOf(x.trip);
      expect(planned.status).toBe('PLANNED');
      if (planned.due === undefined) throw new Error('remboursement absent de la file');
      const recording = new RecordingRefundPsp();
      const g = gate();
      const txA = new TestTransactions(REQUESTED_AT_MS + 4 * MINUTE, g.wait);
      const txB = new TestTransactions(REQUESTED_AT_MS + 4 * MINUTE);
      const alerts = new Alerts();
      const sA = new RefundScheduler({
        transactions: txA,
        alerts,
        connectors: registry(recording),
      });
      const sB = new RefundScheduler({
        transactions: txB,
        alerts,
        connectors: registry(recording),
      });
      const runA = sA.process(planned.due);
      await Promise.race([txA.reached, runA]);
      let bDone = false;
      const runB = sB.process(planned.due).finally(() => {
        bDone = true;
      });
      const wobs = await open('app_worker');
      let seen: 'LOCKED' | 'DONE';
      try {
        seen = await lockedOrDone(
          wobs,
          () => txB.pids,
          () => bDone,
        );
      } finally {
        g.open();
      }
      expect(await runA).toEqual({ step: 'SENT' });
      expect(await runB).toEqual({ step: 'DUPLICATE' });
      expect(seen).toBe('LOCKED');
      expect(recording.refunds).toHaveLength(1);
      expect(recording.refunds[0]).toMatchObject({
        amountMinor: sum(refund),
        currency: c.currency,
      });
      expect({ ...recording.refunds[0]!.legs }).toEqual(refund);
      expect({ ...recording.refunds[0]!.legs }).not.toEqual(negate(prorata));

      // rejeu d'un ordre en vol (SENT) : lecture d'abord, la même clé, aucun second envoi
      const sent = await dueOf(x.trip);
      expect(sent.status).toBe('SENT');
      if (sent.due === undefined) throw new Error('remboursement en vol absent de la file');
      const again = new RefundScheduler({
        transactions: new TestTransactions(REQUESTED_AT_MS + 5 * MINUTE),
        alerts,
        connectors: registry(recording),
      });
      expect((await again.process(sent.due)).step).toBe('SENT');
      expect(recording.lookups.length).toBeGreaterThanOrEqual(1);
      expect(recording.refunds).toHaveLength(1);

      // preuve signée ⇒ CONFIRMED ; report une fois ; second report DUPLICATE
      await new TestTransactions(REQUESTED_AT_MS + 6 * MINUTE).run('webhook_ingest', async (db) => {
        const r = await db.query<{ o: string }>(
          `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                  test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS o`,
          [x.refundOp],
        );
        expect(r.rows[0]?.o).toBe('APPLIED');
      });
      const confirmed = await dueOf(x.trip);
      expect(confirmed.status).toBe('CONFIRMED');
      if (confirmed.due === undefined) throw new Error('remboursement prouvé absent de la file');
      expect(await again.process(confirmed.due)).toEqual({ step: 'REPORTED' });
      expect(await again.process(confirmed.due)).toEqual({ step: 'DUPLICATE' });
      expect(recording.refunds).toHaveLength(1);
      expect(alerts.sent).toEqual([]);

      const bal = await read<{ leg: LegName; captured: string; refunded: string }>(
        'payment_command',
        `SELECT leg, captured_minor::text AS captured, refunded_minor::text AS refunded
         FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
        [x.trip],
      );
      const pick = (f: 'captured' | 'refunded') =>
        Object.fromEntries(bal.map((r) => [r.leg, BigInt(r[f])]));
      expect(pick('captured')).toEqual(capture);
      expect(pick('refunded')).toEqual(refund);
      await invariant(c.country, [{ trip: x.trip, captured: total }]);
    });

    it('L2-PM-16 : annulation de la console avec un montant saisi par l’ops ⇒ 22023 ; motif plateforme absent ⇒ CANCEL_REASON_REQUIRED ; motif plateforme accompagné d’un montant ⇒ 22023 ; rien n’est écrit ; invariant par jambe', async () => {
      const start = REQUESTED_AT_MS + 20 * DAY;
      const worker = await open('app_worker');
      const made = await inTx(
        worker,
        { worker: 'payment_command', at: iso(REQUESTED_AT_MS), commit: true },
        (tx) => capturedTripIn(tx, c, start, 3),
      );
      const api = await open('app_api');
      const ops = await inTx(api, { commit: true }, (tx) =>
        staffMember(tx, 'OPS_AGENT', c.country),
      );
      const attempt = (action: string, input: Record<string, unknown>) =>
        inTx(api, { at: iso(REQUESTED_AT_MS + MINUTE) }, async (tx) => {
          const s = await asStaff(tx, ops, c.country);
          return act(tx, s.hash, action, made.trip, input);
        });
      for (const [action, input] of [
        ['CANCEL_TRIP_GUEST', { refundMinor: total.toString() }],
        ['CANCEL_TRIP_HOST', { hostPenaltyMinor: '0' }],
        [
          'CANCEL_TRIP_PLATFORM',
          { platformReason: 'PLATFORM_TRUST_SAFETY', amount: total.toString() },
        ],
      ] as const) {
        await expect(
          attempt(action, input),
          `${action} ${JSON.stringify(input)}`,
        ).rejects.toMatchObject({ code: '22023' });
      }
      expect(await attempt('CANCEL_TRIP_PLATFORM', {})).toMatchObject({
        outcome: 'REFUSED',
        detail: 'CANCEL_REASON_REQUIRED',
      });
      const balances = await read<{ n: number }>(
        'payment_command',
        `SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation
        WHERE trip_id = $1 AND kind = 'REFUND'`,
        [made.trip],
      );
      expect(balances[0]?.n).toBe(0);
      await invariant(c.country, [{ trip: made.trip, captured: total }]);
    });
  },
);
