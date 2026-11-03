/**
 * Profils de locale : **données** de configuration (ADR-024, aucune constante pays dans le code).
 *
 * Un profil décrit comment afficher les nombres, les montants et les dates d'une locale. Les
 * valeurs viennent de `config/locales.json` (ou d'une fixture de test) et sont validées ici.
 * Les formats visés sont ceux de 16 (fiche I18N-003 / I18N-004 / I18N-005) et de 17 §1.2 :
 * « US$ 1.234,56 » en es-PA, « $1,234.56 » en en, « ₲ 1.050.000 » sans décimale. Le profil fr
 * (DEC-FONDATEUR-17) suit le CLDR du français : « 1 234,56 $US », « 1 050 000 ₲ ». Le profil
 * pt (pt-BR, DEC-FONDATEUR-18) suit le CLDR du portugais du Brésil : « US$ 1.234,56 », « ₲ 1.050.000 ».
 */

/** Langue de catalogue : la locale régionale (es-PA, es-PY) hérite du catalogue de sa langue. */
export type CatalogLanguage = 'es' | 'en' | 'fr' | 'pt';

/**
 * Langues de catalogue (DEC-FONDATEUR-11, 17, 18) : espagnol (fait foi), anglais, français et
 * portugais du Brésil (`pt` : dans le CLDR, `pt` est le portugais du Brésil, `pt-PT` celui du
 * Portugal ; étiquette sans région comme `en` et `fr`, ADR-071). Source unique de la liste : l'API et
 * le web l'importent au lieu de recopier « es / en / fr / pt ».
 */
export const CATALOG_LANGUAGES: readonly CatalogLanguage[] = ['es', 'en', 'fr', 'pt'];

export interface NumberProfile {
  /** Séparateur des milliers (« . » ou « , »). */
  readonly group: string;
  /** Séparateur décimal (« , » ou « . »). */
  readonly decimal: string;
  /**
   * Nombre minimal de chiffres devant le premier séparateur de milliers pour qu'on groupe :
   * 1 → « 1.234 » ; 2 → « 1234 » mais « 12.345 » (usage CLDR de l'espagnol).
   */
  readonly minimumGroupingDigits: 1 | 2;
}

export interface CurrencyProfile {
  /** Symbole par code ISO 4217 ; à défaut, le code ISO s'affiche. */
  readonly symbols: Readonly<Record<string, string>>;
  /** Gabarit d'un montant positif : `{symbol}` et `{amount}`. */
  readonly pattern: string;
  /** Gabarit d'un montant négatif : `{symbol}` et `{amount}` (valeur absolue). */
  readonly negativePattern: string;
}

export interface DateProfile {
  /** Gabarit de date : `{day}`, `{month}`, `{year}` (16 I18N-003 : jj/mm/aaaa). */
  readonly datePattern: string;
  /** Gabarit d'heure : `{hour}`, `{minute}`, `{dayPeriod}` (24 h en es, fr et pt, 12 h en en). */
  readonly timePattern: string;
  /** Gabarit date + heure : `{date}`, `{time}`. */
  readonly dateTimePattern: string;
  readonly hourCycle: 'h23' | 'h12';
  readonly hour: 'numeric' | '2-digit';
}

export interface LocaleProfile {
  /** Étiquette BCP 47 (`es-PA`, `es-PY`, `en`, `fr`, `pt`). Sert aussi à l'attribut `lang`. */
  readonly tag: string;
  readonly language: CatalogLanguage;
  /** Nom de la locale dans sa propre langue (sélecteur de langue, UX-11). */
  readonly displayName: string;
  readonly number: NumberProfile;
  readonly currency: CurrencyProfile;
  readonly date: DateProfile;
}

export interface LocaleConfig {
  /** Locale de repli quand ni le choix mémorisé ni `Accept-Language` ne conviennent. */
  readonly defaultLocale: string;
  readonly locales: readonly LocaleProfile[];
}

export class LocaleConfigError extends Error {
  override readonly name = 'LocaleConfigError';
}

