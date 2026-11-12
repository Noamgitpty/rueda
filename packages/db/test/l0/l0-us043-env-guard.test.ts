/**
 * US-043 — gardes d'environnement fail-closed sur NULL (migration 0048 ; 17 §6.5 point 1, C19 ;
 * ADR-077 ; report d'US-025 : 0028 lignes 127, 527, 769, 0039 ligne 403).
 *
 * 1. Base de PRODUCTION du banc (migrations de production seules), sous app_api : AUCUNE fonction
 *    des schémas du projet ne lit `platform.deployment_env()` hors de
 *    `COALESCE(platform.deployment_env(), 'production')` (même analyse que le lint
 *    `sql-env-guard`, appliquée à `pg_proc.prosrc` : l'état réel après toutes les migrations).
 * 2. Base de test : l'environnement rendu NULL (`app.test_deployment_env = '__null__'`, fixture
 *    9880) vaut « production » pour chacune des six fonctions remplacées, en PA et en PY, sous les
 *    rôles de production qui les appellent ; témoin `test` : la garde laisse passer (le refus vient
 *    bien de l'environnement). Avant 0048, chacun de ces cas passait (fail-open).
 * Les attendus viennent de 17 §6.5 (« production par défaut, fail-closed ») et de C19.
 */
import { scanEnvGuards } from '@rueda/config/sql-env-guard';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  caught,
  insertAccount,
  insertTrip,
  payTx,
  publicWebhookId,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

const NULL_ENV = '__null__';
const golden = loadGoldenVectors();
/** Capture de référence par devise (08 E7 : TJ01 en USD, TJ08a en PYG). */
const CAPTURE: Record<string, { amountMinor: bigint; legs: Legs }> = Object.fromEntries(
  ['TJ01', 'TJ08a'].map((id) => {
    const v = legVector(golden, id);
    return [v.currency, { amountMinor: v.totalMinor, legs: { ...v.legsMinor } as Legs }];
  }),
);
const captureOf = (c: CountryCase): { amountMinor: bigint; legs: Legs } => {
  const v = CAPTURE[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur de capture en ${c.currency}`);
  return v;
};
const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

async function setEnv(tx: pg.ClientBase, env: string): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', $1, true)`, [env]);
  const { rows } = await tx.query<{ env: string | null }>(
    'SELECT platform.deployment_env() AS env',
  );
  expect(rows[0]?.env ?? null, env).toBe(env === NULL_ENV ? null : env);
}

/** Les fonctions qui lisent l'environnement dans la base de production (0028, 0039, 0045, 0048). */
const READERS = [
  'core.booking_cmd_start_payment',
  // US-105 (0072) : KYC de production fermé en base (OQ-MK-09, L1-PM-05)
  'core.kyc_cmd_apply_decision',
  'core.kyc_cmd_open_verification',
  'core.payment_cmd_receive_webhook',
  'core.payment_cmd_record_operation',
  'core.payment_cmd_register_submerchant',
  'core.payment_psp_account_fake_guard',
  'core.payment_resolve_webhook_account',
  'core.payment_startup_guard',
];

describe('US-043 — aucune garde d’environnement ouverte (pg_proc, base de production)', () => {
  it('toute lecture de platform.deployment_env() est COALESCE(…, production) ; aucune fonction oubliée', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ fn: string; src: string }>(
          `SELECT n.nspname || '.' || p.proname AS fn, p.prosrc AS src
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('core', 'app', 'platform')
              AND p.prosrc ~* 'deployment_env'
              AND NOT (n.nspname = 'platform' AND p.proname = 'deployment_env')
            ORDER BY 1`,
        );
        expect(rows.map((r) => r.fn)).toEqual(READERS);
        for (const r of rows) expect(scanEnvGuards(r.src), r.fn).toEqual([]);
        // la définition de production reste la constante « production » (17 §6.5)
        const env = await client.query<{ env: string }>('SELECT platform.deployment_env() AS env');
        expect(env.rows[0]?.env).toBe('production');
        // contrôle de démarrage : jamais NULL
        const guard = await client.query<{ deployment_env: string | null }>(
          'SELECT deployment_env FROM core.payment_startup_guard()',
        );
        expect(guard.rows[0]?.deployment_env).toBe('production');
      },
      { database: 'production' },
    );
  });
});

