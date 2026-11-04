/**
 * US-052 — service anti-abus, sans base (compteurs en mémoire ; la sémantique SQL est prouvée en
 * L0 sous les rôles de production, packages/db/test/l0/l0-risk-rate-limit.test.ts).
 *
 * Seuils : paramètres `rate_limit_*` de la configuration du DÉPÔT (CFG, params.json), lus par
 * pays ; les attentes viennent de 17 §6.6 et de 19 US-052, jamais du code testé :
 * - critère 1 : au-delà de la limite d'OTP par numéro ou par IP ⇒ `RATE_LIMITED`, aucun SMS,
 *   refus journalisé ; code distinct d'`OTP_LOCKED` ;
 * - fail-closed : compteur ou paramètre indisponible ⇒ `RATE_LIMIT_UNAVAILABLE`, aucun envoi ;
 * - plafond SMS du pays : un OTP au-delà est refusé ;
 * - routes : repli dégradé en mémoire si la base ne répond pas ;
 * - aucune donnée personnelle dans les clés ni dans les journaux.
 */
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import { AbuseGuard } from './abuse-guard.js';
import type { CostlySendRequest, RiskLogEntry } from './abuse-guard.js';
import type { RateCounterStore } from './counter-store.js';
import { CounterUnavailableError, MemoryRateCounterStore } from './counter-store.js';
import { RiskHttpError } from './errors.js';
import { RateKeyHasher } from './key-hasher.js';
import { configRateLimitPolicy, RATE_LIMIT_PARAMS } from './policy.js';
import type { RateLimitPolicy } from './policy.js';

const CONFIG = new CountryConfigService().config;
const POLICY = configRateLimitPolicy(CONFIG);
const HASHER = new RateKeyHasher(Buffer.alloc(32, 7));
/** Pays de la configuration du dépôt (PA / USD et PY / PYG), jamais codés en dur. */
const COUNTRIES = [...CONFIG.countries.keys()].map((country, i) => ({
  country,
  phone: `+1555000${String(i).padStart(4, '0')}`,
  email: `client-${String(i)}@example.test`,
  ip: `192.0.2.${String(10 + i)}`,
}));
const FIRST = COUNTRIES[0]?.country ?? '';

/** Valeur du paramètre dans les données du dépôt (params.json), lue sans le code testé. */
function paramValue(key: string, country: string): number {
  const v = CONFIG.values.find((x) => x.key === key && x.country === country);
  if (v === undefined || typeof v.value !== 'number') throw new Error(`${key} absent`);
  return v.value;
}

function setup(store: RateCounterStore = new MemoryRateCounterStore()) {
  const logs: RiskLogEntry[] = [];
  const guard = new AbuseGuard({ store, hasher: HASHER, policy: POLICY, log: (e) => logs.push(e) });
  return { guard, logs, store };
}

async function refusal(p: Promise<unknown>): Promise<RiskHttpError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof RiskHttpError) return error;
    throw error;
  }
  throw new Error('aucun refus');
}

const failing: RateCounterStore = {
  hit: () => Promise.reject(new CounterUnavailableError('panne')),
  reserveSms: () => Promise.reject(new CounterUnavailableError('panne')),
  recordAbuse: () => Promise.reject(new CounterUnavailableError('panne')),
};

