/**
 * Génération de la migration de graines `packages/db/migrations/0009_config_seed.sql` depuis la
 * configuration du dépôt (US-013) : une seule source de données, aucune recopie à la main. Le
 * test `seed-sql.test.ts` échoue si le fichier commité diffère du rendu.
 *
 * Les valeurs sont insérées sans `valid_from` : la garde de la base le fixe à `platform.now()`
 * au moment de la migration (jamais rétroactif). Les devises des clés liées à une devise sont
 * posées par la garde (devise du pays).
 */
import type { CountryConfig, CountryConfigEntry, ParamDefinition, ParamJson } from './model.js';

export const SEED_MIGRATION_FILE = '0009_config_seed.sql';

/**
 * Langues ajoutées APRÈS la graine 0009, dans l'ordre (ADR-044 : une migration appliquée est
 * immuable ; ADR-071). 0009 est rendue sans elles (ni locale de cette langue, ni nom) ; chacune a
 * sa migration de graine complémentaire, générée elle aussi depuis les données et comparée par
 * `seed-sql.test.ts`. Une langue ajoutée aux données sans entrée ici fait échouer ce test.
 */
export const POST_SEED_LANGUAGES: readonly { readonly language: string; readonly file: string }[] =
  [{ language: 'pt', file: '0044_config_country_portuguese.sql' }];

/**
 * Paramètres ajoutés APRÈS la graine 0009, par préfixe de clé (ADR-044 : une migration appliquée
 * est immuable ; ADR-075). 0009 est rendue sans eux (ni définition, ni valeur) ; chaque groupe a
 * sa migration de graine complémentaire, générée depuis `params.json` et comparée par
 * `seed-sql.test.ts`. Un préfixe ne peut couvrir aucune clé déjà présente dans 0009.
 */
export const POST_SEED_PARAMS: readonly {
  readonly prefix: string;
  readonly file: string;
  readonly story: string;
  /** Références citées par le motif des valeurs (défaut : celles de la graine US-052). */
  readonly refs?: string;
}[] = [
  { prefix: 'rate_limit_', file: '0046_config_rate_limit_params.sql', story: 'US-052' },
  { prefix: 'otp_rate_', file: '0065_config_otp_rate_params.sql', story: 'US-104' },
  {
    prefix: 'listing_min_photos',
    file: '0068_config_listing_photo_params.sql',
    story: 'US-115',
    refs: '08 BR-LIST-05, 16 HST-012',
  },
  {
    prefix: 'price_ceiling_',
    file: '0069_config_listing_price_params.sql',
    story: 'US-115',
    refs: '16 PRC-001, HST-033',
  },
  {
    prefix: 'elig_',
    file: '0078_config_vehicle_eligibility_params.sql',
    story: 'US-124',
    refs: '08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039',
  },
  {
    prefix: 'host_review_',
    file: '0082_config_host_review_params.sql',
    story: 'US-108',
    refs: '19 US-108, 16 ADM-004, consigne du fondateur du 2026-11-12',
  },
  {
    prefix: 'listing_manual_review',
    file: '0085_config_listing_review_params.sql',
    story: 'US-118',
    refs: '16 HST-016, ADM-003 ; DEC-FONDATEUR-22',
  },
];

/** La clé appartient à un groupe de paramètres ajouté après 0009. */
export function isPostSeedParam(key: string): boolean {
  return POST_SEED_PARAMS.some((p) => key.startsWith(p.prefix));
}

const languageOf = (tag: string): string => tag.split('-')[0] ?? tag;

/** Locales et noms d'un pays limités aux langues présentes à une étape de graine. */
function countryAt(
  c: CountryConfigEntry,
  excluded: ReadonlySet<string>,
): { locales: string[]; names: Record<string, string> } {
  return {
    locales: c.locales.filter((tag) => !excluded.has(languageOf(tag))),
    names: Object.fromEntries(Object.entries(c.names).filter(([lang]) => !excluded.has(lang))),
  };
}

/** Langues absentes à l'étape `index` (−1 = graine 0009 ; i = après la i-ème langue ajoutée). */
function excludedAt(index: number): Set<string> {
  return new Set(POST_SEED_LANGUAGES.slice(index + 1).map((l) => l.language));
}
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

function sortValues(values: CountryConfig['values']): CountryConfig['values'] {
  return [...values].sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      a.country.localeCompare(b.country) ||
      a.scopeType.localeCompare(b.scopeType) ||
      (a.scopeId ?? '').localeCompare(b.scopeId ?? '') ||
      (a.network ?? '').localeCompare(b.network ?? ''),
  );
}

function definitionInsert(definitions: readonly ParamDefinition[]): string {
  return insert(
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
  );
}

function valueInsert(values: CountryConfig['values'], reason = SEED_CHANGE_REASON): string {
  return insert(
    'core.config_param_value',
    ['key', 'country_code', 'scope_type', 'scope_id', 'network', 'value', 'change_reason'],
    values.map((v) => [
      lit(v.key),
      lit(v.country),
      lit(v.scopeType),
      lit(v.scopeId),
      lit(v.network),
      jsonb(v.value),
      lit(reason),
    ]),
  );
}

