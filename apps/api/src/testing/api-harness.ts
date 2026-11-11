/**
 * Application API RÉELLE de test (US-043) — TESTS SEULEMENT, jamais compilée en production
 * (répertoires `testing` exclus par tsconfig.build.json).
 *
 * Monte `ApiModule` (tous les contrôleurs, gardes globaux, ordre de main.ts) avec le durcissement
 * de `http-hardening.ts`, sur un port éphémère. Seuls les ADAPTATEURS sont remplacés :
 * - sessions : `sessions` associe un jeton de session (cookie `__Host-session`) à un acteur ;
 *   `voyageur` = session d'un compte sans rôle interne, `staff_sans_mfa` = membre du staff dont la
 *   session n'est pas élevée par TOTP, `staff` = session élevée ;
 * - les autres magasins rejettent tout appel non prévu (une réponse 500, jamais un succès feint) ;
 * - limites de débit larges (le débit est prouvé par US-052) ; défi anti-robot indisponible.
 * Le principal ne vient JAMAIS d'autre chose que du cookie : aucun en-tête ni paramètre forgé ne
 * peut le changer (preuve dans route-matrix.test.ts).
 */
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from '../api.module.js';
import { applyHttpHardening } from '../http-hardening.js';
import { loadBrandParams, UnavailableBrandFileStore } from '../modules/cfg/index.js';
import type { BrandOptions } from '../modules/cfg/index.js';
import type { CtrLegalOptions } from '../modules/ctr/index.js';
import type { IamAuthOptions, StaffOptions } from '../modules/iam/index.js';
import type { PayWebhookOptions } from '../modules/pay/index.js';
import {
  AbuseGuard,
  MemoryRateCounterStore,
  RateKeyHasher,
  UnavailableBotChallenge,
} from '../modules/risk/index.js';
import type { RateLimitPolicy, RiskHttpOptions } from '../modules/risk/index.js';
import type { SupConsoleOptions } from '../modules/sup/index.js';
import { CountryConfigService } from '../modules/cfg/index.js';

export type HarnessActor = 'voyageur' | 'staff_sans_mfa' | 'staff';

export interface HarnessSession {
  readonly token: string;
  readonly userId: string;
  readonly actor: HarnessActor;
}

export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly text: string;
}

export interface ApiHarness {
  readonly port: number;
  readonly sessions: Readonly<Record<HarnessActor, HarnessSession>>;
  /** Journal de l'application (Nest) pendant sa vie. */
  readonly logs: string[];
  call(
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: string | Buffer },
  ): Promise<HttpReply>;
  close(): Promise<void>;
}

/** En-têtes d'un navigateur : aucun signal anti-robot (US-052). */
export const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) rueda-test',
  accept: 'application/json',
  'accept-language': 'es',
};

const token = (): string => randomBytes(32).toString('base64url');
const uuid = (): string => randomUUID();

const NOT_METHODS = new Set([
  'constructor',
  'toJSON',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/** Objet dont toute méthode non fournie rejette : un appel imprévu se voit (500). */
function strict<T extends object>(provided: Partial<T>, name: string): T {
  return new Proxy(provided as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver) as unknown;
      // promesse, symboles et crochets de cycle de vie de Nest : absents, pas des appels métier
      if (typeof prop === 'symbol' || prop === 'then' || NOT_METHODS.has(prop)) return undefined;
      return () => Promise.reject(new Error(`${name}.${String(prop)} non prévu par le harnais`));
    },
  });
}

const sha256hex = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/**
 * Adaptateurs remplacés par un test (contrats d'API, US-038) : chaque groupe est fusionné sur les
 * adaptateurs par défaut du harnais, qui restent stricts pour tout ce qui n'est pas fourni.
 */
export interface ApiHarnessOverrides {
  readonly iam?: Partial<IamAuthOptions>;
  readonly pay?: Partial<PayWebhookOptions>;
  readonly staff?: Partial<StaffOptions>;
  readonly sup?: Partial<SupConsoleOptions>;
  readonly brand?: Partial<BrandOptions>;
  readonly ctr?: Partial<CtrLegalOptions>;
  readonly risk?: Partial<RiskHttpOptions>;
}

