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

/**
 * Attente avant le rejeu n° `replay` (1 à `MAX_REPLAYS`), en ms. Défaut de 17 §2.5 : aléatoire
 * courte, 5 à 50 ms.
 */
export type ReplayBackoff = (replay: number) => number;

/** Attente de 17 §2.5 : aléatoire courte (5 à 50 ms). */
export const SHORT_BACKOFF: ReplayBackoff = () => randomInt(5, 50);

/**
 * Attente du cas d'injection de L0-02 (C1 sans verrou par véhicule, ADR-056, « Issue
 * déterministe de l'injection ») : aléatoire dans [B, 1,5 B[, avec B = 2 × `degree` ×
 * `deadlockTimeoutMs`.
 *
 * Sans le verrou, `degree` poses en attente mutuelle dans l'index d'exclusion ne se résolvent
 * qu'**une par une**, à raison d'un `40P01` par `deadlock_timeout` : la file se vide en
 * (`degree` − 1) × `deadlock_timeout` au plus, au rythme mesuré. Une victime qui revient avant
 * la fin de cette vidange réinsère un tuple en cours et rentre dans la file : avec l'attente courte,
 * la file ne se vide qu'une fois les 3 rejeux épuisés (CI : 398 `40P01`, 99 `RETRY`). Une victime
 * qui revient après la vidange voit le hold gagnant validé et reçoit `23P01` aussitôt. Le facteur 2
 * couvre un rythme jusqu'à deux fois plus lent que `deadlock_timeout` ; la gigue étale les retours.
 */
export function cascadeBackoff(degree: number, deadlockTimeoutMs: number): ReplayBackoff {
  if (!Number.isInteger(degree) || degree < 1 || !(deadlockTimeoutMs > 0)) {
    throw new RangeError(`cascadeBackoff : degré ${degree}, deadlock_timeout ${deadlockTimeoutMs}`);
  }
  const base = 2 * degree * deadlockTimeoutMs;
  return () => base + randomInt(0, Math.max(1, Math.floor(base / 2)));
}

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
 * `MAX_REPLAYS` fois, après une attente (`backoff`, par défaut aléatoire courte). Toute autre
 * erreur est finale. Le plafond de rejeux ne dépend pas de l'attente.
 */
export async function withReplay<T>(
  fn: () => Promise<T>,
  backoff: ReplayBackoff = SHORT_BACKOFF,
): Promise<Replayed<T>> {
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
      await sleep(backoff(attempt + 1));
    }
  }
}
