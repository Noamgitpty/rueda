/**
 * Limitation de débit à fenêtre fixe, en mémoire du processus (17 §6.6 « Limitation de débit » :
 * connexion par IP et par compte). PROPOSÉ (ADR-052) : suffisant pour une instance d'API ; une
 * limite partagée entre instances (PostgreSQL ou cache) est un reste de la passation US-010.
 *
 * Les clés sont des empreintes (jamais un email ni une IP en clair dans la mémoire du limiteur).
 */
import { createHash } from 'node:crypto';

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, Window>();

  constructor(limit: number, windowMs: number, now: () => number, maxKeys = 100_000) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  static key(...parts: string[]): string {
    return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('base64url');
  }

  /** La limite est atteinte pour cette clé. */
  isBlocked(key: string): boolean {
    const w = this.#current(key);
    return w !== undefined && w.count >= this.#limit;
  }

  /** Compte un événement ; rend `false` s'il dépasse la limite. */
  hit(key: string): boolean {
    const now = this.#now();
    let w = this.#current(key);
    if (w === undefined) {
      this.#evict(now);
      w = { count: 0, resetAt: now + this.#windowMs };
      this.#windows.set(key, w);
    }
    w.count += 1;
    return w.count <= this.#limit;
  }

  reset(key: string): void {
    this.#windows.delete(key);
  }

  #current(key: string): Window | undefined {
    const w = this.#windows.get(key);
    if (w !== undefined && w.resetAt <= this.#now()) {
      this.#windows.delete(key);
      return undefined;
    }
    return w;
  }

  #evict(now: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    for (const [k, w] of this.#windows) if (w.resetAt <= now) this.#windows.delete(k);
    // toujours plein : on retire les plus anciennes (ordre d'insertion de Map)
    for (const k of this.#windows.keys()) {
      if (this.#windows.size < this.#maxKeys) break;
      this.#windows.delete(k);
    }
  }
}
