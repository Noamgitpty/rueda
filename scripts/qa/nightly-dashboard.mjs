#!/usr/bin/env node
// Tableau de bord QA de la régression de nuit (US-047, ADR-087). Deux commandes :
//
//   build : lit l'état des jobs du run de nuit (gh api …/jobs, une ligne JSON par job) et les
//           artefacts du run (graines d'échec C11, rapport de rapprochement, rapport de mutation),
//           puis écrit `qa-dashboard.md` (résumé du run, artefact) et `qa-dashboard.json`
//           (verdict par famille, bogues à créer avec leur scénario rejouable). Job
//           `tableau-de-bord-qa` de nightly.yml.
//   board : verse les bogues de `qa-dashboard.json` au tableau des stories (docs/team/BOARD.md,
//           section « Bogues de la régression de nuit »), sans doublon (clé = run + job), et met à
//           jour la ligne de chaque alerte suivie (suite N-16 : dernière mesure de nuit). Lancé
//           par l'orchestrateur sur une branche `docs/team-…` : la nuit n'a que `contents: read`
//           et n'écrit jamais dans le dépôt (moindre privilège, ADR-087).
//   verdict : code de sortie 1 si le tableau de bord n'est pas VERT (dernière étape du job :
//           une famille obligatoire absente rend la nuit rouge même si chaque job a réussi).
//
// Familles de 19 §1.8 (« Chaque nuit : régression complète ») : parcours dorés, fuzz C11 à
// 10 000, propriétés monétaires et oracles, mutation, rapprochement, résilience et performance de
// fumée (US-045, ADR-119 : rapports `perf-fumee`, alerte par série au-dessus de sa cible de 17 §6.7).
// Une famille obligatoire sans aucun job est ABSENTE : verdict rouge
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

const RESILIENCE_FAMILY = 'Résilience et performance de fumée';

/** Un job attendu : au moins un job terminé avec succès dont le nom correspond. */
const job = (label, re) => ({ label, re });

/**
 * Familles (ordre d'affichage). `match` porte sur le nom du job tel que l'API le rend (un job
 * appelé par `suite-complete` est préfixé « suite complète / »). Un job compte dans chaque famille
 * dont un motif lui correspond (le job `rapprochement` porte aussi le parcours doré de règlement) ;
 * un job d'aucune famille compte dans « Reste de la CI ».
 *
 * `expected` : jobs EXACTS qu'une nuit complète doit avoir réussis (revues code et qa US-047). Un
 * job attendu absent, ignoré (`skipped`) ou en échec rend la famille rouge, même si d'autres jobs
 * de la famille ont réussi (fail-closed). Les jobs réservés aux PR (`revues`, `changelog`) ne sont
 * pas attendus : ils sont ignorés la nuit.
 */
