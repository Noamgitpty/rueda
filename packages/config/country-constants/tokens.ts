/**
 * Jetons « propres à un pays » (US-013 ; ADR-024, ADR-033 ; 19 US-013 critère « aucune constante
 * pays »). Ils ne sont **pas** écrits ici : ils sont tirés des données de configuration pays
 * (`apps/api/src/modules/cfg/data/`), si bien qu'un pays ajouté aux données est aussitôt protégé.
 *
 * Retenus : codes pays, codes de devise, fuseaux IANA, locales régionales (`es-PA`…, pas `en`
 * ni `fr`, communes à plusieurs pays), groupes fiscaux (`ITBMS`…), types de pièce fiscale de
 * l'hôte, régimes de facturation des entités juridiques.
 *
 * Fichier en syntaxe effaçable, sans dépendance : chargé directement par Node (eslint.config.mjs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dossier des données, relatif à la racine du dépôt. */
export const COUNTRY_DATA_DIR = 'apps/api/src/modules/cfg/data';

interface CountryDoc {
  readonly code?: unknown;
  readonly timeZone?: unknown;
  readonly locales?: unknown;
  readonly hostTaxIdKinds?: unknown;
  readonly taxLines?: unknown;
  readonly legalEntity?: unknown;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Jetons tirés des documents `currencies.json` et `countries.json` (déjà lus). */
export function countryTokensFromData(currenciesDoc: unknown, countriesDoc: unknown): string[] {
  const tokens = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v.trim() !== '') tokens.add(v);
  };
  for (const c of strings(
    ((currenciesDoc as { currencies?: unknown[] }).currencies ?? []).map(
      (x) => (x as { code?: unknown }).code,
    ),
  )) {
    add(c);
  }
  for (const raw of (countriesDoc as { countries?: unknown[] }).countries ?? []) {
    const country = raw as CountryDoc;
    add(country.code);
    add(country.timeZone);
    for (const tag of strings(country.locales)) if (tag.includes('-')) add(tag);
    for (const kind of strings(country.hostTaxIdKinds)) add(kind);
    for (const line of Array.isArray(country.taxLines) ? country.taxLines : []) {
      add((line as { rateGroup?: unknown }).rateGroup);
    }
    const entity = country.legalEntity as { invoicingRegime?: unknown } | null | undefined;
    add(entity?.invoicingRegime);
  }
  return [...tokens].sort();
}

/** Lit les données du dépôt et rend les jetons. Échoue si les données sont absentes. */
export function loadCountryTokens(repoRoot: string): string[] {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(join(repoRoot, COUNTRY_DATA_DIR, file), 'utf8')) as unknown;
  const tokens = countryTokensFromData(read('currencies.json'), read('countries.json'));
  if (tokens.length === 0) throw new Error('aucun jeton pays : données de configuration vides');
  return tokens;
}

export interface CountryConstantFinding {
  readonly token: string;
  /** Position dans le texte analysé (0-indexée). */
  readonly offset: number;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Occurrences des jetons dans `text`, en mot entier et **sans tenir compte de la casse** (revue
 * code US-013) : `PA` est détecté dans `'PA'`, `'pa'` ou `'pays PA'`, `America/Asuncion` dans
 * `'america/asuncion'`, mais pas `PA` dans `'PAYMENT'` ni `py` dans `'oracle.py'` (extension). Le jeton rendu est celui des données.
 */
export function findCountryConstants(
  text: string,
  tokens: readonly string[],
): CountryConstantFinding[] {
  if (tokens.length === 0) return [];
  const byLower = new Map(tokens.map((t) => [t.toLowerCase(), t]));
  const regex = new RegExp(
    `(?<![A-Za-z0-9_.])(${[...tokens]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|')})(?![A-Za-z0-9_])`,
    'gi',
  );
  const out: CountryConstantFinding[] = [];
  for (const match of text.matchAll(regex)) {
    const found = match[1] ?? match[0];
    out.push({ token: byLower.get(found.toLowerCase()) ?? found, offset: match.index });
  }
  return out;
}

/** Commentaire qui désactive ou reconfigure `rueda/no-country-constants` (ou toutes les règles). */
const DIRECTIVE = /^\s*eslint(?:-disable(?:-next-line|-line)?|-enable)?(?=\s|$)(.*)$/s;

/**
 * Vrai si le texte d'un commentaire est une directive ESLint qui peut couper la règle : une
 * désactivation sans liste de règles (toutes les règles), ou toute directive qui la nomme.
 * `eslint-enable` est inoffensif et ignoré.
 */
export function isCountryRuleDirective(comment: string): boolean {
  const m = DIRECTIVE.exec(comment);
  if (!m) return false;
  const head = comment.trimStart();
  if (head.startsWith('eslint-enable')) return false;
  const rest = (m[1] ?? '').split('--')[0]!.trim();
  if (head.startsWith('eslint-disable')) return rest === '' || /no-country-constants/.test(rest);
  // Configuration en ligne (« eslint rueda/no-country-constants: off ») : refusée aussi.
  return /no-country-constants/.test(rest);
}

/** Exemptions déclarées (`exemptions.json`) : globs des fichiers exemptés et des directives tolérées. */
export interface CountryExemptions {
  readonly files: readonly string[];
  readonly directives: readonly string[];
}

export const COUNTRY_EXEMPTIONS_FILE = 'packages/config/country-constants/exemptions.json';

export function loadCountryExemptions(repoRoot: string): CountryExemptions {
  const doc = JSON.parse(readFileSync(join(repoRoot, COUNTRY_EXEMPTIONS_FILE), 'utf8')) as {
    files?: Array<{ globs?: unknown; justification?: unknown }>;
    directives?: unknown;
  };
  const files: string[] = [];
  for (const [i, entry] of (doc.files ?? []).entries()) {
    if (typeof entry.justification !== 'string' || entry.justification.trim() === '') {
      throw new Error(`${COUNTRY_EXEMPTIONS_FILE} : entrée ${i} sans justification`);
    }
    files.push(...strings(entry.globs));
  }
  return { files, directives: strings(doc.directives) };
}
