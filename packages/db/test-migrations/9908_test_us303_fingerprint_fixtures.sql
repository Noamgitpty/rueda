-- 9908 — fixtures de la garde d'empreinte des photos d'état (US-303 suite, migration 0176, ADR-196).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser une photo
-- d'annonce déjà enregistrée (ligne `file_asset` du bucket PUBLIC_LISTING, C0, comme la commande
-- d'US-115 l'écrit) et relire, pour UNE empreinte donnée, le nombre de photos d'état et de fichiers
-- qui la portent (aucun rôle applicatif ne lit ces tables) : jamais un compte global. Les attendus
-- des tests viennent du pré-mortem du lot 3 (L3-PM-03) et du constat F-L3-PRE-01, jamais de ces
-- fixtures. AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us303_listing_file(uuid, bytea),
--   test_fixture.us303_fingerprint_rows(bytea).

-- Photo d'annonce déjà enregistrée, portant l'empreinte donnée (copie nettoyée, comme US-115)
CREATE FUNCTION test_fixture.us303_listing_file(p_uploader uuid, p_sha256 bytea)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256,
                                     uploader_user_id, source, classification, retention_class)
  VALUES (v_id, 'PUBLIC_LISTING', 'listing/us303/' || v_id::text, 'image/jpeg', 2048, p_sha256,
          p_uploader, 'HOST_UPLOAD', 'C0', 'LISTING_PHOTO');
  RETURN v_id;
END
$fn$;

-- Photos d'état et fichiers qui portent UNE empreinte (preuve que rien n'est écrit au refus)
CREATE FUNCTION test_fixture.us303_fingerprint_rows(p_sha256 bytea)
  RETURNS TABLE (photos integer, files integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (SELECT pg_catalog.count(*)::integer FROM core.trip_ops_inspection_photo AS ph
           WHERE ph.sha256 = p_sha256),
         (SELECT pg_catalog.count(*)::integer FROM core.audit_file_asset AS f
           WHERE f.sha256 = p_sha256)
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us303_listing_file(uuid, bytea),
  test_fixture.us303_fingerprint_rows(bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us303_listing_file(uuid, bytea),
  test_fixture.us303_fingerprint_rows(bytea)
TO app_api, app_worker;
