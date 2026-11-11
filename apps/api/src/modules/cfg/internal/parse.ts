/**
 * Validation **fail-closed** de la configuration pays (US-013 ; 17 §7 ; ADR-024, ADR-033).
 *
 * Entrée : les trois documents de données (`currencies.json`, `countries.json`, `params.json`)
 * et la liste des locales connues de `@rueda/i18n` (`config/locales.json`, réutilisée et non
 * dupliquée). Sortie : une `CountryConfig` immuable, ou `CONFIG_INVALID` avec **tous** les défauts.
 * Rien n'est complété par défaut : une donnée absente, mal typée ou inconnue est un refus.
 */
import { ConfigError } from './errors.js';
import {
  DECISION_STATUSES,
  FAIL_MODES,
  INT64_MAX,
  NAME_LANGUAGES,
  PARAM_SCOPES,
  PARAM_TYPES,
  TAX_LINE_TYPES,
} from './model.js';
import type {
  CountryConfig,
  CountryConfigEntry,
  CurrencyConfig,
  DecisionInfo,
  DecisionStatus,
  FailMode,
  HolidayConfig,
  LegalEntityConfig,
  NameLanguage,
  ParamDefinition,
  ParamJson,
  ParamScope,
  ParamType,
  ParamValue,
  TaxLineConfig,
  TaxLineType,
  TimeZoneCheck,
} from './model.js';

export interface CountryConfigSources {
  readonly currencies: unknown;
  readonly countries: unknown;
  readonly params: unknown;
}

export interface ParseOptions {
  /** Étiquettes des locales configurées dans `@rueda/i18n` (`config/locales.json`). */
  readonly knownLocales: readonly string[];
}

/** Borne technique de l'exposant (identique à `@rueda/money`, `MAX_CURRENCY_EXPONENT`). */
const MAX_EXPONENT = 18;
const MAX_BPS = 10_000;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const PARAM_KEY = /^[a-z][a-z0-9_]*$/;
const CODE = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]*$/u;
const MINOR = /^(0|[1-9][0-9]*)$/;
const RATIO = /^(0|[1-9][0-9]*)\/([1-9][0-9]*)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

type Obj = Record<string, unknown>;

class Collector {
  readonly errors: string[] = [];
  add(path: string, message: string): void {
    this.errors.push(`${path} : ${message}`);
  }
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Gel profond d'une valeur JSON validée (la configuration est immuable). */
function deepFreeze(value: ParamJson): ParamJson {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Les clés commençant par `$` sont des commentaires de données. */
function checkKeys(c: Collector, path: string, obj: Obj, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('$') && !allowed.includes(key)) c.add(path, `champ inconnu « ${key} »`);
  }
}

function str(c: Collector, path: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    c.add(path, 'chaîne non vide attendue');
    return undefined;
  }
  return value;
}

function int(
  c: Collector,
  path: string,
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    c.add(path, `entier de ${min} à ${max} attendu`);
    return undefined;
  }
  return value;
}

function bool(c: Collector, path: string, value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') {
    c.add(path, 'booléen attendu');
    return undefined;
  }
  return value;
}

function strList(
  c: Collector,
  path: string,
  value: unknown,
  allowEmpty = false,
): string[] | undefined {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    c.add(path, allowEmpty ? 'liste attendue' : 'liste non vide attendue');
    return undefined;
  }
  const out: string[] = [];
  value.forEach((item, i) => {
    const s = str(c, `${path}[${i}]`, item);
    if (s !== undefined) {
      if (out.includes(s)) c.add(`${path}[${i}]`, `doublon « ${s} »`);
      out.push(s);
    }
  });
  return out;
}

function oneOf<T extends string>(
  c: Collector,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    c.add(path, `valeur attendue parmi ${allowed.join(', ')}`);
    return undefined;
  }
  return value as T;
}

/**
 * Statut de décision (US-110) : `decision` parmi `DECISION_STATUSES` et `decisionRef` non vide,
 * tous deux obligatoires (aucun statut deviné : une clé sans statut est un refus).
 */