export const FAMILIES = [
  {
    id: 'parcours',
    label: 'Parcours dorés (chaque pays configuré)',
    required: true,
    severity: 'S1',
    match: [/e2e web/i, /parcours doré/i],
    expected: [
      job('e2e web', /e2e web \(Playwright/),
      job('parcours doré de règlement', /^rapprochement — parcours doré/),
    ],
  },
  {
    id: 'rapprochement',
    label: 'Rapprochement (oracle C12, règlements, remboursements, jambes)',
    required: true,
    severity: 'S1',
    match: [/rapprochement/i],
    expected: [job('rapprochement', /^rapprochement — /)],
  },
  {
    id: 'fuzz',
    label: 'Fuzz C11 (10 lots de 1 000)',
    required: true,
    severity: 'S1',
    match: [/fuzz C11 \(mode long/i],
    expected: Array.from({ length: 10 }, (_, i) =>
      job(`fuzz C11, lot ${i}`, new RegExp(`^fuzz C11 \\(mode long, lot ${i} sur 10\\)`)),
    ),
  },
  {
    id: 'proprietes',
    label: 'Propriétés monétaires et oracles',
    required: true,
    severity: 'S1',
    match: [/moteur comparé aux oracles/i, /oracles de la spécification/i],
    expected: [
      job('oracles d’argent (10 000)', /moteur comparé aux oracles \(10 000 cas\)/),
      job('oracles d’argent (100 000)', /moteur comparé aux oracles \(mode long, 100 000 cas\)/),
      job('oracles de la spécification', /oracles de la spécification/),
    ],
  },
  {
    id: 'mutation',
    label: 'Mutation (@rueda/money, seuil 80 %)',
    required: true,
    severity: 'S1',
    match: [/mutation/i],
    expected: [job('mutation de @rueda/money', /mutation de @rueda\/money/)],
  },
  {
    // US-045 (ADR-119) : les preuves vivent dans les jobs de la suite rejouée — `qualité` pour les
    // FAKE hostiles (`resilience-*.test.ts` de l'API, mode hostile de chaque port), `base de
    // données` pour la performance de fumée (L0-02, conversion, calendrier, publication), la passe
    // en horloge réelle (L0-06) et le travailleur arrêté (C17). `alsoMatch` les compte ici SANS les
    // retirer du « reste de la CI ». Le rapport `perf-fumee` est exigé (fail-closed) et toute série
    // au-dessus de sa cible ouvre une alerte (S2), même si le job est vert.
    id: 'resilience',
    label: RESILIENCE_FAMILY,
    required: true,
    severity: 'S2',
    match: [/résilience|performance/i],
    alsoMatch: [/qualité \(lint/, /base de données \(PostgreSQL/],
    expected: [
      job('FAKE hostiles (qualité)', /qualité \(lint/),
      job('performance de fumée (base de données)', /base de données \(PostgreSQL/),
    ],
  },
  {
    id: 'ci',
    label: 'Reste de la CI rejouée (suite complète)',
    required: true,
    severity: 'S2',
    match: [],
    expected: [
      job('qualité', /qualité \(lint/),
      job('base de données', /base de données \(PostgreSQL/),
      job('fuzz C11 court', /fuzz C11 \(1 000 exécutions\)/),
      job('guide d’installation', /guide d'installation/),
      job('infrastructure', /infrastructure \(OpenTofu/),
      job('déploiement local', /déploiement local/),
      job('restauration', /restauration chronométrée/),
      job('rotation des secrets', /rotation des secrets/),
      job('secrets', /analyse des secrets/),
      job('dépendances', /analyse des dépendances/),
      job('diagrammes', /rendu mmdc/),
    ],
  },
];

/** Seuil bloquant de la mutation (packages/money/stryker.config.mjs, ADR-076). */
export const MUTATION_THRESHOLD = 80;

/** Commande de relance de la nuit (après correction d'un job manquant). */
const RERUN_NIGHT = 'gh workflow run nightly.yml --ref main';
const RECONCILIATION_REPLAY =
  'RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/api test:reconciliation';
const RECONCILIATION_FAMILY = 'Rapprochement (oracle C12, règlements, remboursements, jambes)';

/**
 * Rejeu local des jobs du « reste de la CI » (docs/ops/CI.md, « Rejouer en local » ;
 * docs/qa/STRATEGIE_TESTS.md §2). `null` : pas de commande locale, relancer le job.
 */
const CI_REPLAYS = [
  [
    /qualité \(lint/,
    'pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build && pnpm format:check',
  ],
  [
    /base de données \(PostgreSQL/,
    'RUEDA_PG_TESTCONTAINERS=1 pnpm test:int && RUEDA_PG_TESTCONTAINERS=1 pnpm test:l0',
  ],
  [/fuzz C11 \(1 000 exécutions\)/, 'RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/db test:c11'],
  [/guide d'installation/, 'bash scripts/ci/run-install-guide.sh docs/ops/INSTALL.md'],
  [/déploiement local/, 'bash scripts/deploy/rehearsal.sh'],
  [/restauration chronométrée/, 'bash scripts/ops/restore-drill.sh'],
  [/rotation des secrets/, 'bash scripts/ops/rotation-drill.sh'],
  [
    /oracles de la spécification/,
    'python -I -X utf8 scripts/ci/check-spec-tools.py --specs docs/specs',
  ],
  [/analyse des dépendances/, 'node scripts/ci/audit-gate.mjs'],
  [/entrée de CHANGELOG/, 'pnpm lint:changelog'],
  [/infrastructure \(OpenTofu/, null],
  [/analyse des secrets/, null],
  [/rendu mmdc/, null],
];

/** Neutralise un texte pour une cellule Markdown (aucune commande, aucun lien, une ligne). */
export function cell(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[|`<>[\]]/g, (c) => `\\${c}`)
    .slice(0, 300);
}

/** Valeur de `RUEDA_C11_REPLAY` (ADR-068 : `<graine>` ou `<graine>:<étape>=<ordre>;…`). */
const REPLAY_RE = /^[0-9]{1,10}(:[0-9]+=[0-9]+(,[0-9]+)*(;[0-9]+=[0-9]+(,[0-9]+)*)*)?$/;

/** Mot du shell entre apostrophes (une apostrophe éventuelle est fermée, échappée, rouverte). */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Commande dans une portée de code Markdown : une ligne, sans accent grave ; `|` échappé en tableau. */
export function code(text, { table = false } = {}) {
  const one = String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, "'");
  return table ? one.replace(/\|/g, '\\|') : one;
}

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
  const also = FAMILIES.filter((f) => (f.alsoMatch ?? []).some((re) => re.test(name))).map(
    (f) => f.id,
  );
  return [...(ids.length > 0 ? ids : ['ci']), ...also.filter((id) => !ids.includes(id))];
}

/** Séries de performance attendues dans chaque pays (packages/db/test/support/perf.ts, ADR-119). */
export const PERF_SERIES = [
  'pose.c1.autocommit',
  'pose.c1.transactionnelle',
  'conversion.sequentielle',
  'calendrier.sequentielle',
  'publication.sequentielle',
];
const PERF_SCHEMA = 'rueda.perf-fumee/1';
const PERF_REPLAY = 'RUEDA_PG_TESTCONTAINERS=1 pnpm test:l0';

/**
 * Séries consignées sans seuil bloquant (ADR-056 point 4) : au-dessus de leur cible, elles sont une
 * **alerte suivie** (une seule entrée ouverte au tableau des stories, la suite nommée, mise à jour à
 * chaque nuit), pas un bogue de nuit : un rouge permanent cacherait les vrais rouges. Une
 * **régression** reste un échec : p95 au-delà de `regressionPct` % de la référence de la MÊME
 * machine (`docs/qa/perf-baseline.json`, médiane de l'historique, ADR-119). La cible de 17 §6.7
 * n'est pas relâchée : elle reste affichée et l'alerte reste ouverte tant qu'elle est dépassée.
 */
export const PERF_TRACKED = {
  'pose.c1.transactionnelle': { suite: 'N-16', regressionPct: 20 },
};
/** Références par machine (chemin relatif à la racine du dépôt, où tourne le job de nuit). */
export const PERF_BASELINE = 'docs/qa/perf-baseline.json';
const BASELINE_SCHEMA = 'rueda.perf-baseline/1';

/**
 * Références des séries suivies : `{ series: { <série>: { <processeur>: { <pays>: p95 } } } }`.
 * Fichier illisible ou d'un autre schéma ⇒ erreur (fail-closed : la nuit ne juge pas une
 * régression sans référence valide). Machine absente ⇒ aucune référence pour elle (signalé).
 */
export function perfBaseline(raw) {
  if (raw === null || typeof raw !== 'object' || raw.schema !== BASELINE_SCHEMA) {
    throw new Error(`références de performance illisibles (${PERF_BASELINE})`);
  }
  const out = {};
  for (const [series, byCpu] of Object.entries(raw.series ?? {})) {
    if (!(series in PERF_TRACKED)) throw new Error(`référence d'une série non suivie : ${series}`);
    out[series] = {};
    for (const [cpu, byCountry] of Object.entries(byCpu ?? {})) {
      out[series][cpu] = {};
      for (const [country, v] of Object.entries(byCountry ?? {})) {
        if (!/^[A-Z]{2}$/.test(country) || typeof v !== 'number' || !(v > 0)) {
          throw new Error(`référence invalide : ${series} / ${cpu} / ${country}`);
        }
        out[series][cpu][country] = v;
      }
    }
  }
  return out;
}

/** Verdict d'une série suivie (fonction pure). */
export function trackedOf(r, baseline) {
  const def = PERF_TRACKED[r.series];
  const ref = baseline?.[r.series]?.[r.cpu ?? '']?.[r.country] ?? null;
  const limit = ref === null ? null : Math.round(ref * (1 + def.regressionPct / 100) * 10) / 10;
  return {
    suite: def.suite,
    series: r.series,
    country: r.country,
    p95: r.p95,
    targetMs: r.targetMs,
    alert: r.alert,
    cpu: r.cpu,
    reference: ref,
    limit,
    regression: limit !== null && r.p95 > limit,
  };
}

/**
 * Lit un rapport de performance ; `null` s'il est illisible ou d'un autre schéma (compté illisible,
 * fail-closed). Ne garde que des nombres et des noms fermés : aucun texte libre n'atteint le
 * Markdown, sauf le modèle de processeur, neutralisé par `cell`.
 */
export function perfRecord(raw) {
  if (raw === null || typeof raw !== 'object' || raw.schema !== PERF_SCHEMA) return null;
  if (!PERF_SERIES.includes(raw.series) || !/^[A-Z]{2}$/.test(String(raw.country))) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const p95 = num(raw.p95);
  if (p95 === null || num(raw.n) === null) return null;
  const targetMs = raw.target?.ms === null ? null : num(raw.target?.ms);
  if (targetMs === null && raw.target?.ms !== null) return null;
  const sha = raw.run?.sha;
  return {
    series: raw.series,
    country: raw.country,
    n: raw.n,
    p50: num(raw.p50),
    p95,
    max: num(raw.max),
    targetMs,
    blocking: raw.target?.blocking === true,
    marginMs: targetMs === null ? null : Math.round((targetMs - p95) * 10) / 10,
    alert: targetMs !== null && p95 >= targetMs,
    sha: typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null,
    cpu: typeof raw.run?.machine?.cpuModel === 'string' ? raw.run.machine.cpuModel : null,
    cores: num(raw.run?.machine?.cores),
  };
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

/**
 * Scénario rejouable d'un job en échec : `{ commands, note }`. Chaque commande se colle telle quelle
 * dans un shell (valeurs entre apostrophes) ; `note` n'est pas une commande.
 */
export function replayOf(jobName, startedIso, artifacts) {
  const day = yyyymmdd(startedIso);
  const shard = /lot ([0-9]) sur 10/.exec(jobName);
  if (/fuzz C11 \(mode long/i.test(jobName) && shard) {
    const replays = (artifacts.c11[shard[1]] ?? []).map(
      (r) =>
        `RUEDA_C11_REPLAY=${shellQuote(r)} RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/db test:c11`,
    );
    return {
      commands: [
        ...replays,
        `RUEDA_C11_SEED=${day}${shard[1]} RUEDA_C11_RUNS=1000 RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/db test:c11`,
      ],
      note:
        replays.length > 0
          ? 'rejeu exact de l’exécution en échec (c11-failures), puis le lot entier'
          : 'aucune graine d’échec lue : lot entier ; recouper la graine avec « [C11] graine » du journal',
    };
  }
  if (/mode long, 100 000/.test(jobName)) {
    return {
      commands: [
        `RUEDA_MONEY_ORACLE_SEED=${day} RUEDA_MONEY_ORACLE_RUNS=100000 RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS=50000 pnpm --filter @rueda/money test:oracle`,
      ],
      note: 'graine du jour du run',
    };
  }
  if (/moteur comparé aux oracles/.test(jobName)) {
    return { commands: ['pnpm --filter @rueda/money test:oracle'], note: 'graine fixe' };
  }
  if (/mutation/i.test(jobName)) {
    return { commands: ['pnpm --filter @rueda/money test:mutation'], note: null };
  }
  if (/rapprochement/i.test(jobName)) return { commands: [RECONCILIATION_REPLAY], note: null };
  if (/e2e web/i.test(jobName)) {
    return {
      commands: [
        'pnpm turbo run build --filter=@rueda/web --filter=@rueda/backoffice && pnpm --filter @rueda/web test:e2e',
      ],
      note: 'Chrome installé',
    };
  }
  const known = CI_REPLAYS.find(([re]) => re.test(jobName));
  if (known && known[1] !== null) return { commands: [known[1]], note: null };
  return {
    commands: [],
    note: `pas de commande locale : relancer le job « ${jobName} » (gh run rerun <run> --failed) après correction`,
  };
}

/** Lit les artefacts téléchargés (`gh run download`) ; absents = rien (non fail-closed ici). */
export function readArtifacts(dir) {
  const out = { c11: {}, reconciliation: null, mutation: null, perf: null, unreadable: [] };
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
  const perfDir = join(dir, 'perf-fumee');
  if (existsSync(perfDir)) {
    out.perf = [];
    for (const name of readdirSync(perfDir).sort()) {
      if (!/^perf-.+\.json$/.test(name)) continue;
      let r;
      try {
        r = perfRecord(JSON.parse(readFileSync(join(perfDir, name), 'utf8')));
      } catch {
        r = null;
      }
      if (r === null) out.unreadable.push(`perf-fumee/${name}`);
      else out.perf.push(r);
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

/**
 * Total des écarts du rapport de rapprochement (`rapprochement.json` du test d'intégration :
 * `argent_<pays>.violations` et `c12_<pays>.<contrôle>`) ; null si absent, vide ou illisible.
 */
export function reconciliationViolations(report) {
  if (report === null || typeof report !== 'object') return null;
  const entries = Object.entries(report);
  if (entries.length === 0) return null;
  let total = 0n;
  for (const [key, value] of entries) {
    const counts = key.startsWith('argent_')
      ? [value?.violations]
      : key.startsWith('c12_')
        ? Object.values(value ?? {})
        : [];
    if (counts.length === 0) return null;
    for (const v of counts) {
      if (typeof v !== 'string' || !/^[0-9]{1,19}$/.test(v)) return null;
      total += BigInt(v);
    }
  }
  return total;
}

/** Rapport complet (fonction pure, hors lecture des fichiers). */
export function buildDashboard({
  jobs,
  artifacts,
  runUrl,
  runId,
  sha,
  started,
  event,
  baseline = null,
}) {
  const tracked = [];
  const own = jobs.filter((j) => !SELF_JOB.test(j.name));
  const families = FAMILIES.map((f) => {
    const mine = own
      .filter((j) => familiesOf(j.name).includes(f.id))
      .map((j) => ({ ...j, verdict: verdictOf(j) }));
    // job attendu manquant : aucun job de ce nom n'a réussi (absent, ignoré, en échec, en cours)
    const missing = f.expected
      .filter((e) => !mine.some((j) => e.re.test(j.name) && j.verdict === 'OK'))
      .map((e) => e.label);
    let verdict;
    if (mine.length === 0 || mine.every((j) => j.verdict === 'IGNORÉ')) {
      verdict = f.required ? 'ABSENT' : 'À VENIR';
    } else if (mine.some((j) => j.verdict === 'ÉCHEC' || j.verdict === 'INCOMPLET')) {
      verdict = 'ÉCHEC';
    } else if (missing.length > 0) verdict = 'INCOMPLÈTE';
    else verdict = 'OK';
    return {
      id: f.id,
      label: f.label,
      required: f.required,
      verdict,
      pending: f.pending ?? null,
      expected: f.expected.length,
      missing,
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
        replay: { commands: [RERUN_NIGHT], note: 'après correction de nightly.yml ou ci.yml' },
        url: runUrl,
      });
    } else {
      // jobs attendus manquants, hors ceux en échec (ils ont leur bogue ci-dessous)
      for (const label of f.missing) {
        const e = def.expected.find((x) => x.label === label);
        const failed = f.jobs.some(
          (j) => e.re.test(j.name) && (j.verdict === 'ÉCHEC' || j.verdict === 'INCOMPLET'),
        );
        if (failed) continue;
        bugs.push({
          key: `${runId}:${f.id}:manque:${label}`,
          family: f.label,
          job: `job attendu absent ou ignoré : ${label}`,
          severity: def.severity,
          replay: { commands: [RERUN_NIGHT], note: 'après correction de nightly.yml ou ci.yml' },
          url: runUrl,
        });
      }
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
  // contenu des rapports : un écart de rapprochement ou un score sous le seuil rend la nuit rouge
  const recJob = families
    .find((f) => f.id === 'rapprochement')
    .jobs.find((j) => j.verdict === 'OK');
  const recViolations = reconciliationViolations(artifacts.reconciliation);
  if (recViolations === null && recJob) {
    bugs.push({
      key: `${runId}:rapprochement:rapport`,
      family: RECONCILIATION_FAMILY,
      job: 'rapport de rapprochement absent ou illisible',
      severity: 'S1',
      replay: { commands: [RECONCILIATION_REPLAY], note: null },
      url: recJob.url ?? runUrl,
    });
  } else if (recViolations !== null && recViolations > 0n) {
    bugs.push({
      key: `${runId}:rapprochement:ecarts`,
      family: RECONCILIATION_FAMILY,
      job: `écarts de rapprochement : ${recViolations}`,
      severity: 'S1',
      replay: { commands: [RECONCILIATION_REPLAY], note: null },
      url: runUrl,
    });
  }
  if (artifacts.mutation && !(artifacts.mutation.score >= MUTATION_THRESHOLD)) {
    bugs.push({
      key: `${runId}:mutation:seuil`,
      family: 'Mutation (@rueda/money, seuil 80 %)',
      job: `score de mutation ${artifacts.mutation.score} %, sous le seuil de ${MUTATION_THRESHOLD} %`,
      severity: 'S1',
      replay: { commands: ['pnpm --filter @rueda/money test:mutation'], note: null },
      url: runUrl,
    });
  }
  // performance de fumée (US-045, ADR-119) : rapport exigé dès que le job qui le produit a réussi ;
  // chaque série dans chaque pays mesuré ; une série au-dessus de sa cible = alerte (S2), même si
  // le job est vert (aucun seuil relâché : seul C1 en autocommit fait échouer son test)
  const perfJob = families
    .find((f) => f.id === 'resilience')
    .jobs.find((j) => /base de données \(PostgreSQL/.test(j.name) && j.verdict === 'OK');
  const perf = artifacts.perf ?? null;
  if (perfJob && (perf === null || perf.length === 0)) {
    bugs.push({
      key: `${runId}:perf:rapport`,
      family: RESILIENCE_FAMILY,
      job: 'rapport de performance de fumée absent (artefact perf-fumee)',
      severity: 'S2',
      replay: { commands: [PERF_REPLAY], note: 'avec RUEDA_QA_REPORT_DIR défini' },
      url: perfJob.url ?? runUrl,
    });
  } else if (perf !== null && perf.length > 0) {
    const countries = [...new Set(perf.map((r) => r.country))].sort();
    for (const country of countries) {
      for (const series of PERF_SERIES) {
        if (perf.some((r) => r.country === country && r.series === series)) continue;
        bugs.push({
          key: `${runId}:perf:manque:${series}:${country}`,
          family: RESILIENCE_FAMILY,
          job: `série de performance absente : ${series} (${country})`,
          severity: 'S2',
          replay: { commands: [PERF_REPLAY], note: null },
          url: runUrl,
        });
      }
    }
    for (const r of perf.filter((x) => x.series in PERF_TRACKED)) {
      const t = trackedOf(r, baseline);
      tracked.push(t);
      if (!t.regression) continue;
      bugs.push({
        key: `${runId}:perf:regression:${r.series}:${r.country}`,
        family: RESILIENCE_FAMILY,
        job: `régression de performance : ${r.series} (${r.country}) p95 ${r.p95} ms > ${t.limit} ms (référence ${t.reference} ms de la machine + ${PERF_TRACKED[r.series].regressionPct} %)`,
        severity: 'S2',
        replay: {
          commands: [PERF_REPLAY],
          note: 'historique par commit : node scripts/qa/perf-history.mjs (ADR-119)',
        },
        url: runUrl,
      });
    }
    for (const r of perf.filter((x) => x.alert && !(x.series in PERF_TRACKED))) {
      bugs.push({
        key: `${runId}:perf:alerte:${r.series}:${r.country}`,
        family: RESILIENCE_FAMILY,
        job: `alerte de performance : ${r.series} (${r.country}) p95 ${r.p95} ms ≥ cible ${r.targetMs} ms`,
        severity: 'S2',
        replay: {
          commands: [PERF_REPLAY],
          note: 'historique par commit : node scripts/qa/perf-history.mjs (ADR-119)',
        },
        url: runUrl,
      });
    }
  }
  if (artifacts.unreadable.length > 0) {
    bugs.push({
      key: `${runId}:artefacts`,
      family: 'Tableau de bord QA',
      job: `artefacts illisibles : ${[...new Set(artifacts.unreadable)].join(', ')}`,
      severity: 'S2',
      replay: { commands: [], note: 'lire les artefacts du run' },
      url: runUrl,
    });
  }
  bugs.forEach((b, i) => {
    b.id = `BUG-N${day.replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`;
  });
  const green =
    families.every((f) => f.verdict === 'OK' || f.verdict === 'À VENIR') && bugs.length === 0;
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
    performance: artifacts.perf ?? null,
    tracked,
    bugs,
  };
}

/** Markdown du tableau de bord (résumé du run et artefact). */
export function renderMarkdown(d) {
  const lines = [
    `# Tableau de bord QA — nuit du ${d.started.slice(0, 10)} : ${d.verdict}`,
    '',
    `Run [${cell(d.runId)}](${d.runUrl}) · commit \`${cell(d.sha).slice(0, 12)}\` · événement \`${cell(d.event)}\` · US-047, ADR-087`,
    '',
    '| Famille | Verdict | Jobs réussis / vus |',
    '| --- | --- | --- |',
  ];
  for (const f of d.families) {
    const ok = f.jobs.filter((j) => j.verdict === 'OK').length;
    const seen = f.jobs.length === 0 ? (f.pending ?? '—') : `${ok} / ${f.jobs.length}`;
    const miss =
      f.missing.length > 0 && f.verdict !== 'ABSENT'
        ? ` ; manquants : ${f.missing.join(', ')}`
        : '';
    lines.push(`| ${cell(f.label)} | ${f.verdict} | ${cell(seen + miss)} |`);
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
  if (d.performance && d.performance.length > 0) {
    lines.push(
      '',
      '## Performance de fumée (US-045, ADR-119)',
      '',
      '| Série | Pays | n | p50 | p95 | max | Cible | Marge | État |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of d.performance) {
      const target = r.targetMs === null ? '—' : `${r.targetMs}${r.blocking ? ' (bloquant)' : ''}`;
      const margin = r.marginMs === null ? '—' : `${r.marginMs}`;
      lines.push(
        `| ${cell(r.series)} | ${cell(r.country)} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | ${target} | ${margin} | ${r.alert ? 'ALERTE' : 'ok'} |`,
      );
    }
    const m = d.performance[0];
    lines.push(
      '',
      `Machine : ${cell(m.cpu ?? 'inconnue')}, ${m.cores ?? '?'} cœurs ; durées en ms, côté client.`,
    );
  }
  if ((d.tracked ?? []).length > 0) {
    lines.push(
      '',
      '## Alertes suivies (sans échec de la nuit, ADR-119)',
      '',
      '| Suite | Série | Pays | p95 | Cible | Référence machine | Limite de régression | État |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const t of d.tracked) {
      const state = t.regression ? 'RÉGRESSION' : t.alert ? 'ALERTE SUIVIE' : 'ok';
      lines.push(
        `| ${cell(t.suite)} | ${cell(t.series)} | ${cell(t.country)} | ${t.p95} | ${t.targetMs ?? '—'} | ${t.reference ?? 'aucune (machine sans référence)'} | ${t.limit ?? '—'} | ${state} |`,
      );
    }
  }
  lines.push('', `## Bogues (${d.bugs.length})`, '');
  if (d.bugs.length === 0) lines.push('Aucun.');
  for (const b of d.bugs) {
    lines.push(
      `- **${b.id}** (${b.severity}) — ${cell(b.family)} — ${cell(b.job)} — [journal](${b.url})`,
    );
    for (const c of b.replay.commands) lines.push(`  - rejouer : \`${code(c)}\``);
    if (b.replay.note) lines.push(`  - ${cell(b.replay.note)}`);
  }
  lines.push(
    '',
    'Les bogues sont versés au tableau des stories par l’orchestrateur : `node scripts/qa/nightly-dashboard.mjs board --report qa-dashboard.json` (ADR-087).',
    '',
  );
  return lines.join('\n');
}

/** Cellule « Rejeu » du tableau des stories : première commande, sinon la note. */
function replayCell(replay) {
  const first = replay.commands[0];
  return first === undefined ? cell(replay.note ?? '—') : `\`${code(first, { table: true })}\``;
}

/** Lignes de tableau à ajouter à BOARD.md (sans doublon). */
export function boardRows(report, boardText) {
  const rows = [];
  for (const b of report.bugs ?? []) {
    const marker = `<!-- nuit:${b.key} -->`;
    if (boardText.includes(marker)) continue;
    rows.push(
      `| ${b.id} | ${report.started.slice(0, 10)} | ${b.severity} | ${cell(b.family)} | ${cell(b.job)} | ${replayCell(b.replay)} | [run](${report.runUrl}) | TODO ${marker} |`,
    );
  }
  return rows;
}

/**
 * Alertes suivies : la ligne de la suite (`| N-16 |` du tableau des suites) reçoit la dernière
 * mesure de nuit entre deux marqueurs, remplacée à chaque nuit (une seule entrée, aucun doublon).
 * Ligne absente ⇒ erreur (l'alerte ne doit pas se perdre en silence).
 */
export function applyTracked(report, boardText) {
  const bySuite = new Map();
  for (const t of report.tracked ?? []) {
    if (!t.alert && !t.regression) continue;
    bySuite.set(t.suite, [...(bySuite.get(t.suite) ?? []), t]);
  }
  let text = boardText;
  for (const [suite, items] of bySuite) {
    const open = `<!-- suivi-nuit:${suite} -->`;
    const close = `<!-- /suivi-nuit:${suite} -->`;
    const values = items
      .map((t) => `${t.country} ${t.p95} ms${t.regression ? ' (RÉGRESSION)' : ''}`)
      .join(', ');
    const note = `${open} nuit du ${report.started.slice(0, 10)} : ${cell(items[0].series)} ${values}, cible ${items[0].targetMs} ms ([run](${report.runUrl}))${close}`;
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.startsWith(`| ${suite} `));
    if (i < 0) throw new Error(`suite ${suite} introuvable au tableau des stories`);
    const row = lines[i];
    const a = row.indexOf(open);
    if (a >= 0) {
      const b = row.indexOf(close, a);
      if (b < 0) throw new Error(`marqueur de suivi ${suite} incomplet`);
      lines[i] = row.slice(0, a) + note + row.slice(b + close.length);
    } else {
      const end = row.lastIndexOf('|');
      lines[i] = `${row.slice(0, end).replace(/\s+$/, '')} ${note} |`;
    }
    text = lines.join('\n');
  }
  return { text, updated: bySuite.size };
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
      '> Versés depuis le tableau de bord QA de la nuit (US-047, ADR-087) par `node scripts/qa/nightly-dashboard.mjs board`. Gravité PROPOSÉE : S1 argent et concurrence, S2 sinon.',
      '',
      '| Bogue | Nuit | Gravité | Famille | Job | Rejeu | Run | Statut |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '',
    ].join('\n');
  }
  // la section s'arrête au titre de niveau 2 suivant : on n'écrit jamais dans un autre tableau
  const lines = text.split('\n');
  const head = lines.indexOf(BOARD_SECTION);
  if (head < 0) throw new Error('section des bogues introuvable');
  let stop = lines.findIndex((l, i) => i > head && /^## /.test(l));
  if (stop < 0) stop = lines.length;
  let last = -1;
  for (let i = head + 1; i < stop; i++) if (lines[i].startsWith('|')) last = i;
  if (last < 0) throw new Error('section des bogues sans tableau : la corriger à la main');
  lines.splice(last + 1, 0, ...rows);
  return { text: lines.join('\n'), added: rows.length };
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
    const baselinePath = o.baseline ?? PERF_BASELINE;
    const baseline = perfBaseline(JSON.parse(readFileSync(baselinePath, 'utf8')));
    const d = buildDashboard({
      jobs,
      artifacts,
      baseline,
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
    const { text: final, updated } = applyTracked(report, text);
    writeFileSync(boardPath, final);
    console.log(
      `${added} bogue(s) ajouté(s), ${updated} alerte(s) suivie(s) mise(s) à jour dans ${boardPath}`,
    );
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
