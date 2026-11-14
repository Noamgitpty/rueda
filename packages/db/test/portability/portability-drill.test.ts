/**
 * US-036 — EXERCICE DE PORTABILITÉ : changer d'hébergeur sans rien perdre (19 US-036 critère 2 ;
 * 17 §6.1, §6.4 ; ADR-120 ; pré-mortem L1-PM-34). Lancé par scripts/ops/portability-drill.sh
 * (fin du job CI « reprise »), sur deux instances PostgreSQL 16 en conteneur : l'ancien hébergeur
 * (source, préproduction peuplée) et le nouveau (cible, vide, ses propres secrets).
 *
 * Les étapes (export de la base, des clés via le séquestre, des fichiers ; import ; vérification)
 * ne sont PAS écrites ici : elles sont lues et exécutées telles quelles dans
 * docs/ops/PORTABILITY.md (blocs « bash portabilite-<étape> », scripts/ops/runbook.mjs). Ce fichier
 * crée les données, puis compare ce que la cible rend à ce que la source avait.
 *
 * Attendus (oracles : les octets et les identifiants écrits par le test, node:crypto ; jamais le
 * code testé) :
 *   1. base : mêmes lignes par table, mêmes sommes d'argent par devise, même tête de la chaîne
 *      d'audit, même catalogue de sécurité (rôles, politiques, RLS, droits), mêmes lignes PAR PAYS ;
 *      contrôles de la vérification de restauration verts (L0-05, RLS, C12, argent, audit) ;
 *   2. pays : sous app_api, un ADMIN du PA ne voit que les trips du PA, celui du PY que ceux du PY,
 *      et aucun ne voit l'autre pays (aucune fuite d'un pays vers l'autre après l'aller-retour) ;
 *   3. clés et fichiers : sous app_worker / evidence_verifier, chaque fichier de la cible se relit
 *      et son SHA-256 égale celui des octets envoyés, avec la clé maîtresse de la CIBLE ; la clé de
 *      la source n'ouvre plus rien ; une clé détruite reste détruite ;
 *   4. séquestre (L1-PM-34) : ni l'export ni la sortie des étapes ne contiennent une DEK en clair,
 *      une clé maîtresse, la clé privée du séquestre ou un mot de passe.
 * Données écrites sous les rôles de PRODUCTION (assertion L0-05 à chaque connexion).
 */
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  appendAuditLog,
  receiveFile,
  SubjectKeyStore,
  verifyFileAsset,
} from '../../src/audit/index.ts';
import type { Bucket, Classification, SubjectRef } from '../../src/audit/index.ts';
import { FsFileStore } from '../../src/portability/fs-file-store.ts';
import { LocalKeyWrapper } from '../../src/portability/local-key-wrapper.ts';
import { catalogFingerprint, dataFingerprint } from '../../src/restore/verify.ts';
import type { DataFingerprint } from '../../src/restore/verify.ts';
import { LOGIN_ROLES } from '../../src/roles.ts';
import { randomPassword } from '../../src/scram.ts';
import {
  assertProductionRole,
  benchInfo,
  connectAs,
  releaseClient,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { auditTx } from '../support/audit.ts';
import type { ActorContext } from '../support/audit.ts';
import { at, bookTrip, COUNTRIES, newSlot } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { asActor, ids, staff } from '../support/rls.ts';
import {
  captureLegs,
  insertTrip,
  recordAsSettlementWorker,
  recordOfVector,
  tj,
} from '../support/settlement.ts';
import { DRILL_DATABASE } from '../drill/global-setup.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const RUNBOOK = 'docs/ops/PORTABILITY.md';
const TARGET_PORT = Number(process.env['RUEDA_PORTABILITY_TARGET_PORT'] ?? '55442');
const ENVIRONMENT = 'preproduction';
const VERIFIER: ActorContext = { kind: 'WORKER', worker: 'evidence_verifier' };
const T0 = '2071-06-01T12:00:00.000Z';
const REFS = [
  { vector: 'T03', capture: 'TJ01' },
  { vector: 'T27', capture: 'TJ08a' },
] as const;

const work = (): string => {
  const w = process.env['RUEDA_DRILL_WORK'];
  if (w === undefined || w === '') throw new Error('RUEDA_DRILL_WORK absente');
  return w;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const paths = () => ({
  sourceMaster: join(work(), 'secrets', 'master-source'),
  targetMaster: join(work(), 'secrets', 'target', 'master'),
  escrowPublic: join(work(), 'escrow-public.pem'),
  escrowPrivate: join(work(), 'secrets', 'escrow-private.pem'),
  sourceStore: join(work(), 'store-source'),
  targetStore: join(work(), 'store-target'),
  exportDir: join(work(), 'export'),
  report: join(work(), 'verification-portabilite.json'),
});

interface Upload {
  readonly id: string;
  readonly bucket: Bucket;
  readonly key: string;
  readonly body: Buffer;
  readonly classification: Classification;
  readonly subject?: SubjectRef;
  readonly destroyed?: boolean;
}

const state: {
  sourceKeys?: SubjectKeyStore;
  targetPasswords?: Record<string, string>;
  secrets: string[];
  uploads: Upload[];
  trips: Map<string, string[]>;
  admins: Map<string, string>;
  fingerprint?: DataFingerprint;
  catalog?: string;
  perCountry?: Record<string, number>;
  outputs: string[];
} = { secrets: [], uploads: [], trips: new Map(), admins: new Map(), outputs: [] };

/** Connexion à la cible ; rôles applicatifs : assertion L0-05. */
async function openTarget(user: 'postgres' | 'app_api' | 'app_worker'): Promise<pg.Client> {
  const password =
    user === 'postgres'
      ? readFileSync(join(work(), 'secrets', 'target', 'postgres'), 'utf8').trim()
      : (state.targetPasswords?.[user] ?? '');
  const client = new pg.Client({
    host: '127.0.0.1',
    port: TARGET_PORT,
    database: DRILL_DATABASE,
    user,
    password,
    application_name: 'rueda-portability-drill',
  });
  await client.connect();
  if (user !== 'postgres') await assertProductionRole(client, user);
  return client;
}

async function openSourceAdmin(): Promise<pg.Client> {
  const info = benchInfo();
  const client = new pg.Client({
    host: '127.0.0.1',
    port: info.port,
    database: DRILL_DATABASE,
    user: 'postgres',
    password: info.admin.password,
  });
  await client.connect();
  return client;
}

/** Exécute une étape du runbook TELLE QU'ÉCRITE ; garde sa sortie pour le contrôle des secrets. */
function runbook(step: string, env: Readonly<Record<string, string>>): void {
  const r = spawnSync(process.execPath, ['scripts/ops/runbook.mjs', RUNBOOK, step], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGDATABASE: DRILL_DATABASE, RUEDA_ENV: ENVIRONMENT, ...env },
  });
  const output = `${r.stdout}${r.stderr}`;
  state.outputs.push(output);
  const leaked = state.secrets.some((s) => output.includes(s));
  // la sortie n'est affichée que si elle ne contient aucun secret
  console.log(leaked ? `[portabilite] sortie de ${step} retenue (secret)` : output);
  if (r.status !== 0) throw new Error(`runbook ${step} : code ${String(r.status)}`);
}