function decisionInfo(
  c: Collector,
  path: string,
  decision: unknown,
  ref: unknown,
): DecisionInfo | undefined {
  const status = oneOf<DecisionStatus>(c, `${path}.decision`, decision, DECISION_STATUSES);
  const decisionRef = str(c, `${path}.decisionRef`, ref);
  if (status === undefined || decisionRef === undefined) return undefined;
  return Object.freeze({ decision: status, decisionRef });
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function isValidDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function isValidInstant(text: string): boolean {
  return ISO_INSTANT.test(text) && !Number.isNaN(Date.parse(text));
}

/** Document racine `{ version, <listKey>: [...] }`. */
function rootList(c: Collector, name: string, doc: unknown, listKey: string): unknown[] {
  if (!isObject(doc)) {
    c.add(name, 'objet attendu');
    return [];
  }
  checkKeys(c, name, doc, ['version', listKey]);
  int(c, `${name}.version`, doc['version'], 1, Number.MAX_SAFE_INTEGER);
  const list = doc[listKey];
  if (!Array.isArray(list) || list.length === 0) {
    c.add(`${name}.${listKey}`, 'liste non vide attendue');
    return [];
  }
  return list;
}

function parseCurrencies(c: Collector, doc: unknown): CurrencyConfig[] {
  const out: CurrencyConfig[] = [];
  rootList(c, 'currencies', doc, 'currencies').forEach((raw, i) => {
    const path = `currencies[${i}]`;
    if (!isObject(raw)) return c.add(path, 'objet attendu');
    checkKeys(c, path, raw, ['code', 'exponent', 'source']);
    const code = raw['code'];
    if (typeof code !== 'string' || !CURRENCY_CODE.test(code)) {
      return c.add(`${path}.code`, 'code ISO 4217 (trois majuscules) attendu');
    }
    const exponent = int(c, `${path}.exponent`, raw['exponent'], 0, MAX_EXPONENT);
    str(c, `${path}.source`, raw['source']);
    if (out.some((x) => x.code === code))
      return c.add(`${path}.code`, `devise en double « ${code} »`);
    if (exponent !== undefined) out.push(Object.freeze({ code, exponent }));
  });
  return out;
}

function parseTaxLines(c: Collector, path: string, value: unknown): TaxLineConfig[] {
  if (!Array.isArray(value)) {
    c.add(path, 'liste attendue');
    return [];
  }
  const out: TaxLineConfig[] = [];
  const groups = new Map<string, { rateBps: number; thirdParty: boolean }>();
  value.forEach((raw, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(raw)) return c.add(p, 'objet attendu');
    checkKeys(c, p, raw, ['lineType', 'taxable', 'rateGroup', 'rateBps', 'thirdParty']);
    const lineType = oneOf<TaxLineType>(c, `${p}.lineType`, raw['lineType'], TAX_LINE_TYPES);
    const taxable = bool(c, `${p}.taxable`, raw['taxable']);
    if (lineType === undefined || taxable === undefined) return;
    if (out.some((x) => x.lineType === lineType))
      return c.add(p, `ligne en double « ${lineType} »`);
    if (!taxable) {
      if (raw['rateGroup'] !== undefined || raw['rateBps'] !== undefined) {
        return c.add(p, 'ligne non taxable : ni rateGroup ni rateBps');
      }
      if (raw['thirdParty'] !== undefined && raw['thirdParty'] !== false) {
        return c.add(p, 'ligne non taxable : thirdParty doit être false');
      }
      out.push(
        Object.freeze({ lineType, taxable, rateGroup: null, rateBps: null, thirdParty: false }),
      );
      return;
    }
    const rateGroup = str(c, `${p}.rateGroup`, raw['rateGroup']);
    const rateBps = int(c, `${p}.rateBps`, raw['rateBps'], 0, MAX_BPS);
    const thirdParty = bool(c, `${p}.thirdParty`, raw['thirdParty']);
    if (rateGroup === undefined || rateBps === undefined || thirdParty === undefined) return;
    const group = groups.get(rateGroup);
    if (group && (group.rateBps !== rateBps || group.thirdParty !== thirdParty)) {
      // 17 §3.2 : un même rate_group a la même valeur de third_party (et un seul taux).
      return c.add(p, `groupe « ${rateGroup} » incohérent (taux ou thirdParty différents)`);
    }
    groups.set(rateGroup, { rateBps, thirdParty });
    out.push(Object.freeze({ lineType, taxable, rateGroup, rateBps, thirdParty }));
  });
  for (const lineType of TAX_LINE_TYPES) {
    if (!out.some((x) => x.lineType === lineType)) c.add(path, `ligne « ${lineType} » absente`);
  }
  return out;
}

