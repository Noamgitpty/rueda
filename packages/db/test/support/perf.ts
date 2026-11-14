/**
 * Performance de fumée (US-045, ADR-119) : séries de durées par chemin critique (pose, conversion,
 * lecture du calendrier, publication), consignées dans le journal (`[PERF] {…}`, une ligne JSON) et,
 * si `RUEDA_QA_REPORT_DIR` est défini (job `base de données` de ci.yml), dans un fichier JSON par
 * série et par pays (`perf-<série>-<pays>.json`). L'artefact `perf-fumee` de chaque run sur `main`
 * forme l'historique des p95 par commit (`scripts/qa/perf-history.mjs`) ; la nuit, le tableau de
 * bord QA lève une alerte pour toute série au-dessus de sa cible (`scripts/qa/nightly-dashboard.mjs`).
 *
 * Cibles : 17 §6.7 (PROPOSÉ), rattachées à un chemin par ADR-119 (PROPOSÉ). Une série `blocking`
 * fait déjà échouer son test (seuil de C1 en autocommit, ADR-056 point 4) ; les autres ne sont
 * qu'**alertées** : une alerte reste une alerte, aucun seuil n'est relâché ni ajouté en douce.
 *
 * Aucune donnée personnelle : des durées, des comptes et l'empreinte de la machine (modèle de
 * processeur, nombre de cœurs, version de PostgreSQL), qui rend deux mesures comparables ou non.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type pg from 'pg';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { percentile } from './replay.ts';

/** Format du fichier (lu par le tableau de bord et l'historique). */
export const PERF_SCHEMA = 'rueda.perf-fumee/1';

/** Chemins critiques mesurés (19 §1.8 « Performance (fumée) », US-045). */
export type PerfPath = 'pose' | 'conversion' | 'calendrier' | 'publication';

export interface PerfTarget {
  /** Cible en ms (p95), ou `null` si 17 §6.7 n'en donne aucune pour ce chemin. */
  readonly ms: number | null;
  /** Ligne de 17 §6.7 (ou ADR) d'où vient la cible. */
  readonly ref: string;
  /** Vrai si le test échoue déjà au-dessus de la cible (seuil bloquant existant). */
  readonly blocking: boolean;
}

/**
 * Cibles par série (ADR-119, PROPOSÉ). Elles reprennent 17 §6.7 sans rien changer :
 * - pose : « Création de hold p95 < 300 ms » (bloquant en autocommit, ADR-056 point 4 ; alerte
 *   seulement en forme transactionnelle) ;
 * - conversion : « Délai webhook → trip BOOKED p95 < 10 s » (la conversion n'en est qu'une étape) ;
 * - calendrier : « Fiche véhicule p95 < 500 ms côté serveur » (la lecture du calendrier en fait
 *   partie) ;
 * - publication : aucune cible dans 17 §6.7 ⇒ consignée, sans alerte (révision proposée, N-16).
 */
export const PERF_TARGETS = {
  'pose.c1.autocommit': {
    ms: 300,
    ref: '17 §6.7 création de hold ; C1 (ADR-056 point 4)',
    blocking: true,
  },
  'pose.c1.transactionnelle': {
    ms: 300,
    ref: '17 §6.7 création de hold ; ADR-056 point 4 (alerte)',
    blocking: false,
  },
  'conversion.sequentielle': {
    ms: 10_000,
    ref: '17 §6.7 délai webhook → trip BOOKED',
    blocking: false,
  },
  'calendrier.sequentielle': {
    ms: 500,
    ref: '17 §6.7 fiche véhicule (côté serveur)',
    blocking: false,
  },
  'publication.sequentielle': {
    ms: null,
    ref: 'aucune cible dans 17 §6.7 (ADR-119)',
    blocking: false,
  },
} as const satisfies Record<string, PerfTarget>;

export type PerfSeriesId = keyof typeof PERF_TARGETS;

export interface PerfSummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface PerfRecord {
  readonly schema: typeof PERF_SCHEMA;
  readonly series: PerfSeriesId;
  readonly path: PerfPath;
  readonly country: string;
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly target: PerfTarget;
  /** Cible − p95 (ms), `null` sans cible ; négative = dépassement. */
  readonly marginMs: number | null;
  /** Marge en % de la cible, `null` sans cible. */
  readonly marginPct: number | null;
  /** Vrai si p95 ≥ cible : alerte au tableau de bord QA. */
  readonly alert: boolean;
  readonly run: PerfRun;
  /** Détails propres à la série (détention du verrou, degré…), sans donnée personnelle. */
  readonly details?: Record<string, unknown>;
}

