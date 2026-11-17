/**
 * US-224 (partie 224b, migration 0123, ADR-147) — instance de remboursement (SM-8), avance de Kmino
 * sur une jambe déjà versée (08 E7 règle 3 bis, TJ18), versement borné dès l'enregistrement. Sous
 * app_worker (rôle de PRODUCTION, assertion L0-05 en tête : withRole), en USD (PA) et en PYG sans
 * décimale (PY), transactions annulées.
 *
 * Attendus : vecteurs de l'export des oracles (`docs/specs/tools`, `@rueda/money/golden-vectors`) :
 * TJ01 / TJ02b / T03 et TJ08a / TJ08b / T27 (remboursement du règlement), T05 / TJ04b et T41
 * (version 1 de TJ18), TJ18a / TJ18c (variation théorique), TJ18b / TJ18d (ordre exécuté), T08
 * (requalification FULL) ; codes de 16 PAY-021 et d'ADR-145 / ADR-147 (PROPOSÉS). Les jambes d'une
 * version lues en base (variation de la v1 de T41) ne sont qu'une ENTRÉE ; aucun attendu n'est
 * calculé ici ni lu du code testé.
 *
 * La décision FINANCE à deux personnes qui débloque l'avance, puis son report, sont prouvés par
 * `l0-us224b-advance-decision.test.ts` (fichier isolé, données validées) ; N-119 par
 * `l0-us224b-finance-decision.test.ts`.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { farInstant, goLive, openSwitchWindow, plusMinutes } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
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

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Vecteurs par devise (jamais par pays) : règlement simple et chaîne de TJ18. */
const REF: Readonly<
  Record<
    string,
    {
      capture: string;
      settlement: string;
      variation: string;
      releasedV1: string;
      theory: string;
      executed: string;
    }
  >
> = {
  USD: {
    capture: 'TJ01',
    settlement: 'T03',
    variation: 'TJ02b',
    releasedV1: 'T05',
    theory: 'TJ18a',
    executed: 'TJ18b',
  },
  PYG: {
    capture: 'TJ08a',
    settlement: 'T27',
    variation: 'TJ08b',
    releasedV1: 'T41',
    theory: 'TJ18c',
    executed: 'TJ18d',
  },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(r.capture).currency).toBe(c.currency);
  expect(tj(r.executed).currency).toBe(c.currency);
  return r;
};