function parseLegalEntity(c: Collector, path: string, value: unknown): LegalEntityConfig | null {
  if (value === null) return null;
  if (!isObject(value)) {
    c.add(path, 'objet ou null attendu');
    return null;
  }
  checkKeys(c, path, value, ['name', 'countryOfIncorporation', 'taxId', 'invoicingRegime']);
  const name = str(c, `${path}.name`, value['name']);
  const countryOfIncorporation = value['countryOfIncorporation'];
  if (typeof countryOfIncorporation !== 'string' || !COUNTRY_CODE.test(countryOfIncorporation)) {
    c.add(`${path}.countryOfIncorporation`, 'code ISO 3166-1 attendu');
  }
  const taxId = str(c, `${path}.taxId`, value['taxId']);
  const invoicingRegime = value['invoicingRegime'];
  if (typeof invoicingRegime !== 'string' || !CODE.test(invoicingRegime)) {
    c.add(`${path}.invoicingRegime`, 'code attendu');
  }
  if (
    name === undefined ||
    taxId === undefined ||
    typeof countryOfIncorporation !== 'string' ||
    typeof invoicingRegime !== 'string'
  ) {
    return null;
  }
  return Object.freeze({ name, countryOfIncorporation, taxId, invoicingRegime });
}

function parseHolidays(
  c: Collector,
  path: string,
  value: unknown,
): CountryConfigEntry['holidayCalendar'] | undefined {
  if (!isObject(value)) {
    c.add(path, 'objet attendu');
    return undefined;
  }
  checkKeys(c, path, value, ['version', 'holidays']);
  const version = int(c, `${path}.version`, value['version'], 1, Number.MAX_SAFE_INTEGER);
  const list = value['holidays'];
  if (!Array.isArray(list)) {
    c.add(`${path}.holidays`, 'liste attendue');
    return undefined;
  }
  const holidays: HolidayConfig[] = [];
  list.forEach((raw, i) => {
    const p = `${path}.holidays[${i}]`;
    if (!isObject(raw)) return c.add(p, 'objet attendu');
    checkKeys(c, p, raw, ['date', 'name']);
    const date = raw['date'];
    const name = str(c, `${p}.name`, raw['name']);
    if (typeof date !== 'string' || !isValidDate(date))
      return c.add(`${p}.date`, 'date AAAA-MM-JJ attendue');
    if (holidays.some((h) => h.date === date)) return c.add(p, `date en double ${date}`);
    if (name !== undefined) holidays.push(Object.freeze({ date, name }));
  });
  if (version === undefined) return undefined;
  return Object.freeze({ version, holidays: Object.freeze(holidays) });
}

function parseTimeZoneChecks(c: Collector, path: string, value: unknown): TimeZoneCheck[] {
  if (!Array.isArray(value) || value.length === 0) {
    // Le contrôle de démarrage (17 §1.3) doit couvrir le fuseau de chaque pays.
    c.add(path, 'liste non vide attendue (contrôle tzdata de démarrage)');
    return [];
  }
  const out: TimeZoneCheck[] = [];
  value.forEach((raw, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(raw)) return c.add(p, 'objet attendu');
    checkKeys(c, p, raw, ['instant', 'offsetMinutes']);
    const instant = raw['instant'];
    if (typeof instant !== 'string' || !isValidInstant(instant)) {
      return c.add(`${p}.instant`, 'instant ISO 8601 UTC (…Z) attendu');
    }
    const offsetMinutes = int(c, `${p}.offsetMinutes`, raw['offsetMinutes'], -840, 840);
    if (offsetMinutes !== undefined) out.push(Object.freeze({ instant, offsetMinutes }));
  });
  return out;
}

