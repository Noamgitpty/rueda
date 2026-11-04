/**
 * Durcissement HTTP de l'API (US-043, ADR-077 ; 17 §6.6 « exigences de sécurité », ASVS niveau 2
 * V12 / V13 / V14 retenus). Appliqué par `main.ts` AVANT `listen`, et par les tests sur
 * l'application réelle (`ApiModule`), jamais recopié :
 *
 * 1. En-têtes de sécurité sur TOUTE réponse (route, erreur, 404, 413) : `SECURITY_HEADERS`. Une
 *    route peut en remplacer un (ex. `Cache-Control` public des lectures de marque, US-034).
 *    `X-Powered-By` est retiré.
 * 2. Corps de requête bornés : JSON et formulaire à `API_BODY_LIMIT_BYTES` (100 Kio, PROPOSÉ :
 *    la valeur implicite d'Express, désormais explicite et testée ; l'actif de marque le plus lourd
 *    tient en 64 Kio, soit environ 88 Kio en base64). Au-delà : 413.
 * 3. CORS : aucun. L'API ne sert que des clients de même origine (site et back-office passent par
 *    leur mandataire `/api`) ; aucune en-tête `Access-Control-Allow-*` n'est jamais émise, même
 *    pour une requête préliminaire (`OPTIONS`) venue d'une autre origine (fail-closed, PROPOSÉ).
 * 4. Erreurs sans fuite : toute erreur HTTP SANS corps métier (`code`) — corps JSON illisible,
 *    corps trop gros, route inconnue, erreur interne — est rendue `{ code, messageKey }`, sans
 *    écho de la requête. Le message brut d'Express ou de Nest reprend sinon un extrait du corps
 *    (« Unexpected token … "jean@exemple.com" … ») ou l'URL avec sa requête (« Cannot GET
 *    /x?email=… ») : une donnée personnelle renvoyée au client. Les corps métier des modules
 *    (`AuthHttpError`, `BrandHttpError`, `RiskHttpError`) passent tels quels.
 */
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Taille maximale d'un corps JSON ou formulaire (octets, PROPOSÉ). */
export const API_BODY_LIMIT_BYTES = 100 * 1024;

/** En-têtes posés sur toute réponse de l'API (PROPOSÉ, ASVS V14.4). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // une route qui sert une ressource publique et stable remplace cette valeur (US-034)
  'Cache-Control': 'no-store',
};

/** Code stable par statut pour les erreurs sans corps métier (PROPOSÉ, à reporter dans 16 A.8). */
export function hygienicCode(status: number): string {
  if (status === 404) return 'NOT_FOUND';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'REQUEST_INVALID';
}

/** Clé de message du catalogue (texte existant en es, en, fr, pt : aucun texte nouveau). */
export const HYGIENIC_MESSAGE_KEY = 'common.auth.requestInvalid';

const hasBusinessCode = (body: unknown): boolean =>
  body !== null &&
  typeof body === 'object' &&
  typeof (body as { code?: unknown }).code === 'string';

/**
 * Filtre global : corps métier inchangés ; toute autre erreur HTTP réduite à `{ code, messageKey }`
 * (statut conservé) ; une exception non HTTP passe au filtre de base de Nest (journal, 500
 * générique sans détail).
 */
@Catch()
export class ErrorHygieneFilter extends BaseExceptionFilter {
  readonly #adapter: HttpServer;

  constructor(adapter: HttpServer) {
    super(adapter);
    this.#adapter = adapter;
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    let status: number;
    if (exception instanceof HttpException) {
      if (hasBusinessCode(exception.getResponse())) {
        super.catch(exception, host);
        return;
      }
      status = exception.getStatus();
    } else {
      // erreur HTTP d'un intergiciel (analyseur de corps : 413, 415…), passée telle quelle par Nest
      const code = (exception as { statusCode?: unknown } | null)?.statusCode;
      if (typeof code !== 'number' || code < 400 || code > 599) {
        super.catch(exception, host);
        return;
      }
      status = code;
    }
    const response = host.switchToHttp().getResponse<unknown>();
    this.#adapter.reply(
      response,
      { code: hygienicCode(status), messageKey: HYGIENIC_MESSAGE_KEY },
      status,
    );
  }
}

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

/** Applique le durcissement HTTP à l'application (avant `listen`). */
export function applyHttpHardening(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.use((_request: unknown, response: HeaderResponse, next: () => void) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    next();
  });
  app.useBodyParser('json', { limit: API_BODY_LIMIT_BYTES });
  app.useBodyParser('urlencoded', { limit: API_BODY_LIMIT_BYTES, extended: false });
  app.useGlobalFilters(new ErrorHygieneFilter(app.getHttpAdapter()));
}
