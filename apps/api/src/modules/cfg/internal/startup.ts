/**
 * Contrôles de démarrage du processus API (`main.ts`) et du travailleur pg-boss (`worker.ts`)
 * d'`apps/api` (US-013, US-110 ; 17 §1.3 ; 16 ADM-014, ADM-031 ; ADR-093).
 *
 * Environnement : variable `RUEDA_ENV` ∈ {`development`, `test`, `preproduction`, `production`}.
 * Absente ou inconnue ⇒ `production` (fail-closed : les contrôles les plus stricts s'appliquent).
 *
 * 1. Toujours : configuration valide (sinon `CONFIG_INVALID`) et tzdata du runtime (`TZDATA_MISMATCH`).
 * 2. En production : toutes les données obligatoires présentes (sinon `PARAM_MISSING`) et aucune
 *    valeur en vigueur « À DÉCIDER » ni taux de taxe à décider (sinon `PARAM_UNDECIDED`, ou
 *    `PARAM_MISSING` s'il manque aussi une donnée ; incidents `PARAM_UNDECIDED`, `TAX_UNDECIDED`).
 *    Hors production (préproduction comprise), les valeurs de test sont permises.
 */
import type { CountryConfig } from './model.js';
import { assertProductionReady } from './readiness.js';
import { checkRuntimeTimeZoneData } from './tzdata.js';

export const RUNTIME_ENVIRONMENTS = ['development', 'test', 'preproduction', 'production'] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export function parseRuntimeEnvironment(value: string | undefined): RuntimeEnvironment {
  return (RUNTIME_ENVIRONMENTS as readonly string[]).includes(value ?? '')
    ? (value as RuntimeEnvironment)
    : 'production';
}

export interface StartupCheckInput {
  readonly environment: string | undefined;
  readonly config: CountryConfig;
  /**
   * Instant du contrôle de présence (aucune décision de délai n'en dépend ; 17 §1.3 réserve ces
   * décisions à `platform.now()`).
   */
  readonly at: Date;
}

export function runStartupChecks(input: StartupCheckInput): RuntimeEnvironment {
  const environment = parseRuntimeEnvironment(input.environment);
  checkRuntimeTimeZoneData(input.config);
  if (environment === 'production') assertProductionReady(input.config, input.at);
  return environment;
}
