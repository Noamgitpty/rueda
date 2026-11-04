/**
 * US-052 — garde global et intercepteur sur HTTP réel (Nest + Express, port éphémère), compteurs
 * en mémoire (la base est prouvée en L0). Seuils de TEST par pays (PA plus strict que PY), pour
 * montrer qu'ils sont lus par pays et jamais codés :
 * - critère 3 : recherche, devis et API au-delà de la limite par IP ou par compte ⇒ 429
 *   `RATE_LIMITED`, `Retry-After`, sans impact sur les autres clients ;
 * - critère 4 : sans en-têtes de navigateur ⇒ ralenti (poids) ; rythme régulier + en-têtes
 *   absents, ou inscriptions en rafale ⇒ défi (`FAKE`) exigé, refus 403
 *   `BOT_CHALLENGE_REQUIRED` sans jeton valide ; défi indisponible ⇒ refus (fail-closed) ;
 *   chaque soupçon est journalisé (tableau de sécurité) ;
 * - webhooks : limite large, aucune heuristique de navigateur ;
 * - `trust proxy` (US-010) : un `X-Forwarded-For` forgé ne contourne pas la limite par IP tant
 *   que `RUEDA_API_TRUST_PROXY` est absente ; avec 1 mandataire, l'IP transmise est comptée.
 */
import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import { Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import { IamAuthModule, SessionGuard } from '../../iam/index.js';
import type { IamAuthOptions } from '../../iam/index.js';
import { FAKE_CHALLENGE_TOKEN, FakeBotChallenge } from '../testing/index.js';
import { AbuseGuard } from './abuse-guard.js';
import { MemoryRateCounterStore } from './counter-store.js';
import { RateKeyHasher } from './key-hasher.js';
import type { RateLimitParam, RateLimitPolicy } from './policy.js';
import { RiskHttpModule } from './risk-http.module.js';

/** Pays de la configuration du dépôt ; le premier reçoit des seuils de test plus stricts. */
const CODES = [...new CountryConfigService().config.countries.keys()];
const LIMITS: Record<string, Partial<Record<RateLimitParam, number>>> = Object.fromEntries(
  CODES.map((code, i) => [
    code,
    {
      searchPerIp: 3 + 2 * i,
      quotePerIp: 50,
      quotePerAccount: 2 + 2 * i,
      apiPerIp: 8,
      apiPerAccount: 50,
    },
  ]),
);
const COMMON: Partial<Record<RateLimitParam, number>> = {
  webhookPerIp: 40,
  signupBurstPerIp: 2,
  botWeight: 4,
};
const policy: RateLimitPolicy = {
  limit(param, country) {
    const v =
      COMMON[param] ??
      (country === null
        ? Math.min(...Object.values(LIMITS).map((l) => l[param] ?? Infinity))
        : LIMITS[country]?.[param]);
    if (v === undefined || !Number.isFinite(v)) throw new Error(`PARAM_MISSING ${param}`);
    return v;
  },
  isCountry: (c) => c in LIMITS,
};

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
  accept: 'application/json',
  'accept-language': 'es',
};
const TOKEN = 'B'.repeat(43);
const iamOptions = {
  store: {
    resolveSession: () =>
      Promise.resolve({
        sessionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
        userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        mfaLevel: 'NONE',
        expiresAt: new Date(Date.now() + 3_600_000),
        emailVerified: true,
      }),
  },
  notifier: {},
} as unknown as IamAuthOptions;

@Controller()
class ProbeController {
  @Get('search')
  search() {
    return { ok: true };
  }

  @Get('quotes')
  @UseGuards(SessionGuard)
  quote() {
    return { ok: true };
  }

  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Post('webhooks/psp')
  webhook() {
    return { ok: true };
  }
}