function parseCountries(
  c: Collector,
  doc: unknown,
  currencies: readonly CurrencyConfig[],
  knownLocales: readonly string[],
): Map<string, CountryConfigEntry> {
  const out = new Map<string, CountryConfigEntry>();
  rootList(c, 'countries', doc, 'countries').forEach((raw, i) => {
    const path = `countries[${i}]`;
    if (!isObject(raw)) return c.add(path, 'objet attendu');
    checkKeys(c, path, raw, [
      'code',
      'names',
      'currency',
      'timeZone',
      'legalLocale',
      'defaultLocale',
      'locales',
      'hostTaxIdKinds',
      'taxLines',
      'taxDecision',
      'legalEntity',
      'holidayCalendar',
      'timeZoneChecks',
    ]);
    const code = raw['code'];
    if (typeof code !== 'string' || !COUNTRY_CODE.test(code)) {
      return c.add(`${path}.code`, 'code ISO 3166-1 (deux majuscules) attendu');
    }
    if (out.has(code)) return c.add(`${path}.code`, `pays en double « ${code} »`);
    const p = `countries.${code}`;

    const names: Partial<Record<NameLanguage, string>> = {};
    const rawNames = raw['names'];
    if (!isObject(rawNames)) {
      c.add(`${p}.names`, 'objet attendu');
    } else {
      checkKeys(c, `${p}.names`, rawNames, NAME_LANGUAGES);
      for (const lang of NAME_LANGUAGES) {
        const n = str(c, `${p}.names.${lang}`, rawNames[lang]);
        if (n !== undefined) names[lang] = n;
      }
    }

    const currencyCode = raw['currency'];
    const currency = currencies.find((x) => x.code === currencyCode);
    if (!currency) c.add(`${p}.currency`, `devise non configurée « ${String(currencyCode)} »`);

    const timeZone = str(c, `${p}.timeZone`, raw['timeZone']);
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      c.add(`${p}.timeZone`, `fuseau IANA inconnu du runtime « ${timeZone} »`);
    }

    const locales = strList(c, `${p}.locales`, raw['locales']) ?? [];
    for (const tag of locales) {
      if (!knownLocales.includes(tag)) {
        c.add(`${p}.locales`, `locale « ${tag} » absente de @rueda/i18n (config/locales.json)`);
      }
    }
    const legalLocale = str(c, `${p}.legalLocale`, raw['legalLocale']);
    const defaultLocale = str(c, `${p}.defaultLocale`, raw['defaultLocale']);
    for (const [field, tag] of [
      ['legalLocale', legalLocale],
      ['defaultLocale', defaultLocale],
    ] as const) {
      if (tag !== undefined && !locales.includes(tag)) {
        c.add(`${p}.${field}`, `« ${tag} » n'est pas une locale du pays`);
      }
    }

    const hostTaxIdKinds = strList(c, `${p}.hostTaxIdKinds`, raw['hostTaxIdKinds']) ?? [];
    for (const kind of hostTaxIdKinds) {
      if (!CODE.test(kind)) c.add(`${p}.hostTaxIdKinds`, `code attendu « ${kind} »`);
    }
    const taxLines = parseTaxLines(c, `${p}.taxLines`, raw['taxLines']);
    const rawTaxDecision = raw['taxDecision'];
    let taxDecision: DecisionInfo | undefined;
    if (!isObject(rawTaxDecision)) {
      c.add(`${p}.taxDecision`, 'objet { decision, decisionRef } attendu');
    } else {
      checkKeys(c, `${p}.taxDecision`, rawTaxDecision, ['decision', 'decisionRef']);
      taxDecision = decisionInfo(
        c,
        `${p}.taxDecision`,
        rawTaxDecision['decision'],
        rawTaxDecision['decisionRef'],
      );
    }
    if (!('legalEntity' in raw)) c.add(`${p}.legalEntity`, 'champ obligatoire (objet ou null)');
    const legalEntity = parseLegalEntity(c, `${p}.legalEntity`, raw['legalEntity']);
    const holidayCalendar = parseHolidays(c, `${p}.holidayCalendar`, raw['holidayCalendar']);
    const timeZoneChecks = parseTimeZoneChecks(c, `${p}.timeZoneChecks`, raw['timeZoneChecks']);

    if (
      !currency ||
      timeZone === undefined ||
      legalLocale === undefined ||
      defaultLocale === undefined ||
      holidayCalendar === undefined ||
      taxDecision === undefined ||
      NAME_LANGUAGES.some((l) => names[l] === undefined)
    ) {
      return;
    }
    out.set(
      code,
      Object.freeze({
        code,
        names: Object.freeze(names as Record<NameLanguage, string>),
        currency,
        timeZone,
        legalLocale,
        defaultLocale,
        locales: Object.freeze(locales),
        hostTaxIdKinds: Object.freeze(hostTaxIdKinds),
        taxLines: Object.freeze(taxLines),
        taxDecision,
        legalEntity,
        holidayCalendar,
        timeZoneChecks: Object.freeze(timeZoneChecks),
      }),
    );
  });
  return out;
}

