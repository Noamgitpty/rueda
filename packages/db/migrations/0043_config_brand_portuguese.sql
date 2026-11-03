-- 0043 — CFG : portugais du Brésil, quatrième langue des actifs et des blocs de contenu de marque.
-- DEC-FONDATEUR-18 (es / en / fr / pt-BR, complète DEC-FONDATEUR-11 et 17) ; US-014, US-034 ;
-- ADR-067 (socle de marque), ADR-071 (portugais) ; ADR-044 (une migration appliquée est
-- immuable : 0042 n'est pas modifiée, on l'étend ici). Appliquée sous `migrator`.
--
-- Contenu :
--   1. `config_brand_asset.alt_text_pt` ; la contrainte trilingue `brand_asset_alt_trilingual`
--      devient `brand_asset_alt_all_locales` (es, en, fr ET pt), toujours enveloppée dans
--      COALESCE(…, false) : un texte NULL rend la clause NULL, qu'un CHECK accepterait
--      (fail-closed, constat 1 de la revue code US-034). Un actif image existant sans texte pt
--      ferait échouer l'ajout de la contrainte : la migration échoue alors, rien n'est affaibli
--      (aucun actif n'existe hors des bancs de test au moment de l'écriture) ;
--   2. `content_block_locale_valid` : 'pt' admis ;
--   3. droits de colonne : `alt_text_pt` lisible par app_api (actifs publiés), insérable par
--      iam_staff_owner (commande d'enregistrement) ;
--   4. commandes (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) :
--      - `cfg_brand_cmd_register_asset` prend `p_alt_pt` (nouvelle signature, l'ancienne est
--        supprimée : un appel à 11 arguments échoue au lieu d'écrire un actif sans texte pt) ;
--      - `cfg_content_cmd_save_draft` exige les QUATRE langues (`p_bodies` = {es, en, fr, pt},
--        aucune autre clé ; langue absente ou vide : LOCALE_MISSING) ;
--      - `cfg_content_cmd_publish` et `cfg_content_cmd_rollback` exigent une version complète
--        dans les quatre langues : un brouillon ou une version archivée de trois langues (créé
--        avant 0043) n'est ni publié (NOT_DRAFT) ni republié (NOT_FOUND) ; fail-closed.
--      Corps repris de 0042 à l'identique hors des listes de langues et des comptes.
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   recréer les fonctions de 0042 (signature à 11 arguments pour l'enregistrement d'actif) ;
--   ALTER TABLE core.config_content_block DROP CONSTRAINT content_block_locale_valid,
--     ADD CONSTRAINT content_block_locale_valid CHECK (locale IN ('es', 'en', 'fr'));
--   ALTER TABLE core.config_brand_asset DROP CONSTRAINT brand_asset_alt_all_locales,
--     ADD CONSTRAINT brand_asset_alt_trilingual CHECK (…0042…), DROP COLUMN alt_text_pt.

-- 1. Actifs de marque : texte alternatif en portugais, exigé comme les trois autres -------------
ALTER TABLE core.config_brand_asset ADD COLUMN alt_text_pt text;
ALTER TABLE core.config_brand_asset DROP CONSTRAINT brand_asset_alt_trilingual;
-- quatre langues (es, en, fr, pt) : toute image porte son texte alternatif dans chacune.
-- COALESCE : un texte NULL rendrait la clause NULL, qu'un CHECK accepte (fail-closed).
ALTER TABLE core.config_brand_asset ADD CONSTRAINT brand_asset_alt_all_locales CHECK (COALESCE(
    kind = 'FONT'
    OR (pg_catalog.char_length(pg_catalog.btrim(alt_text_es)) BETWEEN 1 AND 300
        AND pg_catalog.char_length(pg_catalog.btrim(alt_text_en)) BETWEEN 1 AND 300
        AND pg_catalog.char_length(pg_catalog.btrim(alt_text_fr)) BETWEEN 1 AND 300
        AND pg_catalog.char_length(pg_catalog.btrim(alt_text_pt)) BETWEEN 1 AND 300),
    false));

-- 2. Blocs de contenu : 'pt' admis ------------------------------------------------------------
ALTER TABLE core.config_content_block DROP CONSTRAINT content_block_locale_valid;
ALTER TABLE core.config_content_block ADD CONSTRAINT content_block_locale_valid
  CHECK (locale IN ('es', 'en', 'fr', 'pt'));
COMMENT ON TABLE core.config_content_block IS
  'CFG content_block (17 §3.2.13, DSN-004) : texte non juridique par clé, langue (es, en, fr, pt) '
  'et pays, versionné ; écrit par les commandes core.cfg_content_cmd_* seulement. US-034, US-014.';

-- 3. Droits de colonne (mêmes règles que les trois autres textes alternatifs, 0042) -------------
GRANT SELECT (alt_text_pt) ON core.config_brand_asset TO app_api;
GRANT INSERT (alt_text_pt) ON core.config_brand_asset TO iam_staff_owner;

-- 4. Commandes : remplacées sous leur propriétaire -----------------------------------------------
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma le temps du remplacement.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Enregistrement d'un actif : texte alternatif dans les quatre langues (CHECK ci-dessus).
DROP FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text);

CREATE FUNCTION core.cfg_brand_cmd_register_asset(p_token_hash bytea, p_request_id uuid,
                                                  p_asset_id uuid, p_kind text, p_mime text,
                                                  p_bytes bigint, p_sha256 bytea, p_alt_es text,
                                                  p_alt_en text, p_alt_fr text, p_alt_pt text,
                                                  p_license_note text)
  RETURNS TABLE (outcome text, asset_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a   record;
  v_id  uuid;
  v_key text;
BEGIN
  IF p_request_id IS NULL OR p_asset_id IS NULL OR p_kind IS NULL OR p_mime IS NULL
     OR p_bytes IS NULL OR p_sha256 IS NULL OR p_license_note IS NULL THEN
    RAISE EXCEPTION 'marque : données d''actif invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', NULL,
                                                  'BRAND_ASSET_REGISTER', 'BRAND_ASSET', p_asset_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- rejeu concurrent de la même requête : sérialisé, puis DUPLICATE (jamais 23505)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_brand_asset:' || p_request_id::text, 0));
  SELECT a.id, a.storage_key INTO v_id, v_key FROM core.config_brand_asset AS a
   WHERE a.request_id = p_request_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_id, v_key;
    RETURN;
  END IF;
  v_key := 'brand/' || p_asset_id::text;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class)
  VALUES (p_asset_id, 'BRAND', v_key, p_mime, p_bytes, p_sha256, v_a.actor, 'STAFF_UPLOAD', 'C0',
          'BRAND_PUBLIC');
  INSERT INTO core.config_brand_asset (id, kind, file_asset_id, storage_key, mime, bytes, sha256,
                                       alt_text_es, alt_text_en, alt_text_fr, alt_text_pt,
                                       license_note,
                                       uploaded_by, request_id)
  VALUES (p_asset_id, p_kind, p_asset_id, v_key, p_mime, p_bytes, p_sha256,
          NULLIF(pg_catalog.btrim(p_alt_es), ''), NULLIF(pg_catalog.btrim(p_alt_en), ''),
          NULLIF(pg_catalog.btrim(p_alt_fr), ''), NULLIF(pg_catalog.btrim(p_alt_pt), ''),
          pg_catalog.btrim(p_license_note), v_a.actor,
          p_request_id);
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_ASSET_REGISTERED', 'BRAND_ASSET',
                               p_asset_id, NULL,
                               pg_catalog.jsonb_build_object('kind', p_kind, 'mime', p_mime,
                                 'bytes', p_bytes, 'sha256', pg_catalog.encode(p_sha256, 'hex')),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'REGISTERED'::text, p_asset_id, v_key;
END
$fn$;

CREATE OR REPLACE FUNCTION core.cfg_content_cmd_save_draft(p_token_hash bytea, p_request_id uuid,
                                                p_block_key text, p_country text, p_bodies jsonb,
                                                p_asset_id uuid)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a      record;
  v_no     integer;
  v_locale text;
  v_first  uuid;
  v_id     uuid;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL OR p_bodies IS NULL
     OR pg_catalog.jsonb_typeof(p_bodies) <> 'object'
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_bodies) AS k(key)
                 WHERE k.key NOT IN ('es', 'en', 'fr', 'pt'))
     OR (p_country IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM core.config_country AS c WHERE c.code = p_country))
     OR (p_asset_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM core.config_brand_asset AS a WHERE a.id = p_asset_id AND a.kind = 'HERO_IMAGE')) THEN
    RAISE EXCEPTION 'contenu : brouillon invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', p_country,
                                                  'CONTENT_SAVE_DRAFT', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY['es', 'en', 'fr', 'pt']) AS l(locale)
              WHERE pg_catalog.jsonb_typeof(p_bodies -> l.locale) IS DISTINCT FROM 'string'
                 OR pg_catalog.btrim(p_bodies ->> l.locale) = '') THEN
    RETURN QUERY SELECT 'LOCALE_MISSING'::text, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  -- idempotence relue SOUS le verrou : un rejeu concurrent rend DUPLICATE, jamais 23505
  SELECT b.version_no INTO v_no FROM core.config_content_block AS b
   WHERE b.request_id = p_request_id LIMIT 1;
  IF v_no IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_no;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(b.version_no), 0) + 1 INTO v_no FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country;
  FOREACH v_locale IN ARRAY ARRAY['es', 'en', 'fr', 'pt'] LOOP
    v_id := pg_catalog.gen_random_uuid();
    v_first := COALESCE(v_first, v_id);
    INSERT INTO core.config_content_block (id, block_key, locale, country_code, version_no, status,
                                           body_md, asset_id, created_by, request_id)
    VALUES (v_id, p_block_key, v_locale, p_country, v_no, 'DRAFT', p_bodies ->> v_locale, p_asset_id,
            v_a.actor, p_request_id);
  END LOOP;
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_DRAFT_SAVED', 'CONTENT_BLOCK',
                               v_first, NULL,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country, 'versionNo', v_no)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'SAVED'::text, v_no;
