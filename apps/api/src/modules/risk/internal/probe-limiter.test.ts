/**
 * US-201 (BOARD N-78) — adaptateur `availabilityProbeLimiter` du port `AvailabilityProbeLimiter`
 * de CAT, testé directement (revues code n° 7 et qa n° 4 b du 2026-11-15) :
 * - sonde admise ⇒ `null` ;
 * - `RATE_LIMITED` de la garde ⇒ délai de reprise en secondes (celui de la garde, 60 à défaut :
 *   fenêtre d'une minute de `availability_probe_per_minute`, 17 §2.3 B7) ;
 * - toute autre erreur (compteur indisponible, autre refus de RISK) remonte telle quelle :
 *   l'appelant répond 503 `SEARCH_UNAVAILABLE` (fail-closed, ADR-127).
 * Pays et limite lus dans la configuration du dépôt (params.json), jamais codés en dur.
 */
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import { AbuseGuard } from './abuse-guard.js';
import { MemoryRateCounterStore } from './counter-store.js';
import type { HitResult } from './counter-store.js';
import { RiskHttpError } from './errors.js';
import { RateKeyHasher } from './key-hasher.js';
import { configRateLimitPolicy } from './policy.js';
import { availabilityProbeLimiter } from './probe-limiter.js';

const CONFIG = new CountryConfigService().config;
const COUNTRIES = [...CONFIG.countries.keys()];
const IP = '192.0.2.77';

/** Garde réduite à la seule méthode lue par l'adaptateur. */
const guardThat = (check: () => Promise<unknown>) => ({
  checkAvailabilityProbe: async (): Promise<HitResult> => {
    await check();
    return { allowed: true, hits: 1, retryAfterS: 0 };
  },
});

describe('availabilityProbeLimiter (adaptateur RISK du port de CAT)', () => {
  it('sonde admise ⇒ null', async () => {
    const limiter = availabilityProbeLimiter(guardThat(() => Promise.resolve()));
    await expect(limiter.hit(IP, 'ZZ')).resolves.toBeNull();
  });

  it('RATE_LIMITED avec délai ⇒ ce délai ; sans délai ⇒ 60 s', async () => {
    const withDelay = availabilityProbeLimiter(
      guardThat(() => Promise.reject(new RiskHttpError('RATE_LIMITED', 17))),
    );
    await expect(withDelay.hit(IP, 'ZZ')).resolves.toBe(17);
    const withoutDelay = availabilityProbeLimiter(
      guardThat(() => Promise.reject(new RiskHttpError('RATE_LIMITED'))),
    );
    await expect(withoutDelay.hit(IP, 'ZZ')).resolves.toBe(60);
  });

  it('toute autre erreur remonte (fail-closed : l’appelant répond indisponible)', async () => {
    const unavailable = new RiskHttpError('RATE_LIMIT_UNAVAILABLE');
    const other = new Error('panne du compteur');
    const bot = new RiskHttpError('BOT_CHALLENGE_REQUIRED');
    for (const error of [unavailable, other, bot]) {
      const limiter = availabilityProbeLimiter(guardThat(() => Promise.reject(error)));
      await expect(limiter.hit(IP, 'ZZ')).rejects.toBe(error);
    }
  });

  it.each(COUNTRIES)(
    '%s : avec la vraie garde, null jusqu’à availability_probe_per_minute du pays, puis un délai de 1 à 60 s',
    async (country) => {
      const v = CONFIG.values.find(
        (x) => x.key === 'availability_probe_per_minute' && x.country === country,
      );
      if (v === undefined || typeof v.value !== 'number') throw new Error('paramètre absent');
      // US-122 (ci-stable-3) : horloge FIXE au milieu d'une fenêtre d'une minute. À l'horloge
      // réelle, la boucle pouvait franchir une limite de fenêtre (fixe, alignée sur l'époque) :
      // compteur remis à zéro, la sonde de trop rendait null (run 44110961214).
      const now = Date.UTC(2032, 0, 1, 12, 0, 30);
      const guard = new AbuseGuard({
        store: new MemoryRateCounterStore(() => now),
        hasher: new RateKeyHasher(Buffer.alloc(32, 9)),
        policy: configRateLimitPolicy(CONFIG),
        log: () => {},
      });
      const limiter = availabilityProbeLimiter(guard);
      for (let i = 0; i < v.value; i += 1)
        await expect(limiter.hit(IP, country)).resolves.toBeNull();
      const delay = await limiter.hit(IP, country);
      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(60);
      expect(delay).toBe(30); // fin de la fenêtre courante, à l'horloge fixe
      // une autre IP n'est pas limitée
      await expect(limiter.hit('203.0.113.77', country)).resolves.toBeNull();
    },
  );
});
