// Tests du tableau de bord QA de la nuit (US-047, ADR-087) : node --test scripts/qa/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyToBoard,
  BOARD_SECTION,
  buildDashboard,
  cell,
  code,
  familiesOf,
  main,
  mutationScore,
  parseJobs,
  PERF_SERIES,
  perfRecord,
  readArtifacts,
  reconciliationViolations,
  renderMarkdown,
  replayOf,
  shellQuote,
  verdictOf,
} from './nightly-dashboard.mjs';

const STARTED = '2026-11-05T03:17:04Z';
const RUN = {
  runUrl: 'https://example.invalid/run/42',
  runId: '42',
  sha: 'a'.repeat(40),
  started: STARTED,
  event: 'schedule',
};
const done = (name, conclusion = 'success') => ({
  name,
  status: 'completed',
  conclusion,
  url: `https://example.invalid/job/${encodeURIComponent(name)}`,
});

const E2E = 'suite complète / e2e web (Playwright, mobiles et PWA)';
const REC = 'rapprochement — parcours doré de règlement, oracle C12, contrôles de l’argent';
const MUTATION = 'suite complète / argent — mutation de @rueda/money (seuil 80 %)';
const lot = (i) => `fuzz C11 (mode long, lot ${i} sur 10)`;

/** Noms réels des jobs d'une nuit complète (nightly.yml ; suite-complete appelle ci.yml). */
const NIGHT = [
  'suite complète / qualité (lint, types, unitaires, build, format)',
  'suite complète / base de données (PostgreSQL 16 réel, test:int, test:l0)',
  'suite complète / fuzz C11 (1 000 exécutions) et oracle C12',
  E2E,
  "suite complète / guide d'installation (docker compose sur runner vierge)",
  'suite complète / infrastructure (OpenTofu fmt, validate, tofu test simulé)',
  'suite complète / déploiement local (image de production, retour arrière, reconstruction)',
  'suite complète / reprise — restauration chronométrée (RTO, RPO)',
  'suite complète / reprise — rotation des secrets sans coupure',
  'suite complète / oracles de la spécification (Python 3.12)',
  'suite complète / argent — moteur comparé aux oracles (10 000 cas)',
  MUTATION,
  'suite complète / analyse des secrets (gitleaks)',
  'suite complète / analyse des dépendances (pnpm audit)',
  'suite complète / rendu mmdc des diagrammes',
  'argent — moteur comparé aux oracles (mode long, 100 000 cas)',
  REC,
  ...Array.from({ length: 10 }, (_, i) => lot(i)),
  'tableau de bord QA (régression de nuit)',
];
/** Jobs réservés aux PR : ignorés la nuit, jamais attendus. */
const PR_ONLY = [
  'suite complète / revues indépendantes (check-reviews)',
  'suite complète / entrée de CHANGELOG (changelog.d)',
];

function nightJobs(overrides = {}, { drop = [] } = {}) {
  return [...NIGHT, ...PR_ONLY]
    .filter((n) => !drop.includes(n))
    .map((n) => {
      if (PR_ONLY.includes(n)) return done(n, 'skipped');
      return n in overrides ? { ...done(n), ...overrides[n] } : done(n);
    });
}
const REC_REPORT = {
  argent_X: { violations: '0', checks: { SETTLEMENT_LEGS_SUM: { total: '0', byCountry: {} } } },
  c12_X: { TRIP_WITHOUT_ACTIVE_OCCUPANCY: '0' },
};
/** Rapport de performance (packages/db/test/support/perf.ts) : pays de test neutres X et Y. */
const perfRaw = (series, country, p95, ms = 300) => ({
  schema: 'rueda.perf-fumee/1',
  series,
  country,
  n: 40,
  p50: p95 / 2,
  p95,
  max: p95 + 1,
  target: { ms: series.startsWith('publication') ? null : ms, ref: 'x', blocking: false },
  run: { sha: 'b'.repeat(40), machine: { cpuModel: 'CPU de test', cores: 4 } },
});
const PERF_OK = ['XA', 'YB'].flatMap((cc) =>
  PERF_SERIES.map((s) => perfRecord(perfRaw(s, cc, 100))),
);
const GREEN = {
  c11: {},
  reconciliation: REC_REPORT,
  mutation: null,
  perf: PERF_OK,
  unreadable: [],
};
const build = (jobs, artifacts = GREEN, run = RUN) => buildDashboard({ ...run, jobs, artifacts });
const verdicts = (d) => Object.fromEntries(d.families.map((f) => [f.id, f.verdict]));

