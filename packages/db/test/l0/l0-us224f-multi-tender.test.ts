/**
 * US-224 (partie 224f, migration 0141, ADR-166) — critère 6 : remboursement réparti sur les moyens
 * d'origine (TJ16a à TJ16d) et reprise après un échec confirmé (SM-8 FAILED →
 * PENDING_CUSTOMER_CHOICE). Sous app_worker (rôle de PRODUCTION, assertion L0-05 en tête :
 * withRole), en USD (PA) et en PYG sans décimale (PY), transactions annulées.
 *
 * Attendus (jamais calculés ici ni lus du code testé) :
 * - jambes des remboursements : export des oracles (`@rueda/money/golden-vectors`) TJ16a, TJ16b
 *   (USD, règlement T03, variation TJ02b) et TJ16c, TJ16d (PYG, règlement T27, variation TJ08b) ;
 * - jambes des encaissements : TJ15a à TJ15d (USD, T33 : carte, Yappy, crédit cash, crédit promo)
 *   de l'export ; pour deux encaissements, `cascade` de `docs/specs/tools/check_legs.py` extraite
 *   telle quelle (comme `tenders.golden.test.ts`) :
 *     cascade(TJ01, [15000, 10666]) → {13125, 1875, 0, 0}, {0, 675, 0, 9991}
 *     cascade(TJ08a, [1000000, 438050]) → {787500, 105000, 0, 107500}, {0, 0, 0, 438050}
 * - montant de chaque moyen (08 E2) : T33 (carte 150,00, Yappy 37,44), TJ16c (carte 1 000 000,
 *   crédit cash 367) ; deux cartes : `allocate` de `check_t49plus.py` (la plus récente absorbe
 *   d'abord : seconde carte 37,44 / 367) ; états et `attempt_no` : 08 SM-8 et E4.
 *
 * Durcissement argent n° 2 (migration 0150, BOARD N-365 et N-367, ADR-166 n° 8 et 9) : un crédit
 * (`CREDIT_CASH`, `CREDIT_PROMO`) n'est plus encaissable par la commande tant que les crédits
 * n'existent pas ; les moyens d'origine RÉELS de 08 qui en comptent (T33, TJ16d) sont posés par la
 * fixture 9933 (`hard2_credit_tender` : capture enregistrée sur une carte par la vraie commande,
 * puis moyen crédit) pour prouver que leur remboursement reste refusé sur tout rail. « Deux
 * cartes » : l'unité de trop est refusée sur CHACUN des deux moyens par la garde du règlement
 * (`leg_refund_exceeds_settlement`, 0121), pas seulement par un 55000.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';

type Tx = pg.ClientBase;
/** Moyens crédit de 08 : jamais encaissables par la commande depuis 0150 (N-367). */
const CREDITS: ReadonlySet<string> = new Set(['CREDIT_CASH', 'CREDIT_PROMO']);
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const legs = (h: bigint, i: bigint, t: bigint, p: bigint): Legs => ({
  HOST: h,
  INSURER: i,
  TAX_THIRD_PARTY: t,
  PLATFORM: p,
});
const textLegs = (l: Legs): Record<string, string> =>
  Object.fromEntries(LEGS.map((k) => [k, l[k].toString()]));

interface Case {
  readonly settlement: string;
  readonly variation: string;
  /** Deux encaissements (cascade de l'oracle) : première carte, second moyen. */
  readonly two: readonly [Legs, Legs];
  /** Remboursement de chaque moyen (export) : premier, second. */
  readonly refunds: readonly [string, string];
  /** Méthode du second moyen de l'énoncé de 08 (Yappy au PA par T33, crédit cash au PY). */
  readonly secondMethod: string;
}

