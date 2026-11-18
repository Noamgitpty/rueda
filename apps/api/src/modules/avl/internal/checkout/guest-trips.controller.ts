/**
 * « Mis viajes » et détail du trip du voyageur (US-214, ADR-160 ; 19 US-214 ; écrans S08 et S09).
 * Routes de réservation (segment `trips`) : `SessionGuard` puis `TermsGuard` (CGU à jour exigées,
 * US-102), comme le contrat et le remboursement du trip. Lecture seule ; aucun cache partagé.
 *
 * | Route                | Réponse                                                                |
 * | -------------------- | ---------------------------------------------------------------------- |
 * | GET /trips           | 200 trips et demandes en attente du voyageur de la session ; 401 ; 503 |
 * | GET /trips/{tripId}  | 200 trip ; 404 TRIP_NOT_FOUND (trip d'une autre personne, inconnu ou   |
 * |                      | identifiant mal formé : même réponse) ; 401 ; 503 TRIPS_UNAVAILABLE    |
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { GuestTripsService } from './guest-trips.js';

interface TripRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface NoStoreResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class GuestTripsController {
  constructor(@Inject(GuestTripsService) private readonly trips: GuestTripsService) {}

  @Get()
  async list(@Req() request: TripRequest, @Res({ passthrough: true }) response: NoStoreResponse) {
    response.setHeader('Cache-Control', 'no-store');
    return this.trips.list(sessionProofOf(request));
  }

  @Get(':tripId')
  async one(
    @Req() request: TripRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: NoStoreResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.trips.one(sessionProofOf(request), tripId);
  }
}