test('familles : chaque job classé ; le rapprochement porte aussi le parcours doré', () => {
  assert.deepEqual(familiesOf(E2E), ['parcours']);
  assert.deepEqual(familiesOf(REC), ['parcours', 'rapprochement']);
  assert.deepEqual(familiesOf(lot(3)), ['fuzz']);
  assert.deepEqual(familiesOf('suite complète / fuzz C11 (1 000 exécutions) et oracle C12'), [
    'ci',
  ]);
  assert.deepEqual(familiesOf('argent — moteur comparé aux oracles (mode long, 100 000 cas)'), [
    'proprietes',
  ]);
  assert.deepEqual(familiesOf(MUTATION), ['mutation']);
  assert.deepEqual(familiesOf('suite complète / analyse des secrets (gitleaks)'), ['ci']);
});

test('verdict d’un job : seul « success » est OK ; en cours ou annulé = échec', () => {
  assert.equal(verdictOf(done('x')), 'OK');
  assert.equal(verdictOf(done('x', 'skipped')), 'IGNORÉ');
  assert.equal(verdictOf(done('x', 'failure')), 'ÉCHEC');
  assert.equal(verdictOf(done('x', 'cancelled')), 'ÉCHEC');
  assert.equal(verdictOf({ name: 'x', status: 'in_progress', conclusion: null }), 'INCOMPLET');
});

test('nuit verte : toutes les familles OK (résilience et performance comprises), jobs des PR ignorés, aucun bogue', () => {
  const d = build(nightJobs());
  assert.equal(d.verdict, 'VERT');
  assert.deepEqual(verdicts(d), {
    parcours: 'OK',
    rapprochement: 'OK',
    fuzz: 'OK',
    proprietes: 'OK',
    mutation: 'OK',
    resilience: 'OK',
    ci: 'OK',
  });
  assert.equal(d.families.find((f) => f.id === 'fuzz').jobs.length, 10);
  assert.deepEqual(d.bugs, []);
  assert.ok(!d.families.some((f) => f.jobs.some((j) => /tableau de bord/.test(j.name))));
});

test('absence partielle (revues code et qa) : un seul lot C11 sur dix ⇒ ROUGE, un bogue par lot manquant', () => {
  const drop = Array.from({ length: 9 }, (_, i) => lot(i + 1));
  const d = build(nightJobs({}, { drop }));
  assert.equal(d.verdict, 'ROUGE');
  const fuzz = d.families.find((f) => f.id === 'fuzz');
  assert.equal(fuzz.verdict, 'INCOMPLÈTE');
  assert.equal(fuzz.missing.length, 9);
  assert.equal(d.bugs.length, 9);
  assert.ok(d.bugs.every((b) => b.severity === 'S1' && /lot [1-9]$/.test(b.job)));
  assert.match(renderMarkdown(d), /INCOMPLÈTE \| 1 \/ 1 ; manquants : fuzz C11, lot 1/);
});

test('absence partielle : un lot C11 ignoré ⇒ ROUGE', () => {
  const d = build(nightJobs({ [lot(3)]: { conclusion: 'skipped' } }));
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(verdicts(d).fuzz, 'INCOMPLÈTE');
  assert.deepEqual(
    d.bugs.map((b) => b.job),
    ['job attendu absent ou ignoré : fuzz C11, lot 3'],
  );
});

test('absence partielle : e2e web retiré ou ignoré ⇒ parcours ROUGE malgré le parcours de règlement', () => {
  for (const jobs of [
    nightJobs({}, { drop: [E2E] }),
    nightJobs({ [E2E]: { conclusion: 'skipped' } }),
  ]) {
    const d = build(jobs);
    assert.equal(d.verdict, 'ROUGE');
    assert.equal(verdicts(d).parcours, 'INCOMPLÈTE');
    assert.deepEqual(d.families.find((f) => f.id === 'parcours').missing, ['e2e web']);
  }
});

test('absence partielle : un job du reste de la CI ou l’oracle long manquant ⇒ ROUGE', () => {
  const d = build(
    nightJobs(
      {},
      {
        drop: [
          'suite complète / rendu mmdc des diagrammes',
          'argent — moteur comparé aux oracles (mode long, 100 000 cas)',
        ],
      },
    ),
  );
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(verdicts(d).ci, 'INCOMPLÈTE');
  assert.equal(verdicts(d).proprietes, 'INCOMPLÈTE');
  assert.equal(d.bugs.length, 2);
});