export interface PerfRun {
  readonly sha: string | null;
  readonly runId: string | null;
  readonly runAttempt: string | null;
  readonly ref: string | null;
  readonly event: string | null;
  readonly at: string;
  readonly machine: PerfMachine;
}

export interface PerfMachine {
  readonly cpuModel: string;
  readonly cores: number;
  readonly memGiB: number;
  readonly runnerOs: string | null;
  readonly runnerImage: string | null;
  readonly pgVersion: string | null;
}

const env = (k: string): string | null => {
  const v = process.env[k];
  return v === undefined || v === '' ? null : v;
};

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** p50, p95 et max d'un échantillon (ms, au dixième). */
export function summarize(values: readonly number[]): PerfSummary {
  if (values.length === 0) throw new Error('série de performance vide');
  return {
    n: values.length,
    p50: round1(percentile(values, 0.5)),
    p95: round1(percentile(values, 0.95)),
    max: round1(Math.max(...values)),
  };
}

/** Marge et alerte d'un p95 contre une cible (pure ; testée par `perf.test.ts`). */
export function marginOf(
  p95: number,
  target: PerfTarget,
): { marginMs: number | null; marginPct: number | null; alert: boolean } {
  if (target.ms === null) return { marginMs: null, marginPct: null, alert: false };
  const marginMs = round1(target.ms - p95);
  return {
    marginMs,
    marginPct: round1((marginMs / target.ms) * 100),
    alert: p95 >= target.ms,
  };
}

/** Version du serveur PostgreSQL du banc (empreinte de la machine). */
export async function serverVersion(client: pg.ClientBase): Promise<string> {
  const r = await client.query<{ v: string }>('SHOW server_version');
  return r.rows[0]?.v ?? 'inconnue';
}

let cachedVersion: Promise<string> | undefined;

/** Version du serveur du banc, lue une fois par fichier sous `app_api` (assertion L0-05). */
export function benchPgVersion(): Promise<string> {
  cachedVersion ??= (async () => {
    const client = await connectAs('app_api');
    try {
      return await serverVersion(client);
    } finally {
      await releaseClient(client);
    }
  })();
  return cachedVersion;
}

export function machine(pgVersion: string | null): PerfMachine {
  const cpu = cpus();
  return {
    cpuModel: cpu[0]?.model.trim() ?? 'inconnu',
    cores: cpu.length,
    memGiB: Math.round(totalmem() / 1024 ** 3),
    runnerOs: env('RUNNER_OS'),
    runnerImage:
      env('ImageOS') === null ? null : `${env('ImageOS')} ${env('ImageVersion') ?? ''}`.trim(),
    pgVersion,
  };
}

/**
 * Consigne une série : ligne `[PERF]` dans le journal et, si `RUEDA_QA_REPORT_DIR` est défini,
 * fichier `perf-<série>-<pays>.json`. Renvoie l'enregistrement (le test peut l'asserter).
 */
export function recordPerf(input: {
  readonly series: PerfSeriesId;
  readonly country: string;
  readonly summary: PerfSummary;
  readonly pgVersion: string | null;
  readonly details?: Record<string, unknown>;
}): PerfRecord {
  const target: PerfTarget = PERF_TARGETS[input.series];
  const record: PerfRecord = {
    schema: PERF_SCHEMA,
    series: input.series,
    path: input.series.split('.')[0] as PerfPath,
    country: input.country,
    ...input.summary,
    target,
    ...marginOf(input.summary.p95, target),
    run: {
      sha: env('GITHUB_SHA'),
      runId: env('GITHUB_RUN_ID'),
      runAttempt: env('GITHUB_RUN_ATTEMPT'),
      ref: env('GITHUB_REF'),
      event: env('GITHUB_EVENT_NAME'),
      at: new Date().toISOString(),
      machine: machine(input.pgVersion),
    },
    ...(input.details === undefined ? {} : { details: input.details }),
  };
  console.log(`[PERF] ${JSON.stringify(record)}`);
  const dir = env('RUEDA_QA_REPORT_DIR');
  if (dir !== null) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `perf-${record.series}-${record.country}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return record;
}

/** Durée (ms, horloge monotone du client) d'un appel : aller-retour complet vu de l'API. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}

/** Nombre d'échantillons des séries séquentielles (fumée : signal, pas une charge, 17 §12). */
export const SMOKE_SAMPLES = 40;
/** Appels de chauffe écartés de la mesure (plans « custom » des 5 premières exécutions, ADR-056). */
export const SMOKE_WARMUP = 6;
