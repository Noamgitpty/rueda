/**
 * API de lecture publique du socle de marque (US-034 ; 04 DSN-002, DSN-004), sans session : le
 * site lit la version publiée au rendu et applique ses variables CSS (aucune valeur codée en dur).
 *
 * | Route                      | Réponse                                                                |
 * | -------------------------- | ---------------------------------------------------------------------- |
 * | GET /brand                 | 200 version publiée (jetons, `css` prête, actifs) ; 304 si l'ETag      |
 * |                            | correspond ; 503 BRAND_VERSION_UNAVAILABLE (aucune : thème embarqué)   |
 * | GET /brand/content         | 200 blocs publiés `?locale=es|en|fr&country=XX` (repli es signalé)     |
 * | GET /brand/assets/:id      | 200 octets d'un actif publié (type vérifié, `nosniff`) ; 404 sinon     |
 *
 * Cache : `Cache-Control: public, max-age=<readCacheTtl>` et ETag par numéro de version ; le cache
 * du service est vidé à chaque publication (BrandConsoleService). Les actifs sont immuables
 * (identifiant = contenu figé) : cache long.
 */
import { Controller, Get, Headers, Inject, Param, Query, Res } from '@nestjs/common';
import { BrandReadService } from './brand.service.js';
import type { BrandFileStore, ContentView, PublishedTheme } from './brand.service.js';
import type { ContentLocale } from './checks.js';
import { CONTENT_LOCALES } from './checks.js';
import { BrandError, BrandHttpError } from './errors.js';
import { BRAND_FILES, BRAND_PARAMS } from './tokens.js';
import type { BrandParams } from './params.js';

interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  send(body?: unknown): unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTRY = /^[A-Z]{2}$/;

@Controller('brand')
export class BrandController {
  constructor(
    @Inject(BrandReadService) private readonly read: BrandReadService,
    @Inject(BRAND_FILES) private readonly files: BrandFileStore,
    @Inject(BRAND_PARAMS) private readonly params: BrandParams,
  ) {}

  #cache(response: Response): void {
    response.setHeader(
      'Cache-Control',
      `public, max-age=${Math.floor(this.params.readCacheTtlMs / 1000)}`,
    );
  }

  @Get()
  async theme(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublishedTheme | undefined> {
    const theme = await this.read.publishedTheme();
    if (theme === null) throw new BrandHttpError(new BrandError('BRAND_VERSION_UNAVAILABLE'));
    const etag = `"brand-${theme.versionNo}"`;
    this.#cache(response);
    response.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      response.status(304);
      return undefined;
    }
    return theme;
  }

  @Get('content')
  async content(
    @Query('locale') locale: unknown,
    @Query('country') country: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ locale: ContentLocale; country: string | null; blocks: ContentView[] }> {
    if (typeof locale !== 'string' || !(CONTENT_LOCALES as readonly string[]).includes(locale)) {
      throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    }
    if (country !== undefined && (typeof country !== 'string' || !COUNTRY.test(country))) {
      throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    }
    const c = typeof country === 'string' ? country : null;
    const blocks = await this.read.publishedContent(locale as ContentLocale, c);
    this.#cache(response);
    return { locale: locale as ContentLocale, country: c, blocks };
  }

  @Get('assets/:id')
  async asset(@Param('id') id: string, @Res() response: Response): Promise<void> {
    if (!UUID.test(id)) throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    const asset = await this.read.publicAsset(id);
    if (asset === null) throw new BrandHttpError(new BrandError('BRAND_VERSION_NOT_FOUND'));
    const got = await this.files.get('BRAND', asset.storageKey);
    if (got.status !== 'FOUND' || !('body' in got)) {
      throw new BrandHttpError(new BrandError('BRAND_ASSET_UNAVAILABLE'));
    }
    response.setHeader('Content-Type', asset.mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('ETag', `"${asset.sha256.toString('hex')}"`);
    response.status(200).send(got.body);
  }
}