describe.each(COUNTRIES)(
  'US-043 — environnement NULL ⇒ production (C19), $country ($currency)',
  (c) => {
    it('trigger de garde FAKE : écriture d’un compte FAKE refusée ; témoin test admis', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, {}, async (tx) => {
          await setEnv(tx, NULL_ENV);
          const err = await caught(tx, () =>
            insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' }),
          );
          expect(err).toMatchObject({ code: '23000', constraint: 'psp_account_fake_forbidden' });
          await setEnv(tx, 'test');
          expect(
            await caught(tx, () =>
              insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' }),
            ),
          ).toBeNull();
        });
      });
    });

    it('payment_cmd_record_operation : opération sur un compte FAKE refusée ; témoin test admis', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const input = {
            tripId: trip,
            accountId: account,
            currency: c.currency,
            idemPlain: `${trip}:1:v1:CAPTURE:card:i1:a1`,
            ...captureOf(c),
          };
          await setEnv(tx, NULL_ENV);
          expect(await caught(tx, () => recordOperation(tx, input))).toMatchObject({
            code: '23000',
            constraint: 'psp_account_fake_forbidden',
          });
          await setEnv(tx, 'test');
          expect((await recordOperation(tx, input)).replayed).toBe(false);
        });
      });
    });

    it('payment_cmd_register_submerchant : hôte sur un compte FAKE refusé ; témoin test : la garde passe', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const org = uuid();
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuid(),
              uuid(),
              org,
              uuid(),
              c.country,
              c.currency,
              c.timezone,
              '2031-08-01T10:00:00Z',
              '2031-08-04T10:00:00Z',
            ],
          );
          const register = () =>
            tx.query(`SELECT * FROM core.payment_cmd_register_submerchant($1, $2, $3, 1)`, [
              uuid(),
              org,
              account,
            ]);
          await setEnv(tx, NULL_ENV);
          expect(await caught(tx, register)).toMatchObject({
            constraint: 'psp_account_fake_forbidden',
          });
          // hors production, la garde FAKE passe : le refus suivant est celui des capacités
          await setEnv(tx, 'test');
          const next = await caught(tx, register);
          expect(next?.constraint).not.toBe('psp_account_fake_forbidden');
        });
      });
    });

    it('webhooks : compte FAKE ni résolu ni reçu (NOT_FOUND, aucune écriture) ; témoin test résolu', async () => {
      const hook = publicWebhookId();
      let accountId = '';
      await withRole('app_worker', (client) =>
        payTx(client, { commit: true }, async (tx) => {
          accountId = await insertAccount(tx, {
            country: c.country,
            status: 'PENDING_VALIDATION',
            publicWebhookId: hook,
          });
        }),
      );
      await withRole('app_api', async (client) => {
        await payTx(client, {}, async (tx) => {
          await setEnv(tx, NULL_ENV);
          const resolved = await tx.query(
            `SELECT * FROM core.payment_resolve_webhook_account('FAKE', $1)`,
            [hook],
          );
          expect(resolved.rows).toEqual([]);
          const { rows } = await tx.query<{ outcome: string; inbox_id: string | null }>(
            `SELECT outcome, inbox_id FROM core.payment_cmd_receive_webhook($1, 'evt_null_env', $2, true, NULL, '{}'::jsonb, '[]'::jsonb)`,
            [accountId, sha256(`evt:${hook}:null`)],
          );
          expect(rows).toEqual([{ outcome: 'NOT_FOUND', inbox_id: null }]);
          await setEnv(tx, 'test');
          const witness = await tx.query<{ account_id: string }>(
            `SELECT account_id FROM core.payment_resolve_webhook_account('FAKE', $1)`,
            [hook],
          );
          expect(witness.rows.map((r) => r.account_id)).toEqual([accountId]);
        });
      });
    });

    it('payment_startup_guard : rend « production » (jamais NULL) ; témoin test', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, {}, async (tx) => {
          await setEnv(tx, NULL_ENV);
          const { rows } = await tx.query<{ deployment_env: string | null }>(
            'SELECT deployment_env FROM core.payment_startup_guard()',
          );
          expect(rows[0]?.deployment_env).toBe('production');
          await setEnv(tx, 'test');
          const witness = await tx.query<{ deployment_env: string | null }>(
            'SELECT deployment_env FROM core.payment_startup_guard()',
          );
          expect(witness.rows[0]?.deployment_env).toBe('test');
        });
      });
    });
  },
);
