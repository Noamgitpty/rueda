-- 0109 — CTR : documents du checkout servis et publiables ; nom du conducteur comparé en NFC.
-- US-208 (partie 208b) ; 19 US-208 critère 3 (le voyageur lit la version exacte des CGU, de la
-- politique d'annulation et du texte géographique qu'il accepte) ; 16 BKG-008 / BKG-023, BKG-002 ;
-- 16 NFR-17 (relire une version passée) ; revues de 208a (architecture n° 8, ux n° 8, code n° 3) ;
-- ADR-133, ADR-134.
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes :
--   - `core.ctr_document_body` sert aussi CANCELLATION_POLICY et GEO_TERMS (lecture publique C0 du
--     texte en vigueur ou d'une version passée en vigueur ; jamais une version future). Aucun texte
--     publié dans la portée ⇒ aucune ligne (404 côté API) : la case du checkout n'a alors ni lien
--     ni version à accepter, et la commande de checkout refuse (TERMS_UNAVAILABLE), fail-closed ;
--   - `core.ctr_staff_cmd_publish_document` (console, `legal.publish`, session élevée par TOTP)
--     publie aussi ces deux genres, dans les quatre langues, comme les CGU (version suivante du
--     genre et du pays, jamais rétroactive, journalisée) ;
--   - `core.iam_holder_name_matches` compare les noms après normalisation Unicode NFC des deux
--     côtés (un nom saisi en forme décomposée, fréquente sur certains claviers mobiles, n'est plus
--     refusé face au même nom en forme composée) ; casse et espaces superflus restent neutres, un
--     accent différent reste un autre nom (ADR-133).
--
-- Expand / contract : trois corps remplacés à signature, propriétaire et droits identiques (liste
-- des genres élargie ; normalisation ajoutée) ; rien d'autre ne change. Les entrées de
-- security-definer-allowlist.json sont inchangées (signature, propriétaire, EXECUTE).
--
-- Retour arrière :
--   réappliquer core.ctr_document_body et core.ctr_staff_cmd_publish_document de 0070 (sous
--     iam_auth_owner et iam_staff_owner) et core.iam_holder_name_matches de 0108 (sous
--     iam_auth_owner) ; aucune donnée à reprendre.

-- 1. Lectures d'IAM / CTR (propriétaire iam_auth_owner) ------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;

-- 1.1 Texte d'un document : genres du checkout admis (corps de 0070 recopié, liste élargie).
CREATE OR REPLACE FUNCTION core.ctr_document_body(p_kind text, p_country text, p_language text,
                                                  p_version integer)
  RETURNS TABLE (doc_kind text, version integer, is_major boolean, locale text, title text,
                 body_md text, content_hash bytea, is_draft boolean, valid_from timestamptz)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH cur AS (SELECT * FROM core.ctr_current_template(p_kind, p_country, p_language, false))
  SELECT t.kind, t.version, t.is_major, t.locale, t.title, t.body_md, t.content_hash,
         t.legal_review_ref IS NULL, t.valid_from
    FROM core.contract_document_template AS t, cur
   WHERE p_kind IN ('TOS_GUEST', 'PRIVACY', 'MARKETING', 'TOS_HOST', 'CANCELLATION_POLICY',
                    'GEO_TERMS')
     AND t.kind = p_kind
     AND t.country_code IS NOT DISTINCT FROM cur.country_code
     AND t.version = COALESCE(p_version, cur.version)
     AND t.valid_from <= platform.now()
     AND (t.locale = p_language OR t.is_authoritative)
   ORDER BY (t.locale = p_language) DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.ctr_document_body(text, text, text, integer) IS
  'Texte d''un document en vigueur ou passé en vigueur (C0) : documents du voyageur, CGU de '
  'l''hôte, politique d''annulation et texte géographique du checkout. SECURITY DEFINER, EXECUTE '
  'app_api. US-102 ; US-126 ; US-208.';

-- 1.2 Conducteur = titulaire du compte (16 BKG-002) : NFC, sans casse ni espaces superflus.
CREATE OR REPLACE FUNCTION core.iam_holder_name_matches(p_user_id uuid, p_first text,
                                                        p_last text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH n AS (
    SELECT pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.btrim(pg_catalog.normalize(p_first, 'NFC')), '\s+', ' ', 'g')) AS f,
           pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.btrim(pg_catalog.normalize(p_last, 'NFC')), '\s+', ' ', 'g')) AS l
  )
  SELECT COALESCE((
    SELECT n.f = pg_catalog.lower(pg_catalog.regexp_replace(
                   pg_catalog.btrim(pg_catalog.normalize(u.legal_first_name, 'NFC')), '\s+', ' ',
                   'g'))
       AND n.l = pg_catalog.lower(pg_catalog.regexp_replace(
                   pg_catalog.btrim(pg_catalog.normalize(u.legal_last_name, 'NFC')), '\s+', ' ',
                   'g'))
      FROM core.iam_user_account AS u, n
     WHERE u.id = p_user_id
       AND pg_catalog.length(n.f) BETWEEN 1 AND 100 AND pg_catalog.length(n.l) BETWEEN 1 AND 100), false)
