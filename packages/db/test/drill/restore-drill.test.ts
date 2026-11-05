/**
 * US-051 — EXERCICE DE RESTAURATION CHRONOMÉTRÉ (19 US-051 critères 1, 2 et 4 ; 16 ADM-032 /
 * ADM-035 ; 17 §6.4 ; ADR-082). Lancé par scripts/ops/restore-drill.sh (job CI « reprise »), sur
 * une instance PostgreSQL 16 en conteneur dont les journaux de transactions sont archivés en continu.
 *
 * Les étapes de la procédure (sauvegarde, restauration, vérification, bascule) ne sont PAS écrites
 * ici : elles sont lues et exécutées telles quelles dans docs/ops/BACKUP_RESTORE.md (blocs
 * « bash exercice-<étape> », scripts/ops/runbook.mjs). Ce fichier crée les données, chronomètre, et
 * compare ce que la restauration rend à ce qui existait.
 *
 * Scénarios :
 *   A. « erreur récente » : restauration à l'instant T dans une NOUVELLE instance ⇒ données
 *      identiques à celles de T (comptes de lignes, sommes d'argent par devise, tête de la chaîne
 *      d'audit), écritures d'après la sauvegarde présentes, AUCUNE écriture postérieure à T ;
 *      catalogue de sécurité (rôles, appartenances, politiques, RLS, droits) identique ; contrôles
 *      d'intégrité verts (chaîne d'audit, oracle C12, invariants d'argent, aucune occupation
 *      orpheline) ; l'application redémarre dessus. RTO mesuré.
 *   B. « perte de l'instance » : l'instance source est tuée sans préavis ; restauration au plus
 *      récent des journaux archivés ⇒ RPO mesuré (instant de la perte − dernière écriture rendue),
 *      intégrité verte, application redémarrée. RTO mesuré.
 * Cibles de 17 §6.4 (À DÉCIDER, ADM-035) : RPO ≤ 24 h exigé, cible ≤ 1 h ; RTO ≤ 8 h. Le rapport
 * (RUEDA_DRILL_WORK/report.json, artefact CI) consigne les mesures et la comparaison à la mesure de
 * référence (docs/ops/restore-drill-baseline.json), rejouée à chaque porte de lot (critère 4).
 *
 * Données : les deux pays de premier rang (devise à décimales et devise sans décimale) — trips réservés (hold, preuve de paiement,
 * conversion), règlements par jambe (vecteurs dorés TJ), journal d'audit chaîné — écrites sous les
 * rôles de PRODUCTION (assertion L0-05 à chaque connexion). Les contrôles de catalogue et les
 * empreintes lisent sous l'administration de l'instance, en lecture seule (outil d'exploitation).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAuditLog, SubjectKeyStore } from '../../src/audit/index.ts';
import { catalogFingerprint, dataFingerprint } from '../../src/restore/verify.ts';
import type { DataFingerprint } from '../../src/restore/verify.ts';
import {
  assertProductionRole,
  benchInfo,
  connectAs,
  FakeKeyWrapper,
  releaseClient,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { auditTx } from '../support/audit.ts';
import { at, bookTrip, COUNTRIES, newSlot, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  captureLegs,
  insertTrip,
  recordAsSettlementWorker,
  recordOfVector,
  tj,
} from '../support/settlement.ts';
import { DRILL_DATABASE, DRILL_META_DATABASE } from './global-setup.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const RUNBOOK = 'docs/ops/BACKUP_RESTORE.md';
const BASELINE = join(ROOT, 'docs/ops/restore-drill-baseline.json');

/** Cibles de 17 §6.4 (À DÉCIDER, ADM-035), en secondes. */
export const TARGETS = { rpoRequiredS: 24 * 3600, rpoTargetS: 3600, rtoS: 8 * 3600 } as const;

/**
 * Porte de RÉGRESSION par rapport à la mesure de référence (critère 4 ; revue code US-051 n° 2 ;
 * ADR-082 point 5) : échec si une mesure dépasse `factor` fois la référence plus `marginS`
 * secondes. Le facteur absorbe la variance des runners de la CI (× 2 à 3 observés), la marge le
 * bruit absolu d'une durée de quelques secondes (démarrage de conteneur, `archive_timeout` de
 * 30 s pour le RPO) ; une régression d'un ordre de grandeur échoue. Les cibles absolues restent.
 */
