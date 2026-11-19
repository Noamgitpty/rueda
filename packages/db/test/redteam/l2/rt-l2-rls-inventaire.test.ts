/**
 * US-222c — red team du lot 2, RT-L2-R03 et rejeu de RLS-21 à RLS-28 étendu aux tables d'argent du
 * lot 2 (registre et bordereau de l'assureur, grand livre de l'hôte, instances de remboursement,
 * caution, mouvements de jambes, décisions FINANCE), et inventaire `SECURITY DEFINER` (L2-PM-10,
 * L2-PM-42), sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), en USD (PA) et en
 * PYG (PY), transactions ANNULÉES. TESTS SEULEMENT (L2-PM-39).
 *
 * Attendus (jamais le code testé) : 17 v6 §2.3 et RLS-21 (« INSERT, UPDATE, DELETE directs […] :
 * refus (42501) ; seules les commandes écrivent »), RLS-22 (app_anon et voyageur : 0 ligne), RLS-23
 * (OPS sans dossier : 0 ligne ; SUPPORT : 0 ligne sur `insurer_*` et `platform_advance`), RLS-24
 * (FINANCE d'un autre pays : 0 ligne), RLS-25 (`app_worker` sous un `worker_name` hors liste :
 * refus, 0 ligne), RLS-27 (écriture directe d'un interrupteur refusée ; `app_worker` sans EXECUTE
 * sur les commandes à deux personnes), RLS-28 (co-hôte muni par erreur de
 * `finance.read_org_statements` : 0 ligne), RLS-15 / RLS-16 (liste blanche, `search_path` figé,
 * propriétaire NOLOGIN dédié, aucun EXECUTE à PUBLIC) ; pré-mortem du lot 2, L2-PM-42 (« EXECUTE
 * accordé au seul rôle prévu »). Chaque lecture « 0 ligne » a son témoin (un lecteur légitime voit la
 * ligne) : une table vide ne prouverait rien.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, setSessionContext } from '../../../src/index.ts';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { goLive } from '../../support/golive.ts';
import { staff as rlsStaff, staffSessionHash, uuid } from '../../support/rls.ts';
import { golden } from '../../support/settlement.ts';
import { failure } from './support-l2.ts';
import type { Tx } from './support-l2.ts';

const APP_ROLES = ['app_anon', 'app_api', 'app_worker'] as const;

/** Tables d'argent (17 §3.2.7, §3.2.8, US-056 et lot 2) : AUCUNE écriture directe d'un rôle applicatif. */
const MONEY_TABLES = [
  // RLS-21 (17 v6)
  'settlement_trip_leg_balance',
  'settlement_settlement_leg',
  'payment_payment_operation_leg',
  'settlement_insurer_ledger_state',
  'settlement_insurer_bordereau',
  'settlement_platform_advance',
  // règlement et décisions (lot 1 / US-056)
  'settlement_settlement',
  'settlement_settlement_line',
  'settlement_settlement_tax_line',
  'settlement_leg_movement',
  'settlement_finance_approval',
  'settlement_insurer',
  'settlement_insurer_contract',
  // lot 2 : US-224, US-227, US-709a, US-701 / US-702
  'settlement_insurer_ledger_entry',
  'settlement_insurer_bordereau_line',
  'settlement_host_ledger_entry',
  'payment_refund_instance',
  'payment_deposit_hold',
  'payment_payment_operation_event',
] as const;

/**
 * Écritures directes documentées d'`app_worker` sur des tables de paiement (base de PRODUCTION,
 * relevées dans les migrations) : réception des webhooks (0007, 0051), file des commandes PSP
 * (0040), disposition du paiement (0007), et statut non terminal d'une opération (0007, borné par la
 * politique `worker_update_status` de 0058 : jamais un statut terminal ni une preuve). Toute autre
 * écriture est un écart.
 */
