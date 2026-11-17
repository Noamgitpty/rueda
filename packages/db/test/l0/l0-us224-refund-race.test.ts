/**
 * US-224 (migration 0121, ADR-145) — ordres de règlement sur DEUX connexions (L2-PM-05, modèle
 * `rt-conc-*`, S-03), à l'ENREGISTREMENT et au REPORT sur les soldes :
 * - enregistrement : la garde prend le verrou du trip, compte les ordres en vol validés par l'autre
 *   session et relit la version en tête après l'attente ; le survivant est ensuite reporté ;
 * - report (`settlement_cmd_apply_leg_movement`, défense en profondeur) : deux ordres réussis et
 *   prouvés écrits par la fixture 9965 SANS la garde d'enregistrement (cas que l'enregistrement ne
 *   peut plus produire), reportés en même temps : un seul passe, l'autre relit les soldes validés ;
 *   remboursement contre versement de la jambe HOST, dans les deux ordres (revues de la PR de la PR 198).
 * L'attente de la seconde session sur le verrou est OBSERVÉE (pg_stat_activity : `wait_event_type`
 * = `Lock`), jamais supposée par un délai.
 *
 * Fichier ISOLÉ (`vitest.l0.config.ts`, projet `l0-concurrence`) : mise en place validée (COMMIT) sur
 * le compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800, index
 * `psp_account_one_active`). `payouts_enabled` n'est ouvert que par la procédure à deux personnes,
 * dans une fenêtre d'horloge virtuelle lointaine refermée à false (comme S-04, US-125).
 *
 * Sous app_worker (rôle de PRODUCTION, assertion L0-05 : withRole / connectAs), en USD (PA) et en
 * PYG (PY). Attendus : export des oracles (TJ01 / TJ02b / T03, TJ08a / TJ08b / T27, T08), codes de
 * 16 PAY-021 et d'ADR-145 ; jamais le code testé.
 */
import { settlementRecordPayload } from '@rueda/money';
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { farInstant, goLive, openSwitchWindow, plusMinutes } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import {
  applySignedStatus,
  insertTrip,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;

const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};

interface Setup {
  readonly trip: string;
  readonly account: string;
  readonly v1: SettlementRef;
  readonly v2?: SettlementRef;
}

interface SetupOptions {
  /** Requalification FULL (T08) en version 2 : toute la capture est remboursable. */
  readonly full?: boolean;
  readonly virtualNow?: string;
  /** Avant la validation : trajet terminé, release_at atteint, sous-marchand ACTIVE (versement). */
  readonly payable?: boolean;
}

/** Mise en place VALIDÉE : trip capturé (jambes du vecteur), règlement v1 (et v2 FULL). */
async function setup(c: CountryCase, o: SetupOptions = {}): Promise<Setup> {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture: Legs = { ...legVector(golden, r.capture).legsMinor };
  return withRole('app_worker', (client) =>
    payTx(
      client,
      {
        worker: 'payment_command',
        commit: true,
        ...(o.virtualNow === undefined ? {} : { virtualNow: o.virtualNow }),
      },
      async (tx) => {
        const trip = await insertTrip(tx, c);
        // compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800 : réutilisé
        // s'il existe, un seul compte ACTIVE par pays)
        const a = await tx.query<{ id: string }>(
          'SELECT test_fixture.us024_psp_account($1) AS id',
          [c.country],
        );
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
        const r1 = recordOfVector(r.settlement);
        const id1 = await recordAsSettlementWorker(tx, { tripId: trip, version: 1 }, r1);
        let v2: SettlementRef | undefined;
        if (o.full === true) {
          const id2 = await recordAsSettlementWorker(
            tx,
            { tripId: trip, version: 2, supersedesId: id1 },
            recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
          );
          v2 = { id: id2, version: 2 };
        }
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
        if (o.payable === true) {
          await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [trip]);
          for (const leg of LEGS) {
            await tx.query(
              `SELECT test_fixture.us049_set_release_at($1, $2, platform.now() - interval '1 minute')`,
              [trip, leg],
            );
          }
          await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [account, trip]);
        }
        return { trip, account, v1: { id: id1, version: 1 }, ...(v2 === undefined ? {} : { v2 }) };
      },
    ),
  );
}

