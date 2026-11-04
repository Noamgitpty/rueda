/**
 * Règle expand / contract des migrations de production (US-046, ADR-081 ; ADR-078 point 6,
 * docs/ops/DEPLOY.md : « une migration ne casse jamais la version encore servie »).
 *
 * Le retour arrière d'US-003 ressert l'image précédente SANS migration descendante : la version N
 * doit donc fonctionner sur le schéma N + 1. Une migration ne fait qu'ÉTENDRE (tables, colonnes
 * facultatives ou avec défaut, fonctions, index, contraintes) ; la CONTRACTION (suppression,
 * renommage, changement de type, colonne rendue obligatoire, retrait d'un droit d'un rôle
 * applicatif, réécriture ou suppression de données) vient dans une version ultérieure, quand plus
 * rien ne lit l'ancien objet, et chaque contraction est une DÉROGATION nominative et justifiée
 * (`packages/db/expand-contract-allowlist.json`).
 *
 * Analyse des instructions de PREMIER NIVEAU seulement : commentaires, littéraux chaîne et corps de
 * fonctions (chaînes dollar d'un `CREATE FUNCTION` / `CREATE PROCEDURE`) sont masqués ; le corps
 * d'un bloc `DO` est analysé comme du code (il s'exécute pendant la migration).
 */

export const CONTRACT_KINDS = [
  'drop-object',
  'drop-function',
  'drop-column',
  'rename',
  'alter-column-type',
  'set-not-null',
  'add-column-not-null-without-default',
  'revoke-app-role',
  'truncate',
  'data-delete',
  'data-update',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export interface ContractFinding {
  readonly kind: ContractKind;
  /** Ligne (à partir de 1) du début de l'instruction. */
  readonly line: number;
  readonly statement: string;
  readonly message: string;
}

const MESSAGES: Record<ContractKind, string> = {
  'drop-object':
    'suppression d’une table, vue, séquence, d’un type ou d’un schéma : la version N le lit encore',
  'drop-function':
    'suppression d’une fonction : la version N l’appelle encore (garder l’ancienne signature)',
  'drop-column': 'suppression de colonne : la version N la lit ou l’écrit encore',
  rename: 'renommage : la version N utilise l’ancien nom (ajouter, migrer, retirer plus tard)',
  'alter-column-type': 'changement de type : la version N lit et écrit l’ancien type',
  'set-not-null': 'colonne rendue obligatoire : les écritures de la version N peuvent l’omettre',
  'add-column-not-null-without-default':
    'colonne NOT NULL sans défaut : échoue sur une table peuplée et casse les INSERT de la version N',
  'revoke-app-role': 'retrait d’un droit d’un rôle applicatif : la version N l’utilise peut-être',
  truncate: 'TRUNCATE dans une migration : perte de données',
  'data-delete': 'DELETE de premier niveau : migration de données destructrice',
  'data-update': 'UPDATE de premier niveau : migration de données (comptes et lignes à prouver)',
};

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

interface Statement {
  readonly text: string;
  readonly offset: number;
}

/**
 * Masque commentaires et chaînes (même longueur, sauts de ligne conservés) et découpe en
 * instructions de premier niveau. Le corps dollar d'une instruction qui commence par `DO` reste
 * visible ; tout autre corps dollar est masqué.
 */
export function topLevelStatements(source: string): Statement[] {
  const chars = source.split('');
  const n = source.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  };
  const statements: Statement[] = [];
  const bodies: Statement[] = [];
  let start = 0;
  let i = 0;
  const currentHead = (): string =>
    chars.slice(start, i).join('').replace(/\s+/g, ' ').trim().toLowerCase();
  while (i < n) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '-' && next === '-') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "'" && source[j + 1] === "'") j += 2;
        else if (source[j] === "'") break;
        else j++;
      }
      blank(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (ch === '"') {
      const end = source.indexOf('"', i + 1);
      i = end === -1 ? n : end + 1;
    } else if (ch === '$' && DOLLAR_TAG.test(source.slice(i, i + 64))) {
      const tag = (DOLLAR_TAG.exec(source.slice(i, i + 64)) as RegExpExecArray)[0];
      const close = source.indexOf(tag, i + tag.length);
      const stop = close === -1 ? n : close + tag.length;
      if (/^do\b/.test(currentHead()) && close !== -1) {
        // bloc DO : son corps s'exécute pendant la migration ; ses instructions sont analysées
        const bodyStart = i + tag.length;
        for (const inner of topLevelStatements(source.slice(bodyStart, close))) {
          bodies.push({ text: inner.text, offset: bodyStart + inner.offset });
        }
      }
      blank(i, stop);
      i = stop;
    } else if (ch === ';') {
      statements.push({ text: chars.slice(start, i).join(''), offset: start });
      start = i + 1;
      i++;
    } else i++;
  }
  const rest = chars.slice(start).join('');
  if (rest.trim() !== '') statements.push({ text: rest, offset: start });
  return [...statements, ...bodies].sort((a, b) => a.offset - b.offset);
}

