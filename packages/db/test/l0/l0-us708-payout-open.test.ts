/**
 * US-708 (migration 0165, ADR-185) — chemin passant de bout en bout sur PostgreSQL (revue QA n° 1,
 * MAJEUR 3) : `payouts_enabled[pays]` ouvert par la procédure à DEUX personnes d'US-125 (un ADMIN
 * demande, un SUPERADMIN approuve) sur la base de TEST, dans une fenêtre d'horloge virtuelle
 * lointaine refermée à false par la même procédure (comme le cas S-04 de `l0-us049-money-fixes`) ;
 * toutes les écritures du versement sont dans une transaction ANNULÉE. Aucun interrupteur ne reste
 * ouvert : la fermeture est vérifiée à la fin de la fenêtre et maintenant.
 *
 * Chaîne prouvée : préparation (lot SCHEDULED, aucun motif) → compensation à l'échéance (READY) →
 * motifs relus → item et clé `release:{trip}:1:HOST:i1` → ordre `LEG_RELEASE` enregistré par la
 * vraie commande et RATTACHÉ à l'item par le déclencheur 5.2 → preuve signée et report sur les
 * soldes (jambe HOST libérée) → émission (`INITIATED`, clé `payout:{lot}:r1`, montant net) →
 * arrêt d'urgence : interrupteur refermé APRÈS l'émission ⇒ REPLAY relit `PAYOUTS_DISABLED` (lecture
 * seule) → résultat du PSP (`PAID`). Les mêmes commandes sont celles qu'appelle `PgPayoutBatchStore`.
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), PA / USD et PY / PYG.
 * Attendus : jambe HOST des vecteurs TJ01 / TJ08a (export des oracles), 19 US-708, 08 SM-6.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { goLive, openSwitchWindow } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import {
  applySignedStatus,
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
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Fenêtre de 12 jours propre à ce fichier (le versement est à J+5 ouvrés) : années 2950 et
 * suivantes, au-delà de la plage des instants lointains des autres preuves (2500 à 2900), un pas
 * de 14 jours par numéro du compteur unique : aucune fenêtre ne chevauche celle d'une autre série.
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
  'US-708 — versement de bout en bout, interrupteur ouvert à deux personnes — $country ($currency)',
  (c) => {
    it('lot préparé, compensé, libéré (ordre rattaché à l’item), émis puis payé ; refermé après l’émission ⇒ REPLAY relit PAYOUTS_DISABLED', async () => {
      const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
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
            const caps = await tx.query<{ n: number }>(
              `SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1) AS n`,
              [c.country],
            );
            expect(caps.rows[0]?.n).toBeGreaterThan(0);
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
            // fériés des années traversées (calendrier présent), compte vérifié, sous-marchand ACTIVE
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
            await setNow(tx, window.from + DAY);
            await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);

            // 1. préparation : aucun motif de retenue, lot SCHEDULED, release_at posé
            const prep = await tx.query<{
              outcome: string;
              batch_id: string;
              payout_at: string;
              status: string;
              hold_reasons: string[];
            }>(
              `SELECT outcome, batch_id, payout_at::text AS payout_at, status, hold_reasons
               FROM core.payout_cmd_prepare_trip($1)`,
              [trip],
            );
            const p = prep.rows[0];
            expect(p).toMatchObject({ outcome: 'PREPARED', status: 'SCHEDULED', hold_reasons: [] });
            const payoutAt = Date.parse(p?.payout_at ?? '');
            expect(payoutAt).toBeLessThan(window.to - DAY);
            const batch = p?.batch_id ?? '';

            // 2. échéance : compensation (aucune dette) ⇒ READY ; motifs relus avant l'envoi
            await setNow(tx, payoutAt + 60_000);
            const net = await tx.query<{ outcome: string; net_minor: string }>(
              'SELECT outcome, net_minor::text AS net_minor FROM core.payout_cmd_net_batch($1)',
              [batch],
            );
            expect(net.rows[0]).toEqual({ outcome: 'READY', net_minor: capture.HOST.toString() });
            const re = await tx.query<{ outcome: string }>(
              'SELECT outcome FROM core.payout_cmd_recheck_batch($1)',
              [batch],
            );
            expect(re.rows[0]?.outcome).toBe('READY');

            // 3. item et ordre LEG_RELEASE (clé, rang, montant STOCKÉS), rattachement par la base
            const items = await tx.query<{
              item_id: string;
              next_key: string;
              next_attempt: number;
              amount_minor: string;
              beneficiary_reference: string | null;
            }>(
              `SELECT item_id, next_key, next_attempt, amount_minor::text AS amount_minor,
                    beneficiary_reference FROM core.payout_release_items($1)`,
              [batch],
            );
            expect(items.rows).toHaveLength(1);
            const item = items.rows[0];
            expect(item?.next_key).toBe(`release:${trip}:1:HOST:i1`);
            expect(item?.beneficiary_reference).not.toBeNull();
            const { operation_id: rel } = await recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'LEG_RELEASE',
              amountMinor: capture.HOST,
              currency: c.currency,
              attemptNo: item?.next_attempt ?? 0,
              idemPlain: item?.next_key ?? '',
              legs: { ...ZERO, HOST: capture.HOST },
            });
            const attached = await tx.query<{
              release_operation_id: string;
              release_attempt: number;
            }>('SELECT release_operation_id, release_attempt FROM test_fixture.us708_items($1)', [
              trip,
            ]);
            expect(attached.rows[0]).toEqual({ release_operation_id: rel, release_attempt: 1 });
            // l'émission attend la libération reportée
            const early = await tx.query<{ outcome: string }>(
              'SELECT outcome FROM core.payout_cmd_initiate_batch($1)',
              [batch],
            );
            expect(early.rows[0]?.outcome).toBe('RELEASE_PENDING');
            expect(await applySignedStatus(tx, rel, 'SUCCEEDED')).toBe('APPLIED');
            const moved = await tx.query<{ r: string }>(
              'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
              [rel],
            );
            expect(moved.rows[0]?.r).toBe('APPLIED');
            const released = await tx.query<{ v: string }>(
              `SELECT released_minor::text AS v FROM core.settlement_trip_leg_balance
              WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
              [trip],
            );
            expect(BigInt(released.rows[0]?.v ?? '-1')).toBe(capture.HOST);

            // 4. émission : INITIATED, clé payout:{lot}:r1, montant net
            const init = await tx.query<{
              outcome: string;
              idempotency_key: string;
              amount_minor: string;
              submerchant_reference: string | null;
            }>(
              `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor,
                    submerchant_reference FROM core.payout_cmd_initiate_batch($1)`,
              [batch],
            );
            expect(init.rows[0]).toMatchObject({
              outcome: 'INITIATED',
              idempotency_key: `payout:${batch}:r1`,
              amount_minor: capture.HOST.toString(),
            });
            expect(init.rows[0]?.submerchant_reference).not.toBeNull();

            // 5. arrêt d'urgence : interrupteur refermé APRÈS l'émission ⇒ REPLAY, motif relu
            await setNow(tx, window.to + 60_000);
            expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
            const replay = await tx.query<{ outcome: string; hold_reasons: string[] }>(
              'SELECT outcome, hold_reasons FROM core.payout_cmd_initiate_batch($1)',
              [batch],
            );
            expect(replay.rows[0]?.outcome).toBe('REPLAY');
            expect(replay.rows[0]?.hold_reasons).toContain('PAYOUTS_DISABLED');

            // 6. résultat du PSP (dans la fenêtre) : PAID
            await setNow(tx, payoutAt + 120_000);
            const paid = await tx.query<{ s: string }>(
              `SELECT core.payout_cmd_record_payout_result($1, 'SUCCEEDED', 'fk_tx_000001') AS s`,
              [batch],
            );
            expect(paid.rows[0]?.s).toBe('PAID');
            const rows = await tx.query<{ status: string; first_payout: boolean }>(
              'SELECT status, first_payout FROM test_fixture.us708_batches($1)',
              [trip],
            );
            expect(rows.rows).toEqual([{ status: 'PAID', first_payout: true }]);
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