$fn$;
COMMENT ON FUNCTION core.iam_holder_name_matches(uuid, text, text) IS
  'Le nom saisi pour le conducteur est-il le nom légal du compte (formes Unicode NFC, sans casse ni '
  'espaces superflus) ? Aucune donnée rendue. SECURITY DEFINER, EXECUTE cmd_hold_owner. US-208 '
  '(16 BKG-002).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 2. Publication d'une version : genres du checkout admis (corps de 0070 recopié, liste des genres
-- élargie ; propriétaire iam_staff_owner) -------------------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;
CREATE OR REPLACE FUNCTION core.ctr_staff_cmd_publish_document(p_token_hash bytea,
                                                               p_request_id uuid, p_kind text,
                                                               p_country text,
                                                               p_is_major boolean,
                                                               p_valid_from timestamptz,
                                                               p_legal_review_ref text,
                                                               p_bodies jsonb)
  RETURNS TABLE (outcome text, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_a     record;
  v_next  integer;
  v_lang  text;
  v_first uuid;
BEGIN
  IF p_request_id IS NULL OR p_is_major IS NULL
     OR p_kind IS NULL
     OR p_kind NOT IN ('TOS_GUEST', 'PRIVACY', 'MARKETING', 'TOS_HOST', 'CANCELLATION_POLICY',
                       'GEO_TERMS')
     OR p_bodies IS NULL OR pg_catalog.jsonb_typeof(p_bodies) <> 'object'
     OR (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(p_bodies) AS k)
        IS DISTINCT FROM ARRAY['en', 'es', 'fr', 'pt']
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_bodies) AS b(k, v)
                 WHERE pg_catalog.jsonb_typeof(b.v) <> 'object'
                    OR pg_catalog.jsonb_typeof(b.v -> 'title') <> 'string'
                    OR pg_catalog.jsonb_typeof(b.v -> 'body') <> 'string') THEN
    RAISE EXCEPTION 'ctr : publication invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'legal.publish', p_country,
                                                  'LEGAL_PUBLISH', 'DOCUMENT_TEMPLATE',
                                                  p_request_id, p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  IF p_valid_from IS NOT NULL AND p_valid_from < v_now THEN
    RAISE EXCEPTION 'ctr : publication rétroactive refusée'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'document_template_not_retroactive';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.contract_document_template:' || p_kind || ':'
                                || COALESCE(p_country, ''), 0));
  -- même demande rejouée (même request_id) : la version déjà publiée, sans nouvelle ligne ni audit ;
  -- request_id d'une autre publication (autre genre ou pays) : refus
  SELECT t.version INTO v_next FROM core.contract_document_template AS t
   WHERE t.request_id = p_request_id AND t.is_authoritative;
  IF v_next IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM core.contract_document_template AS t
                WHERE t.request_id = p_request_id
                  AND (t.kind <> p_kind OR t.country_code IS DISTINCT FROM p_country)) THEN
      RETURN QUERY SELECT 'REQUEST_ID_REUSED'::text, NULL::integer;
    ELSE
      RETURN QUERY SELECT 'PUBLISHED'::text, v_next;
    END IF;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(t.version), 0) + 1 INTO v_next
    FROM core.contract_document_template AS t
   WHERE t.kind = p_kind AND t.country_code IS NOT DISTINCT FROM p_country;
  FOREACH v_lang IN ARRAY ARRAY['es', 'en', 'fr', 'pt'] LOOP
    INSERT INTO core.contract_document_template
           (kind, country_code, locale, version, is_major, title, body_md, content_hash,
            legal_review_ref, is_authoritative, valid_from, published_by, request_id)
    VALUES (p_kind, p_country, v_lang, v_next, p_is_major, p_bodies -> v_lang ->> 'title',
            p_bodies -> v_lang ->> 'body', pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
            NULLIF(pg_catalog.btrim(p_legal_review_ref), ''), v_lang = 'es',
            COALESCE(p_valid_from, v_now),
            v_a.actor, p_request_id);
  END LOOP;
  SELECT t.id INTO v_first FROM core.contract_document_template AS t
   WHERE t.kind = p_kind AND t.country_code IS NOT DISTINCT FROM p_country
     AND t.version = v_next AND t.is_authoritative;
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'LEGAL_DOCUMENT_PUBLISHED',
                               'DOCUMENT_TEMPLATE', v_first, NULL,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'kind', p_kind, 'country', p_country, 'version', v_next,
                                 'isMajor', p_is_major,
                                 'draft', NULLIF(pg_catalog.btrim(p_legal_review_ref), '') IS NULL)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'PUBLISHED'::text, v_next;
END
$fn$;
COMMENT ON FUNCTION core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb) IS
  'Publication d''une version (4 langues) : documents du voyageur, CGU de l''hôte, politique '
  'd''annulation et texte géographique du checkout ; permission legal.publish, journalisée. '
  'SECURITY DEFINER, EXECUTE app_api. US-102 ; US-126 ; US-208.';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
