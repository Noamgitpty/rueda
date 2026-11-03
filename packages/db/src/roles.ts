/**
 * Rôles PostgreSQL de production (17 §2.3 « Rôles SQL », ADR-035). Source unique côté
 * TypeScript ; la création est dans `bootstrap/0000_instance_roles.sql`.
 */

/** Propriétaire des tables, utilisé seulement par les migrations. */
export const MIGRATOR_ROLE = 'migrator';

/** Rôles d'exécution de l'application : les seuls sous lesquels un test peut tourner (L0-05). */
export const APP_ROLES = ['app_api', 'app_worker', 'app_anon'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * Propriétaires `NOLOGIN` des familles de fonctions `SECURITY DEFINER` (VERIF_17-B6 ; ADR-053).
 * Chacun est accordé à `migrator` avec `INHERIT FALSE, SET TRUE` (amorçage, amendement
 * d'ADR-044) : `migrator` peut leur céder une fonction sans hériter de leurs droits.
 */
export const OWNER_ROLES = [
  'guard_owner',
  'catalog_probe_owner',
  'policy_fn_owner',
  'cmd_hold_owner',
  'iam_auth_owner',
  'integrity_owner',
  'cmd_money_owner',
  'cmd_golive_owner',
] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

/** Rôles qui se connectent (et reçoivent un mot de passe). */
export const LOGIN_ROLES = [MIGRATOR_ROLE, ...APP_ROLES] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

/** Tous les rôles gérés par le projet. */
export const MANAGED_ROLES: readonly string[] = [...LOGIN_ROLES, ...OWNER_ROLES];

export function isAppRole(name: string): name is AppRole {
  return (APP_ROLES as readonly string[]).includes(name);
}
