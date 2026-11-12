/**
 * US-049 — red team « concurrence » : interrupteurs de mise en service (17 §0.1, RLS-27), horloge
 * applicative contre `platform.now()` (CLAUDE.md point 5, ADR-030) et rejeu de la file SQL
 * (ADR-050 ; 17 §4.2 : la file est en SQL, pg-boss n'est pas utilisé).
 *
 * Règle de l'axe : AUCUN interrupteur n'est jamais mis à true durablement. Les tentatives
 * d'écriture à true se font dans une transaction ANNULÉE (`inTx` sans `commit`) sur la base de test ;
 * un test rouge signifierait qu'un acteur seul y est parvenu, et la transaction est annulée quand
 * même. Depuis US-125 (migration 0073), la SEULE voie d'écriture est la paire de commandes à deux
 * personnes `core.config_cmd_request_go_live_switch` / `core.config_cmd_approve_go_live_switch` :
 * on prouve qu'aucune autre voie n'existe, pour aucun rôle, aucun contexte, aucune astuce de
 * session (RT-CONC-21 à 23), puis que la paire refuse un acteur seul et la même personne deux fois
 * et n'accepte que deux personnes (RT-CONC-24, transaction annulée), une seule fois sous
 * concurrence (RT-CONC-25, demande à false : aucun interrupteur ne s'ouvre).
 * Rôles de production seulement (assertion L0-05 par connectAs / withRole). USD (PA) et PYG (PY).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../../src/testing/index.ts';
import { COUNTRIES, inTx } from '../../support/avl.ts';
import { Barrier } from '../../support/concurrency.ts';
import {
  claimJobs,
  enqueue,
  failJob,
  insertEvent,
  outboxTx,
  uuid,
  workerName,
} from '../../support/outbox.ts';
import type { EventCountry } from '../../support/outbox.ts';
import { at, LONG } from './support.ts';
import {
  DECISION,
  approveSwitch,
  freshSession,
  goLive,
  requestSwitch,
} from '../../support/golive.ts';
import type { StaffActor } from '../../support/golive.ts';
import { staff, staffSessionHash } from '../../support/rls.ts';

/** Les quatre interrupteurs de mise en service (CLAUDE.md point 7 ; 17 §0.1). */
const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
] as const;

let api: pg.Client;
let worker: pg.Client;

