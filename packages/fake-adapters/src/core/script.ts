/**
 * Scénario d'un FAKE (US-020) : pour chaque opération, une file d'étapes consommées dans l'ordre,
 * puis une étape par défaut (`OK`, ou celle posée par `setDefault` pour une panne prolongée).
 * Tout cas difficile est donc scriptable par le test, sans hasard.
 */
export type Step<R extends string = string> =
  /** Réussite immédiate. */
  | { readonly kind: 'OK' }
  /** Réussite après un délai simulé (l'horloge virtuelle avance de `ms`). */
  | { readonly kind: 'DELAY'; readonly ms: number }
  /** Panne franche : rien n'est fait. */
  | { readonly kind: 'UNAVAILABLE' }
  /** Délai dépassé avant traitement : rien n'est fait, l'appelant voit `TIMEOUT`. */
  | { readonly kind: 'TIMEOUT_BEFORE' }
  /** Délai dépassé après traitement : l'effet a eu lieu, l'appelant voit `TIMEOUT`. */
  | { readonly kind: 'TIMEOUT_AFTER' }
  /** Refus métier du fournisseur. */
  | { readonly kind: 'REFUSE'; readonly reason: R }
  /** Doublon : l'effet de bord (message, rappel, accusé) est produit deux fois. */
  | { readonly kind: 'DUPLICATE' };

export const OK: Step<never> = { kind: 'OK' };

export class Script<Op extends string, R extends string = string> {
  readonly #queues = new Map<Op, Step<R>[]>();
  readonly #defaults = new Map<Op, Step<R>>();
  readonly #calls = new Map<Op, number>();

  /** Ajoute des étapes à la file de `op` (consommées une par appel). */
  script(op: Op, ...steps: readonly Step<R>[]): this {
    for (const step of steps) {
      if (step.kind === 'DELAY' && (!Number.isFinite(step.ms) || step.ms < 0)) {
        throw new RangeError('Script : délai négatif ou invalide');
      }
    }
    const queue = this.#queues.get(op) ?? [];
    queue.push(...steps);
    this.#queues.set(op, queue);
    return this;
  }

  /** Étape rendue quand la file est vide (ex. `UNAVAILABLE` : panne prolongée). */
  setDefault(op: Op, step: Step<R>): this {
    this.#defaults.set(op, step);
    return this;
  }

  /** Étape suivante de `op` ; compte l'appel. */
  next(op: Op): Step<R> {
    this.#calls.set(op, (this.#calls.get(op) ?? 0) + 1);
    return this.#queues.get(op)?.shift() ?? this.#defaults.get(op) ?? OK;
  }

  /** Nombre d'appels reçus par `op` (preuve qu'un appelant n'a pas rejoué, par exemple). */
  calls(op: Op): number {
    return this.#calls.get(op) ?? 0;
  }

  /** Étapes restant à consommer pour `op` (un test peut vérifier que tout a été joué). */
  pending(op: Op): number {
    return this.#queues.get(op)?.length ?? 0;
  }
}