export async function startApiHarness(overrides: ApiHarnessOverrides = {}): Promise<ApiHarness> {
  const sessions: Record<HarnessActor, HarnessSession> = {
    voyageur: { token: token(), userId: uuid(), actor: 'voyageur' },
    staff_sans_mfa: { token: token(), userId: uuid(), actor: 'staff_sans_mfa' },
    staff: { token: token(), userId: uuid(), actor: 'staff' },
  };
  const byHash = new Map<string, HarnessSession>();
  for (const s of Object.values(sessions)) byHash.set(sha256hex(s.token), s);
  const find = (hash: Buffer): HarnessSession | undefined => byHash.get(hash.toString('hex'));

  const iam: IamAuthOptions = {
    store: strict<IamAuthOptions['store']>(
      {
        resolveSession: (hash: Buffer) => {
          const s = find(hash);
          return Promise.resolve(
            s === undefined
              ? null
              : {
                  sessionId: uuid(),
                  userId: s.userId,
                  mfaLevel: s.actor === 'staff' ? 'TOTP' : 'NONE',
                  expiresAt: new Date(Date.now() + 3_600_000),
                  emailVerified: true,
                },
          );
        },
        findCredentials: () => Promise.resolve(null),
        registerAccount: () => Promise.resolve(false),
        verifyEmail: () => Promise.resolve(false),
        revokeSession: (hash: Buffer) => Promise.resolve(find(hash) !== undefined),
        revokeAllSessions: (hash: Buffer) => Promise.resolve(find(hash) === undefined ? 0 : 1),
      },
      'AuthStore',
    ),
    notifier: strict<IamAuthOptions['notifier']>(
      {
        sendAccountExists: () => Promise.resolve(),
        sendEmailVerification: () => Promise.resolve(),
      },
      'IdentityNotifier',
    ),
  };
  const staff: StaffOptions = {
    store: strict<StaffOptions['store']>(
      {
        begin: (hash: Buffer) => {
          const s = find(hash);
          if (s === undefined) {
            return Promise.resolve({
              outcome: 'AUTH_REQUIRED',
              userId: null,
              factorId: null,
              roles: [],
            });
          }
          return Promise.resolve({
            outcome:
              s.actor === 'voyageur'
                ? 'NOT_STAFF'
                : s.actor === 'staff_sans_mfa'
                  ? 'TOTP_NOT_ENROLLED'
                  : 'ELEVATED',
            userId: s.userId,
            factorId: null,
            roles: s.actor === 'voyageur' ? [] : [{ role: 'ADMIN', countries: [] }],
          });
        },
      },
      'StaffStore',
    ),
    vault: strict<StaffOptions['vault']>({}, 'TotpSecretVault'),
    proofKey: null,
    issuer: 'test',
    limits: {
      requestsPerIp: 1_000_000,
      requestWindowMs: 60_000,
      mfaPerIp: 1_000_000,
      mfaPerAccount: 1_000_000,
      mfaWindowMs: 60_000,
    },
  };
  const pay: PayWebhookOptions = {
    registry: { get: () => undefined },
    store: strict<PayWebhookOptions['store']>(
      { resolveAccount: () => Promise.resolve(null) },
      'WebhookInboxStore',
    ),
    secrets: { resolve: () => Promise.resolve(null) },
    log: { warn: () => undefined },
  };
  const sup: SupConsoleOptions = {
    store: strict<SupConsoleOptions['store']>({}, 'ManualActionStore'),
  };
  const brand: BrandOptions = {
    store: strict<BrandOptions['store']>(
      {
        publishedVersion: () => Promise.resolve(null),
        publicAssets: () => Promise.resolve([]),
        publishedBlocks: () => Promise.resolve([]),
      },
      'BrandStore',
    ),
    files: new UnavailableBrandFileStore(),
    params: loadBrandParams(),
  };
  // Consentements (US-102) : une session connue a des CGU à jour (aucune ligne) ; inconnue : 401.
  const ctr: CtrLegalOptions = {
    store: strict<CtrLegalOptions['store']>(
      {
        publishedDocuments: () => Promise.resolve([]),
        documentBody: () => Promise.resolve(null),
        status: (proof: Buffer) => Promise.resolve(find(proof) === undefined ? null : []),
        history: () => Promise.resolve([]),
        accept: (proof: Buffer) => Promise.resolve(find(proof) === undefined ? null : 0),
        setMarketing: (proof: Buffer) =>
          Promise.resolve(find(proof) === undefined ? null : ('UNCHANGED' as const)),
      },
      'ConsentStore',
    ),
  };
  const config = new CountryConfigService().config;
  const wide: RateLimitPolicy = {
    limit: () => 1_000_000,
    isCountry: (c) => config.countries.has(c),
  };
  const risk: RiskHttpOptions = {
    guard: new AbuseGuard({
      store: new MemoryRateCounterStore(),
      hasher: new RateKeyHasher(randomBytes(32)),
      policy: wide,
    }),
    challenge: new UnavailableBotChallenge(),
    board: strict<RiskHttpOptions['board']>({}, 'AbuseBoardStore'),
    rhythm: { record: () => false },
  };

  const logs: string[] = [];
  const push =
    (level: string) =>
    (message: unknown, ...rest: unknown[]) => {
      logs.push(
        [level, message, ...rest]
          .map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x)))
          .join(' '),
      );
    };
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register(
      { ...iam, ...overrides.iam },
      { ...pay, ...overrides.pay },
      { ...staff, ...overrides.staff },
      { ...sup, ...overrides.sup },
      { ...brand, ...overrides.brand },
      { ...risk, ...overrides.risk },
      { ...ctr, ...overrides.ctr },
    ),
    {
      rawBody: true,
      logger: {
        log: push('log'),
        error: push('error'),
        warn: push('warn'),
        debug: push('debug'),
        verbose: push('verbose'),
      },
    },
  );
  applyHttpHardening(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const port = address.port;

  const call: ApiHarness['call'] = (method, path, options = {}) =>
    new Promise((resolve, reject) => {
      const body = options.body;
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            ...BROWSER_HEADERS,
            ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}),
            ...options.headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  return { port, sessions, logs, call, close: () => app.close() };
}

/** Cookie de session d'un acteur du harnais. */
export const cookieOf = (s: HarnessSession): Record<string, string> => ({
  cookie: `__Host-session=${s.token}`,
});