END
$fn$;

CREATE OR REPLACE FUNCTION core.cfg_content_cmd_publish(p_token_hash bytea, p_request_id uuid,
                                             p_block_key text, p_country text, p_version_no integer)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_a      record;
  v_rows   integer;
  v_drafts integer;
  v_first  uuid;
  v_prev   integer;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL OR p_version_no IS NULL THEN
    RAISE EXCEPTION 'contenu : publication invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', p_country,
                                                  'CONTENT_PUBLISH', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  SELECT pg_catalog.count(*)::integer, pg_catalog.count(*) FILTER (WHERE b.status = 'DRAFT')::integer
    INTO v_rows, v_drafts
    FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  -- quatre langues en brouillon (une version de trois langues, antérieure à 0043, ne se publie pas)
  IF v_drafts <> 4 THEN
    RETURN QUERY SELECT 'NOT_DRAFT'::text, p_version_no;
    RETURN;
  END IF;
  SELECT pg_catalog.max(b.version_no) INTO v_prev FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b SET status = 'ARCHIVED', archived_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b
     SET status = 'PUBLISHED', published_by = v_a.actor, published_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no;
  SELECT b.id INTO v_first FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no AND b.locale = 'es';
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_PUBLISHED', 'CONTENT_BLOCK',
                               v_first,
                               CASE WHEN v_prev IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('versionNo', v_prev) END,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country,
                                 'versionNo', p_version_no)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'PUBLISHED'::text, p_version_no;
