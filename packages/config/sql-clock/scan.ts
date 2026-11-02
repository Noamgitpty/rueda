/**
 * Détection des lectures d'horloge interdites dans le SQL métier (17 §1.3, ADR-030).
 *
 * Règle : la seule horloge autorisée est `platform.now()`. Sont interdits `now()`,
 * `current_timestamp`, `localtimestamp`, `transaction_timestamp()`, `statement_timestamp()`,
 * `timeofday()`, `current_date`, `current_time`, `localtime`, les littéraux spéciaux `'now'`,
 * `'today'`, `'tomorrow'`, `'yesterday'`, et `clock_timestamp()` hors liste blanche (seul le
 * fichier qui définit `platform.now()` y a droit).
 *
 * Les commentaires (`--`, `/* *\/` imbriqués), les littéraux chaîne et les identifiants entre
 * guillemets sont masqués avant la recherche ; un identifiant entre guillemets suivi de `(` ou
 * de `.` reste visible (`"now"()`, `"pg_catalog"."now"()`). Le contenu des chaînes dollar (`$$…$$`,
 * `$body$…$body$`) est analysé comme du code : ce sont presque toujours des corps de fonctions.
 */

export const CLOCK_TOKENS = [
  'now()',
  'current_timestamp',
  'localtimestamp',
  'transaction_timestamp()',
  'statement_timestamp()',
  'timeofday()',
  'clock_timestamp()',
  'current_date',
  'current_time',
  'localtime',
  "'now'",
  "'today'",
  "'tomorrow'",
  "'yesterday'",
] as const;

export type ClockToken = (typeof CLOCK_TOKENS)[number];

/** Seul jeton qui peut figurer dans une liste blanche (définition de `platform.now()`). */
export const ALLOWLISTABLE_TOKENS: readonly ClockToken[] = ['clock_timestamp()'];

export interface SqlClockFinding {
  readonly token: ClockToken;
  /** Ligne, à partir de 1. */
  readonly line: number;
  /** Colonne, à partir de 1. */
  readonly column: number;
  readonly message: string;
}

export interface ScanOptions {
  /** Jetons tolérés pour ce fichier (liste blanche). */
  readonly allow?: readonly ClockToken[];
}

interface MaskedSql {
  /** Texte de même longueur que la source, commentaires et chaînes remplacés par des espaces. */
  readonly code: string;
  readonly strings: ReadonlyArray<{ readonly value: string; readonly offset: number }>;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const QUOTED_CALLABLE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

function blank(chars: string[], from: number, to: number): void {
  for (let k = from; k < to; k++) {
    if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  }
}

/** Masque commentaires, littéraux chaîne et identifiants entre guillemets. */
export function maskSql(source: string): MaskedSql {
  const chars = source.split('');
  const strings: Array<{ value: string; offset: number }> = [];
  const pendingDollarClose = new Map<number, number>();
  const n = source.length;
  let i = 0;

  while (i < n) {
    const closeLen = pendingDollarClose.get(i);
    if (closeLen !== undefined) {
      pendingDollarClose.delete(i);
      i += closeLen;
      continue;
    }
    const c = source[i];
    const next = source[i + 1];

    if (c === '-' && next === '-') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(chars, i, stop);
      i = stop;
      continue;
    }

    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      blank(chars, i, j);
      i = j;
      continue;
    }

