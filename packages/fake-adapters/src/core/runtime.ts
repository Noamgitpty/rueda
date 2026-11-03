/**
 * Moteur commun des FAKE d'US-020 : scénario, horloge virtuelle, identifiants séquentiels et
 * idempotence. Chaque FAKE délègue ses opérations à `FakeRuntime.execute`, si bien que tous les
 * ports simulent les mêmes cas difficiles de la même façon (ADR-058) :
 *
 * | étape            | effet de bord | réponse                                   |
 * |------------------|---------------|-------------------------------------------|
 * | `OK`             | une fois      | `OK`                                      |
 * | `DELAY`          | une fois      | `OK`, horloge avancée                     |
 * | `UNAVAILABLE`    | aucun         | `UNAVAILABLE`                             |
 * | `TIMEOUT_BEFORE` | aucun         | `TIMEOUT`                                 |
 * | `TIMEOUT_AFTER`  | une fois      | `TIMEOUT` (rejouer la clé rend `OK`)      |
 * | `REFUSE`         | aucun         | `REFUSED` avec le motif scripté           |
 * | `DUPLICATE`      | **deux fois** | `OK` (le consommateur doit dédoublonner)  |
 *
 * Idempotence : même clé et même contenu ⇒ même réponse, `replayed = true`, aucun nouvel effet ;
 * même clé et contenu différent ⇒ `REFUSED IDEMPOTENCY_CONFLICT`. Les pannes (`UNAVAILABLE`,
 * `TIMEOUT_BEFORE`) passent avant l'idempotence : un fournisseur en panne ne répond pas, même à
 * un rejeu. Les refus ne sont pas mémorisés (un rejeu après refus est rejoué).
 *
 * Rejeu d'une clé connue (revue code US-020, constat 4) : il passe **avant** une étape `REFUSE`
 * (l'étape est consommée sans effet, la réponse mémorisée est rendue) ; sous `TIMEOUT_AFTER`, il
 * rend `TIMEOUT` bien que le résultat soit connu (le scénario décrit le fournisseur, pas le cache).
 */
import { createHash } from 'node:crypto';
import { FakeClock } from './clock.ts';
import type { Outcome } from './outcome.ts';
import { Script } from './script.ts';

/** Empreinte stable d'une requête (clés triées ; `bigint`, `Date` et octets normalisés). */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return `n:${value.toString()}`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (value instanceof Uint8Array) return `b:${createHash('sha256').update(value).digest('hex')}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  throw new TypeError(`fingerprint : type non pris en charge (${typeof value})`);
}

/** Identifiants déterministes : `<préfixe>_000001`, `<préfixe>_000002`… */
export class Sequence {
  #n = 0;
  readonly prefix: string;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  next(): string {
    this.#n += 1;
    return `${this.prefix}_${String(this.#n).padStart(6, '0')}`;
  }
}

/** Résultat de l'effet métier d'une opération : valeur, ou refus décidé par le FAKE lui-même. */
export type Performed<T, R extends string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: R };

export interface ExecuteRequest {
  /** Absente pour une lecture : pas d'idempotence, une lecture est rejouable par nature. */
  readonly idempotencyKey?: string | undefined;
  /** Contenu comparé pour l'idempotence (voir `fingerprint`). */
  readonly content: unknown;
}

export class FakeRuntime<Op extends string, R extends string = string> {
  readonly clock: FakeClock;
  readonly script = new Script<Op, R>();
  readonly #memory = new Map<string, { readonly fingerprint: string; readonly value: unknown }>();

  constructor(clock: FakeClock) {
    this.clock = clock;
  }

  /**
   * Joue l'étape suivante de `op`. `perform(times)` réalise l'effet métier ; `times` vaut 2 pour
   * un doublon (le FAKE produit alors son effet de bord deux fois).
   */
  async execute<T, PR extends R>(
    op: Op,
    request: ExecuteRequest,
    perform: (times: 1 | 2) => Performed<T, PR>,
  ): Promise<Outcome<T, PR>> {
    const step = this.script.next(op);
    if (step.kind === 'UNAVAILABLE') return { status: 'UNAVAILABLE' };
    if (step.kind === 'TIMEOUT_BEFORE') return { status: 'TIMEOUT' };
    if (step.kind === 'DELAY') await this.clock.sleep(step.ms);

    const key = request.idempotencyKey;
    const print = fingerprint(request.content);
    const memoryKey = key === undefined ? undefined : `${op}\u0000${key}`;
    if (memoryKey !== undefined) {
      const known = this.#memory.get(memoryKey);
      if (known !== undefined) {
        if (known.fingerprint !== print) {
          return { status: 'REFUSED', reason: 'IDEMPOTENCY_CONFLICT' };
        }
        if (step.kind === 'TIMEOUT_AFTER') return { status: 'TIMEOUT' };
        return { status: 'OK', value: known.value as T, replayed: true };
      }
    }
    if (step.kind === 'REFUSE') return { status: 'REFUSED', reason: step.reason as PR };

    const done = perform(step.kind === 'DUPLICATE' ? 2 : 1);
    if (!done.ok) return { status: 'REFUSED', reason: done.reason };
    if (memoryKey !== undefined)
      this.#memory.set(memoryKey, { fingerprint: print, value: done.value });
    if (step.kind === 'TIMEOUT_AFTER') return { status: 'TIMEOUT' };
    return { status: 'OK', value: done.value, replayed: false };
  }
}
