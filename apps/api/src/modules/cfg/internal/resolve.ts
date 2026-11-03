/**
 * Lecture des paramètres (17 §7.1 points 6 et 7 ; 16 ADM-014 ; US-013).
 *
 * - Résolution par ordre de spécificité `NETWORK > PSP > ORG > CATEGORY > COUNTRY`, à la date
 *   de l'événement, fournie par l'appelant (l'horloge fait foi côté base : `platform.now()` ;
 *   ce module ne lit jamais l'horloge du serveur).
 * - Absence de valeur : `fail_mode` (`BLOCK` ⇒ `PARAM_MISSING`, `FALSE` ⇒ `false`, `ZERO` ⇒ 0).
 * - Interrupteurs de mise en service : `isGoLiveSwitchOn` ne lève jamais ; clé absente ou
 *   inconnue, pays inconnu, valeur illisible ⇒ `false` (17 §0.1, ADR-046).
 * - Non-rétroactivité : `assertNotRetroactive` ⇒ `PARAM_RETROACTIVE`.
 */
import { ConfigError } from './errors.js';
import { PARAM_SCOPES } from './model.js';
import type { CountryConfig, ParamDefinition, ParamJson, ParamScope, ParamValue } from './model.js';

/** Contexte de résolution : pays obligatoire, portées plus fines facultatives. */
export interface ParamContext {
  readonly country: string;
  /** Instant de l'événement (lu dans la base, `platform.now()` ou date figée). */
  readonly at: Date;
  readonly network?: string;
  readonly psp?: string;
  readonly org?: string;
  readonly category?: string;
}

export interface ResolvedParam {
  readonly key: string;
  readonly value: ParamJson;
  /** `VALUE` : valeur configurée ; `FAIL_MODE` : valeur d'absence (`FALSE` ou `ZERO`). */
  readonly origin: 'VALUE' | 'FAIL_MODE';
  readonly scopeType: ParamScope | null;
  readonly currency: string | null;
}

function isValidAt(value: ParamValue, at: Date): boolean {
  const t = at.getTime();
  return (
    (value.validFrom === null || value.validFrom.getTime() <= t) &&
    (value.validTo === null || t < value.validTo.getTime())
  );
}

function matchesScope(value: ParamValue, ctx: ParamContext): boolean {
  switch (value.scopeType) {
    case 'COUNTRY':
      return true;
    case 'NETWORK':
      return ctx.network !== undefined && value.network === ctx.network;
    case 'PSP':
      return ctx.psp !== undefined && value.scopeId === ctx.psp;
    case 'ORG':
      return ctx.org !== undefined && value.scopeId === ctx.org;
    case 'CATEGORY':
      return ctx.category !== undefined && value.scopeId === ctx.category;
  }
}

function requireDefinition(config: CountryConfig, key: string): ParamDefinition {
  const def = config.definitions.get(key);
  if (!def) throw new ConfigError('PARAM_UNKNOWN', `clé de paramètre inconnue « ${key} »`);
  return def;
}

function requireCountry(config: CountryConfig, country: string): void {
  if (!config.countries.has(country)) {
    throw new ConfigError('COUNTRY_UNKNOWN', `pays non configuré « ${country} »`);
  }
}

/** Valeur en vigueur la plus spécifique, ou `undefined`. */
function findValue(config: CountryConfig, key: string, ctx: ParamContext): ParamValue | undefined {
  let best: ParamValue | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const value of config.values) {
    if (value.key !== key || value.country !== ctx.country) continue;
    if (!isValidAt(value, ctx.at) || !matchesScope(value, ctx)) continue;
    const rank = PARAM_SCOPES.indexOf(value.scopeType);
    const newer =
      best !== undefined &&
      rank === bestRank &&
      (value.validFrom?.getTime() ?? 0) > (best.validFrom?.getTime() ?? 0);
    if (rank < bestRank || newer) {
      best = value;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Résout un paramètre. Lève `PARAM_UNKNOWN` (clé inconnue), `COUNTRY_UNKNOWN`,
 * `PARAM_NOT_APPLICABLE` (clé sans objet dans ce pays), `PARAM_MISSING` (absente et `BLOCK`).
 * Une clé `optional` absente lève aussi `PARAM_MISSING` : l'appelant applique son repli
 * documenté avec `findOptionalParam`.
 */
export function resolveParam(config: CountryConfig, key: string, ctx: ParamContext): ResolvedParam {
  const def = requireDefinition(config, key);
  requireCountry(config, ctx.country);
  if (def.notApplicableIn.includes(ctx.country)) {
    throw new ConfigError(
      'PARAM_NOT_APPLICABLE',
      `« ${key} » est sans objet dans le pays ${ctx.country}`,
    );
  }
  const found = findValue(config, key, ctx);
  if (found) {
    return {
      key,
      value: found.value,
      origin: 'VALUE',
      scopeType: found.scopeType,
      currency: found.currency,
    };
  }
  switch (def.failMode) {
    case 'FALSE':
      return { key, value: false, origin: 'FAIL_MODE', scopeType: null, currency: null };
    case 'ZERO': {
      const currency = def.currencyBound
        ? (config.countries.get(ctx.country)?.currency.code ?? null)
        : null;
      return {
        key,
        value: def.type === 'MONEY' ? '0' : 0,
        origin: 'FAIL_MODE',
        scopeType: null,
        currency,
      };
    }
    case 'BLOCK':
      throw new ConfigError('PARAM_MISSING', `paramètre « ${key} » absent pour ${ctx.country}`);
  }
}

/** Clé `optional` : valeur en vigueur ou `undefined` (repli documenté par l'appelant). */
export function findOptionalParam(
  config: CountryConfig,
  key: string,
  ctx: ParamContext,
): ResolvedParam | undefined {
  const def = requireDefinition(config, key);
  if (!def.optional) {
    throw new ConfigError(
      'PARAM_UNKNOWN',
      `« ${key} » n'est pas une clé optionnelle : utiliser resolveParam`,
    );
  }
  requireCountry(config, ctx.country);
  const found = findValue(config, key, ctx);
  return (
    found && {
      key,
      value: found.value,
      origin: 'VALUE',
      scopeType: found.scopeType,
      currency: found.currency,
    }
  );
}

/**
 * Interrupteur de mise en service par pays (17 §0.1). Fail-closed, ne lève jamais : seule une
 * valeur booléenne `true` en vigueur, sur une clé déclarée interrupteur, rend `true`.
 */
export function isGoLiveSwitchOn(
  config: CountryConfig,
  key: string,
  country: string,
  at: Date,
): boolean {
  try {
    const def = config.definitions.get(key);
    if (!def?.goLiveSwitch || !config.countries.has(country)) return false;
    const found = findValue(config, key, { country, at });
    return found?.scopeType === 'COUNTRY' && found.value === true;
  } catch {
    return false;
  }
}

/**
 * Une nouvelle valeur n'est jamais rétroactive (17 §7.1 point 6 ; 16 ADM-014) : `validFrom` doit
 * être postérieur ou égal à `now`, l'instant de la base (`platform.now()`) lu par l'appelant.
 */
export function assertNotRetroactive(validFrom: Date, now: Date): void {
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(now.getTime())) {
    throw new ConfigError('PARAM_RETROACTIVE', 'instant de validité illisible');
  }
  if (validFrom.getTime() < now.getTime()) {
    throw new ConfigError(
      'PARAM_RETROACTIVE',
      `valid_from ${validFrom.toISOString()} antérieur à l'instant de la base ${now.toISOString()}`,
    );
  }
}
