// Point d'entrée public du module RISK. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, testing/, risk.module.ts) est privé (règle rueda/module-boundaries).
export { RiskModule } from './risk.module.js';

// Limitation de débit et anti-abus (US-052, ADR-075).
export { AbuseGuard } from './internal/abuse-guard.js';
export type {
  AbuseGuardDeps,
  CostlyChannel,
  CostlySendRequest,
  HttpScope,
  RiskLogEntry,
} from './internal/abuse-guard.js';
export { PgAbuseBoardStore } from './internal/abuse-board.js';
export type { AbuseBoardRow, AbuseBoardStore } from './internal/abuse-board.js';
export { CHALLENGE_HEADER, UnavailableBotChallenge } from './internal/bot-challenge.port.js';
export type { BotChallengePort, ChallengeOutcome } from './internal/bot-challenge.port.js';
export {
  CounterUnavailableError,
  MemoryRateCounterStore,
  PgRateCounterStore,
} from './internal/counter-store.js';
export type {
  BotSignal,
  HitResult,
  RateCounterStore,
  RiskSqlExecutor,
} from './internal/counter-store.js';
export { RiskHttpError, RISK_MESSAGES } from './internal/errors.js';
export type { RiskCode } from './internal/errors.js';
export { parseRateLimitKey, RateKeyHasher } from './internal/key-hasher.js';
export { configRateLimitPolicy, RATE_LIMIT_PARAMS } from './internal/policy.js';
export type { RateLimitPolicy } from './internal/policy.js';
export { postgresRiskAdapters } from './internal/production.js';
export { RiskHttpModule } from './internal/risk-http.module.js';
export type { RiskHttpOptions } from './internal/risk-http.module.js';
export { ntfSmsBudget } from './internal/sms-budget.js';
export { ABUSE_BOARD_STORE } from './internal/tokens.js';
