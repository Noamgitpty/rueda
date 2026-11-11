/**
 * Contexte de session `app.*` d'un membre du staff (17 §2.3 ; US-011, ADR-053, ADR-062) pour les
 * commandes de la console qui le lisent (commandes FINANCE à deux personnes de 0036, appelées par
 * le cadre des actions de console d'US-101). Mêmes sept paramètres, dans le même ordre, que
 * `setSessionContext` de `@rueda/db` : tous écrits, valeurs liées, jamais concaténées.
 *
 * Le contexte ne fait que RÉDUIRE ce que la base relit elle-même : l'acteur est toujours celui de
 * la session désignée par l'empreinte du jeton (preuve de possession), et les rôles et la portée
 * pays sont relus dans `staff_role_assignment`. L'empreinte est une donnée [C4] : jamais journalisée.
 */
import type { StaffPrincipal } from '../../iam/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** Ce que la console transmet à la base : la session (preuve), l'acteur et la portée de ses rôles. */
export interface StaffActor {
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly countries: readonly string[];
}

export function staffActorOf(principal: StaffPrincipal): StaffActor {
  const countries = [...new Set(principal.roles.flatMap((r) => r.countries))]
    .filter((c) => COUNTRY.test(c))
    .sort();
  return { userId: principal.userId, tokenHash: principal.tokenHash, countries };
}

/** Pose des sept paramètres (`set_config(…, true)` = SET LOCAL). Paramètres $1 à $3. */
export const STAFF_CONTEXT_SELECT = `SELECT pg_catalog.set_config('app.actor_kind', 'STAFF', true) AS kind,
       pg_catalog.set_config('app.actor_id', $1, true) AS actor,
       pg_catalog.set_config('app.org_id', '', true) AS org,
       pg_catalog.set_config('app.vehicle_scope', '', true) AS vehicles,
       pg_catalog.set_config('app.country_scope', $2, true) AS countries,
       pg_catalog.set_config('app.worker_name', '', true) AS worker,
       pg_catalog.set_config('app.session_token_hash', $3, true) AS token`;

/**
 * CTE matérialisée qui pose le contexte STAFF pour l'instruction (local à la transaction implicite
 * de l'instruction : ADR-056 point 4, ADR-063 point 7). La commande est appelée en `LATERAL` sur
 * une colonne de `ctx` (`ctx.kind`) : elle ne peut s'exécuter qu'APRÈS la pose du contexte.
 */
export const STAFF_CONTEXT_CTE = `ctx AS MATERIALIZED (${STAFF_CONTEXT_SELECT})`;

/** Valeurs de $1 à $3. Un acteur mal formé pose un contexte vide (la base refuse : fail-closed). */
export function staffContextValues(actor: StaffActor): [string, string, string] {
  const id = actor.userId.toLowerCase();
  return [
    UUID.test(id) ? id : '',
    actor.countries.length > 0 ? `{${actor.countries.join(',')}}` : '',
    actor.tokenHash.length === 32 ? actor.tokenHash.toString('hex') : '',
  ];
}
