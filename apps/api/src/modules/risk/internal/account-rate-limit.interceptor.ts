/**
 * Limite PAR COMPTE (US-052, critère 3 ; 17 §6.6) : intercepteur global, exécuté APRÈS les gardes,
 * donc après `SessionGuard` qui pose le principal. Une route sans session n'est limitée que par IP
 * (garde global). Au-delà ⇒ 429 `RATE_LIMITED` et `Retry-After`. Webhooks exclus (aucun compte).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { from, switchMap } from 'rxjs';
import { principalOf } from '../../iam/index.js';
import { AbuseGuard } from './abuse-guard.js';
import { RiskHttpError } from './errors.js';
import { countryOf, scopeOf } from './rate-limit.guard.js';
import type { RiskHttpRequest, RiskHttpResponse } from './rate-limit.guard.js';

@Injectable()
export class AccountRateLimitInterceptor implements NestInterceptor {
  constructor(@Inject(AbuseGuard) private readonly abuse: AbuseGuard) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<RiskHttpRequest>();
    const principal = principalOf(request);
    const scope = scopeOf(request.path ?? request.url ?? '/');
    if (principal === null || scope === 'webhook') return next.handle();
    const country = countryOf(request, (c) => this.abuse.policy.isCountry(c));
    const check = this.abuse
      .checkHttp(scope, { account: principal.userId }, country)
      .catch((error: unknown) => {
        if (error instanceof RiskHttpError && error.retryAfterS !== null) {
          http.getResponse<RiskHttpResponse>().setHeader('Retry-After', String(error.retryAfterS));
        }
        throw error;
      });
    return from(check).pipe(switchMap(() => next.handle()));
  }
}