const asPayments = (fn: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

interface World {
  readonly trip: string;
  readonly account: string;
  readonly capture: string;
  readonly currency: string;
}

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

/** Trip capturé (jambes du vecteur) par la vraie commande, prouvé et reporté. */
async function captured(
  tx: Tx,
  c: CountryCase,
  capture: Legs,
  existingAccount?: string,
): Promise<World> {
  const trip = await insertTrip(tx, c);
  // un seul compte PSP ACTIVE par pays (psp_account_one_active) : réutilisé dans la transaction
  const account = existingAccount ?? (await insertAccount(tx, { country: c.country }));
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  expect(await applyMovement(tx, op)).toBe('APPLIED');
  return { trip, account, capture: op, currency: c.currency };
}

/** Version enregistrée par le travailleur `settlement` ; sa variation (lue en base) ; retour à payment_command. */
async function settle(
  tx: Tx,
  trip: string,
  version: number,
  record: ReturnType<typeof recordOfVector>,
  supersedesId?: string,
): Promise<SettlementRef & { readonly variation: Legs }> {
  const id = await recordAsSettlementWorker(
    tx,
    { tripId: trip, version, ...(supersedesId === undefined ? {} : { supersedesId }) },
    record,
  );
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
      WHERE settlement_id = $1`,
    [id],
  );
  const variation: Record<string, bigint> = { ...ZERO };
  for (const x of rows) variation[x.leg] = BigInt(x.v);
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  return { id, version, variation: variation as unknown as Legs };
}

interface Planned {
  readonly instance_id: string;
  readonly operation_id: string;
  readonly advance_id: string | null;
  readonly status: string;
  readonly blocked_reason: string | null;
  readonly replayed: boolean;
}

interface PlanKey {
  readonly instanceId: string;
  readonly operationId: string;
  readonly seq: number;
  readonly idem: string;
}
const newKey = (trip: string, seq = 1): PlanKey => ({
  instanceId: uuid(),
  operationId: uuid(),
  seq,
  idem: `trip:${trip}:REFUND:card:i${String(seq)}:a1:${uuid()}`,
});

async function plan(
  tx: Tx,
  w: World,
  s: SettlementRef,
  legs: Legs,
  key: PlanKey,
  rail = 'NATIVE_PARTIAL',
): Promise<Planned> {
  const { rows } = await tx.query<Planned>(
    `SELECT * FROM core.payment_cmd_plan_refund($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
    [key.instanceId, key.operationId, s.id, w.capture, key.seq, rail, legsJson(legs), key.idem],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('plan_refund sans résultat');
  return row;
}

async function submit(
  tx: Tx,
  instanceId: string,
): Promise<{ outcome: string; blocked_reason: string | null }> {
  const { rows } = await tx.query<{ outcome: string; blocked_reason: string | null }>(
    'SELECT * FROM core.payment_cmd_submit_refund($1)',
    [instanceId],
  );
  return rows[0] ?? { outcome: '', blocked_reason: null };
}

async function opLegs(tx: Tx, operationId: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, amount_minor::text AS v FROM core.payment_payment_operation_leg
      WHERE operation_id = $1`,
    [operationId],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const x of rows) out[x.leg] = BigInt(x.v);
  return out as unknown as Legs;
}

async function instance(tx: Tx, id: string) {
  const { rows } = await tx.query<{
    status: string;
    blocked_reason: string | null;
    issued: boolean;
    executor: string;
  }>(
    `SELECT status, blocked_reason, issued_at IS NOT NULL AS issued, executor
       FROM core.payment_refund_instance WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function advance(tx: Tx, id: string) {
  const { rows } = await tx.query<{
    status: string;
    amount: string;
    receivable: string;
    cause: string;
    funded_from: string;
    org_id: string;
  }>(
    `SELECT status, amount_minor::text AS amount, receivable_minor::text AS receivable, cause,
            funded_from, org_id
       FROM core.settlement_platform_advance WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function balance(tx: Tx, trip: string, field: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, ${field}::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

async function counts(tx: Tx, trip: string): Promise<{ instances: number; refunds: number }> {
  const { rows } = await tx.query<{ instances: number; refunds: number }>(
    `SELECT (SELECT count(*)::int FROM core.payment_refund_instance WHERE trip_id = $1) AS instances,
            (SELECT count(*)::int FROM core.payment_payment_operation
              WHERE trip_id = $1 AND kind = 'REFUND') AS refunds`,
    [trip],
  );
  return rows[0] ?? { instances: -1, refunds: -1 };
}

async function orgOf(tx: Tx, trip: string): Promise<string> {
  const { rows } = await tx.query<{ org_id: string }>(
    'SELECT org_id FROM core.settlement_trip_leg_balance WHERE trip_id = $1 LIMIT 1',
    [trip],
  );
  return rows[0]?.org_id ?? '';
}

/** Chaîne de TJ18 : capture, v1 (T05 / T41) remboursée et reportée, HOST retenue versée, v2 FULL. */
async function releasedChain(tx: Tx, c: CountryCase) {
  const r = refOf(c);
  const capture = legsOf(tj(r.capture));
  const w = await captured(tx, c, capture);
  const r1 = recordOfVector(r.releasedV1);
  const v1 = await settle(tx, w.trip, 1, r1);
  const v1Refund = negate(v1.variation);
  // cohérence de l'entrée avec l'oracle : en USD, la variation de T05 est TJ04b
  if (tj('TJ04b').currency === c.currency) expect(v1Refund).toEqual(negate(legsOf(tj('TJ04b'))));
  const p1 = await plan(tx, w, v1, v1Refund, newKey(w.trip));
  expect(p1).toMatchObject({ advance_id: null, blocked_reason: null, status: 'PLANNED' });
  expect((await submit(tx, p1.instance_id)).outcome).toBe('SUBMITTED');
  expect(await applySignedStatus(tx, p1.operation_id, 'SUCCEEDED')).toBe('APPLIED');
  expect(await applyMovement(tx, p1.operation_id)).toBe('APPLIED');
  // 08 TJ18a / TJ18c : la jambe HOST retenue par la v1 (75,00 / 518 750) est déjà versée
  const releasedHost = -legsOf(tj(r.theory)).HOST;
  expect(capture.HOST - v1Refund.HOST).toBe(releasedHost);
  await tx.query(`SELECT test_fixture.settlement_update_leg_balance($1, 'HOST', $2, $3)`, [
    w.trip,
    capture.HOST.toString(),
    releasedHost.toString(),
  ]);
  const v2 = await settle(
    tx,
    w.trip,
    2,
    recordOf(tripOfVector(r.releasedV1), eventOfVector('T08'), r1),
    v1.id,
  );
  return { w, v1, v2, v1Refund, releasedHost, r };
}

describe.each(COUNTRIES)(
  'US-224b — instance de remboursement (SM-8) — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture = legsOf(tj(r.capture));
    const refund = negate(legsOf(tj(r.variation))); // jambes de TJ02b / TJ08b

    it('critère 1 : planifiée (PLANNED, ordre PENDING aux jambes du règlement, exécutant PLATFORM_API), rejouée sans doublon, jamais prouvée avant l’envoi autorisé, puis SUBMITTED et reportée', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        const key = newKey(w.trip);
        const p = await plan(tx, w, v1, refund, key);
        expect(p).toEqual({
          instance_id: key.instanceId,
          operation_id: key.operationId,
          advance_id: null,
          status: 'PLANNED',
          blocked_reason: null,
          replayed: false,
        });
        expect(await instance(tx, p.instance_id)).toMatchObject({
          status: 'PLANNED',
          issued: false,
          executor: 'PLATFORM_API',
        });
        expect(await opLegs(tx, p.operation_id)).toEqual(refund);
        const { rows } = await tx.query<{
          kind: string;
          status: string;
          amount: string;
          settlement_id: string;
          settlement_version: number;
        }>(
          `SELECT kind, status, amount_minor::text AS amount, settlement_id, settlement_version
           FROM core.payment_payment_operation WHERE id = $1`,
          [p.operation_id],
        );
        expect(rows[0]).toEqual({
          kind: 'REFUND',
          status: 'PENDING',
          amount: (-tj(r.variation).totalMinor).toString(),
          settlement_id: v1.id,
          settlement_version: 1,
        });
        // rejeu au même contenu : la même instance, aucun second ordre
        expect(await plan(tx, w, v1, refund, key)).toEqual({ ...p, replayed: true });
        expect(await counts(tx, w.trip)).toEqual({ instances: 1, refunds: 1 });
        // même clé, autres jambes : conflit d'idempotence, rien d'écrit
        const other: Legs = { ...refund, HOST: refund.HOST - 1n, PLATFORM: refund.PLATFORM + 1n };
        const conflict = await caught(tx, () => plan(tx, w, v1, other, key));
        expect(conflict).toMatchObject({
          code: '23000',
          constraint: 'refund_instance_idempotency_conflict',
        });
        expect(translateDbError(conflict).code).toBe('IDEMPOTENCY_CONFLICT');
        expect(await counts(tx, w.trip)).toEqual({ instances: 1, refunds: 1 });
        // l'ordre d'une instance PLANNED n'est ni envoyé ni prouvé (SM-8 : PLANNED → SUBMITTED d'abord)
        const early = await caught(tx, () => applySignedStatus(tx, p.operation_id, 'SUCCEEDED'));
        expect(early).toMatchObject({ code: '55000', constraint: 'refund_instance_not_submitted' });
        expect(translateDbError(early).code).toBe('INVALID_TRANSITION');
        expect(await submit(tx, p.instance_id)).toEqual({
          outcome: 'SUBMITTED',
          blocked_reason: null,
        });
        expect(await instance(tx, p.instance_id)).toMatchObject({
          status: 'SUBMITTED',
          issued: true,
        });
        expect(await submit(tx, p.instance_id)).toEqual({
          outcome: 'DUPLICATE',
          blocked_reason: null,
        });
        expect(await applySignedStatus(tx, p.operation_id, 'SUCCEEDED')).toBe('APPLIED');
        expect(await applyMovement(tx, p.operation_id)).toBe('APPLIED');
        expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(refund);
      });
    });

    it('supersession : la version n+1 passe l’instance PLANNED à SUPERSEDED (jamais envoyée) ; son ordre ne compte plus ; la version en tête est planifiée et reportée', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const r1 = recordOfVector(r.settlement);
        const v1 = await settle(tx, w.trip, 1, r1);
        const p1 = await plan(tx, w, v1, refund, newKey(w.trip));
        const v2 = await settle(
          tx,
          w.trip,
          2,
          recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
          v1.id,
        );
        expect(await instance(tx, p1.instance_id)).toMatchObject({
          status: 'SUPERSEDED',
          blocked_reason: null,
          issued: false,
        });
        expect(await submit(tx, p1.instance_id)).toEqual({
          outcome: 'SUPERSEDED',
          blocked_reason: null,
        });
        const proven = await caught(tx, () => applySignedStatus(tx, p1.operation_id, 'SUCCEEDED'));
        expect(proven).toMatchObject({
          code: '55000',
          constraint: 'refund_instance_not_submitted',
        });
        // une nouvelle instance de la version remplacée est refusée, rien d'écrit
        const stale = await caught(tx, () => plan(tx, w, v1, refund, newKey(w.trip, 2)));
        expect(stale).toMatchObject({
          code: '55000',
          constraint: 'operation_settlement_superseded',
        });
        expect(translateDbError(stale).code).toBe('SETTLEMENT_SUPERSEDED');
        expect(await counts(tx, w.trip)).toEqual({ instances: 1, refunds: 1 });
        // FULL (T08) : toute la capture, sous la v2 ; l'ordre remplacé n'est pas compté en vol
        const p2 = await plan(tx, w, v2, capture, newKey(w.trip));
        expect(p2).toMatchObject({ status: 'PLANNED', advance_id: null, replayed: false });
        expect((await submit(tx, p2.instance_id)).outcome).toBe('SUBMITTED');
        expect(await applySignedStatus(tx, p2.operation_id, 'SUCCEEDED')).toBe('APPLIED');
        expect(await applyMovement(tx, p2.operation_id)).toBe('APPLIED');
        expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(capture);
      });
    });

    it('rails et bornes : crédit cash fermé (funds_holding_enabled = false), virement indisponible en bêta, opération remboursée inconnue, plus que l’encaissé ⇒ REFUND_EXCEEDS_COLLECTED ; rien d’écrit', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        expect(await goLive(tx, 'funds_holding_enabled', c.country)).toBe(false);
        const cash = await caught(tx, () => plan(tx, w, v1, refund, newKey(w.trip), 'CREDIT_CASH'));
        expect(cash).toMatchObject({ code: '55000', constraint: 'refund_credit_cash_closed' });
        expect(translateDbError(cash).code).toBe('PAYMENT_METHOD_UNAVAILABLE');
        const bank = await caught(tx, () =>
          plan(tx, w, v1, refund, newKey(w.trip), 'BANK_TRANSFER'),
        );
        expect(bank).toMatchObject({ code: '55000', constraint: 'refund_rail_unavailable' });
        expect(translateDbError(bank).code).toBe('PAYMENT_METHOD_UNAVAILABLE');
        const unknown = await caught(tx, () =>
          plan(tx, { ...w, capture: uuid() }, v1, refund, newKey(w.trip)),
        );
        expect(unknown).toMatchObject({
          code: '55000',
          constraint: 'refund_instance_origin_invalid',
        });
        // 16 PAY-021 : une unité de plus que la jambe INSURER encaissée
        const over: Legs = { ...refund, INSURER: capture.INSURER + 1n };
        const exceeded = await caught(tx, () => plan(tx, w, v1, over, newKey(w.trip)));
        expect(exceeded).toMatchObject({ code: '55000', constraint: 'refund_exceeds_collected' });
        expect(translateDbError(exceeded).code).toBe('REFUND_EXCEEDS_COLLECTED');
        expect(await counts(tx, w.trip)).toEqual({ instances: 0, refunds: 0 });
      });
    });

    it.each([
      ['plafond par hôte absent', null, 'ADVANCE_CAP_UNSET'],
      ['avance au-delà du plafond par hôte', -1n, 'HOST_ADVANCE_CAP'],
      ['plafond respecté, solde PLATFORM du pays non lu', 0n, 'PLATFORM_BALANCE_UNKNOWN'],
    ] as const)(
      'critère 4 (TJ18b / TJ18d) : jambe HOST versée ⇒ ordre aux jambes de l’ordre exécuté, avance PLANNED (créance de l’hôte), envoi BLOQUÉ — %s',
      async (_label, capDelta, reason) => {
        await asPayments(async (tx) => {
          const { w, v2, v1Refund, releasedHost, r: rr } = await releasedChain(tx, c);
          if (capDelta !== null) {
            await tx.query(
              `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
             VALUES ('host_advance_cap_minor', $1, 'COUNTRY', $2::jsonb, 'test US-224b (annulé)')`,
              [c.country, JSON.stringify((releasedHost + capDelta).toString())],
            );
          }
          // jambes du règlement (TJ18a / TJ18c) demandées ; l'ordre porte TJ18b / TJ18d
          const p = await plan(tx, w, v2, negate(legsOf(tj(rr.theory))), newKey(w.trip, 2));
          expect(p).toMatchObject({ status: 'PLANNED', blocked_reason: reason, replayed: false });
          expect(p.advance_id).not.toBeNull();
          expect(await opLegs(tx, p.operation_id)).toEqual(negate(legsOf(tj(rr.executed))));
          // remboursement du voyageur jamais réduit : complément de 118,44 / 850 367
          expect(sum(await opLegs(tx, p.operation_id))).toBe(-tj(rr.theory).totalMinor);
          expect(await advance(tx, p.advance_id ?? '')).toEqual({
            status: 'PLANNED',
            amount: releasedHost.toString(),
            receivable: releasedHost.toString(),
            cause: 'RELEASED_LEG',
            funded_from: 'COUNTRY_PLATFORM_BALANCE',
            org_id: await orgOf(tx, w.trip),
          });
          // aucune avance ne devient effective sans décision FINANCE à deux personnes
          expect(await submit(tx, p.instance_id)).toEqual({
            outcome: 'BLOCKED',
            blocked_reason: reason,
          });
          const early = await caught(tx, () => applySignedStatus(tx, p.operation_id, 'SUCCEEDED'));
          expect(early).toMatchObject({ constraint: 'refund_instance_not_submitted' });
          const forced = await caught(tx, () =>
            tx.query('SELECT test_fixture.us224b_force_advance_open($1)', [p.advance_id]),
          );
          expect(forced).toMatchObject({ code: '55000', constraint: 'advance_decision_required' });
          expect(translateDbError(forced).code).toBe('FIN_REVIEW_REQUIRED');
          expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(v1Refund);
          // rejeu de la planification : aucune seconde avance
          const { rows } = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM core.settlement_platform_advance WHERE trip_id = $1`,
            [w.trip],
          );
          expect(rows[0]?.n).toBe(1);
        });
      },
    );

    it('critère 4 : jambe HOST versée, ordre forgé sans instance (aucune avance) ⇒ refusé à l’enregistrement ; la version suivante annule l’avance attendue (CANCELLED)', async () => {
      await asPayments(async (tx) => {
        const { w, v2, r: rr } = await releasedChain(tx, c);
        // sans instance, l'ordre exécuté (TJ18b / TJ18d) dépasse la jambe PLATFORM : aucune avance
        const forged = await caught(tx, () =>
          recordOperation(tx, {
            tripId: w.trip,
            accountId: w.account,
            kind: 'REFUND',
            amountMinor: -tj(rr.executed).totalMinor,
            currency: c.currency,
            idemPlain: `trip:${w.trip}:REFUND:forged:${uuid()}`,
            legs: negate(legsOf(tj(rr.executed))),
            settlement: v2,
          }),
        );
        expect(forged).toMatchObject({ code: '55000', constraint: 'refund_exceeds_collected' });
        const p = await plan(tx, w, v2, negate(legsOf(tj(rr.theory))), newKey(w.trip, 2));
        expect(p.advance_id).not.toBeNull();
        // version 3 (même requalification rejouée sur la v2) : l'instance PLANNED est remplacée
        const r2 = recordOf(
          tripOfVector(rr.releasedV1),
          eventOfVector('T08'),
          recordOf(
            tripOfVector(rr.releasedV1),
            eventOfVector('T08'),
            recordOfVector(rr.releasedV1),
          ),
        );
        await settle(tx, w.trip, 3, r2, v2.id);
        expect(await instance(tx, p.instance_id)).toMatchObject({ status: 'SUPERSEDED' });
        expect(await advance(tx, p.advance_id ?? '')).toMatchObject({ status: 'CANCELLED' });
      });
    });
  },
);

