/**
 * DIAGNOSTIC TEMPORAIRE (US-007, N-468, retiré avant la fusion) : temps de planification de la
 * lecture d'un paramètre de pays (corps de core.booking_param_int, 0037) en fonction du nombre de
 * politiques permissives de `cmd_hold_owner` sur `core.config_param_value`, ajoutées au OU dans
 * l'ordre de leur création. Sous `app_worker` (rôle de production, L0-05), politiques recopiées
 * dans la requête : la RLS de `cmd_hold_owner` est un OU de ces mêmes expressions.
 */
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';

const BASE = `WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,6}$'
              THEN (v.value #>> '{}')::integer END
    FROM core.config_param_value v CROSS JOIN t
   WHERE v.key = 'hold_ttl_minutes'
     AND v.country_code::text = 'PA'
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)`;
const TAIL = ` ORDER BY v.valid_from DESC LIMIT 1`;
const REPS = 300;

describe('diagnostic : planification de la lecture des paramètres', () => {
  it('temps de planification selon le nombre de politiques de cmd_hold_owner', async () => {
    const w = await connectAs('app_worker');
    try {
      await w.query(`SELECT set_config('app.actor_kind', 'WORKER', false),
                            set_config('app.worker_name', 'hold_expiry', false)`);
      const pol = await w.query<{ name: string; qual: string }>(
        `SELECT p.polname AS name, pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS qual
           FROM pg_catalog.pg_policy p
          WHERE p.polrelid = 'core.config_param_value'::regclass
            AND 'cmd_hold_owner'::regrole = ANY (p.polroles)
            AND p.polcmd IN ('r', '*')
          ORDER BY p.oid`,
      );
      const out: Record<string, number | string>[] = [];
      for (let k = 0; k <= pol.rows.length; k++) {
        const ors = pol.rows.slice(0, k).map((p) => `(${p.qual})`);
        const sql = BASE + (k > 0 ? ` AND (${ors.join(' OR ')})` : '') + TAIL;
        const times: number[] = [];
        for (let i = 0; i < REPS; i++) {
          const r = await w.query<{ 'QUERY PLAN': { 'Planning Time': number }[] }>(
            `EXPLAIN (ANALYZE, SUMMARY, FORMAT JSON) ${sql}`,
          );
          times.push(r.rows[0]?.['QUERY PLAN'][0]?.['Planning Time'] ?? NaN);
        }
        times.sort((a, b) => a - b);
        out.push({
          k,
          added: k === 0 ? '-' : (pol.rows[k - 1]?.name ?? '?'),
          p50ms: Math.round((times[REPS >> 1] ?? NaN) * 1000) / 1000,
          p90ms: Math.round((times[Math.floor(REPS * 0.9)] ?? NaN) * 1000) / 1000,
        });
      }
      const cpu = await w.query<{ v: string }>('SELECT version() AS v');
      console.log(`[DIAG-PLAN] ${JSON.stringify({ pg: cpu.rows[0]?.v, rows: out })}`);
      expect(out.length).toBe(pol.rows.length + 1);
    } finally {
      await releaseClient(w);
    }
  }, 240_000);
});
