/**
 * Aides des tests du module CFG (US-013). Réservé aux tests. Les valeurs attendues des tests
 * viennent des spécifications (17 §1.2, §1.3, §7.2 ; 08 BR-CXL-13, BR-PRICE-06, BR-PRICE-12),
 * jamais du code testé.
 */
import { knownLocaleTags, repositorySources } from './load.js';
import type { CountryConfig, ParamValue } from './model.js';
import { parseCountryConfig } from './parse.js';
import type { CountryConfigSources } from './parse.js';

type Mutable = Record<string, unknown>;

export interface MutableSources {
  currencies: { version: number; currencies: Mutable[] };
  countries: { version: number; countries: Mutable[] };
  params: { version: number; params: Mutable[] };
}

/** Copie profonde, modifiable, des données du dépôt. */
export function cloneSources(): MutableSources {
  return structuredClone(repositorySources()) as unknown as MutableSources;
}

export function parse(sources: MutableSources | CountryConfigSources): CountryConfig {
  return parseCountryConfig(sources as CountryConfigSources, { knownLocales: knownLocaleTags() });
}

export function country(sources: MutableSources, code: string): Mutable {
  const found = sources.countries.countries.find((c) => c['code'] === code);
  if (!found) throw new Error(`pays ${code} absent des données`);
  return found;
}

export function param(sources: MutableSources, key: string): Mutable {
  const found = sources.params.params.find((p) => p['key'] === key);
  if (!found) throw new Error(`clé ${key} absente des données`);
  return found;
}

/** Configuration dérivée avec d'autres valeurs (fenêtres de validité, cas synthétiques). */
export function withValues(config: CountryConfig, values: readonly ParamValue[]): CountryConfig {
  return { ...config, values };
}

/** Code d'erreur levé par `fn`, ou `undefined`. */
export function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

export function errorDetails(fn: () => unknown): readonly string[] {
  try {
    fn();
    return [];
  } catch (error) {
    return (error as { details?: readonly string[] }).details ?? [];
  }
}