/** Vecteurs par devise (jamais par pays). */
const CASES: Readonly<Record<string, Case>> = {
  USD: {
    settlement: 'T03',
    variation: 'TJ02b',
    two: [legs(13125n, 1875n, 0n, 0n), legs(0n, 675n, 0n, 9991n)],
    refunds: ['TJ16a', 'TJ16b'],
    secondMethod: 'YAPPY',
  },
  PYG: {
    settlement: 'T27',
    variation: 'TJ08b',
    two: [legs(787500n, 105000n, 0n, 107500n), legs(0n, 0n, 0n, 438050n)],
    refunds: ['TJ16c', 'TJ16d'],
    secondMethod: 'CREDIT_CASH',
  },
};
const caseOf = (c: CountryCase): Case => {
  const k = CASES[c.currency];
  if (k === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(k.variation).currency).toBe(c.currency);
  return k;
};

const asPayments = (fn: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

const asWorker = (tx: Tx, workerName: string): Promise<void> =>
  setSessionContext(tx, { kind: 'WORKER', workerName });

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

interface World {
  readonly trip: string;
  readonly account: string;
  /** Encaissements, dans l'ordre des captures. */
  readonly tenders: readonly string[];
}

/** Trip encaissé en plusieurs moyens (jambes données) par la vraie commande, prouvés et reportés. */
async function paid(
  tx: Tx,
  c: CountryCase,
  parts: readonly { readonly legs: Legs; readonly method: string }[],
): Promise<World> {
  const trip = await insertTrip(tx, c);
  const account = await insertAccount(tx, { country: c.country });
  const tenders: string[] = [];
  for (const p of parts) {
    const credit = CREDITS.has(p.method);
    const { operation_id: op } = await recordOperation(tx, {
      tripId: trip,
      accountId: account,
      kind: 'CAPTURE',
      amountMinor: sum(p.legs),
      currency: c.currency,
      idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
      legs: p.legs,
      // N-367 (0150) : un crédit n'est plus encaissable par la commande ; fixture 9933 ensuite
      method: credit ? 'CARD' : p.method,
    });
    if (credit) {
      await tx.query('SELECT test_fixture.hard2_credit_tender($1, $2)', [op, p.method]);
    }
    expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
    expect(await applyMovement(tx, op)).toBe('APPLIED');
    tenders.push(op);
  }
  return { trip, account, tenders };
}

async function settle(
  tx: Tx,
  trip: string,
  version: number,
  record: ReturnType<typeof recordOfVector>,
  supersedesId?: string,
): Promise<SettlementRef> {
  const id = await recordAsSettlementWorker(
    tx,
    { tripId: trip, version, ...(supersedesId === undefined ? {} : { supersedesId }) },
    record,
  );
  await asWorker(tx, 'payment_command');
  return { id, version };
}

interface Planned {
  readonly instance_id: string;
  readonly operation_id: string;
}

async function plan(
  tx: Tx,
  s: SettlementRef,
  tender: string,
  refund: Legs,
  rail = 'NATIVE_PARTIAL',
  seq = 1,
): Promise<Planned> {
  const idem = `trip:${tender}:v${s.version}:REFUND:${tender}:i${seq}:a1:${uuid()}`;
  const { rows } = await tx.query<Planned>(
    `SELECT instance_id, operation_id
       FROM core.payment_cmd_plan_refund($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
    [uuid(), uuid(), s.id, tender, seq, rail, legsJson(refund), idem],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('plan_refund sans résultat');
  return row;
}

async function orderLegs(tx: Tx, operationId: string): Promise<Record<string, string>> {
  const { rows } = await tx.query<{ leg: string; amount: string }>(
    `SELECT leg, amount_minor::text AS amount FROM core.payment_payment_operation_leg
      WHERE operation_id = $1`,
    [operationId],
  );
  return Object.fromEntries(rows.map((r) => [r.leg, r.amount]));
}

async function instance(tx: Tx, id: string) {
  const { rows } = await tx.query<{
    status: string;
    attempt_no: number;
    amount: string;
    refunded: string;
  }>(
    `SELECT status, attempt_no, amount_trip_minor::text AS amount,
            refunded_operation_id::text AS refunded
       FROM core.payment_refund_instance WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function submit(tx: Tx, instanceId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.payment_cmd_submit_refund($1)',
    [instanceId],
  );
  return rows[0]?.outcome ?? '';
}

async function awaitChoice(tx: Tx, instanceId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.payment_cmd_refund_await_choice($1) AS outcome',
    [instanceId],
  );
  return rows[0]?.outcome ?? '';
}

describe.each(COUNTRIES)(
  'US-224f — remboursement réparti sur les moyens d’origine (critère 6) — $country ($currency)',
  (c) => {
    const k = caseOf(c);
    const first = negate(legsOf(tj(k.refunds[0]))); // TJ16a / TJ16c
    const second = negate(legsOf(tj(k.refunds[1]))); // TJ16b / TJ16d
    const owed = negate(legsOf(tj(k.variation))); // TJ02b / TJ08b

    it('deux cartes : une instance par moyen (rang 1 chacune), jambes explicites = TJ16a / TJ16b (TJ16c / TJ16d) ; Σ = TJ02b (TJ08b) à l’unité ; aucun prorata', async () => {
      await asPayments(async (tx) => {
        const w = await paid(tx, c, [
          { legs: k.two[0], method: 'CARD' },
          { legs: k.two[1], method: 'CARD' },
        ]);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(k.settlement));
        const a = await plan(tx, v1, w.tenders[0]!, first);
        const b = await plan(tx, v1, w.tenders[1]!, second);
        expect(await instance(tx, a.instance_id)).toEqual({
          status: 'PLANNED',
          attempt_no: 1,
          amount: sum(first).toString(),
          refunded: w.tenders[0],
        });
        expect(await instance(tx, b.instance_id)).toMatchObject({
          amount: sum(second).toString(),
          refunded: w.tenders[1],
        });
        // ordres REFUND : montant explicite de chaque jambe, tel que donné par l'oracle
        expect(await orderLegs(tx, a.operation_id)).toEqual(textLegs(first));
        expect(await orderLegs(tx, b.operation_id)).toEqual(textLegs(second));
        for (const leg of LEGS) expect(first[leg] + second[leg]).toBe(owed[leg]);
        // plus rien à rembourser : une unité de plus, sur l'un OU l'autre moyen, est refusée par la
        // garde du règlement (PLATFORM déjà remboursée de toute sa variation, 0121) ; N-365
        for (const tender of w.tenders) {
          expect(
            await caught(tx, () => plan(tx, v1, tender, legs(0n, 0n, 0n, 1n), 'NATIVE_PARTIAL', 2)),
          ).toMatchObject({ code: '55000', constraint: 'leg_refund_exceeds_settlement' });
        }
        const { rows: engaged } = await tx.query<{ n: string }>(
          'SELECT pg_catalog.count(*)::text AS n FROM core.payment_refund_instance WHERE trip_id = $1',
          [w.trip],
        );
        expect(engaged[0]?.n).toBe('2');
      });
    });

    it('08 E2 en base : jamais plus que le payé d’un moyen (refund_exceeds_tender), même quand le trip a encore de quoi rembourser ; même un remboursement en échec reste engagé', async () => {
      await asPayments(async (tx) => {
        const w = await paid(tx, c, [
          { legs: k.two[0], method: 'CARD' },
          { legs: k.two[1], method: 'CARD' },
        ]);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(k.settlement));
        // tout le remboursement sur le second moyen : dans la limite du règlement et de l'encaissé
        // du trip, au-delà de ce que ce moyen a payé
        expect(sum(owed) > sum(k.two[1])).toBe(true);
        expect(await caught(tx, () => plan(tx, v1, w.tenders[1]!, owed))).toMatchObject({
          code: '55000',
          constraint: 'refund_exceeds_tender',
        });
      });
    });

    it(`moyen d’origine réel de 08 (${k.secondMethod}) : TJ16a / TJ16c sur la carte planifiée ; TJ16b / TJ16d refusé sur tout rail en bêta (natif : refund_rail_not_native ; virement : refund_rail_unavailable ; crédit cash : refund_credit_cash_closed)`, async () => {
      await asPayments(async (tx) => {
        const w = await paid(tx, c, [
          { legs: k.two[0], method: 'CARD' },
          { legs: k.two[1], method: k.secondMethod },
        ]);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(k.settlement));
        const a = await plan(tx, v1, w.tenders[0]!, first);
        expect(await orderLegs(tx, a.operation_id)).toEqual(textLegs(first));
        for (const [rail, constraint] of [
          ['NATIVE_PARTIAL', 'refund_rail_not_native'],
          ['ROLLBACK_AND_RECHARGE', 'refund_rail_not_native'],
          ['BANK_TRANSFER', 'refund_rail_unavailable'],
          ['CREDIT_CASH', 'refund_credit_cash_closed'],
        ] as const) {
          expect(await caught(tx, () => plan(tx, v1, w.tenders[1]!, second, rail))).toMatchObject({
            code: '55000',
            constraint,
          });
        }
        // rien d'autre n'est engagé : le reliquat dû (TJ16b / TJ16d) n'est jamais remboursé ailleurs
        const { rows } = await tx.query<{ n: string; total: string }>(
          `SELECT pg_catalog.count(*)::text AS n,
                  COALESCE(pg_catalog.sum(amount_trip_minor), 0)::text AS total
             FROM core.payment_refund_instance WHERE trip_id = $1`,
          [w.trip],
        );
        expect(rows[0]).toEqual({ n: '1', total: sum(first).toString() });
      });
    });

    it('SM-8 : rejet confirmé ⇒ PENDING_CUSTOMER_CHOICE, attempt_no 2 ; rejeu sans effet ; obligation toujours engagée ; hors de la file ; version n+1 ⇒ SUPERSEDED', async () => {
      await asPayments(async (tx) => {
        const w = await paid(tx, c, [
          { legs: k.two[0], method: 'CARD' },
          { legs: k.two[1], method: 'CARD' },
        ]);
        const r1 = recordOfVector(k.settlement);
        const v1 = await settle(tx, w.trip, 1, r1);
        const a = await plan(tx, v1, w.tenders[0]!, first);
        // pas encore un échec : refusé
        expect(await caught(tx, () => awaitChoice(tx, a.instance_id))).toMatchObject({
          code: '55000',
          constraint: 'refund_instance_not_failed',
        });
        expect(await submit(tx, a.instance_id)).toBe('SUBMITTED');
        // issue inconnue : même clé, aucune nouvelle tentative (08 E4, EC-29)
        expect(await applyStatus(tx, a.operation_id, 'UNKNOWN', 'API_RESPONSE')).toBe('APPLIED');
        expect(await caught(tx, () => awaitChoice(tx, a.instance_id))).toMatchObject({
          constraint: 'refund_instance_not_failed',
        });
        expect(await applySignedStatus(tx, a.operation_id, 'FAILED')).toBe('APPLIED');
        expect(await instance(tx, a.instance_id)).toMatchObject({
          status: 'FAILED',
          attempt_no: 1,
        });
        expect(await awaitChoice(tx, a.instance_id)).toBe('AWAITING_CHOICE');
        expect(await instance(tx, a.instance_id)).toMatchObject({
          status: 'PENDING_CUSTOMER_CHOICE',
          attempt_no: 2,
        });
        expect(await awaitChoice(tx, a.instance_id)).toBe('DUPLICATE');
        expect((await instance(tx, a.instance_id))?.attempt_no).toBe(2);
        // hors de la file de l'ordonnanceur : rien n'est envoyé ni converti
        const { rows: due } = await tx.query<{ instance_id: string }>(
          'SELECT instance_id FROM core.payment_refunds_due(500)',
        );
        expect(due.map((d) => d.instance_id)).not.toContain(a.instance_id);
        // l'obligation reste engagée sur ce moyen (08 E1) : pas de seconde instance sur la carte
        expect(
          await caught(tx, () => plan(tx, v1, w.tenders[0]!, first, 'NATIVE_PARTIAL', 2)),
        ).toMatchObject({ code: '55000', constraint: 'refund_exceeds_tender' });
        // version n+1 : sans mouvement de fonds, l'instance est remplacée
        await settle(
          tx,
          w.trip,
          2,
          recordOf(tripOfVector(k.settlement), eventOfVector('T08'), r1),
          v1.id,
        );
        expect(await instance(tx, a.instance_id)).toMatchObject({
          status: 'SUPERSEDED',
          attempt_no: 2,
        });
        expect(await awaitChoice(tx, a.instance_id)).toBe('SUPERSEDED');
      });
    });

    it('identité figée : attempt_no et transitions hors SM-8 refusés ; commande réservée au travailleur payment_command ; instance inconnue refusée', async () => {
      await asPayments(async (tx) => {
        const w = await paid(tx, c, [
          { legs: k.two[0], method: 'CARD' },
          { legs: k.two[1], method: 'CARD' },
        ]);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(k.settlement));
        const a = await plan(tx, v1, w.tenders[0]!, first);
        // app_worker n'écrit jamais l'instance directement
        for (const sql of [
          `UPDATE core.payment_refund_instance SET attempt_no = 2 WHERE id = '${a.instance_id}'`,
          `UPDATE core.payment_refund_instance SET status = 'PENDING_CUSTOMER_CHOICE' WHERE id = '${a.instance_id}'`,
        ]) {
          expect(await caught(tx, () => tx.query(sql))).toMatchObject({ code: '42501' });
        }
        for (const other of ['settlement', 'webhook_ingest', 'reconciliation']) {
          await asWorker(tx, other);
          expect(await caught(tx, () => awaitChoice(tx, a.instance_id))).toMatchObject({
            code: '42501',
          });
        }
        await asWorker(tx, 'payment_command');
        expect(await caught(tx, () => awaitChoice(tx, uuid()))).toMatchObject({
          code: '55000',
          constraint: 'refund_instance_unknown',
        });
        expect((await instance(tx, a.instance_id))?.status).toBe('PLANNED');
      });
    });
  },
);

