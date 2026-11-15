/**
 * Recherche publique par zone, lieu, dates et heures (US-201 ; 16 SRC-001 ; écran S01). Routes
 * publiques : aucune session. Préfixe `/search` : limite par IP de la portée `search` du garde
 * global (US-052), plus la sonde de disponibilité (`availability_probe_per_minute`) pour une
 * recherche avec dates. Réponses : colonnes C0 seulement, zone approximative ; jamais l'adresse
 * exacte, le point exact, la plaque, le VIN, le compte d'hôte ni l'occupation (19 US-201
 * critère 4, L1-PM-19). Heures saisies dans le fuseau du lieu, au pas de 30 min ; instants rendus
 * en UTC avec le fuseau du véhicule (critère 3).
 *
 * | Route                                                        | Réponse                                         |
 * | ------------------------------------------------------------ | ----------------------------------------------- |
 * | GET /search/areas?country=XX                                 | 200 zones ; 400 REQUEST_INVALID ; 503           |
 * | GET /search?country=&city=&area=&start=&end=[&limit=]        | 200 résultats (liste vide : aucun) ; 400 ; 422  |
 * |                                                              | SEARCH_* ; 429 RATE_LIMITED ; 503               |
 */
import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { SearchHttpError } from './errors.js';
import { SearchService } from './search.service.js';

interface Res {
  setHeader(name: string, value: string): unknown;
}
interface Req {
  readonly ip?: string | undefined;
}

@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly service: SearchService) {}

  @Get('areas')
  async areas(@Query('country') country: unknown, @Res({ passthrough: true }) response: Res) {
    // annonces publiées ou retirées à tout moment : pas de cache partagé
    response.setHeader('Cache-Control', 'no-store');
    return { areas: await this.service.areas(country) };
  }

  @Get()
  async search(
    @Query() query: Record<string, unknown>,
    @Req() request: Req,
    @Res({ passthrough: true }) response: Res,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      // IP retenue : `request.ip` (trust proxy), jamais un en-tête lu directement (US-052)
      return { results: await this.service.search(query, request.ip ?? 'unknown') };
    } catch (error) {
      if (error instanceof SearchHttpError && error.retryAfterS !== null) {
        response.setHeader('Retry-After', String(error.retryAfterS));
      }
      throw error;
    }
  }
}