const DOCUMENTED_WRITES = [
  'app_worker:booking_payment_disposition:INSERT',
  'app_worker:payment_payment_command:INSERT',
  'app_worker:payment_payment_command:UPDATE',
  'app_worker:payment_payment_operation:UPDATE',
  'app_worker:payment_webhook_inbox:INSERT',
  'app_worker:payment_webhook_inbox:UPDATE',
];
const PAYMENT_TABLES = [
  'booking_payment_disposition',
  'payment_payment_command',
  'payment_payment_operation',
  'payment_webhook_inbox',
];

const PRIVILEGES_SQL = `
  SELECT r || ':' || t || ':' || p AS k
    FROM unnest($1::text[]) AS r, unnest($2::text[]) AS t,
         unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
   WHERE CASE WHEN p IN ('INSERT', 'UPDATE')
              THEN pg_catalog.has_any_column_privilege(r, ('core.' || t)::regclass, p)
              ELSE pg_catalog.has_table_privilege(r, ('core.' || t)::regclass, p) END
   ORDER BY 1`;

describe('RLS-21 rejoué et étendu au lot 2 — aucune écriture directe des tables d’argent', () => {
  it('base de production : aucun rôle applicatif n’a INSERT, UPDATE (aucune colonne), DELETE ni TRUNCATE sur les tables d’argent ; sur les tables de paiement, seules les écritures documentées d’app_worker', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const money = await client.query<{ k: string }>(PRIVILEGES_SQL, [
          [...APP_ROLES],
          [...MONEY_TABLES],
        ]);
        expect(money.rows.map((r) => r.k)).toEqual([]);
        const payment = await client.query<{ k: string }>(PRIVILEGES_SQL, [
          [...APP_ROLES],
          PAYMENT_TABLES,
        ]);
        expect(payment.rows.map((r) => r.k)).toEqual(DOCUMENTED_WRITES);
        // et aucune lecture pour app_anon (RLS-22 : aucune politique, aucun droit)
        const anon = await client.query<{ t: string }>(
          `SELECT t FROM unnest($1::text[]) AS t
            WHERE pg_catalog.has_any_column_privilege('app_anon', ('core.' || t)::regclass, 'SELECT')
            ORDER BY 1`,
          [[...MONEY_TABLES, ...PAYMENT_TABLES]],
        );
        expect(anon.rows.map((r) => r.t)).toEqual([]);
      },
      { database: 'production' },
    );
  });

  it('écritures tentées sous app_api (voyageur, hôte, staff ADMIN) et sous app_worker (settlement, payment_command, bordereau, nom hors liste) : 42501 sur chaque table d’argent', async () => {
    const attempts = async (tx: Tx): Promise<string[]> => {
      const bad: string[] = [];
      for (const t of MONEY_TABLES) {
        const col = (
          await tx.query<{ c: string }>(
            `SELECT a.attname AS c FROM pg_catalog.pg_attribute AS a
              WHERE a.attrelid = ('core.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum LIMIT 1`,
            [t],
          )
        ).rows[0]?.c;
        if (col === undefined || !/^[a-z_]+$/.test(col)) throw new Error(`colonne de ${t}`);
        for (const sql of [
          `UPDATE core.${t} SET ${col} = ${col} WHERE false`,
          `DELETE FROM core.${t} WHERE false`,
          `INSERT INTO core.${t} DEFAULT VALUES`,
          `TRUNCATE core.${t}`,
        ]) {
          const e = await failure(tx, sql);
          if (e?.code !== '42501') bad.push(`${sql} → ${e?.code ?? 'ACCEPTÉ'}`);
        }
      }
      return bad;
    };
    await withRole('app_api', async (client) => {
      for (const ctx of [
        { kind: 'GUEST', actorId: uuid() } as const,
        { kind: 'HOST', actorId: uuid(), orgId: uuid() } as const,
      ]) {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, ctx);
          expect(await attempts(tx), ctx.kind).toEqual([]);
        });
      }
      await withTestTransaction(client, {}, async (tx) => {
        const id = await rlsStaff(
          tx,
          'ADMIN',
          COUNTRIES.map((c) => c.country),
        );
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: id,
          countryScope: COUNTRIES.map((c) => c.country),
          sessionTokenHash: staffSessionHash(id) ?? '',
        });
        expect(await attempts(tx), 'STAFF ADMIN').toEqual([]);
      });
    });
    await withRole('app_worker', async (client) => {
      for (const worker of ['settlement', 'payment_command', 'bordereau', 'rt_l2_intrus']) {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: worker });
          expect(await attempts(tx), worker).toEqual([]);
        });
      }
    });
  });
});

