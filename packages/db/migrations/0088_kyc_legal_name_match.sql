-- 0088 — KYC : nom légal du compte rapproché du nom lu sur le permis, changement du nom légal.
-- US-103 ; 19 US-103 (« Given un compte approuvé, When le nom change, Then SM-3 passe RECHECK et
-- la remise est bloquée » ; « Given un contrat généré, When on le compare au compte, Then nom
-- identique caractère pour caractère ») ; 16 ACC-006 (`legal_first_name`, `legal_last_name`, deux
-- apellidos, `PROFILE_NAME_REQUIRED`, `PROFILE_NAME_LOCKED_PENDING_REVIEW`, nom différent du permis
-- ⇒ revue, modification après approbation ⇒ `RECHECK`), VER-001 (comparaison au fournisseur) ;
-- 08 BR-ACC-07 ; 17 §3.2.1, §3.2.2, §4.5 ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo ») ;
-- ADR-102, ADR-106, ADR-110 ; ADR-117 (cette migration). Appliquée sous `migrator`.
--
-- Principes (ADR-117, PROPOSÉ) :
--   - le fournisseur d'identité rend, avec les champs minimaux du permis, le NOM DU TITULAIRE lu
--     sur la pièce (prénoms, noms de famille) [C2] ; la base le garde dans
--     `kyc_identity_document` (`holder_given_names`, `holder_surnames`) avec le verdict
--     `name_match`, jamais dans un journal ni un événement ;
--   - RAPPROCHEMENT AUTOMATIQUE (fonction pure `core.kyc_legal_name_match`), tolérant aux écarts
--     courants en Amérique latine et au Brésil : casse, accents et signes (NFD, marques retirées),
--     apostrophes, ponctuation et tirets, particules (de, del, la, las, los, da, das, do, dos, di, du, y, e),
--     deuxième prénom absent, un seul des deux noms de famille (paterno ou materno), noms saisis
--     dans le mauvais champ. Verdict : MATCH si chaque mot du nom déclaré figure sur le permis, au
--     moins un prénom ET au moins un nom de famille du permis figurant dans le nom déclaré ;
--     MISSING si le permis ne rend pas de prénom ou de nom de famille lisible ; MISMATCH sinon ;
--   - la décision du fournisseur (`core.kyc_cmd_apply_decision`, corps de 0072 recopié, seule la
--     fin du jugement change, marquée US-103) n'approuve que sur MATCH ; MISMATCH ⇒
--     `MANUAL_REVIEW` motif `LEGAL_NAME_MISMATCH`, MISSING ⇒ `MANUAL_REVIEW` motif
--     `LEGAL_NAME_MISSING` (fail-closed) : la personne entre dans la file KYC existante (US-106,
--     déclencheur de 0076), l'ops tranche avec le nom du permis sous les yeux ; aucune pièce de plus,
--     aucune revue humaine sur un nom concordant ;
--   - CHANGEMENT DU NOM LÉGAL par la personne (`core.kyc_cmd_change_legal_name`) : seule écriture
--     des colonnes de nom du compte après l'inscription ; refusé pendant une décision en cours
--     (AUTO_CHECKS, MANUAL_REVIEW, APPEAL : `LOCKED_PENDING_REVIEW`) ; un dossier APPROVED passe
--     `RECHECK` (motif `LEGAL_NAME_CHANGED`, tentative suivante, session effacée, approbation
--     retirée) : paiement et remise refusés (`core.kyc_driver_eligibility` ⇒ KYC_NOT_APPROVED)
--     jusqu'à une nouvelle vérification, qui rapproche le NOUVEAU nom du permis ; audit
--     `LEGAL_NAME_CHANGED` (statuts seulement, jamais un nom) ;
--   - le nom du compte est gardé tel que saisi (espaces de bord retirés, espaces internes réduits à
--     un seul) : c'est lui, caractère pour caractère, que reprendront le contrat (BKG-018, LEG-026)
--     et le contrôle de remise ; le rapprochement ne le réécrit jamais ;
--   - signal `SAME_IDENTITY` d'ADR-110 (`core.risk_self_booking_signal`, corps de 0080 recopié) :
--     la clé de nom est celle du NOM LU SUR LE PERMIS (vérifié) quand le dossier approuvé en a un,
--     sinon celle du nom déclaré ; clé = mots normalisés par la même fonction (particules
--     retirées), triés ;
--   - dossier KYC de la file (`core.kyc_staff_dossier`, corps de 0076 recopié) : nom lu sur le
--     permis et verdict du rapprochement en plus.
--
-- Écarts PROPOSÉS avec 17 §3.2.2 (à reporter, ADR-117) : `identity_document` gagne
-- `holder_given_names`, `holder_surnames` [C2] et `name_match` ; `user_account.name_changed_at`
-- (16 ACC-006) n'est pas ajoutée : l'instant du changement est celui de l'audit.
--
-- Retour arrière :
--   réappliquer les définitions de 0072 de core.kyc_cmd_apply_decision et de 0076 de
--     core.kyc_staff_dossier (sous kyc_cmd_owner), de 0080 de core.risk_self_booking_signal (sous
--     risk_limit_owner) ;
--   DROP FUNCTION core.kyc_cmd_change_legal_name(bytea, text, text),
--     core.kyc_legal_name_match(text, text, text, text), core.kyc_legal_name_key(text, text),
--     core.kyc_name_tokens(text);
--   ALTER TABLE core.kyc_identity_document DROP COLUMN holder_given_names,
--     DROP COLUMN holder_surnames, DROP COLUMN name_match ;
--   DROP POLICY kyc_cmd_name_update ON core.iam_user_account ;
--   DROP POLICY kyc_cmd_name_audit_insert ON core.audit_audit_log ;
--   DROP POLICY risk_link_read ON core.kyc_identity_document ;
--   DROP INDEX core.iam_organization_holder_idx, core.membership_org_live_idx,
--     core.kyc_identity_verification_approved_user_idx ; révoquer les droits ci-dessous.

