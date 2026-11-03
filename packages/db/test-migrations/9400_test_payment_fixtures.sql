-- 9400 — environnement de déploiement et écrivain des comptes PSP, pour les TESTS (US-019).
--
-- JAMAIS appliquée hors tests (comme 9000) : seule la base jetable principale `rueda_test_*` la
-- reçoit ; la base de contrôle `rueda_test_*_prod` garde la définition de production de
-- platform.deployment_env() (« production »), vérifiée par test/l0/l0-pay-port.test.ts.
--
-- 1. platform.deployment_env() : « test » par défaut ; un test pose `app.test_deployment_env`
--    (SET LOCAL, dans sa transaction) pour éprouver les gardes de production (C19) SOUS UN RÔLE DE
--    PRODUCTION. Même principe que l'horloge virtuelle (9000) : la base de production ne lit
--    jamais ce paramètre.
-- 2. Écriture des comptes PSP et des capacités par app_worker (tests seulement) : en production,
--    aucune écriture applicative de la configuration PSP n'existe en Bêta (graines par migration
--    sous migrator ; porte PAY-041 au lot C). Les gardes (CHECK, trigger FAKE) s'appliquent à tous
--    les rôles : ce droit de test ne les contourne pas.
--
-- Retour arrière :
--   réappliquer la définition de 0027 (CREATE OR REPLACE FUNCTION platform.deployment_env()) ;
--   DROP POLICY test_worker_write ON core.payment_psp_account, core.payment_psp_capability ;
--   REVOKE INSERT, UPDATE ON core.payment_psp_account, core.payment_psp_capability FROM app_worker ;
--   REVOKE SELECT ON core.payment_psp_account FROM app_worker.

CREATE OR REPLACE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.test_deployment_env', true), ''), 'test')
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'VERSION DE TEST (test-migrations/9400) : app.test_deployment_env si posé, sinon test.';

GRANT SELECT, INSERT, UPDATE ON core.payment_psp_account, core.payment_psp_capability TO app_worker;
CREATE POLICY test_worker_write ON core.payment_psp_account
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.payment_psp_capability
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