    if (c === "'") {
      const prev = source[i - 1] ?? '';
      const prevPrev = source[i - 2] ?? '';
      const escapeString = (prev === 'E' || prev === 'e') && !IDENT_CHAR.test(prevPrev);
      let j = i + 1;
      let value = '';
      while (j < n) {
        const d = source[j];
        if (escapeString && d === '\\') {
          value += source[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (d === "'") {
          if (source[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += d;
        j++;
      }
      strings.push({ value, offset: i });
      blank(chars, i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      blank(chars, i, Math.min(j + 1, n));
      // Un identifiant entre guillemets appelé ou qualifié (`"now"()`, `"pg_catalog"."now"()`,
      // `"platform"."now"()`) reste visible sans ses guillemets : c'est un appel de fonction.
      const content = source.slice(i + 1, j);
      if (QUOTED_CALLABLE.test(content) && /^\s*[(.]/.test(source.slice(j + 1, j + 64))) {
        for (let k = 0; k < content.length; k++) chars[i + 1 + k] = content[k] ?? ' ';
      }
      i = j + 1;
      continue;
    }

    if (c === '$' && !IDENT_CHAR.test(source[i - 1] ?? '')) {
      const match = DOLLAR_TAG.exec(source.slice(i, i + 66));
      if (match) {
        const delimiter = match[0];
        const close = source.indexOf(delimiter, i + delimiter.length);
        if (close !== -1) {
          blank(chars, i, i + delimiter.length);
          blank(chars, close, close + delimiter.length);
          pendingDollarClose.set(close, delimiter.length);
          i += delimiter.length;
          continue;
        }
      }
    }

    i++;
  }

  return { code: chars.join(''), strings };
}

interface Pattern {
  readonly token: ClockToken;
  readonly regex: RegExp;
}

// `(?<![\w$.])` : le mot n'est pas la fin d'un autre identifiant ni une colonne qualifiée.
const PATTERNS: readonly Pattern[] = [
  { token: 'current_timestamp', regex: /(?<![\w$.])current_timestamp(?![\w$])/gi },
  { token: 'localtimestamp', regex: /(?<![\w$.])localtimestamp(?![\w$])/gi },
  { token: 'current_date', regex: /(?<![\w$.])current_date(?![\w$])/gi },
  { token: 'current_time', regex: /(?<![\w$.])current_time(?![\w$])/gi },
  { token: 'localtime', regex: /(?<![\w$.])localtime(?![\w$])/gi },
  { token: 'transaction_timestamp()', regex: /(?<![\w$.])transaction_timestamp\s*\(/gi },
  { token: 'statement_timestamp()', regex: /(?<![\w$.])statement_timestamp\s*\(/gi },
  { token: 'timeofday()', regex: /(?<![\w$.])timeofday\s*\(/gi },
  { token: 'clock_timestamp()', regex: /(?<![\w$.])clock_timestamp\s*\(/gi },
];

const NOW_CALL = /(?<![\w$])now\s*\(/gi;
const PLATFORM_QUALIFIER = /platform\s*\.\s*$/i;
const PG_CATALOG_QUALIFIER = /pg_catalog\s*\.\s*/gi;
const SPECIAL_DATE_LITERALS: ReadonlyMap<string, ClockToken> = new Map([
  ['now', "'now'"],
  ['today', "'today'"],
  ['tomorrow', "'tomorrow'"],
  ['yesterday', "'yesterday'"],
]);

function messageFor(token: ClockToken): string {
  if (token === 'clock_timestamp()') {
    return (
      'clock_timestamp() est réservé à la définition de platform.now() (liste blanche ' +
      'packages/db/sql-clock-allowlist.json). Utiliser platform.now() (17 §1.3, ADR-030).'
    );
  }
  return `${token} est interdit dans le SQL métier : utiliser platform.now() (17 §1.3, ADR-030).`;
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let k = 0; k < offset; k++) {
    if (source[k] === '\n') {
      line++;
      lineStart = k + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Analyse un texte SQL et renvoie les lectures d'horloge interdites. */
export function scanSql(source: string, options: ScanOptions = {}): SqlClockFinding[] {
  const allow = new Set<ClockToken>(
    (options.allow ?? []).filter((t) => ALLOWLISTABLE_TOKENS.includes(t)),
  );
  const masked = maskSql(source);
  // `pg_catalog.now()` doit être traité comme `now()` : on efface le qualificatif.
  const code = masked.code.replace(PG_CATALOG_QUALIFIER, (m) => ' '.repeat(m.length));
  const hits: Array<{ token: ClockToken; offset: number }> = [];

  for (const match of code.matchAll(NOW_CALL)) {
    const before = code.slice(Math.max(0, match.index - 40), match.index);
    if (PLATFORM_QUALIFIER.test(before)) continue;
    hits.push({ token: 'now()', offset: match.index });
  }
  for (const { token, regex } of PATTERNS) {
    for (const match of code.matchAll(regex)) hits.push({ token, offset: match.index });
  }
  for (const literal of masked.strings) {
    const token = SPECIAL_DATE_LITERALS.get(literal.value.trim().toLowerCase());
    if (token) hits.push({ token, offset: literal.offset });
  }

  return hits
    .filter((h) => !allow.has(h.token))
    .sort((a, b) => a.offset - b.offset)
    .map((h) => ({
      token: h.token,
      ...lineAndColumn(source, h.offset),
      message: messageFor(h.token),
    }));
}

/** Heuristique : une chaîne d'un fichier TypeScript ressemble-t-elle à du SQL ? */
export function looksLikeSql(text: string): boolean {
  return /\b(select\s[\s\S]*\bfrom|insert\s+into|update\s+[\w."]+\s+set|delete\s+from|create\s+(or\s+replace\s+)?(function|table|view|trigger|index|procedure)|alter\s+table|with\s+[\w"]+\s+as\s*\(|returning|values\s*\(|where\s)\b/i.test(
    text,
  );
}
