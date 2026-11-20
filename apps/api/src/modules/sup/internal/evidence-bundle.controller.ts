/**
 * Dossier de preuve d'un trip dans la console (US-308, ADR-184 ; 16 CLM-034, bêta SIMPLIFIÉ :
 * « export ZIP … généré à la demande par l'ops » ; pré-mortem L3-PM-47, RT-L3-D03).
 *
 * | Route                                          | Réponse (succès)                 | Refus propres                  |
 * | ---------------------------------------------- | -------------------------------- | ------------------------------ |
 * | POST /console/evidence-bundles                 | 201 dossier scellé (REQUESTED) ; | 403 STAFF_CASE_REQUIRED,       |
 * |                                                | 200 rejeu de la même requête     | STAFF_SELF_FORBIDDEN ; 503     |
 * | GET /console/evidence-bundles/:bundleId        | 200 état (EXPIRED calculé),      | 404 EVIDENCE_BUNDLE_NOT_FOUND  |
 * |                                                | empreintes, pièces absentes      |                                |
 * | POST /console/evidence-bundles/:bundleId/      | 200 `application/zip` (archive   | 409 EVIDENCE_EXPORT_NOT_READY, |
 * |      download                                  | déchiffrée, SHA-256 revérifié)   | EVIDENCE_EXPORT_FAILED ; 410 ; |
 * |                                                |                                  | 403 ; 404 ; 503                |
 *
 * Toutes : StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED), 400 REQUEST_INVALID. La
 * base juge chaque droit (session élevée, `evidence.export` dans le pays du dossier de support
 * OUVERT de ce trip assigné à l'agent, garde ADR-122), scelle le manifeste et journalise chaque
 * demande, chaque ouverture et chaque refus. Le téléchargement est un POST : un motif (`reason`,
 * 10 à 500 caractères) est exigé et journalisé. Seul le demandeur lit l'état et ouvre l'archive ;
 * aucun hôte, voyageur ni co-hôte n'a de route ; le dossier d'un autre agent répond 404
 * EVIDENCE_BUNDLE_NOT_FOUND (journalisé). Production (bêta) : coffre et stockage absents ⇒ la base
 * juge et journalise d'abord (refus 401 / 403), puis 503 EVIDENCE_EXPORT_UNAVAILABLE et la
 * transaction est annulée : aucun dossier n'est scellé, aucune archive n'est servie.
 */
