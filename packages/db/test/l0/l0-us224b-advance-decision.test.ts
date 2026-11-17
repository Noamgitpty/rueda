/**
 * US-224 (partie 224b, migration 0122, ADR-147) — avance de Kmino de bout en bout (19 US-224,
 * critère 4 ; 08 E7 règle 3 bis, TJ18b / TJ18d ; 17 §2.9) : la jambe HOST retenue par la version 1
 * est déjà versée à l'hôte ; la requalification FULL (T08) planifie le complément aux jambes de
 * l'ordre exécuté, l'avance attend la décision FINANCE à deux personnes (vraies commandes, deux
 * personnes distinctes ; le demandeur seul est refusé), puis le remboursement est envoyé, prouvé et
 * reporté : le voyageur reçoit tout le complément, la jambe PLATFORM du trip ne porte que sa part,
 * l'avance devient la créance de l'hôte (OPEN, 75,00 / 518 750).
 *
 * Fichier ISOLÉ (`vitest.l0.config.ts`, projet `l0-concurrence`) : la mise en place (app_worker) et la
 * décision (app_api) sont validées (COMMIT) sur le compte FAKE ACTIVE du pays partagé par les
 * fichiers isolés (fixture 9800) ; l'envoi et le report sont dans une transaction annulée. Rôles de
 * PRODUCTION seulement (assertion L0-05 : withRole). PA (USD) et PY (PYG).
 *
 * Attendus : export des oracles (TJ01 / TJ08a, TJ18a à TJ18d, T05 / T41, T08), jamais le code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  insertTrip,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const plus = (a: Legs, b: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, a[k] + b[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

const REF: Readonly<
  Record<string, { capture: string; v1: string; theory: string; executed: string }>
> = {
  USD: { capture: 'TJ01', v1: 'T05', theory: 'TJ18a', executed: 'TJ18b' },
  PYG: { capture: 'TJ08a', v1: 'T41', theory: 'TJ18c', executed: 'TJ18d' },
};

const REASON = 'Avance de Kmino sur une jambe HOST déjà versée (test US-224b)';

interface Planned {
  readonly instance_id: string;
  readonly operation_id: string;
  readonly advance_id: string | null;
  readonly status: string;
  readonly blocked_reason: string | null;
  readonly replayed: boolean;
}

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

async function planRefund(
  tx: Tx,
  args: readonly [string, string, string, string, number, string, string],
): Promise<Planned> {
  const [instanceId, operationId, settlementId, refundedId, seq, legs, idem] = args;
  const { rows } = await tx.query<Planned>(
    `SELECT * FROM core.payment_cmd_plan_refund($1, $2, $3, $4, $5, 'NATIVE_PARTIAL', $6::jsonb, $7, $7)`,
    [instanceId, operationId, settlementId, refundedId, seq, legs, idem],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('plan_refund sans résultat');
  return row;
}

async function submit(
  tx: Tx,
  id: string,
): Promise<{ outcome: string; blocked_reason: string | null }> {
  const { rows } = await tx.query<{ outcome: string; blocked_reason: string | null }>(
    'SELECT * FROM core.payment_cmd_submit_refund($1)',
    [id],
  );
  return rows[0] ?? { outcome: '', blocked_reason: null };
}

async function legsOfOperation(tx: Tx, id: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, amount_minor::text AS v FROM core.payment_payment_operation_leg WHERE operation_id = $1`,
    [id],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

async function refunded(tx: Tx, trip: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, refunded_minor::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

interface Setup {
  readonly trip: string;
  readonly planned: Planned;
  readonly replay: readonly [string, string, string, string, number, string, string];
  readonly v1Refund: Legs;
  readonly releasedHost: bigint;
}

/** Mise en place VALIDÉE : chaîne de TJ18 jusqu'au complément planifié, avance attendue. */
async function setup(c: CountryCase): Promise<Setup> {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(r.executed).currency).toBe(c.currency);
  const capture = legsOf(tj(r.capture));
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
      const trip = await insertTrip(tx, c);
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
      expect(await applyMovement(tx, cap)).toBe('APPLIED');
      const r1 = recordOfVector(r.v1);
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip, version: 1 }, r1);
      const { rows: varRows } = await tx.query<{ leg: string; v: string }>(
        `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg WHERE settlement_id = $1`,
        [v1],
      );
      const variation: Record<string, bigint> = { ...ZERO };
      for (const x of varRows) variation[x.leg] = BigInt(x.v);
      const v1Refund = negate(variation as unknown as Legs);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      const p1 = await planRefund(tx, [
        uuid(),
        uuid(),
        v1,
        cap,
        1,
        legsJson(v1Refund),
        `trip:${trip}:1:v1:REFUND:card:i1:a1`,
      ]);
      expect((await submit(tx, p1.instance_id)).outcome).toBe('SUBMITTED');
      expect(await applySignedStatus(tx, p1.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      expect(await applyMovement(tx, p1.operation_id)).toBe('APPLIED');
      const releasedHost = -legsOf(tj(r.theory)).HOST;
      expect(capture.HOST - v1Refund.HOST).toBe(releasedHost);
      await tx.query(`SELECT test_fixture.settlement_update_leg_balance($1, 'HOST', $2, $3)`, [
        trip,
        capture.HOST.toString(),
        releasedHost.toString(),
      ]);
      const v2 = await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 2, supersedesId: v1 },
        recordOf(tripOfVector(r.v1), eventOfVector('T08'), r1),
      );
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      const replay = [
        uuid(),
        uuid(),
        v2,
        cap,
        2,
        legsJson(negate(legsOf(tj(r.theory)))),
        `trip:${trip}:1:v2:REFUND:card:i2:a1`,
      ] as const;
      const planned = await planRefund(tx, replay);
      expect(planned).toMatchObject({
        status: 'PLANNED',
        blocked_reason: 'ADVANCE_CAP_UNSET',
        replayed: false,
      });
      expect(planned.advance_id).not.toBeNull();
      expect(await submit(tx, planned.instance_id)).toEqual({
        outcome: 'BLOCKED',
        blocked_reason: 'ADVANCE_CAP_UNSET',
      });
      return { trip, planned, replay, v1Refund, releasedHost };
    }),
  );
}

