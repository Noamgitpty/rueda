/**
 * Règle expand / contract des migrations de production (US-046, ADR-081 ; ADR-078 point 6,
 * docs/ops/DEPLOY.md : « une migration ne casse jamais la version encore servie »).
 *
 * Le retour arrière d'US-003 ressert l'image précédente SANS migration descendante : la version N
 * doit donc fonctionner sur le schéma N + 1. Une migration ne fait qu'ÉTENDRE (tables, colonnes
 * facultatives ou avec défaut, fonctions, index, contraintes, politiques) ; la CONTRACTION
 * (suppression, renommage, changement de type ou de schéma, colonne rendue obligatoire, défaut
 * retiré, droit, politique, contrainte, déclencheur ou index retiré, RLS relâchée, rôle modifié,
 * réécriture ou suppression de données, SQL dynamique) vient dans une version ultérieure, quand plus
 * rien ne lit l'ancien objet, et chaque contraction est une DÉROGATION nominative et justifiée
 * (`packages/db/expand-contract-allowlist.json`).
 *
 * Portée de l'analyse (revue code US-046, constats 1 à 3) :
 * - instructions de premier niveau ;
 * - corps des blocs `DO` (exécutés pendant la migration) : TOUTE instruction, quelle que soit la
 *   structure de contrôle (`IF … THEN`, `LOOP`, `CASE`, `EXCEPTION`) qui la précède ;
 * - corps des fonctions et procédures (`CREATE [OR REPLACE] FUNCTION | PROCEDURE`) : les
 *   instructions de DÉFINITION (DDL, droits, rôles) et le SQL dynamique ; leurs `UPDATE` / `DELETE`
 *   sont le métier de la fonction à l'exécution, pas une migration de données ;
 * - `EXECUTE` dynamique (bloc `DO` ou fonction) : refusé par défaut (son texte n'est pas analysable),
 *   sauf dérogation `dynamic-sql`.
 * Commentaires et littéraux chaîne sont masqués partout.
 *
 * Remplacement admis sans dérogation : un objet NOMMÉ supprimé puis recréé sous le même nom dans la
 * même migration (politique sur la même table, déclencheur sur la même table, contrainte de la
 * même table, index). Le test L0 (l0-us046-migrations) prouve qu'il existe encore après la
 * migration ; la matrice d'US-043 prouve l'effet des politiques.
 */

export const CONTRACT_KINDS = [
  'drop-object',
  'drop-function',
  'drop-column',
  'drop-policy',
  'drop-constraint',
  'drop-trigger',
  'drop-index',
  'drop-default',
  'rename',
  'set-schema',
  'alter-column-type',
  'set-not-null',
  'add-column-not-null-without-default',
  'revoke-app-role',
  'disable-rls',
  'disable-trigger',
  'role-change',
  'dynamic-sql',
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
    'suppression d’une table, vue, séquence, d’un type, d’un domaine, d’une extension ou d’un schéma : la version N le lit encore',
  'drop-function':
    'suppression d’une fonction : la version N l’appelle encore (garder l’ancienne signature)',
  'drop-column': 'suppression de colonne : la version N la lit ou l’écrit encore',
  'drop-policy':
    'suppression d’une politique RLS non recréée : lecture ou écriture de la version N bloquée',
  'drop-constraint':
    'suppression d’une contrainte non recréée : un invariant (ou un code d’erreur) disparaît',
  'drop-trigger': 'suppression d’un déclencheur non recréé : une garde ou un invariant disparaît',
  'drop-index': 'suppression d’un index non recréé : unicité ou performance de la version N perdue',
  'drop-default': 'défaut retiré : les INSERT de la version N qui omettent la colonne échouent',
  rename: 'renommage : la version N utilise l’ancien nom (ajouter, migrer, retirer plus tard)',
  'set-schema': 'changement de schéma : la version N utilise l’ancien nom qualifié',
  'alter-column-type': 'changement de type : la version N lit et écrit l’ancien type',
  'set-not-null': 'colonne rendue obligatoire : les écritures de la version N peuvent l’omettre',
  'add-column-not-null-without-default':
    'colonne NOT NULL sans défaut : échoue sur une table peuplée et casse les INSERT de la version N',
  'revoke-app-role': 'retrait d’un droit d’un rôle applicatif : la version N l’utilise peut-être',
  'disable-rls': 'RLS désactivée ou non forcée : contrôle d’accès relâché',
  'disable-trigger': 'déclencheur désactivé : une garde ou un invariant ne s’applique plus',
  'role-change':
    'rôle modifié (ALTER ROLE, DROP / REASSIGN OWNED) : droits de la version N changés',
  'dynamic-sql': 'EXECUTE dynamique : texte non analysable, refusé sauf dérogation',
  truncate: 'TRUNCATE dans une migration : perte de données',
  'data-delete': 'DELETE dans une migration : migration de données destructrice',
  'data-update': 'UPDATE dans une migration : migration de données (comptes et lignes à prouver)',
};

