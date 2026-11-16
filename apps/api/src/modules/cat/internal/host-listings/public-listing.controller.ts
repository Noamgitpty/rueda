/**
 * Fiche publique d'une annonce publiée (US-115 critère 4, US-204 ; 16 HST-011 « seule la zone du
 * lieu de remise est visible, jamais l'adresse exacte », LST-002, LST-003 / LST-020, LST-007 ;
 * OQ-P2P-05 ; L1-PM-19, L2-PM-29). Fiche : route publique, aucune session. Réponse : colonnes C0
 * seulement (prix, distance, véhicule, ville, zone, point arrondi au centième de degré), galerie
 * dans l'ordre de l'hôte (clés du bucket public), prénom de l'hôte et notes du véhicule et de
 * l'hôte ; jamais le nom ni l'adresse du lieu, son point exact, la plaque, le VIN ni le compte
 * d'hôte. Annonce non LISTED ou inconnue : 404.
 *
 * Lieu de remise exact (US-204 critère 3) : route de session (`SessionGuard`), au seul voyageur
 * d'un trip confirmé et non terminé de ce véhicule (jugé par la base) ; sinon 404 sans rien
 * révéler. Jamais mis en cache (`SessionGuard` pose `no-store`).
 *
 * | Route                                   | Réponse                                              |
 * | --------------------------------------- | ---------------------------------------------------- |
 * | GET /listings/{listingId}               | 200 fiche ; 404 LISTING_NOT_FOUND ; 503              |
 * | GET /listings/{listingId}/meeting-point | 200 lieu exact ; 401 ; 404 MEETING_POINT_NOT_FOUND ; |
 * |                                         | 503                                                  |
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostListingHttpError } from './errors.js';
import { HostListingsService } from './host-listings.service.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}
interface SessionRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

@Controller('listings')
export class PublicListingController {
  constructor(@Inject(HostListingsService) private readonly listings: HostListingsService) {}

  @Get(':listingId')
  async listing(
    @Param('listingId') listingId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    // aucune donnée personnelle, mais un statut qui change (retrait) : pas de cache partagé long
    response.setHeader('Cache-Control', 'no-store');
    return { listing: await this.listings.publicListing(listingId) };
  }

  @Get(':listingId/meeting-point')
  @UseGuards(SessionGuard)
  async meetingPoint(@Req() request: SessionRequest, @Param('listingId') listingId: string) {
    const proof = sessionProofOf(request);
    if (proof === null) throw new HostListingHttpError('AUTH_REQUIRED');
    return { meetingPoint: await this.listings.meetingPoint(proof, listingId) };
  }
}
