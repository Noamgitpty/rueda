/**
 * Fonctions de `pg_catalog` à effet de bord hors RLS que l'amorçage retire à PUBLIC (US-049,
 * F-RLS-04 ; `bootstrap/0000_instance_roles.sql` § 3, ADR-089). Liste unique : l'amorçage SQL la
 * recopie (test `catalog-functions.test.ts`), le job de déploiement la sonde sous `app_api`
 * (`deploy/setup.ts`) et les preuves L0 l'éprouvent (`l0-us049-rls-fixes`).
 *
 * Gardées exécutables, parce que l'application s'en sert : `pg_advisory_xact_lock` et la famille
 * des verrous consultatifs (commandes de réservation `veh:` / `guest:`, file du bus), `set_config`
 * (contexte `app.*`). `pg_notify` n'est utilisée par aucun code : retirée.
 */
export const SIDE_EFFECT_FUNCTIONS = [
  'pg_logical_emit_message',
  'lo_creat',
  'lo_create',
  'lo_from_bytea',
  'lo_import',
  'lo_export',
  'pg_cancel_backend',
  'pg_terminate_backend',
  'pg_notify',
] as const;

/** Rôles applicatifs sondés (jamais `migrator`, jamais l'administration). */
export const PROBED_ROLES = ['app_api', 'app_worker', 'app_anon'] as const;

/** Sonde : chaque (fonction, rôle) encore exécutable. Vide = conforme. */
export const SIDE_EFFECT_PROBE_SQL = `
  SELECT p.oid::regprocedure::text AS sig, r.role
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   CROSS JOIN pg_catalog.unnest($2::text[]) AS r(role)
   WHERE n.nspname = 'pg_catalog' AND p.proname = ANY ($1::text[])
     AND pg_catalog.has_function_privilege(r.role, p.oid, 'EXECUTE')
   ORDER BY 1, 2`;
