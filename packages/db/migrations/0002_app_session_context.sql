-- 0002 — schéma transverse `app` : lecture du contexte de session posé par la couche d'accès.
-- US-006 ; 17 §2.3 « Contexte de session » ; ADR-035. Appliquée sous `migrator`.
--
-- Sous-ensemble minimal nécessaire aux politiques des travailleurs (US-006) : `app.actor_kind()`
-- et `app.worker_name()`. US-011 ajoute `app.actor_id()`, `app.org_id()`, `app.vehicle_scope()`,
-- `app.country_scope()` et les fonctions de politique, avec la même règle :
-- paramètre absent, vide ou hors liste ⇒ NULL ⇒ aucune ligne (fail-closed, sans erreur).
--
-- Rappel (17 §2.3, « Limite de la RLS ») : ce contexte est forgeable par qui exécute du SQL
-- arbitraire sous un rôle applicatif ; il protège contre un filtre oublié, pas contre une injection.
--
-- Retour arrière :
--   DROP FUNCTION app.worker_name(); DROP FUNCTION app.actor_kind(); DROP SCHEMA app;

CREATE SCHEMA app;  -- propriétaire : migrator
REVOKE ALL ON SCHEMA app FROM PUBLIC;

-- Type d'acteur de la transaction (17 §2.3) : GUEST, HOST, STAFF ou WORKER ; toute autre valeur ⇒ NULL.
CREATE FUNCTION app.actor_kind()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v.kind IN ('GUEST', 'HOST', 'STAFF', 'WORKER') THEN v.kind
         END
    FROM (SELECT NULLIF(pg_catalog.current_setting('app.actor_kind', true), '') AS kind) AS v
$fn$;

-- Nom du travailleur (17 §2.3 « une politique explicite par travailleur ») ; format snake_case,
-- sinon NULL. La liste des noms admis par table est portée par les politiques (0007).
CREATE FUNCTION app.worker_name()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v.name ~ '^[a-z][a-z0-9_]{0,62}$' THEN v.name
         END
    FROM (SELECT NULLIF(pg_catalog.current_setting('app.worker_name', true), '') AS name) AS v
$fn$;

COMMENT ON FUNCTION app.actor_kind() IS
  'Contexte de session app.actor_kind (17 §2.3) ; absent ou invalide ⇒ NULL (fail-closed). US-006.';
COMMENT ON FUNCTION app.worker_name() IS
  'Contexte de session app.worker_name (17 §2.3) ; absent ou invalide ⇒ NULL (fail-closed). US-006.';

REVOKE ALL ON FUNCTION app.actor_kind(), app.worker_name() FROM PUBLIC;

-- Les politiques sont évaluées sous le rôle qui interroge : il doit pouvoir exécuter ces fonctions.
-- app_anon n'en reçoit pas (il ne lit que des vues publiques, US-011).
GRANT USAGE ON SCHEMA app
  TO app_api, app_worker, guard_owner, catalog_probe_owner, policy_fn_owner, cmd_hold_owner;
GRANT EXECUTE ON FUNCTION app.actor_kind(), app.worker_name()
  TO app_api, app_worker, guard_owner, catalog_probe_owner, policy_fn_owner, cmd_hold_owner;
