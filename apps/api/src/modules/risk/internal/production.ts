/**
 * Adaptateurs de PRODUCTION de l'anti-abus (US-052). Aucune option ne permet d'y brancher un
 * FAKE : compteurs en base (`PgRateCounterStore`), défi anti-robot indisponible tant qu'aucun
 * fournisseur n'est contracté (SUP-013 ; client soupçonné ⇒ refus), clé HMAC lue dans
 * `RUEDA_RATE_LIMIT_KEY` (absente en production ⇒ refus de démarrer), seuils lus dans la
 * configuration pays (CFG).
 */
import type { CountryConfig } from '../../cfg/index.js';
import { parseRuntimeEnvironment } from '../../cfg/index.js';
import { AbuseGuard } from './abuse-guard.js';
import { PgAbuseBoardStore } from './abuse-board.js';
import { UnavailableBotChallenge } from './bot-challenge.port.js';
import type { RiskSqlExecutor } from './counter-store.js';
import { PgRateCounterStore } from './counter-store.js';
import { parseRateLimitKey, RateKeyHasher } from './key-hasher.js';
import { configRateLimitPolicy } from './policy.js';
import type { RiskHttpOptions } from './risk-http.module.js';

export function postgresRiskAdapters(
  db: RiskSqlExecutor,
  env: Readonly<Record<string, string | undefined>>,
  config: CountryConfig,
): RiskHttpOptions {
  const production = parseRuntimeEnvironment(env['RUEDA_ENV']) === 'production';
  const guard = new AbuseGuard({
    store: new PgRateCounterStore(db),
    hasher: new RateKeyHasher(parseRateLimitKey(env['RUEDA_RATE_LIMIT_KEY'], production)),
    policy: configRateLimitPolicy(config),
  });
  return { guard, challenge: new UnavailableBotChallenge(), board: new PgAbuseBoardStore(db) };
}
