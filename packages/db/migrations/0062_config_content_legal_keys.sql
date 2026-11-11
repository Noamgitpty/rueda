-- 0062 — CFG : blocs de contenu éditables, textes juridiques refusés et journalisés.
-- US-121 (19 : critère 3 « un texte juridique — CGU, contrat, politique d'annulation — n'est
-- jamais éditable comme bloc, il reste un gabarit versionné `document_template` ») ; 17 §3.2.13
-- (`content_block`) ; ADR-036, ADR-067, ADR-095. Appliquée sous `migrator`.
--
-- Contenu :
--   1. `core.cfg_content_key_not_legal(text)` : vrai si la clé ne nomme aucun texte juridique :
--      ni sigle par SEGMENT entier (tos, tyc, t_c, rgpd, lgpd, gdpr, dpa, lopd, aviso, mentions,
--      impressum, license, cgu, cgv, cookies…), ni racine par SOUS-CHAÎNE (legal, terms,
--      terminos, termos, conditions, condiciones, contract, privac, cancellation, refund,
--      insurance, seguros, policy, eula, waiver, franqui, garanti… en es, en, fr et pt). Motif recopié À L'IDENTIQUE de `LEGAL_BLOCK_KEY`
--      (`packages/i18n/src/editable-blocks.ts`) ; la preuve L0 compare les deux.
--      Jamais NULL (COALESCE, fail-closed) ;
--   2. contrainte `content_block_key_not_legal_text` : CHECK de la table, en plus de
--      `content_block_key_not_legal` (`legal.*`, 0042) qui reste en place ; posée `NOT VALID`
--      (lignes nouvelles et modifiées contrôlées aussitôt, verrou court) puis validée par une
--      instruction séparée. Justification de la validation : aucune base ne peut contenir de clé
--      devenue juridique. La production n'a jamais été déployée ; en préproduction et en test,
--      l'API n'écrit que des clés du registre `EDITABLE_BLOCKS`, toutes non juridiques (test du
--      registre), et les tests écrivent des clés `home.*_<hasard>.title`. Si une telle ligne
--      existait, VALIDATE échouerait et la migration avec : échec fermé, rien n'est affaibli ;
--   3. `cfg_content_cmd_save_draft` remplacée (même signature, iam_staff_owner) : après les
--      droits, une clé juridique rend `KEY_FORBIDDEN` et la tentative est JOURNALISÉE
--      (`CONTENT_KEY_REFUSED`, motif `LEGAL_TEXT`) ; rien n'est écrit. Corps repris de 0043 à
--      l'identique hors de ce contrôle.
--   Le registre des clés éditables (liste blanche) reste dans l'API (`EDITABLE_BLOCKS`) : la base
--   ne connaît pas les écrans ; elle refuse ce qui ne doit JAMAIS devenir un bloc.
--
-- Expand / contract : extension seulement (fonction et contrainte ajoutées, fonction remplacée
-- sous le même nom et la même signature). Resserrement fail-closed : aucune ligne existante ne
-- porte une clé juridique (le CHECK l'aurait refusée sinon : l'ajout échoue au lieu d'affaiblir) ;
-- la version N de l'API n'écrit que des clés du registre, toutes non juridiques (test du registre).
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   recréer `cfg_content_cmd_save_draft` de 0043 (sous iam_staff_owner) ;
--   ALTER TABLE core.config_content_block DROP CONSTRAINT content_block_key_not_legal_text ;
--   DROP FUNCTION core.cfg_content_key_not_legal(text).

-- 1. Motif des textes juridiques (même motif que l'API) -------------------------------------------
CREATE FUNCTION core.cfg_content_key_not_legal(p_key text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- jamais NULL : un NULL passerait un CHECK (fail-closed)
  SELECT COALESCE(p_key !~ '(^|[._])(tos|tyc|t_c|tandc|rgpd|lgpd|gdpr|dpa|lopd|aviso|mentions|impressum|imprint|license|licencia|licenca|cgu|cgv|cookies)([._]|$)|(legal|terms|terminos|termino_|termos|condiciones|condicoes|conditions|contract|contrat|agreement|acuerdo|acordo|privac|confidential|cancellation|cancelacion|cancelamento|annulation|refund|reembols|rembours|insurance|seguros|seguro_|segurador|assurance|protection|policy|politic|consent|eula|disclaimer|waiver|deductible|franqui|warrant|garanti|liabil|responsab)', false)
$fn$;
REVOKE ALL ON FUNCTION core.cfg_content_key_not_legal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.cfg_content_key_not_legal(text) TO iam_staff_owner;
COMMENT ON FUNCTION core.cfg_content_key_not_legal(text) IS
  'Vrai si la clé de bloc ne nomme aucun texte juridique (motif LEGAL_BLOCK_KEY de @rueda/i18n). US-121.';

-- 2. Filet de la table ---------------------------------------------------------------------------
ALTER TABLE core.config_content_block ADD CONSTRAINT content_block_key_not_legal_text
  CHECK (core.cfg_content_key_not_legal(block_key)) NOT VALID;
ALTER TABLE core.config_content_block VALIDATE CONSTRAINT content_block_key_not_legal_text;

-- 3. Brouillon : refus journalisé d'une clé juridique ---------------------------------------------
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma le temps du remplacement.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

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
  -- US-121 : texte juridique (CGU, contrat, politique d'annulation…) : jamais un bloc ; la
  -- tentative est journalisée, rien n'est écrit (le CHECK de la table est le filet suivant)
  IF NOT core.cfg_content_key_not_legal(p_block_key) THEN
    PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_KEY_REFUSED', 'CONTENT_BLOCK',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                   'blockKey', p_block_key, 'country', p_country,
                                   'reason', 'LEGAL_TEXT')),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'KEY_FORBIDDEN'::text, NULL::integer;
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

COMMENT ON FUNCTION core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid) IS
  'Brouillon de bloc de contenu, quatre langues ensemble (es, en, fr, pt) ; clé juridique refusée '
  'et journalisée (US-121) ; brand.edit ; journalisé. US-034, US-014, US-121.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