describe.each(COUNTRIES)('envois coûteux en $country', ({ country, phone, email, ip }) => {
  it('critère 1 : OTP au-delà de la limite par numéro ⇒ RATE_LIMITED, aucun SMS, refus journalisé', async () => {
    const store = new MemoryRateCounterStore();
    const { guard, logs } = setup(store);
    const limit = paramValue(RATE_LIMIT_PARAMS.otpPerPhone, country);
    let sent = 0;
    const send = () => Promise.resolve((sent += 1));
    for (let i = 0; i < limit; i += 1) {
      // une IP différente à chaque fois : seule la limite par numéro joue
      await guard.guardedSend(
        { channel: 'SMS_OTP', country, recipient: phone, ip: `203.0.113.${i}` },
        send,
      );
    }
    expect(sent).toBe(limit);
    const error = await refusal(
      guard.guardedSend(
        { channel: 'SMS_OTP', country, recipient: phone, ip: '203.0.113.200' },
        send,
      ),
    );
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.code).not.toBe('OTP_LOCKED');
    expect(error.getStatus()).toBe(429);
    expect(error.retryAfterS).toBeGreaterThan(0);
    expect(error.retryAfterS).toBeLessThanOrEqual(3600);
    expect(sent).toBe(limit); // aucun SMS de plus
    expect(store.abuse.filter((a) => a.kind === 'RATE_LIMITED')).toHaveLength(1);
    expect(store.abuse[0]).toMatchObject({ scope: 'otp_recipient', country });
    expect(logs).toContainEqual({ event: 'risk.rate_limited', scope: 'otp_recipient', country });
  });

  it('critère 1 : OTP au-delà de la limite par IP ⇒ RATE_LIMITED, aucun SMS', async () => {
    const { guard } = setup();
    const limit = paramValue(RATE_LIMIT_PARAMS.otpPerIp, country);
    let sent = 0;
    const send = () => Promise.resolve((sent += 1));
    for (let i = 0; i < limit; i += 1) {
      await guard.guardedSend({ channel: 'SMS_OTP', country, recipient: `${phone}${i}`, ip }, send);
    }
    const error = await refusal(
      guard.guardedSend({ channel: 'SMS_OTP', country, recipient: `${phone}x`, ip }, send),
    );
    expect(error.code).toBe('RATE_LIMITED');
    expect(sent).toBe(limit);
  });

  it('e-mail coûteux : limite par adresse (casse et espaces ignorés)', async () => {
    const { guard } = setup();
    const limit = paramValue(RATE_LIMIT_PARAMS.emailPerAddress, country);
    const req = (i: number): CostlySendRequest => ({
      channel: 'EMAIL',
      country,
      recipient: i % 2 === 0 ? email : ` ${email.toUpperCase()} `,
      ip: `203.0.113.${i}`,
    });
    for (let i = 0; i < limit; i += 1) await guard.checkCostlySend(req(i));
    expect((await refusal(guard.checkCostlySend(req(limit)))).code).toBe('RATE_LIMITED');
  });

  it('fail-closed : compteur indisponible ⇒ RATE_LIMIT_UNAVAILABLE (503), aucun envoi', async () => {
    const { guard, logs } = setup(failing);
    let sent = 0;
    const error = await refusal(
      guard.guardedSend({ channel: 'SMS_OTP', country, recipient: phone, ip }, () =>
        Promise.resolve((sent += 1)),
      ),
    );
    expect(error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(error.getStatus()).toBe(503);
    expect(sent).toBe(0);
    expect(logs).toContainEqual({ event: 'risk.limiter.unavailable', scope: 'otp', country });
  });

  it('plafond journalier SMS du pays atteint : un OTP de plus est refusé, aucun SMS', async () => {
    const store = new MemoryRateCounterStore();
    const { guard } = setup(store);
    const cap = paramValue(RATE_LIMIT_PARAMS.smsDailyCap, country);
    for (let i = 0; i < cap; i += 1) await store.reserveSms(country, cap, false);
    let sent = 0;
    const error = await refusal(
      guard.guardedSend({ channel: 'SMS_OTP', country, recipient: phone, ip }, () =>
        Promise.resolve((sent += 1)),
      ),
    );
    expect(error.code).toBe('RATE_LIMITED');
    expect(sent).toBe(0);
    expect(
      store.abuse.some((a) => a.kind === 'SMS_DAILY_CAP_REACHED' && a.country === country),
    ).toBe(true);
  });

  it('plafond SMS pour NTF : critique toujours accordé, non critique refusé, alerte une fois', async () => {
    const store = new MemoryRateCounterStore();
    const { guard } = setup(store);
    const cap = paramValue(RATE_LIMIT_PARAMS.smsDailyCap, country);
    for (let i = 0; i < cap; i += 1)
      expect((await guard.reserveSms(country, false)).allowed).toBe(true);
    expect(await guard.reserveSms(country, false)).toEqual({ allowed: false, alert: true });
    expect(await guard.reserveSms(country, false)).toEqual({ allowed: false, alert: false });
    expect(await guard.reserveSms(country, true)).toEqual({ allowed: true, alert: false });
  });

  it('routes : limite par IP du pays, puis 429 avec délai de reprise ; autre IP non affectée', async () => {
    const { guard } = setup();
    const limit = paramValue(RATE_LIMIT_PARAMS.searchPerIp, country);
    for (let i = 0; i < limit; i += 1) await guard.checkHttp('search', { ip }, country);
    const error = await refusal(guard.checkHttp('search', { ip }, country));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterS).toBeLessThanOrEqual(60);
    await expect(guard.checkHttp('search', { ip: '203.0.113.99' }, country)).resolves.toMatchObject(
      {
        allowed: true,
      },
    );
  });
});

