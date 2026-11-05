// Tests du tableau de bord QA de la nuit (US-047, ADR-086) : node --test scripts/qa/
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyToBoard,
  BOARD_SECTION,
  buildDashboard,
  cell,
  familiesOf,
  main,
  mutationScore,
  parseJobs,
  readArtifacts,
  renderMarkdown,
  replayOf,
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

/** Noms des jobs d'une nuit complète (nightly.yml, suite-complete appelant ci.yml). */
function nightJobs(overrides = {}) {
  const names = [
    'suite complète / qualité (lint, types, unitaires, build, format)',
    'suite complète / base de données (PostgreSQL 16 réel, test:int, test:l0)',
    'suite complète / e2e web (Playwright, mobiles et PWA)',
    'suite complète / argent — moteur comparé aux oracles (10 000 cas)',
    'suite complète / argent — mutation de @rueda/money (seuil 80 %)',
    'suite complète / oracles de la spécification (Python 3.12)',
    'argent — moteur comparé aux oracles (mode long, 100 000 cas)',
    'rapprochement — parcours doré de règlement, oracle C12, contrôles de l’argent',
    ...Array.from({ length: 10 }, (_, i) => `fuzz C11 (mode long, lot ${i} sur 10)`),
    'tableau de bord QA (régression de nuit)',
  ];
  return names.map((n) => (n in overrides ? { ...done(n), ...overrides[n] } : done(n)));
}
const noArtifacts = { c11: {}, reconciliation: null, mutation: null, unreadable: [] };

test('familles : chaque job classé ; le rapprochement porte aussi le parcours doré', () => {
  assert.deepEqual(familiesOf('suite complète / e2e web (Playwright, mobiles et PWA)'), [
    'parcours',
  ]);
  assert.deepEqual(familiesOf('rapprochement — parcours doré de règlement, oracle C12'), [
    'parcours',
    'rapprochement',
  ]);
  assert.deepEqual(familiesOf('fuzz C11 (mode long, lot 3 sur 10)'), ['fuzz']);
  assert.deepEqual(familiesOf('suite complète / fuzz C11 (L0-09, 1 000 exécutions)'), ['ci']);
  assert.deepEqual(familiesOf('argent — moteur comparé aux oracles (mode long, 100 000 cas)'), [
    'proprietes',
  ]);
  assert.deepEqual(familiesOf('suite complète / argent — mutation de @rueda/money (seuil 80 %)'), [
    'mutation',
  ]);
  assert.deepEqual(familiesOf('suite complète / analyse des secrets (gitleaks)'), ['ci']);
});

test('verdict d’un job : seul « success » est OK ; en cours ou annulé = échec', () => {
  assert.equal(verdictOf(done('x')), 'OK');
  assert.equal(verdictOf(done('x', 'skipped')), 'IGNORÉ');
  assert.equal(verdictOf(done('x', 'failure')), 'ÉCHEC');
  assert.equal(verdictOf(done('x', 'cancelled')), 'ÉCHEC');
  assert.equal(verdictOf({ name: 'x', status: 'in_progress', conclusion: null }), 'INCOMPLET');
});

test('nuit verte : toutes les familles OK, résilience à venir, aucun bogue', () => {
  const d = buildDashboard({ ...RUN, jobs: nightJobs(), artifacts: noArtifacts });
  assert.equal(d.verdict, 'VERT');
  assert.deepEqual(Object.fromEntries(d.families.map((f) => [f.id, f.verdict])), {
    parcours: 'OK',
    rapprochement: 'OK',
    fuzz: 'OK',
    proprietes: 'OK',
    mutation: 'OK',
    resilience: 'À VENIR',
    ci: 'OK',
  });
  assert.equal(d.families.find((f) => f.id === 'fuzz').jobs.length, 10);
  assert.deepEqual(d.bugs, []);
  // le job du tableau de bord ne se compte pas lui-même
  assert.ok(!d.families.some((f) => f.jobs.some((j) => /tableau de bord/.test(j.name))));
});

test('échec d’un lot C11 : bogue S1 avec la graine d’échec et la graine du lot', () => {
  const jobs = nightJobs({ 'fuzz C11 (mode long, lot 7 sur 10)': { conclusion: 'failure' } });
  const artifacts = { ...noArtifacts, c11: { 7: ['202611057123:0,1;2'] } };
  const d = buildDashboard({ ...RUN, jobs, artifacts });
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(d.bugs.length, 1);
  const [b] = d.bugs;
  assert.equal(b.id, 'BUG-N20261105-01');
  assert.equal(b.severity, 'S1');
  assert.match(
    b.replay[0],
    /^RUEDA_C11_REPLAY=202611057123:0,1;2 pnpm --filter @rueda\/db test:c11$/,
  );
  assert.match(b.replay[1], /RUEDA_C11_SEED=202611057 RUEDA_C11_RUNS=1000/);
});

test('rejeu : oracles en mode long avec la graine du jour, rapprochement, e2e', () => {
  assert.deepEqual(
    replayOf('argent — moteur comparé aux oracles (mode long, 100 000 cas)', STARTED, noArtifacts),
    [
      'RUEDA_MONEY_ORACLE_SEED=20261105 RUEDA_MONEY_ORACLE_RUNS=100000 RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS=50000 pnpm --filter @rueda/money test:oracle',
    ],
  );
  assert.match(
    replayOf('rapprochement — parcours doré', STARTED, noArtifacts)[0],
    /test:reconciliation/,
  );
  assert.match(
    replayOf('suite complète / e2e web (Playwright)', STARTED, noArtifacts)[0],
    /test:e2e/,
  );
  assert.throws(() => replayOf('x', 'pas une date', noArtifacts), /date de début illisible/);
});