test('famille obligatoire entièrement absente ou ignorée : ABSENT, ROUGE et un seul bogue', () => {
  const d = build(nightJobs({}, { drop: Array.from({ length: 10 }, (_, i) => lot(i)) }));
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(verdicts(d).fuzz, 'ABSENT');
  assert.equal(d.bugs.length, 1);
  assert.equal(d.bugs[0].job, '(aucun job exécuté)');
  const skipped = build(nightJobs({ [MUTATION]: { conclusion: 'skipped' } }));
  assert.equal(verdicts(skipped).mutation, 'ABSENT');
});

test('rejeu C11 au format réel d’ADR-068 : entre apostrophes, rejouable tel quel dans un shell', () => {
  const real = '1234567890:3=1,0;7=0,2,1';
  const jobs = nightJobs({ [lot(4)]: { conclusion: 'failure' } });
  const d = build(jobs, { ...GREEN, c11: { 4: [real] } });
  assert.equal(d.bugs.length, 1);
  const [b] = d.bugs;
  assert.equal(b.id, 'BUG-N20261105-01');
  assert.equal(b.severity, 'S1');
  assert.equal(
    b.replay.commands[0],
    `RUEDA_C11_REPLAY='${real}' RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/db test:c11`,
  );
  assert.match(b.replay.commands[1], /^RUEDA_C11_SEED=202611054 RUEDA_C11_RUNS=1000 /);
  // graine de 32 bits au plus (parseReplay de packages/db/test/support/c11.ts) ; le shell lit une seule affectation, valeur intacte (le « ; » ne coupe plus la commande)
  const assignment = b.replay.commands[0].split(' RUEDA_PG_TESTCONTAINERS')[0];
  const out = execFileSync('sh', ['-c', `${assignment}; printf %s "$RUEDA_C11_REPLAY"`], {
    encoding: 'utf8',
  });
  assert.equal(out, real);
  // dans le Markdown : la commande entière, sans échappement parasite
  assert.ok(renderMarkdown(d).includes(`\`${b.replay.commands[0]}\``));
});

test('apostrophe dans une valeur : fermée, échappée, rouverte', () => {
  assert.equal(shellQuote("a'b"), `'a'\\''b'`);
  const out = execFileSync('sh', ['-c', `printf %s ${shellQuote("a'b;c")}`], { encoding: 'utf8' });
  assert.equal(out, "a'b;c");
  assert.equal(code('a|b`c\nd', { table: true }), "a\\|b'c d");
  assert.equal(code('a|b'), 'a|b');
});

test('rejeu : oracles longs (graine du jour), rapprochement, e2e, jobs du reste de la CI', () => {
  const a = GREEN;
  assert.deepEqual(
    replayOf('argent — moteur comparé aux oracles (mode long, 100 000 cas)', STARTED, a).commands,
    [
      'RUEDA_MONEY_ORACLE_SEED=20261105 RUEDA_MONEY_ORACLE_RUNS=100000 RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS=50000 pnpm --filter @rueda/money test:oracle',
    ],
  );
  assert.match(replayOf(REC, STARTED, a).commands[0], /test:reconciliation/);
  assert.match(replayOf(E2E, STARTED, a).commands[0], /test:e2e/);
  assert.deepEqual(
    replayOf('suite complète / base de données (PostgreSQL 16 réel, test:int, test:l0)', STARTED, a)
      .commands,
    ['RUEDA_PG_TESTCONTAINERS=1 pnpm test:int && RUEDA_PG_TESTCONTAINERS=1 pnpm test:l0'],
  );
  assert.deepEqual(replayOf('suite complète / déploiement local (image)', STARTED, a).commands, [
    'bash scripts/deploy/rehearsal.sh',
  ]);
  // sans commande locale : on le dit, avec le job à relancer
  const gitleaks = replayOf('suite complète / analyse des secrets (gitleaks)', STARTED, a);
  assert.deepEqual(gitleaks.commands, []);
  assert.match(gitleaks.note, /relancer le job « suite complète \/ analyse des secrets/);
  assert.throws(() => replayOf('x', 'pas une date', a), /date de début illisible/);
});

test('un job de deux familles en échec n’ouvre qu’un bogue', () => {
  const d = build(nightJobs({ [REC]: { conclusion: 'failure' } }), {
    ...GREEN,
    reconciliation: null,
  });
  assert.equal(d.bugs.length, 1);
  assert.equal(verdicts(d).parcours, 'ÉCHEC');
  assert.equal(verdicts(d).rapprochement, 'ÉCHEC');
});

