-- 0001 — droits minimaux des rôles de production sur les objets de plateforme.
-- US-005 ; 17 §2.3 « Rôles SQL » ; ADR-035. Appliquée sous `migrator`.
--
-- Les rôles eux-mêmes (globaux à l'instance) sont créés de façon idempotente par
-- packages/db/bootstrap/0000_instance_roles.sql, rejoué avant chaque série de migrations.
-- Ici : uniquement les droits dans la base, accordés par leur propriétaire (migrator).
--
-- Principe : rien n'est accordé à PUBLIC ; chaque rôle reçoit le strict nécessaire, story par
-- story. `app_anon` n'a ici aucun droit : il ne lira que des vues publiques (US-011).
--
-- Retour arrière :
--   REVOKE EXECUTE ON FUNCTION platform.now() FROM app_api, app_worker, guard_owner,
--     catalog_probe_owner, policy_fn_owner, cmd_hold_owner;
--   REVOKE USAGE ON SCHEMA platform FROM app_api, app_worker, guard_owner,
--     catalog_probe_owner, policy_fn_owner, cmd_hold_owner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- Les fonctions futures de migrator ne sont pas exécutables par PUBLIC par défaut :
-- chaque EXECUTE est accordé explicitement (liste blanche RLS-15, US-011).
ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- L'horloge est lue par l'API, les travailleurs et les propriétaires des commandes
-- SECURITY DEFINER (qui calculent expires_at, payment_in_flight_until… dans le SQL, 17 §1.3).
GRANT USAGE ON SCHEMA platform
  TO app_api, app_worker, guard_owner, catalog_probe_owner, policy_fn_owner, cmd_hold_owner;
GRANT EXECUTE ON FUNCTION platform.now()
  TO app_api, app_worker, guard_owner, catalog_probe_owner, policy_fn_owner, cmd_hold_owner;

-- platform.schema_migration : aucun droit pour les rôles applicatifs (REVOKE de 0000 conservé).