/** Sépare les clauses d'un ALTER TABLE (virgules hors parenthèses). */
function clauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(from, k));
      from = k + 1;
    }
  }
  out.push(text.slice(from));
  return out.map((s) => s.trim());
}

const APP_ROLES = /\b(app_api|app_worker|app_anon)\b/;
const KEEP_AFTER_DROP =
  /^drop\s+(constraint|default|not\s+null|identity|expression|trigger|policy|index)\b/;

/** Détecte les contractions d'une instruction normalisée (minuscules, espaces simples). */
export function classifyStatement(sql: string): ContractKind[] {
  // mots-clés PL/pgSQL qui précèdent une instruction dans le corps d'un bloc DO
  const s = sql
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^((begin|declare|then|else|loop|end if|end loop|<<\w+>>)\b ?)+/, '');
  const kinds = new Set<ContractKind>();
  if (/^drop (table|view|materialized view|schema|type|domain|sequence|extension)\b/.test(s)) {
    kinds.add('drop-object');
  }
  if (/^drop (function|procedure|aggregate)\b/.test(s)) kinds.add('drop-function');
  if (/^alter\b.* rename\b/.test(s)) kinds.add('rename');
  if (/^truncate\b/.test(s)) kinds.add('truncate');
  if (/^delete from\b/.test(s) || /^with\b.*\bdelete from\b/.test(s)) kinds.add('data-delete');
  if (/^update\b/.test(s) || /^with\b.*\bupdate\b/.test(s)) kinds.add('data-update');
  if (/^revoke\b/.test(s)) {
    const target = s
      .split(/ from /)
      .slice(1)
      .join(' from ');
    if (APP_ROLES.test(target)) kinds.add('revoke-app-role');
  }
  const alter = /^alter table (?:if exists )?(?:only )?\S+ (.*)$/.exec(s);
  if (alter) {
    for (const clause of clauses(alter[1] as string)) {
      if (/^drop (column )?/.test(clause) && !KEEP_AFTER_DROP.test(clause)) {
        kinds.add('drop-column');
      }
      if (/^alter (column )?\S+ (set data )?type\b/.test(clause)) kinds.add('alter-column-type');
      if (/^alter (column )?\S+ set not null\b/.test(clause)) kinds.add('set-not-null');
      if (
        /^add (column )?(?!constraint\b)/.test(clause) &&
        !/^add (constraint|primary|unique|foreign|check|exclude)\b/.test(clause)
      ) {
        if (/\bnot null\b/.test(clause) && !/\b(default|generated)\b/.test(clause)) {
          kinds.add('add-column-not-null-without-default');
        }
      }
    }
  }
  return [...kinds];
}

/** Analyse une migration ; renvoie ses contractions, par instruction. */
export function scanExpandContract(source: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  for (const st of topLevelStatements(source)) {
    const lead = st.text.length - st.text.trimStart().length;
    const line = source.slice(0, st.offset + lead).split('\n').length;
    const text = st.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    for (const kind of classifyStatement(text)) {
      findings.push({ kind, line, statement: text.slice(0, 160), message: MESSAGES[kind] });
    }
  }
  return findings;
}
