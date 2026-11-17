/**
 * Routes du contrat de location d'un trip (US-211 partie 211b, ADR-149 ; 16 BKG-018, BKG-019 ;
 * écrans S09 du voyageur et A03 de l'hôte). Gardées par `SessionGuard` puis `TermsGuard` (route de
 * réservation, segment `trips` : CGU à jour exigées, US-102). La partie est celle de la session
 * (voyageur du trip ou titulaire du compte d'hôte), jugée en base ; toute autre personne, un trip
 * inconnu ou un identifiant mal formé reçoivent la MÊME réponse (404 `CONTRACT_NOT_FOUND`).
 *
 * | Route                               | Réponse                                                      |
 * | ----------------------------------- | ------------------------------------------------------------ |
 * | GET /trips/{tripId}/contract        | 200 résumé, texte (équivalent HTML), signature ; 404 ; 409   |
 * | GET /trips/{tripId}/contract/pdf    | 200 `application/pdf` rendu de nouveau, sans cache ; 404 ; 409 |
 * | POST /trips/{tripId}/contract/sign  | 200 signé (heure serveur, sceau) ; 404 ; 409 ; 400           |
 *
 * `?version=n` lit une version précédente (l'ancienne reste consultable, 19 US-211 critère 2).
 */
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { TermsGuard } from '../terms.guard.js';
import { ContractHttpError } from './errors.js';
import { TripContractService } from './trip-contract.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface Res {
  setHeader(name: string, value: string): unknown;
  status(code: number): Res;
  send(body?: unknown): unknown;
}

/** Version demandée : absente ⇒ la dernière ; sinon entier de 1 à 9999, sinon 400. */
function versionOf(raw: unknown): number | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,3}$/.test(raw)) {
    throw new ContractHttpError('REQUEST_INVALID');
  }
  return Number(raw);
}

const lower = (id: string): string => id.toLowerCase();

@Controller('trips')
// route de réservation (segment `trips`) : CGU à jour exigées, comme toute route du trip (US-102,
// N-43, L2-PM-31)
@UseGuards(SessionGuard, TermsGuard)
export class TripContractController {
  constructor(@Inject(TripContractService) private readonly contracts: TripContractService) {}

  @Get(':tripId/contract')
  async read(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.contracts.view(sessionProofOf(request), lower(tripId), versionOf(query['version']));
  }

  @Get(':tripId/contract/pdf')
  async pdf(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Query() query: Record<string, unknown>,
    @Res() response: Res,
  ): Promise<void> {
    const pdf = await this.contracts.pdf(
      sessionProofOf(request),
      lower(tripId),
      versionOf(query['version']),
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    // empreinte des octets servis (vérification par la partie : comparer au fichier reçu)
    response.setHeader('X-Contract-Sha256', pdf.sha256);
    response.status(200).send(Buffer.from(pdf.bytes));
  }

  @Post(':tripId/contract/sign')
  @HttpCode(200)
  async sign(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.contracts.sign(sessionProofOf(request), lower(tripId), request.body);
  }
}
