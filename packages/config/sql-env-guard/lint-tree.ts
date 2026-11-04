/**
 * Contrôle des migrations de production (`packages/db/migrations/*.sql`) : toute lecture de
 * `platform.deployment_env()` est fail-closed (scan.ts), sauf les lectures historiques inscrites
 * une à une dans `packages/db/env-guard-allowlist.json` avec la migration qui les remplace.
 * Une entrée qui ne correspond plus à aucune lecture, ou dont la migration de remplacement est
 * absente, est une erreur (liste blanche jamais périmée).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanEnvGuards } from './scan.ts';
import type { EnvGuardFinding } from './scan.ts';

export const MIGRATIONS_DIR = 'packages/db/migrations';
export const DEFAULT_ENV_ALLOWLIST_PATH = 'packages/db/env-guard-allowlist.json';

export interface EnvAllowEntry {
  readonly path: string;
  readonly line: number;
  readonly function: string;
  readonly supersededBy: string;
  readonly justification: string;
}

export interface EnvFileFinding extends EnvGuardFinding {
  readonly file: string;
}

export interface EnvLintResult {
  readonly filesScanned: number;
  readonly findings: readonly EnvFileFinding[];
  readonly allowlistErrors: readonly string[];
}

export function loadEnvAllowlist(file: string): { entries: EnvAllowEntry[]; errors: string[] } {
  if (!existsSync(file)) return { entries: [], errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { entries: [], errors: [`liste blanche illisible (${String(error)})`] };
  }
  const list = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return { entries: [], errors: ['champ "entries" absent'] };
  const entries: EnvAllowEntry[] = [];
  const errors: string[] = [];
  for (const [index, item] of list.entries()) {
    const e = item as Partial<EnvAllowEntry>;
    const where = `liste blanche, entrée ${index}`;
    if (
      typeof e.path !== 'string' ||
      !e.path.startsWith(`${MIGRATIONS_DIR}/`) ||
      typeof e.line !== 'number' ||
      !Number.isInteger(e.line) ||
      typeof e.function !== 'string' ||
      typeof e.supersededBy !== 'string' ||
      !/^\d{4}_[a-z0-9_]+$/.test(e.supersededBy)
    ) {
      errors.push(`${where} : path, line, function et supersededBy (NNNN_nom) exigés`);
      continue;
    }
    if (typeof e.justification !== 'string' || e.justification.trim().length < 20) {
      errors.push(`${where} (${e.path}:${e.line}) : justification manquante ou trop courte`);
      continue;
    }
    entries.push(e as EnvAllowEntry);
  }
  return { entries, errors };
}

/** Analyse les migrations de production sous `root`. */
export function lintEnvGuards(root: string, allowlistFile?: string): EnvLintResult {
  const { entries, errors } = loadEnvAllowlist(
    allowlistFile ?? join(root, DEFAULT_ENV_ALLOWLIST_PATH),
  );
  const dir = join(root, MIGRATIONS_DIR);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];
  const findings: EnvFileFinding[] = [];
  const used = new Set<EnvAllowEntry>();
  for (const name of files) {
    const rel = `${MIGRATIONS_DIR}/${name}`;
    for (const f of scanEnvGuards(readFileSync(join(dir, name), 'utf8'))) {
      const entry = entries.find((e) => e.path === rel && e.line === f.line);
      if (entry) used.add(entry);
      else findings.push({ ...f, file: rel });
    }
  }
  const allowlistErrors = [...errors];
  for (const e of entries) {
    if (!used.has(e)) {
      allowlistErrors.push(`${e.path}:${e.line} (${e.function}) : aucune lecture à tolérer ici`);
    }
    if (!files.some((f) => f.startsWith(`${e.supersededBy}.sql`))) {
      allowlistErrors.push(
        `${e.path}:${e.line} : migration de remplacement ${e.supersededBy} absente`,
      );
    } else if (`${MIGRATIONS_DIR}/${e.supersededBy}.sql` <= e.path) {
      allowlistErrors.push(`${e.path}:${e.line} : ${e.supersededBy} n'est pas postérieure`);
    }
  }
  return { filesScanned: files.length, findings, allowlistErrors };
}
