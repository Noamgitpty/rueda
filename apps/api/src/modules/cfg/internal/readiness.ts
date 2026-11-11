/**
 * Contrôle « prêt pour la production » (16 ADM-014, parcours alternatif : « clé requise absente →
 * démarrage de l'application refusé en production (fail-closed), sauf `platform_funded_host_compensation`
 * et les interrupteurs, dont l'absence vaut `false` » ; US-013 ; 16 ADM-031, 19 US-110).
 *
 * Est requise toute clé `BLOCK` non `optional`, dans chaque pays où elle n'est pas sans objet. Les
 * clés `FALSE` et `ZERO` ont une valeur d'absence sûre et ne sont pas requises. S'y ajoutent, par
 * pays : l'entité juridique (17 §3.2 `legal_entity`) et un calendrier de fériés couvrant l'année
 * de l'instant contrôlé (17 §1.3) : sans eux, facturation et jours ouvrés seraient faux en silence.
 *
 * US-110 : toute valeur **en vigueur** dont le statut est `TO_DECIDE` (« À DÉCIDER », défaut
 * fail-closed de 22 chargé pour construire) refuse aussi la production (`PARAM_UNDECIDED`), de même
 * que des taux de taxe à décider (`TAX_UNDECIDED`). Une **absence** n'est pas une valeur : elle relève
 * du contrôle de présence ci-dessus (ou de son `fail_mode` sûr, comme
 * `platform_funded_host_compensation`, absent ⇒ `false`, 16 ADM-014). La préproduction ne fait pas
 * ce contrôle : les valeurs de test y sont permises (19 US-110).
 */
import { ConfigError } from './errors.js';
import type { CountryConfig, ParamValue } from './model.js';

export interface ReadinessIssue {
  readonly country: string;
  readonly kind:
    | 'PARAM_MISSING'
    | 'LEGAL_ENTITY_MISSING'
    | 'HOLIDAYS_MISSING'
    | 'PARAM_UNDECIDED'
    | 'TAX_UNDECIDED';
  /** Clé de paramètre (`PARAM_MISSING`, `PARAM_UNDECIDED`) ; `null` sinon. */
  readonly key: string | null;
  /** Question ouverte (`PARAM_UNDECIDED`, `TAX_UNDECIDED`) ; `null` sinon. */
  readonly decisionRef: string | null;
}

const MISSING_KINDS: ReadonlySet<ReadinessIssue['kind']> = new Set([
  'PARAM_MISSING',
  'LEGAL_ENTITY_MISSING',
  'HOLIDAYS_MISSING',
]);

function isInForce(v: ParamValue, at: Date): boolean {
  const t = at.getTime();
  return (
    (v.validFrom === null || v.validFrom.getTime() <= t) &&
    (v.validTo === null || t < v.validTo.getTime())
  );
}

function hasValueAt(config: CountryConfig, key: string, country: string, at: Date): boolean {
  return config.values.some((v) => v.key === key && v.country === country && isInForce(v, at));
}

/** Tous les manques et toutes les valeurs à décider, triés par pays, puis par nature et par clé. */
export function findReadinessIssues(config: CountryConfig, at: Date): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const year = String(at.getUTCFullYear());
  const issue = (
    country: string,
    kind: ReadinessIssue['kind'],
    key: string | null = null,
    decisionRef: string | null = null,
  ): void => {
    issues.push({ country, kind, key, decisionRef });
  };
  for (const [country, entry] of [...config.countries].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.legalEntity === null) issue(country, 'LEGAL_ENTITY_MISSING');
    if (!entry.holidayCalendar.holidays.some((h) => h.date.startsWith(`${year}-`))) {
      issue(country, 'HOLIDAYS_MISSING');
    }
    const keys = [...config.definitions.values()]
      .filter((d) => d.failMode === 'BLOCK' && !d.optional && !d.notApplicableIn.includes(country))
      .map((d) => d.key)
      .sort();
    for (const key of keys) {
      if (!hasValueAt(config, key, country, at)) issue(country, 'PARAM_MISSING', key);
    }
    if (entry.taxDecision.decision === 'TO_DECIDE') {
      issue(country, 'TAX_UNDECIDED', null, entry.taxDecision.decisionRef);
    }
    // Une ligne par clé (plusieurs portées d'une même clé partagent son statut).
    const undecided = new Map<string, string>();
    for (const v of config.values) {
      if (v.country === country && v.decision === 'TO_DECIDE' && isInForce(v, at)) {
        undecided.set(v.key, v.decisionRef);
      }
    }
    for (const key of [...undecided.keys()].sort()) {
      issue(country, 'PARAM_UNDECIDED', key, undecided.get(key) ?? null);
    }
  }
  return issues;
}

function describeIssue(i: ReadinessIssue): string {
  if (i.kind === 'PARAM_UNDECIDED') return `${i.country} ${i.key} (À DÉCIDER : ${i.decisionRef})`;
  if (i.kind === 'TAX_UNDECIDED')
    return `${i.country} TAX_UNDECIDED (À DÉCIDER : ${i.decisionRef})`;
  return i.key ? `${i.country} ${i.key}` : `${i.country} ${i.kind}`;
}

/**
 * Refus explicite qui nomme chaque défaut : `PARAM_MISSING` s'il manque une donnée obligatoire
 * (la liste comprend alors aussi les valeurs à décider), sinon `PARAM_UNDECIDED`.
 */
export function assertProductionReady(config: CountryConfig, at: Date): void {
  const issues = findReadinessIssues(config, at);
  if (issues.length === 0) return;
  const missing = issues.filter((i) => MISSING_KINDS.has(i.kind)).length;
  if (missing > 0) {
    throw new ConfigError(
      'PARAM_MISSING',
      `production refusée : ${missing} donnée(s) obligatoire(s) absente(s), ` +
        `${issues.length - missing} valeur(s) À DÉCIDER`,
      issues.map(describeIssue),
    );
  }
  throw new ConfigError(
    'PARAM_UNDECIDED',
    `production refusée : ${issues.length} valeur(s) encore À DÉCIDER (J-ADM-031)`,
    issues.map(describeIssue),
  );
}
