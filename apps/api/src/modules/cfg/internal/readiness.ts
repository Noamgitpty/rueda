/**
 * Contrôle « prêt pour la production » (16 ADM-014, parcours alternatif : « clé requise absente →
 * démarrage de l'application refusé en production (fail-closed), sauf `platform_funded_host_compensation`
 * et les interrupteurs, dont l'absence vaut `false` » ; US-013).
 *
 * Est requise toute clé `BLOCK` non `optional`, dans chaque pays où elle n'est pas sans objet. Les
 * clés `FALSE` et `ZERO` ont une valeur d'absence sûre et ne sont pas requises. S'y ajoutent, par
 * pays : l'entité juridique (17 §3.2 `legal_entity`) et un calendrier de fériés couvrant l'année
 * de l'instant contrôlé (17 §1.3) : sans eux, facturation et jours ouvrés seraient faux en silence.
 */
import { ConfigError } from './errors.js';
import type { CountryConfig } from './model.js';

export interface ReadinessIssue {
  readonly country: string;
  readonly kind: 'PARAM_MISSING' | 'LEGAL_ENTITY_MISSING' | 'HOLIDAYS_MISSING';
  /** Clé de paramètre (`PARAM_MISSING`) ; `null` sinon. */
  readonly key: string | null;
}

function hasValueAt(config: CountryConfig, key: string, country: string, at: Date): boolean {
  const t = at.getTime();
  return config.values.some(
    (v) =>
      v.key === key &&
      v.country === country &&
      (v.validFrom === null || v.validFrom.getTime() <= t) &&
      (v.validTo === null || t < v.validTo.getTime()),
  );
}

/** Tous les manques, triés par pays puis par clé. */
export function findReadinessIssues(config: CountryConfig, at: Date): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const year = String(at.getUTCFullYear());
  for (const [country, entry] of [...config.countries].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.legalEntity === null)
      issues.push({ country, kind: 'LEGAL_ENTITY_MISSING', key: null });
    if (!entry.holidayCalendar.holidays.some((h) => h.date.startsWith(`${year}-`))) {
      issues.push({ country, kind: 'HOLIDAYS_MISSING', key: null });
    }
    const keys = [...config.definitions.values()]
      .filter((d) => d.failMode === 'BLOCK' && !d.optional && !d.notApplicableIn.includes(country))
      .map((d) => d.key)
      .sort();
    for (const key of keys) {
      if (!hasValueAt(config, key, country, at))
        issues.push({ country, kind: 'PARAM_MISSING', key });
    }
  }
  return issues;
}

/** Refus explicite (`PARAM_MISSING`) qui nomme chaque manque. */
export function assertProductionReady(config: CountryConfig, at: Date): void {
  const issues = findReadinessIssues(config, at);
  if (issues.length > 0) {
    throw new ConfigError(
      'PARAM_MISSING',
      `production refusée : ${issues.length} donnée(s) obligatoire(s) absente(s)`,
      issues.map((i) => (i.key ? `${i.country} ${i.key}` : `${i.country} ${i.kind}`)),
    );
  }
}
