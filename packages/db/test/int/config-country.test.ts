/**
 * US-013 — configuration pays en base (migrations 0008 et 0009) : RLS, droits, graines PA / PY,
 * interrupteurs fail-closed, non-rétroactivité (PARAM_RETROACTIVE), immuabilité, tzdata de
 * PostgreSQL (17 §1.3, ADR-019). Tout tourne sous les rôles de production (assertion L0-05 en
 * tête, via withRole). Attentes : 17 §1.2, §1.3, §7.2 ; 08 BR-CXL-13 ; données CFG pour les comptes.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';

const dataDir = new URL('../../../../apps/api/src/modules/cfg/data/', import.meta.url);
const readData = <T>(file: string): T =>
  JSON.parse(readFileSync(new URL(file, dataDir), 'utf8')) as T;

interface ParamsDoc {
  params: Array<{ key: string; values: Record<string, unknown>; scoped?: unknown[] }>;
}
interface CountriesDoc {
  countries: Array<{
    code: string;
    timeZone: string;
    timeZoneChecks: Array<{ instant: string; offsetMinutes: number }>;
  }>;
}

const TABLES = [
  'config_currency',
  'config_country',
  'config_param_definition',
  'config_param_value',
  'config_holiday_calendar',
  'pricing_tax_line_config',
  'finance_legal_entity',
];
const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
];
// Horloge virtuelle postérieure aux graines (posées à l'heure réelle de la migration).
const VIRTUAL_NOW = '2030-01-01T00:00:00.000Z';

async function expectSqlError(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
  expected: { code: string; message?: string },
): Promise<void> {
  await client.query('SAVEPOINT expect_error');
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expect_error');
    expect(error).toMatchObject(expected);
    return;
  }
  throw new Error(`erreur attendue (${expected.code}) non levée : ${sql}`);
}

/** Hors transaction (autocommit) : l'erreur attendue n'exige pas de point de sauvegarde. */
async function expectAutocommitError(
  client: pg.ClientBase,
  sql: string,
  expected: { code: string; message?: string },
): Promise<void> {
  await expect(client.query(sql)).rejects.toMatchObject(expected);
}

const INSERT_VALUE = `INSERT INTO core.config_param_value
  (key, country_code, scope_type, value, valid_from, change_reason, currency)
  VALUES ($1, $2, 'COUNTRY', $3::jsonb, $4::timestamptz, 'test US-013', $5)
  RETURNING valid_from, currency`;

