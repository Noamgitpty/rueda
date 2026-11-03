/**
 * Rejeu des transactions et percentiles (US-007), sans base de données : testés par
 * `replay.test.ts` (`pnpm test:unit`). Réexportés par `concurrency.ts`.
 */
import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { SQLSTATE, translateDbError } from '../../src/errors.ts';
import type { DbBusinessCode } from '../../src/errors.ts';

/** Reprise de 17 §2.5 : au plus 3 rejeux, attente aléatoire courte. */
export const MAX_REPLAYS = 3;

const isPgError = (e: unknown): e is { code: string; constraint?: string } =>
  typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';

/** Code SQLSTATE brut d'une erreur PostgreSQL, sinon `undefined`. */
export const sqlState = (e: unknown): string | undefined => (isPgError(e) ? e.code : undefined);

/** Percentile par rang le plus proche (p dans ]0, 1]). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] as number;
}

/** Issue finale d'une transaction rejouée. */
export interface Replayed<T> {
  /** Valeur de la dernière tentative, si elle a abouti. */
  readonly value?: T;
  /** Code métier de l'échec final (traduit, sans `DETAIL`), sinon `undefined`. */
  readonly error?: DbBusinessCode;
  /** SQLSTATE et contrainte bruts de l'échec final, pour la preuve. */
  readonly raw?: { readonly code: string | undefined; readonly constraint: string | undefined };
  /** Nombre de `40P01` reçus (interblocages détectés), toutes tentatives confondues. */
  readonly deadlocks: number;
  /** Nombre de `40001` reçus. */
  readonly serializationFailures: number;
  /** Nombre de rejeux effectués. */
  readonly replays: number;
  /** Durée totale, rejeux compris (ms). */
  readonly ms: number;
}

/**
 * Reprise de 17 §2.5 (VERIF_16-M2) : une transaction qui reçoit `40P01` ou `40001` est annulée
 * en entier (par `fn` : `withTestTransaction` fait le `ROLLBACK`) puis rejouée, au plus
 * `MAX_REPLAYS` fois, après une attente aléatoire courte. Toute autre erreur est finale.
 */
export async function withReplay<T>(fn: () => Promise<T>): Promise<Replayed<T>> {
  const started = performance.now();
  let deadlocks = 0;
  let serializationFailures = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const value = await fn();
      return {
        value,
        deadlocks,
        serializationFailures,
        replays: attempt,
        ms: performance.now() - started,
      };
    } catch (error) {
      const code = sqlState(error);
      if (code === SQLSTATE.deadlockDetected) deadlocks++;
      if (code === SQLSTATE.serializationFailure) serializationFailures++;
      const translated = translateDbError(error);
      if (!translated.retryable || attempt >= MAX_REPLAYS) {
        return {
          error: translated.code,
          raw: { code, constraint: isPgError(error) ? error.constraint : undefined },
          deadlocks,
          serializationFailures,
          replays: attempt,
          ms: performance.now() - started,
        };
      }
      await sleep(randomInt(5, 50));
    }
  }
}
