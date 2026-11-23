/**
 * US-319 (migration 0180, ADR-200) — course à deux connexions (une connexion par client, libérée) :
 * deux travailleurs `payment_command` préparent la part HOST du MÊME débit post-trip reporté
 * (`core.payout_cmd_prepare_charge`). Le premier tient le verrou du trip ; le second attend
 * (observé dans `pg_locks` par son pid, lu d'abord) puis lit `ALREADY_PREPARED` : un seul item
 * `POST_TRIP_CHARGE`, une seule part, au montant explicite du débit, jamais incluse deux fois.
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête). Monde VALIDÉ sur le compte
 * PSP FAKE ACTIVE partagé du pays (fixture 9800), en 2062 (année propre à ce fichier) ;
 * SUPPORTS_MIT validée à une date propre à l'exécution puis remise inconnue (version suivante, en
 * `finally`) ; fichier isolé (`vitest.l0.config.ts`). Aucun interrupteur n'est écrit. Montants :
 * loyer TJ01 / TJ08a de l'export des oracles ; amende de 08 BR-TT-03 / BR-REIMB-04 (100 % à
 * l'hôte) et frais de 5 % (BR-PRICE-15), calculés à la main.
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
type Row = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };
const TRAFFIC: Readonly<Record<string, Legs>> = {
  USD: { ...ZERO, HOST: 1230n, PLATFORM: 62n },
  PYG: { ...ZERO, HOST: 25010n, PLATFORM: 1251n },
};

const RETURNED_AT = '2062-02-01T15:00:00.000Z';
const PREPARE_AT = '2062-02-02T15:00:00.000Z';
/** Dates d'effet propres à l'exécution (aucune collision de clé si le fichier est rejoué). */
const JITTER_MS = Math.floor(Math.random() * 1e9);
const MIT_VALID_FROM = new Date(Date.parse('2062-01-01T00:00:00.000Z') + JITTER_MS).toISOString();
const MIT_UNKNOWN_FROM = new Date(Date.parse('2062-03-01T00:00:00.000Z') + JITTER_MS).toISOString();

async function asWorker(tx: Tx, at: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [at]);
}

/**
 * Débit post-trip VALIDÉ : trip encaissé et terminé, amende débitée (webhook signé) et reportée sur
 * les jambes, lot du trip compensé (fixture 9921) : la part attend sa préparation.
 */
async function committedCharge(
  observer: Tx,
  c: CountryCase,
): Promise<{ trip: string; charge: string }> {
  const trip = uuid();
  const guest = uuid();
  const fine = TRAFFIC[c.currency] ?? ZERO;
  let charge = '';
  await withTestTransaction(observer, { commit: true }, async (tx) => {
    await asWorker(tx, RETURNED_AT);
    await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', 'test', true)`);
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      '2062-01-20T10:00:00Z',
      '2062-01-23T10:00:00Z',
    ]);
    const psp =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
          c.country,
        ])
      ).rows[0]?.id ?? '';
    const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
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
    await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [tender]);
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
        `tok_us319_race_${uuid()}`,
      ])
    ).rows[0]?.id;
    await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], true)', [
      trip,
      card,
      ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
    ]);
    await tx.query(`SELECT test_fixture.us708_holiday($1, '2062-01-01'::date)`, [c.country]);
    await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
    const n = await tx.query<{ outcome: string; charge_id: string }>(
      `SELECT * FROM core.payment_cmd_notify_post_trip_charge($1, $2, 'INCIDENTAL',
         'DELAYED_CHARGES', 'TRAFFIC_CHARGE', $3, NULL, $4, $5::bigint, $6::jsonb, true)`,
      [
        uuid(),
        trip,
        uuid(),
        tender,
        sum(fine).toString(),
        JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, fine[k].toString()]))),
      ],
    );
    expect(n.rows[0]?.outcome).toBe('NOTIFIED');
    charge = n.rows[0]?.charge_id ?? '';
    const p = await tx.query<{ outcome: string; operation_id: string }>(
      'SELECT outcome, operation_id FROM core.payment_cmd_plan_mit_attempt($1, $2)',
      [charge, uuid()],
    );
    expect(p.rows[0]?.outcome).toBe('PLANNED');
    expect(await applySignedStatus(tx, p.rows[0]?.operation_id ?? '', 'SUCCEEDED')).toBe('APPLIED');
    const s = await tx.query<{ outcome: string }>(
      'SELECT outcome FROM core.payment_cmd_settle_mit_attempt($1, false)',
      [charge],
    );
    expect(s.rows[0]?.outcome).toBe('CHARGED');
    const prep = await tx.query<{ batch_id: string }>(
      'SELECT batch_id FROM core.payout_cmd_prepare_trip($1)',
      [trip],
    );
    await tx.query(`SELECT test_fixture.us708_force_batch($1, 'READY')`, [prep.rows[0]?.batch_id]);
  });
  return { trip, charge };
}

/** Version suivante de SUPPORTS_MIT : inconnue (aucune autre preuve n'hérite d'une validation). */
async function resetMit(observer: Tx, c: CountryCase): Promise<void> {
  await withTestTransaction(observer, { commit: true }, async (tx) => {
    await asWorker(tx, PREPARE_AT);
    await tx.query(
      `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                                'UNKNOWN', $2::timestamptz)`,
      [c.country, MIT_UNKNOWN_FROM],
    );
  });
}

async function prepareCharge(tx: Tx, charge: string): Promise<Row> {
  const { rows } = await tx.query<Row>(
    'SELECT outcome, batch_id FROM core.payout_cmd_prepare_charge($1)',
    [charge],
  );
  return rows[0] ?? {};
}

describe.each(COUNTRIES)(
  'US-319 — préparation d’une part à deux connexions — $country ($currency)',
  (c) => {
    it('le second travailleur attend le verrou du trip puis lit ALREADY_PREPARED ; un seul item, une seule part, montant explicite', async () => {
      const fine = TRAFFIC[c.currency] ?? ZERO;
      await withRole('app_worker', async (observer) => {
        try {
          const { trip, charge } = await committedCharge(observer, c);
          await withRole('app_worker', (first) =>
            withRole('app_worker', async (second) => {
              await first.query('BEGIN');
              await second.query('BEGIN');
              try {
                await asWorker(first, PREPARE_AT);
                await asWorker(second, PREPARE_AT);
                for (const tx of [first, second]) {
                  await tx.query(`SET LOCAL lock_timeout = '20s'`);
                  await tx.query(`SET LOCAL statement_timeout = '30s'`);
                }
                const pid = await backendPid(second);
                const a = await prepareCharge(first, charge);
                expect(a['outcome']).toBe('PREPARED');
                const pending = prepareCharge(second, charge);
                await waitUntilBlocked(observer, pid, 'transactionid');
                await first.query('COMMIT');
                const b = await pending;
                expect(b).toMatchObject({ outcome: 'ALREADY_PREPARED', batch_id: a['batch_id'] });
                const items = await second.query<{ kind: string; amount_minor: string }>(
                  `SELECT kind, amount_minor::text AS amount_minor FROM test_fixture.us319_items($1)
                  WHERE kind = 'POST_TRIP_CHARGE'`,
                  [trip],
                );
                expect(items.rows).toEqual([
                  { kind: 'POST_TRIP_CHARGE', amount_minor: fine.HOST.toString() },
                ]);
                const share = await second.query<{ amount_minor: string }>(
                  'SELECT amount_minor::text AS amount_minor FROM test_fixture.us319_share($1)',
                  [charge],
                );
                expect(share.rows).toEqual([{ amount_minor: fine.HOST.toString() }]);
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
  },
);