/** Natures possibles dans le corps d'une fonction (définition, pas métier à l'exécution). */
const FUNCTION_BODY_KINDS = new Set<ContractKind>(
  CONTRACT_KINDS.filter((k) => !['truncate', 'data-delete', 'data-update'].includes(k)),
);

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export type StatementContext = 'top' | 'do' | 'function';

export interface Statement {
  readonly text: string;
  readonly offset: number;
  readonly context: StatementContext;
}

/**
 * Masque commentaires et chaînes (même longueur, sauts de ligne conservés) et découpe en
 * instructions. Le corps dollar d'un `DO` ou d'une fonction est découpé à son tour (contexte
 * `do` ou `function`) ; tout autre corps dollar est masqué.
 */
export function topLevelStatements(source: string, context: StatementContext = 'top'): Statement[] {
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
      const head = currentHead();
      const inner: StatementContext | undefined = /^do\b/.test(head)
        ? 'do'
        : /^create (or replace )?(function|procedure)\b/.test(head)
          ? 'function'
          : // corps imbriqué d'un DO ou d'une fonction : même contexte
            context !== 'top'
            ? context
            : undefined;
      if (inner !== undefined && close !== -1) {
        const bodyStart = i + tag.length;
        for (const st of topLevelStatements(source.slice(bodyStart, close), inner)) {
          bodies.push({ ...st, offset: bodyStart + st.offset });
        }
      }
      blank(i, stop);
      i = stop;
    } else if (ch === ';') {
      statements.push({ text: chars.slice(start, i).join(''), offset: start, context });
      start = i + 1;
      i++;
    } else i++;
  }
  const rest = chars.slice(start).join('');
  if (rest.trim() !== '') statements.push({ text: rest, offset: start, context });
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
const ident = (s: string): string => (s.split('.').at(-1) ?? s).replace(/"/g, '');
const table = (s: string): string => s.replace(/"/g, '');

/** Contraction détectée, avec l'objet nommé quand un remplacement peut l'annuler. */
export interface Contraction {
  readonly kind: ContractKind;
  /** `politique@table`, `déclencheur@table`, `contrainte@table`, `index` : clé de remplacement. */
  readonly object?: string;
}

/** Objets nommés créés par une instruction (clés de remplacement). */
export function createdObjects(sql: string): string[] {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const out: string[] = [];
  let m = /^create policy (\S+) on (\S+)/.exec(s);
  if (m) out.push(`policy:${ident(m[1] as string)}@${table(m[2] as string)}`);
  m = /^create (or replace )?(constraint )?trigger (\S+) .*? on (\S+)/.exec(s);
  if (m) out.push(`trigger:${ident(m[3] as string)}@${table(m[4] as string)}`);
  m = /^create (unique )?index (concurrently )?(if not exists )?(\S+) on/.exec(s);
  if (m) out.push(`index:${ident(m[4] as string)}`);
  const alter = /^alter table (?:if exists )?(?:only )?(\S+) (.*)$/.exec(s);
  if (alter) {
    for (const c of clauses(alter[2] as string)) {
      const add = /^add constraint (\S+)/.exec(c);
      if (add) out.push(`constraint:${ident(add[1] as string)}@${table(alter[1] as string)}`);
    }
  }
  const create = /^create table (?:if not exists )?(\S+) /.exec(s);
  if (create) {
    for (const c of s.matchAll(/\bconstraint (\S+)/g)) {
      out.push(`constraint:${ident(c[1] as string)}@${table(create[1] as string)}`);
    }
  }
  return out;
}

/** Détecte les contractions d'une instruction qui COMMENCE par sa commande. */
export function classifyStatement(sql: string): Contraction[] {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const out: Contraction[] = [];
  const add = (kind: ContractKind, object?: string): void => {
    out.push(object === undefined ? { kind } : { kind, object });
  };
  if (/^drop (table|view|materialized view|schema|type|domain|sequence|extension)\b/.test(s)) {
    add('drop-object');
  }
  if (/^drop (function|procedure|aggregate|routine)\b/.test(s)) add('drop-function');
  let m = /^drop policy (if exists )?(\S+) on (\S+)/.exec(s);
  if (m) add('drop-policy', `policy:${ident(m[2] as string)}@${table(m[3] as string)}`);
  m = /^drop trigger (if exists )?(\S+) on (\S+)/.exec(s);
  if (m) add('drop-trigger', `trigger:${ident(m[2] as string)}@${table(m[3] as string)}`);
  m = /^drop index (concurrently )?(if exists )?(\S+)/.exec(s);
  if (m) add('drop-index', `index:${ident(m[3] as string)}`);
  if (/^(drop|reassign) owned\b/.test(s) || /^alter (role|user|group)\b/.test(s))
    add('role-change');
  if (/^alter\b.* rename\b/.test(s)) add('rename');
  if (/^alter\b.* set schema\b/.test(s)) add('set-schema');
  if (/^truncate\b/.test(s)) add('truncate');
  if (/^delete from\b/.test(s) || /^with\b.*\bdelete from\b/.test(s)) add('data-delete');
  if (/^update\b/.test(s) || /^with\b.*\bupdate\b/.test(s)) add('data-update');
  if (/^execute\b/.test(s)) add('dynamic-sql');
  if (/^revoke\b/.test(s)) {
    const target = s
      .split(/ from /)
      .slice(1)
      .join(' from ');
    if (APP_ROLES.test(target)) add('revoke-app-role');
  }
  const alter = /^alter table (?:if exists )?(?:only )?(\S+) (.*)$/.exec(s);
  if (alter) {
    const tbl = table(alter[1] as string);
    for (const clause of clauses(alter[2] as string)) {
      const dc = /^drop constraint (if exists )?(\S+)/.exec(clause);
      if (dc) add('drop-constraint', `constraint:${ident(dc[2] as string)}@${tbl}`);
      else if (
        /^drop (column )?/.test(clause) &&
        !/^drop (not null|trigger|policy|index|expression|default|identity)\b/.test(clause)
      ) {
        add('drop-column');
      }
      if (/^alter (column )?\S+ (set data )?type\b/.test(clause)) add('alter-column-type');
      if (/^alter (column )?\S+ set not null\b/.test(clause)) add('set-not-null');
      if (/^alter (column )?\S+ drop (default|identity)\b/.test(clause)) add('drop-default');
      if (/^(disable row level security|no force row level security)\b/.test(clause)) {
        add('disable-rls');
      }
      if (/^disable trigger\b/.test(clause)) add('disable-trigger');
      if (
        /^add (column )?/.test(clause) &&
        !/^add (constraint|primary|unique|foreign|check|exclude)\b/.test(clause) &&
        /\bnot null\b/.test(clause) &&
        !/\b(default|generated)\b/.test(clause)
      ) {
        add('add-column-not-null-without-default');
      }
    }
  }
  return out;
}

/** Début de chaque commande dans le corps d'un DO ou d'une fonction (après IF … THEN, LOOP…). */
const BODY_COMMAND = /\b(alter|drop|truncate|delete\s+from|update|revoke|reassign|execute)\b/g;

/** Contractions d'une instruction de corps, quelle que soit la structure de contrôle. */
export function classifyBodyStatement(sql: string, context: StatementContext): Contraction[] {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const out: Contraction[] = [];
  for (const m of s.matchAll(BODY_COMMAND)) {
    const at = m.index;
    // une commande commence l'instruction, ou suit un mot de contrôle PL/pgSQL (IF … THEN, ELSE,
    // LOOP, BEGIN, DECLARE, EXCEPTION WHEN … THEN, RETURN QUERY) ; ailleurs, c'est un mot d'une
    // commande déjà analysée (ALTER TABLE … DROP COLUMN, SELECT … FOR UPDATE, BEFORE UPDATE ON,
    // ON CONFLICT DO UPDATE, GRANT EXECUTE)
    if (!/(^|\b(then|else|loop|begin|declare|query))\s*$/.test(s.slice(0, at))) continue;
    for (const c of classifyStatement(s.slice(at))) {
      if (context === 'function' && !FUNCTION_BODY_KINDS.has(c.kind)) continue;
      out.push(c);
    }
  }
  return out;
}

/** Analyse une migration ; renvoie ses contractions, par instruction. */
export function scanExpandContract(source: string): ContractFinding[] {
  const statements = topLevelStatements(source);
  const created = new Set(statements.flatMap((st) => createdObjects(st.text)));
  const findings: ContractFinding[] = [];
  for (const st of statements) {
    const lead = st.text.length - st.text.trimStart().length;
    const line = source.slice(0, st.offset + lead).split('\n').length;
    const text = st.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    const found =
      st.context === 'top' ? classifyStatement(text) : classifyBodyStatement(text, st.context);
    const seen = new Set<string>();
    for (const c of found) {
      // remplacement : objet nommé recréé sous le même nom dans la même migration
      if (c.object !== undefined && created.has(c.object)) continue;
      if (seen.has(c.kind)) continue;
      seen.add(c.kind);
      findings.push({
        kind: c.kind,
        line,
        statement: text.slice(0, 160),
        message: MESSAGES[c.kind],
      });
    }
  }
  return findings;
}
