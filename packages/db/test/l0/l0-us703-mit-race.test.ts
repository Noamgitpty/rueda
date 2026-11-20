/**
 * US-703 (migration 0169, ADR-189) — RT-L3-M02 / L3-PM-22 : deux travailleurs `payment_command`
 * planifient la tentative du MÊME débit post-trip, à deux connexions (une connexion par client,
 * libérée). Le premier tient le verrou du trip ; le second attend (observé dans `pg_locks`) puis lit
 * la tentative a1 sans statut : `IN_FLIGHT`, même ordre, jamais une seconde tentative ni un second
 * ordre `MIT_CHARGE` (08 E4 ; T68 « une seule instance »).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête). Monde VALIDÉ sur le compte
 * PSP FAKE ACTIVE partagé du pays (fixture 9800) ; SUPPORTS_MIT validée pour la carte à une date
 * propre à ce fichier (2036), puis remise inconnue (version suivante validée à la fin : aucune autre
 * preuve n'hérite d'une capacité validée) ; fichier isolé (`vitest.l0.config.ts`). Aucun
 * interrupteur n'est écrit. Montants : jambes TJ02a (USD) et TJ11a (PYG) de l'export des oracles.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { applySignedStatus, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const DEBT_LEGS: Readonly<Record<string, string>> = { USD: 'TJ02a', PYG: 'TJ11a' };
const CAPTURE_LEGS: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };

const RETURNED_AT = '2036-02-01T15:00:00.000Z';
const PLAN_AT = '2036-02-05T15:00:00.000Z';
/** Dates d'effet propres à l'exécution (aucune collision de clé si le fichier est rejoué). */
const JITTER_MS = Math.floor(Math.random() * 1e9);
const MIT_VALID_FROM = new Date(Date.parse('2036-01-01T00:00:00.000Z') + JITTER_MS).toISOString();
const MIT_UNKNOWN_FROM = new Date(Date.parse('2036-03-01T00:00:00.000Z') + JITTER_MS).toISOString();

async function asWorker(tx: Tx, at: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [at]);
}

/** Débit post-trip VALIDÉ, notifié au retour, consentement et rappel donnés, carte VISA. */
async function committedCharge(
  observer: Tx,
  c: CountryCase,
): Promise<{ trip: string; charge: string }> {
  const trip = uuid();
  const guest = uuid();
  const charge = uuid();
  await withTestTransaction(observer, { commit: true }, async (tx) => {
    await asWorker(tx, RETURNED_AT);
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      '2036-01-20T10:00:00Z',
      '2036-01-23T10:00:00Z',
    ]);
    const psp =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
          c.country,
        ])
      ).rows[0]?.id ?? '';
    const capture: Legs = { ...legVector(golden, CAPTURE_LEGS[c.currency] ?? '').legsMinor };
    const { operation_id: tender } = await recordOperation(tx, {
      tripId: trip,
      accountId: psp,
      kind: 'CAPTURE',
      amountMinor: sum(capture),
      currency: c.currency,
      idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
      legs: capture,
    });
    expect(await applySignedStatus(tx, tender, 'SUCCEEDED')).toBe('APPLIED');
    await tx.query(
      `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                                'VALIDATED_SANDBOX', $2::timestamptz)`,
      [c.country, MIT_VALID_FROM],
    );
    const card = (
      await tx.query<{ id: string }>('SELECT test_fixture.us703_card($1, $2, $3, $4) AS id', [
        guest,
        psp,
        'VISA',
        `tok_us703_race_${uuid()}`,
      ])
    ).rows[0]?.id;
    await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], true)', [
      trip,
      card,
      ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
    ]);
    await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
    const legs: Legs = { ...legVector(golden, DEBT_LEGS[c.currency] ?? '').legsMinor };
    await tx.query(
      `SELECT * FROM core.payment_cmd_notify_post_trip_charge($1, $2, 'INCIDENTAL',
         'DELAYED_CHARGES', 'TEST_ORIGIN', $3, NULL, $4, $5::bigint, $6::jsonb, false)`,
      [
        charge,
        trip,
        uuid(),
        tender,
        sum(legs).toString(),
        JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, legs[k].toString()]))),
      ],
    );
  });
  return { trip, charge };
}

/** Version suivante de SUPPORTS_MIT : inconnue (aucune autre preuve n'hérite d'une validation). */
async function resetMit(observer: Tx, c: CountryCase): Promise<void> {
  await withTestTransaction(observer, { commit: true }, async (tx) => {
    await asWorker(tx, PLAN_AT);
    await tx.query(
      `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                                'UNKNOWN', $2::timestamptz)`,
      [c.country, MIT_UNKNOWN_FROM],
    );
  });
}

interface Plan {
  readonly outcome: string;
  readonly operation_id: string | null;
  readonly attempt: number | null;
}

async function plan(tx: Tx, charge: string): Promise<Plan> {
  const { rows } = await tx.query<Plan>(
    'SELECT outcome, operation_id, attempt FROM core.payment_cmd_plan_mit_attempt($1, $2)',
    [charge, uuid()],
  );
  return rows[0] as Plan;
}

describe.each(COUNTRIES)('US-703 — tentative MIT à deux connexions — $country ($currency)', (c) => {
  it('RT-L3-M02 : le second travailleur attend le verrou du trip puis lit IN_FLIGHT ; une seule tentative, un seul ordre MIT_CHARGE', async () => {
    await withRole('app_worker', async (observer) => {
      const { trip, charge } = await committedCharge(observer, c);
      try {
        await withRole('app_worker', (first) =>
          withRole('app_worker', async (second) => {
            await first.query('BEGIN');
            await second.query('BEGIN');
            try {
              await asWorker(first, PLAN_AT);
              await asWorker(second, PLAN_AT);
              const a = await plan(first, charge);
              expect(a).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
              const pid = await backendPid(second);
              const pending = plan(second, charge);
              await waitUntilBlocked(observer, pid, 'transactionid');
              await first.query('COMMIT');
              const b = await pending;
              expect(b).toMatchObject({
                outcome: 'IN_FLIGHT',
                operation_id: a.operation_id,
                attempt: 1,
              });
              const ops = await second.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM core.payment_payment_operation
                  WHERE trip_id = $1 AND kind = 'MIT_CHARGE'`,
                [trip],
              );
              expect(ops.rows[0]?.n).toBe(1);
              const attempts = await second.query('SELECT * FROM test_fixture.us703_attempts($1)', [
                charge,
              ]);
              expect(attempts.rowCount).toBe(1);
            } finally {
              await first.query('ROLLBACK').catch(() => undefined);
              await second.query('ROLLBACK');
            }
          }),
        );
      } finally {
        await resetMit(observer, c);
      }
    });
  });
});
