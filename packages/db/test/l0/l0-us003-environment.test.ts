/**
 * US-003 — environnement de déploiement déclaré (migration 0050 ; 17 §6.5 point 1, C19 ; ADR-078).
 *
 * Attendus (17 §6.5 « production par défaut, fail-closed » ; reports d'US-025 et d'US-043 :
 * `platform.deployment_env()` ne rend jamais NULL) :
 * 1. Base de PRODUCTION du banc (migrations de production seules, aucune déclaration), sous
 *    `app_api` et `app_worker` : `deployment_env()` = « production », la garde de démarrage aussi ;
 *    la déclaration n'est ni lisible, ni écrite, ni modifiable par un rôle applicatif (42501), et
 *    `platform.declare_environment` ne leur est pas exécutable ; la définition de production lit
 *    la déclaration par `COALESCE(…, 'production')`.
 * 2. Base de test, job de déploiement joué par une fixture sous migrator DANS une transaction
 *    annulée (9910) : déclaration lue par la garde ; même valeur rejouée sans effet ; autre valeur,
 *    UPDATE, DELETE, TRUNCATE refusés (`environment_declared_once`, 55000) ; valeurs inconnues,
 *    « test » et NULL refusées (22023). Sous `app_worker`.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { caught } from '../support/pay.ts';

const ONCE = { code: '55000', constraint: 'environment_declared_once' };

describe('US-003 — base non déclarée : production, jamais NULL (base de production)', () => {
  for (const role of ['app_api', 'app_worker'] as const) {
    it(`${role} : deployment_env() = production ; déclaration hors d’atteinte`, async () => {
      await withRole(
        role,
        async (client) => {
          await withTestTransaction(client, {}, async (tx) => {
            const env = await tx.query<{ env: string | null; declared: string | null }>(
              `SELECT platform.deployment_env() AS env, platform.declared_environment() AS declared`,
            );
            expect(env.rows[0]).toEqual({ env: 'production', declared: null });
            const guard = await tx.query<{ deployment_env: string | null }>(
              'SELECT deployment_env FROM core.payment_startup_guard()',
            );
            expect(guard.rows[0]?.deployment_env).toBe('production');
            for (const sql of [
              'SELECT * FROM platform.environment_declaration',
              `INSERT INTO platform.environment_declaration (environment) VALUES ('preproduction')`,
              `UPDATE platform.environment_declaration SET environment = 'preproduction'`,
              'DELETE FROM platform.environment_declaration',
              `SELECT platform.declare_environment('preproduction')`,
            ]) {
              expect(await caught(tx, () => tx.query(sql)), sql).toMatchObject({ code: '42501' });
            }
          });
        },
        { database: 'production' },
      );
    });
  }

  it('définition de production : COALESCE(platform.declared_environment(), production)', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ src: string; volatility: string }>(
          `SELECT p.prosrc AS src, p.provolatile AS volatility
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'platform' AND p.proname = 'deployment_env'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.src.replace(/\s+/g, ' ').trim()).toBe(
          "SELECT COALESCE(platform.declared_environment(), 'production')",
        );
        expect(rows[0]?.volatility).toBe('s');
      },
      { database: 'production' },
    );
  });
});

async function declared(tx: pg.ClientBase): Promise<string | null> {
  const { rows } = await tx.query<{ env: string | null }>(
    'SELECT platform.declared_environment() AS env',
  );
  return rows[0]?.env ?? null;
}

describe('US-003 — déclaration unique et immuable (job de déploiement, fixture 9910)', () => {
  for (const env of ['preproduction', 'production', 'development'] as const) {
    it(`${env} : lue par la garde, rejouable, puis figée`, async () => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          expect(await declared(tx)).toBeNull();
          const first = await tx.query<{ env: string }>(
            'SELECT test_fixture.us003_declare($1) AS env',
            [env],
          );
          expect(first.rows[0]?.env).toBe(env);
          expect(await declared(tx)).toBe(env);
          // même valeur : idempotent (le job de déploiement se rejoue à chaque version)
          expect(
            await caught(tx, () => tx.query('SELECT test_fixture.us003_declare($1)', [env])),
          ).toBeNull();
          // toute autre valeur : refusée (une base de production ne devient jamais autre chose)
          for (const other of ['preproduction', 'production', 'development'].filter(
            (e) => e !== env,
          )) {
            expect(
              await caught(tx, () => tx.query('SELECT test_fixture.us003_declare($1)', [other])),
              other,
            ).toMatchObject(ONCE);
          }
          for (const op of ['UPDATE', 'DELETE', 'TRUNCATE']) {
            expect(
              await caught(tx, () => tx.query('SELECT test_fixture.us003_tamper($1)', [op])),
              op,
            ).toMatchObject(ONCE);
          }
          const row = await tx.query<{ env: string | null }>(
            'SELECT test_fixture.us003_declared() AS env',
          );
          expect(row.rows[0]?.env).toBe(env);
        });
      });
    });
  }

  it('valeurs inconnues, « test » et NULL refusées ; rien n’est déclaré', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        for (const bad of ['test', 'staging', 'PRODUCTION', '', null]) {
          expect(
            await caught(tx, () => tx.query('SELECT test_fixture.us003_declare($1)', [bad])),
            String(bad),
          ).toMatchObject({ code: '22023' });
        }
        expect(await declared(tx)).toBeNull();
      });
    });
  });
});
