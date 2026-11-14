/**
 * @rueda/design-tokens — jetons de design, source unique du thème (US-030, DSN-002, ADR-036, ADR-047),
 * règles de mouvement et règles photo (US-031, ADR-069).
 * Voir README.md, section « Changer de palette en 1 étape ».
 */
export {
  buildTheme,
  deepMerge,
  MODES,
  REQUIRED_PATHS,
  SEMANTIC_COLORS,
  ThemeFormatError,
  TOKENS_SCHEMA_VERSION,
} from './build.ts';
export type { Mode, SemanticColor, Theme, ThemeToken } from './build.ts';
export { checkContrast, CONTRAST_RULES, GLASS_TEXT, ThemeContrastError } from './contrast.ts';
export type { ContrastFailure, ContrastRule } from './contrast.ts';
export { BASE_CSS, previewStyleSheet, themeStyleSheet } from './css.ts';
export { themeFontFamilies } from './fonts.ts';
export { LOGO_MAX_LENGTH, LOGO_TOKEN_PATHS, logoProblem, logoProblems } from './logo.ts';
export {
  cssVariableOf,
  MOTION_RULES,
  motionDurationMs,
  motionPattern,
  MotionRulesError,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  validateMotionRules,
} from './motion.ts';
export type { MotionBudget, MotionPattern, MotionRules } from './motion.ts';
export {
  angleKeyOf,
  checkHandoverSet,
  LISTING_MINIMUM_FLOOR,
  PHOTO_LANGUAGES,
  PHOTO_MESSAGES,
  PHOTO_RULES,
  PhotoRulesError,
  TRP004_MINIMUM,
  validatePhotoMessages,
  validatePhotoRules,
} from './photo.ts';
export type {
  AngleFraming,
  AngleSide,
  AngleZone,
  HandoverSetCheck,
  HandoverSlot,
  ListingShot,
  PhotoAngle,
  PhotoForbidden,
  PhotoGuideline,
  PhotoLanguage,
  PhotoMessages,
  PhotoRules,
  PhotoUse,
  Ratio,
} from './photo.ts';
export type { StyleSheetOptions } from './css.ts';
export {
  assertContrast,
  DEFAULT_SELECTION,
  getActiveTheme,
  listPalettes,
  loadTheme,
  PALETTE_IDS,
  paletteDocument,
  resolveSelection,
  UnknownPaletteError,
} from './theme.ts';
export type { ActiveTheme, ColorScheme, PaletteStatus, ThemeSelection } from './theme.ts';
export {
  AA_NON_TEXT,
  AA_TEXT,
  blend,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
  rgbToHex,
} from './wcag.ts';
export type { Rgb } from './wcag.ts';