-- 1. Colonnes du permis : nom du titulaire et verdict du rapprochement -------------------------
ALTER TABLE core.kyc_identity_document
  ADD COLUMN holder_given_names text                                        -- [C2]
    CONSTRAINT kyc_identity_document_given_names_length
      CHECK (holder_given_names IS NULL OR pg_catalog.char_length(holder_given_names) BETWEEN 1 AND 200),
  ADD COLUMN holder_surnames    text                                        -- [C2]
    CONSTRAINT kyc_identity_document_surnames_length
      CHECK (holder_surnames IS NULL OR pg_catalog.char_length(holder_surnames) BETWEEN 1 AND 200),
  ADD COLUMN name_match         text
    CONSTRAINT kyc_identity_document_name_match_valid
      CHECK (name_match IS NULL OR name_match IN ('MATCH', 'MISMATCH', 'MISSING'));
COMMENT ON COLUMN core.kyc_identity_document.holder_given_names IS
  'Prénoms du titulaire lus sur la pièce par le fournisseur [C2] ; jamais journalisés. US-103.';
COMMENT ON COLUMN core.kyc_identity_document.holder_surnames IS
  'Noms de famille du titulaire lus sur la pièce par le fournisseur [C2]. US-103.';
COMMENT ON COLUMN core.kyc_identity_document.name_match IS
  'Rapprochement du nom légal du compte et du nom lu (core.kyc_legal_name_match) à la décision : '
  'MATCH, MISMATCH, MISSING ; NULL avant US-103. US-103 (ADR-117).';

