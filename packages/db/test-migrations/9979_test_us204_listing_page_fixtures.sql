-- 9979 — fixtures des preuves de la fiche du véhicule (US-204, migration 0106). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelée
-- SEULEMENT dans des transactions de test ANNULÉES :
--   1. `us204_set_photo` : statut (`PENDING`, `APPROVED`, `REJECTED`) et retrait d'une photo
--      d'annonce (`core.catalog_listing_photo`), états que pose la revue de l'ops ou le retrait par
--      l'hôte (16 HST-012, ADM-003), sans écrivain applicatif dans la bêta ; prouve que la galerie
--      publique écarte les photos refusées ou retirées.
--
-- Retour arrière : DROP FUNCTION test_fixture.us204_set_photo(uuid, text, boolean).

CREATE FUNCTION test_fixture.us204_set_photo(p_photo uuid, p_status text, p_deleted boolean)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_listing_photo
     SET status = p_status,
         deleted_at = CASE WHEN p_deleted THEN platform.now() END
   WHERE id = p_photo
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us204_set_photo(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us204_set_photo(uuid, text, boolean) TO app_api;
