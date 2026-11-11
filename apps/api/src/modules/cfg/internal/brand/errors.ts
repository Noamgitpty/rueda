/**
 * Erreurs du socle de marque (US-034). Codes stables (16 A.8, `SCREAMING_SNAKE_CASE`), clé de
 * message du catalogue `@rueda/i18n` (es, en, fr) et détails structurés (paires de contraste,
 * polices, langues) ; jamais de jeton ni de détail technique de la base.
 *
 * Codes de 16 : `BRAND_CONTRAST_INSUFFICIENT`, `BRAND_VERSION_UNAVAILABLE` (DSN-002),
 * `CONTENT_BLOCK_REQUIRED_MISSING`, `VERSION_CONFLICT`, `FORBIDDEN` (DSN-003 / DSN-004) ; de 19
 * US-034 : `FONT_NOT_APPROVED`. PROPOSÉS (à reporter dans 16 A.8) : `BRAND_TOKENS_INVALID`,
 * `BRAND_VERSION_NOT_FOUND`, `BRAND_ASSET_INVALID`, `BRAND_ASSET_UNAVAILABLE`,
 * `CONTENT_KEY_FORBIDDEN`, `CONTENT_MARKDOWN_FORBIDDEN`, `CONTENT_BLOCK_NOT_FOUND` ; US-121
 * (ADR-095) : `CONTENT_KEY_NOT_EDITABLE` (clé hors du registre des blocs éditables).
 */
import { HttpException } from '@nestjs/common';

export const BRAND_MESSAGES = {
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  BRAND_TOKENS_INVALID: { status: 422, messageKey: 'common.brand.tokensInvalid' },
  FONT_NOT_APPROVED: { status: 422, messageKey: 'common.brand.fontNotApproved' },
  BRAND_CONTRAST_INSUFFICIENT: { status: 422, messageKey: 'common.brand.contrastInsufficient' },
  BRAND_VERSION_NOT_FOUND: { status: 404, messageKey: 'common.brand.versionNotFound' },
  BRAND_VERSION_UNAVAILABLE: { status: 503, messageKey: 'common.brand.versionUnavailable' },
  VERSION_CONFLICT: { status: 409, messageKey: 'common.brand.versionConflict' },
  BRAND_ASSET_INVALID: { status: 422, messageKey: 'common.brand.assetInvalid' },
  BRAND_ASSET_UNAVAILABLE: { status: 503, messageKey: 'common.brand.assetUnavailable' },
  CONTENT_BLOCK_REQUIRED_MISSING: { status: 422, messageKey: 'common.brand.contentLocaleMissing' },
  CONTENT_KEY_FORBIDDEN: { status: 422, messageKey: 'common.brand.contentKeyForbidden' },
  CONTENT_KEY_NOT_EDITABLE: { status: 422, messageKey: 'common.brand.contentKeyNotEditable' },
  CONTENT_MARKDOWN_FORBIDDEN: { status: 422, messageKey: 'common.brand.contentMarkdownForbidden' },
  CONTENT_BLOCK_NOT_FOUND: { status: 404, messageKey: 'common.brand.contentNotFound' },
} as const;

export type BrandErrorCode = keyof typeof BRAND_MESSAGES;

/** Détails structurés d'un refus (jamais de donnée personnelle). */
export type BrandErrorDetails = Readonly<Record<string, unknown>>;

/** Erreur de domaine (levée par les contrôles et les services). */
export class BrandError extends Error {
  override readonly name = 'BrandError';
  readonly code: BrandErrorCode;
  readonly details: BrandErrorDetails | undefined;

  constructor(code: BrandErrorCode, details?: BrandErrorDetails) {
    super(details === undefined ? code : `${code}: ${JSON.stringify(details)}`);
    this.code = code;
    this.details = details;
  }
}

export interface BrandErrorBody {
  readonly code: BrandErrorCode;
  readonly messageKey: (typeof BRAND_MESSAGES)[BrandErrorCode]['messageKey'];
  readonly values?: Readonly<Record<string, string>>;
  readonly details?: BrandErrorDetails;
}

/** Valeurs du message traduit : la première paire, police ou langue en cause. */
function valuesOf(error: BrandError): Readonly<Record<string, string>> | undefined {
  const d = error.details ?? {};
  const first = (key: string): string | undefined => {
    const list = d[key];
    return Array.isArray(list) && list.length > 0 ? String(list[0]) : undefined;
  };
  switch (error.code) {
    case 'BRAND_CONTRAST_INSUFFICIENT': {
      const f = (d['failures'] as Array<{ pair?: unknown; mode?: unknown }> | undefined)?.[0];
      return f ? { pair: `${String(f.pair)} (${String(f.mode)})` } : undefined;
    }
    case 'FONT_NOT_APPROVED': {
      const font = first('fonts');
      return font ? { font } : undefined;
    }
    case 'CONTENT_BLOCK_REQUIRED_MISSING': {
      const locale = first('locales');
      return locale ? { locale } : undefined;
    }
    default:
      return undefined;
  }
}

export function brandErrorBody(error: BrandError): BrandErrorBody {
  const values = valuesOf(error);
  return {
    code: error.code,
    messageKey: BRAND_MESSAGES[error.code].messageKey,
    ...(values !== undefined ? { values } : {}),
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

/** Erreur HTTP : corps `{ code, messageKey, values?, details? }`. */
export class BrandHttpError extends HttpException {
  readonly code: BrandErrorCode;

  constructor(error: BrandError) {
    super(brandErrorBody(error), BRAND_MESSAGES[error.code].status);
    this.code = error.code;
  }
}