export function renderSeedSql(config: CountryConfig): string {
  const countries = [...config.countries.values()].sort((a, b) => a.code.localeCompare(b.code));
  const seedExcluded = excludedAt(-1);
  const definitions = [...config.definitions.values()]
    .filter((d) => !isPostSeedParam(d.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  const values = sortValues(config.values.filter((v) => !isPostSeedParam(v.key)));

  const parts: string[] = [
    [
      '-- 0009 — graines de la configuration pays (US-013 ; 17 §7.2 ; ADR-024, ADR-033).',
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
        textArray(countryAt(c, seedExcluded).locales),
        jsonb(countryAt(c, seedExcluded).names),
        textArray(c.hostTaxIdKinds),
      ]),
    ),
    definitionInsert(definitions),
    valueInsert(values),
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

/**
 * Migration de graine complémentaire d'une langue ajoutée après 0009 (`POST_SEED_LANGUAGES`) :
 * locales et noms de chaque pays tels qu'ils sont une fois cette langue ajoutée. La table
 * `config_country` est immuable (garde `config_country_guard`, 0008) : la garde est suspendue
 * puis rétablie dans la même transaction, sous `migrator` (propriétaire), comme le prévoit 0008.
 * Contrôle final fail-closed : un pays sans la langue fait échouer la migration.
 */
export function renderLanguageSeedSql(config: CountryConfig, language: string): string {
  const index = POST_SEED_LANGUAGES.findIndex((l) => l.language === language);
  const step = POST_SEED_LANGUAGES[index];
  if (!step) throw new Error(`langue « ${language} » absente de POST_SEED_LANGUAGES`);
  const excluded = excludedAt(index);
  const countries = [...config.countries.values()].sort((a, b) => a.code.localeCompare(b.code));
  const number = step.file.slice(0, 4);
  const updates = countries.map((c) => {
    const at = countryAt(c, excluded);
    return (
      `UPDATE core.config_country SET locales = ${textArray(at.locales)}, ` +
      `names = ${jsonb(at.names)}\n WHERE code = ${lit(c.code)};\n`
    );
  });
  return [
    [
      `-- ${number} — graine complémentaire : langue « ${language} » ajoutée aux pays (locales et noms).`,
      '-- DEC-FONDATEUR-18 ; US-014 ; ADR-024, ADR-044, ADR-071. FICHIER GÉNÉRÉ depuis',
      '-- apps/api/src/modules/cfg/data/countries.json par seed-sql.ts (renderLanguageSeedSql) : ne pas',
      '-- l’éditer à la main (test seed-sql.test.ts). Appliquée sous `migrator`.',
      `-- 0009 est immuable (ADR-044) : elle reste rendue sans la langue « ${language} ».`,
      '--',
      '-- Retour arrière (base sans dépendance) : rétablir locales et noms de 0009 de la même façon',
      '-- (garde suspendue puis rétablie) ; jamais en production : nouvelle migration à la place.',
      '',
      'ALTER TABLE core.config_country DISABLE TRIGGER config_country_guard;',
      '',
    ].join('\n'),
    ...updates,
    [
      '',
      'ALTER TABLE core.config_country ENABLE TRIGGER config_country_guard;',
      '',
      '-- Fail-closed : chaque pays porte une locale et un nom dans la langue ajoutée (COALESCE : un',
      '-- tableau ou un objet NULL compte comme absent).',
      'DO $check$',
      'BEGIN',
      '  IF EXISTS (SELECT 1 FROM core.config_country AS c',
      `              WHERE NOT COALESCE(EXISTS (SELECT 1 FROM pg_catalog.unnest(c.locales) AS t(tag)`,
      `                                          WHERE pg_catalog.split_part(t.tag, '-', 1) = ${lit(language)}), false)`,
      `                 OR COALESCE(pg_catalog.btrim(c.names ->> ${lit(language)}), '') = '') THEN`,
      `    RAISE EXCEPTION 'graine : langue ${language} absente d''un pays' USING ERRCODE = 'check_violation';`,
      '  END IF;',
      'END',
      '$check$;',
      '',
    ].join('\n'),
  ].join('');
}

/**
 * Migration de graine complémentaire d'un groupe de paramètres ajouté après 0009
 * (`POST_SEED_PARAMS`) : définitions puis valeurs par pays, comme 0009 (la garde de
 * `config_param_value` pose `valid_from` = `platform.now()` et la devise). Contrôle final
 * fail-closed : chaque définition du groupe a une valeur pour chaque pays déclaré.
 */
export function renderParamSeedSql(config: CountryConfig, prefix: string): string {
  const step = POST_SEED_PARAMS.find((p) => p.prefix === prefix);
  if (!step) throw new Error(`groupe de paramètres « ${prefix} » absent de POST_SEED_PARAMS`);
  const definitions = [...config.definitions.values()]
    .filter((d) => d.key.startsWith(prefix))
    .sort((a, b) => a.key.localeCompare(b.key));
  const values = sortValues(config.values.filter((v) => v.key.startsWith(prefix)));
  const number = step.file.slice(0, 4);
  const like = `${prefix.replaceAll('_', '\\_')}%`;
  return [
    [
      `-- ${number} — graine complémentaire : paramètres « ${prefix}* » (${step.story} ; 17 §7.2).`,
      '-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts',
      '-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous',
      '-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).',
      '-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).',
      '--',
      `-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé`,
      `-- commence par « ${prefix} » ; jamais en production : nouvelle migration à la place.`,
      '',
    ].join('\n'),
    definitionInsert(definitions),
    '\n',
    valueInsert(
      values,
      `graine ${step.story} : défauts PROPOSÉS (${step.refs ?? '17 §6.6, §7.2'})`,
    ),
    [
      '',
      '-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.',
      'DO $check$',
      'BEGIN',
      '  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d',
      '              CROSS JOIN core.config_country AS c',
      `             WHERE d.key LIKE ${lit(like)}`,
      '               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v',
      '                                WHERE v.key = d.key AND v.country_code = c.code)) THEN',
      `    RAISE EXCEPTION 'graine : paramètre ${prefix}* sans valeur pour un pays' USING ERRCODE = 'check_violation';`,
      '  END IF;',
      'END',
      '$check$;',
      '',
    ].join('\n'),
  ].join('');
}
