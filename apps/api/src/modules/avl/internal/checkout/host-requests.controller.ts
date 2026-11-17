/**
 * Routes des demandes de réservation de l'hôte (US-223 partie 223c, ADR-146 ; 16 HDB-002 ; 10b A05
 * `web.a05.accept` / `web.a05.decline`). Routes de réservation : `SessionGuard` puis `TermsGuard`
 * (CGU à jour) sur la classe, comme les trips de l'hôte (US-219). L'hôte est celui de la session,
 * le compte `{orgId}` l'un de ses comptes TITULAIRES, revérifié en base ; une demande d'un autre
 * compte ou inconnue ⇒ 404, même réponse (journalisé en base). Aucun montant reçu du client : le
 * montant et chaque jambe de la capture viennent du devis engagé. Aucun cache partagé.
 *
 * | Route                                                | Réponse                                     |
 * | ---------------------------------------------------- | ------------------------------------------- |
 * | GET /host/accounts/{orgId}/requests                  | 200 demandes en attente ou en capture ; 404 |
 * | GET /host/accounts/{orgId}/requests/{holdId}         | 200 demande ; 404 REQUEST_NOT_FOUND         |
 * | POST /host/accounts/{orgId}/requests/{holdId}/accept | 200 CAPTURING / ACCEPTED ; 404 ; 409        |
 * |                                                      | REQUEST_EXPIRED … ; 503 PAYMENT_UNAVAILABLE |
 * | POST /host/accounts/{orgId}/requests/{holdId}/decline| 200 DECLINED ; 404 ; 409 REQUEST_EXPIRED …  |
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
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostRequestHttpError } from './host-request-errors.js';
import { HostRequestService } from './host-requests.service.js';

interface HostRequestRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

function proofOf(request: HostRequestRequest): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new HostRequestHttpError('AUTH_REQUIRED');
  return proof;
}

@Controller('host')
@UseGuards(SessionGuard, TermsGuard)
export class HostRequestsController {
  constructor(@Inject(HostRequestService) private readonly requests: HostRequestService) {}

  @Get('accounts/:orgId/requests')
  async list(
    @Req() request: HostRequestRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { requests: await this.requests.list(proofOf(request), orgId) };
  }

  @Get('accounts/:orgId/requests/:holdId')
  async one(
    @Req() request: HostRequestRequest,
    @Param('orgId') orgId: string,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { request: await this.requests.one(proofOf(request), orgId, holdId) };
  }

  @Post('accounts/:orgId/requests/:holdId/accept')
  @HttpCode(200)
  async accept(
    @Req() request: HostRequestRequest,
    @Param('orgId') orgId: string,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { decision: await this.requests.accept(proofOf(request), orgId, holdId) };
  }

  @Post('accounts/:orgId/requests/:holdId/decline')
  @HttpCode(200)
  async decline(
    @Req() request: HostRequestRequest,
    @Param('orgId') orgId: string,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { decision: await this.requests.decline(proofOf(request), orgId, holdId) };
  }
}
