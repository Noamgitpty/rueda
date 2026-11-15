/**
 * Instantané des paramètres du pays pour un devis (17 §2.6 « paramètres pays (instantané) » ;
 * 16 PRC-025 « paramètre manquant ⇒ QUOTE_UNAVAILABLE »). Lit uniquement la configuration CFG
 * (`CountryConfig`, API publique du module CFG) : aucune valeur de pays n'est écrite ici.
 *
 * - devise et exposant : `currencies` / pays ;
 * - `grace_minutes`, `max_trip_days` ;
 * - règles fiscales : `taxLines` du pays (`tax_line_config`, taux en points de base, `thirdParty`) ;
 * - part de l'hôte : `host_share_pct[plan]`, plan = celui de l'hôte, sinon `host_default_plan` ;
 *   `delivery_share_pct` / `extras_share_pct` facultatives, absentes ⇒ part de l'hôte (17 §7.2) ;
 * - parts de l'assureur : `insurer_premium_share[niveau]`, `insurer_roadside_share`, fixées par le
 *   contrat d'assureur. **Absentes ⇒ non figées** : le moteur refuse alors toute ligne de protection
 *   ou d'assistance non nulle (fail-closed, 08 E7).
 */
import { createCurrencyRegistry, parseRatio, ratio, type Ratio } from '@rueda/money';
import {
  ConfigError,
  resolveParam,
  type CountryConfig,
  type ParamContext,
  type ParamJson,
} from '../../../cfg/index.js';
import type { QuoteParams, QuoteTaxRule } from './engine.js';
import { QuoteError } from './errors.js';

export interface QuoteParamsContext {
  readonly country: string;
  /** Instant de référence des paramètres datés (instant serveur du devis). */
  readonly at: Date;
  /** Plan de l'hôte (US-226) ; absent ⇒ `host_default_plan` du pays. */
  readonly hostPlan?: string;
  /** Niveau de protection du voyageur (US-226) ; requis pour figer la part de l'assureur. */
  readonly protectionLevel?: string;
}

const BPS = 10_000n;

function unavailable(message: string, cause?: unknown): QuoteError {
  return new QuoteError('QUOTE_UNAVAILABLE', message, cause === undefined ? undefined : { cause });
}

function resolve(config: CountryConfig, key: string, ctx: ParamContext): ParamJson {
  try {
    return resolveParam(config, key, ctx).value;
  } catch (cause) {
    if (cause instanceof ConfigError) throw unavailable(`paramètre « ${key} » : ${cause.code}`, cause);
    throw cause;
  }
}

/** Valeur d'un paramètre facultatif ou fixé par contrat : `undefined` s'il est absent. */
function resolveIfPresent(config: CountryConfig, key: string, ctx: ParamContext): ParamJson | undefined {
  try {
    return resolveParam(config, key, ctx).value;
  } catch (cause) {
    if (cause instanceof ConfigError && cause.code === 'PARAM_MISSING') return undefined;
    if (cause instanceof ConfigError) throw unavailable(`paramètre « ${key} » : ${cause.code}`, cause);
    throw cause;
  }
}

function integer(key: string, value: ParamJson, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw unavailable(`paramètre « ${key} » : entier ≥ ${min} attendu`);
  }
  return value;
}

function share(key: string, value: ParamJson | undefined): Ratio {
  if (typeof value !== 'string') throw unavailable(`paramètre « ${key} » : ratio « n/d » attendu`);
  try {
    return parseRatio(value);
  } catch (cause) {
    throw unavailable(`paramètre « ${key} » : ratio invalide`, cause);
  }
}

function entry(key: string, value: ParamJson | undefined, name: string): ParamJson | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw unavailable(`paramètre « ${key} » : objet par ${name} attendu`);
  }
  return (value as Readonly<Record<string, ParamJson>>)[name];
}

/** Instantané des paramètres d'un devis dans un pays, à un instant donné. */
export function resolveQuoteParams(config: CountryConfig, input: QuoteParamsContext): QuoteParams {
  const country = config.countries.get(input.country);
  if (country === undefined) throw unavailable(`pays inconnu « ${input.country} »`);
  const ctx: ParamContext = { country: input.country, at: input.at };

  let currency;
  try {
    currency = createCurrencyRegistry(config.currencies).get(country.currency.code);
  } catch (cause) {
    throw unavailable(`devise du pays « ${country.currency.code} » non configurée`, cause);
  }

  const taxRules: QuoteTaxRule[] = country.taxLines.map((line) => ({
    lineType: line.lineType,
    taxable: line.taxable,
    group: line.taxable ? line.rateGroup : null,
    rate: line.taxable && line.rateBps !== null ? ratio(BigInt(line.rateBps), BPS) : null,
    thirdParty: line.thirdParty,
  }));

  const planValue = input.hostPlan ?? resolve(config, 'host_default_plan', ctx);
  if (typeof planValue !== 'string') throw unavailable('host_default_plan : texte attendu');
  const hostSharePct = share(
    `host_share_pct[${planValue}]`,
    entry('host_share_pct', resolve(config, 'host_share_pct', ctx), planValue),
  );
  const delivery = resolveIfPresent(config, 'delivery_share_pct', ctx);
  const extras = resolveIfPresent(config, 'extras_share_pct', ctx);

  const premiumByLevel = resolveIfPresent(config, 'insurer_premium_share', ctx);
  const premium =
    input.protectionLevel === undefined
      ? undefined
      : entry('insurer_premium_share', premiumByLevel, input.protectionLevel);
  const roadside = resolveIfPresent(config, 'insurer_roadside_share', ctx);

  return {
    currency,
    graceMinutes: integer('grace_minutes', resolve(config, 'grace_minutes', ctx), 0),
    maxTripDays: integer('max_trip_days', resolve(config, 'max_trip_days', ctx), 1),
    taxRules,
    hostSharePct,
    deliverySharePct: delivery === undefined ? hostSharePct : share('delivery_share_pct', delivery),
    extrasSharePct: extras === undefined ? hostSharePct : share('extras_share_pct', extras),
    ...(premium === undefined
      ? {}
      : { insurerPremiumShare: share('insurer_premium_share', premium) }),
    ...(roadside === undefined ? {} : { insurerRoadsideShare: share('insurer_roadside_share', roadside) }),
  };
}
