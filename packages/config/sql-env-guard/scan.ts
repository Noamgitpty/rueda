/**
 * Garde d'environnement fail-closed (US-043, ADR-077 ; 17 §6.5 point 1, C19).
 *
 * `platform.deployment_env()` peut rendre NULL (environnement inconnu). Une garde écrite
 * `platform.deployment_env() = 'production'` vaut alors NULL : un `IF` ne lève pas, un `NOT (…)`
 * ne filtre pas, un `CASE` prend la branche « pas production ». La seule lecture admise dans une
 * migration est donc `COALESCE(platform.deployment_env(), 'production')` : un environnement
 * inconnu vaut « production ».
 *
 * Exceptions, sans liste : les instructions qui NOMMENT la fonction sans l'appeler (en-tête de
 * `CREATE [OR REPLACE] FUNCTION platform.deployment_env()`, `COMMENT ON`, `ALTER`, `DROP`,
 * `GRANT` / `REVOKE … ON FUNCTION`). Les lectures historiques remplacées par une migration plus
 * récente sont tolérées une à une par `packages/db/env-guard-allowlist.json` (fichiers immuables :
 * la somme de contrôle interdit de les modifier) ; le test L0 `l0-us043-env-guard` vérifie, sur la
 * base de production, qu'aucune fonction ne lit encore l'environnement hors de `COALESCE`.
 */
import { maskSql } from '../sql-clock/scan.ts';

export interface EnvGuardFinding {
  /** Ligne, à partir de 1. */
  readonly line: number;
  /** Colonne, à partir de 1. */
  readonly column: number;
  readonly message: string;
}

const CALL = /(?<![\w$])deployment_env\s*\(\s*\)/gi;
/** Le nom de la fonction déclarée ou visée par une instruction DDL (`… FUNCTION platform.`). */
const NAMED_BY_DDL = /\bFUNCTION\s+(?:platform\s*\.\s*)?$/i;
/** Liste de fonctions d'un `GRANT` / `REVOKE … ON FUNCTION a(), b()`. */
const PRIVILEGE_LIST = /^\s*(?:GRANT|REVOKE)\b[\s\S]*\bON\s+FUNCTION\b[^;]*$/i;
const QUALIFIER = /platform\s*\.\s*$/i;
const COALESCE_OPEN = /COALESCE\s*\(\s*$/i;

export const ENV_GUARD_MESSAGE =
  "platform.deployment_env() doit être lue par COALESCE(platform.deployment_env(), 'production') " +
  '(fail-closed sur NULL, C19 ; ADR-077).';

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

/** Lectures de l'environnement de la base qui ne sont pas fail-closed. */
export function scanEnvGuards(source: string): EnvGuardFinding[] {
  const { code, strings } = maskSql(source);
  const literalAt = new Map(strings.map((s) => [s.offset, s.value]));
  const findings: EnvGuardFinding[] = [];
  for (const match of code.matchAll(CALL)) {
    const start = match.index;
    let head = code.slice(0, start);
    const qualified = QUALIFIER.exec(head);
    // le début de l'appel, qualificatif `platform.` compris
    const callStart = qualified ? start - qualified[0].length : start;
    head = code.slice(0, callStart);
    const statement = head.slice(head.lastIndexOf(';') + 1);
    if (NAMED_BY_DDL.test(code.slice(0, start)) || PRIVILEGE_LIST.test(statement)) continue;
    const end = start + match[0].length;
    // `COALESCE(` juste avant, puis `, 'production')` juste après
    const opened = COALESCE_OPEN.test(head);
    // sur la source : dans le texte masqué, le littéral est devenu des espaces
    const after = /^\s*,\s*/.exec(source.slice(end));
    let closed = false;
    if (opened && after) {
      const literalOffset = end + after[0].length;
      const value = literalAt.get(literalOffset);
      if (value === 'production') {
        const rest = code.slice(literalOffset + value.length + 2);
        closed = /^\s*\)/.test(rest);
      }
    }
    if (!closed) {
      const { line, column } = lineAndColumn(source, callStart);
      findings.push({ line, column, message: ENV_GUARD_MESSAGE });
    }
  }
  return findings;
}
