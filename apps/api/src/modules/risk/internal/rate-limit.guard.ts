/**
 * Garde GLOBAL de l'API (US-052, critères 3 et 4) : avant toute autre garde et tout appel métier.
 *
 * 1. Portée de la route (préfixe du chemin) : `/webhooks` ⇒ `webhook` (limite large, corps borné
 *    par Express, 17 §6.6) ; `/search` ⇒ `search` ; `/quote` ou `/quotes` ⇒ `quote` ; sinon `api`.
 *    Pays : `?country=XX` s'il est déclaré, sinon limite la plus stricte des pays.
 * 2. Heuristiques anti-robot (hors webhooks) : en-têtes de navigateur, rythme régulier,
 *    inscriptions en rafale (`POST /auth/signup`). Un signal ⇒ requête comptée
 *    `rate_limit_bot_weight` fois (client ralenti) ; défi exigé ⇒ jeton `X-Bot-Challenge` vérifié
 *    par le port anti-robot, sinon 403 `BOT_CHALLENGE_REQUIRED`. Chaque soupçon est journalisé
 *    (tableau de sécurité).
 * 3. Limite par IP (`request.ip`, donc `trust proxy` : un `X-Forwarded-For` forgé est ignoré tant
 *    que `RUEDA_API_TRUST_PROXY` est absente) : au-delà ⇒ 429 `RATE_LIMITED` et `Retry-After`.
 *    Les compteurs sont par client : un client limité n'affecte pas les autres.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AbuseGuard } from './abuse-guard.js';
import type { HttpScope } from './abuse-guard.js';
import { CHALLENGE_HEADER } from './bot-challenge.port.js';
import type { BotChallengePort } from './bot-challenge.port.js';
import { decide, lacksBrowserHeaders } from './bot-heuristics.js';
import type { RhythmTracker } from './bot-heuristics.js';
import type { BotSignal } from './counter-store.js';
import { RiskHttpError } from './errors.js';
import { BOT_CHALLENGE, RHYTHM_TRACKER } from './tokens.js';

export interface RiskHttpRequest {
  readonly ip?: string | undefined;
  readonly method: string;
  readonly path?: string;
  readonly url?: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface RiskHttpResponse {
  setHeader(name: string, value: string): unknown;
}

/** Portée d'une route, par préfixe de chemin (sans la chaîne de requête). */
export function scopeOf(path: string): HttpScope {
  const p = path.split('?')[0]?.toLowerCase() ?? '';
  const first = p.split('/').filter((s) => s !== '')[0] ?? '';
  if (first === 'webhooks') return 'webhook';
  if (first === 'search') return 'search';
  if (first === 'quote' || first === 'quotes') return 'quote';
  return 'api';
}

/** IP retenue pour le comptage : `request.ip` (jamais un en-tête lu directement). */
export function clientIp(request: RiskHttpRequest): string {
  return request.ip ?? 'unknown';
}

export function countryOf(
  request: RiskHttpRequest,
  isCountry: (c: string) => boolean,
): string | null {
  const raw = request.query?.['country'];
  return typeof raw === 'string' && /^[A-Z]{2}$/.test(raw) && isCountry(raw) ? raw : null;
}

const SIGNUP_PATH = /^\/auth\/signup\/?$/i;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(AbuseGuard) private readonly abuse: AbuseGuard,
    @Inject(BOT_CHALLENGE) private readonly challenge: BotChallengePort,
    @Inject(RHYTHM_TRACKER) private readonly rhythm: Pick<RhythmTracker, 'record'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<RiskHttpRequest>();
    const response = http.getResponse<RiskHttpResponse>();
    const path = request.path ?? request.url ?? '/';
    const scope = scopeOf(path);
    const ip = clientIp(request);
    const country = countryOf(request, (c) => this.abuse.policy.isCountry(c));

    let weight = 1;
    if (scope !== 'webhook') {
      const signals: BotSignal[] = [];
      if (lacksBrowserHeaders(request.headers)) signals.push('NO_BROWSER_HEADERS');
      const ipKey = this.abuse.hasher.hash('ip', ip).toString('hex');
      if (this.rhythm.record(ipKey, Date.now())) signals.push('REGULAR_RHYTHM');
      if (request.method === 'POST' && SIGNUP_PATH.test(path.split('?')[0] ?? '')) {
        if (await this.abuse.signupBurst(ip, country)) signals.push('SIGNUP_BURST');
      }
      const decision = decide(signals);
      if (decision === 'SLOW') {
        weight = this.abuse.policy.limit('botWeight', country);
        await this.abuse.recordBot('BOT_SUSPECTED', scope, ip, country, signals);
      } else if (decision === 'CHALLENGE') {
        await this.abuse.recordBot('BOT_CHALLENGED', scope, ip, country, signals);
        const raw = request.headers[CHALLENGE_HEADER];
        const token = Array.isArray(raw) ? raw[0] : raw;
        const outcome =
          typeof token === 'string' && token !== '' && token.length <= 4096
            ? await this.challenge.verify(token, ipKey)
            : 'FAILED';
        if (outcome !== 'PASSED') throw new RiskHttpError('BOT_CHALLENGE_REQUIRED');
        weight = this.abuse.policy.limit('botWeight', country);
      }
    }

    try {
      await this.abuse.checkHttp(scope, { ip }, country, weight);
    } catch (error) {
      if (error instanceof RiskHttpError && error.retryAfterS !== null) {
        response.setHeader('Retry-After', String(error.retryAfterS));
      }
      throw error;
    }
    return true;
  }
}
