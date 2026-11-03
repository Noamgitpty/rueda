// Tests de la porte « dépendances » (node --test scripts/ci/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './audit-gate.mjs';

const adv = (ghsa, severity, module_name) => ({
  github_advisory_id: ghsa,
  severity,
  module_name,
  vulnerable_versions: '<9',
  title: 't',
});
const audit = (...advs) => ({ advisories: Object.fromEntries(advs.map((a, i) => [i, a])) });
const EX = [
  { ghsa: 'GHSA-27r3-jxmh-p828', package: 'body-parser', expires: '2026-11-06', why: 'w' },
];
const BP = adv('GHSA-27r3-jxmh-p828', 'high', 'body-parser');

test('vulnérabilité élevée couverte et non expirée : succès avec avertissement', () => {
  const r = evaluateAudit(audit(BP), EX, '2026-11-06');
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});

test('exception expirée : échec (même jour + 1)', () => {
  assert.match(evaluateAudit(audit(BP), EX, '2026-11-07').errors[0], /expirée/);
});

test('exception expirée sans vulnérabilité : échec quand même', () => {
  assert.match(evaluateAudit(audit(), EX, '2026-11-07').errors[0], /expirée/);
});

test('nouvelle vulnérabilité élevée ou critique non nommée : échec', () => {
  const r = evaluateAudit(audit(BP, adv('GHSA-aaaa-bbbb-cccc', 'critical', 'x')), EX, '2026-11-01');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /GHSA-aaaa-bbbb-cccc/);
});

test('gravité modérée : ignorée', () => {
  const r = evaluateAudit(
    audit(adv('GHSA-g3hv-75wg-m249', 'moderate', 'minimatch')),
    [],
    '2026-11-01',
  );
  assert.deepEqual(r.errors, []);
});

test('exception sur un autre paquet que celui trouvé : échec', () => {
  const r = evaluateAudit(audit(adv('GHSA-27r3-jxmh-p828', 'high', 'autre')), EX, '2026-11-01');
  assert.match(r.errors[0], /déclarée pour body-parser/);
});

test('exception sans date ou GHSA mal formé : échec', () => {
  const bad = [
    { ghsa: 'GHSA-27r3-jxmh-p828', why: 'w' },
    { ghsa: 'CVE-1', expires: '2026-11-06' },
  ];
  assert.equal(evaluateAudit(audit(), bad, '2026-11-01').errors.length, 2);
});

test('sortie illisible : échec (fail-closed)', () => {
  assert.match(evaluateAudit(null, EX, '2026-11-01').errors[0], /illisible/);
});
