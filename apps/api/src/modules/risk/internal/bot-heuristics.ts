/**
 * Heuristiques anti-robot de la bêta (US-052, critère 4 ; PROPOSÉ, ADR-075). Trois signaux :
 *
 * - `NO_BROWSER_HEADERS` : requête sans `User-Agent`, sans `Accept` ou sans `Accept-Language`
 *   (un navigateur, donc la PWA, envoie toujours les trois) ;
 * - `REGULAR_RHYTHM` : au moins `RHYTHM_MIN_INTERVALS` intervalles successifs d'une même IP dont
 *   le coefficient de variation est sous `RHYTHM_MAX_CV` (un humain n'est pas métronomique) ;
 *   suivi en mémoire du processus, borné (un signal, pas une preuve) ;
 * - `SIGNUP_BURST` : inscriptions en rafale d'une même IP au-delà de
 *   `rate_limit_signup_burst_per_ip_10min` (compteur partagé, posé par le garde).
 *
 * Décision : aucun signal ⇒ rien ; un seul signal faible ⇒ client RALENTI (chaque requête compte
 * `rate_limit_bot_weight` fois) ; `SIGNUP_BURST` ou deux signaux ⇒ DÉFI anti-robot exigé.
 */
import type { BotSignal } from './counter-store.js';

export const RHYTHM_MIN_INTERVALS = 8;
export const RHYTHM_MAX_CV = 0.1;

export type BotDecision = 'NONE' | 'SLOW' | 'CHALLENGE';

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

function present(headers: Headers, name: string): boolean {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() !== '';
}

export function lacksBrowserHeaders(headers: Headers): boolean {
  return !['user-agent', 'accept', 'accept-language'].every((h) => present(headers, h));
}

export function decide(signals: readonly BotSignal[]): BotDecision {
  if (signals.length === 0) return 'NONE';
  if (signals.includes('SIGNUP_BURST') || signals.length >= 2) return 'CHALLENGE';
  return 'SLOW';
}

/** Suivi du rythme des requêtes par clé (empreinte d'IP), en mémoire, borné. */
export class RhythmTracker {
  readonly #maxKeys: number;
  readonly #arrivals = new Map<string, number[]>();

  constructor(maxKeys = 50_000) {
    this.#maxKeys = maxKeys;
  }

  /** Enregistre une arrivée (ms) ; rend `true` si le rythme récent est régulier. */
  record(key: string, atMs: number): boolean {
    let list = this.#arrivals.get(key);
    if (list === undefined) {
      if (this.#arrivals.size >= this.#maxKeys) {
        const oldest = this.#arrivals.keys().next().value;
        if (oldest !== undefined) this.#arrivals.delete(oldest);
      }
      list = [];
    } else {
      this.#arrivals.delete(key); // réinsérée en fin : ordre d'usage récent
    }
    list.push(atMs);
    if (list.length > RHYTHM_MIN_INTERVALS + 1) list.shift();
    this.#arrivals.set(key, list);
    return isRegular(list);
  }
}

/** Intervalles réguliers : coefficient de variation < RHYTHM_MAX_CV sur assez d'intervalles. */
export function isRegular(arrivals: readonly number[]): boolean {
  if (arrivals.length < RHYTHM_MIN_INTERVALS + 1) return false;
  const gaps: number[] = [];
  for (let i = 1; i < arrivals.length; i += 1) {
    gaps.push((arrivals[i] ?? 0) - (arrivals[i - 1] ?? 0));
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return false;
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean < RHYTHM_MAX_CV;
}