describe('US-224f — moyens de T33 (USD) : la part non remboursée est absorbée par les crédits et Yappy d’abord (08 E2)', () => {
  const c = COUNTRIES.find((x) => x.currency === 'USD');
  it('carte, Yappy, crédit cash, crédit promo (TJ15a à TJ15d) : seule la carte reçoit TJ16a ; Yappy (TJ16b) exige un autre rail, fermé en bêta', async () => {
    if (c === undefined) throw new Error('aucun pays en USD');
    await asPayments(async (tx) => {
      const w = await paid(tx, c, [
        { legs: legsOf(tj('TJ15a')), method: 'CARD' },
        { legs: legsOf(tj('TJ15b')), method: 'YAPPY' },
        { legs: legsOf(tj('TJ15c')), method: 'CREDIT_CASH' },
        { legs: legsOf(tj('TJ15d')), method: 'CREDIT_PROMO' },
      ]);
      const v1 = await settle(tx, w.trip, 1, recordOfVector('T03'));
      const a = await plan(tx, v1, w.tenders[0]!, negate(legsOf(tj('TJ16a'))));
      expect(await orderLegs(tx, a.operation_id)).toEqual(textLegs(negate(legsOf(tj('TJ16a')))));
      expect(
        await caught(tx, () => plan(tx, v1, w.tenders[1]!, negate(legsOf(tj('TJ16b'))))),
      ).toMatchObject({ code: '55000', constraint: 'refund_rail_not_native' });
    });
  });
});

describe('US-224f — attente du choix du rail fermée à app_api', () => {
  it('app_api n’a pas EXECUTE sur core.payment_cmd_refund_await_choice (42501)', async () => {
    await withRole('app_api', async (client) => {
      await expect(
        client.query(`SELECT core.payment_cmd_refund_await_choice('${uuid()}')`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
