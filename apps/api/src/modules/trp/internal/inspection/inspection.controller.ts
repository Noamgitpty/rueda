/**
 * Routes des photos d'état du véhicule d'un trip (US-303, ADR-179 ; 16 TRP-004 ; écrans A03 / A04
 * de l'hôte et S09 · check-in / check-out du voyageur). Gardées par `SessionGuard` (JSON exigé pour
 * une écriture : parade CSRF) puis `TermsGuard` (route de réservation, segment `trips` : CGU à
 * jour). La partie est celle de la session (voyageur du trip ou titulaire du compte d'hôte), jugée
 * en base ; toute autre personne, un trip inconnu, un type ou un identifiant mal formé reçoivent la
 * MÊME réponse (404 `INSPECTION_NOT_FOUND`, 17 §2.3 point 5).
 *
 * | Route                                                | Réponse                                   |
 * | ---------------------------------------------------- | ----------------------------------------- |
 * | GET  /trips/{tripId}/inspections/{kind}              | 200 gabarit, bornes, les deux séries      |
 * | POST /trips/{tripId}/inspections/{kind}/captures     | 201 jeton de capture (120 s) ; 409        |
 * | POST /trips/{tripId}/inspections/{kind}/photos       | 201 photo reçue (heure serveur, empreinte)|
 * |                                                      | ; 422 galerie / photo ; 409 ; 503         |
 * | POST /trips/{tripId}/inspections/{kind}/submit       | 200 série validée ; 422 incomplète        |
 *
 * `kind` : `checkin` (départ) ou `checkout` (retour). Photo encodée en base64 dans le corps JSON
 * borné (100 Kio) en attendant l'URL de dépôt signée du stockage réel (US-003, lot C).
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { principalOf, SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { InspectionHttpError } from './errors.js';
import { InspectionService } from './inspection.service.js';
import { UUID } from './model.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new InspectionHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new InspectionHttpError('AUTH_REQUIRED');
  return proof;
}

/** Personne de la session (clé de chiffrement de ses photos) ; la base revérifie par le jeton. */
function userOf(request: Req): string {
  const p = principalOf(request);
  if (p === null) throw new InspectionHttpError('AUTH_REQUIRED');
  return p.userId;
}

function tripOf(tripId: string): string {
  const id = tripId.toLowerCase();
  if (!UUID.test(id)) throw new InspectionHttpError('INSPECTION_NOT_FOUND');
  return id;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripInspectionController {
  constructor(@Inject(InspectionService) private readonly inspections: InspectionService) {}

  @Get(':tripId/inspections/:kind')
  async view(@Req() request: Req, @Param('tripId') tripId: string, @Param('kind') kind: string) {
    return this.inspections.view(proofOf(request), tripOf(tripId), kind);
  }

  @Post(':tripId/inspections/:kind/captures')
  @HttpCode(201)
  async capture(@Req() request: Req, @Param('tripId') tripId: string, @Param('kind') kind: string) {
    return this.inspections.openCapture(proofOf(request), tripOf(tripId), kind, bodyOf(request));
  }

  @Post(':tripId/inspections/:kind/photos')
  @HttpCode(201)
  async photo(@Req() request: Req, @Param('tripId') tripId: string, @Param('kind') kind: string) {
    return this.inspections.addPhoto(
      proofOf(request),
      userOf(request),
      tripOf(tripId),
      kind,
      bodyOf(request),
    );
  }

  @Post(':tripId/inspections/:kind/submit')
  @HttpCode(200)
  async submit(@Req() request: Req, @Param('tripId') tripId: string, @Param('kind') kind: string) {
    return this.inspections.submit(proofOf(request), tripOf(tripId), kind, bodyOf(request));
  }
}
