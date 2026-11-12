/**
 * Routes de la vérification d'identité (US-105, ADR-100 ; 16 VER-001, VER-004 ; écran S04).
 * Routes de la personne gardées par `SessionGuard` (JSON exigé pour les écritures : parade CSRF) ;
 * la personne est celle de la session (empreinte du jeton). Rappels du fournisseur :
 * `kyc-webhook.controller.ts`.
 *
 * | Route                           | Réponse                                                         |
 * | ------------------------------- | --------------------------------------------------------------- |
 * | GET  /identity                  | 200 KYC_STATE (statut, consentement, pays) ; 400 ; 401 ; 503     |
 * | POST /identity/consent          | 200 KYC_CONSENT_RECORDED ; 400 ; 401 ; 403 ; 409 version ; 503   |
 * | POST /identity/verification     | 201 KYC_SESSION_STARTED ; 200 KYC_SESSION_IN_PROGRESS ; 400 ;    |
 * |                                 | 401 ; 403 KYC_BIOMETRIC_CONSENT_MISSING, PHONE_NOT_VERIFIED,     |
 * |                                 | KYC_NOT_ELIGIBLE ; 409 KYC_IN_REVIEW, KYC_ALREADY_APPROVED ;     |
 * |                                 | 422 KYC_DOCUMENT_UNSUPPORTED ; 502 KYC_SESSION_FAILED ;          |
 * |                                 | 503 KYC_PROVIDER_UNAVAILABLE                                     |
 */
import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import { kycBody } from './errors.js';
import type { KycBody } from './errors.js';
import type { IdentityStateView, IdentityVerificationService } from './identity.service.js';
import { KYC_IDENTITY_SERVICE } from './tokens.js';

interface KycRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface StatusResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

const header = (request: KycRequest, name: string): string | undefined => {
  const v = request.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Langue de la vue (en-tête `Accept-Language`, première étiquette) pour le parcours hébergé. */
function localeOf(request: KycRequest): string {
  const raw = header(request, 'accept-language') ?? '';
  const first = raw.split(',')[0]?.split(';')[0]?.trim() ?? '';
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(first) ? first : 'es';
}

@Controller('identity')
@UseGuards(SessionGuard)
export class IdentityController {
  constructor(
    @Inject(KYC_IDENTITY_SERVICE) private readonly identity: IdentityVerificationService,
  ) {}

  @Get()
  async state(
    @Req() request: KycRequest,
    @Query('country') country: unknown,
  ): Promise<IdentityStateView> {
    return this.identity.state(sessionProofOf(request), country);
  }

  @Post('consent')
  @HttpCode(200)
  async consent(
    @Req() request: KycRequest,
  ): Promise<KycBody & { readonly version: number | null }> {
    const r = await this.identity.consent(sessionProofOf(request), request.body);
    return { ...kycBody('KYC_CONSENT_RECORDED'), version: r.version };
  }

  @Post('verification')
  @HttpCode(201)
  async start(
    @Req() request: KycRequest,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<KycBody & { readonly hostedUrl: string; readonly expiresAt: string }> {
    const s = await this.identity.start(sessionProofOf(request), request.body, localeOf(request));
    if (s.code === 'KYC_SESSION_IN_PROGRESS') response.status(200);
    return { ...kycBody(s.code), hostedUrl: s.hostedUrl, expiresAt: s.expiresAt };
  }
}
