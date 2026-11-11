/**
 * Routes HTTP des documents juridiques et des consentements (préfixe `/legal`, US-102). Corps
 * d'erreur `{ code, messageKey }` (clé du catalogue @rueda/i18n). Aucune donnée personnelle dans
 * une réponse publique ; l'historique ne rend que les lignes du titulaire de la session.
 *
 * | Route                            | Accès   | Réponse                                                         |
 * | -------------------------------- | ------- | --------------------------------------------------------------- |
 * | GET  /legal/documents            | public  | 200 versions en vigueur ; 400 ; 503 LEGAL_DOCUMENT_UNAVAILABLE   |
 * | GET  /legal/documents/{kind}     | public  | 200 texte ; 400 ; 404 LEGAL_DOCUMENT_NOT_FOUND                   |
 * | GET  /legal/consents             | session | 200 TERMS_CURRENT ou TERMS_REACCEPT_REQUIRED + historique ; 401 |
 * | POST /legal/consents/accept      | session | 200 état ; 400 ; 401 ; 409 TERMS_VERSION_CHANGED ; 503          |
 * | POST /legal/consents/marketing   | session | 200 CONSENT_RECORDED ; 400 ; 401 ; 503                           |
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { SessionGuard, sessionProofOf } from '../../iam/index.js';
import type { ConsentStatusRow, LegalDocument, LegalDocumentSummary } from './consent-store.js';
import { legalBody, LegalHttpError } from './errors.js';
import type { LegalBody } from './errors.js';
import { countryOf, languageOf, LegalService } from './legal.service.js';

interface Req {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}
interface Res {
  setHeader(name: string, value: string): unknown;
}

const summaryJson = (d: LegalDocumentSummary) => ({
  kind: d.kind,
  version: d.version,
  isMajor: d.isMajor,
  locale: d.locale,
  title: d.title,
  contentHash: d.contentHash,
  draft: d.draft,
  validFrom: d.validFrom.toISOString(),
});

const statusJson = (r: ConsentStatusRow) => ({
  kind: r.kind,
  required: r.required,
  currentVersion: r.currentVersion,
  requiredVersion: r.requiredVersion,
  acceptedVersion: r.acceptedVersion,
  accepted: r.accepted,
  reacceptRequired: r.reacceptRequired,
});

function bodyOf(request: Req): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new LegalHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function scope(query: Record<string, unknown>): { country: string | null; language: string } {
  const language = languageOf(query['locale']);
  const country = countryOf(query['country']);
  if (language === null || country === undefined) throw new LegalHttpError('REQUEST_INVALID');
  return { country, language };
}

@Controller('legal')
export class LegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get('documents')
  async documents(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Res,
  ): Promise<{ documents: ReturnType<typeof summaryJson>[] }> {
    response.setHeader('Cache-Control', 'no-store');
    const { country, language } = scope(query);
    const documents = await this.legal.publishedDocuments(country, language);
    return { documents: documents.map(summaryJson) };
  }

  @Get('documents/:kind')
  async document(
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Res,
  ): Promise<ReturnType<typeof summaryJson> & { bodyMd: string }> {
    response.setHeader('Cache-Control', 'no-store');
    const { country, language } = scope(query);
    const raw = query['version'];
    let version: number | null = null;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^[1-9][0-9]{0,5}$/.test(raw)) {
        throw new LegalHttpError('REQUEST_INVALID');
      }
      version = Number(raw);
    }
    const doc: LegalDocument = await this.legal.document(kind, country, language, version);
    return { ...summaryJson(doc), bodyMd: doc.bodyMd };
  }

  @Get('consents')
  @UseGuards(SessionGuard)
  async consents(@Req() request: Req) {
    const proof = sessionProofOf(request);
    const overview = await this.legal.overview(proof);
    const history = await this.legal.history(proof);
    return {
      ...legalBody(overview.code),
      documents: overview.documents.map(statusJson),
      marketingOptIn: overview.marketingOptIn,
      history: history.map((h) => ({
        kind: h.kind,
        version: h.version,
        locale: h.locale,
        accepted: h.accepted,
        acceptedAt: h.acceptedAt.toISOString(),
        context: h.context,
      })),
    };
  }

  @Post('consents/accept')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async accept(@Req() request: Req) {
    const overview = await this.legal.accept(sessionProofOf(request), bodyOf(request)['documents']);
    return {
      ...legalBody(overview.code),
      documents: overview.documents.map(statusJson),
      marketingOptIn: overview.marketingOptIn,
    };
  }

  @Post('consents/marketing')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async marketing(@Req() request: Req): Promise<LegalBody & { marketingOptIn: boolean }> {
    const optIn = await this.legal.setMarketing(sessionProofOf(request), bodyOf(request)['optIn']);
    return { ...legalBody('CONSENT_RECORDED'), marketingOptIn: optIn };
  }
}
