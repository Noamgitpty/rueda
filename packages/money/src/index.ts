/**
 * `@rueda/money` — primitives monétaires exactes (US-015 ; 08 BR-PRICE-14 ; 17 §1.2 ; ADR-009).
 * Seul point d'entrée public du paquet. Voir README.md.
 */
export { MONEY_ERROR_CODES, MoneyError, isMoneyError, type MoneyErrorCode } from './errors.ts';
export {
  MAX_CURRENCY_EXPONENT,
  assertCurrency,
  createCurrencyRegistry,
  type Currency,
  type CurrencyDefinition,
  type CurrencyRegistry,
} from './currency.ts';
export {
  compareRatios,
  isRatio,
  multiplyRatios,
  parseRatio,
  ratio,
  ratioToString,
  type Ratio,
} from './ratio.ts';
export { roundHalfUp } from './rounding.ts';
export {
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  add,
  allocHost,
  compare,
  equals,
  isMoney,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  money,
  moneyFromSafeInteger,
  moneyToJSON,
  multiplyByInteger,
  multiplyRoundHalfUp,
  negate,
  parseMajor,
  parseMinor,
  ratioOf,
  requirePositive,
  splitHostPlatform,
  subtract,
  sum,
  taxByLine,
  toMajorString,
  toMinorString,
  zero,
  type Money,
} from './money.ts';
export * from './settlement/index.ts';
