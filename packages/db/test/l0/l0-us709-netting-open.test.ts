/**
 * US-709 (migration 0167, ADR-187) — critère 3 : la créance de la règle 3 bis (08 TJ18b : 75,00
 * au `host_ledger[hôte][USD]` ; TJ18d : 518 750 au `host_ledger[hôte][PYG]`) est compensée
 * (`NETTING`) sur le versement suivant de l'hôte, inscrite au grand livre, imputée à l'avance de
 * Kmino (lue par l'hôte dans `host_advance_v`), puis reprise chez le PSP par l'ajustement de
 * versement AVANT le versement du net (RT-L3-H01, L3-PM-42, L3-PM-44).
 *
 * `payouts_enabled[pays]` ouvert par la procédure à DEUX personnes d'US-125 (un ADMIN demande, un
 * SUPERADMIN approuve) sur la base de TEST, dans une fenêtre d'horloge virtuelle lointaine refermée
 * par la même procédure (comme `l0-us708-payout-open`) ; toutes les écritures d'argent sont dans
 * une transaction ANNULÉE ; la fermeture est vérifiée à la fin de la fenêtre et maintenant.
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), PA / USD et PY / PYG.
 * Attendus : jambe HOST des vecteurs TJ01 / TJ08a (export des oracles) ; créances de 08 TJ18b /
 * TJ18d ; jamais le code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
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
/** 08 TJ18b / TJ18d : créance de l'hôte née de l'avance de Kmino (règle 3 bis). */
const CLAIM: Readonly<Record<string, bigint>> = { USD: 7_500n, PYG: 518_750n };
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Fenêtre de 12 jours, même formule que `l0-us708-payout-open` (années 2950 et suivantes, pas de
 * 14 jours par numéro du compteur unique partagé) : aucune fenêtre ne chevauche une autre.
 */
async function farWindow(client: Tx): Promise<{ from: number; to: number }> {
  const n = await uniqueSerial(client);
  const from = Date.UTC(2950, 0, 1) + Number(n) * 14 * DAY;
  return { from, to: from + 12 * DAY };
}

async function setNow(tx: Tx, at: number): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(at)]);
}