test('rapport de rapprochement : écart > 0, absent ou illisible ⇒ ROUGE', () => {
  assert.equal(reconciliationViolations(REC_REPORT), 0n);
  assert.equal(reconciliationViolations({ argent_X: { violations: '2' }, c12_X: { A: '1' } }), 3n);
  for (const bad of [
    null,
    {},
    { argent_X: {} },
    { c12_X: {} },
    { autre: 1 },
    { argent_X: { violations: 1 } },
  ]) {
    assert.equal(reconciliationViolations(bad), null);
  }
  const ecarts = build(nightJobs(), {
    ...GREEN,
    reconciliation: { argent_X: { violations: '1' }, c12_X: { A: '0' } },
  });
  assert.equal(ecarts.verdict, 'ROUGE');
  assert.deepEqual(
    ecarts.bugs.map((b) => [b.job, b.severity]),
    [['écarts de rapprochement : 1', 'S1']],
  );
  const absent = build(nightJobs(), { ...GREEN, reconciliation: null });
  assert.equal(absent.verdict, 'ROUGE');
  assert.equal(absent.bugs[0].job, 'rapport de rapprochement absent ou illisible');
});

test('mutation : score sous le seuil de 80 % ⇒ ROUGE ; à 80 % ⇒ VERT', () => {
  const low = build(nightJobs(), { ...GREEN, mutation: { score: 79.99 } });
  assert.equal(low.verdict, 'ROUGE');
  assert.match(low.bugs[0].job, /score de mutation 79\.99 %, sous le seuil de 80 %/);
  assert.equal(build(nightJobs(), { ...GREEN, mutation: { score: 80 } }).verdict, 'VERT');
});

test('lecture des jobs : fail-closed', () => {
  assert.throws(() => parseJobs(''), /aucun job/);
  assert.throws(() => parseJobs('{pas du json'), /illisible/);
  assert.throws(() => parseJobs('{"name":"x"}'), /sans nom ni statut/);
  const jobs = parseJobs(
    '{"name":"x","status":"completed","conclusion":"success","html_url":"u"}\n\n',
  );
  assert.deepEqual(jobs, [{ name: 'x', status: 'completed', conclusion: 'success', url: 'u' }]);
});

test('artefacts : graines C11 au format réel, rapports de rapprochement et de mutation ; texte hostile écarté', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-'));
  mkdirSync(join(dir, 'c11-failures-2'));
  writeFileSync(
    join(dir, 'c11-failures-2', 'c11-failures.jsonl'),
    [
      JSON.stringify({ seed: 1, replay: '987654321:4=1,0;9=2,0,1' }),
      JSON.stringify({ replay: "1:2=0'; rm -rf ~" }),
      JSON.stringify({ replay: '`rm -rf`' }),
      '',
    ].join('\n'),
  );
  mkdirSync(join(dir, 'rapprochement-rapport'));
  writeFileSync(
    join(dir, 'rapprochement-rapport', 'rapprochement.json'),
    JSON.stringify(REC_REPORT),
  );
  mkdirSync(join(dir, 'mutation-money'));
  writeFileSync(
    join(dir, 'mutation-money', 'mutation.json'),
    JSON.stringify({
      files: {
        a: {
          mutants: [
            { status: 'Killed' },
            { status: 'Killed' },
            { status: 'Timeout' },
            { status: 'Survived' },
            { status: 'Ignored' },
          ],
        },
      },
    }),
  );
  const a = readArtifacts(dir);
  assert.deepEqual(a.c11, { 2: ['987654321:4=1,0;9=2,0,1'] });
  assert.deepEqual(a.unreadable, ['c11-failures-2', 'c11-failures-2']);
  assert.equal(a.mutation.score, 75);
  const md = renderMarkdown(build(nightJobs(), a));
  assert.match(md, /SETTLEMENT_LEGS_SUM \| argent_X \| 0/);
  assert.match(md, /score 75 %/);
  assert.match(md, /artefacts illisibles/);
  assert.match(md, /score de mutation 75 %, sous le seuil de 80 %/);
  assert.ok(!md.includes('rm -rf'));
  assert.throws(() => mutationScore({ files: {} }), /aucun mutant/);
});