test('un job de deux familles en échec n’ouvre qu’un bogue', () => {
  const name = 'rapprochement — parcours doré de règlement, oracle C12, contrôles de l’argent';
  const d = buildDashboard({
    ...RUN,
    jobs: nightJobs({ [name]: { conclusion: 'failure' } }),
    artifacts: noArtifacts,
  });
  assert.equal(d.bugs.length, 1);
  assert.equal(d.families.find((f) => f.id === 'parcours').verdict, 'ÉCHEC');
  assert.equal(d.families.find((f) => f.id === 'rapprochement').verdict, 'ÉCHEC');
});

test('famille obligatoire absente (job retiré ou ignoré) : ROUGE et bogue (fail-closed)', () => {
  const jobs = nightJobs().filter((j) => !/fuzz C11/.test(j.name));
  const d = buildDashboard({ ...RUN, jobs, artifacts: noArtifacts });
  assert.equal(d.verdict, 'ROUGE');
  assert.equal(d.families.find((f) => f.id === 'fuzz').verdict, 'ABSENT');
  assert.equal(d.bugs[0].job, '(aucun job exécuté)');
  const skipped = nightJobs({
    'suite complète / argent — mutation de @rueda/money (seuil 80 %)': { conclusion: 'skipped' },
  });
  assert.equal(
    buildDashboard({ ...RUN, jobs: skipped, artifacts: noArtifacts }).families.find(
      (f) => f.id === 'mutation',
    ).verdict,
    'ABSENT',
  );
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

test('artefacts : graines C11, rapport de rapprochement, score de mutation ; texte hostile écarté', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-'));
  mkdirSync(join(dir, 'c11-failures-2'));
  writeFileSync(
    join(dir, 'c11-failures-2', 'c11-failures.jsonl'),
    `${JSON.stringify({ seed: 1, replay: '202611052001:1,0' })}\n${JSON.stringify({ replay: '`rm -rf`' })}\n`,
  );
  mkdirSync(join(dir, 'rapprochement-rapport'));
  writeFileSync(
    join(dir, 'rapprochement-rapport', 'rapprochement.json'),
    JSON.stringify({
      argent_X: { violations: '0', checks: { SETTLEMENT_LEGS_SUM: { total: '0' } } },
    }),
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
  assert.deepEqual(a.c11, { 2: ['202611052001:1,0'] });
  assert.deepEqual(a.unreadable, ['c11-failures-2']);
  assert.equal(a.mutation.score, 75);
  const md = renderMarkdown(buildDashboard({ ...RUN, jobs: nightJobs(), artifacts: a }));
  assert.match(md, /SETTLEMENT_LEGS_SUM \| argent_X \| 0/);
  assert.match(md, /score 75 %/);
  assert.match(md, /artefacts illisibles/);
  assert.ok(!md.includes('rm -rf'));
  assert.throws(() => mutationScore({ files: {} }), /aucun mutant/);
});

test('cellule Markdown : aucune ligne, barre, accent grave ni lien', () => {
  assert.equal(cell('a|b\n`c` [d](e) <f>'), 'a\\|b \\`c\\` \\[d\\](e) \\<f\\>');
});

test('board : section créée, bogues ajoutés une fois (clé run + job), reste du tableau intact', () => {
  const jobs = nightJobs({
    'suite complète / e2e web (Playwright, mobiles et PWA)': { conclusion: 'failure' },
  });
  const report = buildDashboard({ ...RUN, jobs, artifacts: noArtifacts });
  const board =
    '# BOARD\n\n| Story | Titre |\n| --- | --- |\n| US-047 | x |\n\n**Total** : 1 story.\n';
  const first = applyToBoard(report, board);
  assert.equal(first.added, 1);
  assert.ok(first.text.startsWith(board.trimEnd()));
  assert.ok(first.text.includes(BOARD_SECTION));
  assert.match(first.text, /\| BUG-N20261105-01 \| 2026-11-05 \| S1 \| Parcours dorés/);
  const second = applyToBoard(report, first.text);
  assert.equal(second.added, 0);
  assert.equal(second.text, first.text);
  // une nuit suivante ajoute sous la même section
  const next = buildDashboard({
    ...RUN,
    runId: '43',
    started: '2026-11-06T03:17:00Z',
    jobs,
    artifacts: noArtifacts,
  });
  const third = applyToBoard(next, first.text);
  assert.equal(third.added, 1);
  assert.equal(third.text.split(BOARD_SECTION).length, 2);
  assert.ok(third.text.indexOf('BUG-N20261105-01') < third.text.indexOf('BUG-N20261106-01'));
});

test('main : build puis board de bout en bout ; commande inconnue refusée', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-main-'));
  const jobsFile = join(dir, 'jobs.ndjson');
  writeFileSync(
    jobsFile,
    nightJobs({ 'fuzz C11 (mode long, lot 0 sur 10)': { conclusion: 'failure' } })
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
  const boardFile = join(dir, 'BOARD.md');
  writeFileSync(boardFile, '# BOARD\n');
  assert.equal(
    main(['board', '--report', join(out, 'qa-dashboard.json'), '--board', boardFile]),
    0,
  );
  assert.match(readFileSync(boardFile, 'utf8'), /BUG-N20261105-01/);
  assert.equal(main(['verdict', '--report', join(out, 'qa-dashboard.json')]), 1);
  assert.throws(() => main(['autre']), /build, board ou verdict/);
  assert.throws(() => main(['build', '--jobs']), /valeur manquante/);
});
