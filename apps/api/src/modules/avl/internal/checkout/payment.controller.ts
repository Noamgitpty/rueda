/**
 * Routes du paiement du hold du checkout (US-223 partie 223b, ADR-142 ; 16 PAY-034, PAY-006,
 * PAY-019 ; écrans S05 et S06). Routes de réservation : `SessionGuard` puis `TermsGuard` sur la
 * classe, comme `/checkout/*` (US-208). Le voyageur est celui de la session ; le client n'envoie
 * jamais de montant ni de jambe, seulement le moyen de paiement (L2-PM-03). Aucun cache partagé.
 * Idempotence : un seul ordre vivant par hold, jugé par la base (T1 sous verrous voyageur puis
 * véhicule, clé `hold:<id>:CAPTURE:a<n>`) ; un second appel pendant un ordre actif n'en crée aucun.
 *
 * | Route                                 | Réponse                                                     |
 * | ------------------------------------- | ----------------------------------------------------------- |
 * | POST /checkout/holds/{holdId}/payment | 201 ordre créé, adresse de la page hébergée du PSP ; 200    |
 * |                                       | aucun ordre créé (état) ; 400 REQUEST_INVALID ; 404 ; 409   |
 * |                                       | HOLD_EXPIRED … ; 403 KYC_… ; 422 ; 503 PAYMENT_UNAVAILABLE  |
 * | GET /checkout/holds/{holdId}/payment  | 200 état du paiement (S06) ; 404 HOLD_NOT_FOUND ; 503       |
 */
import { Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { PaymentHttpError } from './payment-errors.js';
import { CheckoutPaymentService } from './payment.service.js';

interface PaymentRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface StatusResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): unknown;
}

function proofOf(request: PaymentRequest): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new PaymentHttpError('AUTH_REQUIRED');
  return proof;
}

@Controller('checkout')
@UseGuards(SessionGuard, TermsGuard)
export class CheckoutPaymentController {
  constructor(@Inject(CheckoutPaymentService) private readonly payments: CheckoutPaymentService) {}

  @Post('holds/:holdId/payment')
  async pay(
    @Req() request: PaymentRequest,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const r = await this.payments.pay(proofOf(request), holdId, request.body);
    response.status(r.created ? 201 : 200);
    return { payment: r.payment };
  }

  @Get('holds/:holdId/payment')
  async payment(
    @Req() request: PaymentRequest,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { payment: await this.payments.payment(proofOf(request), holdId) };
  }
}
