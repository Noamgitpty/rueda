// Point d'entrée public du module CFG. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, cfg.module.ts) est privé (règle rueda/module-boundaries).
export { CfgModule } from './cfg.module.js';
export { CountryConfigService } from './internal/country-config.service.js';
export { ConfigError } from './internal/errors.js';
export type { ConfigErrorCode } from './internal/errors.js';
export { FAIL_MODES, PARAM_SCOPES, PARAM_TYPES, TAX_LINE_TYPES } from './internal/model.js';
export type {
  CountryConfig,
  CountryConfigEntry,
  CurrencyConfig,
  FailMode,
  ParamDefinition,
  ParamJson,
  ParamScope,
  ParamType,
  ParamValue,
  TaxLineConfig,
  TaxLineType,
} from './internal/model.js';
export { parseCountryConfig } from './internal/parse.js';
export type { CountryConfigSources, ParseOptions } from './internal/parse.js';
export { assertProductionReady, findReadinessIssues } from './internal/readiness.js';
export type { ReadinessIssue } from './internal/readiness.js';
export {
  assertNotRetroactive,
  findOptionalParam,
  isGoLiveSwitchOn,
  resolveParam,
} from './internal/resolve.js';
export type { ParamContext, ResolvedParam } from './internal/resolve.js';
export {
  parseRuntimeEnvironment,
  RUNTIME_ENVIRONMENTS,
  runStartupChecks,
} from './internal/startup.js';
export type { RuntimeEnvironment } from './internal/startup.js';
export {
  checkPostgresTimeZoneData,
  checkRuntimeTimeZoneData,
  POSTGRES_OFFSET_SQL,
  timeZoneExpectations,
} from './internal/tzdata.js';
export type { OffsetQuery, TimeZoneExpectation } from './internal/tzdata.js';
