/**
 * US-224 (partie 224e, migration 0136, ADR-163) — créance de l'hôte de la règle 3 bis portée au
 * `host_ledger` (19 US-224 critère 4 : « une créance de 75,00 est inscrite au `host_ledger` » ;
 * 08 E7 règle 3 bis, E5, TJ18a à TJ18d ; BOARD N-274). Même chaîne qu'US-224b
 * (`l0-us224b-advance-decision`) : la jambe HOST retenue par la version 1 est déjà versée ; la
 * requalification FULL (T08) planifie le complément, l'avance attend la décision FINANCE à deux
 * personnes, puis le remboursement est envoyé, prouvé et reporté. Ici : AUCUNE écriture tant que
 * l'avance est PLANNED ; le report qui rend l'avance OPEN écrit, dans la MÊME instruction, UNE
 * créance `RELEASED_LEG_ADVANCE` égale à la jambe HOST déjà versée (75,00 USD / 518 750 PYG),
 * débit de l'hôte, devise du trip, rattachée au règlement v2 et à l'avance ; rejeu sans doublon ;
 * gardes de la commande (travailleur, avance non effective ou inconnue).
 *
 * Fichier ISOLÉ (`vitest.l0.config.ts`, projet `l0-concurrence`) : la mise en place (app_worker) et
 * la décision (app_api) sont validées (COMMIT) sur le compte FAKE ACTIVE du pays partagé par les
 * fichiers isolés (fixture 9800) ; l'envoi et le report sont dans une transaction annulée. Rôles de
 * PRODUCTION seulement (assertion L0-05 : withRole). PA (USD) et PY (PYG).
 *
 * Attendus : export des oracles (TJ01 / TJ08a, TJ18a à TJ18d, T05 / T41, T08 ;
 * `docs/specs/tools/check_legs.py`), jamais le code testé : la créance attendue est −HOST de TJ18a
 * / TJ18c (« créance de 75,00 au `host_ledger[hôte][USD]` », « créance de 518 750 au
 * `host_ledger[hôte][PYG]` », 08 TJ18b / TJ18d).
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
  caught,
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
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

const REF: Readonly<
  Record<string, { capture: string; v1: string; theory: string; executed: string }>
> = {
  USD: { capture: 'TJ01', v1: 'T05', theory: 'TJ18a', executed: 'TJ18b' },
  PYG: { capture: 'TJ08a', v1: 'T41', theory: 'TJ18c', executed: 'TJ18d' },
};

const REASON = 'Avance de Kmino sur une jambe HOST déjà versée (test US-224e)';

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

interface Entry {
  readonly id: string;
  readonly org_id: string;
  readonly country_code: string;
  readonly currency: string;
  readonly trip_id: string;
  readonly segment_no: number;
  readonly settlement_id: string;
  readonly settlement_version: number;
  readonly reason: string;
  readonly amount_minor: string;
  readonly advance_id: string | null;
}

async function entriesOf(tx: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>('SELECT * FROM test_fixture.us224e_ledger_entries($1)', [
    trip,
  ]);
  return rows;
}

async function post(tx: Tx, advance: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT test_fixture.us224e_call_post_receivable($1) AS id',
    [advance],
  );
  return rows[0]?.id ?? '';
}

async function decideByTwo(c: CountryCase, advance: string): Promise<void> {
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
          b,
          c.country,
          'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)',
          [approval],
        ),
      ).toBe('APPROVED');
    }),
  );
}

describe.each(COUNTRIES)(
  'US-224e — créance de la règle 3 bis au host_ledger (N-274) — $country ($currency)',
  (c) => {
    it('critère 4 : aucune écriture tant que l’avance est PLANNED ; le report qui la rend OPEN écrit UNE créance égale à la jambe HOST versée (TJ18b / TJ18d), débit de l’hôte, devise du trip, règlement v2, avance citée ; rejeu sans doublon ; gardes de la commande', async () => {
      const r = REF[c.currency];
      if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
      const s = await setup(c);
      const advance = s.planned.advance_id ?? '';
      expect(advance).not.toBe('');
      // créance attendue (08 TJ18b / TJ18d) : la jambe HOST déjà versée, −HOST de TJ18a / TJ18c
      const receivable = -legsOf(tj(r.theory)).HOST;
      expect(receivable).toBe(s.releasedHost);
      const v2 = s.replay[2];

      // avance PLANNED (bloquée, décision attendue) : rien au host_ledger
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command' }, async (tx) => {
          expect(await entriesOf(tx, s.trip)).toEqual([]);
          const planned = await caught(tx, () => post(tx, advance));
          expect(planned).toMatchObject({
            code: '23000',
            constraint: 'host_ledger_advance_unknown',
          });
        }),
      );

      await decideByTwo(c, advance);

      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command' }, async (tx) => {
          expect((await submit(tx, s.planned.instance_id)).outcome).toBe('SUBMITTED');
          expect(await applySignedStatus(tx, s.planned.operation_id, 'SUCCEEDED')).toBe('APPLIED');
          // décidée et envoyée, mais pas encore reportée : toujours rien
          expect(await entriesOf(tx, s.trip)).toEqual([]);
          expect(await applyMovement(tx, s.planned.operation_id)).toBe('APPLIED');

          // le report rend l'avance OPEN et écrit la créance dans la même instruction
          const { rows: adv } = await tx.query<{ status: string; org_id: string }>(
            'SELECT status, org_id FROM core.settlement_platform_advance WHERE id = $1',
            [advance],
          );
          expect(adv[0]?.status).toBe('OPEN');
          const entries = await entriesOf(tx, s.trip);
          expect(entries).toHaveLength(1);
          const e = entries[0];
          expect(e).toMatchObject({
            org_id: adv[0]?.org_id,
            country_code: c.country,
            currency: c.currency,
            trip_id: s.trip,
            segment_no: 1,
            settlement_id: v2,
            settlement_version: 2,
            reason: 'RELEASED_LEG_ADVANCE',
            amount_minor: (-receivable).toString(),
            advance_id: advance,
          });

          // le remboursement du voyageur n'est pas réduit : l'ordre exécuté est TJ18b / TJ18d
          expect(await legsOfOperation(tx, s.planned.operation_id)).toEqual(
            negate(legsOf(tj(r.executed))),
          );

          // rejeu de la commande : l'écriture d'origine, aucune seconde écriture
          expect(await post(tx, advance)).toBe(e?.id);
          expect(await entriesOf(tx, s.trip)).toHaveLength(1);
          // rejeu du report : rien de nouveau
          expect(await applyMovement(tx, s.planned.operation_id)).toBe('DUPLICATE');
          expect(await entriesOf(tx, s.trip)).toHaveLength(1);

          // gardes : autre travailleur ; avance inconnue
          for (const name of ['settlement', 'trip_lifecycle', 'payout']) {
            await setSessionContext(tx, { kind: 'WORKER', workerName: name });
            const refused = await caught(tx, () => post(tx, advance));
            expect(refused, name).toMatchObject({
              code: '42501',
              constraint: 'host_ledger_command_forbidden',
            });
          }
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
          const unknown = await caught(tx, () => post(tx, uuid()));
          expect(unknown).toMatchObject({
            code: '23000',
            constraint: 'host_ledger_advance_unknown',
          });

          // aucune écriture directe par le travailleur (aucun droit sur la table)
          const direct = await caught(tx, () =>
            tx.query(
              `INSERT INTO core.settlement_host_ledger_entry (id, org_id, country_code, currency,
                 trip_id, segment_no, settlement_id, settlement_version, reason, amount_minor,
                 advance_id)
               VALUES ($1, $2, $3, $4, $5, 1, $6, 2, 'RELEASED_LEG_ADVANCE', -1, $7)`,
              [uuid(), adv[0]?.org_id, c.country, c.currency, s.trip, v2, advance],
            ),
          );
          expect(direct).toMatchObject({ code: '42501' });
        }),
      );
    });
  },
);
