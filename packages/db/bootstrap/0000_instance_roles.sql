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
  v_owner text;
  -- propriétaires NOLOGIN des familles SECURITY DEFINER (doit égaler OWNER_ROLES de src/roles.ts)
  v_owners text[] := ARRAY['guard_owner', 'catalog_probe_owner', 'policy_fn_owner', 'cmd_hold_owner',
                           'iam_auth_owner', 'integrity_owner', 'audit_chain_owner', 'cmd_money_owner',
                           'cmd_golive_owner', 'iam_staff_owner', 'host_view_owner',
                           'risk_limit_owner'];
  v_managed text[] := ARRAY['migrator', 'app_api', 'app_worker', 'app_anon'] || v_owners;
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
      ('cmd_hold_owner',      false),
      -- US-011 (ADR-053, amendement d'ADR-044) : familles existantes ou annoncées par 17 §2.3
      ('iam_auth_owner',      false),   -- commandes d'authentification core.iam_* (US-010)
      ('integrity_owner',     false),   -- fonctions de trigger d'intégrité AVL (ADR-048)
      ('audit_chain_owner',   false),   -- trigger de chaîne du journal d'audit (ADR-051)
      ('cmd_money_owner',     false),   -- commandes d'argent par jambe (US-062 et suivantes)
      ('cmd_golive_owner',    false),   -- interrupteurs de mise en service (US-125)
      -- US-012 (ADR-062) : MFA du staff et commandes de la console interne
      ('iam_staff_owner',     false),
      -- US-062 (ADR-064) : vues minimisées de l'hôte (host_guest_v)
      ('host_view_owner',     false),
      -- US-052 (ADR-075) : compteurs de débit et journal des abus (core.risk_cmd_*)
      ('risk_limit_owner',    false)
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

  -- Appartenances (ADR-044 amendé par US-011, ADR-053). Une seule forme est admise : un
  -- propriétaire NOLOGIN accordé à `migrator` avec INHERIT FALSE, SET TRUE, ADMIN FALSE
  -- (PostgreSQL 16). `migrator` peut ainsi faire `ALTER FUNCTION … OWNER TO <propriétaire>`
  -- (il doit pouvoir SET ROLE vers le nouveau propriétaire) SANS hériter d'aucun de ses droits ;
  -- le propriétaire, lui, n'hérite de rien de `migrator`. Toute autre appartenance qui touche un
  -- rôle géré est une anomalie : on refuse au lieu de révoquer, pour qu'elle soit examinée.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles grp ON grp.oid = m.roleid
    JOIN pg_catalog.pg_roles mem ON mem.oid = m.member
    WHERE (grp.rolname = ANY (v_managed) OR mem.rolname = ANY (v_managed))
      AND NOT (grp.rolname = ANY (v_owners) AND mem.rolname = 'migrator')
  ) THEN
    RAISE EXCEPTION 'rueda bootstrap: unexpected role membership on an application role'
      USING HINT = 'Inspect pg_auth_members; only <owner> TO migrator (INHERIT FALSE, SET TRUE) is allowed.';
  END IF;

  FOREACH v_owner IN ARRAY v_owners LOOP
    -- idempotent : un nouvel octroi par le même concédant réimpose les options (PostgreSQL 16)
    EXECUTE format('GRANT %I TO migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', v_owner);
  END LOOP;

  -- Contrôle final : chaque propriétaire est accordé à migrator, et AUCUNE ligne d'appartenance
  -- (quel qu'en soit le concédant) ne donne ADMIN ou INHERIT, ni ne retire SET.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles grp ON grp.oid = m.roleid
    JOIN pg_catalog.pg_roles mem ON mem.oid = m.member
    WHERE grp.rolname = ANY (v_owners) AND mem.rolname = 'migrator'
      AND (m.admin_option OR m.inherit_option OR NOT m.set_option)
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_owners) AS o(name)
    WHERE NOT pg_catalog.pg_has_role('migrator', o.name, 'SET')
       OR pg_catalog.pg_has_role('migrator', o.name, 'USAGE')
  ) THEN
    RAISE EXCEPTION 'rueda bootstrap: owner role grant to migrator must be INHERIT FALSE, SET TRUE, ADMIN FALSE';
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
