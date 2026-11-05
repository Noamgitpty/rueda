#!/usr/bin/env node
// Tableau de bord QA de la régression de nuit (US-047, ADR-086). Deux commandes :
//
//   build : lit l'état des jobs du run de nuit (gh api …/jobs, une ligne JSON par job) et les
//           artefacts du run (graines d'échec C11, rapport de rapprochement, rapport de mutation),
//           puis écrit `qa-dashboard.md` (résumé du run, artefact) et `qa-dashboard.json`
//           (verdict par famille, bogues à créer avec leur scénario rejouable). Job
//           `tableau-de-bord-qa` de nightly.yml.
//   board : verse les bogues de `qa-dashboard.json` au tableau des stories (docs/team/BOARD.md,
//           section « Bogues de la régression de nuit »), sans doublon (clé = run + job). Lancé
//           par l'orchestrateur sur une branche `docs/team-…` : la nuit n'a que `contents: read`
//           et n'écrit jamais dans le dépôt (moindre privilège, ADR-086).
//   verdict : code de sortie 1 si le tableau de bord n'est pas VERT (dernière étape du job :
//           une famille obligatoire absente rend la nuit rouge même si chaque job a réussi).
//
// Familles de 19 §1.8 (« Chaque nuit : régression complète ») : parcours dorés, fuzz C11 à
// 10 000, propriétés monétaires et oracles, mutation, rapprochement ; résilience et performance
// arrivent avec US-045 (lot 1). Une famille obligatoire sans aucun job est ABSENTE : verdict rouge
// et bogue (fail-closed). Gravité PROPOSÉE : S1 pour l'argent et la concurrence (19 §1.8, 16 :
// « tout écart … ouvre un bogue S1 »), S2 sinon.
//
// Aucune donnée personnelle n'entre ici : les tests tournent sur des graines synthétiques ; le
// rapport de rapprochement ne contient que des comptes par contrôle et par pays. Les textes lus
// dans les artefacts sont neutralisés avant d'être écrits en Markdown.
//
// Usage :
//   node scripts/qa/nightly-dashboard.mjs build --jobs <jobs.ndjson> --artifacts <dossier> \
//        --out <dossier> --run-url <url> --run-id <id> --sha <sha> --started <ISO> --event <nom>
//   node scripts/qa/nightly-dashboard.mjs board --report <qa-dashboard.json> [--board docs/team/BOARD.md]
//   node scripts/qa/nightly-dashboard.mjs verdict --report <qa-dashboard.json>

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DASHBOARD_JSON = 'qa-dashboard.json';
export const DASHBOARD_MD = 'qa-dashboard.md';
export const BOARD_SECTION = '## Bogues de la régression de nuit';
export const SELF_JOB = /^tableau de bord QA/;

/**
 * Familles (ordre d'affichage). `match` porte sur le nom du job tel que l'API le rend (un job
 * appelé par `suite-complete` est préfixé « suite complète / »). Un job compte dans chaque famille
 * dont un motif lui correspond (le job `rapprochement` porte aussi le parcours doré de règlement) ;
 * un job d'aucune famille compte dans « Reste de la CI ».
 */
