#!/usr/bin/env node
// Historique des p95 de la performance de fumée, par commit de `main` (US-045, ADR-119).
//
// Chaque push sur `main` rejoue ci.yml ; le job `base de données` y publie l'artefact `perf-fumee`
// (un JSON par série et par pays, packages/db/test/support/perf.ts). Ce script reconstruit
// l'historique sans rien écrire dans le dépôt ni sur GitHub (lecture seule, `gh` de l'orchestrateur) :
//
//   fetch : liste les runs de ci.yml sur `main` (push), télécharge l'artefact `perf-fumee` de chacun
//           et, pour les runs antérieurs à l'artefact (ou s'il manque), relit le journal du job
//           `base de données` : lignes `[PERF] {…}` et, avant US-045, lignes `[L0-02] C1 … {…}`.
//   build : lit le dossier rempli par `fetch` (ou des runs posés à la main), écrit `perf-history.json`
//           et `perf-history.md` : une ligne par commit, le p95 de chaque série et pays, la machine,
//           et l'**attribution** de chaque franchissement de cible au premier commit fautif (le
//           commit précédent mesuré sous la cible, le suivant au-dessus : « entre A et B »).
//   baseline : références des séries suivies sans seuil bloquant (docs/qa/perf-baseline.json, lues
//           par le tableau de bord de nuit) : médiane du p95 par série, processeur et pays, sur les
//           runs du dossier qui portent l'empreinte de la machine (ADR-119).
//
// Une mesure n'est comparée qu'à une mesure de la MÊME série, du MÊME pays et du MÊME modèle de
// processeur : le job `guide d'installation` (docker compose) et le job `base de données`
// (Testcontainers) ne mesurent pas sur la même machine, et deux runners GitHub non plus.
//
// Usage :
//   node scripts/qa/perf-history.mjs fetch --out <dossier> [--limit 30] [--repo owner/nom]
//   node scripts/qa/perf-history.mjs build --dir <dossier> [--out <dossier>]
//   node scripts/qa/perf-history.mjs baseline --dir <dossier> [--out docs/qa/perf-baseline.json]
//   (fetch accepte aussi --branch <branche> --event <événement> pour relire une branche de story)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PERF_SCHEMA = 'rueda.perf-fumee/1';
/** Cibles de 17 §6.7 par série (mêmes valeurs que packages/db/test/support/perf.ts, ADR-119). */
export const TARGETS = {
  'pose.c1.autocommit': 300,
  'pose.c1.transactionnelle': 300,
  'conversion.sequentielle': 10_000,
  'calendrier.sequentielle': 500,
  'publication.sequentielle': null,
};
const DB_JOB = /base de données \(PostgreSQL/;
/** Lignes `[L0-02]` antérieures à US-045 : libellé du journal → série. */
const LEGACY = [
  [/\[L0-02\] C1 avec verrou ([A-Z]{2}) (\{.*\})\s*$/, 'pose.c1.autocommit'],
  [/\[L0-02\] C1 transactionnel avec verrou ([A-Z]{2}) (\{.*\})\s*$/, 'pose.c1.transactionnelle'],
];

/** Mesures d'un journal brut (`gh run view --log`) : `[PERF]` d'abord, sinon `[L0-02]`. */
export function parseLog(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const perf = /\[PERF\] (\{.*\})\s*$/.exec(line);
    if (perf) {
      try {
        const r = JSON.parse(perf[1]);
        if (r.schema === PERF_SCHEMA && r.series in TARGETS && typeof r.p95 === 'number') {
          out.push({
            series: r.series,
            country: r.country,
            p95: r.p95,
            cpu: r.run?.machine?.cpuModel ?? null,
          });
        }
      } catch {
        // ligne tronquée par le journal : ignorée
      }
      continue;
    }
    for (const [re, series] of LEGACY) {
      const m = re.exec(line);
      if (!m) continue;
      try {
        const r = JSON.parse(m[2]);
        if (typeof r.p95 === 'number') out.push({ series, country: m[1], p95: r.p95, cpu: null });
      } catch {
        // idem
      }
    }
  }
  // une série et un pays par run : la dernière ligne l'emporte (rejeu dans le même job)
  const keyed = new Map(out.map((r) => [`${r.series}|${r.country}`, r]));
  return [...keyed.values()];
}

