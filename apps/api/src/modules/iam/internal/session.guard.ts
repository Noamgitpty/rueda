/**
 * Garde Nest des routes authentifiées (exportée par `index.ts` pour tous les modules) : le cookie
 * `__Host-session` doit désigner une session ni révoquée ni expirée, sinon 401 `AUTH_REQUIRED`
 * (critère 2 de US-010). Le principal est ensuite lu par `principalOf(request)`. Toute écriture
 * gardée exige aussi du JSON (parade CSRF commune, `csrf.guard.ts`), contrôlée AVANT la session.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticationPort } from './auth.service.js';
import { readSessionToken } from './cookies.js';
import { assertJsonWrite } from './csrf.guard.js';
import { AuthHttpError } from './errors.js';
import { setPrincipal } from './http.js';
import type { HttpRequest, HttpResponse } from './http.js';
import { AUTHENTICATION_PORT } from './tokens.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTHENTICATION_PORT) private readonly auth: AuthenticationPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    assertJsonWrite(request);
    // une réponse authentifiée n'est jamais mise en cache
    http.getResponse<HttpResponse>().setHeader('Cache-Control', 'no-store');
    const principal = await this.auth.resolveSession(readSessionToken(request.headers['cookie']));
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    setPrincipal(request, principal);
    return true;
  }
}
