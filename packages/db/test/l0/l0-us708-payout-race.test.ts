/**
 * US-708 (migration 0166, ADR-185) — RT-L3-V03, préparation doublée : deux travailleurs
 * `payment_command` préparent le versement du MÊME trip, chacun sur sa connexion (une connexion
 * par client, libérée). Le premier tient le verrou du trip ; le second attend (observé dans
 * `pg_locks`) puis lit le trip déjà mis dans un lot : un seul item, un seul lot, `release_at`
 * écrit une fois (19 US-708 critère 3 ; contrainte unique trip, segment, jambe ; L3-PM-33).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête). Préparation VALIDÉE sur un
 * trip neuf, encaissé (jambes TJ01 / TJ08a de l'export des oracles) sur le compte PSP FAKE ACTIVE
 * partagé du pays (fixture 9800) ; fériés de 2035 propres à ce fichier ; fichier isolé
 * (`vitest.l0.config.ts`). Aucun interrupteur n'est écrit : le lot reste ON_HOLD.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { applySignedStatus, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };

async function asWorker(tx: Tx): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
}

interface Prepared {
  readonly outcome: string;
  readonly batch_id: string | null;
  readonly payout_at: string | null;
}

async function prepare(tx: Tx, trip: string): Promise<Prepared> {
  const { rows } = await tx.query<Prepared>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at FROM core.payout_cmd_prepare_trip($1)`,
    [trip],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('préparation sans résultat');
  return row;
}

describe.each(COUNTRIES)(
  'US-708 — préparation doublée, deux connexions — $country ($currency)',
  (c) => {
    it('RT-L3-V03 : le second travailleur attend le verrou du trip puis lit ALREADY_PREPARED ; un seul item, release_at écrit une fois', async () => {
      const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
      const trip = uuid();
      await withRole('app_worker', async (observer) => {
        // préparation VALIDÉE : trip encaissé, compte de versement vérifié, terminé un vendredi
        await withTestTransaction(observer, { commit: true }, async (tx) => {
          await asWorker(tx);
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              trip,
              uuid(),
              uuid(),
              uuid(),
              c.country,
              c.currency,
              c.timezone,
              '2034-12-01T10:00:00Z',
              '2034-12-04T10:00:00Z',
            ],
          );
          const a = await tx.query<{ id: string }>(
            'SELECT test_fixture.us024_psp_account($1) AS id',
            [c.country],
          );
          const { operation_id: op } = await recordOperation(tx, {
            tripId: trip,
            accountId: a.rows[0]?.id ?? '',
            kind: 'CAPTURE',
            amountMinor: LEGS.reduce((s, k) => s + capture[k], 0n),
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
          await tx.query(`SELECT test_fixture.us708_holiday($1, '2035-01-01'::date)`, [c.country]);
          await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
          const end = await tx.query<{ at: string }>(
            `SELECT pg_catalog.to_char(('2035-01-12 15:00'::timestamp AT TIME ZONE $1)
                                     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
            [c.timezone],
          );
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            end.rows[0]?.at ?? '',
          ]);
          await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
        });

        await withRole('app_worker', (first) =>
          withRole('app_worker', async (second) => {
            await first.query('BEGIN');
            await second.query('BEGIN');
            try {
              await asWorker(first);
              await asWorker(second);
              const a = await prepare(first, trip);
              expect(a.outcome).toBe('PREPARED');
              const pid = await backendPid(second);
              const pending = prepare(second, trip);
              await waitUntilBlocked(observer, pid, 'transactionid');
              await first.query('COMMIT');
              const b = await pending;
              expect(b).toMatchObject({ outcome: 'ALREADY_PREPARED', batch_id: a.batch_id });
              expect(b.payout_at).toBe(a.payout_at);
              const items = await second.query('SELECT * FROM test_fixture.us708_items($1)', [
                trip,
              ]);
              expect(items.rowCount).toBe(1);
              const rel = await second.query<{ r: string }>(
                `SELECT release_at::text AS r FROM core.settlement_trip_leg_balance
                WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
                [trip],
              );
              expect(rel.rows[0]?.r).toBe(a.payout_at);
            } finally {
              await first.query('ROLLBACK').catch(() => undefined);
              await second.query('ROLLBACK');
            }
          }),
        );
      });
    });
  },
);
