/**
 * Modèle de la configuration pays (17 §1.1–§1.4, §3.2 « C — référence et configuration », §7 ;
 * US-013). Ce fichier ne contient **aucune valeur propre à un pays** (ADR-024) : seulement les
 * vocabulaires fermés de 17, communs à tous les pays.
 */

/** Types de paramètre (17 §3.2 `param_definition.type`). */
export const PARAM_TYPES = ['INT', 'BOOL', 'DURATION', 'MONEY', 'BPS', 'ENUM', 'JSON'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/**
 * Portées, de la plus spécifique à la moins spécifique (17 §7.1 point 6 :
 * `NETWORK > PSP > ORG > CATEGORY > COUNTRY`).
 */
export const PARAM_SCOPES = ['NETWORK', 'PSP', 'ORG', 'CATEGORY', 'COUNTRY'] as const;
export type ParamScope = (typeof PARAM_SCOPES)[number];

/** Comportement en l'absence de valeur (17 §7.1 point 7). */
export const FAIL_MODES = ['BLOCK', 'FALSE', 'ZERO'] as const;
export type FailMode = (typeof FAIL_MODES)[number];

/** Types de ligne d'un devis (17 §3.2 `quote_line.line_type`, 08 `LINES`) : `tax_line_config` les couvre tous. */
export const TAX_LINE_TYPES = [
  'TRIP_PRICE',
  'PROMO_PLATFORM',
  'PROMO_HOST',
  'TRIP_FEE',
  'PROTECTION',
  'EXTRAS',
  'ENHANCED_ROADSIDE',
  'ADDITIONAL_DRIVER_FEE',
  'YOUNG_DRIVER_FEE',
  'DELIVERY_FEE',
] as const;
export type TaxLineType = (typeof TAX_LINE_TYPES)[number];

/** Langues des catalogues (DEC-FONDATEUR-17, 18) : chaque pays a un nom dans chacune. */
export const NAME_LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;
export type NameLanguage = (typeof NAME_LANGUAGES)[number];

/** Borne technique d'un `bigint` PostgreSQL (unités mineures, 17 §1.2). */
export const INT64_MAX = 9_223_372_036_854_775_807n;

/** Valeur JSON d'un paramètre (`param_value.value jsonb`). Aucun flottant (17 §1.2). */
export type ParamJson =
  null | boolean | number | string | ParamJson[] | { [key: string]: ParamJson };

export interface CurrencyConfig {
  readonly code: string;
  readonly exponent: number;
}

export interface TaxLineConfig {
  readonly lineType: TaxLineType;
  readonly taxable: boolean;
  /** Groupe fiscal ; `null` si la ligne n'est pas taxable. */
  readonly rateGroup: string | null;
  /** Taux en points de base ; `null` si la ligne n'est pas taxable. */
  readonly rateBps: number | null;
  /** Taxe collectée pour le compte d'un tiers (jambe `TAX_THIRD_PARTY`, 08 BR-PRICE-12). */
  readonly thirdParty: boolean;
}

export interface LegalEntityConfig {
  readonly name: string;
  readonly countryOfIncorporation: string;
  readonly taxId: string;
  readonly invoicingRegime: string;
}

export interface HolidayConfig {
  /** Date civile locale `AAAA-MM-JJ`. */
  readonly date: string;
  readonly name: string;
}

export interface TimeZoneCheck {
  readonly instant: string;
  readonly offsetMinutes: number;
}

export interface CountryConfigEntry {
  readonly code: string;
  readonly names: Readonly<Record<NameLanguage, string>>;
  readonly currency: CurrencyConfig;
  readonly timeZone: string;
  /** Locale de la version faisant foi des documents juridiques (17 §7.1 point 5). */
  readonly legalLocale: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly hostTaxIdKinds: readonly string[];
  readonly taxLines: readonly TaxLineConfig[];
  readonly legalEntity: LegalEntityConfig | null;
  readonly holidayCalendar: {
    readonly version: number;
    readonly holidays: readonly HolidayConfig[];
  };
  readonly timeZoneChecks: readonly TimeZoneCheck[];
}

export interface ParamDefinition {
  readonly key: string;
  readonly type: ParamType;
  readonly unit: string | null;
  readonly scopes: readonly ParamScope[];
  readonly currencyBound: boolean;
  readonly failMode: FailMode;
  /** Absence légitime (repli documenté par la clé) : ne compte pas dans le contrôle de production. */
  readonly optional: boolean;
  /** Interrupteur de mise en service (17 §0.1, ADR-046) : booléen, portée pays, absent ⇒ `false`. */
  readonly goLiveSwitch: boolean;
  /** Pays où la clé est sans objet (17 §7.2 « — »). */
  readonly notApplicableIn: readonly string[];
  readonly allowedValues: readonly string[] | null;
  /** JSON : ensemble exact des clés attendues (par exemple les cas de `host_penalty`, 08 penalty()). */
  readonly jsonKeys: readonly string[] | null;
  readonly source: string;
  readonly status: string;
}

export interface ParamValue {
  readonly key: string;
  readonly country: string;
  readonly scopeType: ParamScope;
  /** Identifiant de portée (`ORG`, `PSP`, `CATEGORY`) ; `null` pour `COUNTRY` et `NETWORK`. */
  readonly scopeId: string | null;
  /** Réseau de carte (`NETWORK`) ; `null` sinon. */
  readonly network: string | null;
  /** Devise du pays si la clé est liée à une devise (`currency_bound`), sinon `null`. */
  readonly currency: string | null;
  readonly value: ParamJson;
  /** Début de validité ; `null` = depuis le chargement de la graine. */
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
}

/** Configuration validée, immuable. Seule `parseCountryConfig` en fabrique une. */
export interface CountryConfig {
  readonly version: number;
  readonly currencies: readonly CurrencyConfig[];
  readonly countries: ReadonlyMap<string, CountryConfigEntry>;
  readonly definitions: ReadonlyMap<string, ParamDefinition>;
  readonly values: readonly ParamValue[];
}