export const REGRESSION = { factor: 10, marginS: 60 } as const;
const limitOf = (baseline: number): number => REGRESSION.factor * baseline + REGRESSION.marginS;

/**
 * Vecteurs dorés (comme l0-stl-settlement) : règlement et état capturé ; la paire d'un pays est
 * celle dont la devise du vecteur capturé est la sienne (lue dans les vecteurs, jamais codée ici).
 */
const REFS = [
  { vector: 'T03', capture: 'TJ01' },
  { vector: 'T27', capture: 'TJ08a' },
] as const;

const work = (): string => {
  const w = process.env['RUEDA_DRILL_WORK'];
  if (w === undefined || w === '') throw new Error('RUEDA_DRILL_WORK absente');
  return w;
};
const envOf = (name: string): string => {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} absente`);
  return v;
};

const PORT_A = Number(process.env['RUEDA_DRILL_RESTORE_PORT_A'] ?? '55433');
const PORT_B = Number(process.env['RUEDA_DRILL_RESTORE_PORT_B'] ?? '55434');

/** Exécute une étape du runbook TELLE QU'ÉCRITE ; rend sa durée (s). */
function runbook(step: string, extra: Readonly<Record<string, string>> = {}): number {
  const started = performance.now();
  const r = spawnSync(process.execPath, ['scripts/ops/runbook.mjs', RUNBOOK, step], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PGDATABASE: DRILL_DATABASE,
      RUEDA_BACKUP_LABEL: 'quotidienne',
      RUEDA_SECRETS_DIR: join(work(), 'secrets'),
      RUEDA_SERVE_DIR: join(work(), 'serve'),
      ...extra,
    },
  });
  if (r.status !== 0) throw new Error(`runbook ${step} : code ${String(r.status)}`);
  return (performance.now() - started) / 1000;
}

function stopServing(): void {
  spawnSync('bash', ['scripts/ops/serve-local.sh', 'stop'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUEDA_SECRETS_DIR: join(work(), 'secrets'),
      RUEDA_SERVE_DIR: join(work(), 'serve'),
    },
  });
}

/** Connexion à une instance (source ou restaurée) ; rôles applicatifs : assertion L0-05. */
async function open(
  port: number,
  user: 'postgres' | 'app_api' | 'app_worker',
  database = DRILL_DATABASE,
): Promise<pg.Client> {
  const info = benchInfo();
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    database,
    user,
    password: user === 'postgres' ? info.admin.password : info.passwords[user],
    application_name: 'rueda-restore-drill',
  });
  await client.connect();
  if (user !== 'postgres') await assertProductionRole(client, user);
  return client;
}

interface Written {
  readonly trips: string[];
  readonly settlements: string[];
  readonly auditRequests: string[];
}

/** Données fictives d'une vague, PA et PY, sous les rôles de production (validées). */
async function populate(wave: number, perCountry: number): Promise<Written> {
  const written: Written = { trips: [], settlements: [], auditRequests: [] };
  const api = await connectAs('app_api');
  const worker = await connectAs('app_worker');
  const keys = new SubjectKeyStore(new FakeKeyWrapper());
  try {
    for (const [ci, c] of COUNTRIES.entries()) {
      for (let i = 0; i < perCountry; i += 1) {
        const n = wave * 100 + ci * 10 + i;
        const t0 = new Date(Date.UTC(2071, 0, 1) + n * 86_400_000).toISOString();
        const { tripId } = await bookTrip(
          api,
          worker,
          newSlot(at(t0, 2 * 24 * 60), at(t0, 3 * 24 * 60)),
          c,
          t0,
        );
        written.trips.push(tripId);
        written.settlements.push(await settle(worker, c, n));
        const requestId = uuid();
        await auditTx(api, { actor: { kind: 'GUEST' }, commit: true }, async (tx) => {
          await appendAuditLog(tx, keys, {
            actorUserId: uuid(),
            actorRole: 'GUEST',
            actionCode: 'TEST_ACTION',
            subjectType: 'TRIP',
            subjectId: tripId,
            requestId,
          });
        });
        written.auditRequests.push(requestId);
      }
    }
  } finally {
    await releaseClient(api);
    await releaseClient(worker);
  }
  return written;
}

/** Règlement de référence persisté sur un trip de fixture (jambes = vecteurs dorés). */
async function settle(worker: pg.Client, c: CountryCase, slot: number): Promise<string> {
  const ref = REFS.find((r) => tj(r.capture).currency === c.currency);
  if (ref === undefined) throw new Error(`pas de vecteur pour ${c.currency}`);
  return withTestTransaction(worker, { commit: true }, async (tx) => {
    const trip = await insertTrip(tx, c, slot);
    await captureLegs(tx, trip.id, tj(ref.capture).legsMinor);
    return recordAsSettlementWorker(
      tx,
      { tripId: trip.id, version: 1 },
      recordOfVector(ref.vector),
    );
  });
}

/** Lignes d'une vague présentes dans une instance (sous l'administration, lecture seule). */
async function presentOf(admin: pg.Client, w: Written): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `SELECT ((SELECT count(*) FROM core.booking_trip WHERE id = ANY($1::uuid[]))
           + (SELECT count(*) FROM core.settlement_settlement WHERE id = ANY($2::uuid[]))
           + (SELECT count(*) FROM core.audit_audit_log WHERE request_id = ANY($3::uuid[])))::text AS n`,
    [w.trips, w.settlements, w.auditRequests],
  );
  return Number(rows[0]?.n ?? '0');
}
const sizeOf = (w: Written): number =>
  w.trips.length + w.settlements.length + w.auditRequests.length;

/** Battement de cœur : une ligne par 200 ms (horloge du serveur) jusqu'à l'arrêt ou la perte. */
class Heartbeat {
  #running = true;
  #done: Promise<void> = Promise.resolve();

  start(client: pg.Client): void {
    this.#done = (async () => {
      while (this.#running) {
        try {
          // horloge de l'hôte = horloge des conteneurs (même noyau) : celle des validations
          await client.query('INSERT INTO heartbeat (at) VALUES ($1)', [new Date()]);
        } catch {
          return; // instance perdue : fin du battement
        }
        await sleep(200);
      }
    })();
  }

  async stop(): Promise<void> {
    this.#running = false;
    await this.#done;
  }
}

async function lastHeartbeat(port: number): Promise<Date> {
  const meta = await open(port, 'postgres', DRILL_META_DATABASE);
  try {
    const { rows } = await meta.query<{ at: Date }>('SELECT max(at) AS at FROM heartbeat');
    const v = rows[0]?.at;
    if (!(v instanceof Date)) throw new Error('battement de cœur absent');
    return v;
  } finally {
    await meta.end();
  }
}

interface Scenario {
  restoreS: number;
  verifyS: number;
  switchS: number;
  rtoS: number;
  rpoS: number;
}

const state: {
  w1?: Written;
  w2?: Written;
  t?: string;
  fingerprint?: DataFingerprint;
  catalog?: string;
  backupS?: number;
  instant?: Scenario;
  latest?: Scenario;
  rowsAtT?: number;
} = {};
const heartbeat = new Heartbeat();
let metaWriter: pg.Client | undefined;

beforeAll(async () => {
  metaWriter = await open(benchInfo().port, 'postgres', DRILL_META_DATABASE);
  // la perte de l'instance (scénario B) coupe cette connexion : attendu, pas une erreur
  metaWriter.on('error', () => undefined);
  heartbeat.start(metaWriter);
});

afterAll(async () => {
  stopServing();
  await heartbeat.stop();
  await metaWriter?.end().catch(() => undefined);
});

/** Restauration puis vérification (runbook) ; chronométrées. */
function restoreAndVerify(
  container: string,
  port: number,
  target: string,
): { restoreS: number; verifyS: number } {
  const restoreS = runbook('exercice-restauration', {
    RUEDA_RESTORE_CONTAINER: container,
    RUEDA_RESTORE_PORT: String(port),
    RUEDA_RESTORE_TARGET_TIME: target,
  });
  const verifyS = runbook('exercice-verification', {
    RUEDA_RESTORE_PORT: String(port),
    RUEDA_RESTORE_REPORT: join(work(), `verification-${container}.json`),
  });
  return { restoreS, verifyS };
}

/**
 * Bascule de l'application (runbook) ; chronométrée. Appelée APRÈS les comparaisons de
 * l'exercice : le travailleur démarré écrit ensuite dans la base (notifications, relais), ce qui
 * est le fonctionnement attendu, pas une différence de restauration. RTO = restauration +
 * vérification + bascule (les comparaisons propres à l'exercice n'en font pas partie).
 */
function switchTo(port: number, rv: { restoreS: number; verifyS: number }): Scenario {
  const switchS = runbook('exercice-bascule', { RUEDA_RESTORE_PORT: String(port) });
  return { ...rv, switchS, rtoS: rv.restoreS + rv.verifyS + switchS, rpoS: Number.NaN };
}

function verificationReport(container: string): {
  ok: boolean;
  checks: { name: string; ok: boolean }[];
} {
  return JSON.parse(readFileSync(join(work(), `verification-${container}.json`), 'utf8')) as {
    ok: boolean;
    checks: { name: string; ok: boolean }[];
  };
}

describe('US-051 — exercice de restauration chronométré', () => {
  it('1. préproduction peuplée (deux pays), puis sauvegarde de base par le runbook', async () => {
    const w0 = await populate(0, 3);
    expect(sizeOf(w0)).toBe(COUNTRIES.length * 3 * 3);
    state.backupS = runbook('exercice-sauvegarde', {});
    // écritures APRÈS la sauvegarde : seule la relecture des journaux archivés les rend
    state.w1 = await populate(1, 2);
    const admin = await open(benchInfo().port, 'postgres');
    try {
      expect(await presentOf(admin, state.w1)).toBe(sizeOf(state.w1));
    } finally {
      await admin.end();
    }
  });

  it('2. instant T fixé, écritures après T, journaux archivés', async () => {
    const admin = await open(benchInfo().port, 'postgres');
    try {
      state.fingerprint = await dataFingerprint(admin);
      state.catalog = await catalogFingerprint(admin);
      state.rowsAtT = Object.values(state.fingerprint.rows).reduce((s, n) => s + n, 0);
      // instant T : après la dernière validation de la vague 1, avant la vague 2 (horloge de
      // l'hôte, celle des conteneurs ; comparée par la récupération aux instants de validation)
      await sleep(200);
      // forme acceptée par recovery_target_time (« AAAA-MM-JJ HH:MM:SS.mmm+00 », sans T ni Z)
      state.t = new Date().toISOString().replace('T', ' ').replace('Z', '+00');
      await sleep(1_100);
      state.w2 = await populate(2, 1);
      // fin de segment : les écritures d'après T sont archivées (un incident découvert plus tard)
      const seg = await admin.query<{ seg: string }>(
        'SELECT pg_catalog.pg_walfile_name(pg_catalog.pg_switch_wal()) AS seg',
      );
      const segment = seg.rows[0]?.seg ?? '';
      for (let i = 0; ; i += 1) {
        const a = await admin.query<{ last: string | null }>(
          'SELECT last_archived_wal AS last FROM pg_catalog.pg_stat_archiver',
        );
        if ((a.rows[0]?.last ?? '') >= segment) break;
        if (i > 120) throw new Error(`segment ${segment} non archivé après 60 s`);
        await sleep(500);
      }
    } finally {
      await admin.end();
    }
  });

  it('3. restauration à l’instant T : données de T, rien après T, intégrité, rôles et RLS intacts ; l’application redémarre', async () => {
    const container = `${envOf('RUEDA_DRILL_PREFIX')}-restore-a`;
    const rv = restoreAndVerify(container, PORT_A, state.t ?? '');
    const report = verificationReport(container);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'roles',
        'rls',
        'migrations',
        'money',
        'occupancy',
        'l0-05',
        'environment',
        'audit_chain',
        'c12',
      ]),
    );
    const admin = await open(PORT_A, 'postgres');
    const api = await open(PORT_A, 'app_api'); // L0-05 sur l'instance restaurée
    try {
      expect(await dataFingerprint(admin)).toEqual(state.fingerprint);
      expect(await catalogFingerprint(admin)).toBe(state.catalog);
      expect(await presentOf(admin, state.w1 as Written)).toBe(sizeOf(state.w1 as Written));
      // aucune écriture postérieure à T (trips, règlements, lignes d'audit de la vague 2)
      expect(await presentOf(admin, state.w2 as Written)).toBe(0);
    } finally {
      await admin.end();
      await api.end();
    }
    const beat = await lastHeartbeat(PORT_A);
    const t = Date.parse((state.t ?? '').replace(' ', 'T').replace('+00', 'Z'));
    expect(beat.getTime()).toBeLessThanOrEqual(t);
    // l'application redémarre sur la base restaurée
    state.instant = switchTo(PORT_A, rv);
    state.instant.rpoS = (t - beat.getTime()) / 1000;
    stopServing();
  });

  it('4. perte de l’instance : restauration au plus récent, RPO mesuré, intégrité, redémarrage', async () => {
    const w3 = await populate(3, 1);
    await sleep(3_000);
    const lost = Date.now();
    const kill = spawnSync('docker', ['kill', envOf('RUEDA_PG_CONTAINER')], { stdio: 'inherit' });
    expect(kill.status).toBe(0);
    await heartbeat.stop();
    const container = `${envOf('RUEDA_DRILL_PREFIX')}-restore-b`;
    const rv = restoreAndVerify(container, PORT_B, '');
    expect(verificationReport(container).checks.filter((c) => !c.ok)).toEqual([]);
    const admin = await open(PORT_B, 'postgres');
    try {
      // tout ce qui a été archivé est rendu (écritures d'après T comprises)
      expect(await presentOf(admin, state.w2 as Written)).toBe(sizeOf(state.w2 as Written));
      console.log(
        `[exercice] dernière vague (non archivée à la perte) : ${await presentOf(admin, w3)} / ${sizeOf(w3)} lignes rendues`,
      );
    } finally {
      await admin.end();
    }
    const rpoS = (lost - (await lastHeartbeat(PORT_B)).getTime()) / 1000;
    state.latest = switchTo(PORT_B, rv);
    state.latest.rpoS = rpoS;
    stopServing();
  });

  it('5. rapport : RTO et RPO mesurés, comparés aux cibles de 17 §6.4 et à la référence', async () => {
    const instant = state.instant as Scenario;
    const latest = state.latest as Scenario;
    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { rtoS?: number; rpoS?: number })
      : {};
    const rto = Math.max(instant.rtoS, latest.rtoS);
    const report = {
      story: 'US-051',
      measuredAt: new Date().toISOString(),
      commit: process.env['GITHUB_SHA'] ?? null,
      rowsAtT: state.rowsAtT,
      backupS: round(state.backupS ?? Number.NaN),
      instant: roundAll(instant),
      latest: roundAll(latest),
      rtoS: round(rto),
      rpoS: round(latest.rpoS),
      targets: TARGETS,
      regression: REGRESSION,
      baseline,
      vsBaseline: {
        rto: baseline.rtoS ? round(rto / baseline.rtoS) : null,
        rpo: baseline.rpoS ? round(latest.rpoS / baseline.rpoS) : null,
      },
    };
    writeFileSync(join(work(), 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[exercice] rapport : ${JSON.stringify(report)}`);
    await withProductionRoleAssertion();
    expect(latest.rpoS).toBeGreaterThanOrEqual(0);
    expect(latest.rpoS).toBeLessThanOrEqual(TARGETS.rpoTargetS);
    expect(rto).toBeLessThanOrEqual(TARGETS.rtoS);
    // régression par rapport à la référence (si elle existe)
    if (typeof baseline.rtoS === 'number') expect(rto).toBeLessThanOrEqual(limitOf(baseline.rtoS));
    if (typeof baseline.rpoS === 'number') {
      expect(latest.rpoS).toBeLessThanOrEqual(limitOf(baseline.rpoS));
    }
  });
});

const round = (n: number): number => Math.round(n * 100) / 100;
const roundAll = (s: Scenario): Scenario => ({
  restoreS: round(s.restoreS),
  verifyS: round(s.verifyS),
  switchS: round(s.switchS),
  rtoS: round(s.rtoS),
  rpoS: round(s.rpoS),
});

/** Le rapport ne lit aucune base : l'assertion L0-05 du test porte sur l'instance restaurée B. */
async function withProductionRoleAssertion(): Promise<void> {
  const api = await open(PORT_B, 'app_api');
  await api.end();
}