function fail(path: string, expected: string): never {
  throw new LocaleConfigError(`Configuration de locales invalide : ${path} doit être ${expected}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0)
    fail(`${path}.${key}`, 'une chaîne non vide');
  return value;
}

function oneOf<T extends string | number>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const value = obj[key];
  if (!allowed.includes(value as T))
    fail(`${path}.${key}`, `l'une des valeurs ${allowed.join(', ')}`);
  return value as T;
}

function rec(obj: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const value = obj[key];
  if (!isRecord(value)) fail(`${path}.${key}`, 'un objet');
  return value;
}

function requirePlaceholders(pattern: string, names: readonly string[], path: string): void {
  for (const name of names) {
    if (!pattern.includes(`{${name}}`)) fail(path, `un gabarit contenant {${name}}`);
  }
}

function parseProfile(raw: unknown, path: string): LocaleProfile {
  if (!isRecord(raw)) fail(path, 'un objet');
  const tag = str(raw, 'tag', path);
  try {
    if (Intl.getCanonicalLocales(tag)[0] !== tag)
      fail(`${path}.tag`, 'une étiquette BCP 47 canonique');
  } catch (error) {
    if (error instanceof LocaleConfigError) throw error;
    fail(`${path}.tag`, 'une étiquette BCP 47 valide');
  }
  const language = oneOf(raw, 'language', CATALOG_LANGUAGES, path);
  if (tag.split('-')[0] !== language) fail(`${path}.language`, `la langue de l'étiquette ${tag}`);

  const n = rec(raw, 'number', path);
  const number: NumberProfile = {
    group: str(n, 'group', `${path}.number`),
    decimal: str(n, 'decimal', `${path}.number`),
    minimumGroupingDigits: oneOf(n, 'minimumGroupingDigits', [1, 2] as const, `${path}.number`),
  };
  if (number.group === number.decimal) fail(`${path}.number`, 'deux séparateurs distincts');

  const c = rec(raw, 'currency', path);
  const symbolsRaw = rec(c, 'symbols', `${path}.currency`);
  const symbols: Record<string, string> = {};
  for (const [code, symbol] of Object.entries(symbolsRaw)) {
    if (!/^[A-Z]{3}$/.test(code)) fail(`${path}.currency.symbols`, 'indexé par des codes ISO 4217');
    if (typeof symbol !== 'string' || symbol.length === 0) {
      fail(`${path}.currency.symbols.${code}`, 'une chaîne non vide');
    }
    symbols[code] = symbol;
  }
  const currency: CurrencyProfile = {
    symbols,
    pattern: str(c, 'pattern', `${path}.currency`),
    negativePattern: str(c, 'negativePattern', `${path}.currency`),
  };
  requirePlaceholders(currency.pattern, ['symbol', 'amount'], `${path}.currency.pattern`);
  requirePlaceholders(
    currency.negativePattern,
    ['symbol', 'amount'],
    `${path}.currency.negativePattern`,
  );

  const d = rec(raw, 'date', path);
  const date: DateProfile = {
    datePattern: str(d, 'datePattern', `${path}.date`),
    timePattern: str(d, 'timePattern', `${path}.date`),
    dateTimePattern: str(d, 'dateTimePattern', `${path}.date`),
    hourCycle: oneOf(d, 'hourCycle', ['h23', 'h12'] as const, `${path}.date`),
    hour: oneOf(d, 'hour', ['numeric', '2-digit'] as const, `${path}.date`),
  };
  requirePlaceholders(date.datePattern, ['day', 'month', 'year'], `${path}.date.datePattern`);
  requirePlaceholders(date.timePattern, ['hour', 'minute'], `${path}.date.timePattern`);
  requirePlaceholders(date.dateTimePattern, ['date', 'time'], `${path}.date.dateTimePattern`);
  if (date.hourCycle === 'h12') {
    requirePlaceholders(date.timePattern, ['dayPeriod'], `${path}.date.timePattern`);
  }

  return { tag, language, displayName: str(raw, 'displayName', path), number, currency, date };
}

/** Valide une configuration brute (JSON) ; lève `LocaleConfigError` au premier défaut. */
export function parseLocaleConfig(raw: unknown): LocaleConfig {
  if (!isRecord(raw)) fail('racine', 'un objet');
  const list = raw['locales'];
  if (!Array.isArray(list) || list.length === 0) fail('locales', 'une liste non vide');
  const locales = list.map((item, i) => parseProfile(item, `locales[${i}]`));
  const tags = new Set<string>();
  for (const profile of locales) {
    if (tags.has(profile.tag)) fail('locales', `sans doublon (${profile.tag})`);
    tags.add(profile.tag);
  }
  const defaultLocale = str(raw, 'defaultLocale', 'racine');
  if (!tags.has(defaultLocale)) fail('defaultLocale', 'une des locales déclarées');
  return { defaultLocale, locales };
}

/** Profil d'une locale déclarée ; lève une erreur si elle ne l'est pas (fail-closed). */
export function getProfile(config: LocaleConfig, tag: string): LocaleProfile {
  const profile = config.locales.find((p) => p.tag === tag);
  if (!profile) throw new LocaleConfigError(`Locale non déclarée : ${tag}.`);
  return profile;
}
