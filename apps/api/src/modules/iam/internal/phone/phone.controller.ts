/**
 * Vérification du téléphone par OTP (US-104, ADR-098 ; 16 VER-013 ; 19 US-104). Routes gardées
 * par `SessionGuard` (JSON exigé pour les écritures : parade CSRF). La personne est celle de la
 * session (empreinte du jeton) ; la base juge tout (durée de vie, essais, blocage, renvoi, numéro
 * vérifié ailleurs), avec les paramètres du pays.
 *
 * | Route              | Réponse                                                                  |
 * | ------------------ | ------------------------------------------------------------------------ |
 * | GET  /phone        | 200 état : numéro vérifié (masqué), code en attente, blocage ; 401        |
 * | POST /phone/otp    | 202 OTP_SENT (numéro libre ou déjà vérifié ailleurs : réponse identique) ; |
 * |                    | 200 PHONE_ALREADY_VERIFIED ; 400 REQUEST_INVALID, COUNTRY_UNKNOWN,        |
 * |                    | PHONE_INVALID ; 401 ; 403 PHONE_NOT_ELIGIBLE ; 429 OTP_LOCKED,            |
 * |                    | RATE_LIMITED ; 503 OTP_UNAVAILABLE, RATE_LIMIT_UNAVAILABLE               |
 * | POST /phone/verify | 200 PHONE_VERIFIED ; 400 REQUEST_INVALID, OTP_INVALID, OTP_EXPIRED ; 401 ; |
 * |                    | 409 ACCOUNT_DUPLICATE_PHONE ; 429 OTP_LOCKED ; 503 OTP_UNAVAILABLE         |
 *
 * Le code part par SMS de façon ASYNCHRONE (travailleur `iam_otp_sender`) : `OTP_SENT` dit que la
 * demande est acceptée, jamais que le SMS est remis.
 */
import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthHttpError, authBody } from '../errors.js';
import type { AuthBody } from '../errors.js';
import { principalOf } from '../http.js';
import type { HttpRequest, HttpResponse } from '../http.js';
import { sessionProofOf } from '../session-proof.js';
import { SessionGuard } from '../session.guard.js';
import { IAM_PHONE_VERIFICATION } from '../tokens.js';
import type { PhoneStateView, PhoneVerificationService } from './phone-verification.service.js';

function requireJson(request: HttpRequest): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

@Controller('phone')
@UseGuards(SessionGuard)
export class PhoneController {
  constructor(@Inject(IAM_PHONE_VERIFICATION) private readonly phone: PhoneVerificationService) {}

  @Get()
  async state(@Req() request: HttpRequest): Promise<PhoneStateView> {
    return this.phone.state(sessionProofOf(request));
  }

  @Post('otp')
  @HttpCode(202)
  async request(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: { status(code: number): unknown } & HttpResponse,
  ): Promise<AuthBody> {
    const body = requireJson(request);
    const principal = principalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    try {
      const sent = await this.phone.request(
        sessionProofOf(request),
        principal,
        body,
        request.ip ?? null,
      );
      return authBody('OTP_SENT', {
        phone: sent.phone,
        resendAfterS: sent.resendAfterS,
        expiresInS: sent.expiresInS,
      });
    } catch (error) {
      // numéro déjà vérifié sur CE compte : succès sans envoi (200), pas une erreur
      if (error instanceof AuthHttpError && error.code === 'PHONE_ALREADY_VERIFIED') {
        response.status(200);
        return authBody('PHONE_ALREADY_VERIFIED');
      }
      throw error;
    }
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Req() request: HttpRequest): Promise<AuthBody> {
    await this.phone.verify(sessionProofOf(request), requireJson(request));
    return authBody('PHONE_VERIFIED');
  }
}
