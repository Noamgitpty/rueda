/**
 * Preuves de la limitation de débit (US-052, migration 0047 ; 17 §6.6 ; ADR-075) sous les rôles
 * de PRODUCTION (assertion L0-05 en tête de chaque test par withRole / connectAs), en PA et en PY :
 *
 * - tables `risk_*` : RLS ENABLE + FORCE, aucun droit de table pour app_api, app_worker, app_anon ;
 * - `core.risk_cmd_hit` : fenêtre fixe à l'horloge de la BASE (`platform.now()`, horloge
 *   virtuelle), refus au-delà de la limite avec délai de reprise jusqu'à la fin de la fenêtre,
 *   poids d'une requête suspecte, refus journalisé et agrégé par heure, empreintes de 32 octets
 *   seulement, bornes (22023), EXECUTE au seul app_api ; 30 appels concurrents pour une limite de
 *   5 ⇒ exactement 5 accordés ;
 * - `core.risk_cmd_sms_reserve` (critère 2) : plafond par JOUR LOCAL du pays, message critique
 *   toujours accordé et compté, alerte au premier refus du jour seulement ; sous app_worker,
 *   seul `ntf_sender` (42501 sinon) ;
 * - `core.risk_cmd_record_abuse` : genres et signaux en liste blanche ;
 * - `core.risk_cmd_prune` : travailleur `risk_pruner` seulement ;
 * - tableau de sécurité `core.risk_staff_abuse_board` : session élevée et `security.read_abuse`
 *   sur le pays ; sans permission ou sans TOTP, aucune ligne et refus journalisé ; jamais
 *   d'empreinte rendue.
 *
 * Attentes : 17 §6.6, 19 US-052, ADR-075 ; jamais le code testé.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  auditOf,
  createStaff,
  elevatedStaff,
  installTestProofKey,
  login,
} from '../support/staff.ts';

const key = (): Buffer => randomBytes(32);

interface Hit {
  allowed: boolean;
  hits: number;
  retry_after_s: number;
}

async function hit(
  client: pg.ClientBase,
  k: Buffer,
  country: string | null,
  limit: number,
  windowS: number,
  weight = 1,
  scope = 'otp_recipient',
): Promise<Hit> {
  const { rows } = await client.query<Hit>(
    'SELECT allowed, hits, retry_after_s FROM core.risk_cmd_hit($1, $2, $3, $4, $5, $6)',
    [scope, k, country, limit, windowS, weight],
  );
  const r = rows[0];
  if (r === undefined) throw new Error('aucune ligne');
  return r;
}

async function setNow(client: pg.ClientBase, iso: string): Promise<void> {
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

async function asWorker(client: pg.ClientBase, name: string): Promise<void> {
  await client.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true)`,
    [name],
  );
}

/** Code SQLSTATE d'une instruction qui doit échouer (autocommit, aucune transaction ouverte). */
async function sqlState(client: pg.ClientBase, text: string, params: unknown[]): Promise<string> {
  try {
    await client.query(text, params);
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
  return 'NO_ERROR';
}

/** Décalage (minutes) du fuseau à l'instant donné, par Intl (oracle indépendant de la base). */
function offsetMinutes(timeZone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (m === null) throw new Error(`décalage illisible : ${name}`);
  if (m[1] === undefined) return 0;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

/** Minuit local du jour donné, en UTC. */
function localMidnight(timeZone: string, isoDate: string): Date {
  const guess = new Date(`${isoDate}T00:00:00Z`);
  return new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60_000);
}

const smsKey = (country: string): Buffer =>
  createHash('sha256').update(`sms_country_day:${country}`, 'utf8').digest();

describe('tables risk_* : RLS et droits', () => {
  it('RLS ENABLE + FORCE ; aucun droit de table pour les rôles applicatifs', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ relname: string; rls: boolean; force: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname LIKE 'risk\\_%' AND c.relkind = 'r'
          ORDER BY 1`,
      );
      expect(rows).toEqual([
        { relname: 'risk_abuse_event', rls: true, force: true },
        // US-127 (0080, ADR-110) : constats de l'ops, évaluations, règles déclarées
        { relname: 'risk_account_link', rls: true, force: true },
        { relname: 'risk_assessment', rls: true, force: true },
        { relname: 'risk_rate_counter', rls: true, force: true },
        { relname: 'risk_rule', rls: true, force: true },
      ]);
      const privs = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM unnest(ARRAY['core.risk_abuse_event', 'core.risk_account_link', 'core.risk_assessment',
                              'core.risk_rate_counter', 'core.risk_rule']) AS t(tbl),
                unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
          WHERE pg_catalog.has_table_privilege(r.role, t.tbl, p.priv)`,
      );
      expect(privs.rows[0]?.n).toBe(0);
      expect(await sqlState(client, 'SELECT count(*) FROM core.risk_rate_counter', [])).toBe(
        '42501',
      );
    });
  });

  it('EXECUTE : hit et record au seul app_api ; prune au seul app_worker ; rien pour app_anon', async () => {
    await withRole('app_anon', async (anon) => {
      expect(
        await sqlState(anon, 'SELECT * FROM core.risk_cmd_hit($1, $2, NULL, 1, 60, 1)', [
          'api_ip',
          key(),
        ]),
      ).toBe('42501');
      expect(
        await sqlState(anon, 'SELECT * FROM core.risk_cmd_sms_reserve($1, 1, false)', ['PA']),
      ).toBe('42501');
    });
    await withRole('app_worker', async (worker) => {
      expect(
        await sqlState(worker, 'SELECT * FROM core.risk_cmd_hit($1, $2, NULL, 1, 60, 1)', [
          'api_ip',
          key(),
        ]),
      ).toBe('42501');
    });
    await withRole('app_api', async (api) => {
      expect(await sqlState(api, 'SELECT core.risk_cmd_prune(10, 30)', [])).toBe('42501');
    });
  });
});

