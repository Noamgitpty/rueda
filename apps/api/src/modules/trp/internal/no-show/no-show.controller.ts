/**
 * Routes du no-show entre particuliers (US-307, ADR-191 ; 16 TRP-015 ; écrans de l'hôte « le
 * voyageur ne s'est pas présenté » et du voyageur « l'hôte ne s'est pas présenté »). Gardées par
 * `SessionGuard` (JSON exigé pour une écriture : parade CSRF) puis `TermsGuard` (segment `trips` :
 * CGU à jour). La partie est celle de la session (voyageur du trip ou titulaire du compte d'hôte),
 * jugée en base : l'hôte déclare le voyageur absent, le voyageur signale l'hôte absent. Toute autre
 * personne, un trip inconnu ou un identifiant mal formé reçoivent la MÊME réponse (404
 * `NO_SHOW_NOT_FOUND`).
 *
 * | Route                         | Réponse                                                     |
 * | ----------------------------- | ----------------------------------------------------------- |
 * | GET  /trips/{tripId}/no-show  | 200 fenêtre, obstacle, preuve tracée, dernière demande      |
 * | POST /trips/{tripId}/no-show  | 200 demande enregistrée (rejeu : la même) ; 409 obstacle    |
 *
 * Aucune heure ni aucun montant n'est reçu du client.
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { UUID } from '../inspection/model.js';
import { NoShowHttpError } from './errors.js';
import { NoShowService } from './no-show.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new NoShowHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new NoShowHttpError('AUTH_REQUIRED');
  return proof;
}

function tripOf(tripId: string): string {
  const id = tripId.toLowerCase();
  if (!UUID.test(id)) throw new NoShowHttpError('NO_SHOW_NOT_FOUND');
  return id;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripNoShowController {
  constructor(@Inject(NoShowService) private readonly noShows: NoShowService) {}

  @Get(':tripId/no-show')
  async view(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.noShows.view(proofOf(request), tripOf(tripId));
  }

  @Post(':tripId/no-show')
  @HttpCode(200)
  async report(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.noShows.report(proofOf(request), tripOf(tripId), bodyOf(request));
  }
}
