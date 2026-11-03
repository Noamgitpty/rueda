/**
 * L0-06 — 17 §11 et §1.3 point 2 bis : `platform.now()`.
 * - volatilité `provolatile = 'v'` ;
 * - deux appels dans une instruction longue (`pg_sleep`) sont croissants ;
 * - l'horloge virtuelle posée par `SET LOCAL` ne fuit ni après `COMMIT` / `ROLLBACK`, ni après
 *   `RESET ALL` ;
 * - le corps de PRODUCTION (base `rueda_test_*_prod`, migrations sans test-migrations) ne
 *   référence pas `app.virtual_now`.
 * Rôles : `app_api`, `app_worker` (contrôle du corps : lecture du catalogue sous `app_api`).
 * La passe C1 / C2 / C5 / C15 sans horloge virtuelle arrive avec US-006 / US-007.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { AppRole } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import type { BenchDatabase } from '../../src/testing/index.ts';

// Milliseconde entière : la comparaison en epoch ms est exacte.
const VIRTUAL = '2031-03-14T15:09:26.535Z';
const VIRTUAL_MS = Date.parse(VIRTUAL);

interface NowDefinition {
  provolatile: string;
  prosrc: string;
  owner: string;
}

async function nowDefinition(client: pg.ClientBase): Promise<NowDefinition> {
  const { rows } = await client.query<NowDefinition>(
    `SELECT p.provolatile, p.prosrc, pg_catalog.pg_get_userbyid(p.proowner) AS owner
       FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.now()'::regprocedure`,
  );
  expect(rows).toHaveLength(1);
  return rows[0] as NowDefinition;
}

/** platform.now() en millisecondes epoch, et la valeur brute de app.virtual_now. */
async function readClock(client: pg.ClientBase): Promise<{ ms: number; setting: string | null }> {
  const { rows } = await client.query<{ ms: string; setting: string | null }>(
    `SELECT (extract(epoch FROM platform.now()) * 1000)::bigint::text AS ms,
            pg_catalog.current_setting('app.virtual_now', true) AS setting`,
  );
  return { ms: Number(rows[0]?.ms), setting: rows[0]?.setting ?? null };
}

const isRealClock = (ms: number): boolean => Math.abs(ms - Date.now()) < 120_000;

describe('L0-06 — définition de platform.now()', () => {
  for (const database of ['main', 'production'] as const satisfies readonly BenchDatabase[]) {
    it(`VOLATILE (provolatile = 'v'), propriétaire migrator — base ${database}`, async () => {
      await withRole(
        'app_api',
        async (client) => {
          const def = await nowDefinition(client);
          expect(def.provolatile).toBe('v');
          expect(def.owner).toBe('migrator');
        },
        { database },
      );
    });
  }

  it('corps de PRODUCTION : clock_timestamp, sans app.virtual_now', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const def = await nowDefinition(client);
        expect(def.prosrc).not.toMatch(/virtual_now/);
        expect(def.prosrc).toMatch(/clock_timestamp/);
      },
      { database: 'production' },
    );
  });

  it('corps de TEST (base principale) : lit app.virtual_now (la migration de test est appliquée)', async () => {
    await withRole('app_api', async (client) => {
      expect((await nowDefinition(client)).prosrc).toMatch(/app\.virtual_now/);
    });
  });
});