/** Capture de l'export par devise (TJ01 / TJ08a), jambes en texte. */
const CAPTURE = new Map(
  ['TJ01', 'TJ08a'].map((id) => {
    const v = legVector(golden, id);
    return [v.currency, v] as const;
  }),
);

/** Trip d'argent complet de la fixture, dans la transaction annulée de l'appelant. */
async function moneyTrip(tx: Tx, cc: CountryCase) {
  const v = CAPTURE.get(cc.currency);
  if (v === undefined) throw new Error(`aucun vecteur en ${cc.currency}`);
  const trip = uuid();
  const guest = uuid();
  const org = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    org,
    uuid(),
    cc.country,
    cc.currency,
    cc.timezone,
    '2034-09-10T15:00:00.000Z',
    '2034-09-13T15:00:00.000Z',
  ]);
  const legs = Object.fromEntries(
    Object.entries(v.legsMinor).map(([k, a]) => [k, (a as bigint).toString()]),
  );
  await tx.query(
    `SELECT test_fixture.pay_insert_operation_raw($1, $2, 'CAPTURE', $3::bigint, $4::jsonb, true)`,
    [uuid(), trip, v.totalMinor.toString(), JSON.stringify(legs)],
  );
  for (const [leg, amount] of Object.entries(legs)) {
    await tx.query(
      'SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, 0::bigint)',
      [trip, leg, amount],
    );
  }
  const advance = uuid();
  await tx.query('SELECT test_fixture.us062_insert_advance($1, $2, $3, $4::bigint)', [
    advance,
    trip,
    'RELEASED_LEG',
    legs['HOST'],
  ]);
  const bordereau = uuid();
  await tx.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
    bordereau,
    cc.country,
    cc.currency,
    legs['INSURER'],
  ]);
  await tx.query('SELECT test_fixture.us062_insert_bordereau_line($1, $2, $3::bigint)', [
    bordereau,
    trip,
    legs['INSURER'],
  ]);
  return { trip, guest, org, advance, bordereau };
}

/** Lignes visibles du trip `m` dans chaque table d'argent, sous le contexte courant. */
async function visible(
  tx: Tx,
  m: Awaited<ReturnType<typeof moneyTrip>>,
): Promise<Record<string, number>> {
  const count = async (sql: string, p: unknown): Promise<number> =>
    (await tx.query<{ n: number }>(sql, [p])).rows[0]?.n ?? -1;
  return {
    trip_leg_balance: await count(
      'SELECT count(*)::int AS n FROM core.settlement_trip_leg_balance WHERE trip_id = $1',
      m.trip,
    ),
    payment_operation_leg: await count(
      'SELECT count(*)::int AS n FROM core.payment_payment_operation_leg WHERE trip_id = $1',
      m.trip,
    ),
    platform_advance: await count(
      'SELECT count(*)::int AS n FROM core.settlement_platform_advance WHERE id = $1',
      m.advance,
    ),
    insurer_bordereau: await count(
      'SELECT count(*)::int AS n FROM core.settlement_insurer_bordereau WHERE id = $1',
      m.bordereau,
    ),
    insurer_bordereau_line: await count(
      'SELECT count(*)::int AS n FROM core.settlement_insurer_bordereau_line WHERE bordereau_id = $1',
      m.bordereau,
    ),
  };
}
const NONE = {
  trip_leg_balance: 0,
  payment_operation_leg: 0,
  platform_advance: 0,
  insurer_bordereau: 0,
  insurer_bordereau_line: 0,
};