/** Ordre réussi et prouvé écrit par la fixture 9965, SANS la garde d'enregistrement (validé). */
async function provenOrder(
  s: Setup,
  kind: 'REFUND' | 'LEG_RELEASE',
  legs: Legs,
  settlement: SettlementRef,
  virtualNow?: string,
): Promise<string> {
  const id = uuid();
  await withRole('app_worker', (client) =>
    payTx(
      client,
      {
        worker: 'payment_command',
        commit: true,
        ...(virtualNow === undefined ? {} : { virtualNow }),
      },
      async (tx) => {
        await tx.query(
          `SELECT test_fixture.us224_insert_proven_order($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [id, s.trip, s.account, kind, legsJson(legs), settlement.id, settlement.version],
        );
      },
    ),
  );
  return id;
}

const recordRefund = (
  client: pg.ClientBase,
  s: Setup,
  c: CountryCase,
  legs: Legs,
  settlement: SettlementRef,
): Promise<{ operation_id: string; replayed: boolean }> =>
  recordOperation(client, {
    tripId: s.trip,
    accountId: s.account,
    kind: 'REFUND',
    amountMinor: sum(legs),
    currency: c.currency,
    idemPlain: `trip:${s.trip}:REFUND:${uuid()}`,
    legs,
    settlement,
  });

type Settled = { ok: true } | { ok: false; err: { code?: string; constraint?: string } };
const settled = (p: Promise<unknown>): Promise<Settled> =>
  p.then(
    () => ({ ok: true as const }),
    (e: unknown) => ({ ok: false as const, err: e as { code?: string; constraint?: string } }),
  );

async function begin(client: pg.Client, worker: string, virtualNow?: string): Promise<number> {
  await client.query('BEGIN');
  await setSessionContext(client, { kind: 'WORKER', workerName: worker });
  if (virtualNow !== undefined) {
    await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [virtualNow]);
  }
  const { rows } = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
  return rows[0]?.pid ?? -1;
}

/**
 * Attend que la session `pid` soit BLOQUÉE sur un verrou (pg_stat_activity, connexion
 * d'observation en lecture seule, chaque lecture dans sa propre transaction) ; échoue après 10 s.
 */
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

async function balances(
  trip: string,
  virtualNow?: string,
): Promise<{ refunded: Legs; released: Legs }> {
  return withRole('app_worker', (client) =>
    payTx(
      client,
      { worker: 'payment_command', ...(virtualNow === undefined ? {} : { virtualNow }) },
      async (tx) => {
        const { rows } = await tx.query<{ leg: string; refunded: string; released: string }>(
          `SELECT leg, refunded_minor::text AS refunded, released_minor::text AS released
             FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
          [trip],
        );
        const refunded: Record<string, bigint> = { ...ZERO };
        const released: Record<string, bigint> = { ...ZERO };
        for (const r of rows) {
          refunded[r.leg] = BigInt(r.refunded);
          released[r.leg] = BigInt(r.released);
        }
        return {
          refunded: refunded as unknown as Legs,
          released: released as unknown as Legs,
        };
      },
    ),
  );
}