/** Vérifie qu'une valeur JSON ne contient aucun nombre non entier (17 §1.2 : aucun flottant). */
function checkNoFloat(c: Collector, path: string, value: unknown): boolean {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      c.add(path, 'nombre non entier ou hors bornes (aucun flottant, 17 §1.2)');
      return false;
    }
    return true;
  }
  if (Array.isArray(value)) return value.every((v, i) => checkNoFloat(c, `${path}[${i}]`, v));
  if (isObject(value))
    return Object.entries(value).every(([k, v]) => checkNoFloat(c, `${path}.${k}`, v));
  return value === null || typeof value === 'string' || typeof value === 'boolean';
}

function checkValue(
  c: Collector,
  path: string,
  def: ParamDefinition,
  value: unknown,
): value is ParamJson {
  switch (def.type) {
    case 'INT':
    case 'DURATION':
      return int(c, path, value, 0, Number.MAX_SAFE_INTEGER) !== undefined;
    case 'BPS':
      return int(c, path, value, 0, MAX_BPS) !== undefined;
    case 'BOOL':
      return bool(c, path, value) !== undefined;
    case 'MONEY':
      if (typeof value !== 'string' || !MINOR.test(value) || BigInt(value) > INT64_MAX) {
        c.add(path, 'montant en unités mineures attendu (chaîne d’entier ≥ 0, int64)');
        return false;
      }
      return true;
    case 'ENUM':
      return oneOf(c, path, value, def.allowedValues ?? []) !== undefined;
    case 'JSON':
      if (value === null || value === undefined) {
        c.add(path, 'valeur JSON non nulle attendue');
        return false;
      }
      return checkNoFloat(c, path, value) && checkJsonShape(c, path, def, value);
  }
}

function isMinor(value: unknown): boolean {
  return typeof value === 'string' && MINOR.test(value) && BigInt(value) <= INT64_MAX;
}

/** Fraction « n/d » exacte dans [0 ; 1] (part, 17 §1.2 ; lue ensuite par parseRatio). */
function isShare(value: unknown): boolean {
  const m = typeof value === 'string' ? RATIO.exec(value) : null;
  return m !== null && BigInt(m[1]!) <= BigInt(m[2]!);
}

function checkMap(
  c: Collector,
  path: string,
  value: unknown,
  check: (v: unknown) => boolean,
  what: string,
): boolean {
  if (!isObject(value) || Object.keys(value).length === 0) {
    c.add(path, `objet non vide attendu (${what})`);
    return false;
  }
  let ok = true;
  for (const [k, v] of Object.entries(value)) {
    if (!CODE.test(k) && !/^[a-z][A-Za-z0-9]*$/.test(k)) {
      c.add(`${path}.${k}`, 'clé de code attendue');
      ok = false;
    } else if (!check(v)) {
      c.add(`${path}.${k}`, what);
      ok = false;
    }
  }
  return ok;
}

/**
 * Forme et bornes des paramètres JSON, selon l'unité déclarée (revue argent US-013) : montants
 * en chaînes d'entiers bornées à int64, parts dans [0 ; 1], listes strictement croissantes,
 * barème du trip fee ordonné et ouvert. Une unité JSON inconnue est refusée.
 */
