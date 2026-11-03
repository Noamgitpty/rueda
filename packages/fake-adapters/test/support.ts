/**
 * Aides des tests d'US-020. Les pays, devises et pièces viennent des **données** de configuration
 * pays (CFG, US-013) lues sur disque : aucune constante pays dans ces tests (CLAUDE.md
 * contrainte 3), et chaque pays configuré (aujourd'hui les deux de premier rang) est rejoué.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FakeClock } from '../src/core/clock.ts';

export interface CountryData {
  readonly code: string;
  readonly currency: string;
  readonly locales: readonly string[];
  readonly hostTaxIdKinds: readonly string[];
}

export function configuredCountries(): CountryData[] {
  const url = new URL('../../../apps/api/src/modules/cfg/data/countries.json', import.meta.url);
  const doc = JSON.parse(readFileSync(url, 'utf8')) as { countries: CountryData[] };
  if (doc.countries.length < 2) throw new Error('au moins deux pays configurés attendus');
  return doc.countries;
}

export const START = '2026-11-03T12:00:00Z';
export const clock = (): FakeClock => new FakeClock(START);

/** Secret de rappel tiré au hasard à chaque exécution (jamais en dur dans le dépôt). */
export const secret = (): string => randomBytes(24).toString('hex');
