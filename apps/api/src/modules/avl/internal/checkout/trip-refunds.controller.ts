/**
 * Remboursement d'un trip lu par sa partie (US-224 partie 224d, ADR-154 ; 19 US-224 critère 1 ;
 * écrans S10 du voyageur et détail du trip de l'hôte). Route de réservation (segment `trips`) :
 * `SessionGuard` puis `TermsGuard` (CGU à jour exigées, US-102), comme le contrat du trip. Aucun
 * cache partagé.
 *
 * | Route                       | Réponse                                                          |
 * | --------------------------- | ---------------------------------------------------------------- |
 * | GET /trips/{tripId}/refunds | 200 vue de la partie (voyageur : montant, rail, date d'émission ; |
 * |                             | hôte : jambe HOST seulement) ; 404 REFUND_NOT_FOUND (autre       |
 * |                             | personne, trip inconnu, identifiant mal formé : même réponse) ;  |
 * |                             | 503 REFUNDS_UNAVAILABLE                                          |
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { TripRefundsService } from './trip-refunds.js';

interface RefundRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface NoStoreResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripRefundsController {
  constructor(@Inject(TripRefundsService) private readonly refunds: TripRefundsService) {}

  @Get(':tripId/refunds')
  async read(
    @Req() request: RefundRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: NoStoreResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.refunds.read(sessionProofOf(request), tripId);
  }
}
