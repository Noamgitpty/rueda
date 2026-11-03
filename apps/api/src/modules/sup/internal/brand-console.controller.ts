/**
 * Console « Apparence / Marque » côté API (US-034 ; 16 DSN-003 / DSN-004 ; l'écran est US-120).
 * Toutes les routes exigent `StaffGuard` (session élevée par TOTP) ; aucune ne reçoit d'identifiant
 * d'acteur : la base relit l'acteur, sa permission (`brand.edit` / `brand.publish`) et sa portée
 * pays depuis l'empreinte du jeton, et journalise refus et actions.
 *
 * | Route                                    | Réponse                                                 |
 * | ---------------------------------------- | ------------------------------------------------------- |
 * | POST /console/brand/assets               | 201 actif enregistré (base64, type vérifié)             |
 * | POST /console/brand/drafts               | 201 brouillon (jetons DTCG ou `fromPalette`) ; 422      |
 * |                                          | FONT_NOT_APPROVED / BRAND_TOKENS_INVALID                |
 * | GET  /console/brand/versions[/:id]       | 200 historique (brouillons compris, prévisualisation)  |
 * | POST /console/brand/versions/:id/publish | 200 publiée ; 422 BRAND_CONTRAST_INSUFFICIENT (paires)  |
 * | POST /console/brand/rollback             | 201 retour arrière en un clic (`targetVersionId` facult.)|
 * | POST /console/content/drafts             | 201 brouillon es + en + fr ; 422 si une langue manque   |
 * | POST /console/content/publish            | 200 publié                                              |
 * | POST /console/content/rollback           | 201 version précédente rétablie                         |
 *
 * Refus d'accès : 401 AUTH_REQUIRED, 403 2FA_REQUIRED, 403 FORBIDDEN (journalisés par la base).
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  BrandAccessError,
  BrandConsoleService,
  BrandError,
  BrandHttpError,
} from '../../cfg/index.js';
import type { StaffVersion } from '../../cfg/index.js';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTRY = /^[A-Z]{2}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

interface StatusResponse {
  status(code: number): unknown;
}

function fields(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
  }
  return body as Record<string, unknown>;
}

function uuid(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
  }
  return value;
}

function country(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !COUNTRY.test(value)) {
    throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
  }
  return value;
}

function versionNo(value: unknown, optional = false): number | null {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
  }
  return value;
}

function tokenHash(request: object): Buffer {
  const principal = staffPrincipalOf(request);
  if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
  return principal.tokenHash;
}

/** Erreurs du domaine et de la base -> réponses HTTP stables. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BrandError) throw new BrandHttpError(error);
    if (error instanceof BrandAccessError) {
      throw new AuthHttpError(
        error.outcome === 'MFA_REQUIRED'
          ? '2FA_REQUIRED'
          : error.outcome === 'AUTH_REQUIRED'
            ? 'AUTH_REQUIRED'
            : 'FORBIDDEN',
      );
    }
    const sqlstate = (error as { sqlstate?: string }).sqlstate;
    // données refusées par la base (22023 paramètre, 23514 contrainte, 23503 référence) : le
    // contrôle TypeScript aurait dû les arrêter avant ; aucun détail de la base n'est rendu
    if (sqlstate === '22023' || sqlstate === '23514' || sqlstate === '23503') {
      throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    }
    // unicité (rejeu concurrent non sérialisé, collision d'identifiant) : conflit, jamais un 500
    if (sqlstate === '23505') throw new BrandHttpError(new BrandError('VERSION_CONFLICT'));
    throw error;
  }
}

/** Vue d'une version pour la console : aucun identifiant interne superflu. */
function versionView(v: StaffVersion) {
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    brandName: v.brandName,
    tokens: v.tokens,
    tokensSchemaVersion: v.tokensSchemaVersion,
    logoAssetId: v.logoAssetId,
    faviconAssetId: v.faviconAssetId,
    pwaIconAssetId: v.pwaIconAssetId,
    contrastCheck: v.contrastCheck,
    copiedFromId: v.copiedFromId,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
    publishedBy: v.publishedBy,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    archivedAt: v.archivedAt?.toISOString() ?? null,
  };
}

@Controller('console')
export class BrandConsoleController {
  constructor(@Inject(BrandConsoleService) private readonly brand: BrandConsoleService) {}