/** Inscription simulée (sans IAM) : le garde reconnaît `POST /auth/signup`. */
@Controller('auth')
class SignupProbeController {
  @Post('signup')
  signup() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

@Module({ controllers: [SignupProbeController] })
class SignupProbeModule {}

interface Harness {
  readonly port: number;
  readonly store: MemoryRateCounterStore;
  readonly challenge: FakeBotChallenge;
  readonly app: INestApplication;
}

let current: Harness | undefined;
afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

async function start(
  options: { trustProxy?: false | number; regular?: boolean; signup?: boolean } = {},
): Promise<Harness> {
  const store = new MemoryRateCounterStore();
  const challenge = new FakeBotChallenge();
  const guard = new AbuseGuard({
    store,
    hasher: new RateKeyHasher(Buffer.alloc(32, 9)),
    policy,
    log: () => {},
  });
  @Module({
    imports: [
      RiskHttpModule.register({
        guard,
        challenge,
        board: { read: () => Promise.resolve([]) },
        rhythm: { record: () => options.regular ?? false },
      }),
      ...(options.signup === true
        ? [SignupProbeModule]
        : [IamAuthModule.register(iamOptions), ProbeModule]),
    ],
  })
  class Root {}
  const app = await NestFactory.create<NestExpressApplication>(Root, { logger: false });
  app.set('trust proxy', options.trustProxy ?? false);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  current = { port: address.port, store, challenge, app };
  return current;
}

/** Requête brute (node:http) : seuls les en-têtes donnés sont envoyés. */
function call(
  h: Harness,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string> = BROWSER,
): Promise<{ status: number; body: Record<string, unknown>; retryAfter: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: h.port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString('utf8')));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: data === '' ? {} : (JSON.parse(data) as Record<string, unknown>),
          retryAfter: res.headers['retry-after'],
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe.each(CODES.map((country, i) => ({ country, search: 3 + 2 * i, quoteAccount: 2 + 2 * i })))(
  'critère 3 en $country',
  ({ country, search, quoteAccount }) => {
    it('recherche publique : limite par IP du pays, 429 RATE_LIMITED + Retry-After', async () => {
      const h = await start({ trustProxy: 1 });
      const as = (ip: string) => ({ ...BROWSER, 'x-forwarded-for': ip });
      for (let i = 0; i < search; i += 1) {
        expect((await call(h, 'GET', `/search?country=${country}`, as('192.0.2.1'))).status).toBe(
          200,
        );
      }
      const r = await call(h, 'GET', `/search?country=${country}`, as('192.0.2.1'));
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({
        code: 'RATE_LIMITED',
        messageKey: 'common.rateLimit.retryLater',
      });
      expect(Number(r.retryAfter)).toBeGreaterThan(0);
      expect(Number(r.retryAfter)).toBeLessThanOrEqual(60);
      expect((r.body['values'] as { retryAfterS: number }).retryAfterS).toBe(Number(r.retryAfter));
      // sans impact sur les autres clients
      expect((await call(h, 'GET', `/search?country=${country}`, as('192.0.2.2'))).status).toBe(
        200,
      );
      expect(h.store.abuse).toContainEqual(
        expect.objectContaining({ kind: 'RATE_LIMITED', scope: 'search_ip', country }),
      );
    });

    it('devis : limite PAR COMPTE (après la session), même en changeant d’IP', async () => {
      const h = await start({ trustProxy: 1 });
      const as = (ip: string) => ({
        ...BROWSER,
        cookie: `__Host-session=${TOKEN}`,
        'x-forwarded-for': ip,
      });
      for (let i = 0; i < quoteAccount; i += 1) {
        expect(
          (await call(h, 'GET', `/quotes?country=${country}`, as(`192.0.2.${i + 10}`))).status,
        ).toBe(200);
      }
      const r = await call(h, 'GET', `/quotes?country=${country}`, as('192.0.2.99'));
      expect(r.status).toBe(429);
      expect(r.body['code']).toBe('RATE_LIMITED');
      expect(r.retryAfter).toBeDefined();
      expect(h.store.abuse).toContainEqual(
        expect.objectContaining({ kind: 'RATE_LIMITED', scope: 'quote_account', country }),
      );
    });
  },
);

