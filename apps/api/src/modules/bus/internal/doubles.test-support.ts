/**
 * Doublures des tests unitaires du module BUS (sans base) : client SQL scripté et transactions
 * de travailleur qui enregistrent leurs appels. Les tests sur PostgreSQL réel, sous les rôles de
 * production, sont dans apps/api/test/int et packages/db/test.
 */
import { readFileSync } from 'node:fs';
import type { SqlClient, SqlResult, WorkerTransactions } from './sql.js';

export interface CountryCase {
  readonly country: string;
  readonly currency: string;
  /** 120 unités de la devise, en unités mineures (chaîne bigint). */
  readonly amountMinor: string;
}

/**
 * Cas de test par pays configuré (CLAUDE.md point 3 : USD et PYG sans décimale), lus dans les
 * données de configuration pays (apps/api/src/modules/cfg/data, US-013 ; ADR-024) et non écrits
 * en constantes : lecture de fichier de données, pas un import du module CFG.
 */
export function countryCases(): CountryCase[] {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(new URL(`../../cfg/data/${file}`, import.meta.url), 'utf8'));
  const countries = (read('countries.json') as { countries: { code: string; currency: string }[] })
    .countries;
  const currencies = (
    read('currencies.json') as { currencies: { code: string; exponent: number }[] }
  ).currencies;
  return countries.map((c) => {
    const exponent = currencies.find((x) => x.code === c.currency)?.exponent;
    if (exponent === undefined) throw new Error(`devise sans exposant : ${c.currency}`);
    return {
      country: c.code,
      currency: c.currency,
      amountMinor: (120n * 10n ** BigInt(exponent)).toString(),
    };
  });
}

export interface RecordedQuery {
  readonly worker: string | null;
  readonly text: string;
  readonly params: readonly unknown[];
}

type Responder = (params: readonly unknown[]) => Record<string, unknown>[] | Error;

/** Client SQL scripté : la première règle dont le motif correspond répond ; sinon, aucune ligne. */
export class ScriptedSql implements SqlClient {
  readonly calls: RecordedQuery[] = [];
  readonly #rules: { pattern: RegExp; respond: Responder }[] = [];
  worker: string | null = null;

  on(pattern: RegExp, respond: Responder | Record<string, unknown>[]): this {
    this.#rules.push({
      pattern,
      respond: typeof respond === 'function' ? respond : () => respond,
    });
    return this;
  }

  query<R = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<R>> {
    this.calls.push({ worker: this.worker, text, params });
    const rule = this.#rules.find((r) => r.pattern.test(text));
    const out = rule ? rule.respond(params) : [];
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ rows: out as R[], rowCount: out.length });
  }

  /** Appels dont le texte correspond au motif. */
  matching(pattern: RegExp): RecordedQuery[] {
    return this.calls.filter((c) => pattern.test(c.text));
  }
}

/** Transactions de travailleur simulées : enregistre le nom du travailleur et les issues. */
export class FakeTransactions implements WorkerTransactions {
  readonly log: { worker: string; outcome: 'commit' | 'rollback' }[] = [];

  constructor(readonly sql: ScriptedSql) {}

  async run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    this.sql.worker = workerName;
    try {
      const result = await fn(this.sql);
      this.log.push({ worker: workerName, outcome: 'commit' });
      return result;
    } catch (error) {
      this.log.push({ worker: workerName, outcome: 'rollback' });
      throw error;
    } finally {
      this.sql.worker = null;
    }
  }
}
