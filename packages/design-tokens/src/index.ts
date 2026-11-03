/**
 * @rueda/design-tokens — jetons de design, source unique du thème (US-030, DSN-002, ADR-036, ADR-047).
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
export { BASE_CSS, themeStyleSheet } from './css.ts';
export type { StyleSheetOptions } from './css.ts';
export {
  assertContrast,
  DEFAULT_SELECTION,
  getActiveTheme,
  listPalettes,
  loadTheme,
  PALETTE_IDS,
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
