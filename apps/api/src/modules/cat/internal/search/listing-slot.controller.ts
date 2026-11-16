/**
 * Dates choisies sur la fiche d'une annonce (US-204 ; 16 LST-006 ; écran S03 ; ADR-132). Route
 * publique : aucune session. Même limite que la recherche (sonde de disponibilité,
 * `availability_probe_per_minute` du pays de l'annonce, par IP) : la réponse ne dit que « libre »
 * ou un refus, jamais rien de l'occupation en cause (RLS-17). Heures saisies dans le fuseau du
 * lieu, au pas de 30 min ; instants rendus en UTC avec le fuseau du véhicule. Aucun prix : le
 * devis du checkout appartient à US-208.
 *
 * | Route                                                  | Réponse                                    |
 * | ------------------------------------------------------ | ------------------------------------------ |
 * | GET /listings/{listingId}/availability?start=&end=     | 200 créneau ; 404 LISTING_NOT_FOUND ; 409  |
 * |                                                        | DATES_UNAVAILABLE ; 422 DATES_NOTICE_TOO_  |
 * |                                                        | SHORT, SEARCH_* ; 429 RATE_LIMITED ; 503   |
 * | GET /listings/{listingId}/conditions                   | 200 conditions ; 404 LISTING_NOT_FOUND ;   |
 * |                                                        | 503 SEARCH_UNAVAILABLE                     |
 *
 * Conditions (US-205 ; ADR-138) : politique d'annulation du pays (et, pour un créneau accepté,
 * `freeUntil` de BR-CXL-01 dans la réponse de `availability`), distance, caution de la plateforme
 * et protection de l'assureur partenaire, rendue seulement si la base peut la promettre
 * (`insurer_contract_active`, contrat en vigueur couvrant le véhicule, RC au minimum du pays).
 * Aucune donnée de l'occupation ni de l'hôte : pas de limite de débit (lecture comme la fiche).
 */
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { SearchHttpError } from './errors.js';
import { SearchService } from './search.service.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}
interface IpRequest {
  readonly ip?: string | undefined;
}

@Controller('listings')
export class ListingSlotController {
  constructor(@Inject(SearchService) private readonly service: SearchService) {}

  @Get(':listingId/availability')
  async availability(
    @Param('listingId') listingId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: IpRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    // occupation qui change à tout moment : pas de cache partagé
    response.setHeader('Cache-Control', 'no-store');
    try {
      // IP retenue : `request.ip` (trust proxy), jamais un en-tête lu directement (US-052)
      return { availability: await this.service.slot(listingId, query, request.ip ?? 'unknown') };
    } catch (error) {
      if (error instanceof SearchHttpError && error.retryAfterS !== null) {
        response.setHeader('Retry-After', String(error.retryAfterS));
      }
      throw error;
    }
  }

  @Get(':listingId/conditions')
  async conditions(
    @Param('listingId') listingId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    // interrupteur et contrat de l'assureur changent sans délai : pas de cache partagé
    response.setHeader('Cache-Control', 'no-store');
    return { conditions: await this.service.conditions(listingId) };
  }
}
