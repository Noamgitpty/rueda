/**
 * Aides des tests du module CFG (US-013). Réservé aux tests. Les valeurs attendues des tests
 * viennent des spécifications (17 §1.2, §1.3, §7.2 ; 08 BR-CXL-13, BR-PRICE-06, BR-PRICE-12),
 * jamais du code testé.
 */
import { knownLocaleTags, repositorySources } from './load.js';
import type { CountryConfig, ParamDefinition, ParamJson, ParamValue } from './model.js';
import { parseCountryConfig } from './parse.js';
import { findReadinessIssues } from './readiness.js';
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

/** Valeur de test d'un type (jamais une valeur métier). */
function sample(def: ParamDefinition): ParamJson {
  switch (def.type) {
    case 'BOOL':
      return true;
    case 'MONEY':
      return '1';
    case 'ENUM':
      return def.allowedValues![0]!;
    case 'JSON':
      return { test: '1' };
    default:
      return 1;
  }
}

/** Instant des contrôles de présence des tests (fériés de test : 2026). */
export const READINESS_AT = new Date('2026-11-03T12:00:00Z');

/**
 * Configuration du dépôt complétée par des valeurs de test (US-013), pour isoler un critère :
 * entité juridique, fériés 2026, valeurs « à fixer ». Avec `decided` (défaut), toutes les valeurs
 * et les taxes sont marquées décidées (simule le jalon J-ADM-031) ; sinon elles gardent leur statut
 * du dépôt (US-110).
 */
export function completeConfig(options: { decided?: boolean } = {}): CountryConfig {
  const decidedAll = options.decided ?? true;
  const at = READINESS_AT;
  const sources = cloneSources();
  for (const code of sources.countries.countries.map((c) => String(c['code']))) {
    if (decidedAll) {
      country(sources, code)['taxDecision'] = { decision: 'DECIDED', decisionRef: 'test' };
    }
    country(sources, code)['legalEntity'] = {
      name: 'Entité de test',
      countryOfIncorporation: code,
      taxId: 'TEST-0001',
      invoicingRegime: 'TEST_REGIME',
    };
    country(sources, code)['holidayCalendar'] = {
      version: 1,
      holidays: [{ date: '2026-12-25', name: 'Test' }],
    };
  }
  const base = parse(sources);
  const extra: ParamValue[] = findReadinessIssues(base, at)
    .filter((i) => i.kind === 'PARAM_MISSING')
    .map((i) => {
      const def = base.definitions.get(i.key!)!;
      const scopeType = def.scopes.includes('COUNTRY') ? 'COUNTRY' : def.scopes[0]!;
      return {
        key: def.key,
        country: i.country,
        scopeType,
        scopeId: scopeType === 'COUNTRY' || scopeType === 'NETWORK' ? null : 'TEST',
        network: scopeType === 'NETWORK' ? 'TEST' : null,
        currency: null,
        value: sample(def),
        validFrom: null,
        validTo: null,
        decision: 'DECIDED' as const,
        decisionRef: 'test',
        source: 'test',
      };
    });
  const values = decidedAll
    ? base.values.map((v) => ({ ...v, decision: 'DECIDED' as const }))
    : base.values;
  return { ...base, values: [...values, ...extra] };
}