END
$fn$;

CREATE OR REPLACE FUNCTION core.cfg_content_cmd_rollback(p_token_hash bytea, p_request_id uuid,
                                              p_block_key text, p_country text,
                                              p_target_version_no integer)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_a      record;
  v_target integer;
  v_no     integer;
  v_prev   integer;
  v_first  uuid;
  v_n      integer;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL THEN
    RAISE EXCEPTION 'contenu : retour arrière invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', p_country,
                                                  'CONTENT_ROLLBACK', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  SELECT b.version_no INTO v_no FROM core.config_content_block AS b
   WHERE b.request_id = p_request_id LIMIT 1;
  IF v_no IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_no;
    RETURN;
  END IF;
  -- cible : la version archivée demandée, sinon la dernière publiée avant l'actuelle
  SELECT b.version_no INTO v_target FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'ARCHIVED'
     AND (p_target_version_no IS NULL OR b.version_no = p_target_version_no)
   ORDER BY b.published_at DESC, b.version_no DESC
   LIMIT 1;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_target AND b.status = 'ARCHIVED';
  -- cible complète dans les quatre langues (une version de trois langues n'est pas republiée)
  IF v_target IS NULL OR v_n <> 4 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(b.version_no), 0) + 1 INTO v_no FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country;
  INSERT INTO core.config_content_block (id, block_key, locale, country_code, version_no, status,
                                         body_md, asset_id, copied_from_id, created_by, request_id)
  SELECT pg_catalog.gen_random_uuid(), b.block_key, b.locale, b.country_code, v_no, 'DRAFT',
         b.body_md, b.asset_id, b.id, v_a.actor, p_request_id
    FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_target;
  SELECT pg_catalog.max(b.version_no) INTO v_prev FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b SET status = 'ARCHIVED', archived_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b
     SET status = 'PUBLISHED', published_by = v_a.actor, published_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_no;
  SELECT b.id INTO v_first FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_no AND b.locale = 'es';
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_ROLLED_BACK', 'CONTENT_BLOCK',
                               v_first,
                               CASE WHEN v_prev IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('versionNo', v_prev) END,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country, 'versionNo', v_no,
                                 'copiedFromVersionNo', v_target)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'ROLLED_BACK'::text, v_no;
END
$fn$;

-- (propriétaire : seul lui peut commenter la fonction et en régler les droits)
COMMENT ON FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text, text) IS
  'Actif de marque : file_asset (BRAND, C0) + brand_asset, texte alternatif es / en / fr / pt ; '
  'brand.edit ; journalisé. US-034, US-014.';
COMMENT ON FUNCTION core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid) IS
  'Brouillon de bloc de contenu, quatre langues ensemble (es, en, fr, pt) ; brand.edit ; journalisé. US-034, US-014.';
COMMENT ON FUNCTION core.cfg_content_cmd_publish(bytea, uuid, text, text, integer) IS
  'Publication atomique d''une version de bloc (quatre langues) ; brand.publish ; journalisée. US-034, US-014.';
COMMENT ON FUNCTION core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer) IS
  'Retour arrière d''un bloc : copie de la version archivée (quatre langues), publiée ; brand.publish. US-034, US-014.';

REVOKE ALL ON FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
