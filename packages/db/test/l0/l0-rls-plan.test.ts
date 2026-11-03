/**
 * L0-05 — plan de `trip_staff_read` (17 §2.3 « Fonctions de politique », §11 ; revue architecture
 * US-011, MAJEUR 1). Sous app_api, contexte posé par setSessionContext, preuves **déterministes**
 * tirées de `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, sans horloge murale :
 * - aucune récursion de politique (le plan se construit, sans « infinite recursion ») et aucun
 *   sous-plan : les politiques de booking_trip n'appellent que des fonctions de politique, dont
 *   les lectures (membership, staff_role_assignment, support_case) ne sont pas sous la RLS
 *   d'app_api ; une seule relation lue ;
 * - la RLS n'empêche pas un index sur id (clé primaire ou UNIQUE (id, country_code)) : prédicat
 *   `id = …` étanche, en condition d'index sous la barrière de sécurité ; aucun `Seq Scan` ; une
 *   boucle, une seule ligne examinée ;
 * - parcours complet : la relation est lue une fois (une boucle), chaque ligne examinée une fois ;
 * - appels de fonction de politique bornés par ligne examinée (constante, indépendante des
 *   données) : comptés par `pg_stat_get_xact_function_calls` si `track_functions = all` sur le
 *   banc, sinon par le filtre du nœud de parcours, évalué une fois par ligne examinée et par boucle ;
 * - index des lectures des fonctions présents.
 * Le temps et les tampons sont consignés (journal CI `[L0-05 plan]`) à titre informatif, sans
 * assertion : sous 16 fichiers L0 en parallèle, le temps mesure la charge du runner, pas la
 * politique (revues US-011 et US-018, qa 2026-11-03b).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { asActor, buildWorld } from '../support/rls.ts';
import type { TestContext, World } from '../support/rls.ts';

let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

interface PlanNode {
  readonly 'Node Type': string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly 'Relation Name'?: string;
  readonly Filter?: string;
  readonly 'Parent Relationship'?: string;
  readonly 'Subplan Name'?: string;
  readonly 'Actual Rows'?: number;
  readonly 'Actual Loops'?: number;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Rows Removed by Index Recheck'?: number;
  readonly 'Shared Hit Blocks'?: number;
  readonly 'Shared Read Blocks'?: number;
  readonly Plans?: readonly PlanNode[];
}

const nodes = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(nodes)];
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const UUID = /^[0-9a-f-]{36}$/;

/** Fonctions de politique de booking_trip et nombre maximal d'appels par ligne examinée. */
const POLICY_FUNCTIONS = {
  has_staff_role: 2, // trip_staff_read : ADMIN OR FINANCE
  staff_case_covers: 1, // trip_staff_read : dossier assigné
  host_covers_vehicle: 1, // trip_host_read
} as const;
type PolicyFunction = keyof typeof POLICY_FUNCTIONS;
type Calls = Record<PolicyFunction, number>;
const POLICY_NAMES = Object.keys(POLICY_FUNCTIONS) as PolicyFunction[];

async function explain(tx: pg.ClientBase, sql: string): Promise<PlanNode> {
  const { rows } = await tx.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
  );
  const top = rows[0]?.['QUERY PLAN'][0];
  if (top === undefined) throw new Error('plan absent');
  return top.Plan;
}

/** `track_functions = all` : seul réglage qui compte les fonctions en langage SQL (les nôtres). */
async function functionsTracked(tx: pg.ClientBase): Promise<boolean> {
  const { rows } = await tx.query<{ v: string }>(
    `SELECT pg_catalog.current_setting('track_functions') AS v`,
  );
  return rows[0]?.v === 'all';
}

/** Appels des fonctions de politique dans la transaction courante (compteurs non encore vidés). */
async function xactCalls(tx: pg.ClientBase): Promise<Calls> {
  const { rows } = await tx.query<{ name: PolicyFunction; calls: number }>(
    `SELECT p.proname::text AS name,
            COALESCE(SUM(pg_catalog.pg_stat_get_xact_function_calls(p.oid)), 0)::int AS calls
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname = ANY ($1::text[])
      GROUP BY p.proname`,
    [POLICY_NAMES],
  );
  const out = Object.fromEntries(POLICY_NAMES.map((f) => [f, 0])) as Calls;
  for (const r of rows) out[r.name] = r.calls;
  return out;
}

