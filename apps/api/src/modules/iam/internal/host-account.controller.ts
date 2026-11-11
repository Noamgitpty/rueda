/**
 * Compte d'hôte d'une personne physique (US-107, ADR-096 ; 19 US-107, 17 §2.3, §3.2.1). Route
 * gardée par `SessionGuard` (JSON exigé : parade CSRF). La personne est celle de la session
 * (empreinte du jeton, jamais un identifiant reçu du client) ; la base juge tout (personne
 * physique, compte vérifié, âge du pays, un compte par pays).
 *
 * | Route                | Réponse                                                                |
 * | -------------------- | ---------------------------------------------------------------------- |
 * | POST /host/accounts  | 201 HOST_ACCOUNT_OPENED + `orgId` ; 400 REQUEST_INVALID, COUNTRY_UNKNOWN ; |
 * |                      | 401 ; 403 HOST_ACCOUNT_NOT_ELIGIBLE ; 409 HOST_ACCOUNT_EXISTS ;          |
 * |                      | 422 HOST_ENTITY_NOT_ALLOWED, HOST_UNDER_AGE ; 503 HOST_ACCOUNT_UNAVAILABLE |
 *
 * Le compte s'ouvre `ONBOARDING` : il ne publie ni ne reçoit de réservation avant son activation
 * (vérification de l'hôte, US-123 ; interrupteurs du pays). Les comptes de la personne et ses rôles
 * sont rendus par `GET /auth/session`.
 */
import { Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthHttpError, authBody } from './errors.js';
import type { AuthBody } from './errors.js';
import type { HttpRequest } from './http.js';
import { sessionProofOf } from './session-proof.js';
import { SessionGuard } from './session.guard.js';

@Controller('host')
export class HostAccountController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('accounts')
  @HttpCode(201)
  @UseGuards(SessionGuard)
  async open(@Req() request: HttpRequest): Promise<AuthBody & { orgId: string }> {
    const body = request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const orgId = await this.auth.openHostAccount(
      sessionProofOf(request),
      body as Record<string, unknown>,
    );
    return { ...authBody('HOST_ACCOUNT_OPENED'), orgId };
  }
}
