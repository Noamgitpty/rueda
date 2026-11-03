-- 9870 — fixtures des preuves du socle de marque (US-034). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : relire les versions avec les colonnes que app_api ne voit pas (auteur, brouillons,
-- rapport de contraste), et tenter sous `migrator` (propriétaire des tables, hors RLS des
-- commandes) les écrasements que les gardes doivent refuser à TOUS les rôles. SECURITY DEFINER
-- sous migrator, search_path figé, aucun SQL dynamique.
--
-- Retour arrière : DROP FUNCTION test_fixture.brand_versions(), test_fixture.content_blocks(text),
--   test_fixture.brand_tamper(uuid, text), test_fixture.content_tamper(uuid, text),
--   test_fixture.brand_asset_tamper(uuid), test_fixture.brand_file_asset(uuid);

CREATE FUNCTION test_fixture.brand_versions()
  RETURNS TABLE (id uuid, version_no integer, status text, brand_name text, tokens jsonb,
                 contrast_check jsonb, copied_from_id uuid, created_by uuid, published_by uuid,
                 published_at timestamptz, archived_at timestamptz, tokens_sha256 text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, v.version_no, v.status, v.brand_name, v.tokens, v.contrast_check, v.copied_from_id,
         v.created_by, v.published_by, v.published_at, v.archived_at,
         core.cfg_brand_tokens_sha256(v.tokens)
    FROM core.config_brand_version AS v ORDER BY v.version_no
$fn$;

CREATE FUNCTION test_fixture.content_blocks(p_block_key text)
  RETURNS TABLE (id uuid, locale text, country_code text, version_no integer, status text,
                 body_md text, copied_from_id uuid, created_by uuid, published_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.id, b.locale, b.country_code::text, b.version_no, b.status, b.body_md, b.copied_from_id,
         b.created_by, b.published_by
    FROM core.config_content_block AS b WHERE b.block_key = p_block_key
   ORDER BY b.country_code NULLS FIRST, b.version_no, b.locale
$fn$;

-- Écrasements tentés sous migrator : la garde doit refuser (23000, brand_version_immutable).
CREATE FUNCTION test_fixture.brand_tamper(p_version_id uuid, p_kind text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_kind
    WHEN 'TOKENS' THEN
      UPDATE core.config_brand_version SET tokens = '{"tampered": true}'::jsonb WHERE id = p_version_id;
    WHEN 'NAME' THEN
      UPDATE core.config_brand_version SET brand_name = 'Autre' WHERE id = p_version_id;
    WHEN 'UNARCHIVE' THEN
      UPDATE core.config_brand_version SET status = 'PUBLISHED', archived_at = NULL WHERE id = p_version_id;
    WHEN 'DELETE' THEN
      DELETE FROM core.config_brand_version WHERE id = p_version_id;
    WHEN 'TRUNCATE' THEN
      TRUNCATE core.config_brand_version;
    WHEN 'INSERT_PUBLISHED' THEN
      INSERT INTO core.config_brand_version (id, version_no, status, brand_name, tokens,
                                             tokens_schema_version, contrast_check, created_by,
                                             published_by, published_at, request_id)
      SELECT gen_random_uuid(), 100000, 'PUBLISHED', 'Forgée', '{}'::jsonb, 1,
             '{"passed": true, "failures": [], "checker": "forged"}'::jsonb, v.created_by,
             v.created_by, platform.now(), gen_random_uuid()
        FROM core.config_brand_version AS v WHERE v.id = p_version_id;
    ELSE
      RAISE EXCEPTION 'brand_tamper: unknown kind %', p_kind;
  END CASE;
END
$fn$;

CREATE FUNCTION test_fixture.content_tamper(p_block_id uuid, p_kind text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_kind
    WHEN 'BODY' THEN
      UPDATE core.config_content_block SET body_md = 'Texte modifié' WHERE id = p_block_id;
    WHEN 'DELETE' THEN
      DELETE FROM core.config_content_block WHERE id = p_block_id;
    WHEN 'TRUNCATE' THEN
      TRUNCATE core.config_content_block;
    ELSE
      RAISE EXCEPTION 'content_tamper: unknown kind %', p_kind;
  END CASE;
END
$fn$;

CREATE FUNCTION test_fixture.brand_asset_tamper(p_asset_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.config_brand_asset SET license_note = 'modifiée' WHERE id = p_asset_id
$fn$;

CREATE FUNCTION test_fixture.brand_file_asset(p_id uuid)
  RETURNS TABLE (bucket text, storage_key text, mime text, bytes bigint, sha256 bytea,
                 uploader_user_id uuid, source text, classification text, retention_class text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.bucket, f.storage_key, f.mime, f.bytes, f.sha256, f.uploader_user_id, f.source,
         f.classification, f.retention_class
    FROM core.audit_file_asset AS f WHERE f.id = p_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.brand_versions(),
  test_fixture.content_blocks(text),
  test_fixture.brand_tamper(uuid, text),
  test_fixture.content_tamper(uuid, text),
  test_fixture.brand_asset_tamper(uuid),
  test_fixture.brand_file_asset(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.brand_versions(),
  test_fixture.content_blocks(text),
  test_fixture.brand_tamper(uuid, text),
  test_fixture.content_tamper(uuid, text),
  test_fixture.brand_asset_tamper(uuid),
  test_fixture.brand_file_asset(uuid)
TO app_api;