describe.each(COUNTRIES)('core.risk_cmd_hit — $country', ({ country }) => {
  it('critère 1 : limite par heure, refus au-delà avec délai de reprise, journal agrégé', async () => {
    await withRole('app_api', async (client) => {
      const k = key();
      await withTestTransaction(client, { virtualNow: '2026-11-10T10:15:00Z' }, async (tx) => {
        for (let i = 1; i <= 3; i += 1) {
          expect(await hit(tx, k, country, 3, 3600)).toEqual({
            allowed: true,
            hits: i,
            retry_after_s: 2700,
          });
        }
        expect(await hit(tx, k, country, 3, 3600)).toEqual({
          allowed: false,
          hits: 4,
          retry_after_s: 2700,
        });
        await setNow(tx, '2026-11-10T10:59:30Z');
        expect(await hit(tx, k, country, 3, 3600)).toEqual({
          allowed: false,
          hits: 5,
          retry_after_s: 30,
        });
        // un autre client (autre empreinte) n'est pas affecté
        expect((await hit(tx, key(), country, 3, 3600)).allowed).toBe(true);

        const abuse = await tx.query('SELECT * FROM test_fixture.risk_abuse_rows($1)', [k]);
        expect(abuse.rows).toEqual([
          {
            kind: 'RATE_LIMITED',
            scope: 'otp_recipient',
            country_code: country,
            occurrences: 2,
            signals: [],
            key_size: 32,
            bucket_start: new Date('2026-11-10T10:00:00Z'),
          },
        ]);
        // fenêtre suivante : compteur neuf
        await setNow(tx, '2026-11-10T11:00:01Z');
        expect(await hit(tx, k, country, 3, 3600)).toEqual({
          allowed: true,
          hits: 1,
          retry_after_s: 3599,
        });
        const counters = await tx.query('SELECT * FROM test_fixture.risk_counter_rows($1)', [k]);
        expect(counters.rows).toEqual([
          {
            scope: 'otp_recipient',
            country_code: country,
            hits: 5,
            window_start: new Date('2026-11-10T10:00:00Z'),
            window_end: new Date('2026-11-10T11:00:00Z'),
          },
          {
            scope: 'otp_recipient',
            country_code: country,
            hits: 1,
            window_start: new Date('2026-11-10T11:00:00Z'),
            window_end: new Date('2026-11-10T12:00:00Z'),
          },
        ]);
      });
    });
  });

  it('poids d’un client suspect : chaque requête compte plusieurs fois', async () => {
    await withRole('app_api', async (client) => {
      const k = key();
      await withTestTransaction(client, { virtualNow: '2026-11-10T10:00:10Z' }, async (tx) => {
        expect((await hit(tx, k, country, 8, 60, 4, 'api_ip')).allowed).toBe(true);
        expect((await hit(tx, k, country, 8, 60, 4, 'api_ip')).allowed).toBe(true);
        expect(await hit(tx, k, country, 8, 60, 4, 'api_ip')).toEqual({
          allowed: false,
          hits: 12,
          retry_after_s: 50,
        });
      });
    });
  });
});