describe('configuration pays : structure et droits', () => {
  it('RLS ENABLE + FORCE sur chaque table, propriétaire migrator', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        t: string;
        rls: boolean;
        force: boolean;
        owner: string;
      }>(
        `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY($1::text[]) ORDER BY 1`,
        [TABLES],
      );
      expect(rows).toEqual(
        [...TABLES].sort().map((t) => ({ t, rls: true, force: true, owner: 'migrator' })),
      );
    });
  });

  it.each(['main', 'production'] as const)(
    'base %s : app_api lit, n’écrit rien',
    async (database) => {
      await withRole(
        'app_api',
        async (client) => {
          const { rows } = await client.query<{
            t: string;
            sel: boolean;
            ins: boolean;
            upd: boolean;
            del: boolean;
          }>(
            `SELECT t, has_table_privilege('core.' || t, 'SELECT') AS sel,
                  has_table_privilege('core.' || t, 'INSERT') AS ins,
                  has_table_privilege('core.' || t, 'UPDATE') AS upd,
                  has_table_privilege('core.' || t, 'DELETE') AS del
             FROM unnest($1::text[]) AS t ORDER BY 1`,
            [TABLES],
          );
          for (const row of rows) {
            // US-012 (report US-011) : config_param_value se lit par colonnes, sans approved_by
            const sel = row.t !== 'config_param_value';
            expect(row, row.t).toMatchObject({ sel, ins: false, upd: false, del: false });
          }
          const { rows: cols } = await client.query<{ col: string }>(
            `SELECT a.attname::text AS col
               FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = 'core.config_param_value'::regclass AND a.attnum > 0
                AND NOT a.attisdropped
                AND NOT pg_catalog.has_column_privilege('app_api', a.attrelid, a.attnum, 'SELECT')`,
          );
          // identifiant du personnel : jamais lisible par app_api
          expect(cols.map((c) => c.col)).toEqual(['approved_by']);
        },
        { database },
      );
    },
  );

  it('base de production : app_worker n’écrit pas non plus (le droit de 9100 est de test seulement)', async () => {
    await withRole(
      'app_worker',
      async (client) => {
        const { rows } = await client.query<{ w: boolean }>(
          `SELECT bool_or(has_table_privilege('core.' || t, 'INSERT')
                       OR has_table_privilege('core.' || t, 'UPDATE')
                       OR has_table_privilege('core.' || t, 'DELETE')
                       OR has_table_privilege('core.' || t, 'TRUNCATE')) AS w
             FROM unnest($1::text[]) AS t`,
          [TABLES],
        );
        expect(rows[0]?.w).toBe(false);
        await expectAutocommitError(client, `DELETE FROM core.config_param_value`, {
          code: '42501',
        });
      },
      { database: 'production' },
    );
  });

  it('base de production : seules les politiques migrator_all et app_read (SELECT) existent, plus la lecture du tampon par cmd_hold_owner et celle des codes pays par iam_staff_owner (US-012)', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ t: string; pol: string; cmd: string; roles: string }>(
          `SELECT c.relname AS t, p.polname AS pol, p.polcmd::text AS cmd,
                  pg_catalog.array_to_string(ARRAY(
                    SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                      FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',') AS roles
             FROM pg_catalog.pg_policy p
             JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'core' AND c.relname = ANY($1::text[])
            ORDER BY 1, 2`,
          [TABLES],
        );
        expect(rows).toEqual(
          [...TABLES].sort().flatMap((t) => [
            { t, pol: 'app_read', cmd: 'r', roles: 'app_api,app_worker' },
            // commandes d'occupation (0032, US-022) : clé buffer_minutes seulement, en lecture
            ...(t === 'config_param_value'
              ? [{ t, pol: 'cmd_hold_read', cmd: 'r', roles: 'cmd_hold_owner' }]
              : []),
            // console interne (US-012) : codes pays, pour borner la lecture du journal
            ...(t === 'config_country'
              ? [{ t, pol: 'iam_staff_select', cmd: 'r', roles: 'iam_staff_owner' }]
              : []),
            { t, pol: 'migrator_all', cmd: '*', roles: 'migrator' },
          ]),
        );
      },
      { database: 'production' },
    );
  });

  it('fonctions de garde : SECURITY INVOKER, search_path figé', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ fn: string; secdef: boolean; config: string[] | null }>(
        `SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS secdef, p.proconfig AS config
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname LIKE 'config_%'
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.fn)).toEqual([
        'core.config_go_live(text,text)',
        'core.config_no_truncate()',
        'core.config_param_value_guard()',
        'core.config_tax_line_guard()',
        'core.config_versioned_row_guard()',
      ]);
      for (const r of rows) {
        expect(r, r.fn).toMatchObject({
          secdef: false,
          config: ['search_path=pg_catalog, pg_temp'],
        });
      }
    });
  });

  it('app_anon n’a aucun accès', async () => {
    await withRole('app_anon', async (client) => {
      await expectAutocommitError(client, 'SELECT * FROM core.config_country', { code: '42501' });
    });
  });
});

describe('graines PA / PY (0009)', () => {
  it('devises et pays (17 §1.2, §1.3)', async () => {
    await withRole('app_api', async (client) => {
      const cur = await client.query(
        `SELECT code, exponent FROM core.config_currency ORDER BY code`,
      );
      expect(cur.rows).toEqual([
        { code: 'PYG', exponent: 0 },
        { code: 'USD', exponent: 2 },
      ]);
      const countries = await client.query(
        `SELECT code, currency, time_zone, legal_locale FROM core.config_country ORDER BY code`,
      );
      expect(countries.rows).toEqual([
        { code: 'PA', currency: 'USD', time_zone: 'America/Panama', legal_locale: 'es-PA' },
        { code: 'PY', currency: 'PYG', time_zone: 'America/Asuncion', legal_locale: 'es-PY' },
      ]);
    });
  });

  it('toutes les valeurs des données sont chargées, avec la devise du pays', async () => {
    const params = readData<ParamsDoc>('params.json').params;
    const expected = params.reduce(
      (n, p) => n + Object.keys(p.values).length + (p.scoped?.length ?? 0),
      0,
    );
    await withRole('app_worker', async (client) => {
      const count = await client.query<{ n: string; defs: string }>(
        `SELECT (SELECT count(*) FROM core.config_param_value)::text AS n,
                (SELECT count(*) FROM core.config_param_definition)::text AS defs`,
      );
      expect(count.rows[0]).toEqual({ n: String(expected), defs: String(params.length) });
      // 08 BR-CXL-13 : HOST_PENALTY en unités mineures de la devise du pays.
      const penalty = await client.query(
        `SELECT country_code, currency, value FROM core.config_param_value WHERE key = 'host_penalty' ORDER BY 1`,
      );
      expect(penalty.rows).toEqual([
        {
          country_code: 'PA',
          currency: 'USD',
          value: { cxlEarly: '2500', cxlLate: '5000', hostNoShow: '15000', cleanliness: '5000' },
        },
        {
          country_code: 'PY',
          currency: 'PYG',
          value: {
            cxlEarly: '200000',
            cxlLate: '400000',
            hostNoShow: '1200000',
            cleanliness: '400000',
          },
        },
      ]);
    });
  });

  it('taxe par ligne : ITBMS 7 % (PA), IVA 10 % (PY) sur P, promos et F (08 E1, BR-PRICE-06), third_party = false', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query(
        `SELECT country_code, rate_group, rate_bps, third_party, count(*)::int AS lines
           FROM core.pricing_tax_line_config WHERE taxable GROUP BY 1, 2, 3, 4 ORDER BY 1`,
      );
      expect(rows).toEqual([
        { country_code: 'PA', rate_group: 'ITBMS', rate_bps: 700, third_party: false, lines: 4 },
        { country_code: 'PY', rate_group: 'IVA', rate_bps: 1000, third_party: false, lines: 4 },
      ]);
    });
  });
});

describe('interrupteurs : core.config_go_live (17 §0.1, §2.3)', () => {
  it.each(['app_api', 'app_worker'] as const)(
    '%s : faux partout, absent ou inconnu = false',
    async (role) => {
      await withRole(role, async (client) => {
        for (const country of ['PA', 'PY']) {
          for (const key of SWITCHES) {
            const { rows } = await client.query(`SELECT core.config_go_live($1, $2) AS is_on`, [
              key,
              country,
            ]);
            expect(rows[0]).toEqual({ is_on: false });
          }
        }
        const odd = await client.query(
          `SELECT core.config_go_live('PAYOUTS_ENABLED', 'PA') AS upper_key,
                core.config_go_live('payouts_enabled', 'pa') AS lower_country,
                core.config_go_live('payouts_enabled', 'XX') AS unknown_country,
                core.config_go_live('no_such_switch', 'PA') AS unknown_key,
                core.config_go_live('self_booking_forbidden', 'PA') AS not_a_switch,
                core.config_go_live(NULL, NULL) AS nulls`,
        );
        expect(odd.rows[0]).toEqual({
          upper_key: false,
          lower_country: false,
          unknown_country: false,
          unknown_key: false,
          not_a_switch: false,
          nulls: false,
        });
      });
    },
  );

  it('app_anon ne peut pas l’exécuter', async () => {
    await withRole('app_anon', async (client) => {
      await expectAutocommitError(client, `SELECT core.config_go_live('payouts_enabled', 'PA')`, {
        code: '42501',
      });
    });
  });
});

describe('gardes de config_param_value (tous rôles)', () => {
  it('valid_from passé ⇒ PARAM_RETROACTIVE (16 ADM-014) ; absent ⇒ platform.now() ; futur accepté', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        await expectSqlError(
          tx,
          INSERT_VALUE,
          ['hold_ttl_minutes', 'PA', '11', '2029-12-31T23:59:59Z', null],
          {
            code: '23514',
            message: 'PARAM_RETROACTIVE',
          },
        );
        const now = await tx.query(INSERT_VALUE, ['hold_ttl_minutes', 'PY', '11', null, null]);
        expect((now.rows[0] as { valid_from: Date }).valid_from.toISOString()).toBe(VIRTUAL_NOW);
        const future = await tx.query(INSERT_VALUE, [
          'hold_ttl_minutes',
          'PA',
          '12',
          '2030-02-01T00:00:00Z',
          null,
        ]);
        expect(future.rowCount).toBe(1);
      });
    });
  });

  it('interrupteur à true refusé hors procédure (FORBIDDEN, 42501)', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        await expectSqlError(tx, INSERT_VALUE, ['payouts_enabled', 'PA', 'true', null, null], {
          code: '42501',
          message: 'FORBIDDEN',
        });
        const { rows } = await tx.query(
          `SELECT core.config_go_live('payouts_enabled', 'PA') AS is_on`,
        );
        expect(rows[0]).toEqual({ is_on: false });
      });
    });
  });

  it('cohérence avec la définition : devise du pays, type, portée, clé sans objet', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        // Aucune conversion : un montant du PY est en PYG (17 §7.1).
        await expectSqlError(tx, INSERT_VALUE, ['deposit_max', 'PY', '"1000"', null, 'USD'], {
          code: '23514',
          message: 'CONFIG_INVALID',
        });
        const posed = await tx.query(INSERT_VALUE, ['deposit_max', 'PY', '"1000"', null, null]);
        expect(posed.rows[0]).toMatchObject({ currency: 'PYG' });
        await expectSqlError(tx, INSERT_VALUE, ['deposit_max', 'PA', '1000', null, null], {
          code: '23514',
          message: 'CONFIG_INVALID',
        });
        await expectSqlError(tx, INSERT_VALUE, ['hold_ttl_minutes', 'PA', '10.5', null, null], {
          code: '23514',
          message: 'CONFIG_INVALID',
        });
        await expectSqlError(tx, INSERT_VALUE, ['collection_mode', 'PA', '"AGENCY"', null, null], {
          code: '23514',
          message: 'CONFIG_INVALID',
        });
        await expectSqlError(tx, INSERT_VALUE, ['ach_xpress_max_minor', 'PY', '"1"', null, null], {
          code: '23514',
          message: 'PARAM_NOT_APPLICABLE',
        });
        await expectSqlError(
          tx,
          `INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, value, change_reason)
           VALUES ('hold_ttl_minutes', 'PA', 'ORG', 'x', '5'::jsonb, 'test')`,
          [],
          { code: '23514', message: 'CONFIG_INVALID' },
        );
      });
    });
  });

  it('immuable : ni modification, ni suppression, ni TRUNCATE ; seule la fermeture non rétroactive', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        const target = `WHERE key = 'hold_ttl_minutes' AND country_code = 'PA' AND scope_type = 'COUNTRY'`;
        await expectSqlError(
          tx,
          `UPDATE core.config_param_value SET value = '99'::jsonb ${target}`,
          [],
          {
            code: '23514',
            message: 'PARAM_IMMUTABLE',
          },
        );
        await expectSqlError(tx, `DELETE FROM core.config_param_value ${target}`, [], {
          code: '23514',
          message: 'PARAM_IMMUTABLE',
        });
        await expectSqlError(tx, `TRUNCATE core.config_param_value`, [], {
          code: '23514',
          message: 'PARAM_IMMUTABLE',
        });
        await expectSqlError(
          tx,
          `UPDATE core.config_param_value SET valid_to = '2029-06-01T00:00:00Z' ${target}`,
          [],
          { code: '23514', message: 'PARAM_RETROACTIVE' },
        );
        const closed = await tx.query(
          `UPDATE core.config_param_value SET valid_to = '2030-06-01T00:00:00Z' ${target}`,
        );
        expect(closed.rowCount).toBe(1);
        await expectSqlError(
          tx,
          `UPDATE core.config_param_value SET valid_to = '2030-07-01T00:00:00Z' ${target}`,
          [],
          { code: '23514', message: 'PARAM_IMMUTABLE' },
        );
      });
    });
  });
});

describe('tables de référence immuables (devises, pays, définitions, entités juridiques)', () => {
  it.each([
    [
      'config_currency',
      `UPDATE core.config_currency SET exponent = 3`,
      `DELETE FROM core.config_currency`,
    ],
    [
      'config_country',
      `UPDATE core.config_country SET time_zone = 'UTC'`,
      `DELETE FROM core.config_country`,
    ],
    [
      'config_param_definition',
      `UPDATE core.config_param_definition SET go_live_switch = false`,
      `DELETE FROM core.config_param_definition`,
    ],
  ])('%s : ni UPDATE ni DELETE (PARAM_IMMUTABLE), pour tout rôle', async (_t, update, del) => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        await expectSqlError(tx, update, [], { code: '23514', message: 'PARAM_IMMUTABLE' });
        await expectSqlError(tx, del, [], { code: '23514', message: 'PARAM_IMMUTABLE' });
      });
    });
  });

  it('TRUNCATE refusé ; gardes inventoriées sur les quatre tables', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        await expectSqlError(tx, `TRUNCATE core.finance_legal_entity`, [], {
          code: '23514',
          message: 'PARAM_IMMUTABLE',
        });
        // finance_legal_entity est vide (ADR-013 en attente) : sa garde de ligne est inventoriée.
        const { rows } = await tx.query<{ t: string }>(
          `SELECT c.relname || '.' || g.tgname AS t
             FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'core' AND NOT g.tgisinternal
              AND c.relname IN ('config_currency', 'config_country', 'config_param_definition',
                                'finance_legal_entity')
            ORDER BY 1`,
        );
        expect(rows.map((r) => r.t)).toEqual([
          'config_country.config_country_guard',
          'config_country.config_country_no_truncate',
          'config_currency.config_currency_guard',
          'config_currency.config_currency_no_truncate',
          'config_param_definition.config_param_definition_guard',
          'config_param_definition.config_param_definition_no_truncate',
          'finance_legal_entity.finance_legal_entity_guard',
          'finance_legal_entity.finance_legal_entity_no_truncate',
        ]);
      });
    });
  });
});

describe('montants : garde SQL bornée à int64', () => {
  it('MONEY au-delà de 9 223 372 036 854 775 807 ⇒ CONFIG_INVALID', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        await expectSqlError(
          tx,
          INSERT_VALUE,
          ['deposit_max', 'PY', '"9223372036854775808"', null, null],
          {
            code: '23514',
            message: 'CONFIG_INVALID',
          },
        );
        const max = await tx.query(INSERT_VALUE, [
          'deposit_max',
          'PY',
          '"9223372036854775807"',
          null,
          null,
        ]);
        expect(max.rowCount).toBe(1);
      });
    });
  });
});

describe('gardes de pricing_tax_line_config', () => {
  it('nouvelle version non rétroactive ; groupe fiscal cohérent ; aucune modification', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: VIRTUAL_NOW }, async (tx) => {
        const insert = `INSERT INTO core.pricing_tax_line_config
          (country_code, line_type, taxable, rate_group, rate_bps, third_party, version, valid_from)
          VALUES ('PY', $1, true, 'IVA', $2, false, 2, $3::timestamptz)`;
        await expectSqlError(tx, insert, ['TRIP_PRICE', 1000, '2029-01-01T00:00:00Z'], {
          code: '23514',
          message: 'PARAM_RETROACTIVE',
        });
        await tx.query(insert, ['TRIP_PRICE', 1000, null]);
        await expectSqlError(tx, insert, ['TRIP_FEE', 500, null], {
          code: '23514',
          message: 'CONFIG_INVALID',
        });
        await expectSqlError(
          tx,
          `UPDATE core.pricing_tax_line_config SET rate_bps = 0 WHERE version = 1`,
          [],
          {
            code: '23514',
            message: 'PARAM_IMMUTABLE',
          },
        );
        await expectSqlError(tx, `DELETE FROM core.pricing_tax_line_config`, [], {
          code: '23514',
          message: 'PARAM_IMMUTABLE',
        });
      });
    });
  });
});

describe('tzdata de PostgreSQL (17 §1.3 ; ADR-019 ; OQ-BR-20)', () => {
  it('les attentes des données CFG sont tenues (America/Asuncion = UTC−3 permanent)', async () => {
    const countries = readData<CountriesDoc>('countries.json').countries;
    await withRole('app_api', async (client) => {
      for (const c of countries) {
        for (const check of c.timeZoneChecks) {
          // Même requête que POSTGRES_OFFSET_SQL (apps/api, module CFG).
          const { rows } = await client.query<{ offset_minutes: number }>(
            "SELECT (EXTRACT(EPOCH FROM (($1::timestamptz AT TIME ZONE $2) - ($1::timestamptz AT TIME ZONE 'UTC'))) / 60)::int AS offset_minutes",
            [check.instant, c.timeZone],
          );
          expect({ tz: c.timeZone, at: check.instant, offset: rows[0]?.offset_minutes }).toEqual({
            tz: c.timeZone,
            at: check.instant,
            offset: check.offsetMinutes,
          });
        }
      }
    });
  });
});
