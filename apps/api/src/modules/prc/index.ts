// Point d'entrée public du module PRC. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, prc.module.ts) est privé (règle rueda/module-boundaries).
export { PrcModule } from './prc.module.js';
export { QuoteService } from './internal/quote/quote.service.js';
export { billableDays } from './internal/quote/billable-days.js';
export {
  QUOTE_ENGINE_VERSION,
  QUOTE_LINE_TYPES,
  assembleQuote,
  computeQuote,
  quoteSettlementTrip,
} from './internal/quote/engine.js';
export type {
  PricedPeriod,
  Quote,
  QuoteExtraLines,
  QuoteLine,
  QuoteLineType,
  QuoteParams,
  QuoteRequest,
  QuoteTaxGroup,
  QuoteTaxRule,
} from './internal/quote/engine.js';
export { QUOTE_ERROR_CODES, QuoteError, isQuoteError } from './internal/quote/errors.js';
export type { QuoteErrorCode } from './internal/quote/errors.js';
export {
  FROZEN_QUOTE_FORMAT,
  freezeQuote,
  quoteOutputsJson,
  replayFrozenQuote,
} from './internal/quote/frozen.js';
export type { FrozenQuote } from './internal/quote/frozen.js';
export { resolveQuoteParams } from './internal/quote/params.js';
export type { QuoteParamsContext } from './internal/quote/params.js';