/** Mesures d'un dossier d'artefact `perf-fumee`. */
export function readArtifact(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/^perf-.+\.json$/.test(name)) continue;
    const r = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (r.schema !== PERF_SCHEMA || !(r.series in TARGETS)) continue;
    out.push({
      series: r.series,
      country: r.country,
      p95: r.p95,
      cpu: r.run?.machine?.cpuModel ?? null,
    });
  }
  return out;
}

/**
 * Historique (fonction pure) : `runs` = [{ runId, sha, createdAt, measures }], triés par date.
 * Renvoie les lignes et les franchissements attribués (commit précédent sous la cible, commit
 * fautif au-dessus), par série, pays et machine.
 */
export function buildHistory(runs) {
  const sorted = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = new Map();
  const crossings = [];
  for (const run of sorted) {
    for (const m of run.measures) {
      const target = TARGETS[m.series];
      if (target === null || target === undefined) continue;
      const key = `${m.series}|${m.country}|${m.cpu ?? '?'}`;
      const prev = last.get(key);
      const over = m.p95 >= target;
      if (prev && prev.over !== over) {
        crossings.push({
          series: m.series,
          country: m.country,
          cpu: m.cpu,
          kind: over ? 'DÉPASSEMENT' : 'RETOUR SOUS LA CIBLE',
          from: { sha: prev.sha, runId: prev.runId, p95: prev.p95 },
          to: { sha: run.sha, runId: run.runId, p95: m.p95 },
          target,
        });
      } else if (!prev && over) {
        crossings.push({
          series: m.series,
          country: m.country,
          cpu: m.cpu,
          kind: 'DÉPASSEMENT (premier run mesuré)',
          from: null,
          to: { sha: run.sha, runId: run.runId, p95: m.p95 },
          target,
        });
      }
      last.set(key, { over, sha: run.sha, runId: run.runId, p95: m.p95 });
    }
  }
  return { runs: sorted, crossings };
}

/** Séries suivies (mêmes que PERF_TRACKED du tableau de bord de nuit). */
export const TRACKED = ['pose.c1.transactionnelle'];

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

/** Références (fonction pure) : médiane par série suivie, processeur connu et pays. */
export function buildBaseline(runs) {
  const acc = {};
  for (const run of runs) {
    for (const m of run.measures) {
      if (!TRACKED.includes(m.series) || !m.cpu) continue;
      ((acc[m.series] ??= {})[m.cpu] ??= {})[m.country] ??= [];
      acc[m.series][m.cpu][m.country].push(m.p95);
    }
  }
  const series = Object.fromEntries(TRACKED.map((s) => [s, {}]));
  for (const [s, byCpu] of Object.entries(acc)) {
    for (const [cpu, byCountry] of Object.entries(byCpu)) {
      series[s][cpu] = Object.fromEntries(
        Object.entries(byCountry)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([c, v]) => [c, median(v)]),
      );
    }
  }
  return { schema: 'rueda.perf-baseline/1', series };
}

const short = (sha) => String(sha ?? '').slice(0, 9);