describe('anti-abus : comportements transverses', () => {
  it('pays inconnu ou paramètre absent pour un envoi coûteux ⇒ RATE_LIMIT_UNAVAILABLE', async () => {
    const { guard } = setup();
    const error = await refusal(
      guard.checkCostlySend({ channel: 'EMAIL', country: 'ZZ', recipient: 'a@b.test', ip: null }),
    );
    expect(error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    const broken: RateLimitPolicy = {
      limit: () => {
        throw new Error('PARAM_MISSING');
      },
      isCountry: () => true,
    };
    const g = new AbuseGuard({
      store: new MemoryRateCounterStore(),
      hasher: HASHER,
      policy: broken,
      log: () => {},
    });
    expect(
      (
        await refusal(
          g.checkCostlySend({ channel: 'EMAIL', country: FIRST, recipient: 'a@b.test', ip: null }),
        )
      ).code,
    ).toBe('RATE_LIMIT_UNAVAILABLE');
  });

  it('routes : base indisponible ⇒ repli dégradé en mémoire, la limite tient toujours', async () => {
    const { guard, logs } = setup(failing);
    const limit = POLICY.limit('apiPerIp', null);
    for (let i = 0; i < limit; i += 1) await guard.checkHttp('api', { ip: '192.0.2.1' }, null);
    expect((await refusal(guard.checkHttp('api', { ip: '192.0.2.1' }, null))).code).toBe(
      'RATE_LIMITED',
    );
    expect(logs.some((l) => l.event === 'risk.limiter.degraded')).toBe(true);
  });

  it('limite sans pays : la plus stricte des pays déclarés', () => {
    for (const p of ['apiPerIp', 'searchPerIp', 'otpPerPhone'] as const) {
      const values = [...CONFIG.countries.keys()].map((c) => paramValue(RATE_LIMIT_PARAMS[p], c));
      expect(POLICY.limit(p, null)).toBe(Math.min(...values));
    }
    const weights = [...CONFIG.countries.keys()].map((c) =>
      paramValue(RATE_LIMIT_PARAMS.botWeight, c),
    );
    expect(POLICY.limit('botWeight', null)).toBe(Math.max(...weights));
  });

  it('chaque paramètre rate_limit_* existe pour chaque pays (registre CFG)', () => {
    for (const key of Object.values(RATE_LIMIT_PARAMS)) {
      for (const c of CONFIG.countries.keys()) expect(paramValue(key, c)).toBeGreaterThan(0);
    }
  });

  it('aucune donnée personnelle dans les clés de compteur ni dans les journaux', async () => {
    const store = new MemoryRateCounterStore();
    const { guard, logs } = setup(store);
    const phone = '+15550001234';
    for (let i = 0; i < 10; i += 1) {
      await guard
        .checkCostlySend({ channel: 'SMS_OTP', country: FIRST, recipient: phone, ip: '192.0.2.55' })
        .catch(() => undefined);
    }
    const dump = JSON.stringify({ abuse: store.abuse, logs });
    expect(dump).not.toContain('5550001234');
    expect(dump).not.toContain('192.0.2.55');
    expect(store.abuse.every((a) => /^[0-9a-f]{64}$/.test(a.keyHash))).toBe(true);
  });
});

/**
 * US-051 — rotation sans coupure de `RUEDA_RATE_LIMIT_KEY` (ADR-082, docs/ops/SECRET_ROTATION.md) :
 * pendant la rotation, une instance encore sur l'ancienne clé et une instance sur la nouvelle (qui
 * connaît l'ancienne) partagent le compteur ; la limite n'est jamais remise à zéro. Après le
 * retrait de l'ancienne clé, ses compteurs n'ont plus d'effet.
 */
describe.each(COUNTRIES)('rotation de la clé de débit en $country', ({ country, phone }) => {
  const OLD = Buffer.alloc(32, 7);
  const NEW = Buffer.alloc(32, 9);
  const guardWith = (store: RateCounterStore, hasher: RateKeyHasher) =>
    new AbuseGuard({ store, hasher, policy: POLICY, log: () => {} });

  it('instances ancienne et nouvelle clé : limite tenue sur l’ensemble, aucune remise à zéro', async () => {
    const store = new MemoryRateCounterStore(); // compteurs partagés (la base en production)
    const before = guardWith(store, new RateKeyHasher(OLD));
    const during = guardWith(store, new RateKeyHasher(NEW, OLD));
    expect(new RateKeyHasher(NEW, OLD).rotating).toBe(true);
    const limit = paramValue(RATE_LIMIT_PARAMS.otpPerPhone, country);
    const req = (i: number): CostlySendRequest => ({
      channel: 'SMS_OTP',
      country,
      recipient: phone,
      ip: `198.51.100.${i}`,
    });
    // la moitié de la limite consommée avant la rotation, sous l'ancienne clé seule
    const half = Math.floor(limit / 2);
    for (let i = 0; i < half; i += 1) await before.checkCostlySend(req(i));
    // le reste réparti entre une instance pas encore déployée et une instance déployée
    for (let i = half; i < limit; i += 1) {
      await (i % 2 === 0 ? before : during).checkCostlySend(req(i));
    }
    // au-delà : refus, quelle que soit l'instance (le compteur de l'ancienne clé est plein)
    expect((await refusal(during.checkCostlySend(req(limit)))).code).toBe('RATE_LIMITED');
    expect((await refusal(before.checkCostlySend(req(limit + 1)))).code).toBe('RATE_LIMITED');
  });

  it('après le retrait de l’ancienne clé : ses compteurs n’ont plus d’effet', async () => {
    const store = new MemoryRateCounterStore();
    const limit = paramValue(RATE_LIMIT_PARAMS.otpPerPhone, country);
    const old = guardWith(store, new RateKeyHasher(OLD));
    for (let i = 0; i < limit; i += 1) {
      await old.checkCostlySend({ channel: 'SMS_OTP', country, recipient: phone, ip: null });
    }
    const after = guardWith(store, new RateKeyHasher(NEW));
    expect(new RateKeyHasher(NEW).rotating).toBe(false);
    await expect(
      after.checkCostlySend({ channel: 'SMS_OTP', country, recipient: phone, ip: null }),
    ).resolves.toBeUndefined();
  });
});
