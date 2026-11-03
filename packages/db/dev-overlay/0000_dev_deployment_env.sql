-- Surcouche de DÉVELOPPEMENT LOCAL (US-035, ADR-070) : appliquée seulement par
-- `packages/db/src/dev/setup.ts` (pile `compose.yaml`), sous `migrator`, APRÈS les migrations de
-- production. JAMAIS appliquée en production ni en préproduction : le pipeline de déploiement
-- (US-003) n'applique que `migrations/`, et `setup.ts` refuse de tourner hors `RUEDA_ENV=development`.
--
-- Non suivie dans `platform.schema_migration` (comme l'amorçage) : rejouée à chaque passage,
-- donc idempotente (CREATE OR REPLACE). Elle n'ajoute aucun droit, aucune politique, aucune donnée.
--
-- platform.deployment_env() : « production » par défaut (0028, fail-closed). La base de
-- développement déclare « development », sinon l'API lancée avec RUEDA_ENV=development refuse de
-- démarrer (garde C19 : application et base discordantes). Une base de production garde 0028.
--
-- Retour arrière : réappliquer la définition de 0028 (SELECT 'production'::text).

CREATE OR REPLACE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 'development'::text
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'VERSION DE DÉVELOPPEMENT LOCAL (dev-overlay/0000, US-035) : development. Jamais en production.';
