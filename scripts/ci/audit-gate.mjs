#!/usr/bin/env node
// Porte « dépendances » de la CI (US-002) : `pnpm audit --prod --json`, puis échec si une
// vulnérabilité de gravité élevée ou critique n'est pas couverte par une exception nommée
// (GHSA) et datée de docs/ops/audit-exceptions.json. Une exception expirée fait échouer le job,
// même si la vulnérabilité a disparu (il faut la retirer du fichier). Fail-closed : une sortie
// d'audit illisible (registre indisponible…) est un échec.
// Usage : node scripts/ci/audit-gate.mjs [--exceptions docs/ops/audit-exceptions.json] [--input audit.json] [--today AAAA-MM-JJ]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function evaluateAudit(audit, exceptions, today) {
  const errors = [];
  const warnings = [];
  if (!audit || typeof audit.advisories !== 'object' || audit.advisories === null) {
    return { errors: ['sortie de pnpm audit illisible (fail-closed)'], warnings };
  }
  const byGhsa = new Map();
  for (const e of exceptions) {
    if (
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(e.ghsa ?? '') ||
      !DATE.test(e.expires ?? '')
    ) {
      errors.push(`exception invalide (ghsa et expires AAAA-MM-JJ requis) : ${JSON.stringify(e)}`);
      continue;
    }
    if (!e.why) errors.push(`exception ${e.ghsa} sans justification (why)`);
    if (today > e.expires)
      errors.push(
        `exception ${e.ghsa} expirée le ${e.expires} : corriger la dépendance puis retirer l'exception`,
      );
    byGhsa.set(e.ghsa, e);
  }
  const seen = new Set();
  for (const a of Object.values(audit.advisories)) {
    if (!BLOCKING.has(a.severity)) continue;
    const id = a.github_advisory_id;
    seen.add(id);
    const ex = byGhsa.get(id);
    if (!ex) {
      errors.push(`${a.severity} ${a.module_name} ${a.vulnerable_versions} (${id}) : ${a.title}`);
    } else if (ex.package && ex.package !== a.module_name) {
      errors.push(`exception ${id} déclarée pour ${ex.package}, trouvée sur ${a.module_name}`);
    } else if (today <= ex.expires) {
      warnings.push(`toléré jusqu'au ${ex.expires} : ${a.severity} ${a.module_name} (${id})`);
    }
  }
  for (const id of byGhsa.keys()) {
    if (!seen.has(id))
      warnings.push(`exception ${id} sans objet (vulnérabilité absente) : la retirer`);
  }
  return { errors, warnings };
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const today = opt('today') ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(today)) {
    console.error('usage : audit-gate.mjs [--exceptions f] [--input f] [--today AAAA-MM-JJ]');
    return 2;
  }
  const exceptions = JSON.parse(
    readFileSync(opt('exceptions') ?? 'docs/ops/audit-exceptions.json', 'utf8'),
  ).exceptions;
  let raw;
  if (opt('input')) {
    raw = readFileSync(opt('input'), 'utf8');
  } else {
    // pnpm audit sort avec 1 dès qu'il trouve quelque chose : seul le JSON fait foi.
    const res = spawnSync('pnpm', ['audit', '--prod', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    });
    raw = res.stdout;
  }
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    audit = null;
  }
  const { errors, warnings } = evaluateAudit(audit, exceptions, today);
  for (const w of warnings) console.log(`::warning title=pnpm audit::${w}`);
  for (const e of errors) console.log(`ÉCHEC ${e}`);
  const m = audit?.metadata?.vulnerabilities;
  if (m) console.log(`audit : ${JSON.stringify(m)} (porte : élevée et critique)`);
  console.log(`RÉSULTAT : ${errors.length ? `${errors.length} ÉCHEC(S)` : 'OK'}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
