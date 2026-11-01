import type { LocaleConfig } from './locale-profile.ts';

/**
 * Détection et choix de la locale (10b UX-11) : le **choix explicite mémorisé** l'emporte, puis
 * `Accept-Language`, puis la locale par défaut de la configuration. Une vue = une langue : le
 * résultat est la seule source de langue de la requête.
 */

/** Nom du cookie qui mémorise le choix explicite de la locale (web et back-office). */
export const LOCALE_COOKIE = 'locale';

/** Durée de mémorisation du choix, en secondes (un an). */
export const LOCALE_COOKIE_MAX_AGE_S = 31_536_000;

export interface AcceptLanguageEntry {
  readonly tag: string;
  readonly quality: number;
}

/** Analyse un en-tête `Accept-Language` ; ordre décroissant de qualité, ordre d'origine à égalité. */
export function parseAcceptLanguage(header: string | null | undefined): AcceptLanguageEntry[] {
  if (!header) return [];
  const entries: (AcceptLanguageEntry & { index: number })[] = [];
  header.split(',').forEach((item, index) => {
    const [rawTag = '', ...params] = item.trim().split(';');
    const tag = rawTag.trim();
    if (
      tag.length === 0 ||
      tag.length > 35 ||
      !/^(\*|[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*)$/.test(tag)
    ) {
      return;
    }
    let quality = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([01](\.\d{0,3})?)\s*$/.exec(param);
      if (match) quality = Number(match[1]);
    }
    if (quality > 0 && quality <= 1) entries.push({ tag, quality, index });
  });
  entries.sort((a, b) => b.quality - a.quality || a.index - b.index);
  return entries.map(({ tag, quality }) => ({ tag, quality }));
}

function canonical(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** Locale déclarée qui correspond à une étiquette demandée, ou `undefined`. */
export function matchLocale(requested: string, config: LocaleConfig): string | undefined {
  const tag = canonical(requested);
  if (!tag) return undefined;
  const lower = tag.toLowerCase();
  const exact = config.locales.find((p) => p.tag.toLowerCase() === lower);
  if (exact) return exact.tag;
  const language = lower.split('-')[0];
  const sameLanguage = config.locales.filter((p) => p.language === language);
  if (sameLanguage.length === 0) return undefined;
  // Même langue, autre région (es-AR, en-GB…) : la locale par défaut si elle est de cette
  // langue (marché du déploiement), sinon la première déclarée de cette langue.
  return (sameLanguage.find((p) => p.tag === config.defaultLocale) ?? sameLanguage[0])?.tag;
}

export interface NegotiateInput {
  /** Choix explicite mémorisé (cookie ou préférence du compte). */
  readonly stored?: string | null | undefined;
  readonly acceptLanguage?: string | null | undefined;
}

export function negotiateLocale(input: NegotiateInput, config: LocaleConfig): string {
  if (input.stored) {
    const stored = config.locales.find((p) => p.tag === input.stored);
    if (stored) return stored.tag;
  }
  for (const { tag } of parseAcceptLanguage(input.acceptLanguage)) {
    if (tag === '*') return config.defaultLocale;
    const match = matchLocale(tag, config);
    if (match) return match;
  }
  return config.defaultLocale;
}

/** Vrai si l'étiquette est une locale déclarée (validation d'un choix avant de le mémoriser). */
export function isSupportedLocale(tag: string, config: LocaleConfig): boolean {
  return config.locales.some((p) => p.tag === tag);
}
