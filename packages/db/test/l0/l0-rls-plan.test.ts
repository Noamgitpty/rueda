/**
 * L0-05 — plan de `trip_staff_read` (17 §2.3 « Fonctions de politique », §11 ; revue architecture
 * US-011, MAJEUR 1). Sous app_api, contexte posé par setSessionContext :
 * - aucune récursion de politique (le plan se construit, sans « infinite recursion ») et aucun
 *   sous-plan : les politiques de booking_trip n'appellent que des fonctions de politique, dont
 *   les lectures (membership, staff_role_assignment, support_case) ne sont pas sous la RLS
 *   d'app_api ;
 * - nombre d'appels de fonction de politique borné par ligne (constante, indépendante des données) ;
 * - la RLS n'empêche pas l'index de la clé primaire (prédicat `id = …` étanche, poussé sous la
 *   barrière de sécurité) ;
 * - index des lectures des fonctions présents ; coût mesuré par ligne, borné large (journal CI).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import type { SessionContext } from '../../src/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { asActor, buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';

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
  readonly 'Relation Name'?: string;
  readonly Filter?: string;
  readonly 'Parent Relationship'?: string;
  readonly 'Subplan Name'?: string;
  readonly 'Actual Rows'?: number;
  readonly Plans?: readonly PlanNode[];
}

const nodes = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(nodes)];
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const UUID = /^[0-9a-f-]{36}$/;

async function explain(
  tx: pg.ClientBase,
  sql: string,
  analyze = false,
): Promise<{ plan: PlanNode; executionMs: number }> {
  const { rows } = await tx.query<{
    'QUERY PLAN': [{ Plan: PlanNode; 'Execution Time'?: number }];
  }>(`EXPLAIN (${analyze ? 'ANALYZE, ' : ''}FORMAT JSON) ${sql}`);
  const top = rows[0]?.['QUERY PLAN'][0];
  if (top === undefined) throw new Error('plan absent');
  return { plan: top.Plan, executionMs: top['Execution Time'] ?? 0 };
}

const staffContexts = (): [string, SessionContext][] => [
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
  it('lecture par UUID : index de la clé primaire, filtre de politique borné, aucun sous-plan', async () => {
    const tripId = world.countries[0]?.trips.a1.id ?? '';
    expect(tripId).toMatch(UUID);
    await withRole('app_api', async (client) => {
      for (const [who, ctx] of staffContexts()) {
        await asActor(client, ctx, async (tx) => {
          // on interdit le parcours séquentiel pour prouver que l'index RESTE utilisable sous RLS
          await tx.query(`SELECT pg_catalog.set_config('enable_seqscan', 'off', true)`);
          const { plan } = await explain(
            tx,
            `SELECT id, status FROM core.booking_trip WHERE id = '${tripId}'::uuid`,
          );
          const all = nodes(plan);
          const scan = all.find((n) => n['Relation Name'] === 'booking_trip');
          expect(scan?.['Index Name'], who).toBe('booking_trip_pkey');
          expect(
            all.filter((n) => n['Parent Relationship'] === 'SubPlan' || n['Subplan Name']),
            who,
          ).toEqual([]);
          const filter = all.map((n) => n.Filter ?? '').join(' ');
          // trip_guest_read OR trip_host_read OR trip_staff_read : appels constants par ligne
          expect(count(filter, 'has_staff_role('), who).toBeLessThanOrEqual(2);
          expect(count(filter, 'staff_case_covers('), who).toBeLessThanOrEqual(1);
          expect(count(filter, 'host_covers_vehicle('), who).toBeLessThanOrEqual(1);
          expect(filter, who).toMatch(/has_staff_role\(/);
          // une seule relation lue : aucune autre table jointe par les politiques
          expect(
            [...new Set(all.map((n) => n['Relation Name']).filter((r) => r !== undefined))],
            who,
          ).toEqual(['booking_trip']);
        });
      }
    });
  });

  it('parcours complet : coût par ligne borné (mesuré), lignes attendues', async () => {
    await withRole('app_api', async (client) => {
      for (const [who, ctx] of staffContexts()) {
        await asActor(client, ctx, async (tx) => {
          const { plan, executionMs } = await explain(tx, 'SELECT id FROM core.booking_trip', true);
          const scan = nodes(plan).find((n) => n['Relation Name'] === 'booking_trip');
          const rows = scan?.['Actual Rows'] ?? 0;
          expect(rows, who).toBeGreaterThan(0);
          const total = await tx.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM core.booking_trip',
          );
          const perRowMs = executionMs / Math.max(total.rows[0]?.n ?? 1, 1);
          console.log(
            `[L0-05 plan] ${who} : ${executionMs.toFixed(2)} ms, ${perRowMs.toFixed(3)} ms/ligne`,
          );
          // borne large : une fonction de politique par ligne = quelques EXISTS indexés
          expect(perRowMs, who).toBeLessThan(25);
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
