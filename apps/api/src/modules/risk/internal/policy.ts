/**
 * Seuils de la limitation de débit (US-052) : paramètres `rate_limit_*` du registre CFG (17 §7.2,
 * graine 0046), **par pays**, jamais des constantes du code. Une limite sans pays connu (route
 * d'API sans pays, webhook) prend la valeur la PLUS STRICTE des pays déclarés : aucune constante
 * pays, et un pays ajouté entre aussitôt dans le calcul.
 *
 * Paramètre absent : `fail_mode` BLOCK ⇒ `PARAM_MISSING` levé par CFG ; l'appelant le traite
 * comme un compteur indisponible (envois coûteux refusés). Les durées des fenêtres font partie du
 * NOM du paramètre (`_hour`, `_minute`, `_10min`, `_daily`) : elles sont dans `WINDOWS`.
 *
 * L'instant de résolution est celui du processus : il ne choisit que la version du paramètre en
 * vigueur, aucun délai n'en dépend (le comptage, lui, suit `platform.now()`).
 */
import type { CountryConfig } from '../../cfg/index.js';
import { resolveParam } from '../../cfg/index.js';

export const RATE_LIMIT_PARAMS = {
  otpPerPhone: 'rate_limit_otp_per_phone_hour',
  otpPerIp: 'rate_limit_otp_per_ip_hour',
  emailPerAddress: 'rate_limit_email_per_address_hour',
  emailPerIp: 'rate_limit_email_per_ip_hour',
  smsDailyCap: 'rate_limit_sms_daily_cap',
  searchPerIp: 'rate_limit_search_per_ip_minute',
  searchPerAccount: 'rate_limit_search_per_account_minute',
  quotePerIp: 'rate_limit_quote_per_ip_minute',
  quotePerAccount: 'rate_limit_quote_per_account_minute',
  apiPerIp: 'rate_limit_api_per_ip_minute',
  apiPerAccount: 'rate_limit_api_per_account_minute',
  webhookPerIp: 'rate_limit_webhook_per_ip_minute',
  signupBurstPerIp: 'rate_limit_signup_burst_per_ip_10min',
  botWeight: 'rate_limit_bot_weight',
} as const;

export type RateLimitParam = keyof typeof RATE_LIMIT_PARAMS;

/** Fenêtre en secondes de chaque paramètre, tirée de son nom. */
export const WINDOWS: Readonly<Record<RateLimitParam, number>> = {
  otpPerPhone: 3600,
  otpPerIp: 3600,
  emailPerAddress: 3600,
  emailPerIp: 3600,
  smsDailyCap: 86400,
  searchPerIp: 60,
  searchPerAccount: 60,
  quotePerIp: 60,
  quotePerAccount: 60,
  apiPerIp: 60,
  apiPerAccount: 60,
  webhookPerIp: 60,
  signupBurstPerIp: 600,
  botWeight: 1,
};

export interface RateLimitPolicy {
  /** Valeur du paramètre pour le pays ; `null` = la plus stricte des pays déclarés. */
  limit(param: RateLimitParam, country: string | null): number;
  /** Le pays est déclaré dans la configuration. */
  isCountry(code: string): boolean;
}

function asLimit(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error(`paramètre ${key} : entier de 1 à 1 000 000 attendu`);
  }
  return value;
}

/** Politique lue dans la configuration pays (CFG), à l'instant `now()`. */
export function configRateLimitPolicy(
  config: CountryConfig,
  now: () => Date = () => new Date(),
): RateLimitPolicy {
  const countries = [...config.countries.keys()];
  const one = (param: RateLimitParam, country: string): number => {
    const key = RATE_LIMIT_PARAMS[param];
    return asLimit(key, resolveParam(config, key, { country, at: now() }).value);
  };
  return {
    limit(param, country) {
      if (country !== null) return one(param, country);
      if (countries.length === 0) throw new Error('aucun pays déclaré');
      // poids d'une requête suspecte : le plus sévère est le plus GRAND
      const values = countries.map((c) => one(param, c));
      return param === 'botWeight' ? Math.max(...values) : Math.min(...values);
    },
    isCountry(code) {
      return config.countries.has(code);
    },
  };
}
