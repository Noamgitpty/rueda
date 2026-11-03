/**
 * Routes de la console interne côté IAM (préfixe `/staff`, US-012). Le back-office (domaine
 * distinct) les appelle par son mandataire de même origine ; le jeton reste dans le cookie
 * `__Host-session`. Corps d'erreur : `{ code, messageKey, values? }` (texte es / en / fr / pt côté client).
 *
 * | Route                                 | Garde        | Réponse                                         |
 * | ------------------------------------- | ------------ | ----------------------------------------------- |
 * | GET  /staff/me                        | session      | 200 `{ state, roles }` ; 401                     |
 * | POST /staff/mfa/enroll                | session      | 200 `{ secret, otpauthUri }` ; 400 ; 429 ; 503   |
 * | POST /staff/mfa/verify                | session      | 200 `{ state }` ; 400 AUTH_TOTP_INVALID ; 429    |
 * | POST /staff/members/:id/suspend       | StaffGuard   | 200 STAFF_ACTION_DONE ; 403 FORBIDDEN            |
 * | POST /staff/members/:id/reset-totp    | StaffGuard   | 200 `{ enrollmentCode }` (une fois) ; 403        |
 * | GET  /staff/audit?before=&limit=      | StaffGuard   | 200 `{ entries }` (audit.read, en base)          |
 */
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { readSessionToken } from '../cookies.js';
import { AuthHttpError, authBody } from '../errors.js';
import type { AuthBody } from '../errors.js';
import type { HttpRequest, HttpResponse } from '../http.js';
import { SessionGuard } from '../session.guard.js';
import { StaffGuard, staffPrincipalOf } from './staff.guard.js';
import { StaffAuthService } from './staff.service.js';
import type { StaffPrincipal } from './staff.service.js';
import type { AuditEntry, StaffRole } from './staff-store.js';

function body(request: HttpRequest): Record<string, unknown> {
  const b = request.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return b as Record<string, unknown>;
}

function principal(request: HttpRequest): StaffPrincipal {
  const p = staffPrincipalOf(request);
  if (p === null) throw new AuthHttpError('AUTH_REQUIRED');
  return p;
}

@Controller('staff')
export class StaffController {
  constructor(@Inject(StaffAuthService) private readonly staff: StaffAuthService) {}

  /** État d'accès : le back-office choisit l'écran (enrôlement, code, console, refus). */
  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() request: HttpRequest): Promise<{ state: string; roles: readonly StaffRole[] }> {
    this.staff.throttle(request.ip ?? null);
    const r = await this.staff.access(readSessionToken(request.headers['cookie']));
    if (r === null || r.access.outcome === 'AUTH_REQUIRED')
      throw new AuthHttpError('AUTH_REQUIRED');
    return { state: r.access.outcome, roles: r.access.roles };
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  enroll(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<{ secret: string; otpauthUri: string }> {
    response.setHeader('Cache-Control', 'no-store');
    this.staff.throttle(request.ip ?? null);
    return this.staff.enroll(
      readSessionToken(request.headers['cookie']),
      body(request)['enrollmentCode'],
      request.ip ?? null,
    );
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async verify(@Req() request: HttpRequest): Promise<{ state: 'ELEVATED' | 'ENROLLED' }> {
    const b = body(request);
    this.staff.throttle(request.ip ?? null);
    const state = await this.staff.verify(
      readSessionToken(request.headers['cookie']),
      { code: b['code'], enrollmentCode: b['enrollmentCode'] },
      request.ip ?? null,
    );
    return { state };
  }

  @Post('members/:id/suspend')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async suspend(@Req() request: HttpRequest, @Param('id') id: string): Promise<AuthBody> {
    await this.staff.suspend(principal(request), id, body(request)['reason']);
    return authBody('STAFF_ACTION_DONE');
  }

  @Post('members/:id/reset-totp')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  resetTotp(
    @Req() request: HttpRequest,
    @Param('id') id: string,
  ): Promise<{ enrollmentCode: string }> {
    return this.staff.resetTotp(principal(request), id, body(request)['reason']);
  }

  @Get('audit')
  @UseGuards(StaffGuard)
  async audit(
    @Req() request: HttpRequest,
    @Query('before') before: unknown,
    @Query('limit') limit: unknown,
  ): Promise<{ entries: AuditEntry[] }> {
    return { entries: await this.staff.audit(principal(request), before, limit) };
  }
}
