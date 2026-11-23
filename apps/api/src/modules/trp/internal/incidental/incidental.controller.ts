/**
 * Routes des frais annexes entre particuliers (US-706, ADR-197 ; 16 CLM-021 ; écrans de l'hôte
 * « demander des frais avec justificatif » (A04) et du voyageur « payer ou contester » (S12)).
 * Gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) puis `TermsGuard` (segment
 * `trips` : CGU à jour). La partie est celle de la session (titulaire du compte d'hôte ou voyageur
 * du trip), jugée en base. Toute autre personne, un trip ou un frais inconnu, un identifiant mal
 * formé reçoivent la MÊME réponse (404 `INCIDENTAL_NOT_FOUND`).
 *
 * | Route                                                     | Partie   | Réponse                     |
 * | --------------------------------------------------------- | -------- | --------------------------- |
 * | GET  /trips/{tripId}/incidental-fees                      | les deux | 200 demandes, photos        |
 * | POST /trips/{tripId}/incidental-fees                      | hôte     | 200 demande notifiée        |
 * | POST /trips/{tripId}/incidental-fees/{invoiceId}/accept   | voyageur | 200 payé (débit par Kmino)  |
 * | POST /trips/{tripId}/incidental-fees/{invoiceId}/dispute  | voyageur | 200 contesté (décision ops) |
 * | POST /trips/{tripId}/incidental-fees/{invoiceId}/cancel   | hôte     | 200 annulé                  |
 *
 * Aucune heure ni aucune jambe n'est reçue du client.
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { UUID } from '../inspection/model.js';
import { IncidentalHttpError } from './errors.js';
import { IncidentalService } from './incidental.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new IncidentalHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new IncidentalHttpError('AUTH_REQUIRED');
  return proof;
}

function idOf(raw: string): string {
  const id = raw.toLowerCase();
  if (!UUID.test(id)) throw new IncidentalHttpError('INCIDENTAL_NOT_FOUND');
  return id;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripIncidentalController {
  constructor(@Inject(IncidentalService) private readonly fees: IncidentalService) {}

  @Get(':tripId/incidental-fees')
  async view(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.fees.view(proofOf(request), idOf(tripId));
  }

  @Post(':tripId/incidental-fees')
  @HttpCode(200)
  async submit(@Req() request: Req, @Param('tripId') tripId: string) {
    return this.fees.submit(proofOf(request), idOf(tripId), bodyOf(request));
  }

  @Post(':tripId/incidental-fees/:invoiceId/accept')
  @HttpCode(200)
  async accept(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.fees.accept(proofOf(request), idOf(tripId), idOf(invoiceId), bodyOf(request));
  }

  @Post(':tripId/incidental-fees/:invoiceId/dispute')
  @HttpCode(200)
  async dispute(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.fees.dispute(proofOf(request), idOf(tripId), idOf(invoiceId), bodyOf(request));
  }

  @Post(':tripId/incidental-fees/:invoiceId/cancel')
  @HttpCode(200)
  async cancel(
    @Req() request: Req,
    @Param('tripId') tripId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.fees.cancel(proofOf(request), idOf(tripId), idOf(invoiceId), bodyOf(request));
  }
}
