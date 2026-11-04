/**
 * Contrôle expand / contract de `packages/db/migrations/*.sql` (US-046, ADR-081) : toute contraction
 * de premier niveau (scan.ts) doit être une dérogation nominative de
 * `packages/db/expand-contract-allowlist.json`. Une entrée qui ne correspond plus à aucune
 * instruction est une erreur (liste jamais périmée).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_KINDS, scanExpandContract } from './scan.ts';
import type { ContractFinding, ContractKind } from './scan.ts';

export const MIGRATIONS_DIR = 'packages/db/migrations';
export const DEFAULT_CONTRACT_ALLOWLIST_PATH = 'packages/db/expand-contract-allowlist.json';

export interface ContractAllowEntry {
  readonly path: string;
  readonly line: number;
  readonly kind: ContractKind;
  readonly justification: string;
  /** false : la migration exige des tables vides (graines posées après elle). */
  readonly populated?: boolean;
  /** Tables dont la migration de données réécrit des lignes. */
  readonly dataTables?: readonly string[];
}

export interface ContractFileFinding extends ContractFinding {
  readonly file: string;
}

export interface ContractLintResult {
  readonly filesScanned: number;
  readonly findings: readonly ContractFileFinding[];
  readonly allowlistErrors: readonly string[];
}

export function loadContractAllowlist(file: string): {
  entries: ContractAllowEntry[];
  errors: string[];
} {
  if (!existsSync(file)) return { entries: [], errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { entries: [], errors: [`liste de dérogations illisible (${String(error)})`] };
  }
  const list = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return { entries: [], errors: ['champ "entries" absent'] };
  const entries: ContractAllowEntry[] = [];
  const errors: string[] = [];
  for (const [index, item] of list.entries()) {
    const e = item as Partial<ContractAllowEntry>;
    const where = `dérogation ${index}`;
    if (
      typeof e.path !== 'string' ||
      !e.path.startsWith(`${MIGRATIONS_DIR}/`) ||
      typeof e.line !== 'number' ||
      !Number.isInteger(e.line) ||
      typeof e.kind !== 'string' ||
      !(CONTRACT_KINDS as readonly string[]).includes(e.kind)
    ) {
      errors.push(`${where} : path, line et kind (${CONTRACT_KINDS.join(', ')}) exigés`);
      continue;
    }
    if (typeof e.justification !== 'string' || e.justification.trim().length < 40) {
      errors.push(`${where} (${e.path}:${e.line}) : justification manquante ou trop courte`);
      continue;
    }
    if (e.populated !== undefined && typeof e.populated !== 'boolean') {
      errors.push(`${where} (${e.path}:${e.line}) : populated doit être un booléen`);
      continue;
    }
    if (
      e.dataTables !== undefined &&
      (!Array.isArray(e.dataTables) ||
        e.dataTables.some((t) => typeof t !== 'string' || !/^[a-z_]+\.[a-z_0-9]+$/.test(t)))
    ) {
      errors.push(`${where} (${e.path}:${e.line}) : dataTables = liste de schema.table`);
      continue;
    }
    if ((e.kind === 'data-update' || e.kind === 'data-delete') && !e.dataTables?.length) {
      errors.push(`${where} (${e.path}:${e.line}) : migration de données sans dataTables`);
      continue;
    }
    entries.push(e as ContractAllowEntry);
  }
  return { entries, errors };
}

/** Analyse les migrations de production sous `root`. */
export function lintExpandContract(root: string, allowlistFile?: string): ContractLintResult {
  const { entries, errors } = loadContractAllowlist(
    allowlistFile ?? join(root, DEFAULT_CONTRACT_ALLOWLIST_PATH),
  );
  const dir = join(root, MIGRATIONS_DIR);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];
  const findings: ContractFileFinding[] = [];
  const used = new Set<ContractAllowEntry>();
  for (const name of files) {
    const rel = `${MIGRATIONS_DIR}/${name}`;
    for (const f of scanExpandContract(readFileSync(join(dir, name), 'utf8'))) {
      const entry = entries.find((e) => e.path === rel && e.line === f.line && e.kind === f.kind);
      if (entry) used.add(entry);
      else findings.push({ ...f, file: rel });
    }
  }
  const allowlistErrors = [...errors];
  for (const e of entries) {
    if (!used.has(e)) {
      allowlistErrors.push(`${e.path}:${e.line} (${e.kind}) : aucune contraction à tolérer ici`);
    }
  }
  return { filesScanned: files.length, findings, allowlistErrors };
}