describe('core.risk_cmd_hit — bornes et concurrence', () => {
  it('arguments hors bornes ⇒ 22023 ; pays non déclaré ⇒ 23503', async () => {
    await withRole('app_api', async (client) => {
      const call = 'SELECT * FROM core.risk_cmd_hit($1, $2, $3, $4, $5, $6)';
      for (const args of [
        ['Bad Scope', key(), null, 1, 60, 1],
        ['api_ip', randomBytes(31), null, 1, 60, 1],
        ['api_ip', key(), null, 0, 60, 1],
        ['api_ip', key(), null, 1_000_001, 60, 1],
        ['api_ip', key(), null, 1, 0, 1],
        ['api_ip', key(), null, 1, 604_801, 1],
        ['api_ip', key(), null, 1, 60, 0],
        ['api_ip', key(), null, 1, 60, 101],
        ['api_ip', null, null, 1, 60, 1],
      ]) {
        expect(await sqlState(client, call, args), JSON.stringify(args[0])).toBe('22023');
      }
      expect(await sqlState(client, call, ['api_ip', key(), 'ZZ', 1, 60, 1])).toBe('23503');
    });
  });

  it('30 appels concurrents, limite 5 ⇒ exactement 5 accordés (compteur atomique)', async () => {
    const k = key();
    const clients = await Promise.all(Array.from({ length: 10 }, () => connectAs('app_api')));
    try {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          hit(clients[i % 10] as pg.Client, k, null, 5, 604_800, 1, 'api_ip'),
        ),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
      expect(Math.max(...results.map((r) => r.hits))).toBe(30);
    } finally {
      await Promise.all(clients.map((c) => releaseClient(c)));
    }
  });
});

describe.each(COUNTRIES)(
  'critère 2 : plafond SMS journalier — $country ($timezone)',
  ({ country, timezone }) => {
    const midnight = localMidnight(timezone, '2026-11-11');
    const before = new Date(midnight.getTime() - 30 * 60_000).toISOString();
    const after = new Date(midnight.getTime() + 30 * 60_000).toISOString();

    async function reserve(tx: pg.ClientBase, cap: number, critical: boolean) {
      const { rows } = await tx.query<{ allowed: boolean; sent_today: number; alert: boolean }>(
        'SELECT allowed, sent_today, alert FROM core.risk_cmd_sms_reserve($1, $2, $3)',
        [country, cap, critical],
      );
      return rows[0];
    }

    it('non critique refusé au plafond, alerte une fois ; critique accordé et compté ; jour local', async () => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, { virtualNow: before }, async (tx) => {
          await asWorker(tx, 'ntf_sender');
          expect(await reserve(tx, 2, false)).toEqual({
            allowed: true,
            sent_today: 1,
            alert: false,
          });
          expect(await reserve(tx, 2, false)).toEqual({
            allowed: true,
            sent_today: 2,
            alert: false,
          });
          expect(await reserve(tx, 2, false)).toEqual({
            allowed: false,
            sent_today: 2,
            alert: true,
          });
          expect(await reserve(tx, 2, false)).toEqual({
            allowed: false,
            sent_today: 2,
            alert: false,
          });
          // message critique de trip : toujours envoyé, et compté
          expect(await reserve(tx, 2, true)).toEqual({
            allowed: true,
            sent_today: 3,
            alert: false,
          });
          const counters = await tx.query('SELECT * FROM test_fixture.risk_counter_rows($1)', [
            smsKey(country),
          ]);
          expect(counters.rows).toEqual([
            {
              scope: 'sms_country_day',
              country_code: country,
              hits: 3,
              window_start: localMidnight(timezone, '2026-11-10'),
              window_end: midnight,
            },
          ]);
          const cap = await tx.query('SELECT * FROM test_fixture.risk_abuse_by_kind($1, $2)', [
            'SMS_DAILY_CAP_REACHED',
            country,
          ]);
          expect(cap.rows.map((r: { occurrences: number }) => r.occurrences)).toEqual([2]);
          // minuit LOCAL passé : nouveau jour, nouveau plafond, nouvelle alerte possible
          await setNow(tx, after);
          expect(await reserve(tx, 2, false)).toEqual({
            allowed: true,
            sent_today: 1,
            alert: false,
          });
          expect(await reserve(tx, 1, false)).toEqual({
            allowed: false,
            sent_today: 1,
            alert: true,
          });
        });
      });
    });

    it('sous app_worker, seul ntf_sender réserve (42501) ; app_api réserve (OTP)', async () => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, { virtualNow: before }, async (tx) => {
          await asWorker(tx, 'outbox_relay');
          await tx.query('SAVEPOINT s');
          await expect(reserve(tx, 2, false)).rejects.toMatchObject({ code: '42501' });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        });
      });
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, { virtualNow: before }, async (tx) => {
          expect((await reserve(tx, 2, false))?.allowed).toBe(true);
        });
        expect(
          await sqlState(client, 'SELECT * FROM core.risk_cmd_sms_reserve($1, 0, false)', [
            country,
          ]),
        ).toBe('22023');
        expect(
          await sqlState(client, 'SELECT * FROM core.risk_cmd_sms_reserve($1, 1, false)', ['ZZ']),
        ).toBe('22023');
      });
    });
  },
);

