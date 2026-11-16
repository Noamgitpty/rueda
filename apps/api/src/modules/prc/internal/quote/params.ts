/**
 * Instantané des paramètres du pays pour un devis (17 §2.6 « paramètres pays (instantané) » ;
 * 16 PRC-025 « paramètre manquant ⇒ QUOTE_UNAVAILABLE »). Lit uniquement la configuration CFG
 * (`CountryConfig`, API publique du module CFG) : aucune valeur de pays n'est écrite ici.
 *
 * - devise et exposant : `currencies` / pays ;
 * - `grace_minutes`, `max_trip_days` ;
 * - barème du trip fee : `trip_fee_schedule` (US-704 ; tranches `maxDays` / `rateBps`, minimum en
 *   unités mineures de la devise du pays) ; absent ou mal formé ⇒ `QUOTE_UNAVAILABLE` (BLOCK) ;
 * - règles fiscales : `taxLines` du pays (`tax_line_config`, taux en points de base, `thirdParty`) ;
 * - part de l'hôte : `host_share_pct[plan]`, plan = celui de l'hôte, sinon `host_default_plan` ;
 *   `delivery_share_pct` / `extras_share_pct` facultatives, absentes ⇒ part de l'hôte (17 §7.2) ;
 * - parts de l'assureur : `insurer_premium_share[niveau]`, `insurer_roadside_share`, fixées par le
 *   contrat d'assureur. **Absentes ⇒ non figées** : le moteur refuse alors toute ligne de protection
 *   ou d'assistance non nulle (fail-closed, 08 E7) ;
 * - protection du voyageur (US-226, ADR-136) : grille `protection_grid` (BLOCK : absente ⇒
 *   `QUOTE_UNAVAILABLE`, aucun trip sans protection) et minimum `guest_protection_min_level`
 *   (absent ⇒ niveau de plus petit rang de la grille, 16 PRT-011) ;
 * - plan de gains de l'hôte : celui du véhicule (`hostPlan`, lu en base par l'appelant), sinon
 *   `host_default_plan` ; un plan absent de `host_share_pct` ⇒ `QUOTE_UNAVAILABLE`.
 */
import {
  createCurrencyRegistry,
  money,
  parseRatio,
  ratio,
  type Currency,
  type Money,
  type Ratio,
  type SettlementParams,
} from '@rueda/money';
import {
  ConfigError,
  resolveParam,
  type CountryConfig,
  type ParamContext,
  type ParamJson,
} from '../../../cfg/index.js';
import type {
  ProtectionGrid,
  ProtectionTerms,
  QuoteParams,
  QuoteTaxRule,
  TripFeeSchedule,
  TripFeeTier,
} from './engine.js';
import { QuoteError } from './errors.js';

export interface QuoteParamsContext {
  readonly country: string;
  /** Instant de référence des paramètres datés (instant serveur du devis). */
  readonly at: Date;
  /** Plan de gains du véhicule (US-226) ; absent ou `null` ⇒ `host_default_plan` du pays. */
  readonly hostPlan?: string | null;
}

const BPS = 10_000n;

function unavailable(message: string, cause?: unknown): QuoteError {
  return new QuoteError('QUOTE_UNAVAILABLE', message, cause === undefined ? undefined : { cause });
}

function resolve(config: CountryConfig, key: string, ctx: ParamContext): ParamJson {
  try {
    return resolveParam(config, key, ctx).value;
  } catch (cause) {
    if (cause instanceof ConfigError)
      throw unavailable(`paramètre « ${key} » : ${cause.code}`, cause);
    throw cause;
  }
}

/** Valeur d'un paramètre facultatif ou fixé par contrat : `undefined` s'il est absent. */
function resolveIfPresent(
  config: CountryConfig,
  key: string,
  ctx: ParamContext,
): ParamJson | undefined {
  try {
    return resolveParam(config, key, ctx).value;
  } catch (cause) {
    if (cause instanceof ConfigError && cause.code === 'PARAM_MISSING') return undefined;
    if (cause instanceof ConfigError)
      throw unavailable(`paramètre « ${key} » : ${cause.code}`, cause);
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

/**
 * Barème du trip fee (`trip_fee_schedule`, 17 §7.2 ; unité `tiers_bps_and_min_minor`) :
 * `{ tiers: [{ maxDays: entier ≥ 1 | null, rateBps: entier 0..10 000 }…], minMinor: "entier" }`.
 * Forme contrôlée ici ; cohérence des tranches (bornes croissantes, `null` en dernier) contrôlée
 * par le moteur (`tripFeeOf`). Aucune valeur par défaut : absent ⇒ `QUOTE_UNAVAILABLE`.
 */
function tripFeeSchedule(value: ParamJson, currency: Currency): TripFeeSchedule {
  const key = 'trip_fee_schedule';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw unavailable(`paramètre « ${key} » : objet attendu`);
  }
  const o = value as Readonly<Record<string, ParamJson>>;
  const rawTiers = o['tiers'];
  const minMinor = o['minMinor'];
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    throw unavailable(`paramètre « ${key} » : tranches attendues`);
  }
  if (typeof minMinor !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(minMinor)) {
    throw unavailable(`paramètre « ${key} » : minMinor entier en texte attendu`);
  }
  const tiers: TripFeeTier[] = rawTiers.map((raw: ParamJson, i: number) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw unavailable(`paramètre « ${key} » : tranche ${i + 1} invalide`);
    }
    const t = raw as Readonly<Record<string, ParamJson>>;
    const maxDays = t['maxDays'];
    const rateBps = t['rateBps'];
    if (
      (maxDays !== null && (typeof maxDays !== 'number' || !Number.isSafeInteger(maxDays))) ||
      typeof rateBps !== 'number' ||
      !Number.isSafeInteger(rateBps) ||
      rateBps < 0 ||
      rateBps > 10_000
    ) {
      throw unavailable(`paramètre « ${key} » : tranche ${i + 1} invalide`);
    }
    return { maxDays: maxDays as number | null, rate: ratio(BigInt(rateBps), BPS) };
  });
  return { tiers, min: money(BigInt(minMinor), currency) };
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
  const roadside = resolveIfPresent(config, 'insurer_roadside_share', ctx);
  const grid = protectionGrid(
    resolve(config, 'protection_grid', ctx),
    resolveIfPresent(config, 'guest_protection_min_level', ctx),
    currency,
  );

  return {
    currency,
    graceMinutes: integer('grace_minutes', resolve(config, 'grace_minutes', ctx), 0),
    maxTripDays: integer('max_trip_days', resolve(config, 'max_trip_days', ctx), 1),
    tripFeeSchedule: tripFeeSchedule(resolve(config, 'trip_fee_schedule', ctx), currency),
    taxRules,
    hostSharePct,
    deliverySharePct: delivery === undefined ? hostSharePct : share('delivery_share_pct', delivery),
    extrasSharePct: extras === undefined ? hostSharePct : share('extras_share_pct', extras),
    ...(roadside === undefined
      ? {}
      : { insurerRoadsideShare: share('insurer_roadside_share', roadside) }),
    protectionGrid: grid,
    ...(premiumByLevel === undefined
      ? {}
      : { insurerPremiumShareByLevel: sharesByLevel(premiumByLevel, grid) }),
    hostPlan: planValue,
  };
}

