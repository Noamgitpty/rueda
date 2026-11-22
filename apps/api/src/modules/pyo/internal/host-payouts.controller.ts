/**
 * Versements de l'hôte, lus par le titulaire du compte d'hôte (US-314, ADR-192 ; écran A08).
 * Route de l'hôte gardée par `SessionGuard`, comme le compte de versement (US-707) : une lecture
 * seule, rien n'est réservé ni payé (aucune garde des CGU). Le compte `{orgId}` est l'un des
 * comptes TITULAIRES de la session, revérifié en base ; sinon 404, même réponse qu'un compte
 * inconnu (co-hôte compris, RLS-28). Aucun cache partagé.
 *
 * | Route                                | Réponse                                                |
 * | ------------------------------------ | ------------------------------------------------------ |
 * | GET /host/accounts/{orgId}/payouts   | 200 calendrier et lots ; 401 ; 403                     |
 * |                                      | PAYOUTS_READ_FORBIDDEN ; 404 HOST_ACCOUNT_NOT_FOUND ;  |
 * |                                      | 503 PAYOUTS_UNAVAILABLE                                |
 *
 * Lecture seule : aucun versement, aucun interrupteur (`payouts_enabled[pays]` reste la garde).
 */
import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import { PyoHttpError } from './errors.js';
import { HostPayoutsService } from './host-payouts.js';
import type { HostPayoutsView } from './host-payouts.js';

interface HostRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}
interface HostResponse {
  setHeader(name: string, value: string): unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Controller('host')
@UseGuards(SessionGuard)
export class HostPayoutsController {
  constructor(@Inject(HostPayoutsService) private readonly payouts: HostPayoutsService) {}

  @Get('accounts/:orgId/payouts')
  async read(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<HostPayoutsView> {
    response.setHeader('Cache-Control', 'no-store');
    // identifiant mal formé ⇒ 404, comme un compte inconnu
    if (!UUID.test(orgId)) throw new PyoHttpError('HOST_ACCOUNT_NOT_FOUND');
    const proof = sessionProofOf(request);
    if (proof === null) throw new PyoHttpError('AUTH_REQUIRED');
    return this.payouts.read(proof, orgId);
  }
}
