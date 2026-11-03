/**
 * Pose du contexte de session `app.*` (17 §2.3 « Contexte de session », « Limite de la RLS » ;
 * US-011, ADR-053) : LA fonction unique de la couche d'accès qui écrit ce contexte.
 *
 * - Toujours dans une transaction ouverte (`BEGIN` fait par l'appelant) : chaque valeur est posée
 *   par `set_config(nom, valeur, true)`, soit `SET LOCAL`, et disparaît au `COMMIT` / `ROLLBACK`.
 * - Les six paramètres sont TOUJOURS écrits (chaîne vide pour ceux qui ne concernent pas l'acteur) :
 *   un contexte précédent de la même transaction ne laisse aucun reste (par exemple une
 *   `app.org_id` d'hôte sous une session de voyageur).
 * - Valeurs passées en paramètres liés, jamais concaténées dans le SQL ; format validé ici AVANT
 *   l'envoi. Côté base, une valeur mal formée est de toute façon lue comme NULL (fail-closed).
 * - Ce contexte reste forgeable par qui exécute du SQL arbitraire sous un rôle applicatif (RLS-18) :
 *   la RLS protège contre un filtre oublié, pas contre une injection. Les politiques relisent donc
 *   en base ce qui peut l'être (appartenance de l'hôte, rôle et portée pays du staff) : le contexte
 *   ne peut que RÉDUIRE une portée, jamais l'élargir.
 */

/** Types d'acteur de 17 §2.3 (`HOST` couvre le titulaire et ses co-hôtes). */
export const ACTOR_KINDS = ['GUEST', 'HOST', 'STAFF', 'WORKER'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type SessionContext =
  | { readonly kind: 'GUEST'; readonly actorId: string }
  | {
      readonly kind: 'HOST';
      readonly actorId: string;
      /** Compte d'hôte de la session (`organization.id`, mono-pays). */
      readonly orgId: string;
      /** Réduction facultative de la portée (jamais un élargissement : membership fait foi). */
      readonly vehicleScope?: readonly string[];
    }
  | {
      readonly kind: 'STAFF';
      readonly actorId: string;
      /** Portée pays posée (doit être couverte par staff_role_assignment pour avoir un effet). */
      readonly countryScope: readonly string[];
    }
  | { readonly kind: 'WORKER'; readonly workerName: string };

/** Les six paramètres de 17 §2.3, dans l'ordre où ils sont posés. */
export const SESSION_SETTINGS = [
  'app.actor_kind',
  'app.actor_id',
  'app.org_id',
  'app.vehicle_scope',
  'app.country_scope',
  'app.worker_name',
] as const;
export type SessionSetting = (typeof SESSION_SETTINGS)[number];

export class SessionContextError extends Error {
  override readonly name = 'SessionContextError';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Format seulement : la liste des pays fait foi dans config (aucune constante pays ici).
const COUNTRY = /^[A-Z]{2}$/;
const WORKER_NAME = /^[a-z][a-z0-9_]{0,62}$/;

function uuidOf(value: string, field: string): string {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID.test(v)) throw new SessionContextError(`${field} : UUID attendu`);
  return v;
}

function uuidArray(values: readonly string[], field: string): string {
  if (!Array.isArray(values)) throw new SessionContextError(`${field} : tableau attendu`);
  return `{${values.map((v) => uuidOf(v, field)).join(',')}}`;
}

function countryArray(values: readonly string[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    throw new SessionContextError('countryScope : au moins un pays');
  }
  for (const c of values) {
    if (typeof c !== 'string' || !COUNTRY.test(c)) {
      throw new SessionContextError('countryScope : code pays ISO 3166-1 alpha-2 attendu');
    }
  }
  return `{${[...new Set(values)].join(',')}}`;
}

/**
 * Valeurs des six paramètres pour un contexte (pur, testé sans base). Lève
 * `SessionContextError` pour toute valeur mal formée.
 */
export function sessionSettings(ctx: SessionContext): Record<SessionSetting, string> {
  const out: Record<SessionSetting, string> = {
    'app.actor_kind': '',
    'app.actor_id': '',
    'app.org_id': '',
    'app.vehicle_scope': '',
    'app.country_scope': '',
    'app.worker_name': '',
  };
  switch (ctx.kind) {
    case 'GUEST':
      out['app.actor_id'] = uuidOf(ctx.actorId, 'actorId');
      break;
    case 'HOST':
      out['app.actor_id'] = uuidOf(ctx.actorId, 'actorId');
      out['app.org_id'] = uuidOf(ctx.orgId, 'orgId');
      if (ctx.vehicleScope !== undefined) {
        out['app.vehicle_scope'] = uuidArray(ctx.vehicleScope, 'vehicleScope');
      }
      break;
    case 'STAFF':
      out['app.actor_id'] = uuidOf(ctx.actorId, 'actorId');
      out['app.country_scope'] = countryArray(ctx.countryScope);
      break;
    case 'WORKER':
      if (typeof ctx.workerName !== 'string' || !WORKER_NAME.test(ctx.workerName)) {
        throw new SessionContextError('workerName : snake_case attendu');
      }
      out['app.worker_name'] = ctx.workerName;
      break;
    default:
      throw new SessionContextError('type d’acteur inconnu');
  }
  out['app.actor_kind'] = ctx.kind;
  return out;
}

/** Ce dont la pose a besoin d'un client `pg` (ou d'un équivalent). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/** Une seule instruction, six `set_config(…, true)` à paramètres liés. */
export const SET_SESSION_CONTEXT_SQL =
  'SELECT ' +
  SESSION_SETTINGS.map((_, i) => `pg_catalog.set_config($${2 * i + 1}, $${2 * i + 2}, true)`).join(
    ', ',
  );

/**
 * Pose le contexte `app.*` de la transaction courante (`SET LOCAL`). À appeler juste après
 * `BEGIN`, avant toute lecture ou écriture.
 */
export async function setSessionContext(client: Queryable, ctx: SessionContext): Promise<void> {
  const settings = sessionSettings(ctx);
  await client.query(
    SET_SESSION_CONTEXT_SQL,
    SESSION_SETTINGS.flatMap((name) => [name, settings[name]]),
  );
}
