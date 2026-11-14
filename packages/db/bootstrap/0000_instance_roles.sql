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
                           'risk_limit_owner', 'catalog_cmd_owner', 'kyc_cmd_owner',
                           'privacy_cmd_owner'];
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
      ('risk_limit_owner',    false),
      -- US-115 (ADR-099) : lieux, véhicules et annonces de l'hôte (core.catalog_cmd_*)
      ('catalog_cmd_owner',   false),
      -- US-105 (ADR-102) : vérification d'identité et consentement biométrique (core.kyc_cmd_*)
      ('kyc_cmd_owner',       false),
      -- US-111 (ADR-118) : registre Ley 81, demandes des personnes, rétention (core.audit_*privacy*)
      ('privacy_cmd_owner',   false)
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

-- 3. Fonctions de pg_catalog exécutables par PUBLIC à effet de bord (US-049, F-RLS-04) ----------
-- PostgreSQL accorde EXECUTE à PUBLIC sur quelques fonctions qui écrivent hors de la RLS ou
-- agissent sur d'autres connexions. Aucun rôle applicatif (app_api, app_worker, app_anon) ni
-- propriétaire NOLOGIN n'en a l'usage ; du SQL arbitraire sous un rôle applicatif pourrait :
--   - pg_logical_emit_message : écrire dans le journal de transactions (bruit, volume de WAL) ;
--   - lo_creat, lo_create, lo_from_bytea : créer des grands objets, stockés hors de toute table et
--     de toute RLS (stockage dissimulé, remplissage du disque) ; lo_import et lo_export (fichiers
--     du serveur) sont déjà réservés au superutilisateur, ils sont listés par sûreté ;
--   - pg_cancel_backend, pg_terminate_backend : annuler ou couper les AUTRES connexions du même
--     rôle (déni de service de l'API ou du travailleur) ;
--   - pg_notify : notifications sur un canal quelconque (aucun code n'écoute ni n'émet ; revue
--     sécurité US-049). Les verrous consultatifs (pg_advisory_*) et set_config restent
--     exécutables : l'application s'en sert (commandes de réservation, file du bus, contexte).
-- Liste unique : packages/db/src/catalog-functions.ts (test catalog-functions.test.ts) ; le job
-- de déploiement la sonde sous app_api et échoue si une fonction reste exécutable (US-049).
-- Les ACL des fonctions sont propres à chaque base : l'amorçage, rejoué dans chaque base, les
-- retire de PUBLIC par nom (toutes les signatures, quelle que soit la version de PostgreSQL).
-- Idempotent. Un rôle d'administration qui n'est pas propriétaire de ces fonctions (service géré)
-- ne peut pas les retirer : PostgreSQL n'émet alors qu'un avertissement, et le contrôle ci-dessous
-- le signale ; la preuve est l0-us049-rls-fixes (base de test et base de production du banc).
DO $pg_catalog_functions$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'pg_catalog'
       AND p.proname IN ('pg_logical_emit_message', 'lo_creat', 'lo_create', 'lo_from_bytea',
                         'lo_import', 'lo_export', 'pg_cancel_backend', 'pg_terminate_backend',
                         'pg_notify')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    IF pg_catalog.has_function_privilege('app_anon', r.sig::oid, 'EXECUTE') THEN
      RAISE WARNING 'rueda bootstrap: EXECUTE on % still granted to PUBLIC (not revocable by this role)', r.sig;
    END IF;
  END LOOP;
END
$pg_catalog_functions$;
