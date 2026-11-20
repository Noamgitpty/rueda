/**
 * Routes des avis réciproques (US-317, ADR-190 ; écrans S13, A12, A13 et fiche S03).
 *
 * | Route                                   | Gardes                   | Réponse                           |
 * | --------------------------------------- | ------------------------ | --------------------------------- |
 * | GET  /trips/{tripId}/reviews            | SessionGuard, TermsGuard | 200 TRIP_REVIEWS ; 401 ; 404 ;    |
 * |                                         |                          | 503                               |
 * | POST /trips/{tripId}/reviews            | SessionGuard, TermsGuard | 201 REVIEW_SUBMITTED ; 400 ; 401 ;|
 * |                                         |                          | 404 ; 409 ; 415 ; 422 ; 503       |
 * | GET  /reviews/received                  | SessionGuard             | 200 REVIEWS_RECEIVED ; 401 ; 503  |
 * | GET  /listings/{listingId}/host-profile | aucune (public)          | 200 HOST_PROFILE ; 404 ; 503      |
 *
 * La partie du trip est celle de la SESSION (empreinte du jeton), jugée en base. L'accès aux avis
 * reçus (droit d'accès, Ley 81) n'exige pas les CGU à jour : il ne réserve ni n'écrit rien. Corps
 * d'erreur `{ code, messageKey }` ; réponses `Cache-Control: no-store`.
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
import { TermsGuard } from '../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import type { ReviewsService, ReviewSubmittedView, TripReviewsView } from './reviews.service.js';
import { REV_REVIEWS_SERVICE } from './tokens.js';

interface RevRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface RevResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripReviewsController {
  constructor(@Inject(REV_REVIEWS_SERVICE) private readonly reviews: ReviewsService) {}

  @Get(':tripId/reviews')
  async read(
    @Req() request: RevRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: RevResponse,
  ): Promise<TripReviewsView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.reviews.trip(sessionProofOf(request), tripId);
  }

  @Post(':tripId/reviews')
  @HttpCode(201)
  async submit(
    @Req() request: RevRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: RevResponse,
  ): Promise<ReviewSubmittedView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.reviews.submit(sessionProofOf(request), tripId, request.body);
  }
}
