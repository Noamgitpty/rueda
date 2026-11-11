/**
 * Fiche publique d'une annonce publiée (US-115 critère 4 ; 16 HST-011 « seule la zone du lieu de
 * remise est visible, jamais l'adresse exacte » ; OQ-P2P-05 ; L1-PM-19). Route publique : aucune
 * session. Réponse : colonnes C0 seulement (prix, distance, véhicule, ville, zone, point arrondi
 * au centième de degré) ; jamais le nom ni l'adresse du lieu, son point exact, la plaque, le VIN
 * ni le compte d'hôte. Annonce non LISTED ou inconnue : 404. L'adresse exacte n'est servie au
 * voyageur qu'après confirmation (US-514).
 *
 * | Route                    | Réponse                                    |
 * | ------------------------ | ------------------------------------------ |
 * | GET /listings/{listingId} | 200 fiche ; 404 LISTING_NOT_FOUND ; 503    |
 */
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { HostListingsService } from './host-listings.service.js';

interface Res {
  setHeader(name: string, value: string): unknown;
}

@Controller('listings')
export class PublicListingController {
  constructor(@Inject(HostListingsService) private readonly listings: HostListingsService) {}

  @Get(':listingId')
  async listing(@Param('listingId') listingId: string, @Res({ passthrough: true }) response: Res) {
    // aucune donnée personnelle, mais un statut qui change (retrait) : pas de cache partagé long
    response.setHeader('Cache-Control', 'no-store');
    return { listing: await this.listings.publicListing(listingId) };
  }
}
