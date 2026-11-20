/**
 * Avis reçus par la personne de la session (US-317, ADR-190 ; droit d'accès, Ley 81 ; écran A13) :
 * GET /reviews/received, gardée par `SessionGuard` seul (l'accès à ses données n'exige pas les CGU à
 * jour : rien n'est réservé ni écrit). Voir `trip-reviews.controller.ts` pour le tableau des routes.
 */
import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import type { ReviewsReceivedView, ReviewsService } from './reviews.service.js';
import { REV_REVIEWS_SERVICE } from './tokens.js';

interface RevRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}
interface RevResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('reviews')
@UseGuards(SessionGuard)
export class ReceivedReviewsController {
  constructor(@Inject(REV_REVIEWS_SERVICE) private readonly reviews: ReviewsService) {}

  @Get('received')
  async received(
    @Req() request: RevRequest,
    @Res({ passthrough: true }) response: RevResponse,
  ): Promise<ReviewsReceivedView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.reviews.received(sessionProofOf(request));
  }
}
