/**
 * Routes des sinistres entre particuliers d'un trip (US-318, ADR-198 ; 16 CLM-002 ; 08 BR-TT-02 à
 * 04 ; écrans S17 · incident du voyageur et « Multas, peajes y grúa » de l'hôte). Gardées par
 * `SessionGuard` (JSON exigé pour une écriture : parade CSRF) puis `TermsGuard` (segment `trips` :
 * CGU à jour). La partie est celle de la session, jugée en base : le voyageur du trip déclare un
 * incident ; le titulaire du compte d'hôte lit les sinistres et déclare une amende, un péage ou une
 * fourrière. Toute autre personne, un trip inconnu ou un identifiant mal formé reçoivent la MÊME
 * réponse (404 `TRIP_CLAIM_NOT_FOUND`).
 *
 * | Route                                 | Réponse                                                |
 * | ------------------------------------- | ------------------------------------------------------ |
 * | POST /trips/{tripId}/incidents        | 201 incident ouvert (rejeu : le même) ; 409 ; 422      |
 * | GET  /trips/{tripId}/claims           | 200 délai, frais, dossier de vol, refacturations       |
 * | POST /trips/{tripId}/traffic-charges/preview | 200 récapitulatif calculé par la base, rien d'écrit |
 * | POST /trips/{tripId}/traffic-charges  | 201 refacturation enregistrée (rejeu : la même) ; 409 TRAFFIC_DUPLICATE ; 422 |
 * | GET  /trips/{tripId}/traffic-charges  | 200 refacturations vues par le voyageur (0181)         |
 * | POST /trips/{tripId}/traffic-charges/{chargeId}/accept  | 200 payée (accord écrit) ; 409       |
 * | POST /trips/{tripId}/traffic-charges/{chargeId}/dispute | 200 contestée (motif) ; 409 ; 422     |
 *
 * Suite (0181, ADR-201) : référence du PV obligatoire, unique par trip ; le voyageur du trip paie ou
 * conteste avant l'échéance (08 BR-TT-02 : 48 h) ; aucun débit avant ; décision de l'ops ensuite.
 *
 * Aucune heure de réception ni aucun frais n'est reçu du client.
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { TripClaimHttpError } from './errors.js';
import { TripClaimsService, UUID } from './service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TripClaimHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new TripClaimHttpError('AUTH_REQUIRED');
  return proof;
}

function tripOf(tripId: string): string {
  const id = tripId.toLowerCase();
  if (!UUID.test(id)) throw new TripClaimHttpError('TRIP_CLAIM_NOT_FOUND');
  return id;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripClaimsController {
  constructor(@Inject(TripClaimsService) private readonly claims: TripClaimsService) {}

  @Post(':tripId/incidents')
  @HttpCode(201)
  async incident(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.claims.reportIncident(proofOf(request), tripOf(tripId), bodyOf(request));
  }

  @Get(':tripId/claims')
  async view(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.claims.view(proofOf(request), tripOf(tripId));
  }

  @Post(':tripId/traffic-charges/preview')
  @HttpCode(200)
  async trafficChargePreview(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.claims.previewTrafficCharge(proofOf(request), tripOf(tripId), bodyOf(request));
  }

  @Post(':tripId/traffic-charges')
  @HttpCode(201)
  async trafficCharge(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.claims.declareTrafficCharge(proofOf(request), tripOf(tripId), bodyOf(request));
  }

  @Get(':tripId/traffic-charges')
  async guestTrafficCharges(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.claims.guestCharges(proofOf(request), tripOf(tripId));
  }

  @Post(':tripId/traffic-charges/:chargeId/accept')
  @HttpCode(200)
  async acceptTrafficCharge(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('chargeId') chargeId: string,
  ) {
    tripOf(tripId);
    return this.claims.acceptTrafficCharge(proofOf(request), tripOf(chargeId), bodyOf(request));
  }

  @Post(':tripId/traffic-charges/:chargeId/dispute')
  @HttpCode(200)
  async disputeTrafficCharge(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('chargeId') chargeId: string,
  ) {
    tripOf(tripId);
    return this.claims.disputeTrafficCharge(proofOf(request), tripOf(chargeId), bodyOf(request));
  }
}