describe.each(COUNTRIES)(
  'US-224b — versement borné dès l’enregistrement (suite des revues de la PR 198) — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture = legsOf(tj(r.capture));
    const refund = negate(legsOf(tj(r.variation)));
    // jambe HOST retenue par le règlement (TJ02a : 45,00 ; T27 : capture − remboursement)
    const keptHost = capture.HOST - refund.HOST;

    it('payouts_enabled ouvert par deux personnes : jamais plus que la jambe retenue de la version en tête ; un remboursement en vol est compté ; sans règlement, un second versement en vol est compté', async () => {
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
        return { from, to };
      });
      const inside = plusMinutes(window.from, 1);
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command', virtualNow: inside }, async (tx) => {
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
          // le règlement est enregistré AVANT la fin du trajet (sa version optimiste du trip)
          let account: string | undefined;
          const payable = async (
            settled: boolean,
          ): Promise<{ w: World; v: SettlementRef | null }> => {
            const w = await captured(tx, c, capture, account);
            account = w.account;
            const v = settled ? await settle(tx, w.trip, 1, recordOfVector(r.settlement)) : null;
            await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [w.trip]);
            for (const leg of LEGS) {
              await tx.query(
                `SELECT test_fixture.us049_set_release_at($1, $2, platform.now() - interval '1 minute')`,
                [w.trip, leg],
              );
            }
            await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [
              w.account,
              w.trip,
            ]);
            return { w, v };
          };
          const release = (w: World, amount: bigint, settlement: SettlementRef | null) =>
            caught(tx, () =>
              recordOperation(tx, {
                tripId: w.trip,
                accountId: w.account,
                kind: 'LEG_RELEASE',
                amountMinor: amount,
                currency: c.currency,
                idemPlain: `trip:${w.trip}:LEG_RELEASE:${uuid()}`,
                legs: { ...ZERO, HOST: amount },
                ...(settlement === null ? {} : { settlement }),
              }),
            );
          // 1. règlement : la jambe HOST retenue (TJ02a / T27) et pas une unité de plus
          const { w: a, v: va } = await payable(true);
          if (va === null) throw new Error('règlement absent');
          expect(await release(a, keptHost + 1n, va)).toMatchObject({
            code: '55000',
            constraint: 'leg_release_exceeds_retained',
          });
          expect(await release(a, keptHost, va)).toBeNull();
          expect(await release(a, 1n, va)).toMatchObject({
            constraint: 'leg_release_exceeds_retained',
          });
          // 2. remboursement planifié (en vol) puis versement : la jambe n'a plus que la part retenue
          const { w: b, v: vb } = await payable(true);
          if (vb === null) throw new Error('règlement absent');
          await plan(tx, b, vb, refund, newKey(b.trip));
          expect(await release(b, keptHost, vb)).toBeNull();
          const beyond = await release(b, 1n, vb);
          expect(beyond).toMatchObject({
            code: '55000',
            constraint: 'leg_movement_exceeds_balance',
          });
          expect(translateDbError(beyond).code).toBe('LEG_AMOUNT_NEGATIVE');
          // 3. sans règlement (trajet réalisé) : un versement en vol compte pour le suivant
          const { w: d } = await payable(false);
          expect(await release(d, capture.HOST, null)).toBeNull();
          expect(await release(d, 1n, null)).toMatchObject({
            code: '55000',
            constraint: 'leg_movement_exceeds_balance',
          });
        }),
      );
      // fenêtre refermée : à son terme, payouts_enabled vaut false
      await withRole('app_worker', (client) =>
        withTestTransaction(client, { virtualNow: window.to }, async (tx) => {
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
        }),
      );
    });
  },
);
