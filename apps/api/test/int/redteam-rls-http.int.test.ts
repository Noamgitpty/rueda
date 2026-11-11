/**
 * test:int — US-049, red team, axe `rls` : IDOR par l'API HTTP RÉELLE (ApiModule monté comme
 * main.ts, adaptateurs PostgreSQL de production, sous app_api, assertion L0-05 en tête de chaque
 * test). Les routes existantes ne portent aucun objet de voyageur ou d'hôte (lot 0) : les
 * identifiants devinés visent donc des COMPTES (`/staff/members/{id}`), des TRIPS d'un autre pays
 * (`/console/actions`) et des JETONS de session. Un identifiant d'un autre pays ou d'un autre compte
 * doit recevoir EXACTEMENT la réponse d'un identifiant inexistant (aucun oracle d'existence), et
 * jamais un succès.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE ; un test rouge est une faille trouvée.
 * Rapport : docs/team/redteam/L0-rls.md (RT-RLS-3x).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { assertProductionRole, connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../../src/api.module.js';
import { applyHttpHardening } from '../../src/http-hardening.js';
import {
  loadBrandParams,
  PgBrandStore,
  UnavailableBrandFileStore,
} from '../../src/modules/cfg/index.js';
import { PgConsentStore } from '../../src/modules/ctr/index.js';
import { postgresIamAdapters, postgresStaffAdapters } from '../../src/modules/iam/index.js';
import type { StaffOptions } from '../../src/modules/iam/index.js';
import { postgresPayAdapters } from '../../src/modules/pay/index.js';
import {
  AbuseGuard,
  PgAbuseBoardStore,
  PgRateCounterStore,
  RateKeyHasher,
  UnavailableBotChallenge,
} from '../../src/modules/risk/index.js';
import type { RateLimitPolicy } from '../../src/modules/risk/index.js';
import { PgFinanceApprovalStore, PgManualActionStore } from '../../src/modules/sup/index.js';
import type { SqlPool } from '../../src/modules/sup/index.js';

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const token = (): string => randomBytes(32).toString('base64url');
const sha = (t: string): Buffer => createHash('sha256').update(t, 'utf8').digest();

let client: pg.Client;
let app: NestExpressApplication;
let port = 0;
let countries: string[] = [];

async function register(): Promise<string> {
  const id = randomUUID();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Rt', 'Rls', 'es', $4, $5, 86400, NULL, NULL, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false) AS ok`,
    [id, `rt-${id}@example.test`, PHC, randomUUID(), randomBytes(32)],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [id]);
  return id;
}

async function session(userId: string): Promise<{ cookie: string; token: string }> {
  const t = token();
  await client.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'rt')`, [
    randomUUID(),
    userId,
    sha(t),
  ]);
  return { cookie: `__Host-session=${t}`, token: t };
}

async function elevatedStaff(
  role: string,
  scope: readonly string[],
): Promise<{ id: string; cookie: string }> {
  const id = await register();
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), id, role, scope],
  );
  await client.query('SELECT test_fixture.us043_enable_totp($1)', [id]);
  const t = token();
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, sha(t)]);
  return { id, cookie: `__Host-session=${t}` };
}

interface Reply {
  readonly status: number;
  readonly code: string | null;
  readonly text: string;
}

function call(method: string, path: string, cookie: string | null, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 14) rueda-test',
          accept: 'application/json',
          'accept-language': 'es',
          ...(cookie === null ? {} : { cookie }),
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(payload)),
              }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let code: string | null;
          try {
            const parsed = JSON.parse(text) as { code?: unknown };
            code = typeof parsed.code === 'string' ? parsed.code : null;
          } catch {
            code = null;
          }
          resolve({ status: res.statusCode ?? 0, code, text });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const shape = (r: Reply): string => `${r.status} ${r.code ?? '-'}`;

let adminFirst: { id: string; cookie: string };
let opsFirst: { id: string; cookie: string };
let opsSecond: { id: string; cookie: string };
let guestUser: string;
let guestSession: { cookie: string; token: string };
const tripOf = new Map<string, string>();

beforeAll(async () => {
  client = await connectAs('app_api');
  countries = (
    await client.query<{ code: string }>(
      'SELECT code::text AS code FROM core.config_country ORDER BY code',
    )
  ).rows.map((r) => r.code);
  expect(countries.length).toBeGreaterThanOrEqual(2);
  const [first, second] = countries as [string, string];
  adminFirst = await elevatedStaff('ADMIN', [first]);
  opsFirst = await elevatedStaff('OPS_AGENT', [first]);
  opsSecond = await elevatedStaff('OPS_AGENT', [second]);
  guestUser = await register();
  guestSession = await session(guestUser);
  for (const c of countries) {
    const trip = randomUUID();
    const meta = await client.query<{ cur: string; tz: string }>(
      'SELECT currency::text AS cur, time_zone AS tz FROM core.config_country WHERE code = $1',
      [c],
    );
    await client.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      c,
      meta.rows[0]?.cur,
      meta.rows[0]?.tz,
      '2032-09-01T10:00:00Z',
      '2032-09-03T10:00:00Z',
    ]);
    tripOf.set(c, trip);
  }

  const env = { ...process.env, RUEDA_ENV: 'test' };
  const wide: RateLimitPolicy = { limit: () => 1_000_000, isCountry: (c) => countries.includes(c) };
  const staff: StaffOptions = {
    ...postgresStaffAdapters(client, env, 'Console'),
    vault: {
      store: () => Promise.resolve(`fake-vault:${randomUUID()}`),
      resolve: () => Promise.resolve(null),
    },
    limits: {
      requestsPerIp: 1_000_000,
      requestWindowMs: 60_000,
      mfaPerIp: 1_000_000,
      mfaPerAccount: 1_000_000,
      mfaWindowMs: 60_000,
    },
  };
  app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register(
      await postgresIamAdapters(client),
      (await postgresPayAdapters(client, env)).webhooks,
      staff,
      {
        store: new PgManualActionStore(client),
        // une seule connexion de test : la lecture des demandes y ouvre et ferme sa transaction
        finance: new PgFinanceApprovalStore({
          query: (text, values) => client.query(text, values as unknown[]),
          connect: () =>
            Promise.resolve({
              query: (text: string, values?: readonly unknown[]) =>
                client.query(text, values as unknown[]),
              release: () => undefined,
            } as Awaited<ReturnType<SqlPool['connect']>>),
        }),
      },
      {
        store: new PgBrandStore(client),
        files: new UnavailableBrandFileStore(),
        params: loadBrandParams(),
      },
      {
        guard: new AbuseGuard({
          store: new PgRateCounterStore(client),
          hasher: new RateKeyHasher(randomBytes(32)),
          policy: wide,
        }),
        challenge: new UnavailableBotChallenge(),
        board: new PgAbuseBoardStore(client),
        rhythm: { record: () => false },
      },
      { store: new PgConsentStore(client) },
    ),
    { rawBody: true, logger: false },
  );
  applyHttpHardening(app);
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as { port: number }).port;
}, 180_000);

afterAll(async () => {
  await app?.close();
  if (client) await releaseClient(client);
});

const REASON = 'Red team US-049 : identifiant visé, motif de plus de dix caractères';

describe('RT-RLS-30 — jeton de session : devine, haché, ou emprunté', () => {
  it('jetons devinés, empreinte stockée présentée comme jeton, cookie d’un autre schéma : 401 partout', async () => {
    await assertProductionRole(client, 'app_api');
    const stored = sha(guestSession.token);
    const forged = [
      `__Host-session=${token()}`,
      `__Host-session=${stored.toString('hex')}`,
      `__Host-session=${stored.toString('base64url')}`,
      `__Host-session=${guestSession.token}x`,
      `__Host-session=${guestSession.token.slice(0, -2)}`,
      `session=${guestSession.token}`, // nom sans préfixe __Host-
    ];
    for (const cookie of forged) {
      const r = await call('GET', '/auth/session', cookie);
      expect(shape(r), cookie.slice(0, 40)).toBe('401 AUTH_REQUIRED');
    }
    // témoin : le vrai jeton ouvre la session (le refus ci-dessus vient donc du jeton)
    const ok = await call('GET', '/auth/session', guestSession.cookie);
    expect(ok.status).toBe(200);
  });

  it('en-têtes d’identité forgés (X-User-Id, X-Actor, Authorization) : ignorés, la session reste celle du cookie', async () => {
    await assertProductionRole(client, 'app_api');
    const other = await register();
    const r = await new Promise<Reply>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/auth/session',
          headers: {
            'user-agent': 'Mozilla/5.0 (Linux; Android 14) rueda-test',
            accept: 'application/json',
            cookie: guestSession.cookie,
            'x-user-id': other,
            'x-actor-id': other,
            'x-forwarded-user': other,
            authorization: `Bearer ${adminFirst.cookie.split('=')[1] ?? ''}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              code: null,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(other);
    expect(r.text).toContain(guestUser);
  });
});

describe('RT-RLS-31 — identifiants de comptes devinés : aucun oracle d’existence ni élévation', () => {
  it('suspension / réinitialisation TOTP par ADMIN d’un pays : compte voyageur existant, staff de l’autre pays, identifiant inexistant ⇒ même réponse', async () => {
    await assertProductionRole(client, 'app_api');
    for (const action of ['suspend', 'reset-totp']) {
      const targets = [
        ['voyageur existant', guestUser],
        ['staff OPS de l’autre pays', opsSecond.id],
        ['inexistant', randomUUID()],
      ] as const;
      const seen: string[] = [];
      for (const [, id] of targets) {
        const r = await call('POST', `/staff/members/${id}/${action}`, adminFirst.cookie, {
          reason: REASON,
        });
        seen.push(shape(r));
      }
      expect(new Set(seen).size, `${action} : ${seen.join(' | ')}`).toBe(1);
      expect(seen[0]).toMatch(/^403 /);
    }
    // et le compte visé n'a PAS été touché : sa session de staff vit toujours
    const still = await call('GET', '/staff/me', opsSecond.cookie);
    expect(still.status).toBe(200);
  });

  it('auto-suspension, suspension d’un pair d’un autre rôle par un OPS : refusées sans effet', async () => {
    await assertProductionRole(client, 'app_api');
    const self = await call('POST', `/staff/members/${adminFirst.id}/suspend`, adminFirst.cookie, {
      reason: REASON,
    });
    expect(self.status).toBe(403);
    const byOps = await call('POST', `/staff/members/${adminFirst.id}/suspend`, opsFirst.cookie, {
      reason: REASON,
    });
    expect(byOps.status).toBe(403);
    expect((await call('GET', '/staff/me', adminFirst.cookie)).status).toBe(200);
  });
});

describe('RT-RLS-32 — trips devinés ou d’un autre pays via la console', () => {
  it('OPS du premier pays : trip du second pays existant, trip inexistant ⇒ même réponse (aucun oracle de pays) ; jamais enregistré', async () => {
    await assertProductionRole(client, 'app_api');
    const [first, second] = countries as [string, string];
    const act = (subjectId: string): Promise<Reply> =>
      call('POST', '/console/actions', opsFirst.cookie, {
        requestId: randomUUID(),
        action: 'RECORD_CLAIM',
        subjectId,
        reason: REASON,
      });
    const cross = await act(tripOf.get(second) as string);
    const ghost = await act(randomUUID());
    expect(shape(cross), `${cross.text.slice(0, 200)} / ${ghost.text.slice(0, 200)}`).toBe(
      shape(ghost),
    );
    expect(cross.status).toBe(403);
    // témoin : le trip de SON pays n'est pas refusé par la portée (la réponse diffère donc)
    const home = await act(tripOf.get(first) as string);
    expect(home.status).not.toBe(403);
  });

  it('voyageur et staff sans TOTP : jamais d’action manuelle, même sur un trip existant', async () => {
    await assertProductionRole(client, 'app_api');
    const [first] = countries as [string];
    const r = await call('POST', '/console/actions', guestSession.cookie, {
      requestId: randomUUID(),
      action: 'RECORD_CLAIM',
      subjectId: tripOf.get(first),
      reason: REASON,
    });
    expect(r.status).toBe(403);
  });
});
