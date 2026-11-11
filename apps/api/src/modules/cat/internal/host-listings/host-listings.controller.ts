/**
 * Routes de l'hôte : lieux de remise, véhicules, annonces et catalogue de référence (US-115 ;
 * ADR-099). Toutes gardées par `SessionGuard` (JSON exigé pour une écriture : parade CSRF) ;
 * l'hôte est celui de la session (empreinte du jeton), le compte d'hôte `{orgId}` l'un de ses
 * comptes titulaires, revérifié en base. Un compte, un lieu, un véhicule ou une annonce d'un autre
 * hôte rend 404 comme un identifiant inconnu (17 §2.3 point 5, L1-PM-11). Corps d'erreur
 * `{ code, messageKey[, fields] }`, clé du catalogue @rueda/i18n.
 *
 * | Route                                                       | Réponse                                   |
 * | ----------------------------------------------------------- | ----------------------------------------- |
 * | GET  /host/accounts/{orgId}/locations                       | 200 lieux (exacts : l'hôte seul)          |
 * | POST /host/accounts/{orgId}/locations                       | 201 LOCATION_CREATED                      |
 * | GET  /host/accounts/{orgId}/vehicles                        | 200 véhicules                             |
 * | POST /host/accounts/{orgId}/vehicles                        | 201 VEHICLE_CREATED ; 409 doublon         |
 * | GET  /host/accounts/{orgId}/listings                        | 200 annonces                              |
 * | POST /host/accounts/{orgId}/listings                        | 201 LISTING_CREATED (DRAFT)               |
 * | PUT  /host/accounts/{orgId}/listings/{listingId}/pricing    | 200 LISTING_SAVED                         |
 * | POST /host/accounts/{orgId}/listings/{listingId}/submit     | 200 LISTING_SUBMITTED ; 422 photos, hôte  |
 * | DELETE /host/accounts/{orgId}/listings/{listingId}          | 200 LISTING_DELETED                       |
 * | GET  /host/accounts/{orgId}/catalog/…                       | 200 listes de choix du marché du compte   |
 *
 * Photos : le dépôt HTTP arrive avec l'URL de dépôt signée du stockage réel (US-003, L1-PM-42) ;
 * le service (`addPhoto`) et la base sont prêts, fail-closed (503) sans antivirus (Q-019).
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostListingHttpError, hostListingBody } from './errors.js';
import { HostListingsService } from './host-listings.service.js';
import { isUuid } from './model.js';

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

/** Identifiant d'un compte d'hôte : mal formé ⇒ 404, comme un compte inconnu. */
function orgOf(orgId: string): string {
  if (!isUuid(orgId)) throw new HostListingHttpError('HOST_ACCOUNT_NOT_FOUND');
  return orgId;
}

function listingOf(listingId: string): string {
  if (!isUuid(listingId)) throw new HostListingHttpError('LISTING_NOT_FOUND');
  return listingId;
}

@Controller('host')
@UseGuards(SessionGuard)
export class HostListingsController {
  constructor(@Inject(HostListingsService) private readonly listings: HostListingsService) {}

  @Get('accounts/:orgId/locations')
  async locationsOf(@Req() request: Req, @Param('orgId') orgId: string) {
    return { locations: await this.listings.locations(proofOf(request), orgOf(orgId)) };
  }

  @Post('accounts/:orgId/locations')
  @HttpCode(201)
  async createLocation(@Req() request: Req, @Param('orgId') orgId: string) {
    const r = await this.listings.createLocation(proofOf(request), orgOf(orgId), bodyOf(request));
    return { ...hostListingBody(r.code), locationId: r.locationId };
  }

  @Get('accounts/:orgId/vehicles')
  async vehiclesOf(@Req() request: Req, @Param('orgId') orgId: string) {
    return { vehicles: await this.listings.vehicles(proofOf(request), orgOf(orgId)) };
  }

  @Post('accounts/:orgId/vehicles')
  @HttpCode(201)
  async createVehicle(@Req() request: Req, @Param('orgId') orgId: string) {
    const r = await this.listings.createVehicle(proofOf(request), orgOf(orgId), bodyOf(request));
    return { ...hostListingBody(r.code), vehicleId: r.vehicleId };
  }

  @Get('accounts/:orgId/listings')
  async listingsOf(@Req() request: Req, @Param('orgId') orgId: string) {
    return { listings: await this.listings.listings(proofOf(request), orgOf(orgId)) };
  }

  @Post('accounts/:orgId/listings')
  @HttpCode(201)
  async createListing(@Req() request: Req, @Param('orgId') orgId: string) {
    const r = await this.listings.createListing(proofOf(request), orgOf(orgId), bodyOf(request));
    return { ...hostListingBody(r.code), listingId: r.listingId };
  }

  @Put('accounts/:orgId/listings/:listingId/pricing')
  async pricing(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('listingId') listingId: string,
  ) {
    const r = await this.listings.updatePricing(
      proofOf(request),
      orgOf(orgId),
      listingOf(listingId),
      bodyOf(request),
    );
    return hostListingBody(r.code);
  }

  @Post('accounts/:orgId/listings/:listingId/submit')
  @HttpCode(200)
  async submit(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('listingId') listingId: string,
  ) {
    const r = await this.listings.submit(proofOf(request), orgOf(orgId), listingOf(listingId));
    return { ...hostListingBody(r.code), status: r.status };
  }

  @Delete('accounts/:orgId/listings/:listingId')
  async remove(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('listingId') listingId: string,
  ) {
    const r = await this.listings.remove(proofOf(request), orgOf(orgId), listingOf(listingId));
    return { ...hostListingBody(r.code), status: r.status };
  }

  @Get('accounts/:orgId/catalog/makes')
  async makes(@Req() request: Req, @Param('orgId') orgId: string) {
    return { makes: await this.listings.makes(proofOf(request), orgOf(orgId)) };
  }

  @Get('accounts/:orgId/catalog/makes/:makeId/models')
  async models(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('makeId') makeId: string,
  ) {
    return { models: await this.listings.models(proofOf(request), orgOf(orgId), makeId) };
  }

  @Get('accounts/:orgId/catalog/models/:modelId/variants')
  async variants(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('modelId') modelId: string,
    @Query('year') year: unknown,
  ) {
    let y: number | null = null;
    if (year !== undefined) {
      if (typeof year !== 'string' || !/^[0-9]{4}$/.test(year)) {
        throw new HostListingHttpError('REQUEST_INVALID');
      }
      y = Number(year);
    }
    return { variants: await this.listings.variants(proofOf(request), orgOf(orgId), modelId, y) };
  }

  @Get('accounts/:orgId/catalog/variants/:variantId/prefill')
  async prefill(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('variantId') variantId: string,
  ) {
    return { prefill: await this.listings.prefill(proofOf(request), orgOf(orgId), variantId) };
  }
}