-- 2. Fonctions pures du rapprochement (SECURITY INVOKER, IMMUTABLE) ----------------------------
-- Mots normalisés d'un nom : apostrophes retirées sans séparer (D'Ávila = Dávila), décomposition
-- canonique (NFD), marques diacritiques retirées, minuscules (ASCII), tout ce qui n'est pas une
-- lettre a-z devient un séparateur (espaces, tirets, points) ; particules
-- retirées, sauf si le nom n'est fait que de particules. Ordre conservé.
CREATE FUNCTION core.kyc_name_tokens(p_name text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH w AS (
    SELECT pg_catalog.string_to_array(
             pg_catalog.btrim(pg_catalog.regexp_replace(
               pg_catalog.lower(pg_catalog.regexp_replace(
                 pg_catalog.normalize(
                   pg_catalog.regexp_replace(COALESCE(p_name, ''), '[''`\u00b4\u2018\u2019]', '', 'g'),
                   'NFD'),
                 '[\u0300-\u036f]', '', 'g')
                 COLLATE "C"),
               '[^a-z]+', ' ', 'g')),
             ' ') AS all_words
  ),
  k AS (
    SELECT w.all_words,
           ARRAY(SELECT t.word
                   FROM pg_catalog.unnest(w.all_words) WITH ORDINALITY AS t(word, n)
                  WHERE t.word <> ALL (ARRAY['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do',
                                             'dos', 'di', 'du', 'y', 'e'])
                  ORDER BY t.n) AS kept
      FROM w
  )
  SELECT CASE WHEN pg_catalog.cardinality(k.kept) > 0 THEN k.kept
              ELSE COALESCE(k.all_words, '{}'::text[]) END
    FROM k
$fn$;
COMMENT ON FUNCTION core.kyc_name_tokens(text) IS
  'Mots normalisés d''un nom (casse, accents, ponctuation, particules) pour le rapprochement du nom '
  'légal (ADR-117). Pure. US-103.';

-- Verdict du rapprochement du nom déclaré (prénoms, noms) et du nom lu sur le permis.
CREATE FUNCTION core.kyc_legal_name_match(p_declared_first text, p_declared_last text,
                                          p_license_given text, p_license_surnames text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (
    SELECT core.kyc_name_tokens(p_declared_first) || core.kyc_name_tokens(p_declared_last) AS d,
           core.kyc_name_tokens(p_license_given) AS g,
           core.kyc_name_tokens(p_license_surnames) AS s
  )
  SELECT CASE
           WHEN pg_catalog.cardinality(t.g) = 0 OR pg_catalog.cardinality(t.s) = 0 THEN 'MISSING'
           WHEN pg_catalog.cardinality(t.d) > 0
                AND t.d <@ (t.g || t.s) AND t.d && t.g AND t.d && t.s THEN 'MATCH'
           ELSE 'MISMATCH' END
    FROM t
$fn$;
COMMENT ON FUNCTION core.kyc_legal_name_match(text, text, text, text) IS
  'Rapprochement automatique du nom légal du compte et du nom lu sur le permis (ADR-117, '
  'PROPOSÉ) : MATCH, MISMATCH, MISSING. Pure. US-103.';

-- Clé de nom du signal SAME_IDENTITY : mots normalisés triés des prénoms, puis des noms.
CREATE FUNCTION core.kyc_legal_name_key(p_given text, p_surnames text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.array_to_string(ARRAY(SELECT DISTINCT x FROM pg_catalog.unnest(
           core.kyc_name_tokens(p_given)) AS x ORDER BY x), ' ')
         || '|'
         || pg_catalog.array_to_string(ARRAY(SELECT DISTINCT x FROM pg_catalog.unnest(
           core.kyc_name_tokens(p_surnames)) AS x ORDER BY x), ' ')
$fn$;
COMMENT ON FUNCTION core.kyc_legal_name_key(text, text) IS
  'Clé de nom normalisée (mots triés des prénoms | des noms) du signal SAME_IDENTITY (ADR-110, '
  'ADR-117). Pure. US-103.';

REVOKE ALL ON FUNCTION core.kyc_name_tokens(text), core.kyc_legal_name_match(text, text, text, text),
  core.kyc_legal_name_key(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_name_tokens(text),
  core.kyc_legal_name_match(text, text, text, text), core.kyc_legal_name_key(text, text)
  TO kyc_cmd_owner, risk_limit_owner;

-- 3. Droits de kyc_cmd_owner -------------------------------------------------------------------
-- nom légal du compte : lu par la décision (rapprochement), écrit par le seul changement du nom
GRANT SELECT (legal_first_name, legal_last_name) ON core.iam_user_account TO kyc_cmd_owner;
GRANT UPDATE (legal_first_name, legal_last_name) ON core.iam_user_account TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_name_update ON core.iam_user_account FOR UPDATE TO kyc_cmd_owner
  USING (pseudonymized_at IS NULL AND status IN ('ACTIVE', 'RESTRICTED'))
  WITH CHECK (pseudonymized_at IS NULL AND status IN ('ACTIVE', 'RESTRICTED'));
-- audit du changement de nom (statuts seulement)
CREATE POLICY kyc_cmd_name_audit_insert ON core.audit_audit_log FOR INSERT TO kyc_cmd_owner
  WITH CHECK (action_code = 'LEGAL_NAME_CHANGED' AND subject_type = 'USER_ACCOUNT');

-- 4. Droits de risk_limit_owner : nom lu sur le permis (signal SAME_IDENTITY) -----------------
GRANT SELECT (id, verification_id, holder_given_names, holder_surnames, created_at)
  ON core.kyc_identity_document TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.kyc_identity_document FOR SELECT TO risk_limit_owner
  USING (holder_given_names IS NOT NULL AND holder_surnames IS NOT NULL);

-- 5. Sous kyc_cmd_owner : décision du fournisseur, dossier du staff, changement du nom ----------
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

-- 5.1 Décision du fournisseur (définition de 0072 recopiée ; seuls la lecture du nom du titulaire,
-- le rapprochement, son motif et son enregistrement changent, marqués US-103). Voir 0072 §9 pour
-- l'idempotence, la session, le consentement et les transitions. Motifs ajoutés, après ceux du
-- permis : LEGAL_NAME_MISSING (nom du titulaire absent ou illisible), LEGAL_NAME_MISMATCH.
CREATE OR REPLACE FUNCTION core.kyc_cmd_apply_decision(p_provider text, p_event_id text,
                                                       p_session_ref text, p_subject_ref text,
                                                       p_decision text, p_liveness numeric,
                                                       p_face_match numeric, p_document jsonb)
  RETURNS TABLE (outcome text, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now      timestamptz := platform.now();
  v_event    uuid;
  v_user     uuid;
  v_v        record;
  v_tz       text;
  v_type     text;
  v_country  text;
  v_expiry   date;
  v_class    text;
  v_perm     boolean;
  v_ref      text;
  v_doc_ok   boolean := false;
  v_end      timestamptz;
  v_final    text;
  v_reason   text;
  v_version  integer;
  -- US-103 : nom du titulaire lu sur la pièce et rapprochement du nom légal du compte
  v_given    text;
  v_surnames text;
  v_first    text;
  v_last     text;
  v_match    text;
BEGIN
  IF p_provider IS NULL OR p_provider !~ '^[A-Z][A-Z0-9_]{1,31}$'
     OR p_event_id IS NULL OR pg_catalog.length(p_event_id) NOT BETWEEN 1 AND 200
     OR p_session_ref IS NULL OR pg_catalog.length(p_session_ref) NOT BETWEEN 1 AND 200
     OR p_subject_ref IS NULL OR pg_catalog.length(p_subject_ref) NOT BETWEEN 1 AND 200
     OR p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'DECLINED', 'REVIEW')
     OR (p_liveness IS NOT NULL AND p_liveness NOT BETWEEN 0 AND 1)
     OR (p_face_match IS NOT NULL AND p_face_match NOT BETWEEN 0 AND 1)
     OR (p_document IS NOT NULL AND pg_catalog.jsonb_typeof(p_document) <> 'object') THEN
    RAISE EXCEPTION 'kyc : décision invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RETURN QUERY SELECT 'PRODUCTION_BLOCKED'::text, NULL::text;
    RETURN;
  END IF;
  SELECT v.user_id INTO v_user FROM core.kyc_identity_verification AS v
   WHERE v.provider = p_provider AND v.provider_session_ref = p_session_ref
     AND v.id::text = p_subject_ref AND v.is_current;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN_SESSION'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.provider = p_provider AND v.provider_session_ref = p_session_ref
     AND v.id::text = p_subject_ref AND v.is_current;
  IF v_v.id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN_SESSION'::text, NULL::text;
    RETURN;
  END IF;
  INSERT INTO core.kyc_provider_event (provider, event_id, session_ref, decision)
  VALUES (p_provider, p_event_id, p_session_ref, p_decision)
  ON CONFLICT ON CONSTRAINT kyc_provider_event_unique DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, NULL::text;
    RETURN;
  END IF;
  IF core.kyc_consent_current(v_user, v_v.country_code::text) IS NULL THEN
    UPDATE core.kyc_provider_event AS e SET outcome = 'CONSENT_WITHDRAWN' WHERE e.id = v_event;
    RETURN QUERY SELECT 'CONSENT_WITHDRAWN'::text, v_v.status;
    RETURN;
  END IF;
  IF v_v.status <> 'DOCS_SUBMITTED' THEN
    UPDATE core.kyc_provider_event AS e SET outcome = 'STALE' WHERE e.id = v_event;
    RETURN QUERY SELECT 'STALE'::text, v_v.status;
    RETURN;
  END IF;

  IF p_document IS NOT NULL THEN
    v_type := p_document ->> 'kind';
    v_country := p_document ->> 'country';
    v_class := NULLIF(pg_catalog.btrim(COALESCE(p_document ->> 'licenseClass', '')), '');
    v_ref := NULLIF(pg_catalog.btrim(COALESCE(p_document ->> 'providerDocumentRef', '')), '');
    v_perm := CASE pg_catalog.jsonb_typeof(p_document -> 'isPermanent')
                WHEN 'boolean' THEN (p_document ->> 'isPermanent')::boolean END;
    IF COALESCE(p_document ->> 'expiresOn', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_expiry := (p_document ->> 'expiresOn')::date;
      EXCEPTION WHEN others THEN
        v_expiry := NULL;
      END;
    END IF;
    v_doc_ok := v_type IN ('DRIVER_LICENSE', 'NATIONAL_ID', 'FOREIGN_RESIDENT_ID', 'PASSPORT', 'IDP')
                AND COALESCE(v_country ~ '^[A-Z]{2}$', false)
                AND (v_class IS NULL OR pg_catalog.length(v_class) <= 20)
                AND (v_ref IS NULL OR pg_catalog.length(v_ref) <= 200);
    -- US-103 : nom du titulaire (texte de 1 à 200 caractères, sans caractère de contrôle) ; mal
    -- formé = absent (jamais une erreur qui perdrait la décision)
    IF pg_catalog.jsonb_typeof(p_document -> 'holderGivenNames') = 'string' THEN
      v_given := pg_catalog.btrim(p_document ->> 'holderGivenNames');
    END IF;
    IF pg_catalog.jsonb_typeof(p_document -> 'holderSurnames') = 'string' THEN
      v_surnames := pg_catalog.btrim(p_document ->> 'holderSurnames');
    END IF;
    IF v_given IS NOT NULL AND (pg_catalog.char_length(v_given) NOT BETWEEN 1 AND 200
                                OR v_given ~ '[[:cntrl:]]') THEN
      v_given := NULL;
    END IF;
    IF v_surnames IS NOT NULL AND (pg_catalog.char_length(v_surnames) NOT BETWEEN 1 AND 200
                                   OR v_surnames ~ '[[:cntrl:]]') THEN
      v_surnames := NULL;
    END IF;
  END IF;

  -- US-103 : rapprochement du nom légal du compte et du nom lu sur la pièce
  IF v_doc_ok THEN
    SELECT u.legal_first_name, u.legal_last_name INTO v_first, v_last
      FROM core.iam_user_account AS u WHERE u.id = v_v.user_id;
    v_match := core.kyc_legal_name_match(v_first, v_last, v_given, v_surnames);
  END IF;

  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code = v_v.country_code;
  IF v_doc_ok AND v_expiry IS NOT NULL THEN
    v_end := ((v_expiry + 1)::timestamp AT TIME ZONE v_tz);
  END IF;
  v_reason := CASE
    WHEN p_decision = 'REVIEW' THEN 'PROVIDER_REVIEW'
    WHEN p_decision = 'DECLINED' THEN 'PROVIDER_DECLINED'
    WHEN NOT v_doc_ok THEN 'DOCUMENT_MISSING'
    WHEN v_type <> 'DRIVER_LICENSE' THEN 'DOCUMENT_NOT_LICENSE'
    WHEN v_perm IS NOT TRUE THEN 'LICENSE_PROVISIONAL'
    WHEN v_end IS NULL OR v_end <= v_now THEN 'LICENSE_EXPIRED'
    -- US-103 : nom du permis absent (fail-closed) ou discordant ⇒ file KYC (US-106)
    WHEN v_match = 'MISMATCH' THEN 'LEGAL_NAME_MISMATCH'
    WHEN v_match IS DISTINCT FROM 'MATCH' THEN 'LEGAL_NAME_MISSING'
    ELSE NULL END;
  v_final := CASE WHEN v_reason IS NULL THEN 'APPROVED' ELSE 'MANUAL_REVIEW' END;

  IF v_doc_ok THEN
    INSERT INTO core.kyc_identity_document (verification_id, user_id, attempt, doc_type,
                                            issuing_country, expiry_date, license_class,
                                            is_permanent, provider_document_ref, status,
                                            holder_given_names, holder_surnames, name_match)
    VALUES (v_v.id, v_v.user_id, v_v.attempt, v_type, v_country, v_expiry, v_class, v_perm, v_ref,
            CASE WHEN v_final = 'APPROVED' THEN 'ACCEPTED' ELSE 'IN_REVIEW' END,
            v_given, v_surnames, v_match);
  END IF;
  INSERT INTO core.kyc_liveness_check (verification_id, user_id, attempt, liveness_score,
                                       face_match_score, result, provider_session_ref,
                                       retention_until)
  VALUES (v_v.id, v_v.user_id, v_v.attempt, p_liveness, p_face_match, p_decision, p_session_ref,
          v_now + pg_catalog.make_interval(days => core.kyc_retention_days(v_v.country_code::text)));

  v_version := v_v.row_version + 2;
  UPDATE core.kyc_identity_verification AS v
     SET status = v_final, decision_reason_code = v_reason,
         approved_at = CASE WHEN v_final = 'APPROVED' THEN v_now END,
         expires_at = CASE WHEN v_final = 'APPROVED' THEN v_end END,
         row_version = v_version, updated_at = v_now
   WHERE v.id = v_v.id;
  PERFORM core.kyc_emit_status(v_v.id, v_v.user_id, v_v.row_version + 1, 'DOCS_SUBMITTED',
                               'AUTO_CHECKS', NULL, v_v.country_code::text, NULL, 'SYSTEM');
  PERFORM core.kyc_emit_status(v_v.id, v_v.user_id, v_version, 'AUTO_CHECKS', v_final, v_reason,
                               v_v.country_code::text, NULL, 'SYSTEM');
  UPDATE core.kyc_provider_event AS e SET outcome = 'APPLIED' WHERE e.id = v_event;
  RETURN QUERY SELECT 'APPLIED'::text, v_final;
END
$fn$;

-- 5.2 Dossier KYC du staff (définition de 0076 recopiée ; le document rend en plus le nom lu sur
-- le permis et le verdict du rapprochement, marqués US-103). Appelé par
-- core.support_staff_kyc_dossier APRÈS la ligne READ_C3 du journal d'accès, et par elle seule.
CREATE OR REPLACE FUNCTION core.kyc_staff_dossier(p_user uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_v record;
  v_d record;
  v_l record;
BEGIN
  SELECT v.id, v.status, v.decision_reason_code, v.attempt, v.country_code, v.updated_at
    INTO v_v
    FROM core.kyc_identity_verification AS v WHERE v.user_id = p_user AND v.is_current;
  IF v_v.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'NOT_STARTED', 'verification', NULL);
  END IF;
  SELECT d.doc_type, d.issuing_country, d.expiry_date, d.license_class, d.is_permanent, d.status,
         d.holder_given_names, d.holder_surnames, d.name_match
    INTO v_d
    FROM core.kyc_identity_document AS d
   WHERE d.verification_id = v_v.id AND d.attempt = v_v.attempt
   ORDER BY d.created_at DESC, d.id DESC LIMIT 1;
  SELECT l.result, l.liveness_score, l.face_match_score, l.erased_at IS NOT NULL AS erased
    INTO v_l
    FROM core.kyc_liveness_check AS l
   WHERE l.verification_id = v_v.id AND l.attempt = v_v.attempt
   ORDER BY l.created_at DESC, l.id DESC LIMIT 1;
  RETURN pg_catalog.jsonb_build_object(
    'status', v_v.status,
    'verification', pg_catalog.jsonb_build_object(
      'id', v_v.id, 'status', v_v.status, 'reasonCode', v_v.decision_reason_code,
      'attempt', v_v.attempt, 'country', v_v.country_code, 'updatedAt', v_v.updated_at,
      'consentCurrent', core.kyc_consent_current(p_user, v_v.country_code::text) IS NOT NULL,
      'document', CASE WHEN v_d.doc_type IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'type', v_d.doc_type, 'issuingCountry', v_d.issuing_country,
        'expiresOn', v_d.expiry_date, 'licenseClass', v_d.license_class,
        'permanent', v_d.is_permanent, 'status', v_d.status,
        -- US-103 : nom lu sur le permis et verdict du rapprochement
        'holderGivenNames', v_d.holder_given_names, 'holderSurnames', v_d.holder_surnames,
        'nameMatch', v_d.name_match) END,
      'liveness', CASE WHEN v_l.result IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'result', v_l.result, 'livenessScore', v_l.liveness_score,
        'faceMatchScore', v_l.face_match_score, 'erased', v_l.erased) END));
END
$fn$;

RESET ROLE;

-- 5.3 Changement du nom légal par la personne de la session (SECURITY DEFINER, EXECUTE app_api ;
-- créée sous migrator, droits posés, puis donnée à kyc_cmd_owner comme en 0072).
-- Prénoms et noms : espaces de bord retirés, espaces internes réduits à un seul, 1 à 100
-- caractères, aucun caractère de contrôle (sinon NAME_REQUIRED, rien n'est écrit). Même nom
-- (caractère pour caractère) : UNCHANGED, rien n'est écrit. Sous le verrou de la personne (même
-- clé que l'ouverture, le rappel, le retrait et la décision de l'ops) : décision en cours
-- (AUTO_CHECKS, MANUAL_REVIEW, APPEAL) ⇒ LOCKED_PENDING_REVIEW ; dossier clos par l'ops (EXPIRED,
-- REVOKED, REJECTED, REJECTED_FINAL, BANNED) ⇒ NOT_ELIGIBLE (correction par l'ops) ; sinon le nom
-- est écrit et un dossier APPROVED passe RECHECK (motif LEGAL_NAME_CHANGED, tentative suivante,
-- session effacée, approbation retirée), avec l'événement kyc.verification.status_changed ; audit
-- LEGAL_NAME_CHANGED (statuts seulement, jamais un nom).
-- Issues : CHANGED, UNCHANGED, AUTH_REQUIRED, NOT_ELIGIBLE (compte fermé, pseudonymisé, e-mail non
-- vérifié, dossier clos), NAME_REQUIRED, LOCKED_PENDING_REVIEW ; statut SM-3 rendu.
CREATE FUNCTION core.kyc_cmd_change_legal_name(p_token_hash bytea, p_first text, p_last text)
  RETURNS TABLE (outcome text, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_acc    record;
  v_v      record;
  v_now    timestamptz := platform.now();
  v_first  text := pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_first, '')), '\s+', ' ', 'g');
  v_last   text := pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_last, '')), '\s+', ' ', 'g');
  v_before text;
  v_after  text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text;
    RETURN;
  END IF;
  IF pg_catalog.char_length(v_first) NOT BETWEEN 1 AND 100
     OR pg_catalog.char_length(v_last) NOT BETWEEN 1 AND 100
     OR v_first ~ '[[:cntrl:]]' OR v_last ~ '[[:cntrl:]]' THEN
    RETURN QUERY SELECT 'NAME_REQUIRED'::text, NULL::text;
    RETURN;
  END IF;
  -- changement, ouverture, rappel, retrait et décision de l'ops d'une personne : un seul à la fois
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  SELECT u.id, u.status, u.email_verified_at, u.pseudonymized_at, u.legal_first_name,
         u.legal_last_name
    INTO v_acc
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  IF v_acc.id IS NULL OR v_acc.email_verified_at IS NULL OR v_acc.pseudonymized_at IS NOT NULL
     OR v_acc.status NOT IN ('ACTIVE', 'RESTRICTED') THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::text;
    RETURN;
  END IF;
  -- lecture sans FOR UPDATE (la politique UPDATE ne masque rien ici, mais même règle que 0072)
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;
  v_before := COALESCE(v_v.status, 'NOT_STARTED');
  IF v_before IN ('AUTO_CHECKS', 'MANUAL_REVIEW', 'APPEAL') THEN
    RETURN QUERY SELECT 'LOCKED_PENDING_REVIEW'::text, v_before;
    RETURN;
  END IF;
  IF v_before NOT IN ('NOT_STARTED', 'PHONE_VERIFIED', 'DOCS_SUBMITTED', 'MORE_INFO_REQUIRED',
                      'RECHECK', 'APPROVED') THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, v_before;
    RETURN;
  END IF;
  IF v_acc.legal_first_name = v_first AND v_acc.legal_last_name = v_last THEN
    RETURN QUERY SELECT 'UNCHANGED'::text, v_before;
    RETURN;
  END IF;

  UPDATE core.iam_user_account AS u
     SET legal_first_name = v_first, legal_last_name = v_last
   WHERE u.id = v_user;
  v_after := v_before;
  IF v_before = 'APPROVED' THEN
    UPDATE core.kyc_identity_verification AS v
       SET status = 'RECHECK', decision_reason_code = 'LEGAL_NAME_CHANGED',
           attempt = v_v.attempt + 1, provider_session_ref = NULL, hosted_url = NULL,
           session_expires_at = NULL, approved_at = NULL, expires_at = NULL,
           row_version = v_v.row_version + 1, updated_at = v_now
     WHERE v.id = v_v.id;
    PERFORM core.kyc_emit_status(v_v.id, v_user, v_v.row_version + 1, 'APPROVED', 'RECHECK',
                                 'LEGAL_NAME_CHANGED', v_v.country_code::text, v_user, 'GUEST');
    v_after := 'RECHECK';
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'LEGAL_NAME_CHANGED', 'USER_ACCOUNT', v_user,
          pg_catalog.jsonb_build_object('status', v_before),
          pg_catalog.jsonb_build_object('status', v_after));
  RETURN QUERY SELECT 'CHANGED'::text, v_after;
