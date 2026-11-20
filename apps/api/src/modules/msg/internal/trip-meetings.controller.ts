/**
 * Routes des rendez-vous d'un trip (US-316, ADR-186 ; 19 US-316 critère 4 ; écran S16). Gardées par
 * `SessionGuard` puis `TermsGuard` (CGU à jour, US-102 ; JSON exigé pour une écriture : parade
 * CSRF) ; la partie du trip est celle de la SESSION (empreinte du jeton), jugée en base : voyageur,
 * titulaire du compte d'hôte, co-hôte de portée. Corps d'erreur `{ code, messageKey }` ; réponses
 * `Cache-Control: no-store`.
 *
 * | Route                                             | Réponse                                     |
 * | ------------------------------------------------- | ------------------------------------------- |
 * | GET  /trips/{tripId}/meetings                     | 200 TRIP_MEETINGS ; 401 ; 404 ; 503         |
 * | POST /trips/{tripId}/meetings                     | 201 MEETING_PROPOSED ; 400 ; 401 ; 403 ;    |
 * |                                                   | 404 ; 415 ; 422 ; 503                       |
 * | POST /trips/{tripId}/meetings/{meetingId}/answer  | 200 MEETING_ANSWERED ; 400 ; 401 ; 403 ;    |
 * |                                                   | 404 ; 409 ; 415 ; 503                       |
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
import { MSG_TRIP_MEETINGS_SERVICE } from './tokens.js';
import type {
  MeetingAnsweredView,
  MeetingProposedView,
  TripMeetingsService,
  TripMeetingsView,
} from './trip-meetings.service.js';

interface MsgRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface MsgResponse {
  setHeader(name: string, value: string): unknown;
}

@Controller('trips')
@UseGuards(SessionGuard, TermsGuard)
export class TripMeetingsController {
  constructor(@Inject(MSG_TRIP_MEETINGS_SERVICE) private readonly meetings: TripMeetingsService) {}

  @Get(':tripId/meetings')
  async list(
    @Req() request: MsgRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: MsgResponse,
  ): Promise<TripMeetingsView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.meetings.list(sessionProofOf(request), tripId);
  }

  @Post(':tripId/meetings')
  @HttpCode(201)
  async propose(
    @Req() request: MsgRequest,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: MsgResponse,
  ): Promise<MeetingProposedView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.meetings.propose(sessionProofOf(request), tripId, request.body);
  }

  @Post(':tripId/meetings/:meetingId/answer')
  @HttpCode(200)
  async answer(
    @Req() request: MsgRequest,
    @Param('tripId') tripId: string,
    @Param('meetingId') meetingId: string,
    @Res({ passthrough: true }) response: MsgResponse,
  ): Promise<MeetingAnsweredView> {
    response.setHeader('Cache-Control', 'no-store');
    return this.meetings.answer(sessionProofOf(request), tripId, meetingId, request.body);
  }
}