describe('journal des soupçons et purge', () => {
  it('record_abuse : genres et signaux en liste blanche ; agrégation et union des signaux', async () => {
    await withRole('app_api', async (client) => {
      const k = key();
      const call = 'SELECT core.risk_cmd_record_abuse($1, $2, $3, $4, $5::text[])';
      expect(await sqlState(client, call, ['RATE_LIMITED', 'api', k, null, ['SIGNUP_BURST']])).toBe(
        '22023',
      );
      expect(await sqlState(client, call, ['BOT_SUSPECTED', 'api', k, null, []])).toBe('22023');
      expect(await sqlState(client, call, ['BOT_SUSPECTED', 'api', k, null, ['INVENTED']])).toBe(
        '23514',
      );
      await withTestTransaction(client, { virtualNow: '2026-11-10T10:05:00Z' }, async (tx) => {
        for (const [country, signals] of [
          ['PA', ['NO_BROWSER_HEADERS']],
          ['PA', ['REGULAR_RHYTHM']],
        ] as const) {
          await tx.query(call, ['BOT_SUSPECTED', 'api', k, country, signals]);
        }
        const rows = await tx.query(
          'SELECT kind, occurrences, signals FROM test_fixture.risk_abuse_rows($1)',
          [k],
        );
        expect(rows.rows).toEqual([
          {
            kind: 'BOT_SUSPECTED',
            occurrences: 2,
            signals: ['NO_BROWSER_HEADERS', 'REGULAR_RHYTHM'],
          },
        ]);
      });
    });
  });

  it('prune : seul risk_pruner ; fenêtres closes depuis plus d’une heure supprimées', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { virtualNow: '2026-11-10T10:00:00Z' }, async (tx) => {
        await asWorker(tx, 'ntf_sender');
        await tx.query('SAVEPOINT s');
        await expect(tx.query('SELECT core.risk_cmd_prune(10, 30)')).rejects.toMatchObject({
          code: '42501',
        });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        await asWorker(tx, 'risk_pruner');
        await tx.query('SAVEPOINT b');
        await expect(tx.query('SELECT core.risk_cmd_prune(0, 30)')).rejects.toMatchObject({
          code: '22023',
        });
        await tx.query('ROLLBACK TO SAVEPOINT b');
        const r = await tx.query<{ n: number }>('SELECT core.risk_cmd_prune(50000, 30) AS n');
        expect(r.rows[0]?.n).toBeGreaterThanOrEqual(0);
      });
    });
    // une fenêtre close il y a plus d'une heure disparaît ; la fenêtre en cours reste
    await withRole('app_api', async (api) => {
      const old = key();
      const live = key();
      await withTestTransaction(
        api,
        { virtualNow: '2020-01-01T00:00:10Z', commit: true },
        async (tx) => {
          await hit(tx, old, null, 5, 60, 1, 'api_ip');
        },
      );
      await withTestTransaction(api, { commit: true }, async (tx) => {
        await hit(tx, live, null, 5, 604_800, 1, 'api_ip');
      });
      await withRole('app_worker', async (worker) => {
        await withTestTransaction(worker, { commit: true }, async (tx) => {
          await asWorker(tx, 'risk_pruner');
          for (let i = 0; i < 100; i += 1) {
            const r = await tx.query<{ n: number }>('SELECT core.risk_cmd_prune(50000, 400) AS n');
            if ((r.rows[0]?.n ?? 0) === 0) break;
          }
        });
      });
      expect(
        (await api.query('SELECT * FROM test_fixture.risk_counter_rows($1)', [old])).rows,
      ).toEqual([]);
      expect(
        (await api.query('SELECT * FROM test_fixture.risk_counter_rows($1)', [live])).rows,
      ).toHaveLength(1);
    });
  });
});

