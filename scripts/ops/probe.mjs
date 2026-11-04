// Sonde de continuité de service (US-051, ADR-082) : joue le RÉPARTITEUR et un client pendant une
// rotation de secret sur la préproduction locale. Envoie une requête toutes les `intervalMs` à
// l'une des instances EN SERVICE (lues à chaque requête dans le fichier des cibles : une instance
// retirée par scripts/ops/roll-local.sh avant son redémarrage ne reçoit plus rien, comme une cible
// désenregistrée du répartiteur), et compte toute réponse autre que 200.
//
//   node scripts/ops/probe.mjs <fichier-des-cibles> <fichier-du-rapport> [intervalMs]
//
// S'arrête sur SIGTERM ou SIGINT et écrit le rapport JSON : requêtes, échecs, premiers échecs
// (code, cible, instant), aucune donnée de réponse.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [targetsFile, reportFile, interval = '250'] = process.argv.slice(2);
if (targetsFile === undefined || reportFile === undefined) {
  console.error('usage : node scripts/ops/probe.mjs <cibles> <rapport> [intervalMs]');
  process.exit(2);
}
const intervalMs = Number(interval);
const report = { startedAt: new Date().toISOString(), requests: 0, failures: 0, firstFailures: [] };
let running = true;

const stop = () => {
  running = false;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function targets() {
  try {
    return readFileSync(targetsFile, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^http:\/\/127\.0\.0\.1:\d+$/.test(l));
  } catch {
    return [];
  }
}

let i = 0;
while (running) {
  const list = targets();
  if (list.length === 0) {
    report.failures += 1;
    report.requests += 1;
    if (report.firstFailures.length < 20) {
      report.firstFailures.push({
        at: new Date().toISOString(),
        target: null,
        code: 'AUCUNE_CIBLE',
      });
    }
  } else {
    const target = list[i % list.length];
    i += 1;
    let code;
    try {
      const r = await fetch(`${target}/brand/content?locale=es`, {
        signal: AbortSignal.timeout(5_000),
      });
      code = r.status;
      await r.arrayBuffer();
    } catch (error) {
      code = error instanceof Error ? error.name : 'ERREUR';
    }
    report.requests += 1;
    if (code !== 200) {
      report.failures += 1;
      if (report.firstFailures.length < 20) {
        report.firstFailures.push({ at: new Date().toISOString(), target, code });
      }
    }
  }
  await sleep(intervalMs);
}
report.stoppedAt = new Date().toISOString();
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