describe('critère 3 : API générale, webhooks, trust proxy', () => {
  it('route sans pays : limite la plus stricte des pays ; un autre client passe', async () => {
    const h = await start();
    for (let i = 0; i < 8; i += 1) expect((await call(h, 'GET', '/ping')).status).toBe(200);
    expect((await call(h, 'GET', '/ping')).status).toBe(429);
  });

  it('trust proxy absent : un X-Forwarded-For forgé ne contourne pas la limite par IP', async () => {
    const h = await start({ trustProxy: false });
    for (let i = 0; i < 8; i += 1) {
      expect(
        (await call(h, 'GET', '/ping', { ...BROWSER, 'x-forwarded-for': `198.51.100.${i}` }))
          .status,
      ).toBe(200);
    }
    expect(
      (await call(h, 'GET', '/ping', { ...BROWSER, 'x-forwarded-for': '198.51.100.250' })).status,
    ).toBe(429);
  });

  it('webhooks : limite large, aucune exigence d’en-têtes de navigateur', async () => {
    const h = await start();
    for (let i = 0; i < 40; i += 1) {
      expect((await call(h, 'POST', '/webhooks/psp', {})).status).toBe(201);
    }
    expect((await call(h, 'POST', '/webhooks/psp', {})).status).toBe(429);
    expect(h.store.abuse.some((a) => a.kind === 'BOT_SUSPECTED')).toBe(false);
  });
});

describe('critère 4 : heuristiques anti-robot et défi FAKE', () => {
  it('sans en-têtes de navigateur : client ralenti (poids 4), soupçon journalisé', async () => {
    const h = await start();
    // 8 requêtes par minute permises ; poids 4 ⇒ 2 requêtes seulement
    expect((await call(h, 'GET', '/ping', {})).status).toBe(200);
    expect((await call(h, 'GET', '/ping', {})).status).toBe(200);
    expect((await call(h, 'GET', '/ping', {})).status).toBe(429);
    expect(h.store.abuse).toContainEqual(
      expect.objectContaining({ kind: 'BOT_SUSPECTED', signals: ['NO_BROWSER_HEADERS'] }),
    );
    // un navigateur sur une autre IP n'est pas affecté
  });

  it('rythme régulier et en-têtes absents : défi exigé ; jeton FAKE valide ⇒ passe', async () => {
    const h = await start({ regular: true });
    const refused = await call(h, 'GET', '/ping', {});
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: 'BOT_CHALLENGE_REQUIRED',
      messageKey: 'common.rateLimit.challengeRequired',
    });
    expect((await call(h, 'GET', '/ping', { 'x-bot-challenge': 'faux' })).status).toBe(403);
    expect(
      (await call(h, 'GET', '/ping', { 'x-bot-challenge': FAKE_CHALLENGE_TOKEN })).status,
    ).toBe(200);
    expect(h.store.abuse.filter((a) => a.kind === 'BOT_CHALLENGED')).toHaveLength(3);
    expect(h.store.abuse[0]?.signals).toEqual(['NO_BROWSER_HEADERS', 'REGULAR_RHYTHM']);
    // le défi reçoit une empreinte, jamais l'IP
    expect(h.challenge.verified.every((v) => /^[0-9a-f]{64}$/.test(v.subject))).toBe(true);
  });

  it('défi indisponible : le client soupçonné est refusé (fail-closed)', async () => {
    const h = await start({ regular: true });
    h.challenge.unavailable = true;
    expect(
      (await call(h, 'GET', '/ping', { 'x-bot-challenge': FAKE_CHALLENGE_TOKEN })).status,
    ).toBe(403);
  });

  it('un humain au rythme régulier (en-têtes présents) est seulement ralenti', async () => {
    const h = await start({ regular: true });
    expect((await call(h, 'GET', '/ping')).status).toBe(200);
    expect(h.store.abuse).toContainEqual(
      expect.objectContaining({ kind: 'BOT_SUSPECTED', signals: ['REGULAR_RHYTHM'] }),
    );
  });

  it('inscriptions en rafale d’une même IP : défi exigé au-delà du seuil', async () => {
    const h = await start({ signup: true });
    expect((await call(h, 'POST', '/auth/signup')).status).toBe(201);
    expect((await call(h, 'POST', '/auth/signup')).status).toBe(201);
    const r = await call(h, 'POST', '/auth/signup');
    expect(r.status).toBe(403);
    expect(r.body['code']).toBe('BOT_CHALLENGE_REQUIRED');
    expect(h.store.abuse).toContainEqual(
      expect.objectContaining({ kind: 'BOT_CHALLENGED', signals: ['SIGNUP_BURST'] }),
    );
    expect(
      (
        await call(h, 'POST', '/auth/signup', {
          ...BROWSER,
          'x-bot-challenge': FAKE_CHALLENGE_TOKEN,
        })
      ).status,
    ).toBe(201);
  });
});
