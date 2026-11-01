import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getProfile, parseLocaleConfig } from '../src/index.ts';
import type { LocaleConfig, LocaleProfile, MinorUnitAmount } from '../src/index.ts';

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
}

/** Configuration livrée (`config/locales.json`), validée comme en production. */
export const CONFIG: LocaleConfig = parseLocaleConfig(readJson('../config/locales.json'));

export function profile(tag: string): LocaleProfile {
  return getProfile(CONFIG, tag);
}

interface CurrencyFixture {
  readonly currencies: readonly { readonly code: string; readonly exponent: number }[];
}

const currencies = readJson('./fixtures/currencies.json') as CurrencyFixture;

/** Montant à afficher, avec l'exposant lu dans la fixture `config.currency`. */
export function amount(amountMinor: bigint, currency: string): MinorUnitAmount {
  const found = currencies.currencies.find((c) => c.code === currency);
  if (!found) throw new Error(`Devise absente de la fixture : ${currency}`);
  return { amountMinor, currency, exponent: found.exponent };
}

export interface TimeZoneFixture {
  readonly vehicleTimeZones: readonly string[];
  readonly expectations: readonly { timeZone: string; instant: string; offsetMinutes: number }[];
  readonly historical: readonly { timeZone: string; instant: string; offsetMinutes: number }[];
}

export const TIMEZONES = readJson('./fixtures/timezones.json') as TimeZoneFixture;

export function tz(name: string): string {
  const found = TIMEZONES.vehicleTimeZones.find((z) => z === name);
  if (!found) throw new Error(`Fuseau absent de la fixture : ${name}`);
  return found;
}

export function rawConfig(): Record<string, unknown> {
  return readJson('../config/locales.json') as Record<string, unknown>;
}