async function refunds(trip: string): Promise<number> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command' }, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.payment_payment_operation
          WHERE trip_id = $1 AND kind = 'REFUND'`,
        [trip],
      );
      return rows[0]?.n ?? -1;
    }),
  );
}

/** Trois connexions : deux concurrentes et une d'observation ; toujours libérées. */
async function withThree<T>(
  fn: (a: pg.Client, b: pg.Client, observer: pg.Client) => Promise<T>,
): Promise<T> {
  const a = await connectAs('app_worker');
  const b = await connectAs('app_worker');
  const observer = await connectAs('app_worker');
  try {
    return await fn(a, b, observer);
  } finally {
    for (const client of [a, b]) {
      await client.query('ROLLBACK').catch(() => undefined);
      await releaseClient(client);
    }
    await releaseClient(observer);
  }
}

describe.each(COUNTRIES)('US-224 — ordres de règlement concurrents — $country ($currency)', (c) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture: Legs = { ...legVector(golden, r.capture).legsMinor };
  const refund = negate({ ...legVector(golden, r.variation).legsMinor });

  it('enregistrement : deux remboursements du règlement sur deux connexions ⇒ un seul enregistré (le second REFUND_EXCEEDS_COLLECTED) ; le survivant est reporté', async () => {
    const s = await setup(c);
    let survivor = '';
    await withThree(async (first, second, observer) => {
      await begin(first, 'payment_command');
      const pid = await begin(second, 'payment_command');
      survivor = (await recordRefund(first, s, c, refund, s.v1)).operation_id; // verrou du trip
      const racing = settled(recordRefund(second, s, c, refund, s.v1));
      await waitUntilLocked(observer, pid);
      await first.query('COMMIT');
      const late = await racing;
      await second.query('ROLLBACK');
      expect(late).toEqual({
        ok: false,
        err: expect.objectContaining({ code: '55000', constraint: 'refund_exceeds_collected' }),
      });
    });
    expect(await refunds(s.trip)).toBe(1);
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
        expect(await applySignedStatus(tx, survivor, 'SUCCEEDED')).toBe('APPLIED');
        await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [survivor]);
      }),
    );
    expect((await balances(s.trip)).refunded).toEqual(refund);
  });

  it('enregistrement, S-02 : nouvelle version validée pendant l’attente ⇒ l’ordre de la version remplacée est refusé (SETTLEMENT_SUPERSEDED)', async () => {
    const s = await setup(c);
    await withThree(async (stl, pay, observer) => {
      await begin(stl, 'settlement');
      const pid = await begin(pay, 'payment_command');
      // v2 (FULL, T08) enregistrée par le travailleur settlement : verrou du trip tenu
      const r1 = recordOfVector(r.settlement);
      await stl.query(`SELECT core.settlement_cmd_record($1, $2, 1, 2, $3, 0, $4::jsonb)`, [
        uuid(),
        s.trip,
        s.v1.id,
        JSON.stringify(
          settlementRecordPayload(recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1)),
        ),
      ]);
      const racing = settled(recordRefund(pay, s, c, refund, s.v1));
      await waitUntilLocked(observer, pid);
      await stl.query('COMMIT');
      const late = await racing;
      await pay.query('ROLLBACK');
      expect(late).toEqual({
        ok: false,
        err: expect.objectContaining({
          code: '55000',
          constraint: 'operation_settlement_superseded',
        }),
      });
    });
    expect(await refunds(s.trip)).toBe(0);
  });

  it('report (ancien test d’US-049) : deux remboursements réussis de la capture entière (FULL) reportés sur deux connexions ⇒ un seul appliqué, le second leg_movement_exceeds_balance ; refunded = capture', async () => {
    const s = await setup(c, { full: true });
    const v2 = s.v2;
    if (v2 === undefined) throw new Error('v2 absente');
    const a = await provenOrder(s, 'REFUND', capture, v2);
    const b = await provenOrder(s, 'REFUND', capture, v2);
    await withThree(async (first, second, observer) => {
      await begin(first, 'payment_command');
      const pid = await begin(second, 'payment_command');
      const applied = await first.query<{ o: string }>(
        'SELECT core.settlement_cmd_apply_leg_movement($1) AS o',
        [a],
      );
      expect(applied.rows[0]?.o).toBe('APPLIED');
      // la seconde attend le verrou du trip tenu par la première, puis relit les soldes à jour
      const racing = settled(
        second.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [b]),
      );
      await waitUntilLocked(observer, pid);
      await first.query('COMMIT');
      const late = await racing;
      await second.query('ROLLBACK');
      expect(late).toEqual({
        ok: false,
        err: expect.objectContaining({ code: '55000', constraint: 'leg_movement_exceeds_balance' }),
      });
    });
    expect((await balances(s.trip)).refunded).toEqual(capture);
  });

  describe('report : remboursement contre versement de la jambe HOST (payouts_enabled ouvert par deux personnes)', () => {
    it.each(['remboursement', 'versement'] as const)(
      '%s d’abord : un seul des deux reporté, l’autre refusé ; jamais plus que la jambe HOST encaissée',
      async (firstKind) => {
        // fenêtre lointaine [from, to) ouverte puis refermée à false par la procédure à deux personnes
        const window = await withRole('app_api', async (api) => {
          const made = await withTestTransaction(api, { commit: true }, async (tx) => {
            const admin = await staff(tx, 'ADMIN', [c.country]);
            const superadmin = await staff(tx, 'SUPERADMIN', [c.country]);
            return [admin, superadmin].map((id) => ({
              userId: id,
              hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'),
              scope: [c.country],
            }));
          });
          const [requester, approver] = made as unknown as [StaffActor, StaffActor];
          const from = await farInstant(api);
          const to = plusMinutes(from, 60);
          await openSwitchWindow(api, requester, approver, 'payouts_enabled', c.country, from, to);
          return { inside: plusMinutes(from, 1), to };
        });
        const s = await setup(c, { virtualNow: window.inside, payable: true });
        const ref = await provenOrder(s, 'REFUND', refund, s.v1, window.inside);
        const release: Legs = { ...ZERO, HOST: capture.HOST };
        const rel = await provenOrder(s, 'LEG_RELEASE', release, s.v1, window.inside);
        const [one, two] = firstKind === 'remboursement' ? [ref, rel] : [rel, ref];
        await withThree(async (first, second, observer) => {
          await begin(first, 'payment_command', window.inside);
          const pid = await begin(second, 'payment_command', window.inside);
          const applied = await first.query<{ o: string }>(
            'SELECT core.settlement_cmd_apply_leg_movement($1) AS o',
            [one],
          );
          expect(applied.rows[0]?.o).toBe('APPLIED');
          const racing = settled(
            second.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [two]),
          );
          await waitUntilLocked(observer, pid);
          await first.query('COMMIT');
          const late = await racing;
          await second.query('ROLLBACK');
          // versement d'abord : la jambe HOST est versée ⇒ leg_already_released ; remboursement
          // d'abord : le versement de toute la jambe dépasse ce qui reste ⇒ leg_movement_exceeds_balance
          expect(late).toEqual({
            ok: false,
            err: expect.objectContaining({
              code: '55000',
              constraint:
                firstKind === 'remboursement'
                  ? 'leg_movement_exceeds_balance'
                  : 'leg_already_released',
            }),
          });
        });
        const b = await balances(s.trip, window.inside);
        expect(b.refunded.HOST + b.released.HOST).toBeLessThanOrEqual(capture.HOST);
        expect(b).toEqual(
          firstKind === 'remboursement'
            ? { refunded: refund, released: ZERO }
            : { refunded: ZERO, released: release },
        );
        // la fenêtre est refermée : payouts_enabled vaut false à son terme
        await withRole('app_worker', (client) =>
          withTestTransaction(client, { virtualNow: window.to }, async (tx) => {
            expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
          }),
        );
      },
    );
  });
});