/** Lecture des tables d'argent du trip `m` sous le contexte `ctx` (posé comme la couche d'accès). */
async function readAs(
  tx: Tx,
  ctx: Parameters<typeof setSessionContext>[1],
  m: Awaited<ReturnType<typeof moneyTrip>>,
): Promise<Record<string, number>> {
  await setSessionContext(tx, ctx);
  return visible(tx, m);
}

describe.each(COUNTRIES)(
  'RLS-22 à RLS-25 rejoués sur un trip d’argent peuplé ($country, $currency)',
  (cc) => {
    const other = COUNTRIES.find((x) => x.country !== cc.country)!;

    it('app_api : le voyageur du trip, un hôte au compte forgé, l’OPS sans dossier et SUPPORT ne lisent rien ; FINANCE de l’autre pays ne lit rien ; témoin : FINANCE du pays lit toutes les lignes', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          const m = await moneyTrip(tx, cc);
          const staffCtx = async (role: string, scope: readonly string[]) => {
            const id = await rlsStaff(tx, role, scope);
            return {
              kind: 'STAFF',
              actorId: id,
              countryScope: scope,
              sessionTokenHash: staffSessionHash(id) ?? '',
            } as const;
          };
          const financeHere = await staffCtx('FINANCE', [cc.country]);
          const financeThere = await staffCtx('FINANCE', [other.country]);
          const opsNoCase = await staffCtx('OPS_AGENT', [cc.country]);
          const support = await staffCtx('SUPPORT_AGENT', [cc.country]);
          expect(await readAs(tx, financeHere, m), 'témoin FINANCE du pays').toEqual({
            trip_leg_balance: 4,
            payment_operation_leg: 4,
            platform_advance: 1,
            insurer_bordereau: 1,
            insurer_bordereau_line: 1,
          });
          expect(await readAs(tx, { kind: 'GUEST', actorId: m.guest }, m), 'voyageur').toEqual(
            NONE,
          );
          expect(
            await readAs(tx, { kind: 'HOST', actorId: uuid(), orgId: m.org }, m),
            'hôte au compte forgé (non titulaire)',
          ).toEqual(NONE);
          expect(await readAs(tx, opsNoCase, m), 'OPS sans dossier').toEqual(NONE);
          expect(await readAs(tx, support, m), 'SUPPORT').toEqual(NONE);
          expect(await readAs(tx, financeThere, m), 'FINANCE de l’autre pays').toEqual(NONE);
          // FINANCE du pays qui pose aussi l'autre pays dans sa portée : toujours ses lignes seulement
          expect(
            await readAs(tx, { ...financeThere, countryScope: [other.country, cc.country] }, m),
            'FINANCE de l’autre pays, portée élargie dans le contexte',
          ).toEqual(NONE);
        }),
      );
    });

    it('RLS-25 : app_worker sous un nom hors liste ne lit aucune jambe ni avance et ne déplace rien (settlement_cmd_apply_leg_movement refusée) ; témoin : le travailleur settlement lit les jambes', async () => {
      await withRole('app_worker', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          const m = await moneyTrip(tx, cc);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const witness = await visible(tx, m);
          // témoin : les soldes par jambe sont ouverts à `settlement` (politique worker_money_read de
          // 0027) ; les jambes d'opération ne le sont pas (observé en CI, run 44467099987 : 0 ligne),
          // elles ne servent donc pas de témoin ici
          expect(witness.trip_leg_balance).toBe(4);
          // US-222d2 (revue qa n° 2 de la PR n° 256) : témoins positifs des autres zéros — l'avance et
          // le bordereau sont ouverts à `settlement` (worker_money_read de 0036), les jambes
          // d'opération à `payment_command` (worker_select de 0028)
          expect(witness.platform_advance).toBe(1);
          expect(witness.insurer_bordereau).toBe(1);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
          expect((await visible(tx, m)).payment_operation_leg, 'payment_command').toBe(4);
          for (const intruder of ['rt_l2_intrus', 'outbox_relay', 'webhook_ingest']) {
            await setSessionContext(tx, { kind: 'WORKER', workerName: intruder });
            const seen = await visible(tx, m);
            expect(seen.trip_leg_balance, intruder).toBe(0);
            expect(seen.platform_advance, intruder).toBe(0);
            expect(seen.insurer_bordereau, intruder).toBe(0);
            // jambes d'opération : `webhook_ingest` en est un lecteur documenté (0028), pas un intrus
            if (intruder !== 'webhook_ingest') {
              expect(seen.payment_operation_leg, intruder).toBe(0);
            }
            const e = await failure(tx, 'SELECT core.settlement_cmd_apply_leg_movement($1)', [
              uuid(),
            ]);
            expect(e?.code, intruder).toBe('42501');
          }
        }),
      );
    });
  },
);