function checkJsonShape(c: Collector, path: string, def: ParamDefinition, value: unknown): boolean {
  const unit = def.unit ?? '';
  if (def.jsonKeys !== null) {
    const keys = isObject(value) ? Object.keys(value).sort() : [];
    if (keys.join() !== [...def.jsonKeys].sort().join()) {
      c.add(path, `clés attendues : ${def.jsonKeys.join(', ')}`);
      return false;
    }
  }
  if (unit.startsWith('minor_by_')) {
    return checkMap(c, path, value, isMinor, 'montant en unités mineures (chaîne d’entier, int64)');
  }
  if (unit.startsWith('ratio_by_'))
    return checkMap(c, path, value, isShare, 'part « n/d » dans [0 ; 1]');
  if (unit === 'ratio') {
    if (isShare(value)) return true;
    c.add(path, 'part « n/d » dans [0 ; 1] attendue');
    return false;
  }
  if (unit.endsWith('_list')) {
    const ok =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v, i) => Number.isSafeInteger(v) && v > 0 && (i === 0 || v > value[i - 1]));
    if (!ok) c.add(path, 'liste non vide d’entiers positifs strictement croissants attendue');
    return ok;
  }
  if (unit === 'tiers_bps_and_min_minor') {
    const v = isObject(value) ? value : {};
    const tiers = v['tiers'];
    let ok =
      isObject(value) &&
      Object.keys(v).sort().join() === 'minMinor,tiers' &&
      isMinor(v['minMinor']);
    if (!Array.isArray(tiers) || tiers.length === 0) ok = false;
    else {
      let previous = 0;
      tiers.forEach((t, i) => {
        const tier = isObject(t) ? t : {};
        const last = i === tiers.length - 1;
        const maxDays = tier['maxDays'];
        const rate = tier['rateBps'];
        const daysOk = last
          ? maxDays === null
          : Number.isSafeInteger(maxDays) && (maxDays as number) > previous;
        if (
          !daysOk ||
          !Number.isSafeInteger(rate) ||
          (rate as number) < 0 ||
          (rate as number) > MAX_BPS
        ) {
          ok = false;
        }
        if (typeof maxDays === 'number') previous = maxDays;
      });
    }
    if (!ok) {
      c.add(
        path,
        'barème : { tiers: [{ maxDays croissant, rateBps 0–10 000 }…, dernier maxDays null], minMinor }',
      );
    }
    return ok;
  }
  c.add(`${path}`, `unité JSON inconnue « ${unit} » : forme non vérifiable (fail-closed)`);
  return false;
}

const DEFINITION_FIELDS = [
  'key',
  'type',
  'unit',
  'scopes',
  'currencyBound',
  'failMode',
  'optional',
  'goLiveSwitch',
  'notApplicableIn',
  'allowedValues',
  'jsonKeys',
  'source',
  'status',
  'decision',
  'decisionRef',
  'values',
  'scoped',
] as const;

