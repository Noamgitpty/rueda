/**
 * Fumée des adaptateurs FAKE pour la pile de développement locale (US-035, `compose.yaml`,
 * service `fakes`). Lancé par `node packages/fake-adapters/src/dev/smoke.ts`, sous
 * `RUEDA_ENV=development` : jamais dans l'image de production (paquet en `devDependencies`, C19).
 *
 * 1. Chaque FAKE se construit sous l'environnement du processus (development ou test exigé) et
 *    répond à un appel simple et déterministe.
 * 2. Contre-épreuve C19 : chaque FAKE refuse de se construire quand `RUEDA_ENV` vaut
 *    `production`, `preproduction` ou est absent (`FakeForbiddenError`).
 *
 * Sortie : une ligne JSON par contrôle, puis code 0 si tout passe, 1 sinon. Aucun secret affiché :
 * les secrets de signature sont tirés au hasard à chaque lancement et jamais écrits.
 */
import { randomBytes } from 'node:crypto';
import { FakeClock } from '../core/index.ts';
import { FakeEInvoicingProvider } from '../e-invoicing/index.ts';
import { FakeUploadScanner, InMemoryFileStore } from '../files/index.ts';
import { assertFakeAllowed, FakeForbiddenError } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import { FakeIdentityProvider } from '../identity/index.ts';
import { FakeMapTiles } from '../maps/index.ts';
import { FakeMessagingChannel } from '../messaging/index.ts';
import { FakePsp } from '../psp/index.ts';
import { FakeSignatureService } from '../signature/index.ts';

/** Instant de départ fixe : aucun FAKE ne lit l'heure système. */
const START = '2026-01-01T00:00:00.000Z';

const builders: Readonly<Record<string, (env: EnvironmentVariables) => unknown>> = {
  FakePsp: (env) =>
    new FakePsp({
      secret: randomBytes(32).toString('hex'),
      clock: () => new FakeClock(START).nowMs(),
      capabilities: [],
      env,
    }),
  FakeIdentityProvider: (env) =>
    new FakeIdentityProvider({
      clock: new FakeClock(START),
      documents: [],
      webhookSecret: randomBytes(32).toString('hex'),
      sessionTtlMs: 600_000,
      webhookToleranceSeconds: 300,
      env,
    }),
  FakeEInvoicingProvider: (env) =>
    new FakeEInvoicingProvider({ clock: new FakeClock(START), regimes: [], env }),
  FakeMessagingChannel: (env) =>
    new FakeMessagingChannel({ clock: new FakeClock(START), channel: 'EMAIL', env }),
  InMemoryFileStore: (env) => new InMemoryFileStore({ clock: new FakeClock(START), env }),
  FakeUploadScanner: (env) => new FakeUploadScanner({ clock: new FakeClock(START), env }),
  FakeSignatureService: (env) =>
    new FakeSignatureService({ clock: new FakeClock(START), maxOtpAgeMs: 300_000, env }),
  FakeMapTiles: (env) => new FakeMapTiles({ clock: new FakeClock(START), maxZoom: 18, env }),
};

/** Environnements où un FAKE doit refuser de se construire (fail-closed). */
const FORBIDDEN: readonly EnvironmentVariables[] = [
  { RUEDA_ENV: 'production' },
  { RUEDA_ENV: 'preproduction' },
  {},
];

interface Check {
  readonly check: string;
  readonly ok: boolean;
  readonly detail?: string;
}

async function run(env: EnvironmentVariables): Promise<Check[]> {
  const checks: Check[] = [];
  const allowed = assertFakeAllowed('fumée des FAKE', env);
  checks.push({ check: 'environnement', ok: true, detail: allowed });

  for (const [name, build] of Object.entries(builders)) {
    try {
      build(env);
      checks.push({ check: `${name} démarre`, ok: true });
    } catch (error) {
      checks.push({ check: `${name} démarre`, ok: false, detail: String(error) });
    }
    for (const forbidden of FORBIDDEN) {
      const label = `${name} refusé (RUEDA_ENV = ${forbidden['RUEDA_ENV'] ?? 'absent'})`;
      try {
        build(forbidden);
        checks.push({ check: label, ok: false, detail: 'construit hors development / test' });
      } catch (error) {
        checks.push({ check: label, ok: error instanceof FakeForbiddenError });
      }
    }
  }

  // Appels simples : stockage puis relecture, analyse d'un fichier texte, capacité inconnue.
  const store = new InMemoryFileStore({ clock: new FakeClock(START), env });
  const body = Buffer.from('fumee', 'utf8');
  const put = await store.put('DEV', 'fumee.txt', body);
  const got = await store.get('DEV', 'fumee.txt');
  checks.push({
    check: 'InMemoryFileStore écrit puis relit',
    ok: put.status === 'STORED' && got.status === 'FOUND' && got.body.equals(body),
  });
  const scan = await new FakeUploadScanner({ clock: new FakeClock(START), env }).scan({
    declaredMime: 'text/plain',
    body,
  });
  checks.push({
    check: 'FakeUploadScanner analyse',
    ok: scan.status === 'SCANNED',
    detail: scan.status === 'SCANNED' ? scan.report.verdict : scan.status,
  });
  const psp = builders['FakePsp']?.(env) as FakePsp;
  checks.push({
    check: 'FakePsp : capacité inconnue = non (17 §2.8)',
    ok: psp.supports('SUPPORTS_PREAUTH', '*') === false,
  });
  return checks;
}

const checks = await run(process.env).catch((error: unknown): Check[] => [
  { check: 'environnement', ok: false, detail: String(error) },
]);
for (const c of checks) console.log(JSON.stringify(c));
const failed = checks.filter((c) => !c.ok).length;
console.log(
  JSON.stringify({
    check: 'bilan',
    ok: failed === 0,
    detail: `${checks.length - failed}/${checks.length}`,
  }),
);
process.exitCode = failed === 0 ? 0 : 1;
