/**
 * Point d'entrée public de `@rueda/i18n` (US-014). Voir README.md.
 */
export { CATALOG_VERSION, CATALOGS } from './catalogs/index.ts';
export type {
  Catalog,
  Message,
  MessageKey,
  PluralCategory,
  PluralMessage,
  RegionalOverrides,
  VersionedCatalog,
} from './catalogs/index.ts';
export {
  checkTimeZoneData,
  formatDate,
  formatDateTime,
  formatTime,
  utcOffsetMinutes,
} from './date-format.ts';
export type { Instant, TimeZoneExpectation } from './date-format.ts';
export {
  CATALOG_LANGUAGES,
  LocaleConfigError,
  getProfile,
  parseLocaleConfig,
} from './locale-profile.ts';
export type {
  CatalogLanguage,
  CurrencyProfile,
  DateProfile,
  LocaleConfig,
  LocaleProfile,
  NumberProfile,
} from './locale-profile.ts';
export { localeChoiceResponse } from './locale-choice.ts';
export { formatMoney } from './money-format.ts';
export type { MinorUnitAmount } from './money-format.ts';
export {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_S,
  isSupportedLocale,
  matchLocale,
  negotiateLocale,
  parseAcceptLanguage,
} from './negotiate.ts';
export type { AcceptLanguageEntry, NegotiateInput } from './negotiate.ts';
export { formatNumber } from './number-format.ts';
export type { FormatNumberOptions } from './number-format.ts';
export { MissingVariableError, placeholdersOf } from './pattern.ts';
export { UnknownMessageKeyError, createTranslator } from './translator.ts';
export type { MessageValues, Translator } from './translator.ts';