interface Person {
  readonly userId: string;
  readonly hash: Buffer;
}

async function finance(
  tx: Tx,
  who: Person,
  country: string,
  sql: string,
  params: readonly unknown[],
): Promise<string> {
  await setSessionContext(tx, {
    kind: 'STAFF',
    actorId: who.userId,
    countryScope: [country],
    sessionTokenHash: who.hash.toString('hex'),
  });
  const { rows } = await tx.query<{ outcome: string }>(sql, [who.hash, ...params]);
  return rows[0]?.outcome ?? '';
}

describe.each(COUNTRIES)(
  'US-224b — avance de Kmino décidée par deux personnes — $country ($currency)',
  (c) => {
    it('critère 4 : complément bloqué, décision FINANCE à deux personnes (le demandeur seul refusé), puis envoyé, prouvé, reporté ; l’avance devient la créance de l’hôte ; rejeu sans doublon', async () => {
      const r = REF[c.currency];
      if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
      const s = await setup(c);
      const advance = s.planned.advance_id ?? '';

      // décision FINANCE (vraies commandes, sous app_api, validée) : deux personnes distinctes
      await withRole('app_api', (api) =>
        withTestTransaction(api, { commit: true }, async (tx) => {
          const people = await Promise.all(
            ['FINANCE', 'FINANCE'].map(async (role) => {
              const id = await staff(tx, role, [c.country]);
              return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex') };
            }),
          );
          const [a, b] = people as [Person, Person];
          const approval = uuid();
          expect(
            await finance(
              tx,
              a,
              c.country,
              'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)',
              [approval, 'DECIDE_ADVANCE', advance, REASON],
            ),
          ).toBe('REQUESTED');
          expect(
            await finance(
              tx,
              a,
              c.country,
              'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)',
              [approval],
            ),
          ).toBe('SELF_APPROVAL');
          expect(
            await finance(
              tx,
              b,
              c.country,
              'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)',
              [approval],
            ),
          ).toBe('APPROVED');
        }),
      );

      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command' }, async (tx) => {
          // rejeu de la planification : même instance, même avance, aucune seconde avance
          expect(await planRefund(tx, s.replay)).toMatchObject({
            instance_id: s.planned.instance_id,
            advance_id: advance,
            replayed: true,
          });
          expect(await submit(tx, s.planned.instance_id)).toEqual({
            outcome: 'SUBMITTED',
            blocked_reason: null,
          });
          // ordre exécuté de 08 (TJ18b / TJ18d) : tout le complément, sur PLATFORM
          const executed = negate(legsOf(tj(r.executed)));
          expect(await legsOfOperation(tx, s.planned.operation_id)).toEqual(executed);
          expect(await applySignedStatus(tx, s.planned.operation_id, 'SUCCEEDED')).toBe('APPLIED');
          expect(await applyMovement(tx, s.planned.operation_id)).toBe('APPLIED');
          // la jambe PLATFORM du trip ne porte que sa part (TJ18a / TJ18c) ; la part avancée vient du
          // solde PLATFORM du pays ; HOST n'est pas débitée (déjà versée)
          const theory = negate(legsOf(tj(r.theory)));
          expect(await refunded(tx, s.trip)).toEqual(
            plus(s.v1Refund, { ...ZERO, PLATFORM: theory.PLATFORM }),
          );
          const { rows } = await tx.query<{ status: string; receivable: string; n: number }>(
            `SELECT a.status, a.receivable_minor::text AS receivable,
                  (SELECT count(*)::int FROM core.settlement_platform_advance AS x
                    WHERE x.trip_id = a.trip_id) AS n
             FROM core.settlement_platform_advance AS a WHERE a.id = $1`,
            [advance],
          );
          expect(rows[0]).toEqual({ status: 'OPEN', receivable: s.releasedHost.toString(), n: 1 });
        }),
      );
    });
  },
);