  @Post('brand/assets')
  @UseGuards(StaffGuard)
  async asset(@Req() request: object, @Body() body: unknown) {
    const hash = tokenHash(request);
    const b = fields(body);
    const requestId = uuid(b['requestId']) as string;
    const content = b['contentBase64'];
    if (typeof content !== 'string' || content.length === 0 || !BASE64.test(content)) {
      throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    }
    return run(() =>
      this.brand.registerAsset(hash, {
        requestId,
        kind: typeof b['kind'] === 'string' ? b['kind'] : '',
        body: Buffer.from(content, 'base64'),
        alt: b['alt'],
        licenseNote: b['licenseNote'],
      }),
    );
  }

  @Post('brand/drafts')
  @UseGuards(StaffGuard)
  async draft(@Req() request: object, @Body() body: unknown) {
    const hash = tokenHash(request);
    const b = fields(body);
    return run(() =>
      this.brand.saveDraft(hash, {
        requestId: uuid(b['requestId']) as string,
        brandName: b['brandName'],
        tokens: b['tokens'],
        fromPalette: b['fromPalette'],
        logoAssetId: uuid(b['logoAssetId'], true),
        faviconAssetId: uuid(b['faviconAssetId'], true),
        pwaIconAssetId: uuid(b['pwaIconAssetId'], true),
        copiedFromId: uuid(b['copiedFromId'], true),
      }),
    );
  }

  @Get('brand/versions')
  @UseGuards(StaffGuard)
  async versions(@Req() request: object, @Query('limit') limit: unknown) {
    const hash = tokenHash(request);
    const n = typeof limit === 'string' && /^\d{1,3}$/.test(limit) ? Number(limit) : 20;
    const list = await run(() => this.brand.versions(hash, null, n));
    return { versions: list.map(versionView) };
  }

  @Get('brand/versions/:id')
  @UseGuards(StaffGuard)
  async version(@Req() request: object, @Param('id') id: string) {
    const hash = tokenHash(request);
    const versionId = uuid(id) as string;
    const found = (await run(() => this.brand.versions(hash, versionId, 1)))[0];
    if (found === undefined) throw new BrandHttpError(new BrandError('BRAND_VERSION_NOT_FOUND'));
    return versionView(found);
  }

  @Post('brand/versions/:id/publish')
  @UseGuards(StaffGuard)
  async publish(
    @Req() request: object,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const hash = tokenHash(request);
    const versionId = uuid(id) as string;
    const requestId = uuid(fields(body)['requestId']) as string;
    response.status(200);
    return run(() => this.brand.publish(hash, requestId, versionId));
  }

  @Post('brand/rollback')
  @UseGuards(StaffGuard)
  async rollback(@Req() request: object, @Body() body: unknown) {
    const hash = tokenHash(request);
    const b = fields(body);
    const requestId = uuid(b['requestId']) as string;
    const target = uuid(b['targetVersionId'], true);
    return run(() => this.brand.rollback(hash, requestId, target));
  }

  @Post('content/drafts')
  @UseGuards(StaffGuard)
  async contentDraft(@Req() request: object, @Body() body: unknown) {
    const hash = tokenHash(request);
    const b = fields(body);
    const requestId = uuid(b['requestId']) as string;
    const c = country(b['country']);
    const assetId = uuid(b['assetId'], true);
    return run(() =>
      this.brand.saveContentDraft(hash, requestId, b['key'], c, b['bodies'], assetId),
    );
  }

  @Post('content/publish')
  @UseGuards(StaffGuard)
  async contentPublish(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const hash = tokenHash(request);
    const b = fields(body);
    const requestId = uuid(b['requestId']) as string;
    const c = country(b['country']);
    const no = versionNo(b['versionNo']) as number;
    response.status(200);
    return run(() => this.brand.publishContent(hash, requestId, b['key'], c, no));
  }

  @Post('content/rollback')
  @UseGuards(StaffGuard)
  async contentRollback(@Req() request: object, @Body() body: unknown) {
    const hash = tokenHash(request);
    const b = fields(body);
    const requestId = uuid(b['requestId']) as string;
    const c = country(b['country']);
    const target = versionNo(b['targetVersionNo'], true);
    return run(() => this.brand.rollbackContent(hash, requestId, b['key'], c, target));
  }
}
