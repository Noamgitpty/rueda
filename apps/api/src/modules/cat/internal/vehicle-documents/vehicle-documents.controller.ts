/**
 * Routes de l'hôte : pièces et éligibilité du véhicule, contestation d'une plaque (US-124 ; 16
 * HST-019, HST-039 ; BOARD N-61 ; ADR-107). Toutes gardées par `SessionGuard` (JSON exigé pour une
 * écriture : parade CSRF) ; l'hôte est celui de la session (empreinte du jeton) ; un compte ou un
 * véhicule d'un autre hôte rend 404 comme un identifiant inconnu (L1-PM-11).
 *
 * | Route                                                          | Réponse                           |
 * | -------------------------------------------------------------- | --------------------------------- |
 * | GET  /host/accounts/{orgId}/vehicle-eligibility                | 200 statut, motifs, pièces        |
 * | PUT  /host/accounts/{orgId}/vehicles/{vehicleId}/declaration   | 200 VEHICLE_DECLARATION_SAVED     |
 * | POST /host/accounts/{orgId}/vehicles/{vehicleId}/documents     | 201 VEHICLE_DOCUMENT_ADDED ; 503  |
 * | POST /host/accounts/{orgId}/vehicles/{vehicleId}/eligibility   | 200 VEHICLE_ELIGIBILITY_SUBMITTED ;|
 * |                                                                | 422 / 409 avec `reasons`          |
 * | GET  /host/accounts/{orgId}/vehicle-claims                     | 200 contestations du compte       |
 * | POST /host/accounts/{orgId}/vehicle-claims                     | 201 VEHICLE_CLAIM_OPENED ; 503    |
 *
 * Pièces : corps JSON borné (100 Kio) en attendant l'URL de dépôt signée du stockage réel
 * (US-003, L1-PM-42) ; fail-closed (503) tant que l'antivirus ClamAV (DEC-FONDATEUR-20), le coffre
 * et le stockage objet ne sont pas branchés. Aucune route ne rend une pièce à l'hôte.
 */
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { principalOf, SessionGuard, sessionProofOf } from '../../../iam/index.js';
import { HostListingHttpError, hostListingBody } from '../host-listings/errors.js';
import { isUuid } from '../host-listings/model.js';
import { VehicleDocumentsService } from './vehicle-documents.service.js';

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

/** Personne de la session (clé de chiffrement de ses pièces) ; la base revérifie par le jeton. */
function userOf(request: Req): string {
  const p = principalOf(request);
  if (p === null) throw new HostListingHttpError('AUTH_REQUIRED');
  return p.userId;
}

function orgOf(orgId: string): string {
  if (!isUuid(orgId)) throw new HostListingHttpError('HOST_ACCOUNT_NOT_FOUND');
  return orgId;
}

function vehicleOf(vehicleId: string): string {
  if (!isUuid(vehicleId)) throw new HostListingHttpError('VEHICLE_NOT_FOUND');
  return vehicleId;
}

@Controller('host')
@UseGuards(SessionGuard)
export class VehicleDocumentsController {
  constructor(@Inject(VehicleDocumentsService) private readonly docs: VehicleDocumentsService) {}

  @Get('accounts/:orgId/vehicle-eligibility')
  async eligibility(@Req() request: Req, @Param('orgId') orgId: string) {
    return this.docs.eligibility(proofOf(request), orgOf(orgId));
  }

  @Put('accounts/:orgId/vehicles/:vehicleId/declaration')
  async declare(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    const r = await this.docs.declare(
      proofOf(request),
      orgOf(orgId),
      vehicleOf(vehicleId),
      bodyOf(request),
    );
    return hostListingBody(r.code);
  }

  /** Pièce encodée en base64 dans le corps JSON (`dataBase64`), type et fin de validité. */
  @Post('accounts/:orgId/vehicles/:vehicleId/documents')
  @HttpCode(201)
  async addDocument(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    const r = await this.docs.addDocument(
      proofOf(request),
      userOf(request),
      orgOf(orgId),
      vehicleOf(vehicleId),
      bodyOf(request),
    );
    return { ...hostListingBody(r.code), documentId: r.documentId };
  }

  @Post('accounts/:orgId/vehicles/:vehicleId/eligibility')
  @HttpCode(200)
  async submit(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    const r = await this.docs.submit(proofOf(request), orgOf(orgId), vehicleOf(vehicleId));
    return { ...hostListingBody(r.code), itemId: r.itemId };
  }

  @Get('accounts/:orgId/vehicle-claims')
  async claims(@Req() request: Req, @Param('orgId') orgId: string) {
    return this.docs.claims(proofOf(request), orgOf(orgId));
  }

  @Post('accounts/:orgId/vehicle-claims')
  @HttpCode(201)
  async openClaim(@Req() request: Req, @Param('orgId') orgId: string) {
    const r = await this.docs.openClaim(
      proofOf(request),
      userOf(request),
      orgOf(orgId),
      bodyOf(request),
    );
    return { ...hostListingBody(r.code), claimId: r.claimId };
  }
}
