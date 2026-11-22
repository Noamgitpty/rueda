/**
 * US-314 (migration 0172, ADR-192) — chaque source de litige retient le versement et ne le libère
 * que par sa décision (19 US-314 critère 3 ; 08 BR-PAYOUT-02 « versement bloqué si une
 * réclamation est ouverte, si un litige SM-7 est ouvert ou si un chargeback est ouvert », SM-6 ;
 * pré-mortem L3-PM-34 ; red team RT-L3-V04), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), travailleur
 * `payment_command` ; chaque transaction est ANNULÉE. Les commandes appelées sont celles de
 * `PgPayoutBatchStore` (préparation, compensation, relecture, libération, émission).
 *
 * - Interrupteur fermé (production) : réclamation (`support_case` de catégorie CLAIM, OPEN ou
 *   PENDING) ouverte avant la préparation ⇒ lot ON_HOLD `CLAIM` ; ouverte APRÈS la préparation ⇒
 *   `CLAIM` à la compensation ; dossier d'une autre catégorie, dossier clos, réclamation d'un autre
 *   trip ⇒ aucun `CLAIM` ; décision (RESOLVED) ⇒ le motif disparaît, et lui seul. Litige SM-7
 *   (`IN_DISPUTE`) ⇒ `DISPUTE`, levé au retour à COMPLETED.
 * - Interrupteur ouvert par les DEUX personnes d'US-125 dans une fenêtre d'horloge virtuelle
 *   lointaine refermée (comme `l0-us708-payout-open`) : lot READY, jambe HOST libérée, puis
 *   réclamation ouverte AVANT l'émission ⇒ l'émission relit `CLAIM` et rend ON_HOLD (aucune clé
 *   `payout`, aucun ordre de plus) ; décision ⇒ relecture READY, puis émission. Revue de #284 :
 *   ordre HOST hors lot refusé (`leg_release_not_due`) ; réclamation ouverte entre la relecture et
 *   l'ordre ⇒ ordre refusé (`leg_release_payout_held`, jamais créé), entre l'ordre et le report ⇒
 *   report refusé, jambe non libérée ; décision ⇒ ordre, puis report.
 * Attendus : 19 US-314, 08 BR-PAYOUT-02 et SM-6 ; montants : jambe HOST des vecteurs TJ01 / TJ08a
 * de l'export des oracles, jamais le code testé. Le chargeback (0155, 0167) est prouvé par
 * `l0-us708-payout-batches` (critère 2) et `l0-us709-chargebacks` (dégel à la décision).
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { goLive, openSwitchWindow } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { golden } from '../support/settlement.ts';
import { uniqueSerial } from '../support/unique.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const captureOf = (c: CountryCase): Legs => ({
  ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor,
});
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

async function setNow(tx: Tx, at: string): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [at]);
}

/** Instant ISO (UTC) d'une heure LOCALE du fuseau du trip (conversion de la base). */
async function localInstant(tx: Tx, tz: string, local: string): Promise<string> {
  const { rows } = await tx.query<{ at: string }>(
    `SELECT pg_catalog.to_char(($1::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
    [local, tz],
  );
  return rows[0]?.at ?? '';
}

/** Trip encaissé (jambes du vecteur) par la vraie commande, preuve signée et report. */
async function capturedTrip(tx: Tx, c: CountryCase, psp: string, capture: Legs): Promise<string> {
  const trip = await insertTrip(tx, c);
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [op],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
  return trip;
}

/** Dossier de support du trip (catégorie, état), forme de 0024 (fixture 9300). */
async function supportCase(tx: Tx, c: CountryCase, trip: string, category: string, status: string) {
  const id = uuid();
  await tx.query('SELECT test_fixture.rls_insert_support_case($1, $2, $3, NULL, $4, $5, NULL)', [
    id,
    c.country,
    trip,
    status,
    category,
  ]);
  return id;
}

/** Décision du support sur le dossier (fixture 9913 ; commande réelle : US-101 / US-310). */
async function decide(tx: Tx, caseId: string, status: string): Promise<void> {
  await tx.query('SELECT test_fixture.us314_set_case_status($1, $2)', [caseId, status]);
}

interface Prepared {
  readonly outcome: string;
  readonly batch_id: string;
  readonly payout_at: string;
  readonly status: string;
  readonly hold_reasons: string[];
}

async function prepare(tx: Tx, trip: string): Promise<Prepared> {
  const { rows } = await tx.query<Prepared>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at, status, hold_reasons
       FROM core.payout_cmd_prepare_trip($1)`,
    [trip],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('préparation sans résultat');
  expect(row.outcome).toBe('PREPARED');
  return row;
}

/** Compensation à l'échéance (motifs relus) : issue et motifs. */
async function net(tx: Tx, batch: string): Promise<{ outcome: string; hold_reasons: string[] }> {
  const { rows } = await tx.query<{ outcome: string; hold_reasons: string[] }>(
    'SELECT outcome, hold_reasons FROM core.payout_cmd_net_batch($1)',
    [batch],
  );
  return rows[0] ?? { outcome: 'NONE', hold_reasons: [] };
}

const FRIDAY = '2032-01-16 15:00';
const AFTER_DUE = '2032-02-10 12:00';

describe.each(COUNTRIES)('US-314 — versement retenu en litige — $country ($currency)', (c) => {
  it('interrupteur fermé : réclamation ouverte avant ou après la préparation ⇒ CLAIM ; autre catégorie, dossier clos, autre trip ⇒ rien ; décision ⇒ CLAIM levé ; litige SM-7 ⇒ DISPUTE, levé au retour', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', deploymentEnv: 'test' }, async (tx) => {
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
        const psp = await insertAccount(tx, { country: c.country });
        const capture = captureOf(c);
        await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [
          c.country,
          '2032-01-01',
        ]);
        const end = await localInstant(tx, c.timezone, FRIDAY);
        const ready = async (): Promise<string> => {
          const trip = await capturedTrip(tx, c, psp, capture);
          await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
          await setNow(tx, end);
          await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
          return trip;
        };

        // 1. réclamation ouverte AVANT la préparation
        const before = await ready();
        await supportCase(tx, c, before, 'CLAIM', 'OPEN');
        const p1 = await prepare(tx, before);
        expect(p1.status).toBe('ON_HOLD');
        expect(p1.hold_reasons).toEqual(expect.arrayContaining(['CLAIM', 'PAYOUTS_DISABLED']));

        // 2. dossiers qui ne sont PAS une réclamation ouverte sur CE trip
        const other = await ready();
        await supportCase(tx, c, other, 'TRIP', 'OPEN');
        await supportCase(tx, c, other, 'PAYMENT', 'PENDING');
        await supportCase(tx, c, other, 'CLAIM', 'CLOSED');
        await supportCase(tx, c, other, 'CLAIM', 'RESOLVED');
        const p2 = await prepare(tx, other);
        expect(p2.hold_reasons).toContain('PAYOUTS_DISABLED');
        expect(p2.hold_reasons).not.toContain('CLAIM');
        expect(p2.hold_reasons).not.toContain('DISPUTE');

        // 3. réclamation ouverte APRÈS la préparation : relue à la compensation (échéance)
        const after = await ready();
        const p3 = await prepare(tx, after);
        expect(p3.hold_reasons).not.toContain('CLAIM');
        const claim = await supportCase(tx, c, after, 'CLAIM', 'OPEN');
        await setNow(tx, await localInstant(tx, c.timezone, AFTER_DUE));
        const n1 = await net(tx, p3.batch_id);
        expect(n1.outcome).toBe('ON_HOLD');
        expect(n1.hold_reasons).toEqual(expect.arrayContaining(['CLAIM', 'PAYOUTS_DISABLED']));
        // la réclamation d'un autre trip ne retient pas le lot de `other`
        expect((await net(tx, p2.batch_id)).hold_reasons).not.toContain('CLAIM');
        // en attente (PENDING) : toujours retenu
        await decide(tx, claim, 'PENDING');
        expect((await net(tx, p3.batch_id)).hold_reasons).toContain('CLAIM');
        // décision (RESOLVED) : le motif disparaît, les autres restent (interrupteur fermé)
        await decide(tx, claim, 'RESOLVED');
        const n2 = await net(tx, p3.batch_id);
        expect(n2.outcome).toBe('ON_HOLD');
        expect(n2.hold_reasons).not.toContain('CLAIM');
        expect(n2.hold_reasons).toContain('PAYOUTS_DISABLED');

        // 4. litige SM-7 sur le trip ⇒ DISPUTE ; retour à COMPLETED ⇒ levé
        await tx.query(`SELECT test_fixture.us708_set_trip_status($1, 'IN_DISPUTE')`, [after]);
        expect((await net(tx, p3.batch_id)).hold_reasons).toContain('DISPUTE');
        await tx.query(`SELECT test_fixture.us708_set_trip_status($1, 'COMPLETED')`, [after]);
        expect((await net(tx, p3.batch_id)).hold_reasons).not.toContain('DISPUTE');

        // aucun ordre LEG_RELEASE ni lot émis pour ces trips
        const ops = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.payment_payment_operation
            WHERE trip_id = ANY ($1::uuid[]) AND kind = 'LEG_RELEASE'`,
          [[before, other, after]],
        );
        expect(ops.rows[0]?.n).toBe(0);
      }),
    );
  });

  it('RT-L3-V04, interrupteur ouvert à deux personnes (fenêtre refermée) : jambe HOST libérée, réclamation ouverte avant l’émission ⇒ ON_HOLD CLAIM, aucune émission ; décision ⇒ READY puis INITIATED', async () => {
    const capture = captureOf(c);
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
      // fenêtre de 12 jours propre à ce fichier : années 3050 et suivantes (au-delà des fenêtres
      // d'US-708, 2950 et suivantes), un pas de 14 jours par numéro du compteur unique
      const n = await uniqueSerial(api);
      const from = Date.UTC(3050, 0, 1) + Number(n) * 14 * DAY;
      const w = { from, to: from + 12 * DAY };
      await openSwitchWindow(
        api,
        requester,
        approver,
        'payouts_enabled',
        c.country,
        iso(w.from),
        iso(w.to),
      );
      return w;
    });

    await withRole('app_worker', (client) =>
      payTx(
        client,
        { worker: 'payment_command', deploymentEnv: 'test', virtualNow: iso(window.from + 60_000) },
        async (tx) => {
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
          const psp = await insertAccount(tx, { country: c.country });
          const caps = await tx.query<{ n: number }>(
            `SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1) AS n`,
            [c.country],
          );
          expect(caps.rows[0]?.n).toBeGreaterThan(0);
          const trip = await capturedTrip(tx, c, psp, capture);
          for (const y of new Set([
            new Date(window.from).getUTCFullYear(),
            new Date(window.to).getUTCFullYear(),
          ])) {
            await tx.query('SELECT test_fixture.us708_holiday($1, make_date($2::integer, 1, 1))', [
              c.country,
              y,
            ]);
          }
          await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
          await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [psp, trip]);
          await setNow(tx, iso(window.from + DAY));
          await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);

          // hors lot (trip terminé, jamais préparé) : la jambe HOST n'a pas de release_at, dont la
          // préparation est le seul écrivain (S-06) ⇒ ordre refusé, jamais créé
          const outside = await caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'LEG_RELEASE',
              amountMinor: capture.HOST,
              currency: c.currency,
              idemPlain: `release:${trip}:1:HOST:i1`,
              attemptNo: 1,
              legs: { ...ZERO, HOST: capture.HOST },
            }),
          );
          expect(outside).toMatchObject({ code: '55000', constraint: 'leg_release_not_due' });

          const p = await prepare(tx, trip);
          expect(p).toMatchObject({ status: 'SCHEDULED', hold_reasons: [] });
          const payoutAt = Date.parse(p.payout_at);
          expect(payoutAt).toBeLessThan(window.to - DAY);
          await setNow(tx, iso(payoutAt + 60_000));
          expect((await net(tx, p.batch_id)).outcome).toBe('READY');

          // libération de la jambe HOST par la vraie commande, rattachée à l'item, reportée
          const items = await tx.query<{ next_key: string; next_attempt: number }>(
            'SELECT next_key, next_attempt FROM core.payout_release_items($1)',
            [p.batch_id],
          );
          expect(items.rows).toHaveLength(1);
          const order = () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'LEG_RELEASE',
              amountMinor: capture.HOST,
              currency: c.currency,
              attemptNo: items.rows[0]?.next_attempt ?? 0,
              idemPlain: items.rows[0]?.next_key ?? '',
              legs: { ...ZERO, HOST: capture.HOST },
            });
          const releaseOps = async (): Promise<number> =>
            (
              await tx.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM core.payment_payment_operation
                  WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
                [trip],
              )
            ).rows[0]?.n ?? -1;

          // réclamation ouverte ENTRE la relecture (READY) et l'ordre : garde de libération ⇒
          // l'ordre n'est jamais créé (donc jamais transmis au PSP)
          const before = await supportCase(tx, c, trip, 'CLAIM', 'OPEN');
          const refused = await caught(tx, order);
          expect(refused).toMatchObject({ code: '55000', constraint: 'leg_release_payout_held' });
          expect(translateDbError(refused).code).toBe('FORBIDDEN');
          expect(await releaseOps()).toBe(0);
          await decide(tx, before, 'RESOLVED');
          const { operation_id: rel } = await order();
          expect(await applySignedStatus(tx, rel, 'SUCCEEDED')).toBe('APPLIED');

          // réclamation ouverte entre l'ordre et son report sur les soldes : report refusé, la
          // jambe HOST n'est pas libérée ; décision ⇒ report
          const between = await supportCase(tx, c, trip, 'CLAIM', 'PENDING');
          const blocked = await caught(tx, () =>
            tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [rel]),
          );
          expect(blocked).toMatchObject({ code: '55000', constraint: 'leg_release_payout_held' });
          const unreleased = await tx.query<{ v: string }>(
            `SELECT released_minor::text AS v FROM core.settlement_trip_leg_balance
              WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
            [trip],
          );
          expect(unreleased.rows[0]?.v).toBe('0');
          await decide(tx, between, 'CLOSED');
          const moved = await tx.query<{ r: string }>(
            'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
            [rel],
          );
          expect(moved.rows[0]?.r).toBe('APPLIED');

          // réclamation ouverte ENTRE la libération et l'émission : relue à l'envoi
          const claim = await supportCase(tx, c, trip, 'CLAIM', 'OPEN');
          const held = await tx.query<{
            outcome: string;
            idempotency_key: string | null;
            hold_reasons: string[];
          }>(
            'SELECT outcome, idempotency_key, hold_reasons FROM core.payout_cmd_initiate_batch($1)',
            [p.batch_id],
          );
          expect(held.rows[0]).toEqual({
            outcome: 'ON_HOLD',
            idempotency_key: null,
            hold_reasons: ['CLAIM'],
          });
          const state = await tx.query<{ status: string; idempotency_key: string | null }>(
            'SELECT status, idempotency_key FROM test_fixture.us708_batches($1)',
            [trip],
          );
          expect(state.rows).toEqual([{ status: 'ON_HOLD', idempotency_key: null }]);
          // aucun second ordre de libération sur un lot retenu (garde de 0165)
          const second = await caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'LEG_RELEASE',
              amountMinor: capture.HOST,
              currency: c.currency,
              attemptNo: 2,
              idemPlain: `release:${trip}:1:HOST:i2`,
              legs: { ...ZERO, HOST: capture.HOST },
            }),
          );
          expect(second).not.toBeNull();
          // en attente : toujours retenu ; décision du support : relecture READY puis émission
          await decide(tx, claim, 'PENDING');
          const still = await tx.query<{ outcome: string; hold_reasons: string[] }>(
            'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
            [p.batch_id],
          );
          expect(still.rows[0]).toEqual({ outcome: 'ON_HOLD', hold_reasons: ['CLAIM'] });
          await decide(tx, claim, 'RESOLVED');
          const re = await tx.query<{ outcome: string; hold_reasons: string[] }>(
            'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
            [p.batch_id],
          );
          expect(re.rows[0]).toEqual({ outcome: 'READY', hold_reasons: [] });
          const init = await tx.query<{
            outcome: string;
            idempotency_key: string;
            amount_minor: string;
          }>(
            `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor
               FROM core.payout_cmd_initiate_batch($1)`,
            [p.batch_id],
          );
          expect(init.rows[0]).toEqual({
            outcome: 'INITIATED',
            idempotency_key: `payout:${p.batch_id}:r1`,
            amount_minor: capture.HOST.toString(),
          });
          const ops = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM core.payment_payment_operation
              WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
            [trip],
          );
          expect(ops.rows[0]?.n).toBe(1);
        },
      ),
    );

    // aucun interrupteur ne reste ouvert : faux à la fin de la fenêtre et maintenant
    await withRole('app_worker', async (client) => {
      for (const when of [iso(window.to), undefined]) {
        await withTestTransaction(
          client,
          when === undefined ? {} : { virtualNow: when },
          async (tx) => {
            expect(await goLive(tx, 'payouts_enabled', c.country), when ?? 'maintenant').toBe(
              false,
            );
          },
        );
      }
    });
  });
});