export const FAMILIES = [
  {
    id: 'parcours',
    label: 'Parcours dorés (chaque pays configuré)',
    required: true,
    severity: 'S1',
    match: [/e2e web/i, /parcours doré/i],
  },
  {
    id: 'rapprochement',
    label: 'Rapprochement (oracle C12, règlements, remboursements, jambes)',
    required: true,
    severity: 'S1',
    match: [/rapprochement/i],
  },
  {
    id: 'fuzz',
    label: 'Fuzz C11 (10 lots de 1 000)',
    required: true,
    severity: 'S1',
    match: [/fuzz C11 \(mode long/i],
  },
  {
    id: 'proprietes',
    label: 'Propriétés monétaires et oracles',
    required: true,
    severity: 'S1',
    match: [/moteur comparé aux oracles/i, /oracles de la spécification/i],
  },
  {
    id: 'mutation',
    label: 'Mutation (@rueda/money, seuil 80 %)',
    required: true,
    severity: 'S1',
    match: [/mutation/i],
  },
  {
    id: 'resilience',
    label: 'Résilience et performance',
    required: false,
    severity: 'S2',
    pending: 'à venir avec US-045 (lot 1)',
    match: [/résilience|performance/i],
  },
  {
    id: 'ci',
    label: 'Reste de la CI rejouée (suite complète)',
    required: true,
    severity: 'S2',
    match: [],
  },
];

/** Neutralise un texte pour une cellule Markdown (aucune commande, aucun lien, une ligne). */
export function cell(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[|`<>[\]]/g, (c) => `\\${c}`)
    .slice(0, 300);
}

const REPLAY_RE = /^[A-Za-z0-9:,;._|=-]{1,2000}$/;

/** Lit les lignes JSON des jobs (`gh api --jq '.jobs[] | {…}'`) ; fail-closed. */
export function parseJobs(text) {
  const jobs = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      throw new Error(`jobs : ligne ${i + 1} illisible`);
    }
    if (typeof j?.name !== 'string' || typeof j?.status !== 'string') {
      throw new Error(`jobs : ligne ${i + 1} sans nom ni statut`);
    }
    jobs.push({
      name: j.name,
      status: j.status,
      conclusion: typeof j.conclusion === 'string' ? j.conclusion : null,
      url: typeof j.html_url === 'string' ? j.html_url : null,
    });
  }
  if (jobs.length === 0) throw new Error('jobs : aucun job lu');
  return jobs;
}

/** Familles d'un job (au moins une : « ci » à défaut). */
export function familiesOf(name) {
  const ids = FAMILIES.filter((f) => f.match.some((re) => re.test(name))).map((f) => f.id);
  return ids.length > 0 ? ids : ['ci'];
}

/** Verdict d'un job terminé ; un job en cours (hors ce job) ou inconnu compte comme un échec. */
export function verdictOf(job) {
  if (job.status !== 'completed') return 'INCOMPLET';
  if (job.conclusion === 'success') return 'OK';
  if (job.conclusion === 'skipped') return 'IGNORÉ';
  return 'ÉCHEC';
}

const yyyymmdd = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`date de début illisible : ${iso}`);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

/** Scénario rejouable d'un job en échec (commandes de docs/ops/CI.md). */
export function replayOf(jobName, startedIso, artifacts) {
  const day = yyyymmdd(startedIso);
  const shard = /lot ([0-9]) sur 10/.exec(jobName);
  if (/fuzz C11/i.test(jobName) && shard) {
    const lines = (artifacts.c11[shard[1]] ?? []).map(
      (r) => `RUEDA_C11_REPLAY=${r} pnpm --filter @rueda/db test:c11`,
    );
    return [
      ...lines,
      `RUEDA_C11_SEED=${day}${shard[1]} RUEDA_C11_RUNS=1000 RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/db test:c11 (graine à recouper avec « [C11] graine » du journal)`,
    ];
  }
  if (/mode long, 100 000/.test(jobName)) {
    return [
      `RUEDA_MONEY_ORACLE_SEED=${day} RUEDA_MONEY_ORACLE_RUNS=100000 RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS=50000 pnpm --filter @rueda/money test:oracle`,
    ];
  }
  if (/moteur comparé aux oracles/.test(jobName)) return ['pnpm --filter @rueda/money test:oracle'];
  if (/mutation/i.test(jobName)) return ['pnpm --filter @rueda/money test:mutation'];
  if (/rapprochement/i.test(jobName)) {
    return ['RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/api test:reconciliation'];
  }
  if (/e2e web/i.test(jobName)) {
    return ['pnpm turbo run build --filter=@rueda/web && pnpm --filter @rueda/web test:e2e'];
  }
  return ['rejouer les commandes du job (docs/ops/CI.md, « Rejouer en local »)'];
}

/** Lit les artefacts téléchargés (`gh run download`) ; absents = rien (non fail-closed ici). */
export function readArtifacts(dir) {
  const out = { c11: {}, reconciliation: null, mutation: null, unreadable: [] };
  if (dir === undefined || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const m = /^c11-failures-([0-9])$/.exec(name);
    if (m) {
      const file = join(dir, name, 'c11-failures.jsonl');
      if (!existsSync(file)) continue;
      const replays = [];
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (line.trim() === '') continue;
        try {
          const r = JSON.parse(line);
          if (typeof r.replay === 'string' && REPLAY_RE.test(r.replay)) replays.push(r.replay);
          else out.unreadable.push(name);
        } catch {
          out.unreadable.push(name);
        }
      }
      out.c11[m[1]] = replays.slice(0, 5);
    }
  }
  const rec = join(dir, 'rapprochement-rapport', 'rapprochement.json');
  if (existsSync(rec)) {
    try {
      out.reconciliation = JSON.parse(readFileSync(rec, 'utf8'));
    } catch {
      out.unreadable.push('rapprochement-rapport');
    }
  }
  const mut = join(dir, 'mutation-money', 'mutation.json');
  if (existsSync(mut)) {
    try {
      out.mutation = mutationScore(JSON.parse(readFileSync(mut, 'utf8')));
    } catch {
      out.unreadable.push('mutation-money');
    }
  }
  return out;
}

/** Score de mutation (schéma mutation-testing-report) : (tués + délais) / (détectables). */
export function mutationScore(report) {
  const n = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const f of Object.values(report?.files ?? {})) {
    for (const m of f.mutants ?? []) if (m.status in n) n[m.status]++;
  }
  const detected = n.Killed + n.Timeout;
  const valid = detected + n.Survived + n.NoCoverage;
  if (valid === 0) throw new Error('mutation : aucun mutant valide');
  return { score: Math.round((detected / valid) * 10000) / 100, ...n };
}

/** Rapport complet (fonction pure, hors lecture des fichiers). */
export function buildDashboard({ jobs, artifacts, runUrl, runId, sha, started, event }) {
  const own = jobs.filter((j) => !SELF_JOB.test(j.name));
  const families = FAMILIES.map((f) => {
    const mine = own
      .filter((j) => familiesOf(j.name).includes(f.id))
      .map((j) => ({ ...j, verdict: verdictOf(j) }));
    let verdict;
    if (mine.length === 0) verdict = f.required ? 'ABSENT' : 'À VENIR';
    else if (mine.some((j) => j.verdict === 'ÉCHEC' || j.verdict === 'INCOMPLET'))
      verdict = 'ÉCHEC';
    else if (mine.every((j) => j.verdict === 'IGNORÉ')) verdict = f.required ? 'ABSENT' : 'IGNORÉ';
    else verdict = 'OK';
    return {
      id: f.id,
      label: f.label,
      required: f.required,
      verdict,
      pending: f.pending ?? null,
      jobs: mine,
    };
  });
  const day = started.slice(0, 10);
  const bugs = [];
  for (const f of families) {
    const def = FAMILIES.find((x) => x.id === f.id);
    if (f.verdict === 'ABSENT') {
      bugs.push({
        key: `${runId}:${f.id}:absent`,
        family: f.label,
        job: '(aucun job exécuté)',
        severity: def.severity,
        replay: ['relancer la nuit à la main (workflow_dispatch) après correction de nightly.yml'],
        url: runUrl,
      });
    }
    for (const j of f.jobs) {
      if (j.verdict !== 'ÉCHEC' && j.verdict !== 'INCOMPLET') continue;
      // un job de plusieurs familles n'ouvre qu'un bogue (la première famille)
      if (bugs.some((b) => b.key === `${runId}:${j.name}`)) continue;
      bugs.push({
        key: `${runId}:${j.name}`,
        family: f.label,
        job: j.name,
        severity: def.severity,
        replay: replayOf(j.name, started, artifacts),
        url: j.url ?? runUrl,
      });
    }
  }
  if (artifacts.unreadable.length > 0) {
    bugs.push({
      key: `${runId}:artefacts`,
      family: 'Tableau de bord QA',
      job: `artefacts illisibles : ${[...new Set(artifacts.unreadable)].join(', ')}`,
      severity: 'S2',
      replay: ['lire les artefacts du run'],
      url: runUrl,
    });
  }
  bugs.forEach((b, i) => {
    b.id = `BUG-N${day.replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`;
  });
  const green =
    families.every(
      (f) => f.verdict === 'OK' || f.verdict === 'À VENIR' || f.verdict === 'IGNORÉ',
    ) && bugs.length === 0;
  return {
    version: 1,
    story: 'US-047',
    runId: String(runId),
    runUrl,
    sha,
    event,
    started,
    verdict: green ? 'VERT' : 'ROUGE',
    families,
    reconciliation: artifacts.reconciliation,
    mutation: artifacts.mutation,
    bugs,
  };
}

/** Markdown du tableau de bord (résumé du run et artefact). */
export function renderMarkdown(d) {
  const lines = [
    `# Tableau de bord QA — nuit du ${d.started.slice(0, 10)} : ${d.verdict}`,
    '',
    `Run [${cell(d.runId)}](${d.runUrl}) · commit \`${cell(d.sha).slice(0, 12)}\` · événement \`${cell(d.event)}\` · US-047, ADR-086`,
    '',
    '| Famille | Verdict | Jobs (OK / total) |',
    '| --- | --- | --- |',
  ];
  for (const f of d.families) {
    const ok = f.jobs.filter((j) => j.verdict === 'OK').length;
    const total = f.jobs.length === 0 ? (f.pending ?? '—') : `${ok} / ${f.jobs.length}`;
    lines.push(`| ${cell(f.label)} | ${f.verdict} | ${cell(total)} |`);
  }
  if (d.mutation) {
    lines.push(
      '',
      `**Mutation** : score ${d.mutation.score} % (tués ${d.mutation.Killed}, délais ${d.mutation.Timeout}, survivants ${d.mutation.Survived}, sans couverture ${d.mutation.NoCoverage}).`,
    );
  }
  if (d.reconciliation) {
    lines.push('', '## Rapprochement', '', '| Contrôle | Pays | Écarts |', '| --- | --- | --- |');
    for (const [key, value] of Object.entries(d.reconciliation)) {
      const checks = value?.checks ?? value;
      for (const [check, v] of Object.entries(checks ?? {})) {
        const total = typeof v === 'object' && v !== null ? v.total : v;
        lines.push(`| ${cell(check)} | ${cell(key)} | ${cell(total)} |`);
      }
    }
  }
  lines.push('', `## Bogues (${d.bugs.length})`, '');
  if (d.bugs.length === 0) lines.push('Aucun.');
  for (const b of d.bugs) {
    lines.push(
      `- **${b.id}** (${b.severity}) — ${cell(b.family)} — ${cell(b.job)} — [journal](${b.url})`,
    );
    for (const r of b.replay) lines.push(`  - rejouer : \`${cell(r)}\``);
  }
  lines.push(
    '',
    'Les bogues sont versés au tableau des stories par l’orchestrateur : `node scripts/qa/nightly-dashboard.mjs board --report qa-dashboard.json` (ADR-086).',
    '',
  );
  return lines.join('\n');
}

/** Lignes de tableau à ajouter à BOARD.md (sans doublon). */
export function boardRows(report, boardText) {
  const rows = [];
  for (const b of report.bugs ?? []) {
    const marker = `<!-- nuit:${b.key} -->`;
    if (boardText.includes(marker)) continue;
    rows.push(
      `| ${b.id} | ${report.started.slice(0, 10)} | ${b.severity} | ${cell(b.family)} | ${cell(b.job)} | \`${cell(b.replay[0] ?? '')}\` | [run](${report.runUrl}) | TODO ${marker} |`,
    );
  }
  return rows;
}

/** Texte de BOARD.md après ajout des bogues (section créée au besoin, en fin de fichier). */
export function applyToBoard(report, boardText) {
  const rows = boardRows(report, boardText);
  if (rows.length === 0) return { text: boardText, added: 0 };
  let text = boardText.replace(/\s*$/, '\n');
  if (!text.includes(BOARD_SECTION)) {
    text += [
      '',
      BOARD_SECTION,
      '',
      '> Versés depuis le tableau de bord QA de la nuit (US-047, ADR-086) par `node scripts/qa/nightly-dashboard.mjs board`. Gravité PROPOSÉE : S1 argent et concurrence, S2 sinon.',
      '',
      '| Bogue | Nuit | Gravité | Famille | Job | Rejeu | Run | Statut |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '',
    ].join('\n');
  }
  const idx = text.indexOf(BOARD_SECTION);
  const after = text.slice(idx);
  const tableEnd = (() => {
    const lines = after.split('\n');
    let last = -1;
    lines.forEach((l, i) => {
      if (l.startsWith('|')) last = i;
    });
    return last;
  })();
  const lines = after.split('\n');
  lines.splice(tableEnd + 1, 0, ...rows);
  return { text: text.slice(0, idx) + lines.join('\n'), added: rows.length };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`argument inattendu : ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`valeur manquante : ${a}`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

function need(o, k) {
  if (typeof o[k] !== 'string' || o[k] === '') throw new Error(`--${k} requis`);
  return o[k];
}

export function main(argv) {
  const [command, ...rest] = argv;
  const o = args(rest);
  if (command === 'build') {
    const jobs = parseJobs(readFileSync(need(o, 'jobs'), 'utf8'));
    const artifacts = readArtifacts(o.artifacts);
    const d = buildDashboard({
      jobs,
      artifacts,
      runUrl: need(o, 'run-url'),
      runId: need(o, 'run-id'),
      sha: need(o, 'sha'),
      started: need(o, 'started'),
      event: need(o, 'event'),
    });
    const out = need(o, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, DASHBOARD_JSON), `${JSON.stringify(d, null, 2)}\n`);
    writeFileSync(join(out, DASHBOARD_MD), renderMarkdown(d));
    console.log(`tableau de bord QA : ${d.verdict}, ${d.bugs.length} bogue(s)`);
    return 0;
  }
  if (command === 'board') {
    const report = JSON.parse(readFileSync(need(o, 'report'), 'utf8'));
    if (report?.version !== 1 || !Array.isArray(report.bugs)) throw new Error('rapport illisible');
    const boardPath = o.board ?? 'docs/team/BOARD.md';
    const { text, added } = applyToBoard(report, readFileSync(boardPath, 'utf8'));
    writeFileSync(boardPath, text);
    console.log(`${added} bogue(s) ajouté(s) à ${boardPath}`);
    return 0;
  }
  if (command === 'verdict') {
    const report = JSON.parse(readFileSync(need(o, 'report'), 'utf8'));
    if (report?.version !== 1 || !Array.isArray(report.bugs)) throw new Error('rapport illisible');
    if (report.verdict === 'VERT') return 0;
    console.error(`tableau de bord QA : ${String(report.verdict)}, ${report.bugs.length} bogue(s)`);
    return 1;
  }
  throw new Error('commande attendue : build, board ou verdict');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`nightly-dashboard : ${error.message}`);
    process.exitCode = 1;
  }
}
