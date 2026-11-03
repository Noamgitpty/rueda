-- Amorçage de l'instance et de la base (US-005 ; 17 §2.3 « Rôles SQL », ADR-035, ADR-043).
--
-- Exécuté par un rôle d'administration (superutilisateur local, utilisateur du conteneur en CI,
-- rôle de provisionnement en production), DANS la base cible, AVANT les migrations appliquées
-- sous `migrator`. Il n'est pas suivi dans `platform.schema_migration` : il est rejoué à chaque
-- série de tests et à chaque déploiement, donc il doit rester IDEMPOTENT.
--
-- Les rôles PostgreSQL sont globaux à l'instance : on les crée s'ils manquent, puis on
-- RÉIMPOSE leurs attributs à chaque passage (un rôle préexistant devenu SUPERUSER ou BYPASSRLS
-- est corrigé). Aucun mot de passe ici : le harnais (ou le gestionnaire de secrets) les pose.
--
-- Retour arrière : rôles partagés par toutes les bases de l'instance, jamais supprimés par
-- l'amorçage. Suppression manuelle seulement, une fois toutes les bases qui les utilisent
-- supprimées (`DROP OWNED BY … ; DROP ROLE …` dans chaque base).

-- 1. Rôles (instance) --------------------------------------------------------------------------
DO $bootstrap$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      -- propriétaire des tables, utilisé seulement par les migrations (17 §2.3, B9)
      ('migrator',            true),
      -- rôles d'exécution de l'application (L0-05)
      ('app_api',             true),
      ('app_worker',          true),
      ('app_anon',            true),
      -- un propriétaire NOLOGIN par famille de fonctions SECURITY DEFINER (VERIF_17-B6, ADR-035)
      ('guard_owner',         false),
      ('catalog_probe_owner', false),
      ('policy_fn_owner',     false),
      ('cmd_hold_owner',      false)
    ) AS t(role_name, can_login)
  LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I', r.role_name);
    EXCEPTION
      -- déjà créé (par une série précédente ou concurrente) : on réimpose les attributs
      WHEN duplicate_object OR unique_violation THEN NULL;
    END;
    EXECUTE format(
      'ALTER ROLE %I %s NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
      r.role_name,
      CASE WHEN r.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END
    );
    IF NOT r.can_login THEN
      -- un propriétaire NOLOGIN n'a jamais de mot de passe
      EXECUTE format('ALTER ROLE %I PASSWORD NULL', r.role_name);
    END IF;
  END LOOP;

  -- Fail-closed : aucune appartenance à un autre rôle pour ces rôles, et aucun membre.
  -- (On refuse au lieu de révoquer : une appartenance inattendue est une anomalie à examiner.)
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles grp ON grp.oid = m.roleid
    JOIN pg_catalog.pg_roles mem ON mem.oid = m.member
    WHERE grp.rolname IN ('migrator', 'app_api', 'app_worker', 'app_anon', 'guard_owner',
                          'catalog_probe_owner', 'policy_fn_owner', 'cmd_hold_owner')
       OR mem.rolname IN ('migrator', 'app_api', 'app_worker', 'app_anon', 'guard_owner',
                          'catalog_probe_owner', 'policy_fn_owner', 'cmd_hold_owner')
  ) THEN
    RAISE EXCEPTION 'rueda bootstrap: unexpected role membership on an application role'
      USING HINT = 'Inspect pg_auth_members; application roles must have no members and no memberships.';
  END IF;
END
$bootstrap$;

-- 2. Base courante -----------------------------------------------------------------------------
-- Droits sur la base : connexion pour les rôles applicatifs, création de schémas pour migrator.
DO $database$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO migrator', pg_catalog.current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_api, app_worker, app_anon',
                 pg_catalog.current_database());
END
$database$;

-- Personne ne crée d'objet dans `public` (17 §2.3, fonction de garde).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Exclusion GiST sur (uuid, tstzrange) : nécessaire dès US-006 (17 §11 L0-01).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