beforeEach(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterEach(async () => {
  await releaseClient(worker);
  await releaseClient(api);
});

const code = (error: unknown): string => (error as { code?: string }).code ?? 'SANS_CODE';

/** Exécute une instruction dans une transaction ANNULÉE ; renvoie le SQLSTATE ou `EXÉCUTÉ:n`. */
async function attemptRolledBack(
  client: pg.ClientBase,
  prepare: (tx: pg.ClientBase) => Promise<void>,
  sql: string,
  args: unknown[] = [],
): Promise<string> {
  try {
    return await inTx(client, {}, async (tx) => {
      await prepare(tx);
      const r = await tx.query(sql, args);
      return `EXÉCUTÉ:${r.rowCount ?? 0}`;
    });
  } catch (error) {
    return code(error);
  }
}

const noPrepare = (): Promise<void> => Promise.resolve();

describe.each(COUNTRIES)(
  'US-049 red team concurrence — interrupteurs ($country, $currency)',
  (c) => {
    it(
      'RT-CONC-20 : les quatre interrupteurs valent false pour app_api et app_worker, maintenant et à toute date future ; app_anon ne peut pas les lire',
      async () => {
        for (const when of [undefined, '2060-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z']) {
          for (const client of [api, worker]) {
            await inTx(
              client,
              { ...(when !== undefined ? { virtualNow: when } : {}) },
              async (tx) => {
                for (const key of SWITCHES) {
                  const { rows } = await tx.query<{ on: boolean }>(
                    'SELECT core.config_go_live($1, $2) AS "on"',
                    [key, c.country],
                  );
                  expect(rows[0]?.on, `${key} ${c.country} ${when ?? 'maintenant'}`).toBe(false);
                }
              },
            );
          }
        }
        const anon = await connectAs('app_anon');
        try {
          expect(
            await attemptRolledBack(anon, noPrepare, 'SELECT core.config_go_live($1, $2)', [
              SWITCHES[0],
              c.country,
            ]),
          ).toBe('42501');
        } finally {
          await releaseClient(anon);
        }
      },
      LONG,
    );

    it(
      'RT-CONC-21 : écriture directe d’un interrupteur à true (INSERT, upsert, UPDATE, DELETE, variantes de casse et de type) par tout rôle et tout contexte forgé ⇒ refusée ; transaction annulée',
      async () => {
        const key = SWITCHES[0];
        const insert = (valueSql: string, keySql = '$1'): string =>
          `INSERT INTO core.config_param_value
                (key, country_code, scope_type, scope_id, network, value, valid_from, change_reason)
         VALUES (${keySql}, $2, 'COUNTRY', NULL, NULL, ${valueSql}, platform.now() + interval '1 second', 'red team')`;
        const attacks: [string, string, unknown[]][] = [
          ['INSERT true', insert(`'true'::jsonb`), [key, c.country]],
          ['upsert true', `${insert(`'true'::jsonb`)} ON CONFLICT DO NOTHING`, [key, c.country]],
          [
            'INSERT true, clé en majuscules',
            insert(`'true'::jsonb`, '$1'),
            [key.toUpperCase(), c.country],
          ],
          ['INSERT "true" (chaîne)', insert(`'"true"'::jsonb`), [key, c.country]],
          ['INSERT 1 (nombre)', insert(`'1'::jsonb`), [key, c.country]],
          [
            'INSERT … SELECT true',
            `INSERT INTO core.config_param_value
                  (key, country_code, scope_type, scope_id, network, value, valid_from, change_reason)
           SELECT key, $2, 'COUNTRY', NULL, NULL, 'true'::jsonb, platform.now() + interval '1 second', 'red team'
             FROM core.config_param_definition WHERE key = $1`,
            [key, c.country],
          ],
          [
            'UPDATE de la valeur courante vers true',
            `UPDATE core.config_param_value SET value = 'true'::jsonb WHERE key = $1 AND country_code = $2`,
            [key, c.country],
          ],
          [
            'UPDATE de toutes les valeurs de la clé',
            `UPDATE core.config_param_value SET value = 'true'::jsonb WHERE key = ANY ($1::text[])`,
            [[...SWITCHES]],
          ],
          [
            'DELETE de la valeur false puis lecture',
            `DELETE FROM core.config_param_value WHERE key = $1 AND country_code = $2`,
            [key, c.country],
          ],
          ['TRUNCATE de la table des valeurs', `TRUNCATE core.config_param_value`, []],
          [
            'bascule de go_live_switch dans la définition',
            `UPDATE core.config_param_definition SET go_live_switch = false WHERE key = $1`,
            [key],
          ],
          [
            'suppression de la définition',
            `DELETE FROM core.config_param_definition WHERE key = $1`,
            [key],
          ],
        ];
        // `EXÉCUTÉ:0` : aucune ligne touchée (aucun effet) ; tout `EXÉCUTÉ:n` avec n > 0 est une faille
        const refusals = ['42501', '23514', '23503', '22P02', '42P10', 'EXÉCUTÉ:0'];
        const WORKERS = [
          'booking_conversion',
          'hold_expiry',
          'trip_lifecycle',
          'webhook_ingest',
          'payment_command',
          'outbox_relay',
        ];
        const anon = await connectAs('app_anon');
        try {
          for (const [label, sql, args] of attacks) {
            const results: [string, string][] = [
              ['app_api sans contexte', await attemptRolledBack(api, noPrepare, sql, args)],
              [
                'app_api STAFF forgé',
                await attemptRolledBack(
                  api,
                  (tx) =>
                    setSessionContext(tx, {
                      kind: 'STAFF',
                      actorId: uuid(),
                      countryScope: [c.country],
                      sessionTokenHash: 'a'.repeat(64),
                    }),
                  sql,
                  args,
                ),
              ],
              ['app_worker sans contexte', await attemptRolledBack(worker, noPrepare, sql, args)],
              ['app_anon', await attemptRolledBack(anon, noPrepare, sql, args)],
            ];
            for (const n of WORKERS) {
              results.push([
                `app_worker/${n}`,
                await attemptRolledBack(
                  worker,
                  async (tx) => {
                    await tx.query(
                      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                            pg_catalog.set_config('app.worker_name', $1, true)`,
                      [n],
                    );
                  },
                  sql,
                  args,
                ),
              ]);
            }
            for (const [who, outcome] of results) {
              expect(refusals, `${label} — ${who} : ${outcome}`).toContain(outcome);
            }
          }
        } finally {
          await releaseClient(anon);
        }
        // rien n'a été écrit : le droit de test de app_worker n'a servi à rien, tout reste à false
        for (const k of SWITCHES) {
          const { rows } = await api.query<{ on: boolean }>(
            'SELECT core.config_go_live($1, $2) AS "on"',
            [k, c.country],
          );
          expect(rows[0]?.on).toBe(false);
        }
      },
      LONG,
    );

    it(
      'RT-CONC-22 : désactiver les gardes (session_replication_role, DISABLE TRIGGER, REPLACE de la garde, SET ROLE vers un propriétaire) ⇒ refusé (42501)',
      async () => {
        // doivent être REFUSÉS (42501) : aucune de ces désactivations n'est permise à un rôle applicatif
        const disablers: [string, string][] = [
          ['replica', `SET LOCAL session_replication_role = 'replica'`],
          ['DISABLE TRIGGER ALL', `ALTER TABLE core.config_param_value DISABLE TRIGGER ALL`],
          ['DISABLE RLS', `ALTER TABLE core.config_param_value DISABLE ROW LEVEL SECURITY`],
          ['NO FORCE RLS', `ALTER TABLE core.config_param_value NO FORCE ROW LEVEL SECURITY`],
          [
            'REPLACE de la garde',
            `CREATE OR REPLACE FUNCTION core.config_param_value_guard() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$`,
          ],
          ['SET ROLE migrator', `SET LOCAL ROLE migrator`],
          ['SET ROLE propriétaire des commandes de hold', `SET LOCAL ROLE cmd_hold_owner`],
          ['SET ROLE propriétaire des commandes monétaires', `SET LOCAL ROLE cmd_money_owner`],
          ['SET ROLE propriétaire des interrupteurs', `SET LOCAL ROLE cmd_golive_owner`],
        ];
        for (const client of [api, worker]) {
          for (const [label, disable] of disablers) {
            expect(await attemptRolledBack(client, noPrepare, disable), label).toBe('42501');
          }
        }
      },
      LONG,
    );

    it(
      'RT-CONC-23 : base de production (migrations seules) — aucun rôle applicatif n’écrit config_param_value ni ne l’altère ; aucun SECURITY DEFINER n’y écrit ; aucun rôle n’hérite d’un propriétaire',
      async () => {
        for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
          await withRole(
            role,
            async (client) => {
              // app_anon n'a même pas l'usage du schéma core : la vérification elle-même est refusée
              const priv = await client
                .query<{ w: boolean; d: boolean; u: boolean; t: boolean }>(
                  `SELECT has_table_privilege(current_user, 'core.config_param_value', 'INSERT') AS w,
                      has_table_privilege(current_user, 'core.config_param_value', 'DELETE') AS d,
                      has_table_privilege(current_user, 'core.config_param_value', 'UPDATE') AS u,
                      has_table_privilege(current_user, 'core.config_param_value', 'TRUNCATE') AS t`,
                )
                .then(
                  (r) => r.rows[0],
                  (e: unknown) => code(e),
                );
              expect(priv, `${role} sur la base de production`).toEqual(
                role === 'app_anon' ? '42501' : { w: false, d: false, u: false, t: false },
              );
              const members = await client.query<{ rolname: string }>(
                `SELECT r.rolname FROM pg_roles r
                WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')
                  AND (r.rolname ~ '(_owner$|^migrator$)' OR r.rolsuper OR r.rolbypassrls
                       OR r.rolcreaterole OR r.rolcreatedb)`,
              );
              expect(members.rows, `${role} : appartenances dangereuses`).toEqual([]);
            },
            { database: 'production' },
          );
        }
        await withRole(
          'app_api',
          async (client) => {
            // fonctions qui écrivent dans la table des valeurs (hors schémas de test, absents ici)
            const writers = await client.query<{ fn: string }>(
              `SELECT n.nspname || '.' || p.proname AS fn
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(core\\.)?config_param_value'
                AND p.proname <> 'config_param_value_guard'`,
            );
            // US-125 : la seule fonction qui écrit la table est l'approbation à deux personnes
            expect(writers.rows, 'fonctions écrivant config_param_value').toEqual([
              { fn: 'core.config_cmd_approve_go_live_switch' },
            ]);
            // fonctions « go live » : la lecture (invocateur), les gardes (invocateur, aucune écriture)
            // et les deux commandes, SECURITY DEFINER, exécutables par app_api seulement
            const fns = await client.query<{
              fn: string;
              secdef: boolean;
              worker: boolean;
              anon: boolean;
              api: boolean;
            }>(
              `SELECT p.proname AS fn, p.prosecdef AS secdef,
                    has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                    has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                    has_function_privilege('app_api', p.oid, 'EXECUTE') AS api
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND p.proname ~* 'go_live|golive'
              ORDER BY 1`,
            );
            const INVOKER = new Set([
              'config_go_live',
              'config_go_live_request_guard',
              'config_go_live_write_refusal',
              'config_param_value_go_live_guard',
            ]);
            expect(fns.rows.map((f) => f.fn).sort()).toEqual(
              [
                ...INVOKER,
                'config_cmd_approve_go_live_switch',
                'config_cmd_request_go_live_switch',
              ].sort(),
            );
            for (const f of fns.rows) {
              if (INVOKER.has(f.fn)) {
                expect(f.secdef, `${f.fn} doit rester SECURITY INVOKER`).toBe(false);
                continue;
              }
              expect(f.secdef, `${f.fn} doit être SECURITY DEFINER`).toBe(true);
              expect(f.api, `${f.fn} exécutable par app_api`).toBe(true);
              expect(f.worker, `${f.fn} exécutable par app_worker`).toBe(false);
              expect(f.anon, `${f.fn} exécutable par app_anon`).toBe(false);
            }
            // le déclencheur de garde existe, est actif (origine) sur INSERT / UPDATE / DELETE / TRUNCATE
            const triggers = await client.query<{
              tgname: string;
              tgenabled: string;
              tgtype: number;
            }>(
              `SELECT tgname, tgenabled, tgtype FROM pg_trigger
              WHERE tgrelid = 'core.config_param_value'::regclass AND NOT tgisinternal ORDER BY 1`,
            );
            expect(triggers.rows.length).toBeGreaterThanOrEqual(3);
            expect(triggers.rows.map((t) => t.tgname)).toContain('param_value_go_live_guard');
            expect(triggers.rows.every((t) => t.tgenabled === 'O')).toBe(true);
          },
          { database: 'production' },
        );
      },
      LONG,
    );

    it(
      'RT-CONC-24 (US-125, S-04) : un acteur seul, la même personne deux fois (seconde session, acteur forgé), puis deux personnes distinctes ; transaction annulée',
      async () => {
        const [superB, superC] = await twoSuperadmins(api, c.country);
        await inTx(api, {}, async (tx) => {
          const r = await requestSwitch(tx, superB, 'payouts_enabled', c.country, true);
          expect(r.outcome).toBe('REQUESTED');
          const id = r.request_id as string;
          // un acteur seul
          expect((await approveSwitch(tx, superB, id)).outcome).toBe('SELF_APPROVAL');
          // la même personne deux fois : seconde session, puis identifiant de superC forgé
          const second = await freshSession(tx, superB);
          expect((await approveSwitch(tx, second, id)).outcome).toBe('SELF_APPROVAL');
          expect((await approveSwitch(tx, superB, id, superC.userId)).outcome).toBe(
            'SELF_APPROVAL',
          );
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
          // deux personnes
          expect((await approveSwitch(tx, superC, id)).outcome).toBe('APPLIED');
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
        });
        for (const k of SWITCHES) expect(await goLive(api, k, c.country), k).toBe(false);
      },
      LONG,
    );

    it(
      'RT-CONC-25 (US-125) : deux approbations concurrentes de la même demande par deux SUPERADMIN ⇒ une seule appliquée, l’autre NOT_PENDING (demande à false : aucun interrupteur ne s’ouvre)',
      async () => {
        const [superB, superC] = await twoSuperadmins(api, c.country);
        const superD = (await twoSuperadmins(api, c.country))[0];
        const id = await inTx(api, { commit: true }, async (tx) => {
          const r = await requestSwitch(tx, superB, 'funds_holding_enabled', c.country, false);
          expect(r.outcome).toBe('REQUESTED');
          return r.request_id as string;
        });
        const first = await connectAs('app_api');
        const second = await connectAs('app_api');
        try {
          const barrier = await Barrier.open(api);
          const race = [
            [first, superC],
            [second, superD],
          ].map(async ([conn, who]) => {
            await barrier.wait(conn as pg.Client);
            return inTx(conn as pg.Client, { commit: true }, async (tx) =>
              approveSwitch(tx, who as StaffActor, id),
            );
          });
          await barrier.waitForWaiters(2);
          await barrier.release();
          const outcomes = (await Promise.all(race)).map((o) => o.outcome).sort();
          expect(outcomes).toEqual(['APPLIED', 'NOT_PENDING']);
        } finally {
          await releaseClient(second);
          await releaseClient(first);
        }
        const { rows } = await api.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.config_param_value
            WHERE key = 'funds_holding_enabled' AND country_code = $1 AND decision_ref = $2
              AND value = 'false'::jsonb`,
          [c.country, DECISION],
        );
        expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
        for (const k of SWITCHES) expect(await goLive(api, k, c.country), k).toBe(false);
      },
      LONG,
    );
  },
);

/** Deux SUPERADMIN du pays, sessions élevées, validés (base de test). */
async function twoSuperadmins(
  client: pg.Client,
  country: string,
): Promise<[StaffActor, StaffActor]> {
  return inTx(client, { commit: true }, async (tx) => {
    const out: StaffActor[] = [];
    for (let i = 0; i < 2; i++) {
      const id = await staff(tx, 'SUPERADMIN', [country]);
      out.push({
        userId: id,
        hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'),
        scope: [country],
      });
    }
    return out as [StaffActor, StaffActor];
  });
}

describe('US-049 red team concurrence — horloge applicative contre platform.now()', () => {
  it(
    'RT-CONC-30 : base de production — GUC de session ou de transaction, search_path, fonction temporaire détournée, ALTER ROLE / DATABASE / FUNCTION ⇒ platform.now() reste clock_timestamp() et deployment_env reste production',
    async () => {
      for (const role of ['app_api', 'app_worker'] as const) {
        await withRole(
          role,
          async (client) => {
            const readBoth = async (): Promise<{ ms: number; env: string }> => {
              const { rows } = await client.query<{ ms: string; env: string }>(
                `SELECT (extract(epoch FROM platform.now()) * 1000)::bigint::text AS ms,
                        platform.deployment_env() AS env`,
              );
              return { ms: Number(rows[0]?.ms), env: rows[0]?.env as string };
            };
            const real = (ms: number): boolean => Math.abs(ms - Date.now()) < 120_000;
            for (const local of [false, true]) {
              await client.query('BEGIN');
              try {
                for (const [name, value] of [
                  ['app.virtual_now', '2031-03-14T15:09:26.535Z'],
                  ['app.virtual_now', '1999-01-01T00:00:00Z'],
                  ['app.test_deployment_env', 'development'],
                  ['app.test_deployment_env', 'test'],
                  ['app.deployment_env', 'development'],
                  ['app.environment', 'development'],
                ] as const) {
                  await client.query('SELECT pg_catalog.set_config($1, $2, $3)', [
                    name,
                    value,
                    local,
                  ]);
                }
                const now = await readBoth();
                expect(real(now.ms), `${role} local=${String(local)} : horloge`).toBe(true);
                expect(now.env, `${role} local=${String(local)} : environnement`).toBe(
                  'production',
                );
              } finally {
                await client.query('ROLLBACK');
                await client.query('RESET ALL');
              }
            }
            // détournement par pg_temp : une fonction temporaire clock_timestamp / now doit rester sans effet
            await client.query('BEGIN');
            try {
              let created = true;
              try {
                await client.query(
                  `CREATE FUNCTION pg_temp.clock_timestamp() RETURNS timestamptz LANGUAGE sql
                     AS $f$ SELECT '2001-01-01'::timestamptz $f$`,
                );
                await client.query(
                  `CREATE FUNCTION pg_temp.declared_environment() RETURNS text LANGUAGE sql
                     AS $f$ SELECT 'development'::text $f$`,
                );
              } catch (error) {
                created = false; // TEMP refusé : détournement impossible a fortiori
                await client.query('ROLLBACK');
                expect(code(error)).toBe('42501');
                await client.query('BEGIN');
              }
              await client.query(`SET LOCAL search_path = pg_temp, public`);
              const now = await readBoth();
              expect(real(now.ms), `${role} pg_temp (créée : ${String(created)})`).toBe(true);
              expect(now.env).toBe('production');
            } finally {
              await client.query('ROLLBACK');
              await client.query('RESET ALL');
            }
            // altérations persistantes de l'horloge ou de l'environnement : toutes refusées
            const ddl = [
              `ALTER FUNCTION platform.now() SET search_path = pg_temp`,
              `ALTER FUNCTION platform.deployment_env() SET search_path = pg_temp`,
              `CREATE OR REPLACE FUNCTION platform.now() RETURNS timestamptz LANGUAGE sql AS 'SELECT now()'`,
              `DO $d$ BEGIN EXECUTE format('ALTER DATABASE %I SET app.virtual_now = %L', current_database(), '2031-01-01T00:00:00Z'); END $d$`,
              `INSERT INTO platform.environment_declaration (environment) VALUES ('development')`,
              `UPDATE platform.environment_declaration SET environment = 'development'`,
            ];
            for (const sql of ddl) {
              expect(await attemptRolledBack(client, noPrepare, sql), `${role} : ${sql}`).toBe(
                '42501',
              );
            }
            expect(real((await readBoth()).ms)).toBe(true);
          },
          { database: 'production' },
        );
      }
    },
    LONG,
  );
});

describe.each(COUNTRIES)(
  'US-049 red team concurrence — file SQL rejouée ($country, $currency)',
  (c) => {
    const country: EventCountry = {
      country: c.country,
      currency: c.currency,
      amountMinor: c.rentMinor,
    };

    it(
      'RT-CONC-40 : bail expiré puis tâche réclamée par un second travailleur ⇒ les deux traitent, un seul reçu l’emporte (effet unique) ; rejeu du reçu et de la tâche terminée sans effet',
      async () => {
        const consumer = workerName('rt_lease');
        const T0 = '2045-06-01T10:00:00.000Z';
        const ev = await outboxTx(
          api,
          { actor: 'GUEST', commit: true },
          async (tx) => (await insertEvent(tx, country)).id,
        );
        await outboxTx(worker, { worker: consumer, virtualNow: T0, commit: true }, (tx) =>
          enqueue(tx, consumer, { eventId: ev }),
        );
        // A réclame (bail d'une minute) puis « meurt » ; B réclame après l'expiration du bail
        const a = await outboxTx(worker, { worker: consumer, virtualNow: T0, commit: true }, (tx) =>
          claimJobs(tx, 10, '60 seconds'),
        );
        expect(a).toHaveLength(1);
        const early = await outboxTx(
          worker,
          { worker: consumer, virtualNow: at(T0, 0.5), commit: true },
          (tx) => claimJobs(tx, 10, '60 seconds'),
        );
        expect(early, 'bail encore valide : personne d’autre ne réclame').toEqual([]);
        const b = await outboxTx(
          worker,
          { worker: consumer, virtualNow: at(T0, 2), commit: true },
          (tx) => claimJobs(tx, 10, '60 seconds'),
        );
        expect(b.map((j) => [j.id, j.attempts])).toEqual([[a[0]?.id, 2]]);

        // les deux travailleurs tentent le reçu : exactement un l'obtient
        const w2 = await connectAs('app_worker');
        try {
          const [first, second] = await Promise.all([
            outboxTx(
              worker,
              { worker: consumer, virtualNow: at(T0, 3), commit: true },
              async (tx) => {
                const r = await tx.query<{ fresh: boolean }>(
                  'SELECT core.outbox_begin_receipt($1) AS fresh',
                  [ev],
                );
                return r.rows[0]?.fresh;
              },
            ),
            outboxTx(w2, { worker: consumer, virtualNow: at(T0, 3), commit: true }, async (tx) => {
              const r = await tx.query<{ fresh: boolean }>(
                'SELECT core.outbox_begin_receipt($1) AS fresh',
                [ev],
              );
              return r.rows[0]?.fresh;
            }),
          ]);
          expect([first, second].sort()).toEqual([false, true]);
        } finally {
          await releaseClient(w2);
        }
        // la tâche terminée ne se réclame plus, ne se termine pas deux fois ; le reçu ne se rejoue pas
        await outboxTx(
          worker,
          { worker: consumer, virtualNow: at(T0, 4), commit: true },
          async (tx) => {
            const done = await tx.query<{ ok: boolean }>(
              'SELECT core.outbox_complete_job($1) AS ok',
              [a[0]?.id],
            );
            expect(done.rows[0]?.ok).toBe(true);
            const again = await tx.query<{ ok: boolean }>(
              'SELECT core.outbox_complete_job($1) AS ok',
              [a[0]?.id],
            );
            expect(again.rows[0]?.ok).toBe(false);
            const receipt = await tx.query<{ fresh: boolean }>(
              'SELECT core.outbox_begin_receipt($1) AS fresh',
              [ev],
            );
            expect(receipt.rows[0]?.fresh).toBe(false);
          },
        );
        expect(
          await outboxTx(worker, { worker: consumer, virtualNow: at(T0, 60), commit: true }, (tx) =>
            claimJobs(tx, 10, '60 seconds'),
          ),
        ).toEqual([]);
      },
      LONG,
    );

    it(
      'RT-CONC-41 : un autre travailleur ne réclame, ne termine ni n’échoue la tâche d’autrui ; lettre morte non rejouable ; 6 ajouts simultanés de la même clé ⇒ une seule tâche',
      async () => {
        const owner = workerName('rt_owner');
        const thief = workerName('rt_thief');
        const T0 = '2045-06-02T10:00:00.000Z';
        const ev = await outboxTx(
          api,
          { actor: 'GUEST', commit: true },
          async (tx) => (await insertEvent(tx, country)).id,
        );
        await outboxTx(worker, { worker: owner, virtualNow: T0, commit: true }, (tx) =>
          enqueue(tx, owner, { eventId: ev, maxAttempts: 1 }),
        );
        const stolen = await outboxTx(
          worker,
          { worker: thief, virtualNow: at(T0, 1), commit: true },
          (tx) => claimJobs(tx, 10, '60 seconds'),
        );
        expect(stolen).toEqual([]);
        const mine = await outboxTx(
          worker,
          { worker: owner, virtualNow: at(T0, 1), commit: true },
          (tx) => claimJobs(tx, 10, '60 seconds'),
        );
        expect(mine).toHaveLength(1);
        const jobId = mine[0]?.id as string;
        await outboxTx(
          worker,
          { worker: thief, virtualNow: at(T0, 2), commit: true },
          async (tx) => {
            const done = await tx.query<{ ok: boolean }>(
              'SELECT core.outbox_complete_job($1) AS ok',
              [jobId],
            );
            expect(done.rows[0]?.ok).toBe(false);
            expect(await failJob(tx, jobId)).toBe('NOT_FOUND');
          },
        );
        // dernière tentative échouée ⇒ lettre morte ; rejouer l'échec ou la terminaison n'a aucun effet
        await outboxTx(
          worker,
          { worker: owner, virtualNow: at(T0, 3), commit: true },
          async (tx) => {
            expect(await failJob(tx, jobId)).toBe('DEAD_LETTER');
            expect(await failJob(tx, jobId)).toBe('NOT_FOUND');
            const done = await tx.query<{ ok: boolean }>(
              'SELECT core.outbox_complete_job($1) AS ok',
              [jobId],
            );
            expect(done.rows[0]?.ok).toBe(false);
            const dead = await tx.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM core.outbox_dead_letter WHERE job_id = $1',
              [jobId],
            );
            expect(dead.rows[0]?.n).toBe(1);
          },
        );
        expect(
          await outboxTx(worker, { worker: owner, virtualNow: at(T0, 600), commit: true }, (tx) =>
            claimJobs(tx, 10, '60 seconds'),
          ),
        ).toEqual([]);

        // fan-out simultané de la même clé singleton : une seule tâche naît
        const queue = workerName('rt_single');
        const observer = await connectAs('app_api');
        const sessions = await Promise.all(
          Array.from({ length: 6 }, () => connectAs('app_worker')),
        );
        try {
          const barrier = await Barrier.open(observer);
          const runs = sessions.map(async (session) => {
            await barrier.wait(session);
            return outboxTx(session, { worker: queue, virtualNow: T0, commit: true }, (tx) =>
              enqueue(tx, queue, { singletonKey: 'timer-rt' }),
            ).catch(() => false);
          });
          try {
            await barrier.waitForWaiters(sessions.length);
          } finally {
            await barrier.release();
          }
          const added = await Promise.all(runs);
          expect(added.filter(Boolean)).toHaveLength(1);
        } finally {
          await Promise.all([...sessions, observer].map((s) => releaseClient(s)));
        }
      },
      LONG,
    );
  },
);
