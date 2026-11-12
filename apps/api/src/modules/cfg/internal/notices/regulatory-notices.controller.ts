/**
 * Avertissements réglementaires versionnés d'un pays (US-125 critère 4 ; 16 LEG-021) : limite
 * légale connue du partage de véhicule entre particuliers (plaque « particular », statut fiscal de
 * l'hôte…), lue dans la configuration pays (`countries.json`, aucune constante de pays dans le
 * code). Route publique : aucune session ; la réponse ne contient que l'identifiant, la version,
 * la date de mise en vigueur et la clé du catalogue `@rueda/i18n` du texte dans le public demandé.
 * Elle n'expose JAMAIS un interrupteur de mise en service ni sa valeur (critère 5).
 *
 * | Route                                             | Réponse                                  |
 * | ------------------------------------------------- | ---------------------------------------- |
 * | GET /regulatory-notices?country=XX&audience=HOST  | 200 avertissements du pays pour ce public |
 * |                                                   | 400 REQUEST_INVALID (pays ou public)     |
 */
import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { CountryConfigService } from '../country-config.service.js';
import { NOTICE_AUDIENCES } from '../model.js';
import type { NoticeAudience } from '../model.js';
import { BrandError, BrandHttpError } from '../brand/errors.js';

interface Response {
  setHeader(name: string, value: string): unknown;
}

export interface RegulatoryNoticeView {
  readonly id: string;
  readonly version: number;
  readonly since: string;
  /** Préfixe de la clé du catalogue : `<prefix>.title` et `<prefix>.body`. */
  readonly messageKey: string;
}

export interface RegulatoryNoticesResponse {
  readonly country: string;
  readonly audience: NoticeAudience;
  readonly notices: readonly RegulatoryNoticeView[];
}

/** Préfixe de la clé du catalogue d'un avertissement, pour un public. */
export function noticeMessageKey(id: string, version: number, audience: NoticeAudience): string {
  return `common.regulatory.${id}.v${version}.${audience === 'HOST' ? 'host' : 'guest'}`;
}

@Controller('regulatory-notices')
export class RegulatoryNoticesController {
  constructor(@Inject(CountryConfigService) private readonly cfg: CountryConfigService) {}

  @Get()
  notices(
    @Query('country') country: unknown,
    @Query('audience') audience: unknown,
    @Res({ passthrough: true }) response: Response,
  ): RegulatoryNoticesResponse {
    const entry = typeof country === 'string' ? this.cfg.config.countries.get(country) : undefined;
    if (
      entry === undefined ||
      typeof audience !== 'string' ||
      !(NOTICE_AUDIENCES as readonly string[]).includes(audience)
    ) {
      throw new BrandHttpError(new BrandError('REQUEST_INVALID'));
    }
    const who = audience as NoticeAudience;
    // données de configuration du déploiement : cache public court, aucune donnée personnelle
    response.setHeader('Cache-Control', 'public, max-age=300');
    return {
      country: entry.code,
      audience: who,
      notices: entry.regulatoryNotices
        .filter((n) => n.audiences.includes(who))
        .map((n) => ({
          id: n.id,
          version: n.version,
          since: n.since,
          messageKey: noticeMessageKey(n.id, n.version, who),
        })),
    };
  }
}