function parseDefinition(
  c: Collector,
  path: string,
  raw: Obj,
  countries: ReadonlyMap<string, CountryConfigEntry>,
): ParamDefinition | undefined {
  checkKeys(c, path, raw, DEFINITION_FIELDS);
  const key = raw['key'] as string;
  const type = oneOf<ParamType>(c, `${path}.type`, raw['type'], PARAM_TYPES);
  const failMode = oneOf<FailMode>(c, `${path}.failMode`, raw['failMode'], FAIL_MODES);
  const unit = raw['unit'] === undefined ? null : (str(c, `${path}.unit`, raw['unit']) ?? null);
  const scopesRaw = strList(c, `${path}.scopes`, raw['scopes']) ?? [];
  const scopes = scopesRaw.filter((s): s is ParamScope => {
    const ok = (PARAM_SCOPES as readonly string[]).includes(s);
    if (!ok) c.add(`${path}.scopes`, `portée inconnue « ${s} »`);
    return ok;
  });
  const flag = (name: string): boolean =>
    raw[name] === undefined ? false : (bool(c, `${path}.${name}`, raw[name]) ?? false);
  const currencyBound = flag('currencyBound');
  const optional = flag('optional');
  const goLiveSwitch = flag('goLiveSwitch');
  const notApplicableIn =
    raw['notApplicableIn'] === undefined
      ? []
      : (strList(c, `${path}.notApplicableIn`, raw['notApplicableIn']) ?? []);
  for (const country of notApplicableIn) {
    if (!countries.has(country)) c.add(`${path}.notApplicableIn`, `pays inconnu « ${country} »`);
  }
  const allowedValues =
    raw['allowedValues'] === undefined
      ? null
      : (strList(c, `${path}.allowedValues`, raw['allowedValues']) ?? null);
  const jsonKeys =
    raw['jsonKeys'] === undefined
      ? null
      : (strList(c, `${path}.jsonKeys`, raw['jsonKeys']) ?? null);
  const source = str(c, `${path}.source`, raw['source']);
  const status = str(c, `${path}.status`, raw['status']);
  const decision = decisionInfo(c, path, raw['decision'], raw['decisionRef']);
  if (
    type === undefined ||
    failMode === undefined ||
    source === undefined ||
    status === undefined ||
    decision === undefined
  ) {
    return undefined;
  }
  if (scopes.length === 0) {
    c.add(`${path}.scopes`, 'au moins une portée');
    return undefined;
  }
  if (type === 'ENUM' && (allowedValues === null || allowedValues.length === 0)) {
    c.add(`${path}.allowedValues`, 'ENUM : liste des valeurs permises obligatoire');
  }
  if (type !== 'ENUM' && allowedValues !== null)
    c.add(`${path}.allowedValues`, 'réservé au type ENUM');
  if (failMode === 'FALSE' && type !== 'BOOL')
    c.add(`${path}.failMode`, 'FALSE réservé au type BOOL');
  if (failMode === 'ZERO' && !['INT', 'DURATION', 'MONEY', 'BPS'].includes(type)) {
    c.add(`${path}.failMode`, 'ZERO réservé aux types numériques');
  }
  if (jsonKeys !== null && type !== 'JSON') c.add(`${path}.jsonKeys`, 'réservé au type JSON');
  if (
    currencyBound &&
    type === 'JSON' &&
    !(unit?.startsWith('minor_by_') || unit === 'tiers_bps_and_min_minor')
  ) {
    c.add(`${path}.unit`, 'JSON lié à une devise : unité minor_by_* ou tiers_bps_and_min_minor');
  }
  if (currencyBound && !['MONEY', 'JSON'].includes(type)) {
    c.add(`${path}.currencyBound`, 'réservé aux types MONEY et JSON');
  }
  if (
    goLiveSwitch &&
    (type !== 'BOOL' || failMode !== 'FALSE' || scopes.join() !== 'COUNTRY' || optional)
  ) {
    // 17 §7.1 point 6 et §0.1 : un interrupteur est un booléen de portée COUNTRY, absent ⇒ false.
    c.add(path, 'interrupteur : type BOOL, failMode FALSE, portée COUNTRY seule, non optionnel');
  }
  if (goLiveSwitch && decision.decision !== 'DECIDED') {
    // US-110 : la valeur false d'un interrupteur est décidée (17 §0.1) ; son passage à true ne
    // relève pas du statut mais de la procédure à deux personnes (US-125).
    c.add(`${path}.decision`, 'interrupteur : statut DECIDED attendu (false, 17 §0.1)');
  }
  return Object.freeze({
    key,
    type,
    unit,
    scopes: Object.freeze(scopes),
    currencyBound,
    failMode,
    optional,
    goLiveSwitch,
    notApplicableIn: Object.freeze(notApplicableIn),
    allowedValues: allowedValues === null ? null : Object.freeze(allowedValues),
    jsonKeys: jsonKeys === null ? null : Object.freeze(jsonKeys),
    source,
    status,
    decision: decision.decision,
    decisionRef: decision.decisionRef,
  });
}

