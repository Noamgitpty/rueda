/**
 * Reçu d'un trip lu par sa partie (US-217 partie 217a, ADR-161 ; 19 US-217 critères 1 et 2). Route
 * de réservation (segment `trips`) : `SessionGuard` puis `TermsGuard` (CGU à jour exigées, US-102),
 * comme le contrat et le remboursement du trip. Aucun cache partagé.
 *
 * | Route                       | Réponse                                                          |
 * | --------------------------- | ---------------------------------------------------------------- |
 * | GET /trips/{tripId}/receipt | 200 vue de la partie (voyageur : paiement et trip fee ; hôte :   |
 * |                             | gains du trip) ; 404 RECEIPT_NOT_FOUND (autre personne, trip     |
 * |                             | inconnu, identifiant mal formé : même réponse) ; 409             |
 * |                             | RECEIPT_NOT_READY ; 503 RECEIPT_UNAVAILABLE                      |
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { TripReceiptService } from './trip-receipt.js';

interface ReceiptRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface NoStoreResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripReceiptController {
  constructor(@Inject(TripReceiptService) private readonly receipts: TripReceiptService) {}

  @Get(':tripId/receipt')
  async read(
    @Req() request: ReceiptRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: NoStoreResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.receipts.read(sessionProofOf(request), tripId);
  }
}
