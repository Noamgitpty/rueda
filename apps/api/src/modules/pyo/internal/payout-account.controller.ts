/**
 * Routes du compte de versement de l'hôte (US-707, ADR-180 ; 16 PYO-001 ; écran de l'hôte).
 * Gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) ; l'hôte est celui de la
 * session (empreinte du jeton), le compte d'hôte `{orgId}` l'un de ses comptes TITULAIRES,
 * revérifié en base. Un compte d'un autre hôte, ou dont la personne n'est que co-hôte, rend 404
 * comme un compte inconnu (17 §2.3 point 5, L1-PM-11). Corps d'erreur `{ code, messageKey }` ;
 * réponses `Cache-Control: no-store`. Aucun numéro dans une réponse.
 *
 * | Route                                      | Réponse                                            |
 * | ------------------------------------------ | -------------------------------------------------- |
 * | GET  /host/accounts/{orgId}/payout-account | 200 PAYOUT_ACCOUNT_STATE ; 401 ; 403 ; 404 ; 503   |
 * | POST /host/accounts/{orgId}/payout-account | 200 PAYOUT_ACCOUNT_SAVED ; 400 ; 401 ; 403 ; 404 ; |
 * |                                            | 409 HOST_TAX_ID_REQUIRED ; 415 ; 422 ; 503         |
 *
 * Aucun versement ni interrupteur ici (`payouts_enabled[pays]` reste la garde du versement).
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
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import { PyoHttpError } from './errors.js';
import type { PayoutAccountService, PayoutAccountView } from './payout-account.service.js';
import { PYO_PAYOUT_ACCOUNT_SERVICE } from './tokens.js';

interface HostRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface HostResponse {
  setHeader(name: string, value: string): unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Identifiant de compte d'hôte mal formé ⇒ 404, comme un compte inconnu. */
function orgOf(orgId: string): string {
  if (!UUID.test(orgId)) throw new PyoHttpError('HOST_ACCOUNT_NOT_FOUND');
  return orgId;
}

function proofOf(request: HostRequest): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new PyoHttpError('AUTH_REQUIRED');
  return proof;
}

@Controller('host')
@UseGuards(SessionGuard)
export class PayoutAccountController {
  constructor(
    @Inject(PYO_PAYOUT_ACCOUNT_SERVICE) private readonly accounts: PayoutAccountService,
  ) {}

  @Get('accounts/:orgId/payout-account')
  async state(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<PayoutAccountView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.accounts.state(proofOf(request), orgOf(orgId));
  }

  @Post('accounts/:orgId/payout-account')
  @HttpCode(200)
  async save(
    @Req() request: HostRequest,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: HostResponse,
  ): Promise<PayoutAccountView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.accounts.save(proofOf(request), orgOf(orgId), request.body);
  }
}
