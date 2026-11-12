/**
 * Routes du calendrier de l'hôte (US-119 ; 16 CAL-001 / CAL-002, CAL-003 ; écran A06 ; ADR-101).
 * Gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) ; l'hôte est celui de la
 * session, le compte `{orgId}` l'un de ses comptes titulaires, revérifié en base.
 *
 * | Route                                                          | Réponse                            |
 * | -------------------------------------------------------------- | ---------------------------------- |
 * | GET    /host/accounts/{orgId}/vehicles/{vehicleId}/calendar    | 200 véhicule et occupations à venir |
 * | POST   /host/accounts/{orgId}/vehicles/{vehicleId}/blocks      | 201 BLOCK_CREATED ; 409 ; 422      |
 * | DELETE /host/accounts/{orgId}/vehicles/{vehicleId}/blocks/{id} | 200 BLOCK_REMOVED ; 404            |
 * | PUT    /host/accounts/{orgId}/locations/{locationId}/notice    | 200 NOTICE_SAVED ; 404 ; 422       |
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostListingHttpError, hostListingBody } from '../host-listings/errors.js';
import { isUuid } from '../host-listings/model.js';
import { HostCalendarService } from './host-calendar.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HostListingHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function proofOf(request: Req): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new HostListingHttpError('AUTH_REQUIRED');
  return proof;
}

/** Identifiant mal formé ⇒ 404, comme un identifiant inconnu (rien n'est révélé). */
function idOf(
  id: string,
  code: 'HOST_ACCOUNT_NOT_FOUND' | 'VEHICLE_NOT_FOUND' | 'LOCATION_NOT_FOUND' | 'BLOCK_NOT_FOUND',
): string {
  if (!isUuid(id)) throw new HostListingHttpError(code);
  return id.toLowerCase();
}

@Controller('host')
@UseGuards(SessionGuard)
export class HostCalendarController {
  constructor(@Inject(HostCalendarService) private readonly calendar: HostCalendarService) {}

  @Get('accounts/:orgId/vehicles/:vehicleId/calendar')
  async calendarOf(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.calendar.calendar(
      proofOf(request),
      idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'),
      idOf(vehicleId, 'VEHICLE_NOT_FOUND'),
    );
  }

  @Post('accounts/:orgId/vehicles/:vehicleId/blocks')
  @HttpCode(201)
  async block(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    const r = await this.calendar.placeBlock(
      proofOf(request),
      idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'),
      idOf(vehicleId, 'VEHICLE_NOT_FOUND'),
      bodyOf(request),
    );
    return { ...hostListingBody(r.code), blockId: r.blockId };
  }

  @Delete('accounts/:orgId/vehicles/:vehicleId/blocks/:blockId')
  async unblock(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
    @Param('blockId') blockId: string,
  ) {
    const r = await this.calendar.removeBlock(
      proofOf(request),
      idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'),
      idOf(vehicleId, 'VEHICLE_NOT_FOUND'),
      idOf(blockId, 'BLOCK_NOT_FOUND'),
    );
    return hostListingBody(r.code);
  }

  @Put('accounts/:orgId/locations/:locationId/notice')
  async notice(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('locationId') locationId: string,
  ) {
    const r = await this.calendar.setNotice(
      proofOf(request),
      idOf(orgId, 'HOST_ACCOUNT_NOT_FOUND'),
      idOf(locationId, 'LOCATION_NOT_FOUND'),
      bodyOf(request),
    );
    return hostListingBody(r.code);
  }
}
