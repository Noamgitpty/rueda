/**
 * Vitrine de la bibliothèque de composants (US-032) : drapeau et lecture des paramètres d'URL.
 *
 * Ouverte en développement (`next dev`) ; ailleurs, seulement si `WEB_UI_CATALOG_ENABLED` vaut
 * exactement `true` (préproduction). Sinon : 404. Lu à chaque requête côté serveur (jamais
 * `NEXT_PUBLIC_*`, donc rien n'est figé au build).
 */
export const UI_CATALOG_FLAG = 'WEB_UI_CATALOG_ENABLED';

type Env = Readonly<Record<string, string | undefined>>;

export function isUiCatalogEnabled(env: Env = process.env): boolean {
  return env[UI_CATALOG_FLAG] === 'true' || env['NODE_ENV'] === 'development';
}

export type CatalogTheme = 'auto' | 'light' | 'dark';
export type CatalogWidth = 'mobile' | 'full';

export interface CatalogOptions {
  /** Locale demandée, si elle est déclarée ; sinon celle de la requête. */
  readonly locale: string | undefined;
  readonly theme: CatalogTheme;
  readonly width: CatalogWidth;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Paramètres `?lang=…&theme=…&width=…` ; toute valeur inconnue est ignorée (valeur par défaut). */
export function parseCatalogOptions(params: Params, locales: readonly string[]): CatalogOptions {
  const lang = one(params['lang']);
  const theme = one(params['theme']);
  const width = one(params['width']);
  return {
    locale: lang !== undefined && locales.includes(lang) ? lang : undefined,
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    // 360 px par défaut : la vitrine se juge d'abord sur mobile (10b UX-01).
    width: width === 'full' ? 'full' : 'mobile',
  };
}

/** Lien de la vitrine avec une option changée. */
export function catalogHref(options: CatalogOptions, change: Partial<CatalogOptions>): string {
  const next = { ...options, ...change };
  const query = new URLSearchParams();
  if (next.locale) query.set('lang', next.locale);
  if (next.theme !== 'auto') query.set('theme', next.theme);
  if (next.width !== 'mobile') query.set('width', next.width);
  const text = query.toString();
  return text ? `?${text}` : '?';
}
