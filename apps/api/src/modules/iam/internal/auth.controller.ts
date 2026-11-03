/**
 * Routes HTTP de l'authentification (préfixe `/auth`). Corps de réponse : `{ code, messageKey }`
 * (clé du catalogue @rueda/i18n, texte es / en / fr côté client). Jamais de jeton dans un corps :
 * le jeton de session ne voyage que dans le cookie `__Host-session`.
 *
 * | Route                     | Réponse                                                          |
 * | ------------------------- | ---------------------------------------------------------------- |
 * | POST /auth/signup         | 202 SIGNUP_ACCEPTED (email libre ou déjà pris : réponse identique) |
 * | POST /auth/login          | 200 + Set-Cookie ; 401 AUTH_INVALID_CREDENTIALS ; 429 RATE_LIMITED |
 * | GET  /auth/session        | 200 principal ; 401 AUTH_REQUIRED (absente, expirée, révoquée)     |
 * | POST /auth/logout         | 204 + cookie effacé (idempotent)                                   |
 * | POST /auth/logout-all     | 204 + cookie effacé ; 401 AUTH_REQUIRED                            |
 * | POST /auth/verify-email   | 200 EMAIL_VERIFIED ; 400 AUTH_LINK_EXPIRED                         |
 */
import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { JsonWriteGuard } from './csrf.guard.js';
import { AuthService } from './auth.service.js';
import type { RequestContext } from './auth.service.js';
import { clearedSessionCookie, readSessionToken, sessionCookie } from './cookies.js';
import { AuthHttpError, authBody } from './errors.js';
import type { AuthBody } from './errors.js';
import { headerValue, principalOf } from './http.js';
import type { HttpRequest, HttpResponse } from './http.js';
import { SessionGuard } from './session.guard.js';
import { IAM_CLOCK } from './tokens.js';
import type { Clock } from './tokens.js';

/** Corps JSON objet (le Content-Type est contrôlé par JsonWriteGuard / SessionGuard). */
function requireJson(request: HttpRequest): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function contextOf(request: HttpRequest): RequestContext {
  return { ip: request.ip ?? null, userAgent: headerValue(request, 'user-agent') };
}

@Controller('auth')
@UseGuards(JsonWriteGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(IAM_CLOCK) private readonly clock: Clock,
  ) {}

  @Post('signup')
  @HttpCode(202)
  async signup(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<AuthBody> {
    const body = requireJson(request);
    response.setHeader('Cache-Control', 'no-store');
    await this.auth.signup(
      {
        email: body['email'],
        password: body['password'],
        legalFirstName: body['legalFirstName'],
        legalLastName: body['legalLastName'],
        locale: body['locale'],
        termsAccepted: body['termsAccepted'],
      },
      contextOf(request),
    );
    return authBody('SIGNUP_ACCEPTED');
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<{ expiresAt: string }> {
    const body = requireJson(request);
    response.setHeader('Cache-Control', 'no-store');
    const session = await this.auth.login(
      { email: body['email'], password: body['password'] },
      contextOf(request),
      readSessionToken(request.headers['cookie']),
    );
    const maxAgeS = (session.expiresAt.getTime() - this.clock()) / 1000;
    response.setHeader('Set-Cookie', sessionCookie(session.token, maxAgeS));
    return { expiresAt: session.expiresAt.toISOString() };
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@Req() request: HttpRequest): {
    userId: string;
    mfaLevel: string;
    expiresAt: string;
    emailVerified: boolean;
  } {
    const principal = principalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    return {
      userId: principal.userId,
      mfaLevel: principal.mfaLevel,
      expiresAt: principal.expiresAt.toISOString(),
      emailVerified: principal.emailVerified,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    // révoquer D'ABORD : si la base échoue (500), le cookie reste et la session aussi, sans
    // faire croire à une déconnexion
    await this.auth.logout(readSessionToken(request.headers['cookie']));
    response.setHeader('Set-Cookie', clearedSessionCookie());
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    await this.auth.logoutAll(readSessionToken(request.headers['cookie']));
    response.setHeader('Set-Cookie', clearedSessionCookie());
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<AuthBody> {
    const body = requireJson(request);
    response.setHeader('Cache-Control', 'no-store');
    await this.auth.verifyEmail(body['token']);
    return authBody('EMAIL_VERIFIED');
  }
}