describe.each(COUNTRIES)(
  'RLS-27 rejoué — écriture directe d’un interrupteur ($country, $currency)',
  (cc) => {
    const KEYS = [
      'p2p_private_hosts_enabled',
      'insurer_contract_active',
      'funds_holding_enabled',
      'payouts_enabled',
    ];

    it('app_api (ADMIN, SUPERADMIN de la session) et app_worker (droit d’écriture de TEST sur config_param_value) : INSERT, UPDATE, DELETE directs refusés ; interrupteurs relus fermés ; app_worker sans EXECUTE sur les commandes à deux personnes', async () => {
      /** Chaque écriture directe doit être REFUSÉE (42501 : droit absent ou trigger de garde). */
      const tryWrites = async (tx: Tx): Promise<string[]> => {
        const accepted: string[] = [];
        for (const key of KEYS) {
          for (const sql of [
            `UPDATE core.config_param_value SET value = 'true'::jsonb
            WHERE key = $1 AND country_code = $2`,
            `DELETE FROM core.config_param_value WHERE key = $1 AND country_code = $2`,
            `INSERT INTO core.config_param_value
                  (key, country_code, scope_type, value, valid_from, change_reason)
           VALUES ($1, $2, 'COUNTRY', 'true'::jsonb, platform.now() + interval '1 minute',
                   'red team US-222c')`,
          ]) {
            const e = await failure(tx, sql, [key, cc.country]);
            if (e?.code !== '42501') {
              accepted.push(`${key} ${sql.trim().split(' ')[0] ?? ''} → ${e?.code ?? 'ACCEPTÉ'}`);
            }
          }
          if (await goLive(tx, key, cc.country)) accepted.push(`${key}: OUVERT`);
        }
        return accepted;
      };
      await withRole('app_api', async (client) => {
        for (const role of ['ADMIN', 'SUPERADMIN']) {
          await withTestTransaction(client, {}, async (tx) => {
            const id = await rlsStaff(tx, role, [cc.country]);
            await setSessionContext(tx, {
              kind: 'STAFF',
              actorId: id,
              countryScope: [cc.country],
              sessionTokenHash: staffSessionHash(id) ?? '',
            });
            expect(await tryWrites(tx), role).toEqual([]);
          });
        }
      });
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          expect(await tryWrites(tx), 'app_worker').toEqual([]);
          const { rows } = await tx.query<{ f: string; x: boolean }>(
            `SELECT p.oid::regprocedure::text AS f,
                  pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS x
             FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core' AND p.proname LIKE 'config\\_cmd\\_%go\\_live%'`,
          );
          expect(rows.length).toBeGreaterThanOrEqual(2);
          expect(rows.filter((r) => r.x).map((r) => r.f)).toEqual([]);
        });
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// L2-PM-42 — inventaire SECURITY DEFINER des fonctions du lot 2 (base de production)
// ---------------------------------------------------------------------------------------------
interface AllowEntry {
  readonly signature: string;
  readonly owner: string;
  readonly execute: readonly string[];
  readonly story: string;
}
const allowlist = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'security-definer-allowlist.json'), 'utf8'),
) as { searchPath: string; functions: AllowEntry[] };
/** Stories du lot 2 (19 : US-2xx, et US-514, US-701, US-702, US-704 remontées au lot 2). */
const LOT2 = /\bUS-(2\d\d|514|70[1-9])\b/;
const lot2 = allowlist.functions.filter((f) => LOT2.test(f.story));