export function renderHistory(h) {
  const series = Object.keys(TARGETS);
  const countries = [...new Set(h.runs.flatMap((r) => r.measures.map((m) => m.country)))].sort();
  const cols = series.flatMap((s) => countries.map((c) => [s, c]));
  const lines = [
    '# Historique des p95 de la performance de fumée (US-045, ADR-119)',
    '',
    'p95 en ms par commit de `main` (ci.yml, job `base de données`) ; `—` = non mesuré. Cibles de 17 §6.7 : ' +
      series.map((s) => `${s} ${TARGETS[s] ?? 'aucune'}`).join(', ') +
      '.',
    '',
    `| Date | Commit | Run | ${cols.map(([s, c]) => `${s} ${c}`).join(' | ')} |`,
    `| --- | --- | --- | ${cols.map(() => '---').join(' | ')} |`,
  ];
  for (const r of h.runs) {
    const cells = cols.map(([s, c]) => {
      const m = r.measures.find((x) => x.series === s && x.country === c);
      if (!m) return '—';
      const t = TARGETS[s];
      return t !== null && m.p95 >= t ? `**${m.p95}**` : String(m.p95);
    });
    lines.push(
      `| ${r.createdAt.slice(0, 16)} | ${short(r.sha)} | ${r.runId} | ${cells.join(' | ')} |`,
    );
  }
  lines.push('', `## Franchissements de cible (${h.crossings.length})`, '');
  if (h.crossings.length === 0) lines.push('Aucun.');
  for (const x of h.crossings) {
    const from = x.from ? `${short(x.from.sha)} (${x.from.p95} ms)` : 'aucune mesure antérieure';
    lines.push(
      `- ${x.kind} — ${x.series} ${x.country} (cible ${x.target} ms) : entre ${from} et ${short(x.to.sha)} (${x.to.p95} ms, run ${x.to.runId}) ; machine ${x.cpu ?? 'inconnue'}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) o[a.slice(2)] = argv[(i += 1)];
    else o._.push(a);
  }
  return o;
}

function fetchRuns(o) {
  const out = o.out;
  if (!out) throw new Error('--out requis');
  const repo = o.repo ? ['--repo', o.repo] : [];
  const limit = String(Number(o.limit ?? 30));
  const runs = JSON.parse(
    gh([
      'run',
      'list',
      ...repo,
      '--workflow',
      'ci.yml',
      '--branch',
      o.branch ?? 'main',
      '--event',
      o.event ?? 'push',
      '--status',
      'completed',
      '--limit',
      limit,
      '--json',
      'databaseId,headSha,createdAt',
    ]),
  );
  mkdirSync(out, { recursive: true });
  for (const r of runs) {
    const dir = join(out, String(r.databaseId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'run.json'),
      JSON.stringify({ runId: r.databaseId, sha: r.headSha, createdAt: r.createdAt }),
    );
    try {
      gh([
        'run',
        'download',
        String(r.databaseId),
        ...repo,
        '--name',
        'perf-fumee',
        '--dir',
        join(dir, 'perf-fumee'),
      ]);
      continue;
    } catch {
      // artefact absent (run antérieur à US-045) : journal du job
    }
    try {
      const jobs = JSON.parse(
        gh(['run', 'view', String(r.databaseId), ...repo, '--json', 'jobs']),
      ).jobs;
      const db = jobs.find((j) => DB_JOB.test(j.name));
      if (!db) continue;
      writeFileSync(
        join(dir, 'job.log'),
        gh(['run', 'view', ...repo, '--job', String(db.databaseId), '--log']),
      );
    } catch (error) {
      console.error(`run ${r.databaseId} : journal illisible (${error.message.split('\n')[0]})`);
    }
  }
  console.log(`${runs.length} runs lus dans ${out}`);
}

export function loadRuns(dir) {
  const runs = [];
  for (const name of readdirSync(dir)) {
    const meta = join(dir, name, 'run.json');
    if (!existsSync(meta)) continue;
    const run = JSON.parse(readFileSync(meta, 'utf8'));
    const art = join(dir, name, 'perf-fumee');
    const log = join(dir, name, 'job.log');
    const measures = existsSync(art)
      ? readArtifact(art)
      : existsSync(log)
        ? parseLog(readFileSync(log, 'utf8'))
        : [];
    if (measures.length > 0) runs.push({ ...run, runId: String(run.runId), measures });
  }
  return runs;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  const o = args(rest);
  if (cmd === 'fetch') return fetchRuns(o);
  if (cmd === 'build') {
    if (!o.dir) throw new Error('--dir requis');
    const h = buildHistory(loadRuns(o.dir));
    const out = o.out ?? o.dir;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'perf-history.json'), `${JSON.stringify(h, null, 2)}\n`);
    writeFileSync(join(out, 'perf-history.md'), renderHistory(h));
    console.log(`${h.runs.length} runs mesurés, ${h.crossings.length} franchissements`);
    return undefined;
  }
  if (cmd === 'baseline') {
    if (!o.dir) throw new Error('--dir requis');
    const out = o.out ?? 'docs/qa/perf-baseline.json';
    const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
    const b = buildBaseline(loadRuns(o.dir));
    writeFileSync(
      out,
      `${JSON.stringify({ schema: b.schema, $comment: previous.$comment, series: b.series }, null, 2)}\n`,
    );
    console.log(`références écrites dans ${out}`);
    return undefined;
  }
  throw new Error('commande attendue : fetch | build | baseline');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`perf-history : ${error.message}`);
    process.exit(1);
  }
}