describe('L0-06 — deux appels dans une instruction longue sont croissants', () => {
  const cases: Array<[AppRole, BenchDatabase]> = [
    ['app_api', 'main'],
    ['app_worker', 'main'],
    ['app_api', 'production'],
    ['app_worker', 'production'],
  ];
  for (const [role, database] of cases) {
    it(`${role}, base ${database} : écart ≥ durée de pg_sleep`, async () => {
      await withRole(
        role,
        async (client) => {
          const { rows } = await client.query<{ delta: string }>(
            `SELECT extract(epoch FROM (t.b - t.a))::text AS delta
               FROM (SELECT platform.now() AS a, pg_catalog.pg_sleep(0.2) AS s,
                            platform.now() AS b) AS t`,
          );
          expect(Number(rows[0]?.delta)).toBeGreaterThanOrEqual(0.2);
        },
        { database },
      );
    });

    it(`${role}, base ${database} : strictement croissant ligne à ligne`, async () => {
      await withRole(
        role,
        async (client) => {
          const { rows } = await client.query<{ ts: string }>(
            `SELECT (extract(epoch FROM platform.now()) * 1000000)::bigint::text AS ts
               FROM generate_series(1, 5) AS g(i),
                    LATERAL (SELECT pg_catalog.pg_sleep(0.01 * g.i)) AS s`,
          );
          const values = rows.map((r) => BigInt(r.ts));
          expect(values).toHaveLength(5);
          for (let i = 1; i < values.length; i++) {
            expect(values[i]! > values[i - 1]!).toBe(true);
          }
        },
        { database },
      );
    });
  }
});

describe('L0-06 — horloge virtuelle par SET LOCAL, sans fuite', () => {
  for (const role of ['app_api', 'app_worker'] as const) {
    it(`${role} : SET LOCAL appliqué dans la transaction, absent après COMMIT`, async () => {
      await withRole(role, async (client) => {
        const inside = await withTestTransaction(
          client,
          { virtualNow: VIRTUAL, commit: true },
          async (tx) => readClock(tx),
        );
        expect(inside.ms).toBe(Math.floor(VIRTUAL_MS));
        const after = await readClock(client);
        expect(after.setting ?? '').toBe('');
        expect(isRealClock(after.ms)).toBe(true);
      });
    });

    it(`${role} : absent après ROLLBACK ; deux transactions successives ne se voient pas`, async () => {
      await withRole(role, async (client) => {
        await withTestTransaction(client, { virtualNow: VIRTUAL }, async (tx) => {
          expect((await readClock(tx)).ms).toBe(Math.floor(VIRTUAL_MS));
        });
        // Transaction suivante, même connexion, sans horloge virtuelle : la fenêtre réelle est
        // vérifiée par le harnais lui-même (withTestTransaction sans virtualNow).
        await withTestTransaction(client, {}, async (tx) => {
          expect(isRealClock((await readClock(tx)).ms)).toBe(true);
        });
      });
    });
  }

  it('SET LOCAL hors transaction explicite ne dure pas au-delà de l’instruction', async () => {
    await withRole('app_api', async (client) => {
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [VIRTUAL]);
      expect(isRealClock((await readClock(client)).ms)).toBe(true);
    });
  });

  it('un SET de session (à proscrire) est effacé par RESET ALL à la restitution', async () => {
    await withRole('app_api', async (client) => {
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, false)`, [VIRTUAL]);
      expect((await readClock(client)).ms).toBe(Math.floor(VIRTUAL_MS));
      await client.query('RESET ALL');
      const after = await readClock(client);
      expect(after.setting ?? '').toBe('');
      expect(isRealClock(after.ms)).toBe(true);
    });
  });

  it('le harnais refuse une connexion dont l’horloge est restée virtuelle', async () => {
    await withRole('app_api', async (client) => {
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, false)`, [VIRTUAL]);
      await expect(withTestTransaction(client, {}, async () => undefined)).rejects.toThrow(
        /hors de la fenêtre attendue/,
      );
      // withTestTransaction a fait RESET ALL en sortie : l'horloge est revenue au réel.
      expect(isRealClock((await readClock(client)).ms)).toBe(true);
    });
  });

  it('base de production : app.virtual_now posé n’a aucun effet', async () => {
    await withRole(
      'app_api',
      async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            VIRTUAL,
          ]);
          const clock = await readClock(client);
          expect(clock.setting).toBe(VIRTUAL);
          expect(isRealClock(clock.ms)).toBe(true);
        } finally {
          await client.query('ROLLBACK');
        }
      },
      { database: 'production' },
    );
  });
});