describe('L2-PM-42 — inventaire SECURITY DEFINER des commandes du lot 2 (base de production)', () => {
  it('chaque fonction du lot 2 de la liste blanche existe, SECURITY DEFINER, propriétaire NOLOGIN dédié (ni superutilisateur, ni BYPASSRLS, ni rôle de connexion), search_path figé, ni PUBLIC ni app_anon, et au plus UN rôle applicatif (app_api XOR app_worker)', async () => {
    expect(lot2.length).toBeGreaterThan(50);
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          sig: string;
          secdef: boolean;
          owner: string;
          canlogin: boolean;
          superuser: boolean;
          bypass: boolean;
          config: string[] | null;
          public_exec: boolean;
          apps: string[];
        }>(
          `SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g') AS sig,
                  p.prosecdef AS secdef, o.rolname AS owner, o.rolcanlogin AS canlogin,
                  o.rolsuper AS superuser, o.rolbypassrls AS bypass, p.proconfig AS config,
                  EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,
                            pg_catalog.acldefault('f', p.proowner))) AS a
                           WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) AS public_exec,
                  ARRAY(SELECT r FROM unnest($1::text[]) AS r
                         WHERE pg_catalog.has_function_privilege(r, p.oid, 'EXECUTE')
                         ORDER BY 1) AS apps
             FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_roles AS o ON o.oid = p.proowner
            WHERE pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g')
                  = ANY ($2::text[])
            ORDER BY 1`,
          [[...APP_ROLES], lot2.map((f) => f.signature)],
        );
        // US-222d2 (revue code n° 5 de la PR n° 256) : comparaison sans dépendre de la collation de la
        // base (tri SQL contre tri JS) : les deux listes sont triées ici, par le même comparateur
        const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
        expect(rows.map((r) => r.sig).sort(byCode)).toEqual(
          lot2.map((f) => f.signature).sort(byCode),
        );
        const bad: string[] = [];
        for (const r of rows) {
          const f = lot2.find((x) => x.signature === r.sig);
          const why: string[] = [];
          if (!r.secdef) why.push('non SECURITY DEFINER');
          if (r.owner !== f?.owner) why.push(`propriétaire ${r.owner}`);
          if (r.canlogin || r.superuser || r.bypass) why.push('propriétaire privilégié');
          if (JSON.stringify(r.config) !== JSON.stringify([allowlist.searchPath])) {
            why.push(`search_path ${JSON.stringify(r.config)}`);
          }
          if (r.public_exec) why.push('EXECUTE à PUBLIC');
          if (r.apps.includes('app_anon')) why.push('EXECUTE à app_anon');
          if (r.apps.length > 1) why.push(`EXECUTE à ${r.apps.join(' et ')}`);
          if (why.length > 0) bad.push(`${r.sig} : ${why.join(', ')}`);
        }
        expect(bad).toEqual([]);
      },
      { database: 'production' },
    );
  });

  it('aucune fonction des schémas du projet n’est exécutable par app_anon en SECURITY DEFINER ; aucune fonction SECURITY DEFINER hors de la liste blanche', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ sig: string; anon: boolean; listed: boolean }>(
          `SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g') AS sig,
                  pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                  pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g')
                    = ANY ($1::text[]) AS listed
             FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname !~ '^pg_toast'
            ORDER BY 1`,
          [allowlist.functions.map((f) => f.signature)],
        );
        expect(rows.filter((r) => r.anon).map((r) => r.sig)).toEqual([]);
        expect(rows.filter((r) => !r.listed).map((r) => r.sig)).toEqual([]);
      },
      { database: 'production' },
    );
  });
});