test('cellule Markdown : aucune ligne, barre, accent grave ni lien', () => {
  assert.equal(cell('a|b\n`c` [d](e) <f>'), 'a\\|b \\`c\\` \\[d\\](e) \\<f\\>');
});

test('board : section créée, bogues ajoutés une fois (clé run + job), reste du tableau intact', () => {
  const jobs = nightJobs({ [E2E]: { conclusion: 'failure' } });
  const report = build(jobs);
  const board =
    '# BOARD\n\n| Story | Titre |\n| --- | --- |\n| US-047 | x |\n\n**Total** : 1 story.\n';
  const first = applyToBoard(report, board);
  assert.equal(first.added, 1);
  assert.ok(first.text.startsWith(board.trimEnd()));
  assert.ok(first.text.includes(BOARD_SECTION));
  assert.match(first.text, /\| BUG-N20261105-01 \| 2026-11-05 \| S1 \| Parcours dorés/);
  assert.ok(
    first.text.includes(
      '| `pnpm turbo run build --filter=@rueda/web --filter=@rueda/backoffice && pnpm --filter @rueda/web test:e2e` |',
    ),
  );
  const second = applyToBoard(report, first.text);
  assert.equal(second.added, 0);
  assert.equal(second.text, first.text);
  const next = build(jobs, GREEN, { ...RUN, runId: '43', started: '2026-11-06T03:17:00Z' });
  const third = applyToBoard(next, first.text);
  assert.equal(third.added, 1);
  assert.equal(third.text.split(BOARD_SECTION).length, 2);
  assert.ok(third.text.indexOf('BUG-N20261105-01') < third.text.indexOf('BUG-N20261106-01'));
});

test('board : une section suivante et son tableau ne sont jamais touchés (revue code n° 1)', () => {
  const jobs = nightJobs({ [E2E]: { conclusion: 'failure' } });
  const created = applyToBoard(build(jobs), '# BOARD\n').text;
  const later = `${created}\n## Autre section\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n`;
  const next = build(jobs, GREEN, { ...RUN, runId: '43', started: '2026-11-06T03:17:00Z' });
  const { text, added } = applyToBoard(next, later);
  assert.equal(added, 1);
  const [bugs, other] = text.split('## Autre section');
  assert.match(bugs, /BUG-N20261106-01/);
  assert.equal(other, '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  const lines = bugs.trimEnd().split('\n');
  assert.match(lines.at(-1), /BUG-N20261106-01/);
  assert.match(lines.at(-2), /BUG-N20261105-01/);
  assert.throws(() => applyToBoard(next, `${BOARD_SECTION}\n\ntexte\n`), /sans tableau/);
});

test('main : build, verdict puis board de bout en bout ; commande inconnue refusée', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-main-'));
  const jobsFile = join(dir, 'jobs.ndjson');
  writeFileSync(
    jobsFile,
    nightJobs({ [lot(0)]: { conclusion: 'failure' } })
      .map((j) =>
        JSON.stringify({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          html_url: j.url,
        }),
      )
      .join('\n'),
  );
  const out = join(dir, 'out');
  assert.equal(
    main([
      'build',
      '--jobs',
      jobsFile,
      '--artifacts',
      join(dir, 'absent'),
      '--out',
      out,
      '--run-url',
      RUN.runUrl,
      '--run-id',
      '42',
      '--sha',
      RUN.sha,
      '--started',
      STARTED,
      '--event',
      'schedule',
    ]),
    0,
  );
  const report = JSON.parse(readFileSync(join(out, 'qa-dashboard.json'), 'utf8'));
  assert.equal(report.verdict, 'ROUGE');
  assert.match(
    readFileSync(join(out, 'qa-dashboard.md'), 'utf8'),
    /^# Tableau de bord QA — nuit du 2026-11-05 : ROUGE/,
  );
  assert.equal(main(['verdict', '--report', join(out, 'qa-dashboard.json')]), 1);
  const boardFile = join(dir, 'BOARD.md');
  writeFileSync(boardFile, '# BOARD\n');
  assert.equal(
    main(['board', '--report', join(out, 'qa-dashboard.json'), '--board', boardFile]),
    0,
  );
  assert.match(readFileSync(boardFile, 'utf8'), /BUG-N20261105-01/);
  assert.throws(() => main(['autre']), /build, board ou verdict/);
  assert.throws(() => main(['build', '--jobs']), /valeur manquante/);
});

// --- US-045 (ADR-119) : résilience et performance de fumée --------------------------------------

