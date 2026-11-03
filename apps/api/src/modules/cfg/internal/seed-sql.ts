/**
 * Génération de la migration de graines `packages/db/migrations/0003_config_seed.sql` depuis la
 * configuration du dépôt (US-013) : une seule source de données, aucune recopie à la main. Le
 * test `seed-sql.test.ts` échoue si le fichier commité diffère du rendu.
 *
 * Les valeurs sont insérées sans `valid_from` : la garde de la base le fixe à `platform.now()`
 * au moment de la migration (jamais rétroactif). Les devises des clés liées à une devise sont
 * posées par la garde (devise du pays).
 */
import type { CountryConfig, ParamJson } from './model.js';

export const SEED_MIGRATION_FILE = '0003_config_seed.sql';
export const SEED_CHANGE_REASON =
  'graine US-013 : défauts PROPOSÉS de 17 §7.2, à décider au jalon J-ADM-031';

function lit(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

function textArray(values: readonly string[]): string {
  return values.length === 0 ? "'{}'::text[]" : `ARRAY[${values.map(lit).join(', ')}]::text[]`;
}

/** JSON canonique : clés d'objet triées (rendu stable). */
function canonicalJson(value: ParamJson): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as ParamJson)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonb(value: ParamJson): string {
  return `${lit(canonicalJson(value))}::jsonb`;
}

function insert(table: string, columns: readonly string[], rows: readonly string[][]): string {
  if (rows.length === 0) return `-- ${table} : aucune ligne.\n`;
  const body = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${body};\n`;
}

export function renderSeedSql(config: CountryConfig): string {
  const countries = [...config.countries.values()].sort((a, b) => a.code.localeCompare(b.code));
  const definitions = [...config.definitions.values()].sort((a, b) => a.key.localeCompare(b.key));
  const values = [...config.values].sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      a.country.localeCompare(b.country) ||
      a.scopeType.localeCompare(b.scopeType) ||
      (a.scopeId ?? '').localeCompare(b.scopeId ?? '') ||
      (a.network ?? '').localeCompare(b.network ?? ''),
  );

  const parts: string[] = [
    [
      '-- 0003 — graines de la configuration pays (US-013 ; 17 §7.2 ; ADR-024, ADR-033).',
      '-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/*.json par seed-sql.ts : ne pas',
      '-- l’éditer à la main (test seed-sql.test.ts). Appliquée sous `migrator`.',
      '-- Valeurs PROPOSÉES, À DÉCIDER au jalon J-ADM-031 ; interrupteurs de mise en service à false.',
      '-- valid_from et devise des paramètres : posés par la garde (platform.now(), devise du pays).',
      '--',
      '-- Retour arrière : supprimer les lignes de graine (sous un rôle qui désactive les gardes,',
      '-- base sans dépendance) ; jamais en production : publier une nouvelle version à la place.',
      '',
    ].join('\n'),
    insert(
      'core.config_currency',
      ['code', 'exponent'],
      [...config.currencies]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => [lit(c.code), String(c.exponent)]),
    ),
    insert(
      'core.config_country',
      [
        'code',
        'currency',
        'time_zone',
        'legal_locale',
        'default_locale',
        'locales',
        'names',
        'host_tax_id_kinds',
      ],
      countries.map((c) => [
        lit(c.code),
        lit(c.currency.code),
        lit(c.timeZone),
        lit(c.legalLocale),
        lit(c.defaultLocale),
        textArray(c.locales),
        jsonb({ ...c.names }),
        textArray(c.hostTaxIdKinds),
      ]),
    ),
    insert(
      'core.config_param_definition',
      [
        'key',
        'type',
        'unit',
        'allowed_scopes',
        'currency_bound',
        'fail_mode',
        'optional',
        'go_live_switch',
        'not_applicable_in',
        'allowed_values',
        'source_ref',
        'status',
      ],
      definitions.map((d) => [
        lit(d.key),
        lit(d.type),
        lit(d.unit),
        textArray(d.scopes),
        String(d.currencyBound),
        lit(d.failMode),
        String(d.optional),
        String(d.goLiveSwitch),
        textArray(d.notApplicableIn),
        d.allowedValues === null ? 'NULL' : textArray(d.allowedValues),
        lit(d.source),
        lit(d.status),
      ]),
    ),
    insert(
      'core.config_param_value',
      ['key', 'country_code', 'scope_type', 'scope_id', 'network', 'value', 'change_reason'],
      values.map((v) => [
        lit(v.key),
        lit(v.country),
        lit(v.scopeType),
        lit(v.scopeId),
        lit(v.network),
        jsonb(v.value),
        lit(SEED_CHANGE_REASON),
      ]),
    ),
    insert(
      'core.config_holiday_calendar',
      ['country_code', 'date', 'name', 'version'],
      countries.flatMap((c) =>
        c.holidayCalendar.holidays.map((h) => [
          lit(c.code),
          `${lit(h.date)}::date`,
          lit(h.name),
          String(c.holidayCalendar.version),
        ]),
      ),
    ),
    insert(
      'core.pricing_tax_line_config',
      ['country_code', 'line_type', 'taxable', 'rate_group', 'rate_bps', 'third_party', 'version'],
      countries.flatMap((c) =>
        c.taxLines.map((t) => [
          lit(c.code),
          lit(t.lineType),
          String(t.taxable),
          lit(t.rateGroup),
          t.rateBps === null ? 'NULL' : String(t.rateBps),
          String(t.thirdParty),
          String(config.version),
        ]),
      ),
    ),
    insert(
      'core.finance_legal_entity',
      ['country_code', 'name', 'country_of_incorporation', 'tax_id', 'invoicing_regime'],
      countries.flatMap((c) =>
        c.legalEntity === null
          ? []
          : [
              [
                lit(c.code),
                lit(c.legalEntity.name),
                lit(c.legalEntity.countryOfIncorporation),
                lit(c.legalEntity.taxId),
                lit(c.legalEntity.invoicingRegime),
              ],
            ],
      ),
    ),
  ];
  return parts.join('\n');
}