/** Parts de l'assureur des niveaux de la grille (`insurer_premium_share[niveau]`) ; part absente
 * pour un niveau ⇒ ce niveau n'a pas de part (la vente en est refusée par les jambes). */
function sharesByLevel(value: ParamJson, grid: ProtectionGrid): Readonly<Record<string, Ratio>> {
  const out: Record<string, Ratio> = {};
  for (const t of grid.levels) {
    const v = entry('insurer_premium_share', value, t.level);
    if (v !== undefined) out[t.level] = share(`insurer_premium_share[${t.level}]`, v);
  }
  return Object.freeze(out);
}

function minorOrNull(key: string, value: ParamJson | undefined, currency: Currency): Money | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(value)) {
    throw unavailable(`paramètre « ${key} » : montant en unités mineures attendu`);
  }
  return money(BigInt(value), currency);
}

/**
 * Grille `protection_grid` (unité `protection_grid`, US-226) : forme contrôlée ici, cohérence
 * (rangs distincts, minimum présent, bornes) contrôlée par le moteur. Minimum
 * `guest_protection_min_level` absent ⇒ niveau de plus petit rang (16 PRT-011 : `BASICA`).
 */
function protectionGrid(
  value: ParamJson,
  minValue: ParamJson | undefined,
  currency: Currency,
): ProtectionGrid {
  const key = 'protection_grid';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw unavailable(`paramètre « ${key} » : objet par niveau attendu`);
  }
  const levels: ProtectionTerms[] = Object.entries(
    value as Readonly<Record<string, ParamJson>>,
  ).map(([level, raw]) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw unavailable(`paramètre « ${key} » : niveau ${level} invalide`);
    }
    const t = raw as Readonly<Record<string, ParamJson>>;
    const rank = t['rank'];
    const age = t['minDriverAge'];
    if (typeof rank !== 'number' || !Number.isSafeInteger(rank)) {
      throw unavailable(`paramètre « ${key} » : rang de ${level} invalide`);
    }
    if (age !== null && (typeof age !== 'number' || !Number.isSafeInteger(age))) {
      throw unavailable(`paramètre « ${key} » : âge de ${level} invalide`);
    }
    return {
      level,
      rank,
      price: share(`${key}[${level}].price`, t['price']),
      minDriverAge: age,
      dailyFloor: minorOrNull(`${key}[${level}].dailyFloorMinor`, t['dailyFloorMinor'], currency),
      dailyCeiling: minorOrNull(
        `${key}[${level}].dailyCeilingMinor`,
        t['dailyCeilingMinor'],
        currency,
      ),
    };
  });
  if (levels.length === 0) throw unavailable(`paramètre « ${key} » : aucun niveau`);
  let minLevel: string;
  if (minValue === undefined) {
    minLevel = [...levels].sort((a, b) => a.rank - b.rank)[0]!.level;
  } else if (typeof minValue === 'string') {
    minLevel = minValue;
  } else {
    throw unavailable('paramètre « guest_protection_min_level » : texte attendu');
  }
  return { minLevel, levels };
}

/**
 * Paramètres d'annulation du pays pour le moteur de règlement (US-205b ; 08 BR-CXL-01, BR-CXL-08 ;
 * 17 §7.2) : `free_cancel_lead` et `last_minute_threshold` (heures), `no_show_grace_minutes`.
 * Absents ou mal formés ⇒ `QUOTE_UNAVAILABLE` (BLOCK : jamais une retenue devinée).
 */
export function resolveCancellationParams(
  config: CountryConfig,
  input: { readonly country: string; readonly at: Date },
): SettlementParams {
  if (!config.countries.has(input.country)) throw unavailable(`pays inconnu « ${input.country} »`);
  const ctx: ParamContext = { country: input.country, at: input.at };
  return {
    freeCancelLeadHours: integer('free_cancel_lead', resolve(config, 'free_cancel_lead', ctx), 0),
    lastMinuteThresholdHours: integer(
      'last_minute_threshold',
      resolve(config, 'last_minute_threshold', ctx),
      0,
    ),
    noShowGraceMinutes: integer(
      'no_show_grace_minutes',
      resolve(config, 'no_show_grace_minutes', ctx),
      0,
    ),
  };
}
