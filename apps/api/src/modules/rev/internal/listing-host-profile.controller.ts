/**
 * Profil public de l'hôte d'une annonce publiée (US-317, ADR-190 ; 16 LST-020 ; fiche S03) :
 * GET /listings/{listingId}/host-profile, route publique (aucune garde d'identité ; garde global de
 * débit par IP). Prénom, ancienneté, trips, note et avis publiés seulement.
 */
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { HostProfileView, ReviewsService } from './reviews.service.js';
import { REV_REVIEWS_SERVICE } from './tokens.js';

interface RevResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('listings')
export class ListingHostProfileController {
  constructor(@Inject(REV_REVIEWS_SERVICE) private readonly reviews: ReviewsService) {}

  @Get(':listingId/host-profile')
  async hostProfile(
    @Param('listingId') listingId: string,
    @Res({ passthrough: true }) response: RevResponse,
  ): Promise<HostProfileView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.reviews.hostProfile(listingId);
  }
}
