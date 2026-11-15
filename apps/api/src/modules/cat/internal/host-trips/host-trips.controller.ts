/**
 * Routes des trips de l'hôte (US-219 ; 16 HDB-001 / HDB-002 ; écrans A02 et A05 ; ADR-127). Lecture
 * seule, gardée par `SessionGuard` ; l'hôte est celui de la session, le compte `{orgId}` l'un de
 * ses comptes titulaires, revérifié en base. Aucune écriture : l'état du trip ne change que par les
 * commandes d'US-207.
 *
 * | Route                                         | Réponse                                     |
 * | --------------------------------------------- | ------------------------------------------- |
 * | GET /host/accounts/{orgId}/trips              | 200 trips (onglet, véhicule, période) ; 400 |
 * | GET /host/accounts/{orgId}/trips/{tripId}     | 200 trip ; 404 TRIP_NOT_FOUND               |
 */
import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostListingHttpError } from '../host-listings/errors.js';
import { isUuid } from '../host-listings/model.js';
import { HostTripsService } from './host-trips.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new HostListingHttpError('AUTH_REQUIRED');
  return proof;
}

/** Identifiant mal formé ⇒ 404, comme un identifiant inconnu (rien n'est révélé). */
function idOf(id: string, code: 'HOST_ACCOUNT_NOT_FOUND' | 'TRIP_NOT_FOUND'): string {
  if (!isUuid(id)) throw new HostListingHttpError(code);
  return id.toLowerCase();
}

@Controller('host')
@UseGuards(SessionGuard)
export class HostTripsController {
  constructor(@Inject(HostTripsService) private readonly trips: HostTripsService) {}

  @Get('accounts/:orgId/trips')
  async list(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.trips.list(proofOf(request), idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'), query);
  }

  @Get('accounts/:orgId/trips/:tripId')
  async one(@Req() request: Req, @Param('orgId') orgId: string, @Param('tripId') tripId: string) {
    return this.trips.one(
      proofOf(request),
      idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'),
      idOf(tripId, 'TRIP_NOT_FOUND'),
    );
  }
}