/** Lignes par pays de chaque table qui a une colonne de pays (lecture seule, administration). */
async function perCountry(admin: pg.Client): Promise<Record<string, number>> {
  const cols = await admin.query<{ rel: string; col: string }>(
    `SELECT pg_catalog.quote_ident(table_schema) || '.' || pg_catalog.quote_ident(table_name) AS rel,
            pg_catalog.quote_ident(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema IN ('core', 'platform', 'app')
        AND column_name IN ('country', 'country_code')
        AND (table_schema, table_name) IN
            (SELECT table_schema, table_name FROM information_schema.tables
              WHERE table_type = 'BASE TABLE')
      ORDER BY 1, 2`,
  );
  const out: Record<string, number> = {};
  for (const { rel, col } of cols.rows) {
    // identifiants issus du catalogue, cités par quote_ident : aucune donnée externe
    const r = await admin.query<{ c: string | null; n: string }>(
      `SELECT ${col}::text AS c, count(*)::text AS n FROM ${rel} GROUP BY 1 ORDER BY 1`,
    );
    for (const row of r.rows) out[`${rel}.${row.c ?? 'NULL'}`] = Number(row.n);
  }
  return out;
}

async function settle(worker: pg.Client, c: CountryCase, slot: number): Promise<void> {
  const ref = REFS.find((r) => tj(r.capture).currency === c.currency);
  if (ref === undefined) throw new Error(`pas de vecteur pour ${c.currency}`);
  await withTestTransaction(worker, { commit: true }, async (tx) => {
    const trip = await insertTrip(tx, c, slot);
    await captureLegs(tx, trip.id, tj(ref.capture).legsMinor);
    await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, recordOfVector(ref.vector));
  });
}