import { randomUUID } from 'node:crypto';
import {
  Body,
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
import {
  EVIDENCE_PURPOSES,
  EvidenceBundleHttpError,
  EvidenceStoreError,
  EvidenceUnavailableError,
} from '../../clm/index.js';
import type { EvidenceBundleService, EvidencePurpose, EvidenceStaff } from '../../clm/index.js';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import { OpsHttpError } from './ops-errors.js';
import { staffActorOf } from './staff-context.js';
import { EVIDENCE_BUNDLE_SERVICE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Reply {
  setHeader(name: string, value: string): void;
  status(code: number): Reply;
  send(body?: unknown): unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function reasonOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 10 && t.length <= 500 ? t : null;
}

/** Refus communs : session, TOTP, permission, dossier, séparation des tâches. */
function refusal(outcome: string): never {
  switch (outcome) {
    case 'AUTH_REQUIRED':
      throw new AuthHttpError('AUTH_REQUIRED');
    case 'MFA_REQUIRED':
      throw new AuthHttpError('2FA_REQUIRED');
    case 'CASE_REQUIRED':
      throw new OpsHttpError('STAFF_CASE_REQUIRED');
    case 'SELF_FORBIDDEN':
      throw new OpsHttpError('STAFF_SELF_FORBIDDEN');
    case 'REQUEST_INVALID':
      throw new AuthHttpError('REQUEST_INVALID');
    case 'NOT_FOUND':
      throw new EvidenceBundleHttpError('EVIDENCE_BUNDLE_NOT_FOUND');
    case 'NOT_READY':
      throw new EvidenceBundleHttpError('EVIDENCE_EXPORT_NOT_READY');
    case 'EXPIRED':
      throw new EvidenceBundleHttpError('EVIDENCE_EXPORT_EXPIRED');
    case 'FAILED':
    case 'INTEGRITY':
      throw new EvidenceBundleHttpError('EVIDENCE_EXPORT_FAILED');
    case 'UNAVAILABLE':
      throw new EvidenceBundleHttpError('EVIDENCE_EXPORT_UNAVAILABLE');
    default:
      throw new AuthHttpError('FORBIDDEN');
  }
}

/** Panne du coffre ou de la base : 503 (22023 : entrée refusée par la base, 400). */
function unavailable(error: unknown): never {
  if (error instanceof EvidenceStoreError && error.sqlstate === '22023') {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  if (error instanceof EvidenceStoreError || error instanceof EvidenceUnavailableError) {
    throw new EvidenceBundleHttpError('EVIDENCE_EXPORT_UNAVAILABLE');
  }
  throw error;
}

@Controller('console')
export class EvidenceBundleController {
  constructor(@Inject(EVIDENCE_BUNDLE_SERVICE) private readonly evidence: EvidenceBundleService) {}

  #staff(request: object): EvidenceStaff {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    return staffActorOf(principal);
  }

  @Post('evidence-bundles')
  @UseGuards(StaffGuard)
  async request(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const staff = this.#staff(request);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const { requestId, tripId, caseId, purpose } = body;
    const reason = reasonOf(body['reason']);
    if (
      typeof tripId !== 'string' ||
      !UUID.test(tripId) ||
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof caseId !== 'string' ||
      !UUID.test(caseId) ||
      typeof purpose !== 'string' ||
      !EVIDENCE_PURPOSES.includes(purpose as EvidencePurpose) ||
      reason === null
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    let r: Awaited<ReturnType<EvidenceBundleService['request']>>;
    try {
      r = await this.evidence.request(staff, {
        requestId,
        tripId,
        caseId,
        purpose: purpose as EvidencePurpose,
        reason,
      });
    } catch (error) {
      unavailable(error);
    }
    if (r.outcome !== 'REQUESTED' && r.outcome !== 'ALREADY_REQUESTED') refusal(r.outcome);
    reply.status(r.outcome === 'REQUESTED' ? 201 : 200);
    return { bundleId: r.bundleId, status: r.status, manifestSha256: r.manifestSha256 };
  }

  @Get('evidence-bundles/:bundleId')
  @UseGuards(StaffGuard)
  async status(@Req() request: object, @Param('bundleId') bundleId: string) {
    const staff = this.#staff(request);
    if (!UUID.test(bundleId)) throw new AuthHttpError('REQUEST_INVALID');
    let r: Awaited<ReturnType<EvidenceBundleService['status']>>;
    try {
      r = await this.evidence.status(staff, randomUUID(), bundleId);
    } catch (error) {
      unavailable(error);
    }
    if (r.outcome !== 'OK') refusal(r.outcome);
    return r.body;
  }

  @Post('evidence-bundles/:bundleId/download')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async download(
    @Req() request: object,
    @Param('bundleId') bundleId: string,
    @Body() body: unknown,
    @Res() reply: Reply,
  ): Promise<void> {
    const staff = this.#staff(request);
    const reason = isObject(body) ? reasonOf(body['reason']) : null;
    if (!UUID.test(bundleId) || reason === null) throw new AuthHttpError('REQUEST_INVALID');
    let r: Awaited<ReturnType<EvidenceBundleService['download']>>;
    try {
      r = await this.evidence.download(staff, randomUUID(), bundleId, reason);
    } catch (error) {
      unavailable(error);
    }
    if (r.outcome !== 'OK') refusal(r.outcome);
    reply.setHeader('Content-Type', 'application/zip');
    reply.setHeader('Content-Disposition', `attachment; filename="${r.archive.fileName}"`);
    reply.setHeader('Cache-Control', 'no-store');
    reply.setHeader('X-Evidence-Sha256', r.archive.sha256);
    reply.setHeader('X-Evidence-Manifest-Sha256', r.archive.manifestSha256);
    reply.status(200).send(r.archive.bytes);
  }
}
