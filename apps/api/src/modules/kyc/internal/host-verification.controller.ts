/**
 * Routes de la vérification de l'hôte (US-123, ADR-105 ; 16 HST-049 / FIN-008 / VER-028 ; écran
 * A07). Gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) ; l'hôte est celui
 * de la session (empreinte du jeton), le compte d'hôte `{orgId}` l'un de ses comptes titulaires,
 * revérifié en base. Un compte d'un autre hôte rend 404 comme un compte inconnu (17 §2.3 point 5,
 * L1-PM-11). Corps d'erreur `{ code, messageKey }` ; réponses `Cache-Control: no-store`.
 *
 * | Route                                                | Réponse                                         |
 * | ---------------------------------------------------- | ----------------------------------------------- |
 * | GET  /host/accounts/{orgId}/verification             | 200 HOST_VERIFICATION_STATE ; 401 ; 404 ; 503   |
 * | POST /host/accounts/{orgId}/verification             | 200 HOST_VERIFICATION_SUBMITTED ; 401 ; 403     |
 * |                                                      | HOST_KYC_REQUIRED, HOST_UNDER_AGE,              |
 * |                                                      | HOST_AGE_UNVERIFIED, HOST_RESIDENCE_MISMATCH ;  |
 * |                                                      | 404 ; 409 HOST_ACCOUNT_NOT_ELIGIBLE ; 503       |
 * | POST /host/accounts/{orgId}/verification/tax-profile | 200 HOST_TAX_PROFILE_SAVED ; 400 ; 401 ; 404 ;  |
 * |                                                      | 409 HOST_VERIFICATION_LOCKED ; 422              |
 * |                                                      | HOST_ENTITY_NOT_ALLOWED, HOST_TAX_ID_INVALID,   |
 * |                                                      | HOST_TAX_ID_KIND_INVALID ; 503                  |
 *
 * La décision de l'ops et l'activation passent par la console (`HOST_VERIFICATION_DECISION`,
 * cadre d'US-101), jamais par ces routes ; aucun interrupteur n'est modifiable ici (17 §0.1).
 */
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import { KycHttpError } from './errors.js';
import type { HostVerificationService, HostVerificationView } from './host-verification.service.js';
import { KYC_HOST_VERIFICATION_SERVICE } from './tokens.js';

interface HostRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface HostResponse {
  setHeader(name: string, value: string): unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Identifiant de compte d'hôte mal formé ⇒ 404, comme un compte inconnu. */
function orgOf(orgId: string): string {
  if (!UUID.test(orgId)) throw new KycHttpError('HOST_ACCOUNT_NOT_FOUND');
  return orgId;
}

function proofOf(request: HostRequest): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
  return proof;
}

@Controller('host')
@UseGuards(SessionGuard)
export class HostVerificationController {
  constructor(
    @Inject(KYC_HOST_VERIFICATION_SERVICE) private readonly host: HostVerificationService,
  ) {}

  @Get('accounts/:orgId/verification')
  async state(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<HostVerificationView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.host.state(proofOf(request), orgOf(orgId));
  }

  @Post('accounts/:orgId/verification')
  @HttpCode(200)
  async submit(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<HostVerificationView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.host.submit(proofOf(request), orgOf(orgId));
  }

  @Post('accounts/:orgId/verification/tax-profile')
  @HttpCode(200)
  async taxProfile(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<HostVerificationView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.host.saveTaxProfile(proofOf(request), orgOf(orgId), request.body);
  }
}