interface Measure {
  readonly all: readonly PlanNode[];
  readonly scan: PlanNode;
  readonly loops: number;
  readonly visible: number;
  readonly examined: number;
  readonly buffers: number;
  /** Appels mesurés (track_functions = all), ou null : borne lue dans le filtre du parcours. */
  readonly calls: Calls | null;
}

/**
 * Plan exécuté et mesures déterministes du nœud qui lit booking_trip, avec les preuves communes :
 * une seule relation, aucun sous-plan (SubPlan ou InitPlan), une boucle, appels de fonction bornés.
 */
async function measure(tx: pg.ClientBase, sql: string, who: string): Promise<Measure> {
  const tracked = await functionsTracked(tx);
  const before = tracked ? await xactCalls(tx) : null;
  const plan = await explain(tx, sql);
  const after = tracked ? await xactCalls(tx) : null;

  const all = nodes(plan);
  // une seule relation lue : aucune autre table jointe par les politiques (pas de récursion)
  expect(
    [...new Set(all.map((n) => n['Relation Name']).filter((r) => r !== undefined))],
    who,
  ).toEqual(['booking_trip']);
  expect(
    all.filter((n) => n['Parent Relationship'] === 'SubPlan' || n['Subplan Name']),
    who,
  ).toEqual([]);
  const scans = all.filter((n) => n['Relation Name'] === 'booking_trip');
  expect(scans, who).toHaveLength(1);
  const scan = scans[0] as PlanNode;

  // relation lue une seule fois : aucune reprise du parcours (boucle imbriquée, sous-plan corrélé)
  const loops = scan['Actual Loops'] ?? 0;
  expect(loops, who).toBe(1);
  const visible = scan['Actual Rows'] ?? 0;
  const examined =
    visible + (scan['Rows Removed by Filter'] ?? 0) + (scan['Rows Removed by Index Recheck'] ?? 0);

  // trip_guest_read OR trip_host_read OR trip_staff_read : appels constants par ligne examinée,
  // tous dans le filtre du parcours (seul endroit évalué une fois par ligne)
  const filter = scan.Filter ?? '';
  expect(filter, who).toMatch(/has_staff_role\(/);
  const elsewhere = all
    .filter((n) => n !== scan)
    .map((n) => `${n.Filter ?? ''} ${n['Index Cond'] ?? ''}`)
    .join(' ');
  for (const f of POLICY_NAMES) {
    expect(count(filter, `${f}(`), `${who} ${f} par ligne`).toBeLessThanOrEqual(
      POLICY_FUNCTIONS[f],
    );
    expect(count(elsewhere, `${f}(`), `${who} ${f} hors parcours`).toBe(0);
  }

  let calls: Calls | null = null;
  if (before !== null && after !== null) {
    calls = Object.fromEntries(POLICY_NAMES.map((f) => [f, after[f] - before[f]])) as Calls;
    for (const f of POLICY_NAMES) {
      expect(calls[f], `${who} appels ${f}`).toBeLessThanOrEqual(
        loops * examined * POLICY_FUNCTIONS[f],
      );
    }
    // une ligne visible a passé au moins une fonction de politique (ADMIN, FINANCE ou dossier)
    if (visible > 0) {
      expect(calls.has_staff_role + calls.staff_case_covers, who).toBeGreaterThan(0);
    }
  }

  const buffers = (scan['Shared Hit Blocks'] ?? 0) + (scan['Shared Read Blocks'] ?? 0);
  return { all, scan, loops, visible, examined, buffers, calls };
}

function report(who: string, what: string, m: Measure, extra: string): void {
  const bounds = POLICY_NAMES.map((f) => `${f} ≤ ${m.loops * m.examined * POLICY_FUNCTIONS[f]}`);
  const calls =
    m.calls === null
      ? `appels bornés par le filtre (track_functions ≠ all) : ${bounds.join(', ')}`
      : `appels mesurés ${JSON.stringify(m.calls)} ; bornes ${bounds.join(', ')}`;
  console.log(
    `[L0-05 plan] ${who} ${what} : ${m.scan['Node Type']}, boucles ${m.loops}, ` +
      `examinées ${m.examined}, visibles ${m.visible}, tampons ${m.buffers} (informatif), ` +
      `${calls}${extra}`,
  );
}

const staffContexts = (): [string, TestContext][] => [
  [
    'ADMIN',
    {
      kind: 'STAFF',
      actorId: world.staff.adminAll,
      countryScope: COUNTRIES.map((c) => c.country),
    },
  ],
  [
    'OPS',
    {
      kind: 'STAFF',
      actorId: world.staff.opsFirst,
      countryScope: [COUNTRIES[0].country],
    },
  ],
];

describe('L0-05 — plan de trip_staff_read', () => {
  it('lecture par UUID : index sur id, aucun Seq Scan, une ligne examinée, appels bornés', async () => {
    const tripId = world.countries[0]?.trips.a1.id ?? '';
    expect(tripId).toMatch(UUID);
    await withRole('app_api', async (client) => {
      for (const [who, ctx] of staffContexts()) {
        await asActor(client, ctx, async (tx) => {
          // on interdit le parcours séquentiel pour prouver que l'index RESTE utilisable sous RLS
          await tx.query(`SELECT pg_catalog.set_config('enable_seqscan', 'off', true)`);
          const sql = `SELECT id, status FROM core.booking_trip WHERE id = '${tripId}'::uuid`;
          const m = await measure(tx, sql, who);
          expect(
            m.all.filter((n) => n['Node Type'] === 'Seq Scan'),
            who,
          ).toEqual([]);
          // index dont id est la première colonne : clé primaire ou UNIQUE (id, country_code) de 0023
          expect(['booking_trip_pkey', 'trip_id_country_unique'], who).toContain(
            m.scan['Index Name'],
          );
          // le prédicat id = … est une condition d'index (étanche), pas un filtre après lecture
          expect(m.scan['Index Cond'] ?? '', who).toMatch(/\bid = /);
          // l'index livre exactement le trip demandé : une ligne examinée, au plus une visible
          expect(m.examined, who).toBe(1);
          expect(m.visible, who).toBeLessThanOrEqual(1);
          if (who === 'ADMIN') expect(m.visible, who).toBe(1);
          report(who, 'par UUID', m, '');
        });
      }
    });
  });

  it('parcours complet : une boucle, chaque ligne examinée une fois, lignes attendues', async () => {
    await withRole('app_api', async (client) => {
      for (const [who, ctx] of staffContexts()) {
        await asActor(client, ctx, async (tx) => {
          const t0 = process.hrtime.bigint();
          const m = await measure(tx, 'SELECT id FROM core.booking_trip', who);
          const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
          const total = await tx.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM core.booking_trip',
          );
          // le plan exécuté rend exactement les lignes que la RLS laisse voir
          expect(m.visible, who).toBeGreaterThan(0);
          expect(m.visible, who).toBe(total.rows[0]?.n);
          expect(m.examined, who).toBeGreaterThanOrEqual(m.visible);
          // temps consigné seulement (aucune assertion) : il dépend de la charge du runner
          report(who, 'parcours complet', m, `, ${elapsedMs.toFixed(2)} ms (informatif)`);
        });
      }
    });
  });

  it('index des lectures des fonctions de politique présents', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ name: string; def: string }>(
        `SELECT c.relname::text AS name, pg_catalog.pg_get_indexdef(i.indexrelid) AS def
           FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = ANY ($1::text[])`,
        [['staff_role_user_idx', 'support_case_trip_assignee_idx', 'membership_user_idx']],
      );
      const defs = Object.fromEntries(rows.map((r) => [r.name, r.def]));
      expect(defs['staff_role_user_idx']).toMatch(/\(user_id\)/);
      expect(defs['support_case_trip_assignee_idx']).toMatch(/\(trip_id, assignee_id\)/);
      expect(defs['membership_user_idx']).toMatch(/\(user_id\)/);
    });
  });
});