async function upload(api: pg.Client, keys: SubjectKeyStore, store: FsFileStore, u: Upload) {
  // l'envoyeur est le sujet (clé USER de la session, US-011) ou un compte quelconque (C0)
  const uploader = u.subject?.id ?? randomUUID();
  const actor: ActorContext = {
    kind: u.subject !== undefined ? 'GUEST' : 'HOST',
    actorId: uploader,
  };
  await auditTx(api, { actor, virtualNow: T0, commit: true }, async (tx) => {
    await receiveFile(
      tx,
      store,
      keys,
      {
        id: u.id,
        bucket: u.bucket,
        storageKey: u.key,
        mime: 'image/jpeg',
        uploaderUserId: uploader,
        source: 'IN_APP_CAMERA',
        classification: u.classification,
        retentionClass: u.classification === 'C0' ? 'LISTING_PHOTO' : 'CLAIM_EVIDENCE',
        ...(u.subject !== undefined ? { encryptFor: u.subject } : {}),
      },
      [u.body],
    );
  });
}

beforeAll(() => {
  const p = paths();
  const sourceMaster = randomBytes(32);
  const targetMaster = randomBytes(32);
  writeFileSync(p.sourceMaster, sourceMaster.toString('hex'), { mode: 0o600 });
  writeFileSync(p.targetMaster, targetMaster.toString('hex'), { mode: 0o600 });
  const escrow = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(p.escrowPublic, escrow.publicKey, { mode: 0o644 });
  writeFileSync(p.escrowPrivate, escrow.privateKey, { mode: 0o600 });
  // nouvel hébergeur = nouveaux secrets des rôles de connexion
  const passwords = Object.fromEntries(LOGIN_ROLES.map((r) => [r, randomPassword()]));
  for (const [role, value] of Object.entries(passwords)) {
    writeFileSync(join(work(), 'secrets', 'target', role), value, { mode: 0o600 });
  }
  state.targetPasswords = passwords;
  const info = benchInfo();
  const privateBody = escrow.privateKey
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('-----'));
  state.secrets = [
    sourceMaster.toString('hex'),
    targetMaster.toString('hex'),
    ...privateBody,
    info.admin.password,
    readFileSync(join(work(), 'secrets', 'target', 'postgres'), 'utf8').trim(),
    ...Object.values(info.passwords),
    ...Object.values(passwords),
  ];
  state.sourceKeys = new SubjectKeyStore(
    new LocalKeyWrapper(sourceMaster, { RUEDA_ENV: ENVIRONMENT }),
  );
});

