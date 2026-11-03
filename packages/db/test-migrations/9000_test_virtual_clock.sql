-- 9000 — horloge virtuelle des TESTS (US-005 ; 17 §1.3 points 2 et 2 bis ; ADR-030).
--
-- JAMAIS appliquée hors tests : seul le harnais (packages/db/src/testing) ajoute le dossier
-- test-migrations/ à l'exécuteur, et seulement dans la base jetable `rueda_test_*` principale.
-- La base jetable `rueda_test_*_prod` reçoit les migrations de production seules : le test
-- L0-06 y vérifie que le corps de platform.now() ne référence pas app.virtual_now.
--
-- Comportement : si `app.virtual_now` est posé (par SET LOCAL, dans la transaction de test),
-- platform.now() rend cette valeur ; sinon (paramètre absent, ou vide après la fin de la
-- transaction ou un RESET ALL), repli sur l'horloge réelle clock_timestamp().
-- Toujours VOLATILE (L0-06).
--
-- Retour arrière : réappliquer la définition de 0000_platform_now.sql (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION platform.now()
  RETURNS timestamptz
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('app.virtual_now', true), '')::timestamptz,
    pg_catalog.clock_timestamp()
  )
$fn$;

COMMENT ON FUNCTION platform.now() IS
  'VERSION DE TEST (test-migrations/9000) : app.virtual_now si posé, sinon clock_timestamp().';
