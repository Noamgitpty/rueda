/**
 * Routes de la constancia d'arrendamiento (US-212, ADR-162 ; 16 LEG-026 ; écrans S09 du voyageur
 * et A05 / A03 de l'hôte). Gardées par `SessionGuard` puis `TermsGuard` (routes de réservation,
 * segment `trips` : CGU à jour exigées, US-102). La partie est celle de la session (voyageur du
 * trip ou titulaire du compte d'hôte), jugée en base ; toute autre personne, un trip inconnu ou un
 * identifiant mal formé reçoivent la MÊME réponse (404 `CONSTANCIA_NOT_FOUND`).
 *
 * | Route                                     | Réponse                                              |
 * | ----------------------------------------- | ---------------------------------------------------- |
 * | GET /trips/{tripId}/constancia            | 200 résumé, texte (équivalent HTML), empreinte ; 404 ; 409 |
 * | GET /trips/{tripId}/constancia/pdf        | 200 `application/pdf` rendu à la demande, sans cache ; 404 ; 409 |
 * | POST /trips/constancias/search            | 200 trips du compte d'hôte (plaque, date) ; 400 ; 401 |
 *
 * La recherche passe la plaque dans le CORPS (jamais dans une URL ni un journal).
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
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { TermsGuard } from '../terms.guard.js';
import { TripConstanciaService } from './constancia.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface Res {
  setHeader(name: string, value: string): unknown;
  status(code: number): Res;
  send(body?: unknown): unknown;
}

const lower = (id: string): string => id.toLowerCase();

@Controller('trips')
// route de réservation (segment `trips`) : CGU à jour exigées, comme toute route du trip (US-102)
@UseGuards(SessionGuard, TermsGuard)
export class TripConstanciaController {
  constructor(@Inject(TripConstanciaService) private readonly constancias: TripConstanciaService) {}

  @Get(':tripId/constancia')
  async read(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.constancias.view(sessionProofOf(request), lower(tripId));
  }

  @Get(':tripId/constancia/pdf')
  async pdf(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Res() response: Res,
  ): Promise<void> {
    const pdf = await this.constancias.pdf(sessionProofOf(request), lower(tripId));
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    // empreinte des octets servis (vérification par la partie : comparer au fichier reçu)
    response.setHeader('X-Constancia-Sha256', pdf.sha256);
    response.status(200).send(Buffer.from(pdf.bytes));
  }

  /** Recherche de l'hôte (EC-48) : la base ne rend que les trips du compte dont il est titulaire. */
  @Post('constancias/search')
  @HttpCode(200)
  async search(@Req() request: Req) {
    return this.constancias.search(sessionProofOf(request), request.body);
  }
}
