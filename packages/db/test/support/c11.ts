/**
 * Aides PURES du fuzz d'entrelacements C11 (US-025, ADR-068), sans base de données : générateur
 * pseudo-aléatoire à graine, configuration (mode court par défaut, mode long explicite), graines
 * dérivées par exécution et format de rejeu. Testées par `c11.test.ts` (`pnpm test:unit`).
 *
 * Déterminisme : une exécution est entièrement décrite par sa graine, À L'ORDRE D'ACHÈVEMENT DES
 * COURSES PRÈS (actions lancées en même temps sur des connexions distinctes). Cet ordre est
 * consigné ; le rejeu d'une graine avec son ordre (`RUEDA_C11_REPLAY`) exécute les courses en série
 * dans cet ordre, ce qui reproduit l'entrelacement observé : les commandes se sérialisent sur les
 * verrous voyageur → véhicule (17 §2.5), donc l'ordre de fin est l'ordre de validation.
 */

/** mulberry32 : 32 bits d'état, période 2^32, sortie dans [0, 1). */
export class Rng {
  #state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError(`graine 32 bits attendue : ${String(seed)}`);
    }
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Entier dans [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`n ≥ 1 attendu : ${String(n)}`);
    return Math.floor(this.next() * n);
  }

  /** Entier dans [lo, hi]. */
  between(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('choix dans une liste vide');
    return items[this.int(items.length)] as T;
  }

  /** Choix pondéré : `weights[i]` ≥ 0, somme > 0. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (!(total > 0)) throw new RangeError('poids nuls');
    let x = this.next() * total;
    for (const [k, w] of entries) {
      x -= w;
      if (x < 0) return k;
    }
    return (entries.at(-1) as [K, number])[0];
  }
}

/** Graine de l'exécution `i` d'une série de graine `base` (dispersion de Knuth, 32 bits). */
export const runSeed = (base: number, i: number): number =>
  (Math.imul(i + 1, 0x9e37_79b1) ^ base) >>> 0;

/** Ordre d'achèvement observé de chaque course : numéro d'étape → indices des actions. */
export type RaceOrders = Readonly<Record<number, readonly number[]>>;

export interface Replay {
  readonly seed: number;
  readonly orders?: RaceOrders;
}

/** `<graine>` ou `<graine>:<étape>=<i>,<j>…;<étape>=…` (ordre d'achèvement de chaque course). */
export function formatReplay(seed: number, orders: RaceOrders): string {
  const parts = Object.entries(orders)
    .map(([step, order]) => [Number(step), order] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([step, order]) => `${String(step)}=${order.join(',')}`);
  return parts.length === 0 ? String(seed) : `${String(seed)}:${parts.join(';')}`;
}

export function parseReplay(text: string): Replay {
  const m = /^([0-9]{1,10})(?::(.*))?$/.exec(text.trim());
  if (m === null) throw new RangeError(`RUEDA_C11_REPLAY illisible : ${text}`);
  const seed = Number(m[1]);
  if (seed > 0xffff_ffff) throw new RangeError(`graine hors de 32 bits : ${text}`);
  if (m[2] === undefined || m[2] === '') return { seed };
  const orders: Record<number, number[]> = {};
  for (const part of m[2].split(';')) {
    const p = /^([0-9]+)=([0-9]+(?:,[0-9]+)*)$/.exec(part);
    if (p === null) throw new RangeError(`course illisible : ${part}`);
    const order = (p[2] as string).split(',').map(Number);
    if (new Set(order).size !== order.length) throw new RangeError(`ordre en double : ${part}`);
    orders[Number(p[1])] = order;
  }
  return { seed, orders };
}

/** Mode court (CI, chaque fusion) : 1 000 exécutions (17 §2.5 C11, 19 US-025). */
export const C11_CI_RUNS = 1000;
/** Mode long (nuit) : au moins 10 000 exécutions. */
export const C11_NIGHTLY_RUNS = 10_000;
/** Graine de base consignée du mode court (CI reproductible d'une PR à l'autre). */
export const C11_DEFAULT_SEED = 20_251_103;

export interface C11Config {
  readonly runs: number;
  readonly seed: number;
  /** Rejeu d'une seule exécution (graine et ordre des courses), sinon `undefined`. */
  readonly replay?: Replay;
  /** Fichier où consigner les graines d'échec (artefact de la nuit), sinon rien. */
  readonly failuresFile?: string;
}

/**
 * Lit la configuration dans l'environnement :
 * - `RUEDA_C11_RUNS` (défaut 1 000 = mode court ; `nightly` = 10 000 = mode long) ;
 * - `RUEDA_C11_SEED` (défaut `C11_DEFAULT_SEED`) ;
 * - `RUEDA_C11_REPLAY` (`<graine>[:<ordre>]`, une seule exécution) ;
 * - `RUEDA_C11_FAILURES` (chemin du fichier des graines d'échec).
 */
export function c11Config(env: Readonly<Record<string, string | undefined>>): C11Config {
  const runsText = env.RUEDA_C11_RUNS;
  const runs =
    runsText === undefined || runsText === ''
      ? C11_CI_RUNS
      : runsText === 'nightly'
        ? C11_NIGHTLY_RUNS
        : Number(runsText);
  if (!Number.isInteger(runs) || runs < 1 || runs > 1_000_000) {
    throw new RangeError(`RUEDA_C11_RUNS invalide : ${String(runsText)}`);
  }
  const seedText = env.RUEDA_C11_SEED;
  const seed = seedText === undefined || seedText === '' ? C11_DEFAULT_SEED : Number(seedText);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError(`RUEDA_C11_SEED invalide : ${String(seedText)}`);
  }
  const replayText = env.RUEDA_C11_REPLAY;
  const replay =
    replayText === undefined || replayText === '' ? undefined : parseReplay(replayText);
  const failuresFile = env.RUEDA_C11_FAILURES;
  return {
    runs: replay === undefined ? runs : 1,
    seed,
    ...(replay !== undefined ? { replay } : {}),
    ...(failuresFile !== undefined && failuresFile !== '' ? { failuresFile } : {}),
  };
}
