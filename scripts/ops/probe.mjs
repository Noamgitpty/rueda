// Sonde de continuité de service (US-051, ADR-082) : joue le RÉPARTITEUR et un client pendant une
// rotation de secret sur la préproduction locale. Envoie une requête toutes les `intervalMs` à
// l'une des instances EN SERVICE (lues à chaque requête dans le fichier des cibles : une instance
// retirée par scripts/ops/roll-local.sh avant son redémarrage ne reçoit plus rien, comme une cible
// désenregistrée du répartiteur), et compte toute réponse autre que celle attendue. Intervalle moyen
// `intervalMs`, tiré entre la moitié et une fois et demie (un client n'est pas un métronome).
//
//   node scripts/ops/probe.mjs <fichier-des-cibles> <fichier-du-rapport> [intervalMs]
//
// S'arrête sur SIGTERM ou SIGINT et écrit le rapport JSON : requêtes, échecs, premiers échecs
// (code, cible, instant), aucune donnée de réponse.
//
// Route sondée : `GET /auth/session` avec un jeton de session bien formé mais INCONNU, tiré au
// hasard à chaque requête. La route n'a aucun cache (`Cache-Control: no-store`) et cherche le
// jeton EN BASE à chaque appel (empreinte SHA-256, `resolveSession`) : la réponse attendue est
// 401 `AUTH_REQUIRED`, rendue seulement après une lecture réussie de la base ; une base
// injoignable ou une connexion refusée donne une autre réponse (5xx), comptée comme un échec.
// Route publique existante : aucune route réservée aux tests.
import { randomBytes } from 'node:crypto';
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
      // un CLIENT ordinaire : en-têtes d'un navigateur et rythme irrégulier, sinon le garde
      // anti-robot (US-052, REGULAR_RHYTHM, NO_BROWSER_HEADERS) le ralentit à raison
      const r = await fetch(`${target}/auth/session`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (sonde de continuité rueda)',
          accept: 'application/json',
          'accept-language': 'es',
          cookie: `__Host-session=${randomBytes(32).toString('base64url')}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
      const body = await r.text();
      code = r.status === 401 && body.includes('AUTH_REQUIRED') ? 'OK' : r.status;
    } catch (error) {
      code = error instanceof Error ? error.name : 'ERREUR';
    }
    report.requests += 1;
    if (code !== 'OK') {
      report.failures += 1;
      if (report.firstFailures.length < 20) {
        report.firstFailures.push({ at: new Date().toISOString(), target, code });
      }
    }
  }
  await sleep(intervalMs * (0.5 + Math.random()));
}
report.stoppedAt = new Date().toISOString();
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