function parseParams(
  c: Collector,
  doc: unknown,
  countries: ReadonlyMap<string, CountryConfigEntry>,
): { definitions: Map<string, ParamDefinition>; values: ParamValue[] } {
  const definitions = new Map<string, ParamDefinition>();
  const values: ParamValue[] = [];
  const identity = new Set<string>();

  const pushValue = (
    path: string,
    def: ParamDefinition,
    country: string,
    scopeType: ParamScope,
    scopeId: string | null,
    network: string | null,
    value: unknown,
  ): void => {
    const entry = countries.get(country);
    if (!entry) return c.add(path, `pays inconnu « ${country} »`);
    if (def.notApplicableIn.includes(country))
      return c.add(path, `clé sans objet dans le pays ${country}`);
    if (!def.scopes.includes(scopeType))
      return c.add(path, `portée ${scopeType} non permise pour ${def.key}`);
    if (!checkValue(c, path, def, value)) return;
    if (def.goLiveSwitch && value !== false) {
      // Revue sécurité US-013 : aucune valeur autre que false n'entre par les données tant que la
      // procédure à deux personnes (US-125, RLS-27) n'existe pas ; la base refuse de même (FORBIDDEN).
      return c.add(
        path,
        'interrupteur de mise en service : seule la valeur false est permise (US-125)',
      );
    }
    const id = [def.key, country, scopeType, scopeId ?? '', network ?? ''].join('|');
    if (identity.has(id)) return c.add(path, 'valeur en double (même clé, pays et portée)');
    identity.add(id);
    values.push(
      Object.freeze({
        key: def.key,
        country,
        scopeType,
        scopeId,
        network,
        currency: def.currencyBound ? entry.currency.code : null,
        value: deepFreeze(value),
        validFrom: null,
        validTo: null,
        decision: def.decision,
        decisionRef: def.decisionRef,
        source: def.source,
      }),
    );
  };

  rootList(c, 'params', doc, 'params').forEach((raw, i) => {
    const path = `params[${i}]`;
    if (!isObject(raw)) return c.add(path, 'objet attendu');
    const key = raw['key'];
    if (typeof key !== 'string' || !PARAM_KEY.test(key))
      return c.add(`${path}.key`, 'clé snake_case attendue');
    if (definitions.has(key)) return c.add(`${path}.key`, `clé en double « ${key} »`);
    const p = `params.${key}`;
    const def = parseDefinition(c, p, raw, countries);
    if (!def) return;
    definitions.set(key, def);

    const byCountry = raw['values'];
    if (!isObject(byCountry)) {
      c.add(`${p}.values`, 'objet { pays: valeur } attendu (vide si à fixer)');
    } else {
      for (const [country, value] of Object.entries(byCountry)) {
        pushValue(`${p}.values.${country}`, def, country, 'COUNTRY', null, null, value);
      }
    }
    const scoped = raw['scoped'];
    if (scoped === undefined) return;
    if (!Array.isArray(scoped)) return c.add(`${p}.scoped`, 'liste attendue');
    scoped.forEach((s, j) => {
      const sp = `${p}.scoped[${j}]`;
      if (!isObject(s)) return c.add(sp, 'objet attendu');
      checkKeys(c, sp, s, ['country', 'scopeType', 'scopeId', 'network', 'value']);
      const country = str(c, `${sp}.country`, s['country']);
      const scopeType = oneOf<ParamScope>(c, `${sp}.scopeType`, s['scopeType'], PARAM_SCOPES);
      if (country === undefined || scopeType === undefined) return;
      if (scopeType === 'COUNTRY') return c.add(sp, 'portée COUNTRY : utiliser « values »');
      let scopeId: string | null = null;
      let network: string | null = null;
      if (scopeType === 'NETWORK') {
        if (s['scopeId'] !== undefined) return c.add(sp, 'NETWORK : pas de scopeId');
        const n = s['network'];
        if (typeof n !== 'string' || !CODE.test(n))
          return c.add(`${sp}.network`, 'code de réseau attendu');
        network = n;
      } else {
        if (s['network'] !== undefined) return c.add(sp, `${scopeType} : pas de network`);
        const id = str(c, `${sp}.scopeId`, s['scopeId']);
        if (id === undefined) return;
        scopeId = id;
      }
      pushValue(sp, def, country, scopeType, scopeId, network, s['value']);
    });
  });
  return { definitions, values };
}

/**
 * Valide les trois documents et rend une configuration immuable. Refuse (`CONFIG_INVALID`), en
 * listant tous les défauts, toute donnée absente, mal typée, inconnue ou incohérente.
 */
export function parseCountryConfig(
  sources: CountryConfigSources,
  options: ParseOptions,
): CountryConfig {
  const c = new Collector();
  const currencies = parseCurrencies(c, sources.currencies);
  const countries = parseCountries(c, sources.countries, currencies, options.knownLocales);
  const { definitions, values } = parseParams(c, sources.params, countries);
  const version = isObject(sources.countries) ? sources.countries['version'] : undefined;
  if (c.errors.length > 0) {
    throw new ConfigError('CONFIG_INVALID', 'configuration pays invalide', c.errors);
  }
  return Object.freeze({
    version: typeof version === 'number' ? version : 0,
    currencies: Object.freeze(currencies),
    countries,
    definitions,
    values: Object.freeze(values),
  });
}
