/**
 * Routes de la messagerie par trip (US-525, ADR-181 ; 16 MSG-001 / MSG-007 ; écran S16). Gardées
 * par `SessionGuard` puis `TermsGuard` (CGU à jour, US-102 : toute route d'un trip le porte ; JSON
 * exigé pour une écriture : parade CSRF) ; la partie du trip est celle de
 * la SESSION (empreinte du jeton), jugée en base : voyageur, titulaire du compte d'hôte, co-hôte de
 * portée. Corps d'erreur `{ code, messageKey }` ; réponses `Cache-Control: no-store`.
 *
 * | Route                        | Réponse                                                         |
 * | ---------------------------- | --------------------------------------------------------------- |
 * | GET  /trips/{tripId}/messages | 200 TRIP_MESSAGES ; 401 ; 404 TRIP_NOT_FOUND ; 503              |
 * | POST /trips/{tripId}/messages | 201 MESSAGE_SENT ; 400 ; 401 ; 404 ; 409 MESSAGE_THREAD_CLOSED ; |
 * |                              | 415 ; 422 MESSAGE_INVALID ; 503                                  |
 *
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
import { TermsGuard } from '../../ctr/index.js';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import { MSG_TRIP_MESSAGES_SERVICE } from './tokens.js';
import type {
  MessageSentView,
  TripMessagesService,
  TripThreadView,
} from './trip-messages.service.js';

interface MsgRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface MsgResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripMessagesController {
  constructor(@Inject(MSG_TRIP_MESSAGES_SERVICE) private readonly messages: TripMessagesService) {}

  @Get(':tripId/messages')
  async thread(
    @Req() request: MsgRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: MsgResponse,
  ): Promise<TripThreadView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.messages.thread(sessionProofOf(request), tripId);
  }

  @Post(':tripId/messages')
  @HttpCode(201)
  async post(
    @Req() request: MsgRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: MsgResponse,
  ): Promise<MessageSentView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.messages.post(sessionProofOf(request), tripId, request.body);
  }
}
