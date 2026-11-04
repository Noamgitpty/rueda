/**
 * Service anti-abus (US-052 ; 17 §6.6 « Limitation de débit » ; ADR-075).
 *
 * 1. Envois COÛTEUX (OTP par SMS, e-mail) — `checkCostlySend` / `guardedSend` :
 *    - limite par destinataire (numéro ou adresse) ET par IP, à l'heure, paramètres du pays ;
 *    - un OTP par SMS réserve ensuite une unité du plafond journalier SMS du pays ;
 *    - dépassement ⇒ `RATE_LIMITED` (429, délai de reprise), AUCUN envoi, refus journalisé en
 *      base (`risk_abuse_event`). Distinct d'`OTP_LOCKED` (échecs de saisie, VER-013) ;
 *    - compteur ou paramètre indisponible ⇒ `RATE_LIMIT_UNAVAILABLE` (503), AUCUN envoi
 *      (fail-closed : une facture SMS ne se rattrape pas).
 * 2. Plafond journalier SMS par pays — `reserveSms` (port `SmsBudget` de NTF) : un message
 *    critique de trip est toujours accordé ; un non critique est refusé une fois le plafond
 *    atteint (NTF le bascule sur l'e-mail, ou le refuse s'il était déjà un repli) ; alerte au
 *    premier refus du jour.
 * 3. Routes HTTP — `checkHttp` : limite par IP (garde global) et par compte (intercepteur), par
 *    portée (`api`, `search`, `quote`, `webhook`). Compteur indisponible ⇒ REPLI DÉGRADÉ sur un
 *    compteur en mémoire du processus (même seuil ; la route reste protégée, sans partage entre
 *    instances), journalisé `risk.limiter.degraded`.
 *
 * Journaux : genre, portée, pays et issue seulement ; jamais une empreinte, une IP, un numéro ni
 * une adresse (17 §6.3).
 */
import { RiskHttpError } from './errors.js';
import type { RateCounterStore, HitResult, BotSignal, AbuseKind } from './counter-store.js';
import { CounterUnavailableError, MemoryRateCounterStore } from './counter-store.js';
import type { RateKeyHasher } from './key-hasher.js';
import type { RateLimitParam, RateLimitPolicy } from './policy.js';
import { WINDOWS } from './policy.js';

export type CostlyChannel = 'SMS_OTP' | 'EMAIL';

export interface CostlySendRequest {
  readonly channel: CostlyChannel;
  /** Pays de l'envoi (paramètres) : obligatoire, aucune limite « globale » pour un envoi coûteux. */
  readonly country: string;
  /** Numéro E.164 (SMS_OTP) ou adresse e-mail (EMAIL), haché avant tout comptage. */
  readonly recipient: string;
  /** IP du client (`request.ip`, réglée par `trust proxy`) ; `null` hors requête HTTP. */
  readonly ip: string | null;
}

export type HttpScope = 'api' | 'search' | 'quote' | 'webhook';

export interface RiskLogEntry {
  readonly event:
    | 'risk.rate_limited'
    | 'risk.limiter.unavailable'
    | 'risk.limiter.degraded'
    | 'risk.bot.suspected'
    | 'risk.sms_cap.reached';
  readonly scope: string;
  readonly country: string | null;
  readonly code?: string;
}

export interface AbuseGuardDeps {
  readonly store: RateCounterStore;
  readonly hasher: RateKeyHasher;
  readonly policy: RateLimitPolicy;
  /** Repli dégradé des routes peu coûteuses (défaut : compteur en mémoire du processus). */
  readonly fallback?: RateCounterStore;
  readonly log?: (entry: RiskLogEntry) => void;
}

const IP_PARAM: Readonly<Record<HttpScope, RateLimitParam>> = {
  api: 'apiPerIp',
  search: 'searchPerIp',
  quote: 'quotePerIp',
  webhook: 'webhookPerIp',
};
const ACCOUNT_PARAM: Readonly<Record<Exclude<HttpScope, 'webhook'>, RateLimitParam>> = {
  api: 'apiPerAccount',
  search: 'searchPerAccount',
  quote: 'quotePerAccount',
};

export class AbuseGuard {
  readonly #store: RateCounterStore;
  readonly #fallback: RateCounterStore;
  readonly #hasher: RateKeyHasher;
  readonly #policy: RateLimitPolicy;
  readonly #log: (entry: RiskLogEntry) => void;

  constructor(deps: AbuseGuardDeps) {
    this.#store = deps.store;
    this.#fallback = deps.fallback ?? new MemoryRateCounterStore();
    this.#hasher = deps.hasher;
    this.#policy = deps.policy;
    this.#log = deps.log ?? defaultLog;
  }

  get policy(): RateLimitPolicy {
    return this.#policy;
  }

  get hasher(): RateKeyHasher {
    return this.#hasher;
  }

