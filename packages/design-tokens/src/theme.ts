/**
 * Chargement des thèmes et choix du thème actif (US-030).
 *
 * - `loadTheme(id)` : palette du registre → thème validé ; refuse toute paire sous WCAG 2.2 AA.
 * - `getActiveTheme(env)` : thème choisi par la configuration versionnée `config/theme.json`
 *   (Lienzo · Tinta par défaut), surchargeable par `THEME_PALETTE` et `THEME_COLOR_SCHEME`.
 *   Lu à chaque rendu côté serveur : changer la source (puis, avec US-034, publier une version de
 *   marque) s'applique au rechargement de la page, sans nouvelle construction.
 */
import themeConfig from '../config/theme.json' with { type: 'json' };
import { buildTheme } from './build.ts';
import type { Theme } from './build.ts';
import { checkContrast, ThemeContrastError } from './contrast.ts';
import type { ContrastFailure } from './contrast.ts';
import { themeStyleSheet } from './css.ts';
import { PALETTE_SOURCES } from './palettes.ts';

export type ColorScheme = 'auto' | 'light' | 'dark';
const COLOR_SCHEMES: readonly ColorScheme[] = ['auto', 'light', 'dark'];

export class UnknownPaletteError extends Error {
  readonly paletteId: string;
  constructor(paletteId: string) {
    super(
      `palette inconnue : ${JSON.stringify(paletteId)} ; palettes connues : ${Object.keys(PALETTE_SOURCES).join(', ')}`,
    );
    this.paletteId = paletteId;
    this.name = 'UnknownPaletteError';
  }
}

export const PALETTE_IDS: readonly string[] = Object.keys(PALETTE_SOURCES);

/**
 * Copie du document DTCG d'une palette du registre (US-034) : point de départ d'une version de
 * marque en brouillon (« revenir à une ancienne palette »). Copie profonde : la modifier ne touche
 * pas le registre.
 */
export function paletteDocument(paletteId: string): Record<string, unknown> {
  const source = Object.hasOwn(PALETTE_SOURCES, paletteId) ? PALETTE_SOURCES[paletteId] : undefined;
  if (source === undefined) throw new UnknownPaletteError(paletteId);
  return structuredClone(source) as Record<string, unknown>;
}

/**
 * Thème validé et conforme au contraste AA, ou exception (fail-closed).
 * `overrides` : jetons partiels au format DTCG appliqués par-dessus la palette (retouche publiée).
 */
export function loadTheme(paletteId: string, overrides?: unknown): Theme {
  const source = Object.hasOwn(PALETTE_SOURCES, paletteId) ? PALETTE_SOURCES[paletteId] : undefined;
  if (source === undefined) throw new UnknownPaletteError(paletteId);
  return assertContrast(buildTheme(source, overrides));
}

/** Refuse un thème dont une paire échoue ; renvoie le thème sinon. */
export function assertContrast(theme: Theme): Theme {
  const failures = checkContrast(theme);
  if (failures.length > 0) throw new ThemeContrastError(theme.id, failures);
  return theme;
}

export interface PaletteStatus {
  readonly id: string;
  readonly version?: string;
  readonly accepted: boolean;
  readonly problems: readonly string[];
  readonly contrastFailures: readonly ContrastFailure[];
}

/** État de chaque palette du registre : sert au futur sélecteur de l'écran « Apparence » (US-120). */
export function listPalettes(): PaletteStatus[] {
  return PALETTE_IDS.map((id) => {
    try {
      const theme = buildTheme(PALETTE_SOURCES[id]);
      const contrastFailures = checkContrast(theme);
      return {
        id,
        version: theme.version,
        accepted: contrastFailures.length === 0,
        problems: [],
        contrastFailures,
      };
    } catch (error) {
      const problems = (error as { problems?: string[] }).problems ?? [(error as Error).message];
      return { id, accepted: false, problems, contrastFailures: [] };
    }
  });
}

export interface ThemeSelection {
  readonly palette: string;
  readonly colorScheme: ColorScheme;
}

/** Configuration versionnée du dépôt (`config/theme.json`). */
export const DEFAULT_SELECTION: ThemeSelection = parseSelection(themeConfig);

function parseSelection(raw: unknown): ThemeSelection {
  const r = (raw ?? {}) as { palette?: unknown; colorScheme?: unknown };
  if (typeof r.palette !== 'string') throw new Error('config/theme.json : "palette" manquant');
  const colorScheme = r.colorScheme ?? 'auto';
  if (!COLOR_SCHEMES.includes(colorScheme as ColorScheme))
    throw new Error(`config/theme.json : "colorScheme" doit valoir ${COLOR_SCHEMES.join(', ')}`);
  return { palette: r.palette, colorScheme: colorScheme as ColorScheme };
}

/** Sélection effective : configuration du dépôt, puis variables d'environnement si présentes. */
export function resolveSelection(
  env: Readonly<Record<string, string | undefined>> = {},
): ThemeSelection {
  const palette = env['THEME_PALETTE'] || DEFAULT_SELECTION.palette;
  const scheme = env['THEME_COLOR_SCHEME'] || DEFAULT_SELECTION.colorScheme;
  if (!COLOR_SCHEMES.includes(scheme as ColorScheme))
    throw new Error(
      `THEME_COLOR_SCHEME doit valoir ${COLOR_SCHEMES.join(', ')} (reçu ${JSON.stringify(scheme)})`,
    );
  if (!PALETTE_IDS.includes(palette)) throw new UnknownPaletteError(palette);
  return { palette, colorScheme: scheme as ColorScheme };
}

export interface ActiveTheme {
  readonly theme: Theme;
  readonly colorScheme: ColorScheme;
  /** Feuille de style à injecter dans `<head>` (variables + règles de base). */
  readonly css: string;
  /** Valeur de l'attribut `data-theme` de `<html>`, absente en mode automatique. */
  readonly dataTheme: 'light' | 'dark' | undefined;
}

const cache = new Map<string, { theme: Theme; css: string }>();

/** Thème actif pour un rendu. Mis en cache par palette (les fichiers ne changent qu'au déploiement). */
export function getActiveTheme(
  env: Readonly<Record<string, string | undefined>> = {},
): ActiveTheme {
  const selection = resolveSelection(env);
  let entry = cache.get(selection.palette);
  if (!entry) {
    const theme = loadTheme(selection.palette);
    entry = { theme, css: themeStyleSheet(theme) };
    cache.set(selection.palette, entry);
  }
  return {
    ...entry,
    colorScheme: selection.colorScheme,
    dataTheme: selection.colorScheme === 'auto' ? undefined : selection.colorScheme,
  };
}
