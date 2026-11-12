/**
 * Routes des CGU de l'hôte (US-126 ; 16 LEG-001, LEG-014 ; ADR-100). Gardées par `SessionGuard`
 * (JSON exigé pour une écriture : parade CSRF) ; l'hôte est celui de la session (empreinte du
 * jeton), le compte d'hôte `{orgId}` l'un de ses comptes titulaires, revérifié en base. Un compte
 * d'un autre hôte rend 404 comme un compte inconnu (17 §2.3 point 5, L1-PM-11). La portée des CGU
 * est le pays du compte d'hôte. Corps d'erreur `{ code, messageKey }`.
 *
 * | Route                                  | Réponse                                                       |
 * | -------------------------------------- | ------------------------------------------------------------- |
 * | GET  /host/accounts/{orgId}/terms        | 200 TERMS_CURRENT / TERMS_REACCEPT_REQUIRED ; 400 ; 404 ; 503 |
 * | POST /host/accounts/{orgId}/terms/accept | 200 état ; 400 ; 404 ; 409 TERMS_VERSION_CHANGED ; 503       |
 *
 * La garde elle-même (TERMS_REACCEPT_REQUIRED à la soumission d'une annonce) est dans la commande
 * en base `core.catalog_cmd_submit_listing` (L1-PM-28), jamais dans l'écran.
 */
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CountryConfigService } from '../../cfg/index.js';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import type { HostTermsState } from './consent-store.js';
import { legalBody, LegalHttpError } from './errors.js';
import { languageOf, LegalService } from './legal.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface Res {
  setHeader(name: string, value: string): unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Identifiant de compte d'hôte mal formé ⇒ 404, comme un compte inconnu. */
function orgOf(orgId: string): string {
  if (!UUID.test(orgId)) throw new LegalHttpError('HOST_ACCOUNT_NOT_FOUND');
  return orgId;
}

/** Fuseau du pays du compte d'hôte (configuration CFG) : les dates s'affichent à l'heure locale. */
const COUNTRIES = new CountryConfigService().config.countries;

function hostTermsJson(s: HostTermsState) {
  const d = s.document;
  const timeZone = COUNTRIES.get(s.country)?.timeZone;
  if (timeZone === undefined) throw new LegalHttpError('LEGAL_DOCUMENT_UNAVAILABLE');
  return {
    ...legalBody(s.reacceptRequired ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT'),
    country: s.country,
    timeZone,
    document:
      d === null
        ? null
        : {
            kind: d.kind,
            version: d.version,
            isMajor: d.isMajor,
            locale: d.locale,
            title: d.title,
            contentHash: d.contentHash,
            draft: d.draft,
            validFrom: d.validFrom.toISOString(),
          },
    requiredVersion: s.requiredVersion,
    acceptedVersion: s.acceptedVersion,
    acceptedAt: s.acceptedAt === null ? null : s.acceptedAt.toISOString(),
    reacceptRequired: s.reacceptRequired,
  };
}

@Controller('host')
@UseGuards(SessionGuard)
export class HostTermsController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get('accounts/:orgId/terms')
  async terms(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Res,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const language = languageOf(query['locale']);
    if (language === null) throw new LegalHttpError('REQUEST_INVALID');
    const state = await this.legal.hostTerms(sessionProofOf(request), orgOf(orgId), language);
    return hostTermsJson(state);
  }

  @Post('accounts/:orgId/terms/accept')
  @HttpCode(200)
  async accept(
    @Req() request: Req,
    @Param('orgId') orgId: string,
    @Res({ passthrough: true }) response: Res,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const body = request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new LegalHttpError('REQUEST_INVALID');
    }
    const state = await this.legal.acceptHostTerms(
      sessionProofOf(request),
      orgOf(orgId),
      body as Record<string, unknown>,
    );
    return hostTermsJson(state);
  }
}
