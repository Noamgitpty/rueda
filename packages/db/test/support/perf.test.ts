/**
 * Performance de fumée (US-045, ADR-119) : résumé, marge et alerte, sans base de données. Valeurs
 * attendues : cibles de 17 §6.7 (300 ms pour la création de hold, 500 ms pour la fiche véhicule,
 * 10 s pour le délai webhook → BOOKED) et définition du p95 « rang ⌈0,95 n⌉ » de `percentile`.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTRIES } from './avl.ts';
import { marginOf, PERF_SCHEMA, PERF_TARGETS, recordPerf, summarize } from './perf.ts';

describe('perf — résumé, marge, alerte (US-045)', () => {
  it('summarize : p50, p95 (rang ⌈0,95 n⌉), max', () => {
    const values = Array.from({ length: 40 }, (_, i) => i + 1); // 1 … 40 ms
    expect(summarize(values)).toEqual({ n: 40, p50: 20, p95: 38, max: 40 });
  });

  it('summarize refuse une série vide (fail-closed : rien de mesuré, rien de consigné)', () => {
    expect(() => summarize([])).toThrow(/vide/);
  });

  it('cibles de 17 §6.7 reprises sans changement ; seul C1 en autocommit est bloquant', () => {
    expect(PERF_TARGETS['pose.c1.autocommit']).toMatchObject({ ms: 300, blocking: true });
    expect(PERF_TARGETS['pose.c1.transactionnelle']).toMatchObject({ ms: 300, blocking: false });
    expect(PERF_TARGETS['calendrier.sequentielle'].ms).toBe(500);
    expect(PERF_TARGETS['conversion.sequentielle'].ms).toBe(10_000);
    expect(PERF_TARGETS['publication.sequentielle'].ms).toBeNull();
  });

  it('marge : positive sous la cible, alerte dès p95 ≥ cible, rien sans cible', () => {
    const t = PERF_TARGETS['pose.c1.transactionnelle'];
    expect(marginOf(263, t)).toEqual({ marginMs: 37, marginPct: 12.3, alert: false });
    expect(marginOf(300, t)).toEqual({ marginMs: 0, marginPct: 0, alert: true });
    expect(marginOf(310, t)).toEqual({ marginMs: -10, marginPct: -3.3, alert: true });
    expect(marginOf(5, PERF_TARGETS['publication.sequentielle'])).toEqual({
      marginMs: null,
      marginPct: null,
      alert: false,
    });
  });
});

const [FIRST, SECOND] = COUNTRIES;

describe('perf — consignation (journal et fichier du tableau de bord)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('écrit perf-<série>-<pays>.json et une ligne [PERF] ; commit et run viennent de la CI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-'));
    dirs.push(dir);
    vi.stubEnv('RUEDA_QA_REPORT_DIR', dir);
    vi.stubEnv('GITHUB_SHA', 'abc123');
    vi.stubEnv('GITHUB_RUN_ID', '42');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = recordPerf({
      series: 'pose.c1.transactionnelle',
      country: SECOND.country,
      summary: { n: 100, p50: 120, p95: 305, max: 400 },
      pgVersion: '16.4',
    });
    expect(r).toMatchObject({ schema: PERF_SCHEMA, path: 'pose', alert: true, marginMs: -5 });
    expect(readdirSync(dir)).toEqual([`perf-pose.c1.transactionnelle-${SECOND.country}.json`]);
    const file = JSON.parse(
      readFileSync(join(dir, `perf-pose.c1.transactionnelle-${SECOND.country}.json`), 'utf8'),
    ) as { run: { sha: string; runId: string; machine: { pgVersion: string } } };
    expect(file.run).toMatchObject({ sha: 'abc123', runId: '42', machine: { pgVersion: '16.4' } });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[PERF\] \{/));
  });

  it('sans RUEDA_QA_REPORT_DIR : journal seulement, aucun fichier', () => {
    vi.stubEnv('RUEDA_QA_REPORT_DIR', '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = recordPerf({
      series: 'calendrier.sequentielle',
      country: FIRST.country,
      summary: { n: 40, p50: 3, p95: 4, max: 9 },
      pgVersion: null,
    });
    expect(r.alert).toBe(false);
    expect(r.marginMs).toBe(496);
  });
});
