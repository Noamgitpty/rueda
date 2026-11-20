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
import { UNAVAILABLE_AVL_CHECKOUT } from '../modules/avl/index.js';
import type { AvlCheckoutOptions } from '../modules/avl/index.js';
import { UnavailablePhotoScanner, UnavailablePhotoStorage } from '../modules/cat/index.js';
import type {
  CatHostOptions,
  CatSearchOptions,
  HostListingStore,
  SearchStore,
} from '../modules/cat/index.js';
import {
  loadBrandParams,
  UnavailableBrandFileStore,
  UnavailableBrandScanner,
} from '../modules/cfg/index.js';
import type { BrandOptions } from '../modules/cfg/index.js';
import type { CtrLegalOptions } from '../modules/ctr/index.js';
import type { IamAuthOptions, StaffOptions } from '../modules/iam/index.js';
import { kycCountries } from '../modules/kyc/index.js';
import type { IdentityStore, KycIdentityOptions } from '../modules/kyc/index.js';
import { unavailablePyoOptions } from '../modules/pyo/index.js';
import type { PyoPayoutOptions } from '../modules/pyo/index.js';
import { unavailableMsgOptions } from '../modules/msg/index.js';
import type { MsgTripMessagesOptions } from '../modules/msg/index.js';
import { unavailableRevOptions } from '../modules/rev/index.js';
import type { RevReviewsOptions } from '../modules/rev/index.js';
import type { PayWebhookOptions } from '../modules/pay/index.js';
import {
  AbuseGuard,
  availabilityProbeLimiter,
  MemoryRateCounterStore,
  RateKeyHasher,
  UnavailableBotChallenge,
} from '../modules/risk/index.js';
import type { RateLimitPolicy, RiskHttpOptions } from '../modules/risk/index.js';
import type { ReportStore } from '../modules/rpt/index.js';
import type { SupConsoleOptions, SupEvidenceBundleOptions } from '../modules/sup/index.js';
import type { TrpInspectionOptions } from '../modules/trp/index.js';
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
  /** Application Nest montée (introspection des routes et des gardes, N-43). */
  readonly app: NestExpressApplication;
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
  readonly cat?: Partial<CatHostOptions>;
  readonly kyc?: Partial<KycIdentityOptions>;
  readonly search?: Partial<CatSearchOptions>;
  /** Checkout (US-208) ; absent : 503 après les gardes (aucun adaptateur). */
  readonly checkout?: Partial<AvlCheckoutOptions>;
  /** Photos d'état du véhicule (US-303) ; absent : 503 après les gardes (aucun adaptateur). */
  readonly trp?: Partial<TrpInspectionOptions>;
  /** Compte de versement (US-707) ; absent : magasin indisponible, ni coffre ni PSP (503). */
  readonly pyo?: Partial<PyoPayoutOptions>;
  /** Messagerie par trip (US-525) ; absent : magasin indisponible (503). */
  readonly msg?: Partial<MsgTripMessagesOptions>;
  /** US-308 : dossier de preuve (absent : coffre et stockage indisponibles, routes 503). */
  readonly evidence?: SupEvidenceBundleOptions;
  /** Avis réciproques (US-317) ; absent : magasin indisponible (503). */
  readonly rev?: Partial<RevReviewsOptions>;
  /** US-311 : vues de la bêta et rapprochement (absent : magasin indisponible, routes 503). */
  readonly report?: ReportStore;
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
        // compte d'hôte (US-107) : aucun compte dans le harnais ; une ouverture est refusée
        hostAccounts: () => Promise.resolve([]),
        openHostAccount: (hash: Buffer) =>
          Promise.resolve({
            outcome: find(hash) === undefined ? 'AUTH_REQUIRED' : 'HOST_ACCOUNT_NOT_ELIGIBLE',
            orgId: null,
          }),
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
    finance: strict<SupConsoleOptions['finance']>({}, 'FinanceApprovalStore'),
    ops: strict<SupConsoleOptions['ops']>({}, 'OpsConsoleStore'),
    evidence: {
      pool: strict<SupConsoleOptions['evidence']['pool']>({}, 'EvidencePool'),
      scanner: strict<SupConsoleOptions['evidence']['scanner']>({}, 'EvidenceScanner'),
      vault: strict<SupConsoleOptions['evidence']['vault']>({}, 'EvidenceVault'),
      files: strict<SupConsoleOptions['evidence']['files']>({}, 'EvidenceFileStore'),
    },
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
    scanner: new UnavailableBrandScanner(),
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
        // CGU de l'hôte (US-126) : aucun compte d'hôte dans le harnais ⇒ FORBIDDEN (404, IDOR)
        hostTerms: (proof: Buffer) =>
          Promise.resolve(find(proof) === undefined ? 'AUTH_REQUIRED' : 'FORBIDDEN'),
        acceptHostTerms: (proof: Buffer) =>
          Promise.resolve(find(proof) === undefined ? 'AUTH_REQUIRED' : 'FORBIDDEN'),
      },
      'ConsentStore',
    ),
  };
  // Lieux, véhicules et annonces de l'hôte (US-115) : aucun compte d'hôte dans le harnais ; toute
  // commande rend FORBIDDEN (404, IDOR) et toute lecture rien.
  const refused = () => Promise.resolve({ outcome: 'FORBIDDEN', id: null });
  const cat: CatHostOptions = {
    store: strict<HostListingStore>(
      {
        hostMarket: () => Promise.resolve(null),
        createLocation: refused,
        createVehicle: refused,
        createListing: refused,
        updatePricing: refused,
        submitListing: refused,
        deleteListing: refused,
        addPhoto: refused,
        locations: () => Promise.resolve([]),
        vehicles: () => Promise.resolve([]),
        listings: () => Promise.resolve([]),
        publicListing: () => Promise.resolve(null),
        guestMeetingPoint: () => Promise.resolve(null),
      },
      'HostListingStore',
    ),
    catalog: null,
    photos: { scanner: new UnavailablePhotoScanner(), storage: new UnavailablePhotoStorage() },
  };
  // Vérification d'identité (US-105) : état « non commencé » des sessions connues, aucun
  // fournisseur (ouverture 503, rappels 404) ; tout autre appel du magasin est imprévu.
  const kyc: KycIdentityOptions = {
    store: strict<IdentityStore>(
      {
        state: (proof: Buffer) =>
          Promise.resolve(
            find(proof) === undefined
              ? null
              : {
                  status: 'NOT_STARTED' as const,
                  country: null,
                  reasonCode: null,
                  licenseExpiresOn: null,
                  sessionLive: false,
                  phoneVerified: false,
                  consent: null,
                },
          ),
      },
      'IdentityStore',
    ),
    providers: { active: null, byCode: new Map() },
    returnUrl: null,
    countries: kycCountries(),
    log: { warn: () => undefined },
  };
  const config = new CountryConfigService().config;
  const wide: RateLimitPolicy = {
    // poids d'un client soupçonné = graine de production (4) : jamais la fenêtre saturée d'un coup
    limit: (param) => (param === 'botWeight' ? 4 : 1_000_000),
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
  // Recherche publique (US-201) : aucune annonce cherchable dans le harnais ; sonde comptée par la
  // garde anti-abus du harnais (limites larges)
  const search: CatSearchOptions = {
    store: strict<SearchStore>(
      {
        areas: () => Promise.resolve([]),
        search: () => Promise.resolve({ outcome: 'OK' as const, results: [] }),
        listingCountry: () => Promise.resolve(null),
      },
      'SearchStore',
    ),
    probe: availabilityProbeLimiter(risk.guard),
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
      { ...cat, ...overrides.cat },
      { ...kyc, ...overrides.kyc },
      { ...search, ...overrides.search },
      { ...UNAVAILABLE_AVL_CHECKOUT, ...overrides.checkout },
      { ...overrides.trp },
      { ...unavailablePyoOptions(), ...overrides.pyo },
      { ...unavailableMsgOptions(), ...overrides.msg },
      { ...overrides.evidence },
      { ...unavailableRevOptions(), ...overrides.rev },
      overrides.report,
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

  return { port, app, sessions, logs, call, close: () => app.close() };
}

/** Cookie de session d'un acteur du harnais. */
export const cookieOf = (s: HarnessSession): Record<string, string> => ({
  cookie: `__Host-session=${s.token}`,
});
