/**
 * Relevé mensuel des gains de l'hôte (US-217 partie 217a, ADR-161 ; 19 US-217 critères 2 et 3).
 * Route de l'hôte : `SessionGuard` puis `TermsGuard` (CGU à jour) sur la classe, comme les demandes
 * de l'hôte (US-223c). Le compte `{orgId}` est l'un des comptes TITULAIRES de la session, revérifié
 * en base ; sinon 404, même réponse. Aucun cache partagé.
 *
 * | Route                                         | Réponse                                        |
 * | --------------------------------------------- | ---------------------------------------------- |
 * | GET /host/accounts/{orgId}/earnings/{month}   | 200 relevé du mois par devise ; 400            |
 * |                                               | REQUEST_INVALID (mois ≠ YYYY-MM) ; 404         |
 * |                                               | EARNINGS_NOT_FOUND ; 503 EARNINGS_UNAVAILABLE  |
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostEarningsService } from './host-earnings.js';

interface EarningsRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface NoStoreResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('host')
@UseGuards(SessionGuard, TermsGuard)
export class HostEarningsController {
  constructor(@Inject(HostEarningsService) private readonly earnings: HostEarningsService) {}

  @Get('accounts/:orgId/earnings/:month')
  async read(
    @Req() request: EarningsRequest,
    @Param('orgId') orgId: string,
    @Param('month') month: string,
    @Res({ passthrough: true }) response: NoStoreResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.earnings.read(sessionProofOf(request), orgId, month);
  }
}
