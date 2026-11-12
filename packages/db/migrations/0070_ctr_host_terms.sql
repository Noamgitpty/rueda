-- 0070 — CTR : CGU de l'hôte versionnées (`TOS_HOST`), acceptation horodatée et garde de la
-- soumission d'une annonce.
-- US-126 ; 19 US-126 ; 16 LEG-001 / LEG-002 (« l'hôte accepte en plus les CGU de l'hôte avant sa
-- première annonce » ; « version majeure → ré-acceptation »), LEG-014 (positionnement
-- d'intermédiaire) ; 08 BR-ACC-06, BR-PROT-06 ; 17 §3.2.6 (`document_template`, `consent`) ;
-- 22 OQ-BR-24, OQ-MK-01 ; ADR-091 (mécanisme d'US-102, réutilisé) ; ADR-100 (cette migration).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-100, PROPOSÉ) :
--   - les CGU de l'hôte sont un genre `TOS_HOST` de `core.contract_document_template` (déjà prévu
--     par 0059) : mêmes versions, mêmes quatre langues (es fait foi), même marqueur BROUILLON
--     (`legal_review_ref` NULL), même publication par la console (`legal.publish`) ;
--   - la PORTÉE est le pays du COMPTE D'HÔTE (un compte par pays, 17 §2.3), jamais le pays déclaré
--     du voyageur : documents propres à ce pays s'il en existe un en vigueur, sinon communs ;
--   - acceptation : consentement `TOS_HOST` versionné (version exacte du gabarit affiché, langue
--     du texte servi, `platform.now()`, contexte `HOST_ONBOARDING` à la première acceptation,
--     `REACCEPT` ensuite, pays du compte d'hôte), écrit par la seule commande
--     `core.ctr_cmd_accept_host_terms` ; la version affichée est exigée (sinon
--     TERMS_VERSION_CHANGED, comme US-102) ;
--   - réacceptation exigée (comme Turo, PROPOSÉ) : jamais acceptées dans la portée, ou acceptées
--     dans une version inférieure à la plus haute version MAJEURE en vigueur ; aucun document en
--     vigueur ⇒ exigée aussi (fail-closed) ;
--   - garde DANS LA COMMANDE (L1-PM-28) : `core.catalog_cmd_submit_listing` rend
--     TERMS_REACCEPT_REQUIRED (l'annonce reste DRAFT) après la complétude et avant l'activation ;
--     la confirmation d'une réservation par l'hôte (lot 2) appellera la même fonction
--     `core.ctr_host_terms_required` (EXECUTE accordé à son propriétaire à ce moment-là) ;
--   - graine : version 1 BROUILLON commune, gabarit PROVISOIRE « à valider par l'avocat »
--     (OQ-BR-24, OQ-MK-01), sans clause « définitive et sans appel » ni texte repris de Turo.
--
-- Expand / contract : contrainte `consent_context_valid` recréée sous le même nom, élargie
-- (HOST_ONBOARDING) ; corps de `core.ctr_document_body`, `core.ctr_staff_cmd_publish_document`
-- et `core.catalog_cmd_submit_listing` remplacés à signature, propriétaire et droits identiques
-- (genre TOS_HOST admis ; garde des CGU de l'hôte) ; fonctions et graine ajoutées. Le
-- COMPORTEMENT de la soumission se resserre en fail-closed, volontairement : aucune annonce n'a
-- pu être soumise en production (`p2p_private_hosts_enabled` vaut false partout).
--
-- Retour arrière :
--   réappliquer core.catalog_cmd_submit_listing de 0067 (sous catalog_cmd_owner),
--     core.ctr_document_body et core.ctr_staff_cmd_publish_document de 0059 (sous leurs
--     propriétaires) ;
--   DROP FUNCTION core.ctr_cmd_accept_host_terms(bytea, uuid, integer, text),
--     core.ctr_host_terms(bytea, uuid, text), core.ctr_host_terms_required(uuid, text),
--     core.ctr_host_terms_state(uuid, text, text);
--   (la graine TOS_HOST et les consentements restent : registre en ajout seul) ;
--   recréer consent_context_valid de 0059 (seulement si aucune ligne HOST_ONBOARDING).

-- 1. Contexte de la première acceptation par l'hôte (contrainte élargie sous le même nom) ------
ALTER TABLE core.contract_consent DROP CONSTRAINT consent_context_valid;
ALTER TABLE core.contract_consent ADD CONSTRAINT consent_context_valid CHECK (context IN (
  'SIGNUP', 'REACCEPT', 'SETTINGS', 'CHECKOUT', 'CONTRACT', 'KYC', 'HOST_ONBOARDING'));

-- 2. État des CGU de l'hôte d'une personne dans une portée (SECURITY INVOKER, exécutée sous
-- iam_auth_owner) : gabarit en vigueur (langue demandée, sinon l'espagnol qui fait foi), plus
-- haute version MAJEURE, dernière version acceptée D'UN GABARIT DE CETTE PORTÉE (genre et pays du
-- gabarit comparés, comme 0059), réacceptation exigée. Toujours UNE ligne ; aucun document en
-- vigueur : colonnes du gabarit NULL et réacceptation exigée (fail-closed).
CREATE FUNCTION core.ctr_host_terms_state(p_user_id uuid, p_country text, p_language text)
  RETURNS TABLE (template_id uuid, version integer, is_major boolean, locale text, title text,
                 content_hash bytea, is_draft boolean, valid_from timestamptz,
                 required_version integer, accepted_version integer, accepted_at timestamptz,
                 reaccept_required boolean)
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH cur AS (
    SELECT t.* FROM core.ctr_current_template('TOS_HOST', p_country, p_language, false) AS t
  ), maj AS (
    SELECT (SELECT m.version
              FROM core.ctr_current_template('TOS_HOST', p_country, p_language, true) AS m)
           AS version
  ), acc AS (
    SELECT x.doc_version, x.accepted_at
      FROM core.contract_consent AS x
      JOIN core.contract_document_template AS g ON g.id = x.template_id
      JOIN cur ON g.country_code IS NOT DISTINCT FROM cur.country_code
     WHERE x.user_id = p_user_id AND x.doc_kind = 'TOS_HOST' AND x.accepted
       AND g.kind = 'TOS_HOST'
     ORDER BY x.seq DESC
     LIMIT 1
  )
  SELECT cur.id, cur.version, cur.is_major, cur.locale, cur.title, cur.content_hash,
         cur.legal_review_ref IS NULL, cur.valid_from, maj.version, acc.doc_version,
         acc.accepted_at,
         cur.id IS NULL OR acc.doc_version IS NULL
           OR (maj.version IS NOT NULL AND acc.doc_version < maj.version)
    FROM maj
    LEFT JOIN cur ON true
    LEFT JOIN acc ON true
$fn$;
REVOKE ALL ON FUNCTION core.ctr_host_terms_state(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ctr_host_terms_state(uuid, text, text) TO iam_auth_owner;

-- 3. Fonctions de la famille iam_auth (propriétaire iam_auth_owner, CREATE le temps de la
-- création seulement, mécanique de 0059 / 0067) -----------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;

-- 3.1 Garde des commandes de l'hôte : true = CGU de l'hôte à (ré)accepter dans le pays du compte
-- d'hôte (fail-closed : pays absent, aucun document en vigueur). Appelée par les commandes de
-- l'hôte (soumission d'une annonce, US-126 ; confirmation d'une réservation, lot 2), jamais par
-- un rôle applicatif : EXECUTE au seul catalog_cmd_owner (la personne est celle que la commande
-- a résolue par le jeton de session, jamais un identifiant reçu du client).
CREATE FUNCTION core.ctr_host_terms_required(p_user_id uuid, p_country text)
  RETURNS boolean
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_user_id IS NULL OR p_country IS NULL
      OR COALESCE((SELECT s.reaccept_required
                     FROM core.ctr_host_terms_state(p_user_id, p_country, 'es') AS s), true)
$fn$;

-- 3.2 CGU de l'hôte pour un compte d'hôte de la session : version en vigueur (dans la langue
-- demandée, sinon l'espagnol), BROUILLON ou non, date, version exigée et version acceptée.
-- Issues : OK, AUTH_REQUIRED (session invalide), FORBIDDEN (compte d'un autre ou inconnu : rien
-- n'est révélé), LEGAL_DOCUMENT_UNAVAILABLE (aucun document en vigueur). Aucune donnée C2.
CREATE FUNCTION core.ctr_host_terms(p_token_hash bytea, p_org uuid, p_language text)
  RETURNS TABLE (outcome text, country_code text, version integer, is_major boolean,
                 locale text, title text, content_hash bytea, is_draft boolean,
                 valid_from timestamptz, required_version integer, accepted_version integer,
                 accepted_at timestamptz, reaccept_required boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::integer, NULL::boolean,
                        NULL::text, NULL::text, NULL::bytea, NULL::boolean, NULL::timestamptz,
                        NULL::integer, NULL::integer, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::integer, NULL::boolean,
                        NULL::text, NULL::text, NULL::bytea, NULL::boolean, NULL::timestamptz,
                        NULL::integer, NULL::integer, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT CASE WHEN s.template_id IS NULL THEN 'LEGAL_DOCUMENT_UNAVAILABLE' ELSE 'OK' END,
         v_country, s.version, s.is_major, s.locale, s.title, s.content_hash, s.is_draft,
         s.valid_from, s.required_version, s.accepted_version, s.accepted_at,
         s.reaccept_required
    FROM core.ctr_host_terms_state(v_user, v_country, p_language) AS s;
END
$fn$;

-- 3.3 Acceptation des CGU de l'hôte (version AFFICHÉE exigée) pour un compte d'hôte de la
-- session. Consentement : gabarit en vigueur de la portée du compte dans la langue affichée
-- (repli sur l'espagnol, langue rendue par 3.2), horodatage platform.now(), contexte
-- HOST_ONBOARDING (aucune acceptation antérieure des CGU de l'hôte) ou REACCEPT, pays du compte
-- d'hôte. Issues : DONE (+ version), AUTH_REQUIRED, FORBIDDEN, REQUEST_INVALID,
-- LEGAL_DOCUMENT_UNAVAILABLE, TERMS_VERSION_CHANGED (version affichée périmée : aucune écriture).
CREATE FUNCTION core.ctr_cmd_accept_host_terms(p_token_hash bytea, p_org uuid, p_version integer,
                                               p_language text)
  RETURNS TABLE (outcome text, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
  v_s       record;
  v_context text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::integer;
    RETURN;
  END IF;
  IF p_version IS NULL OR p_version < 1 OR p_language IS NULL
     OR p_language NOT IN ('es', 'en', 'fr', 'pt') THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT * INTO v_s FROM core.ctr_host_terms_state(v_user, v_country, p_language);
  IF v_s.template_id IS NULL THEN
    RETURN QUERY SELECT 'LEGAL_DOCUMENT_UNAVAILABLE'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_s.version <> p_version THEN
    RETURN QUERY SELECT 'TERMS_VERSION_CHANGED'::text, v_s.version;
    RETURN;
  END IF;
  v_context := CASE WHEN EXISTS (SELECT 1 FROM core.contract_consent AS c
                                  WHERE c.user_id = v_user AND c.doc_kind = 'TOS_HOST'
                                    AND c.accepted)
                    THEN 'REACCEPT' ELSE 'HOST_ONBOARDING' END;
  PERFORM core.ctr_record_consent(v_user, v_s.template_id, true, v_context, v_country);
  RETURN QUERY SELECT 'DONE'::text, v_s.version;
END
$fn$;

-- 3.4 Texte d'un document : TOS_HOST admis (corps de 0059 recopié, liste des genres élargie).
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
   WHERE p_kind IN ('TOS_GUEST', 'PRIVACY', 'MARKETING', 'TOS_HOST')
     AND t.kind = p_kind
     AND t.country_code IS NOT DISTINCT FROM cur.country_code
     AND t.version = COALESCE(p_version, cur.version)
     AND t.valid_from <= platform.now()
     AND (t.locale = p_language OR t.is_authoritative)
   ORDER BY (t.locale = p_language) DESC
   LIMIT 1
$fn$;

COMMENT ON FUNCTION core.ctr_host_terms_required(uuid, text) IS
  'Garde des commandes de l''hôte : CGU de l''hôte à (ré)accepter dans le pays du compte '
  '(fail-closed). SECURITY DEFINER, EXECUTE catalog_cmd_owner. US-126 (ADR-100).';
COMMENT ON FUNCTION core.ctr_host_terms(bytea, uuid, text) IS
  'CGU de l''hôte d''un compte d''hôte de la session : version, date, brouillon, version exigée '
  'et acceptée. SECURITY DEFINER, EXECUTE app_api. US-126 (ADR-100).';
COMMENT ON FUNCTION core.ctr_cmd_accept_host_terms(bytea, uuid, integer, text) IS
  'Acceptation des CGU de l''hôte (version affichée exigée) : consentement TOS_HOST versionné. '
  'SECURITY DEFINER, EXECUTE app_api. US-126 (ADR-100).';
COMMENT ON FUNCTION core.ctr_document_body(text, text, text, integer) IS
  'Texte d''un document en vigueur ou passé en vigueur (C0), CGU de l''hôte comprises. SECURITY '
  'DEFINER, EXECUTE app_api. US-102 ; US-126.';

REVOKE ALL ON FUNCTION core.ctr_host_terms_required(uuid, text),
  core.ctr_host_terms(bytea, uuid, text),
  core.ctr_cmd_accept_host_terms(bytea, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ctr_host_terms(bytea, uuid, text),
  core.ctr_cmd_accept_host_terms(bytea, uuid, integer, text) TO app_api;
GRANT EXECUTE ON FUNCTION core.ctr_host_terms_required(uuid, text) TO catalog_cmd_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 4. Publication d'une version : TOS_HOST admis (corps de 0059 recopié, liste des genres
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
     OR p_kind IS NULL OR p_kind NOT IN ('TOS_GUEST', 'PRIVACY', 'MARKETING', 'TOS_HOST')
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
  'Publication d''une version (4 langues), CGU de l''hôte comprises, permission legal.publish, '
  'journalisée. SECURITY DEFINER, EXECUTE app_api. US-102 ; US-126.';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 5. Soumission d'une annonce : garde des CGU de l'hôte (corps de 0067 recopié, une étape
-- ajoutée entre la complétude et l'activation ; propriétaire catalog_cmd_owner) ---------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
CREATE OR REPLACE FUNCTION core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid,
                                                           p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
  v_min    bigint;
  v_photos integer;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- photos (BR-LIST-05, 16 HST-012) : photos non retirées et non refusées
  v_min := core.catalog_param_int('listing_min_photos', h.country_code);
  IF v_min IS NULL OR v_min < 1 THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_photos
    FROM core.catalog_listing_photo AS p
   WHERE p.listing_id = p_listing_id AND p.deleted_at IS NULL AND p.status <> 'REJECTED';
  IF v_photos < v_min THEN
    RETURN QUERY SELECT 'PHOTO_MIN_COUNT'::text, NULL::uuid;
    RETURN;
  END IF;
  -- CGU de l'hôte acceptées dans leur version exigée, dans le pays du compte (19 US-126 ; 16
  -- LEG-001 ; L1-PM-28 : garde dans la commande) ; sinon l'annonce reste DRAFT
  IF core.ctr_host_terms_required(h.user_id, h.country_code) THEN
    RETURN QUERY SELECT 'TERMS_REACCEPT_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- compte d'hôte activé (17 §2.4 ; BOARD N-37) et pays ouvert aux hôtes particuliers (16 HST-005)
  IF h.org_status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.config_go_live('p2p_private_hosts_enabled', h.country_code) THEN
    RETURN QUERY SELECT 'HOST_NOT_ACTIVATED'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET status = 'PENDING_REVIEW', submitted_at = platform.now(), updated_by = h.user_id
   WHERE l.id = p_listing_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (h.user_id, 'P2P_HOST', 'LISTING_SUBMITTED', 'LISTING', p_listing_id,
          pg_catalog.jsonb_build_object('status', 'DRAFT'),
          pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW', 'orgId', p_org,
                                        'country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Soumission SM-2 DRAFT -> PENDING_REVIEW : photos, CGU de l''hôte, compte ACTIVE, pays ouvert ; '
  'journalisée. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; US-126 (ADR-100).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 6. Graine : CGU de l'hôte, version 1 BROUILLON commune aux pays (GABARIT PROVISOIRE, OQ-BR-24,
-- OQ-MK-01) ----------------------------------------------------------------------------------
-- En vigueur dès l'origine (date antérieure à toute horloge de test), majeure : tout hôte
-- l'accepte avant sa première soumission. À remplacer par le texte validé par l'avocat, publié
-- par la console (version 2, majeure) avant la mise en service (GL-15). Aucune clause
-- « définitive et sans appel » (OQ-BR-24 ouverte) ; rien n'est repris des textes de Turo.
INSERT INTO core.contract_document_template
       (kind, country_code, locale, version, is_major, title, body_md, content_hash,
        legal_review_ref, is_authoritative, valid_from)
SELECT 'TOS_HOST', NULL, d.locale, 1, true, d.title, d.body,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, d.locale = 'es',
       '2000-01-01T00:00:00Z'
  FROM (VALUES
    ('es', 'Condiciones del anfitrión (BORRADOR)',
     E'**BORRADOR — plantilla pendiente de validación por el abogado.** Este texto es provisional y no constituye las condiciones definitivas.\n\n1. Partes. Eres una persona física que alquila su propio auto, o un auto cuyo propietario te autorizó, directamente a un viajero. El contrato de alquiler de cada viaje se celebra entre tú y el viajero.\n2. Papel de la plataforma. La plataforma es solo intermediaria entre particulares: no es arrendadora, no es propietaria del auto y no es parte del contrato de alquiler.\n3. Cobros y pagos. La plataforma cobra al viajero en su propio nombre, como comerciante de referencia, y su proveedor de pagos reparte cada pago en montos explícitos: tu parte, la protección, la tarifa de la plataforma y los impuestos. Tu parte depende del plan que elegiste y se paga después del viaje.\n4. Protección. Los planes de protección se venden por cuenta de una aseguradora asociada, que cubre según su póliza.\n5. Tus compromisos. Das datos exactos, mantienes el auto en buen estado y con sus documentos vigentes, lo entregas en el lugar que declaraste y respetas la ley aplicable.\n6. Decisiones. Toda decisión sobre un reclamo se te comunica con sus motivos y puedes impugnarla según el procedimiento publicado.\n7. Cambios. Una nueva versión mayor de estas condiciones te será presentada y deberás aceptarla antes de enviar un anuncio o confirmar una reserva.\n\nEl texto en español hace fe.'),
    ('en', 'Host terms (DRAFT)',
     E'**DRAFT — template pending review by the lawyer.** This text is provisional and is not the final terms.\n\n1. Parties. You are an individual who rents out your own car, or a car whose owner authorized you, directly to a guest. The rental contract for each trip is made between you and the guest.\n2. Role of the platform. The platform is only an intermediary between individuals: it is not the lessor, does not own the car and is not a party to the rental contract.\n3. Collections and payments. The platform collects from the guest in its own name, as merchant of record, and its payment provider splits each payment into explicit amounts: your share, the protection, the platform fee and taxes. Your share depends on the plan you chose and is paid after the trip.\n4. Protection. Protection plans are sold on behalf of a partner insurer, which covers under its policy.\n5. Your commitments. You give accurate details, keep the car in good condition with valid documents, hand it over at the place you declared and comply with the applicable law.\n6. Decisions. Any decision on a claim is sent to you with its reasons, and you may challenge it under the published procedure.\n7. Changes. A new major version of these terms will be shown to you and you must accept it before submitting a listing or confirming a booking.\n\nThe Spanish text prevails.'),
    ('fr', 'Conditions de l''hôte (BROUILLON)',
     E'**BROUILLON — gabarit à valider par l''avocat.** Ce texte est provisoire et ne constitue pas les conditions définitives.\n\n1. Parties. Vous êtes une personne physique qui loue sa propre voiture, ou une voiture dont le propriétaire vous a donné son autorisation, directement à un voyageur. Le contrat de location de chaque trajet est conclu entre vous et le voyageur.\n2. Rôle de la plateforme. La plateforme n''est qu''une intermédiaire entre particuliers : elle n''est pas le loueur, n''est pas propriétaire de la voiture et n''est pas partie au contrat de location.\n3. Encaissements et paiements. La plateforme encaisse le voyageur en son nom, comme marchand de référence, et son prestataire de paiement répartit chaque paiement en montants explicites : votre part, la protection, les frais de la plateforme et les taxes. Votre part dépend du plan que vous avez choisi et vous est versée après le trajet.\n4. Protection. Les plans de protection sont vendus pour le compte d''un assureur partenaire, qui couvre selon sa police.\n5. Vos engagements. Vous fournissez des informations exactes, gardez la voiture en bon état et ses documents à jour, la remettez au lieu que vous avez déclaré et respectez la loi applicable.\n6. Décisions. Toute décision sur une réclamation vous est communiquée avec ses motifs, et vous pouvez la contester selon la procédure publiée.\n7. Modifications. Une nouvelle version majeure de ces conditions vous sera présentée et vous devrez l''accepter avant de soumettre une annonce ou de confirmer une réservation.\n\nLe texte espagnol fait foi.'),
    ('pt', 'Condições do anfitrião (RASCUNHO)',
     E'**RASCUNHO — modelo pendente de validação pelo advogado.** Este texto é provisório e não constitui as condições definitivas.\n\n1. Partes. Você é uma pessoa física que aluga o próprio carro, ou um carro cujo proprietário autorizou você, diretamente a um viajante. O contrato de locação de cada viagem é celebrado entre você e o viajante.\n2. Papel da plataforma. A plataforma é apenas intermediária entre particulares: não é a locadora, não é dona do carro e não é parte do contrato de locação.\n3. Recebimentos e pagamentos. A plataforma recebe do viajante em nome próprio, como comerciante de referência, e seu provedor de pagamentos reparte cada pagamento em valores explícitos: a sua parte, a proteção, a tarifa da plataforma e os impostos. A sua parte depende do plano que você escolheu e é paga depois da viagem.\n4. Proteção. Os planos de proteção são vendidos por conta de uma seguradora parceira, que cobre conforme a sua apólice.\n5. Seus compromissos. Você informa dados corretos, mantém o carro em bom estado e com os documentos em dia, entrega-o no local que declarou e cumpre a legislação aplicável.\n6. Decisões. Toda decisão sobre uma reclamação é comunicada a você com os seus motivos, e você pode contestá-la conforme o procedimento publicado.\n7. Alterações. Uma nova versão principal destas condições será apresentada a você, e você deverá aceitá-la antes de enviar um anúncio ou confirmar uma reserva.\n\nO texto em espanhol prevalece.')
  ) AS d(locale, title, body);