describe('US-036 — exercice de portabilité (changement d’hébergeur)', () => {
  it('1. ancien hébergeur peuplé (deux pays) sous les rôles de production', async () => {
    const api = await connectAs('app_api');
    const worker = await connectAs('app_worker');
    const keys = state.sourceKeys as SubjectKeyStore;
    const store = new FsFileStore(paths().sourceStore);
    try {
      for (const [ci, c] of COUNTRIES.entries()) {
        const trips: string[] = [];
        for (let i = 0; i < 2; i += 1) {
          const n = ci * 10 + i;
          const t0 = new Date(Date.UTC(2072, 0, 1) + n * 86_400_000).toISOString();
          const booked = await bookTrip(
            api,
            worker,
            newSlot(at(t0, 2 * 24 * 60), at(t0, 3 * 24 * 60)),
            c,
            t0,
          );
          trips.push(booked.tripId);
          await settle(worker, c, n + 50);
          const guest: SubjectRef = { type: 'USER', id: booked.hold.guestId };
          const evidence: Upload = {
            id: randomUUID(),
            bucket: 'PRIVATE_EVIDENCE',
            key: `claims/${c.country}/${randomUUID()}.jpg`,
            body: Buffer.concat([Buffer.from(`EXIF-${c.country}:`), randomBytes(3000)]),
            classification: 'C3',
            subject: guest,
          };
          const photo: Upload = {
            id: randomUUID(),
            bucket: 'PUBLIC_LISTING',
            key: `listings/${c.country}/${randomUUID()}.jpg`,
            body: randomBytes(2000),
            classification: 'C0',
          };
          for (const u of [evidence, photo]) {
            await upload(api, keys, store, u);
            state.uploads.push(u);
          }
          await auditTx(api, { actor: { kind: 'GUEST' }, commit: true }, async (tx) => {
            await appendAuditLog(tx, keys, {
              actorUserId: guest.id,
              actorRole: 'GUEST',
              actionCode: 'TEST_ACTION',
              subjectType: 'TRIP',
              subjectId: booked.tripId,
              requestId: randomUUID(),
            });
          });
        }
        state.trips.set(c.country, trips);
      }
      // un ADMIN par pays, borné à son pays (contrôle d'isolement après l'aller-retour)
      await withTestTransaction(api, { commit: true }, async (tx) => {
        for (const c of COUNTRIES)
          state.admins.set(c.country, await staff(tx, 'ADMIN', [c.country]));
      });
      // une clé de sujet DÉTRUITE (crypto-shredding) : elle doit le rester sur la cible
      const shredded: Upload = {
        id: randomUUID(),
        bucket: 'PRIVATE_EVIDENCE',
        key: `claims/shredded/${randomUUID()}.jpg`,
        body: randomBytes(1500),
        classification: 'C3',
        subject: { type: 'USER', id: randomUUID() },
        destroyed: true,
      };
      await upload(api, keys, store, shredded);
      state.uploads.push(shredded);
      await auditTx(worker, { actor: VERIFIER, commit: true }, async (tx) => {
        await tx.query(`SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'effacement')`, [
          shredded.subject?.id,
          randomUUID(),
        ]);
      });
    } finally {
      await releaseClient(api);
      await releaseClient(worker);
    }
    const admin = await openSourceAdmin();
    try {
      state.fingerprint = await dataFingerprint(admin);
      state.catalog = await catalogFingerprint(admin);
      state.perCountry = await perCountry(admin);
      // DEK en clair de chaque sujet (oracle du contrôle de fuite), lues à la source
      const wrapper = new LocalKeyWrapper(
        Buffer.from(readFileSync(paths().sourceMaster, 'utf8'), 'hex'),
        { RUEDA_ENV: ENVIRONMENT },
      );
      const { rows } = await admin.query<{
        subject_type: SubjectRef['type'];
        subject_id: string;
        wrapped_dek: Buffer | null;
        kms_key_id: string;
      }>(
        `SELECT subject_type, subject_id::text AS subject_id, wrapped_dek, kms_key_id
           FROM core.audit_subject_key`,
      );
      expect(rows.filter((r) => r.wrapped_dek === null)).toHaveLength(1);
      for (const r of rows) {
        if (r.wrapped_dek === null) continue;
        const dek = await wrapper.unwrap(r.wrapped_dek, r.kms_key_id, {
          type: r.subject_type,
          id: r.subject_id,
        });
        state.secrets.push(dek.toString('hex'), dek.toString('base64'));
      }
    } finally {
      await admin.end();
    }
    for (const c of COUNTRIES) {
      expect(Object.keys(state.perCountry).some((k) => k.endsWith(`.${c.country}`))).toBe(true);
    }
  });

  it('2. export (base, clés par le séquestre, fichiers) puis import sur le nouvel hébergeur, par le runbook', async () => {
    const p = paths();
    runbook('portabilite-export', {
      PGHOST: '127.0.0.1',
      PGPORT: String(benchInfo().port),
      RUEDA_DB_ADMIN_USER: 'postgres',
      RUEDA_SECRETS_DIR: join(work(), 'secrets'),
      RUEDA_EXPORT_DIR: p.exportDir,
      RUEDA_ESCROW_PUBLIC_KEY_FILE: p.escrowPublic,
      RUEDA_KEY_WRAPPER: 'local',
      RUEDA_LOCAL_MASTER_KEY_FILE: p.sourceMaster,
      RUEDA_FILE_STORE: 'fs',
      RUEDA_FILE_STORE_DIR: p.sourceStore,
    });
    const target = {
      PGHOST: '127.0.0.1',
      PGPORT: String(TARGET_PORT),
      RUEDA_DB_ADMIN_USER: 'postgres',
      RUEDA_SECRETS_DIR: join(work(), 'secrets', 'target'),
      RUEDA_EXPORT_DIR: p.exportDir,
    };
    runbook('portabilite-import', {
      ...target,
      RUEDA_ESCROW_PRIVATE_KEY_FILE: p.escrowPrivate,
      RUEDA_KEY_WRAPPER: 'local',
      RUEDA_LOCAL_MASTER_KEY_FILE: p.targetMaster,
      RUEDA_FILE_STORE: 'fs',
      RUEDA_FILE_STORE_DIR: p.targetStore,
    });
    runbook('portabilite-verification', { ...target, RUEDA_RESTORE_REPORT: p.report });
    const report = JSON.parse(readFileSync(p.report, 'utf8')) as {
      ok: boolean;
      checks: { name: string; ok: boolean }[];
    };
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'roles',
        'rls',
        'migrations',
        'money',
        'l0-05',
        'audit_chain',
        'c12',
      ]),
    );
    expect(report.ok).toBe(true);
    const api = await openTarget('app_api'); // L0-05 sur la cible restaurée
    await api.end();
  });

  it('3. base identique : lignes, argent par devise, chaîne d’audit, catalogue de sécurité, lignes par pays', async () => {
    const admin = await openTarget('postgres');
    const api = await openTarget('app_api'); // L0-05 sur la cible
    try {
      expect(await dataFingerprint(admin)).toEqual(state.fingerprint);
      expect(await catalogFingerprint(admin)).toBe(state.catalog);
      expect(await perCountry(admin)).toEqual(state.perCountry);
      // chaque clé vivante est enveloppée par la clé maîtresse de la CIBLE, aucune par la source
      const target = LocalKeyWrapper.fromFile(paths().targetMaster, { RUEDA_ENV: ENVIRONMENT });
      const source = LocalKeyWrapper.fromFile(paths().sourceMaster, { RUEDA_ENV: ENVIRONMENT });
      const { rows } = await admin.query<{ k: string; live: boolean; n: string }>(
        `SELECT kms_key_id AS k, destroyed_at IS NULL AS live, count(*)::text AS n
           FROM core.audit_subject_key GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      const live = rows.filter((r) => r.live);
      expect(live.map((r) => r.k)).toEqual([target.keyId]);
      expect(rows.some((r) => r.k === source.keyId && r.live)).toBe(false);
    } finally {
      await admin.end();
      await api.end();
    }
  });

  it('4. aucune fuite d’un pays vers l’autre : sous app_api, chaque ADMIN ne voit que son pays', async () => {
    const admin = await openTarget('postgres');
    const api = await openTarget('app_api');
    try {
      // oracle : le pays de chaque trip de la cible, lu par l'administration (lecture seule)
      const all = await admin.query<{ id: string; country_code: string }>(
        'SELECT id::text AS id, country_code FROM core.booking_trip ORDER BY id',
      );
      for (const c of COUNTRIES) {
        const adminId = state.admins.get(c.country) as string;
        const expected = all.rows.filter((r) => r.country_code === c.country).map((r) => r.id);
        for (const id of state.trips.get(c.country) ?? []) expect(expected).toContain(id);
        const seen = await asActor(
          api,
          { kind: 'STAFF', actorId: adminId, countryScope: [c.country] },
          (tx) => ids(tx, 'booking_trip'),
        );
        expect([...seen].sort()).toEqual([...expected].sort());
        for (const other of COUNTRIES.filter((o) => o.country !== c.country)) {
          // une portée sur l'autre pays, sans rôle là-bas : rien
          const cross = await asActor(
            api,
            { kind: 'STAFF', actorId: adminId, countryScope: [other.country] },
            (tx) => ids(tx, 'booking_trip'),
          );
          expect(cross).toEqual([]);
        }
      }
    } finally {
      await admin.end();
      await api.end();
    }
  });

  it('5. fichiers et clés : relus sous evidence_verifier avec la clé de la cible ; la clé source n’ouvre rien ; la clé détruite le reste', async () => {
    const worker = await openTarget('app_worker');
    const store = new FsFileStore(paths().targetStore);
    const targetKeys = new SubjectKeyStore(
      LocalKeyWrapper.fromFile(paths().targetMaster, { RUEDA_ENV: ENVIRONMENT }),
    );
    const sourceKeys = new SubjectKeyStore(
      LocalKeyWrapper.fromFile(paths().sourceMaster, { RUEDA_ENV: ENVIRONMENT }),
    );
    try {
      await auditTx(worker, { actor: VERIFIER }, async (tx) => {
        for (const u of state.uploads) {
          const verdict = await verifyFileAsset(tx, store, targetKeys, u.id);
          if (u.destroyed === true) {
            expect(verdict).toEqual({ status: 'UNREADABLE', reason: 'KEY_DESTROYED' });
            continue;
          }
          expect(verdict.status, u.key).toBe('MATCH');
          if (verdict.status === 'MATCH') expect(verdict.sha256.toString('hex')).toBe(sha(u.body));
          if (u.subject !== undefined) {
            expect(await verifyFileAsset(tx, store, sourceKeys, u.id)).toMatchObject({
              status: 'UNREADABLE',
            });
          }
        }
      });
    } finally {
      await worker.end();
    }
  });

  it('6. séquestre (L1-PM-34) : ni l’export ni la sortie des étapes ne contiennent un secret ou une DEK en clair', async () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(paths().exportDir);
    const names = files.map((f) => f.slice(paths().exportDir.length + 1).replace(/\\/g, '/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'base.dump',
        'base.dump.sha256',
        'subject-keys.escrow.jsonl',
        'files-manifest.json',
      ]),
    );
    expect(names.some((n) => /master|private|secret/i.test(n))).toBe(false);
    for (const f of files) {
      const text = readFileSync(f).toString('latin1');
      for (const s of state.secrets) expect(text.includes(s), f).toBe(false);
      expect(statSync(f).mode & 0o077, f).toBe(0); // 0600 : personne d'autre ne lit l'export
    }
    for (const out of state.outputs) {
      for (const s of state.secrets) expect(out.includes(s)).toBe(false);
    }
    // la preuve C3 reste chiffrée dans l'export (aucun clair, aucun en-tête EXIF)
    const manifest = JSON.parse(
      readFileSync(join(paths().exportDir, 'files-manifest.json'), 'utf8'),
    ) as { entries: { key: string; sha256: string }[] };
    for (const u of state.uploads.filter((x) => x.subject !== undefined)) {
      const entry = manifest.entries.find((e) => e.key === u.key);
      expect(entry?.sha256).not.toBe(sha(u.body));
    }
    const api = await connectAs('app_api'); // L0-05
    await releaseClient(api);
  });
});
