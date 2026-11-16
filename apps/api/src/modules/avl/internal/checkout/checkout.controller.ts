/**
 * Routes du checkout (US-208, partie back-end ; 16 BKG-001 ; écran S05 ; ADR-133). Routes de
 * réservation : `SessionGuard` puis `TermsGuard` (CGU à jour, US-102, N-43, L2-PM-31) sur la
 * classe. Le voyageur est celui de la session ; le client n'envoie jamais de montant (L2-PM-03).
 * Aucun cache partagé : prix, validité et état du hold changent à tout moment.
 *
 * | Route                                     | Réponse                                                  |
 * | ----------------------------------------- | -------------------------------------------------------- |
 * | POST /checkout/quotes                     | 201 devis figé (lignes, total, validité, documents) ;    |
 * |                                           | 400 QUOTE_INPUT_INVALID ; 404 LISTING_NOT_FOUND ; 409    |
 * |                                           | QUOTE_MISMATCH ; 422 QUOTE_UNAVAILABLE ; 429             |
 * |                                           | QUOTE_RATE_LIMITED ; 503                                 |
 * | GET /checkout/quotes/{quoteId}            | 200 devis figé ; 404 QUOTE_NOT_FOUND                     |
 * | POST /checkout/quotes/{quoteId}/hold      | 201 hold CHECKOUT ; 404 ; 409 QUOTE_EXPIRED … ; 422 … ;  |
 * |                                           | 403 SELF_BOOKING_FORBIDDEN … ; 503                       |
 * | GET /checkout/holds/{holdId}              | 200 hold, devis engagé et versions acceptées ; 404       |
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
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { QuoteHttpError } from '../../../prc/index.js';
import { CheckoutService } from './checkout.service.js';

/** Requête lue par les routes (nom distinct du décorateur `Req` de Nest). */
interface CheckoutRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

function proofOf(request: CheckoutRequest): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new QuoteHttpError('AUTH_REQUIRED');
  return proof;
}

@Controller('checkout')
@UseGuards(SessionGuard, TermsGuard)
export class CheckoutController {
  constructor(@Inject(CheckoutService) private readonly checkout: CheckoutService) {}

  @Post('quotes')
  @HttpCode(201)
  async createQuote(
    @Req() request: CheckoutRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { quote: await this.checkout.createQuote(proofOf(request), request.body) };
  }

  @Get('quotes/:quoteId')
  async quote(
    @Req() request: CheckoutRequest,
    @Param('quoteId') quoteId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { quote: await this.checkout.quote(proofOf(request), quoteId) };
  }

  @Post('quotes/:quoteId/hold')
  @HttpCode(201)
  async hold(
    @Req() request: CheckoutRequest,
    @Param('quoteId') quoteId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { hold: await this.checkout.checkout(proofOf(request), quoteId, request.body) };
  }

  @Get('holds/:holdId')
  async holdOf(
    @Req() request: CheckoutRequest,
    @Param('holdId') holdId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { hold: await this.checkout.hold(proofOf(request), holdId) };
  }
}