END
$fn$;
COMMENT ON FUNCTION core.kyc_cmd_change_legal_name(bytea, text, text) IS
  'Changement du nom légal par la personne (16 ACC-006, BR-ACC-07) : refusé pendant une décision '
  'en cours ; dossier APPROVED ⇒ RECHECK (LEGAL_NAME_CHANGED), nouvelle vérification exigée ; '
  'audit sans nom. SECURITY DEFINER, EXECUTE app_api. US-103 (ADR-117).';
REVOKE ALL ON FUNCTION core.kyc_cmd_change_legal_name(bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_cmd_change_legal_name(bytea, text, text) TO app_api;
ALTER FUNCTION core.kyc_cmd_change_legal_name(bytea, text, text) OWNER TO kyc_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 6. Index du chemin de la pose (US-103 ; revue d'US-127 ; deux dépassements du p95 de pose de
-- L0-02) : jointures et filtres de core.risk_self_booking_signal, appelée à chaque pose. Tables
-- petites en Bêta, création dans la transaction de la migration (aucune migration du projet
-- n'utilise CONCURRENTLY). Les autres chemins ont déjà leur index : risk_account_link
-- (risk_account_link_pair_unique), kyc_identity_subject (kyc_identity_subject_attempt_unique),
-- kyc_identity_document (kyc_identity_document_verification_idx), iam_user_account (clé
-- primaire ; le téléphone est comparé entre comptes déjà désignés).
-- comptes d'hôte d'un même titulaire (o2.holder_user_id = o.holder_user_id) : l'unicité
-- (country_code, holder_user_id) ne sert pas une recherche par titulaire seul
CREATE INDEX iam_organization_holder_idx ON core.iam_organization (holder_user_id);
-- membres vivants (ACTIVE, INVITED) d'un compte d'hôte : l'unicité (user_id, org_id, role) commence
-- par la personne
CREATE INDEX membership_org_live_idx ON core.iam_membership (org_id, user_id)
  WHERE status IN ('ACTIVE', 'INVITED');
-- vérification approuvée d'une personne (courante ou non) : l'unicité partielle ne couvre que la
-- vérification courante
CREATE INDEX kyc_identity_verification_approved_user_idx
  ON core.kyc_identity_verification (user_id) WHERE approved_at IS NOT NULL;

-- 7. Sous risk_limit_owner : signal SAME_IDENTITY sur le nom lu sur le permis ------------------
-- (définition de 0080 recopiée ; seuls les CTE d'identité changent, marqués US-103 : clé du nom
-- lu sur le permis, voyageur et côté hôte lus par clé)
GRANT CREATE ON SCHEMA core TO risk_limit_owner;
SET LOCAL ROLE risk_limit_owner;
CREATE OR REPLACE FUNCTION core.risk_self_booking_signal(p_guest uuid, p_org uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH host AS (
    SELECT o.holder_user_id AS user_id FROM core.iam_organization AS o WHERE o.id = p_org
    UNION
    SELECT m.user_id
      FROM core.iam_organization AS o
      JOIN core.iam_organization AS o2 ON o2.holder_user_id = o.holder_user_id
      JOIN core.iam_membership AS m ON m.org_id = o2.id AND m.status IN ('ACTIVE', 'INVITED')
     WHERE o.id = p_org
  ),
  pair AS (
    SELECT h.user_id, l.decision, l.signal
      FROM host AS h
      LEFT JOIN core.risk_account_link AS l
        ON l.user_low = LEAST(h.user_id, p_guest) AND l.user_high = GREATEST(h.user_id, p_guest)
  ),
  auto_host AS (
    SELECT p.user_id FROM pair AS p WHERE p.decision IS DISTINCT FROM 'NOT_LINKED'
  ),
  -- identité vérifiée : US-103, clé du NOM LU SUR LE PERMIS de la vérification approuvée (le plus
  -- récent), sinon du nom légal déclaré ; date de naissance rendue par le fournisseur ; comptes
  -- pseudonymisés exclus. US-103 (performance de la pose) : le voyageur et les personnes du côté
  -- hôte sont lus séparément, par clé (plus de `u.id = p_guest OR u.id IN (…)`, qui parcourait
  -- les comptes) ; un voyageur sans identité vérifiée (cas courant) ne lit aucune identité de
  -- l'hôte. Même résultat qu'en 0080 (h.user_id <> g.user_id : le voyageur exclu côté hôte).
  ident_guest AS (
    SELECT u.id AS user_id,
           COALESCE(
             (SELECT core.kyc_legal_name_key(d.holder_given_names, d.holder_surnames)
                FROM core.kyc_identity_document AS d
               WHERE d.verification_id = v.id
               ORDER BY d.created_at DESC, d.id DESC LIMIT 1),
             core.kyc_legal_name_key(u.legal_first_name, u.legal_last_name)) AS name_key,
           s.date_of_birth
      FROM core.iam_user_account AS u
      JOIN core.kyc_identity_verification AS v ON v.user_id = u.id AND v.approved_at IS NOT NULL
      JOIN core.kyc_identity_subject AS s
        ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
     WHERE u.id = p_guest AND u.pseudonymized_at IS NULL
  ),
  ident_host AS (
    SELECT u.id AS user_id,
           COALESCE(
             (SELECT core.kyc_legal_name_key(d.holder_given_names, d.holder_surnames)
                FROM core.kyc_identity_document AS d
               WHERE d.verification_id = v.id
               ORDER BY d.created_at DESC, d.id DESC LIMIT 1),
             core.kyc_legal_name_key(u.legal_first_name, u.legal_last_name)) AS name_key,
           s.date_of_birth
      FROM auto_host AS a
      JOIN core.iam_user_account AS u ON u.id = a.user_id
      JOIN core.kyc_identity_verification AS v ON v.user_id = u.id AND v.approved_at IS NOT NULL
      JOIN core.kyc_identity_subject AS s
        ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
     WHERE u.pseudonymized_at IS NULL AND u.id <> p_guest
       AND EXISTS (SELECT 1 FROM ident_guest)
  ),
  signals AS (
    SELECT 0 AS rank, 'DIRECT' AS signal
     WHERE p_guest IS NULL OR p_org IS NULL OR NOT EXISTS (SELECT 1 FROM host)
    UNION ALL
    SELECT 1, 'DIRECT' WHERE EXISTS (SELECT 1 FROM host AS h WHERE h.user_id = p_guest)
    UNION ALL
    SELECT 2, p.signal FROM pair AS p WHERE p.decision = 'LINKED'
    UNION ALL
    SELECT 3, 'SAME_IDENTITY'
     WHERE EXISTS (SELECT 1
                     FROM ident_guest AS g
                     JOIN ident_host AS h ON h.name_key = g.name_key
                                         AND h.date_of_birth = g.date_of_birth
                    WHERE g.name_key <> '|')
    UNION ALL
    SELECT 4, 'SAME_PHONE'
     WHERE EXISTS (SELECT 1
                     FROM core.iam_user_account AS g
                     JOIN core.iam_user_account AS h
                       ON h.id IN (SELECT a.user_id FROM auto_host AS a)
                    WHERE g.id = p_guest AND g.pseudonymized_at IS NULL
                      AND h.pseudonymized_at IS NULL AND g.phone_e164 IS NOT NULL
                      AND g.phone_e164 = h.phone_e164
                      AND (g.phone_verified_at IS NOT NULL OR h.phone_verified_at IS NOT NULL))
  )
  SELECT s.signal FROM signals AS s ORDER BY s.rank, s.signal LIMIT 1
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;
