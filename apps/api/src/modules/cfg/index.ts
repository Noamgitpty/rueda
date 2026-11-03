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

// Socle de marque modifiable (US-034, ADR-067) : thème versionné, actifs, blocs de contenu.
// Montage par le processus API (api.module.ts) ; écritures appelées par la console SUP.
export { BrandModule } from './internal/brand/brand.module.js';
export {
  BrandAccessError,
  BrandConsoleService,
  BrandReadService,
  sniffBrandMime,
  UnavailableBrandFileStore,
} from './internal/brand/brand.service.js';
export type {
  AssetUpload,
  BrandFileStore,
  BrandOptions,
  ContentView,
  DraftInput,
  PublishedTheme,
} from './internal/brand/brand.service.js';
export {
  BrandError,
  BrandHttpError,
  brandErrorBody,
  BRAND_MESSAGES,
} from './internal/brand/errors.js';
export type { BrandErrorCode } from './internal/brand/errors.js';
export { loadBrandParams, parseBrandParams } from './internal/brand/params.js';
export type { BrandParams } from './internal/brand/params.js';
export { PgBrandStore } from './internal/brand/store.js';
export type { BrandStore, StaffVersion } from './internal/brand/store.js';
export { CONTENT_LOCALES, CONTRAST_CHECKER } from './internal/brand/checks.js';
