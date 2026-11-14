// Tests de l'historique des p95 (US-045, ADR-119) : node --test scripts/qa/
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildHistory, loadRuns, parseLog, renderHistory, TARGETS } from './perf-history.mjs';

const m = (series, country, p95, cpu = 'CPU A') => ({ series, country, p95, cpu });

test('cibles reprises de 17 §6.7 sans changement', () => {
  assert.equal(TARGETS['pose.c1.autocommit'], 300);
  assert.equal(TARGETS['pose.c1.transactionnelle'], 300);
  assert.equal(TARGETS['calendrier.sequentielle'], 500);
  assert.equal(TARGETS['publication.sequentielle'], null);
});

test('journal : lignes [PERF] et, avant US-045, lignes [L0-02] du job base de données', () => {
  const log = [
    'base\tstep\t2026-11-10T10:00:00Z [L0-02] C1 avec verrou XA {"degree":100,"p95":155,"p50":40}',
    'base\tstep\t2026-11-10T10:00:01Z [L0-02] C1 transactionnel avec verrou XA {"p95":310}',
    'base\tstep\t2026-11-10T10:00:02Z [L0-02] C1 sans verrou XA {"p95":29}',
    'base\tstep\t2026-11-10T10:00:03Z [PERF] {"schema":"rueda.perf-fumee/1","series":"calendrier.sequentielle","country":"XA","p95":4.2,"run":{"machine":{"cpuModel":"CPU A"}}}',
    'base\tstep\t[PERF] {"schema":"rueda.perf-fumee/1","series":"calendrier.seq',
  ].join('\n');
  assert.deepEqual(parseLog(log), [
    m('pose.c1.autocommit', 'XA', 155, null),
    m('pose.c1.transactionnelle', 'XA', 310, null),
    m('calendrier.sequentielle', 'XA', 4.2),
  ]);
});

test('attribution : le franchissement est rattaché au premier commit au-dessus, après le dernier en dessous', () => {
  const h = buildHistory([
    {
      runId: '3',
      sha: 'c'.repeat(40),
      createdAt: '2026-11-12',
      measures: [m('pose.c1.autocommit', 'XA', 310)],
    },
    {
      runId: '1',
      sha: 'a'.repeat(40),
      createdAt: '2026-11-10',
      measures: [m('pose.c1.autocommit', 'XA', 250)],
    },
    {
      runId: '2',
      sha: 'b'.repeat(40),
      createdAt: '2026-11-11',
      measures: [m('pose.c1.autocommit', 'XA', 290)],
    },
    {
      runId: '4',
      sha: 'd'.repeat(40),
      createdAt: '2026-11-13',
      measures: [m('pose.c1.autocommit', 'XA', 263)],
    },
  ]);
  assert.deepEqual(
    h.crossings.map((x) => [x.kind, x.from?.sha.slice(0, 1), x.to.sha.slice(0, 1)]),
    [
      ['DÉPASSEMENT', 'b', 'c'],
      ['RETOUR SOUS LA CIBLE', 'c', 'd'],
    ],
  );
  const md = renderHistory(h);
  assert.match(md, /\*\*310\*\*/);
  assert.match(
    md,
    /DÉPASSEMENT — pose\.c1\.autocommit XA \(cible 300 ms\) : entre bbbbbbbbb \(290 ms\) et ccccccccc/,
  );
});

test('machines différentes : jamais comparées entre elles', () => {
  const h = buildHistory([
    {
      runId: '1',
      sha: 'a'.repeat(40),
      createdAt: '2026-11-10',
      measures: [m('pose.c1.autocommit', 'XA', 250, 'CPU A')],
    },
    {
      runId: '2',
      sha: 'b'.repeat(40),
      createdAt: '2026-11-11',
      measures: [m('pose.c1.autocommit', 'XA', 250, 'CPU B')],
    },
  ]);
  assert.deepEqual(h.crossings, []);
});

test('dossier de fetch : artefact prioritaire, sinon journal ; run sans mesure écarté', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-hist-'));
  const run = (id, files) => {
    mkdirSync(join(dir, id, 'perf-fumee'), { recursive: true });
    writeFileSync(
      join(dir, id, 'run.json'),
      JSON.stringify({ runId: Number(id), sha: 'e'.repeat(40), createdAt: `2026-11-1${id}` }),
    );
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, id, name), body);
  };
  run('1', {});
  writeFileSync(
    join(dir, '1', 'perf-fumee', 'perf-pose.c1.autocommit-XA.json'),
    JSON.stringify({
      schema: 'rueda.perf-fumee/1',
      series: 'pose.c1.autocommit',
      country: 'XA',
      p95: 120,
      run: { machine: { cpuModel: 'CPU A' } },
    }),
  );
  mkdirSync(join(dir, '2'));
  writeFileSync(
    join(dir, '2', 'run.json'),
    JSON.stringify({ runId: 2, sha: 'f'.repeat(40), createdAt: '2026-11-12' }),
  );
  writeFileSync(join(dir, '2', 'job.log'), '[L0-02] C1 avec verrou XA {"p95":181}');
  mkdirSync(join(dir, '3'));
  writeFileSync(
    join(dir, '3', 'run.json'),
    JSON.stringify({ runId: 3, sha: 'g', createdAt: '2026-11-13' }),
  );
  const runs = loadRuns(dir).sort((a, b) => a.runId.localeCompare(b.runId));
  assert.deepEqual(
    runs.map((r) => [r.runId, r.measures[0].p95]),
    [
      ['1', 120],
      ['2', 181],
    ],
  );
});