  /** Contrôle un envoi coûteux ; lève `RATE_LIMITED` ou `RATE_LIMIT_UNAVAILABLE`. */
  async checkCostlySend(req: CostlySendRequest): Promise<void> {
    const sms = req.channel === 'SMS_OTP';
    const scopeBase = sms ? 'otp' : 'email';
    let limits: { recipient: number; ip: number; cap: number | null };
    try {
      if (!this.#policy.isCountry(req.country)) throw new Error('pays inconnu');
      limits = {
        recipient: this.#policy.limit(sms ? 'otpPerPhone' : 'emailPerAddress', req.country),
        ip: this.#policy.limit(sms ? 'otpPerIp' : 'emailPerIp', req.country),
        cap: sms ? this.#policy.limit('smsDailyCap', req.country) : null,
      };
    } catch {
      this.#log({ event: 'risk.limiter.unavailable', scope: scopeBase, country: req.country });
      throw new RiskHttpError('RATE_LIMIT_UNAVAILABLE');
    }
    const checks: { scope: string; key: Buffer; limit: number }[] = [
      {
        scope: `${scopeBase}_recipient`,
        key: this.#hasher.hash(sms ? 'phone' : 'email', req.recipient),
        limit: limits.recipient,
      },
    ];
    if (req.ip !== null) {
      checks.push({
        scope: `${scopeBase}_ip`,
        key: this.#hasher.hash('ip', req.ip),
        limit: limits.ip,
      });
    }
    try {
      for (const c of checks) {
        const r = await this.#store.hit({
          scope: c.scope,
          keyHash: c.key,
          country: req.country,
          limit: c.limit,
          windowS: WINDOWS[sms ? 'otpPerPhone' : 'emailPerAddress'],
          weight: 1,
        });
        if (!r.allowed) {
          this.#log({ event: 'risk.rate_limited', scope: c.scope, country: req.country });
          throw new RiskHttpError('RATE_LIMITED', r.retryAfterS);
        }
      }
      if (limits.cap !== null) {
        const s = await this.#store.reserveSms(req.country, limits.cap, false);
        if (!s.allowed) {
          this.#log({
            event: 'risk.sms_cap.reached',
            scope: 'sms_country_day',
            country: req.country,
          });
          throw new RiskHttpError('RATE_LIMITED', secondsToNextUtcDay());
        }
      }
    } catch (error) {
      if (error instanceof RiskHttpError) throw error;
      this.#log({ event: 'risk.limiter.unavailable', scope: scopeBase, country: req.country });
      throw new RiskHttpError('RATE_LIMIT_UNAVAILABLE');
    }
  }

  /** N'appelle `send` que si l'envoi est permis (aucun SMS ni e-mail après un refus). */
  async guardedSend<T>(req: CostlySendRequest, send: () => Promise<T>): Promise<T> {
    await this.checkCostlySend(req);
    return send();
  }

  /**
   * Plafond SMS du pays pour une notification (port `SmsBudget` de NTF). Lève
   * `CounterUnavailableError` si le compteur ou le paramètre manque : NTF n'envoie pas.
   */
  async reserveSms(
    country: string,
    critical: boolean,
  ): Promise<{ allowed: boolean; alert: boolean }> {
    let cap: number;
    try {
      cap = this.#policy.limit('smsDailyCap', country);
    } catch (error) {
      throw new CounterUnavailableError(error);
    }
    const r = await this.#store.reserveSms(country, cap, critical);
    if (!r.allowed) {
      this.#log({ event: 'risk.sms_cap.reached', scope: 'sms_country_day', country });
    }
    return { allowed: r.allowed, alert: r.alert };
  }

  /**
   * Limite d'une route par IP (`account` = null) ou par compte. Rend le résultat ; lève
   * `RATE_LIMITED` au-delà. Compteur indisponible : repli dégradé en mémoire.
   */
  async checkHttp(
    scope: HttpScope,
    subject: { ip: string } | { account: string },
    country: string | null,
    weight = 1,
  ): Promise<HitResult> {
    const byIp = 'ip' in subject;
    const param = byIp ? IP_PARAM[scope] : ACCOUNT_PARAM[scope as Exclude<HttpScope, 'webhook'>];
    const input = {
      scope: byIp ? `${scope}_ip` : `${scope}_account`,
      keyHash: byIp
        ? this.#hasher.hash('ip', subject.ip)
        : this.#hasher.hash('account', subject.account),
      country,
      limit: this.#policy.limit(param, country),
      windowS: WINDOWS[param],
      weight,
    };
    let r: HitResult;
    try {
      r = await this.#store.hit(input);
    } catch {
      this.#log({ event: 'risk.limiter.degraded', scope: input.scope, country });
      r = await this.#fallback.hit(input);
    }
    if (!r.allowed) {
      this.#log({ event: 'risk.rate_limited', scope: input.scope, country });
      throw new RiskHttpError('RATE_LIMITED', r.retryAfterS);
    }
    return r;
  }

  /** Compte une inscription de l'IP ; rend `true` si la rafale dépasse le seuil du pays. */
  async signupBurst(ip: string, country: string | null): Promise<boolean> {
    const input = {
      scope: 'signup_burst_ip',
      keyHash: this.#hasher.hash('ip', ip),
      country,
      limit: this.#policy.limit('signupBurstPerIp', country),
      windowS: WINDOWS.signupBurstPerIp,
      weight: 1,
    };
    try {
      return !(await this.#store.hit(input)).allowed;
    } catch {
      this.#log({ event: 'risk.limiter.degraded', scope: input.scope, country });
      return !(await this.#fallback.hit(input)).allowed;
    }
  }

  /** Journal agrégé d'un soupçon de robot ; une base indisponible n'interrompt pas la requête. */
  async recordBot(
    kind: AbuseKind,
    scope: HttpScope,
    ip: string,
    country: string | null,
    signals: readonly BotSignal[],
  ): Promise<void> {
    this.#log({ event: 'risk.bot.suspected', scope, country, code: kind });
    try {
      await this.#store.recordAbuse(kind, scope, this.#hasher.hash('ip', ip), country, signals);
    } catch {
      this.#log({ event: 'risk.limiter.degraded', scope, country, code: kind });
    }
  }
}

/** Délai de reprise d'un plafond journalier : jusqu'au prochain minuit UTC (borne haute). */
function secondsToNextUtcDay(): number {
  const now = Date.now();
  const day = 86_400_000;
  return Math.max(1, Math.ceil((Math.floor(now / day) * day + day - now) / 1000));
}

/** Journal par défaut : une ligne JSON sans donnée personnelle. */
function defaultLog(entry: RiskLogEntry): void {
  console.warn(JSON.stringify(entry));
}
