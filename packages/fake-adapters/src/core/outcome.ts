/**
 * Issue d'un appel à un port (US-020 ; ADR-057). Les ports d'US-020 rendent leurs échecs comme des
 * **valeurs**, jamais comme des classes d'exception : un FAKE de ce paquet (feuille, sans
 * dépendance de l'espace de travail) se conforme ainsi au port par le seul typage structurel, et
 * le test de conformance du module propriétaire le vérifie à la compilation.
 *
 * - `OK` : `replayed` vaut vrai quand la réponse vient de l'idempotence (même clé, même contenu) ;
 * - `REFUSED` : refus métier du fournisseur (motif fermé par port), refus d'idempotence ou
 *   capacité inconnue (`UNSUPPORTED` : une capacité inconnue vaut « non ») ;
 * - `UNAVAILABLE` : panne franche, rien n'a été fait ;
 * - `TIMEOUT` : issue **inconnue** (l'opération a pu aboutir) : l'appelant rejoue avec la même
 *   clé d'idempotence ou interroge l'état, jamais une nouvelle clé.
 */
export type CommonRefusal = 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED';

export type Outcome<T, R extends string = never> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | CommonRefusal }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

/** Verdict d'un rappel entrant (webhook) : accepté ou rejeté, jamais d'issue inconnue. */
export type WebhookVerdict<E> =
  | { readonly status: 'ACCEPTED'; readonly event: E }
  | { readonly status: 'REJECTED'; readonly reason: 'BAD_SIGNATURE' | 'STALE' | 'MALFORMED' };
