/**
 * Aide et urgence (US-310, ADR-182 ; 19 US-310 ; 16 SUP-004 / SUP-011 / SUP-020 ; 10b S17 ;
 * 08 BR-PROT-05). Numéros et plage lus de la configuration pays (`help`, `assistanceContacts` de
 * CFG, ADR-174), jamais en dur ; numéros absents (hors production : la production refuse de
 * démarrer sans eux) ⇒ `null`, et l'écran renvoie à l'aide dans l'appli sans inventer de numéro.
 * Aucun téléphone de l'autre partie du trip, jamais.
 *
 * | Route                               | Réponse                                                  |
 * | ----------------------------------- | -------------------------------------------------------- |
 * | GET /help?country=XX                | 200 aide du pays (sans `country` : de chaque pays) ;     |
 * |                                     | 400 REQUEST_INVALID (pays mal formé ou non configuré)    |
 * | GET /trips/{tripId}/help            | 200 rôle de la session dans le trip et aide de son pays ; |
 * |                                     | 404 TRIP_NOT_FOUND ; 401 ; 503 HELP_UNAVAILABLE           |
 * | POST /trips/{tripId}/help-requests  | 201 demande ouverte ; 200 rejeu ou demande vivante ;     |
 * |                                     | 400 ; 401 ; 404 TRIP_NOT_FOUND ; 415 ; 503               |
 *
 * Les routes du trip (`trip-help.controller.ts`) sont gardées par `SessionGuard` et `TermsGuard`,
 * comme toute route d'un trip (US-102) ; les numéros d'urgence restent servis sans session ni CGU
 * par `GET /help` (S17 public). Le trip d'une autre personne, un trip inconnu et un identifiant mal
 * formé rendent la même réponse 404.
 */
import { Controller, Get, HttpException, Inject, Query, Res } from '@nestjs/common';
import { CountryConfigService } from '../../../cfg/index.js';
import { sessionProofOf } from '../../../iam/index.js';
import { HelpStoreError } from './help-store.js';

export const HELP_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  TRIP_NOT_FOUND: { status: 404, messageKey: 'common.trips.notFound' },
  HELP_UNAVAILABLE: { status: 503, messageKey: 'common.help.unavailable' },
} as const;
export type HelpHttpCode = keyof typeof HELP_MESSAGES;

export class HelpHttpError extends HttpException {
  readonly code: HelpHttpCode;

  constructor(code: HelpHttpCode) {
    super({ code, messageKey: HELP_MESSAGES[code].messageKey }, HELP_MESSAGES[code].status);
    this.code = code;
  }
}

/** Aide d'un pays telle que l'écran S17 la lit (aucune donnée personnelle). */
export interface HelpCountryView {
  readonly country: string;
  readonly names: Readonly<Record<string, string>>;
  readonly emergencyNumber: string;
  readonly trafficAuthority: { readonly id: string; readonly messageKey: string };
  /** Support de la plateforme (E.164) ; `null` : non fourni (hors production seulement). */
  readonly supportPhone: string | null;
  /** Assistance de l'assureur partenaire (E.164) ; `null` : non fournie. */
  readonly insurerAssistancePhone: string | null;
  /** Plage publiée (heures locales) ; `null` : aucune plage publiée (SUP-020). */
  readonly supportHours: { readonly from: string; readonly to: string } | null;
}

/** Clé du catalogue du nom de l'autorité de circulation d'un pays. */
export const authorityMessageKey = (id: string): string => `common.help.authority.${id}`;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HttpRequestLike {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}
export interface StatusResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Aide de la configuration pays (relue au démarrage ; aucune base). */
export function helpViewOf(cfg: CountryConfigService, code: string): HelpCountryView | null {
  const entry = cfg.config.countries.get(code);
  if (entry === undefined) return null;
  const hours = entry.help.supportHours;
  return {
    country: entry.code,
    names: { ...entry.names },
    emergencyNumber: entry.help.emergencyNumber,
    trafficAuthority: {
      id: entry.help.trafficAuthority,
      messageKey: authorityMessageKey(entry.help.trafficAuthority),
    },
    supportPhone: entry.assistanceContacts?.supportPhone ?? null,
    insurerAssistancePhone: entry.assistanceContacts?.insurerAssistancePhone ?? null,
    supportHours: hours === null ? null : { from: hours.from, to: hours.to },
  };
}

export function proofOf(request: HttpRequestLike): Buffer {
  const proof = sessionProofOf(request);
  if (proof === null) throw new HelpHttpError('AUTH_REQUIRED');
  return proof;
}

/** Appel du magasin : 22023 (donnée refusée par la commande) ⇒ 400 ; autre échec ⇒ 503. */
export async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HelpStoreError && error.sqlstate === '22023') {
      throw new HelpHttpError('REQUEST_INVALID');
    }
    throw new HelpHttpError('HELP_UNAVAILABLE');
  }
}

@Controller('help')
export class HelpController {
  constructor(@Inject(CountryConfigService) private readonly cfg: CountryConfigService) {}

  /** S17 public : urgences, autorité de circulation, assistance de l'assureur, support, plage. */
  @Get()
  help(@Query('country') country: unknown, @Res({ passthrough: true }) response: StatusResponse) {
    let codes: string[];
    if (country === undefined) {
      codes = [...this.cfg.config.countries.keys()].sort();
    } else if (typeof country === 'string' && this.cfg.config.countries.has(country)) {
      codes = [country];
    } else {
      throw new HelpHttpError('REQUEST_INVALID');
    }
    // données de configuration du déploiement : cache public court, aucune donnée personnelle
    response.setHeader('Cache-Control', 'public, max-age=300');
    return { countries: codes.map((c) => helpViewOf(this.cfg, c)).filter((v) => v !== null) };
  }
}
