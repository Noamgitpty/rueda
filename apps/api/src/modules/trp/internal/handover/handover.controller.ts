/**
 * Routes de la remise et du retour du véhicule entre particuliers (US-315, ADR-183 ; 16 TRP-002,
 * VER-015, TRP-033 ; écrans A03 / A04 de l'hôte et S09 · check-in / check-out du voyageur).
 * Gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) puis `TermsGuard` (route
 * de réservation, segment `trips` : CGU à jour). La partie est celle de la session (voyageur du
 * trip ou titulaire du compte d'hôte), jugée en base ; toute autre personne, un trip inconnu, un
 * sens ou un identifiant mal formé reçoivent la MÊME réponse (404 `HANDOVER_NOT_FOUND`).
 *
 * | Route                                             | Réponse                                    |
 * | ------------------------------------------------- | ------------------------------------------ |
 * | GET  /trips/{tripId}/handover/{direction}         | 200 état, conditions, permis, validations  |
 * | POST /trips/{tripId}/handover/checkin/open        | 200 remise ouverte ; 409 condition         |
 * | POST /trips/{tripId}/handover/checkin/identity    | 200 permis contrôlé (hôte) ; 403 ; 422     |
 * | POST /trips/{tripId}/handover/{direction}/validate| 200 validation ; seconde : transition      |
 *
 * `direction` : `checkin` (remise) ou `checkout` (retour). Aucune heure n'est reçue du client.
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { UUID } from '../inspection/model.js';
import { HandoverHttpError } from './errors.js';
import { HandoverService } from './handover.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HandoverHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new HandoverHttpError('AUTH_REQUIRED');
  return proof;
}

function tripOf(tripId: string): string {
  const id = tripId.toLowerCase();
  if (!UUID.test(id)) throw new HandoverHttpError('HANDOVER_NOT_FOUND');
  return id;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripHandoverController {
  constructor(@Inject(HandoverService) private readonly handovers: HandoverService) {}

  @Get(':tripId/handover/:direction')
  async view(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('direction') direction: string,
  ) {
    return this.handovers.view(proofOf(request), tripOf(tripId), direction);
  }

  @Post(':tripId/handover/checkin/open')
  @HttpCode(200)
  async open(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.handovers.open(proofOf(request), tripOf(tripId), bodyOf(request));
  }

  @Post(':tripId/handover/checkin/identity')
  @HttpCode(200)
  async identity(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.handovers.identity(proofOf(request), tripOf(tripId), bodyOf(request));
  }

  @Post(':tripId/handover/:direction/validate')
  @HttpCode(200)
  async validate(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('direction') direction: string,
  ) {
    return this.handovers.validate(proofOf(request), tripOf(tripId), direction, bodyOf(request));
  }
}