const DB = 'suite complète / base de données (PostgreSQL 16 réel, test:int, test:l0)';
const QUALITY = 'suite complète / qualité (lint, types, unitaires, build, format)';

test('résilience : qualité et base de données comptent aussi dans la famille, sans quitter le reste de la CI', () => {
  assert.deepEqual(familiesOf(DB), ['ci', 'resilience']);
  assert.deepEqual(familiesOf(QUALITY), ['ci', 'resilience']);
  const d = build(nightJobs());
  const res = d.families.find((f) => f.id === 'resilience');
  assert.equal(res.verdict, 'OK');
  assert.equal(res.required, true);
  assert.equal(d.families.find((f) => f.id === 'ci').verdict, 'OK');
  assert.match(renderMarkdown(d), /Performance de fumée/);
  assert.match(
    renderMarkdown(d),
    /\| pose\.c1\.transactionnelle \| XA \| 40 \| 50 \| 100 \| 101 \| 300 \| 200 \| ok \|/,
  );
});

test('performance : rapport absent alors que le job a réussi ⇒ ROUGE (fail-closed)', () => {
  const d = build(nightJobs(), { ...GREEN, perf: null });
  assert.equal(d.verdict, 'ROUGE');
  assert.deepEqual(
    d.bugs.map((b) => b.job),
    ['rapport de performance de fumée absent (artefact perf-fumee)'],
  );
});

test('performance : p95 ≥ cible ⇒ alerte S2 par série et pays, job vert ; sous la cible ⇒ rien', () => {
  const perf = PERF_OK.map((r) =>
    r.series === 'pose.c1.transactionnelle' && r.country === 'YB'
      ? perfRecord(perfRaw(r.series, r.country, 305))
      : r,
  );
  const d = build(nightJobs(), { ...GREEN, perf });
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(d.bugs.length, 1);
  assert.equal(d.bugs[0].severity, 'S2');
  assert.equal(
    d.bugs[0].job,
    'alerte de performance : pose.c1.transactionnelle (YB) p95 305 ms ≥ cible 300 ms',
  );
  assert.match(renderMarkdown(d), /\| 305 \| 306 \| 300 \| -5 \| ALERTE \|/);
  // exactement à la cible : alerte (« < 300 ms » de 17 §6.7) ; juste sous la cible : aucune
  assert.equal(perfRecord(perfRaw('pose.c1.autocommit', 'XA', 300)).alert, true);
  assert.equal(perfRecord(perfRaw('pose.c1.autocommit', 'XA', 299.9)).alert, false);
  // sans cible (publication) : jamais d'alerte, marge vide
  assert.deepEqual(
    (({ alert, marginMs }) => ({ alert, marginMs }))(
      perfRecord(perfRaw('publication.sequentielle', 'XA', 99_999)),
    ),
    { alert: false, marginMs: null },
  );
});

test('performance : série manquante dans un pays ⇒ bogue ; rapport d’un autre schéma ⇒ illisible', () => {
  const perf = PERF_OK.filter(
    (r) => !(r.series === 'calendrier.sequentielle' && r.country === 'XA'),
  );
  const d = build(nightJobs(), { ...GREEN, perf });
  assert.deepEqual(
    d.bugs.map((b) => b.job),
    ['série de performance absente : calendrier.sequentielle (XA)'],
  );
  assert.equal(perfRecord({ ...perfRaw('pose.c1.autocommit', 'XA', 1), schema: 'autre' }), null);
  assert.equal(perfRecord({ ...perfRaw('inconnue', 'XA', 1) }), null);
  assert.equal(perfRecord({ ...perfRaw('pose.c1.autocommit', 'XA', 1), p95: '1' }), null);
});

test('performance : readArtifacts lit perf-fumee/, compte un fichier illisible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-perf-'));
  mkdirSync(join(dir, 'perf-fumee'));
  writeFileSync(
    join(dir, 'perf-fumee', 'perf-pose.c1.autocommit-XA.json'),
    JSON.stringify(perfRaw('pose.c1.autocommit', 'XA', 155)),
  );
  writeFileSync(join(dir, 'perf-fumee', 'perf-x-XA.json'), '{');
  const a = readArtifacts(dir);
  assert.equal(a.perf.length, 1);
  assert.equal(a.perf[0].p95, 155);
  assert.equal(a.perf[0].marginMs, 145);
  assert.deepEqual(a.unreadable, ['perf-fumee/perf-x-XA.json']);
});