describe.each(COUNTRIES)(
  'US-709 — créance de la règle 3 bis compensée au versement suivant — $country ($currency)',
  (c) => {
    it('NETTING : compensation = créance, écrite au grand livre et imputée à l’avance (RECOVERED) ; ajustement avant le versement du net ; aucune émission sans ajustement', async () => {
      const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
      const claim = CLAIM[c.currency] ?? 0n;
      expect(claim).toBeGreaterThan(0n);
      expect(claim).toBeLessThan(capture.HOST);
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
        const w = await farWindow(api);
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
          {
            worker: 'payment_command',
            deploymentEnv: 'test',
            virtualNow: iso(window.from + 60_000),
          },
          async (tx) => {
            expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
            const psp = await insertAccount(tx, { country: c.country });
            await tx.query(`SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1)`, [
              c.country,
            ]);
            const trip = await insertTrip(tx, c);
            const { operation_id: capOp } = await recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'CAPTURE',
              amountMinor: LEGS.reduce((s, k) => s + capture[k], 0n),
              currency: c.currency,
              idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
              legs: capture,
            });
            expect(await applySignedStatus(tx, capOp, 'SUCCEEDED')).toBe('APPLIED');
            await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [capOp]);
            for (const y of new Set([
              new Date(window.from).getUTCFullYear(),
              new Date(window.to).getUTCFullYear(),
            ])) {
              await tx.query(
                'SELECT test_fixture.us708_holiday($1, make_date($2::integer, 1, 1))',
                [c.country, y],
              );
            }
            await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
            await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [psp, trip]);

            // créance de la règle 3 bis du même compte d'hôte, dans la devise du trip
            const adv = await tx.query<{ id: string }>(
              'SELECT test_fixture.us709_receivable($1, $2::bigint) AS id',
              [trip, claim.toString()],
            );
            const advance = adv.rows[0]?.id ?? '';
            const state0 = await tx.query<{ state: string; balance_minor: string; open: string }>(
              `SELECT state, balance_minor, open_advances_minor AS open
                 FROM test_fixture.us709_state($1)`,
              [trip],
            );
            expect(state0.rows).toEqual([
              { state: 'NEGATIVE', balance_minor: (-claim).toString(), open: claim.toString() },
            ]);

            await setNow(tx, window.from + DAY);
            await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
            const prep = await tx.query<{ outcome: string; batch_id: string; payout_at: string }>(
              `SELECT outcome, batch_id, payout_at::text AS payout_at
                 FROM core.payout_cmd_prepare_trip($1)`,
              [trip],
            );
            expect(prep.rows[0]?.outcome).toBe('PREPARED');
            const batch = prep.rows[0]?.batch_id ?? '';
            const payoutAt = Date.parse(prep.rows[0]?.payout_at ?? '');
            expect(payoutAt).toBeLessThan(window.to - DAY);

            // échéance : compensation de la créance (même hôte, même devise)
            await setNow(tx, payoutAt + 60_000);
            const net = await tx.query<{ outcome: string; netted: string; net: string }>(
              `SELECT outcome, netted_minor::text AS netted, net_minor::text AS net
                 FROM core.payout_cmd_net_batch($1)`,
              [batch],
            );
            expect(net.rows[0]).toEqual({
              outcome: 'READY',
              netted: claim.toString(),
              net: (capture.HOST - claim).toString(),
            });
            // grand livre : la créance puis sa compensation par CE lot ; solde nul, BALANCED
            const ledger = await tx.query<{
              reason: string;
              amount_minor: string;
              payout_batch_id: string | null;
              advance_id: string | null;
            }>(
              `SELECT reason, amount_minor, payout_batch_id, advance_id
                 FROM test_fixture.us709_ledger($1)`,
              [trip],
            );
            expect(ledger.rows).toEqual([
              {
                reason: 'RELEASED_LEG_ADVANCE',
                amount_minor: (-claim).toString(),
                payout_batch_id: null,
                advance_id: advance,
              },
              {
                reason: 'PAYOUT_NETTING',
                amount_minor: claim.toString(),
                payout_batch_id: batch,
                advance_id: null,
              },
            ]);
            const state1 = await tx.query<{ state: string; balance_minor: string; open: string }>(
              `SELECT state, balance_minor, open_advances_minor AS open
                 FROM test_fixture.us709_state($1)`,
              [trip],
            );
            expect(state1.rows).toEqual([{ state: 'BALANCED', balance_minor: '0', open: '0' }]);
            const a = await tx.query('SELECT * FROM test_fixture.us709_advance_row($1)', [advance]);
            expect(a.rows[0]).toEqual({
              status: 'RECOVERED',
              receivable_minor: claim.toString(),
              recovered_minor: claim.toString(),
            });

            // libération de la jambe HOST (montant brut de l'item), preuve et report
            const items = await tx.query<{
              next_key: string;
              next_attempt: number;
              amount_minor: string;
            }>(
              `SELECT next_key, next_attempt, amount_minor::text AS amount_minor
                 FROM core.payout_release_items($1)`,
              [batch],
            );
            expect(items.rows[0]?.amount_minor).toBe(capture.HOST.toString());
            const { operation_id: rel } = await recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'LEG_RELEASE',
              amountMinor: capture.HOST,
              currency: c.currency,
              attemptNo: items.rows[0]?.next_attempt ?? 0,
              idemPlain: items.rows[0]?.next_key ?? '',
              legs: { ...ZERO, HOST: capture.HOST },
            });
            expect(await applySignedStatus(tx, rel, 'SUCCEEDED')).toBe('APPLIED');
            await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [rel]);

            // aucune émission d'un lot compensé sans ajustement réussi (garde de 0167)
            const early = await caught(tx, () =>
              tx.query('SELECT * FROM core.payout_cmd_initiate_batch($1)', [batch]),
            );
            expect(early).toMatchObject({
              code: '55000',
              constraint: 'payout_batch_adjustment_required',
            });
            expect(translateDbError(early).code).toBe('INVALID_TRANSITION');

            // ajustement : clé adjust:{lot}:r1, montant compensé explicite ; rejeu ⇒ REPLAY
            const adjust = await tx.query<{
              outcome: string;
              idempotency_key: string;
              amount_minor: string;
              submerchant_reference: string | null;
            }>(
              `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor,
                      submerchant_reference FROM core.payout_cmd_adjustment($1)`,
              [batch],
            );
            expect(adjust.rows[0]).toMatchObject({
              outcome: 'ADJUST',
              idempotency_key: `adjust:${batch}:r1`,
              amount_minor: claim.toString(),
            });
            expect(adjust.rows[0]?.submerchant_reference).not.toBeNull();
            const again = await tx.query<{ outcome: string }>(
              'SELECT outcome FROM core.payout_cmd_adjustment($1)',
              [batch],
            );
            expect(again.rows[0]?.outcome).toBe('REPLAY');
            const done = await tx.query<{ s: string }>(
              `SELECT core.payout_cmd_record_adjustment($1, 'SUCCEEDED', 'fk_adj_000001') AS s`,
              [batch],
            );
            expect(done.rows[0]?.s).toBe('SUCCEEDED');
            const after = await tx.query<{ outcome: string }>(
              'SELECT outcome FROM core.payout_cmd_adjustment($1)',
              [batch],
            );
            expect(after.rows[0]?.outcome).toBe('DONE');
            // un ajustement réussi ne se réécrit pas (garde de 0167)
            const rewrite = await tx.query<{ s: string }>(
              `SELECT core.payout_cmd_record_adjustment($1, 'FAILED', NULL) AS s`,
              [batch],
            );
            expect(rewrite.rows[0]?.s).toBe('SUCCEEDED');

            // émission du net seulement
            const init = await tx.query<{ outcome: string; amount_minor: string }>(
              `SELECT outcome, amount_minor::text AS amount_minor
                 FROM core.payout_cmd_initiate_batch($1)`,
              [batch],
            );
            expect(init.rows[0]).toEqual({
              outcome: 'INITIATED',
              amount_minor: (capture.HOST - claim).toString(),
            });
            const stored = await tx.query('SELECT * FROM test_fixture.us709_batch_adjustment($1)', [
              batch,
            ]);
            expect(stored.rows[0]).toEqual({
              adjustment_status: 'SUCCEEDED',
              adjustment_key: `adjust:${batch}:r1`,
              netted_minor: claim.toString(),
              net_minor: (capture.HOST - claim).toString(),
            });
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
  },
);