describe('tableau de sécurité (critère 4) : core.risk_staff_abuse_board', () => {
  // Horloge RÉELLE : une session de staff expire au bout de 8 h, une horloge virtuelle lointaine
  // la rendrait invalide. Connexion ouverte dans chaque test (assertion L0-05 en tête).
  it.each(COUNTRIES)(
    'ADMIN élevé : agrégat du pays $country sans empreinte ; OPS : rien, refus journalisé',
    async ({ country }) => {
      await withRole('app_api', async (client) => {
        await installTestProofKey(client);
        const all = COUNTRIES.map((c) => c.country);
        const admin = await elevatedStaff(client, 'ADMIN', all);
        const ops = await elevatedStaff(client, 'OPS_AGENT', all);
        await withTestTransaction(client, {}, async (tx) => {
          const a = key();
          const b = key();
          for (const k of [a, a, a, b, b]) await hit(tx, k, country, 1, 3600, 1, 'search_ip');
          const now = await tx.query<{ hour: Date }>(
            `SELECT pg_catalog.date_trunc('hour', platform.now()) AS hour`,
          );
          const { rows } = await tx.query<Record<string, unknown>>(
            'SELECT * FROM core.risk_staff_abuse_board($1, $2, 24)',
            [admin.hash, country],
          );
          const mine = rows.filter((r) => r['scope'] === 'search_ip');
          expect(mine).toHaveLength(1);
          expect(mine[0]).toMatchObject({
            kind: 'RATE_LIMITED',
            country_code: country,
            bucket_start: now.rows[0]?.hour,
            occurrences: '3',
            distinct_keys: '2',
            signals: [],
          });
          expect(Object.keys(mine[0] as object).sort()).toEqual(
            [
              'bucket_start',
              'country_code',
              'distinct_keys',
              'kind',
              'last_at',
              'occurrences',
              'scope',
              'signals',
            ].sort(),
          );
          const denied = await tx.query('SELECT * FROM core.risk_staff_abuse_board($1, $2, 24)', [
            ops.hash,
            country,
          ]);
          expect(denied.rows).toEqual([]);
          const audit = await auditOf(tx, ops.userId);
          expect(audit.at(-1)).toMatchObject({
            action_code: 'STAFF_FORBIDDEN',
            subject_type: 'ABUSE_BOARD',
            after: expect.objectContaining({ reason: 'PERMISSION', attempted: 'ABUSE_BOARD_READ' }),
          });
        });
      });
    },
  );

  it('session non élevée (sans TOTP) : aucune ligne, refus 2FA_REQUIRED journalisé', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(
        client,
        'ADMIN',
        COUNTRIES.map((c) => c.country),
      );
      const hash = await login(client, s.userId);
      const { rows } = await client.query(
        'SELECT * FROM core.risk_staff_abuse_board($1, NULL, 24)',
        [hash],
      );
      expect(rows).toEqual([]);
      const audit = await auditOf(client, s.userId);
      expect(audit.at(-1)).toMatchObject({
        action_code: 'STAFF_ACCESS_DENIED',
        after: expect.objectContaining({ reason: '2FA_REQUIRED' }),
      });
    });
  });
});
