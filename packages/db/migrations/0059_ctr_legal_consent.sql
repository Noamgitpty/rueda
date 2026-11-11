-- 0059 — CTR : gabarits juridiques versionnés et consentements (CGU, confidentialité, communications).
-- US-102 ; 16 ACC-001, LEG-001, LEG-002, NFR-07, NFR-17 ; 17 §3.1.3 (classes A et C, NN8),
-- §3.2.6 (`document_template`, `consent`), §4.5 (`legal.consent.recorded`) ; ADR-091 (PROPOSÉ).
-- Appliquée sous `migrator`.
--
-- 1. `core.contract_document_template` (classe C, 17 §3.2.6) : une ligne par (genre, pays, langue,
--    version). Le texte est EN BASE (`body_md`) : une version se publie sans déploiement par la
--    commande de console `core.ctr_staff_cmd_publish_document` (ADMIN, session élevée par TOTP).
--    `country_code` NULL = document commun à tous les pays (PROPOSÉ, ADR-091) ; un document propre à
--    un pays remplace le commun pour ce pays. `legal_review_ref` NULL = BROUILLON non validé par le
--    juridique (OQ-BR-24, porte de mise en service). Ajout seul : jamais modifiée ni supprimée.
-- 2. `core.contract_consent` (classe A, registre immuable) : une ligne par acceptation ou retrait,
--    avec la version exacte (`template_id`), la langue, l'horodatage `platform.now()` et le
--    contexte. Consentement courant = dernière ligne (`seq`). `ip_enc` / `user_agent_enc` [C2] sont
--    prévus chiffrés par la clé du sujet (crypto-shredding, NN8) ; l'API n'a pas encore de
--    `KeyWrapper` (US-036) : ils restent NULL et `c2_withheld` = true (même règle que le journal
--    d'audit, US-009). Les CGU et la confidentialité ne se retirent pas par une ligne (fermeture du
--    compte, BR-ACC-09) ; les communications commerciales, si (révocation).
-- 3. AUCUNE INSCRIPTION SANS CONSENTEMENT : déclencheur de contrainte DIFFÉRÉ sur
--    `core.iam_user_account` : à la validation de la transaction, tout compte créé doit avoir accepté
--    la version courante des CGU du voyageur (`TOS_GUEST`) et de la confidentialité (`PRIVACY`).
--    Seules les écritures de `migrator` (migrations, fonctions de fixtures dont il est
--    propriétaire) ou d'un superutilisateur en sont exemptées. L'ancienne commande `core.iam_cmd_register` (0011) reste en place (expand-only) mais
--    ne peut plus aboutir seule : l'API appelle `core.iam_cmd_register_with_consents`.
-- 4. Commandes (SECURITY DEFINER, search_path figé, EXECUTE au seul app_api) :
--    - famille iam_auth (`iam_auth_owner`) : inscription avec consentements, état des
--      consentements d'une session (réacceptation exigée après une version MAJEURE), acceptation des
--      nouvelles versions, communications (accord ou révocation), historique, lecture publique des
--      documents en vigueur ;
--    - famille iam_staff (`iam_staff_owner`) : publication d'une version (permission
--      `legal.publish`, ADMIN), journalisée dans la chaîne d'audit.
-- 5. Graine : version 1 BROUILLON de `TOS_GUEST`, `PRIVACY` et `MARKETING`, commune aux pays, en
--    es (fait foi), en, fr et pt. Textes PROVISOIRES, à remplacer par ceux du juridique.
--
-- Retour arrière (base sans consentement) :
--   DROP TRIGGER ctr_signup_consents_required ON core.iam_user_account;
--   DROP FUNCTION core.iam_cmd_register_with_consents(uuid, text, text, text, text, text, uuid,
--     bytea, integer, inet, text, jsonb, boolean), core.ctr_consent_status(bytea),
--     core.ctr_cmd_accept_documents(bytea, jsonb), core.ctr_cmd_set_marketing(bytea, boolean),
--     core.ctr_consent_history(bytea), core.ctr_published_documents(text, text),
--     core.ctr_document_body(text, text, text, integer),
--     core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb),
--     core.ctr_signup_consents_guard(), core.ctr_writer_exempt(), core.ctr_consent_guard(),
--     core.ctr_template_guard(), core.ctr_no_truncate(),
--     core.ctr_current_template(text, text, text, boolean), core.ctr_record_consent(uuid, uuid,
--     boolean, text);
--   DROP TABLE core.contract_consent, core.contract_document_template;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-102%'.

-- 1. Permission de publication (17 §3.2.6 ; 16 LEG-001 : version publiée par un administrateur) --
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES ('ADMIN', 'legal.publish', 'PLATFORM', '2026-11-11T00:00:00Z',
        'US-102 : publication d''une version de CGU, de confidentialité ou de communications');

-- 2. Gabarits juridiques versionnés (classe C) ---------------------------------------------------
CREATE TABLE core.contract_document_template (
  id               uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT contract_document_template_pkey PRIMARY KEY,
  kind             text        NOT NULL
    CONSTRAINT document_template_kind_valid CHECK (kind IN (
      'TOS_GUEST', 'TOS_HOST', 'PRIVACY', 'MARKETING', 'BIOMETRIC_CONSENT', 'RENTAL_CONTRACT',
      'CONSTANCIA', 'DAMAGE_TERMS', 'CANCELLATION_POLICY')),
  -- NULL = commun à tous les pays (PROPOSÉ, ADR-091)
  country_code     char(2)     REFERENCES core.config_country (code),
  -- langue du catalogue (es fait foi, en, fr, pt = portugais du Brésil)
  locale           text        NOT NULL
    CONSTRAINT document_template_locale_valid CHECK (locale IN ('es', 'en', 'fr', 'pt')),
  version          integer     NOT NULL
    CONSTRAINT document_template_version_positive CHECK (version >= 1),
  -- version majeure : réacceptation exigée avant toute réservation (16 ACC-001, US-102)
  is_major         boolean     NOT NULL,
  title            text        NOT NULL
    CONSTRAINT document_template_title_length CHECK (pg_catalog.length(title) BETWEEN 1 AND 200),
  body_md          text        NOT NULL
    CONSTRAINT document_template_body_length CHECK (pg_catalog.length(body_md) BETWEEN 1 AND 200000),
  -- SHA-256 du texte (UTF-8), posé par le déclencheur de garde, jamais reçu
  content_hash     bytea       NOT NULL
    CONSTRAINT document_template_hash_sha256 CHECK (pg_catalog.octet_length(content_hash) = 32),
  -- référence de la validation juridique ; NULL = BROUILLON (OQ-BR-24)
  legal_review_ref text
    CONSTRAINT document_template_review_ref_length CHECK (
      legal_review_ref IS NULL OR pg_catalog.length(legal_review_ref) BETWEEN 1 AND 200),
  is_authoritative boolean     NOT NULL,
  valid_from       timestamptz NOT NULL,
  published_by     uuid        REFERENCES core.iam_user_account (id),
  request_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT document_template_version_unique UNIQUE NULLS NOT DISTINCT (kind, country_code, locale, version),
  -- l'espagnol fait foi (16 NFR-11) : c'est la seule langue faisant foi
  CONSTRAINT document_template_authoritative_es CHECK (is_authoritative = (locale = 'es'))
);
CREATE INDEX document_template_current_idx
  ON core.contract_document_template (kind, country_code, version DESC);
COMMENT ON TABLE core.contract_document_template IS
  'CTR : gabarits juridiques versionnés (17 §3.2.6, classe C), texte en base, publiés sans '
  'déploiement par core.ctr_staff_cmd_publish_document ; legal_review_ref NULL = BROUILLON. US-102.';

-- 3. Consentements (classe A, registre immuable) -------------------------------------------------
CREATE TABLE core.contract_consent (
  seq                 bigint      GENERATED ALWAYS AS IDENTITY
    CONSTRAINT contract_consent_pkey PRIMARY KEY,
  id                  uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT contract_consent_id_unique UNIQUE,
  user_id             uuid        NOT NULL REFERENCES core.iam_user_account (id),
  template_id         uuid        NOT NULL REFERENCES core.contract_document_template (id),
  doc_kind            text        NOT NULL
    CONSTRAINT consent_doc_kind_valid CHECK (doc_kind IN (
      'TOS_GUEST', 'TOS_HOST', 'PRIVACY', 'MARKETING', 'BIOMETRIC_CONSENT', 'DAMAGE_TERMS',
      'CANCELLATION_POLICY')),
  doc_version         integer     NOT NULL
    CONSTRAINT consent_doc_version_positive CHECK (doc_version >= 1),
  locale              text        NOT NULL
    CONSTRAINT consent_locale_valid CHECK (locale IN ('es', 'en', 'fr', 'pt')),
  -- false = retrait (17 §3.2.6) ; jamais pour les CGU ni la confidentialité (fermeture du compte)
  accepted            boolean     NOT NULL,
  accepted_at         timestamptz NOT NULL DEFAULT platform.now(),
  context             text        NOT NULL
    CONSTRAINT consent_context_valid CHECK (context IN (
      'SIGNUP', 'REACCEPT', 'SETTINGS', 'CHECKOUT', 'CONTRACT', 'KYC')),
  ip_enc              bytea,                                       -- [C2] chiffré, clé du sujet
  user_agent_enc      bytea,                                       -- [C2] chiffré, clé du sujet
  key_subject_type    text
    CONSTRAINT consent_key_subject_type_valid CHECK (key_subject_type IS NULL OR key_subject_type = 'USER'),
  key_subject_id      uuid,
  c2_withheld         boolean     NOT NULL,
  CONSTRAINT consent_required_not_withdrawn CHECK (accepted OR doc_kind NOT IN ('TOS_GUEST', 'PRIVACY')),
  CONSTRAINT consent_c2_key_complete CHECK (
    (ip_enc IS NULL AND user_agent_enc IS NULL)
    OR (key_subject_type IS NOT NULL AND key_subject_id IS NOT NULL)),
  CONSTRAINT consent_key_pair CHECK ((key_subject_type IS NULL) = (key_subject_id IS NULL)),
  CONSTRAINT consent_c2_withheld_coherent CHECK (NOT c2_withheld OR (ip_enc IS NULL AND user_agent_enc IS NULL))
);
CREATE INDEX consent_user_kind_idx ON core.contract_consent (user_id, doc_kind, seq DESC);
COMMENT ON TABLE core.contract_consent IS
  'CTR : consentements versionnés (17 §3.2.6, classe A, ajout seul) ; courant = dernière ligne '
  'par (user_id, doc_kind). ip_enc / user_agent_enc [C2] chiffrés par la clé du sujet ou retenus '
  '(c2_withheld). US-102.';

-- 4. Gardes ---------------------------------------------------------------------------------------
-- Gabarit : empreinte calculée ici (jamais reçue), ajout seul (UPDATE, DELETE, TRUNCATE refusés).
CREATE FUNCTION core.ctr_template_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'contract_document_template : version immuable (% refusé)', TG_OP
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'document_template_immutable';
  END IF;
  NEW.content_hash := pg_catalog.sha256(pg_catalog.convert_to(NEW.body_md, 'UTF8'));
  RETURN NEW;
END
$fn$;

-- Consentement : la version, le genre et la langue sont ceux du gabarit référencé ; ajout seul.
CREATE FUNCTION core.ctr_consent_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t core.contract_document_template%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'contract_consent : registre en ajout seul (% refusé)', TG_OP
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'consent_append_only';
  END IF;
  SELECT * INTO v_t FROM core.contract_document_template AS t WHERE t.id = NEW.template_id;
  IF v_t.id IS NULL OR v_t.kind <> NEW.doc_kind OR v_t.version <> NEW.doc_version
     OR v_t.locale <> NEW.locale THEN
    RAISE EXCEPTION 'contract_consent : version différente du gabarit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_matches_template';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION core.ctr_no_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '% : TRUNCATE refusé', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = TG_ARGV[0];
END
$fn$;
REVOKE ALL ON FUNCTION core.ctr_template_guard(), core.ctr_consent_guard(), core.ctr_no_truncate()
  FROM PUBLIC;

CREATE TRIGGER document_template_guard
  BEFORE INSERT OR UPDATE OR DELETE ON core.contract_document_template
  FOR EACH ROW EXECUTE FUNCTION core.ctr_template_guard();
CREATE TRIGGER document_template_no_truncate
  BEFORE TRUNCATE ON core.contract_document_template
  FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate('document_template_immutable');
CREATE TRIGGER consent_guard
  BEFORE INSERT OR UPDATE OR DELETE ON core.contract_consent
  FOR EACH ROW EXECUTE FUNCTION core.ctr_consent_guard();
CREATE TRIGGER consent_no_truncate
  BEFORE TRUNCATE ON core.contract_consent
  FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate('consent_append_only');

-- 5. RLS : aucun droit de table pour les rôles applicatifs ---------------------------------------
ALTER TABLE core.contract_document_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contract_document_template FORCE ROW LEVEL SECURITY;
ALTER TABLE core.contract_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contract_consent FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.contract_document_template TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.contract_consent TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.contract_document_template, core.contract_consent FROM PUBLIC;

-- iam_auth_owner : lit les gabarits, lit et ajoute les consentements (jamais de mise à jour).
GRANT SELECT ON core.contract_document_template TO iam_auth_owner;
GRANT SELECT ON core.contract_consent TO iam_auth_owner;
GRANT INSERT (id, user_id, template_id, doc_kind, doc_version, locale, accepted, accepted_at,
              context, ip_enc, user_agent_enc, key_subject_type, key_subject_id, c2_withheld)
  ON core.contract_consent TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.contract_document_template FOR SELECT TO iam_auth_owner
  USING (true);
CREATE POLICY iam_auth_select ON core.contract_consent FOR SELECT TO iam_auth_owner USING (true);
CREATE POLICY iam_auth_insert ON core.contract_consent FOR INSERT TO iam_auth_owner WITH CHECK (true);
-- identifiants par défaut (platform.uuid_v7) des lignes ajoutées par les propriétaires
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO iam_auth_owner, iam_staff_owner;

-- iam_staff_owner : lit et ajoute des versions (jamais de mise à jour).
GRANT SELECT ON core.contract_document_template TO iam_staff_owner;
GRANT INSERT (id, kind, country_code, locale, version, is_major, title, body_md, content_hash,
              legal_review_ref, is_authoritative, valid_from, published_by, request_id)
  ON core.contract_document_template TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.contract_document_template FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_insert ON core.contract_document_template FOR INSERT TO iam_staff_owner
  WITH CHECK (true);

-- 6. Version en vigueur (SECURITY INVOKER, exécutée sous les propriétaires) -----------------------
-- Portée : documents propres au pays s'il en existe un en vigueur pour ce genre, sinon documents
-- communs (country_code NULL). Version : la plus haute en vigueur (p_major_only : la plus haute
-- version MAJEURE). Langue : celle demandée, sinon la langue qui fait foi (repli signalé par
-- `locale` rendu).
CREATE FUNCTION core.ctr_current_template(p_kind text, p_country text, p_language text,
                                          p_major_only boolean)
  RETURNS SETOF core.contract_document_template
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH scope AS (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM core.contract_document_template AS t
              WHERE t.kind = p_kind AND t.country_code = p_country AND t.valid_from <= platform.now())
           THEN p_country END AS country
  ), latest AS (
    SELECT pg_catalog.max(t.version) AS version
      FROM core.contract_document_template AS t, scope
     WHERE t.kind = p_kind AND t.country_code IS NOT DISTINCT FROM scope.country
       AND t.valid_from <= platform.now() AND (t.is_major OR NOT p_major_only)
  )
  SELECT t.*
    FROM core.contract_document_template AS t, scope, latest
   WHERE t.kind = p_kind AND t.country_code IS NOT DISTINCT FROM scope.country
     AND t.version = latest.version
     AND (t.locale = p_language OR t.is_authoritative)
   ORDER BY (t.locale = p_language) DESC
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION core.ctr_current_template(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ctr_current_template(text, text, text, boolean) TO iam_auth_owner;

-- Ajout d'un consentement (SECURITY INVOKER, exécutée sous iam_auth_owner) : C2 retenues tant que
-- l'API n'a pas de KeyWrapper (US-036).
CREATE FUNCTION core.ctr_record_consent(p_user_id uuid, p_template_id uuid, p_accepted boolean,
                                        p_context text)
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                     accepted_at, context, c2_withheld)
  SELECT p_user_id, t.id, t.kind, t.version, t.locale, p_accepted, platform.now(), p_context, true
    FROM core.contract_document_template AS t
   WHERE t.id = p_template_id
$fn$;
REVOKE ALL ON FUNCTION core.ctr_record_consent(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ctr_record_consent(uuid, uuid, boolean, text) TO iam_auth_owner;

-- 7. Aucune inscription sans consentement (déclencheur de contrainte différé) ---------------------
-- Exemption : le rôle QUI ÉCRIT le compte est `migrator` (migrations, fixtures de test, qui sont des
-- fonctions dont il est propriétaire) ou un superutilisateur ; jamais un rôle applicatif ni un
-- propriétaire NOLOGIN (la commande d'inscription écrit sous `iam_auth_owner`). La condition WHEN
-- d'un déclencheur de contrainte est évaluée À L'INSERTION (pas au COMMIT), donc `current_user`
-- est bien l'écrivain ; seul le contrôle des consentements est différé au COMMIT.
CREATE FUNCTION core.ctr_writer_exempt()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT current_user = 'migrator'
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = current_user AND r.rolsuper)
$fn$;
REVOKE ALL ON FUNCTION core.ctr_writer_exempt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ctr_writer_exempt() TO iam_auth_owner;

-- SECURITY DEFINER : au COMMIT, l'appelant est le rôle de connexion (app_api), qui ne lit pas
-- contract_consent.
CREATE FUNCTION core.ctr_signup_consents_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_kind text;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['TOS_GUEST', 'PRIVACY'] LOOP
    IF NOT EXISTS (SELECT 1 FROM core.contract_consent AS c
                    WHERE c.user_id = NEW.id AND c.doc_kind = v_kind AND c.accepted) THEN
      RAISE EXCEPTION 'inscription sans consentement requis (%)', v_kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_signup_consents_required';
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.ctr_signup_consents_guard() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER ctr_signup_consents_required
  AFTER INSERT ON core.iam_user_account
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NOT core.ctr_writer_exempt())
  EXECUTE FUNCTION core.ctr_signup_consents_guard();

-- 8. Inscription avec consentements (famille iam_auth) --------------------------------------------
-- p_documents : liste `[{ "kind": "TOS_GUEST", "version": 1 }, …]` des versions AFFICHÉES et
-- acceptées ; NULL = versions en vigueur. Les versions sont contrôlées AVANT l'écriture du compte :
-- même issue que l'email soit libre ou pris (anti-énumération). Issues d'erreur (contrainte) :
--   ctr_document_request_invalid (liste mal formée), ctr_document_unavailable (aucun document en
--   vigueur : fail-closed), ctr_document_version_current (version affichée périmée).
CREATE FUNCTION core.iam_cmd_register_with_consents(
  p_user_id                 uuid,
  p_email                   text,
  p_password_hash           text,
  p_legal_first_name        text,
  p_legal_last_name         text,
  p_preferred_locale        text,
  p_verification_id         uuid,
  p_verification_token_hash bytea,
  p_verification_ttl_s      integer,
  p_ip                      inet,
  p_country                 text,
  p_documents               jsonb,
  p_marketing_opt_in        boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_lang      text := pg_catalog.split_part(COALESCE(p_preferred_locale, ''), '-', 1);
  v_kind      text;
  v_shown     numeric;
  v_t         core.contract_document_template%ROWTYPE;
  v_templates uuid[] := '{}';
  v_marketing uuid;
BEGIN
  IF p_marketing_opt_in IS NULL
     OR (p_documents IS NOT NULL AND pg_catalog.jsonb_typeof(p_documents) <> 'array')
     OR (p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'ctr : demande de consentement invalide'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_request_invalid';
  END IF;
  IF p_documents IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(p_documents) AS d(e)
        WHERE pg_catalog.jsonb_typeof(d.e) <> 'object'
           OR NOT COALESCE((d.e ->> 'kind') = ANY (ARRAY['TOS_GUEST', 'PRIVACY']), false)
           OR pg_catalog.jsonb_typeof(d.e -> 'version') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'ctr : demande de consentement invalide'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_request_invalid';
  END IF;
  FOREACH v_kind IN ARRAY ARRAY['TOS_GUEST', 'PRIVACY'] LOOP
    SELECT * INTO v_t FROM core.ctr_current_template(v_kind, p_country, v_lang, false);
    IF v_t.id IS NULL THEN
      RAISE EXCEPTION 'ctr : aucun document en vigueur (%)', v_kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_unavailable';
    END IF;
    IF p_documents IS NOT NULL THEN
      SELECT pg_catalog.max((d.e ->> 'version')::numeric) INTO v_shown
        FROM pg_catalog.jsonb_array_elements(p_documents) AS d(e)
       WHERE d.e ->> 'kind' = v_kind;
      IF v_shown IS DISTINCT FROM v_t.version::numeric THEN
        RAISE EXCEPTION 'ctr : version affichée périmée (%)', v_kind
          USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_version_current';
      END IF;
    END IF;
    v_templates := v_templates || v_t.id;
  END LOOP;
  IF p_marketing_opt_in THEN
    SELECT t.id INTO v_marketing FROM core.ctr_current_template('MARKETING', p_country, v_lang, false) AS t;
    IF v_marketing IS NULL THEN
      RAISE EXCEPTION 'ctr : aucun document en vigueur (MARKETING)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_unavailable';
    END IF;
  END IF;

  IF NOT core.iam_cmd_register(p_user_id, p_email, p_password_hash, p_legal_first_name,
                               p_legal_last_name, p_preferred_locale, p_verification_id,
                               p_verification_token_hash, p_verification_ttl_s, p_ip) THEN
    RETURN false;  -- email déjà pris : aucune écriture
  END IF;
  PERFORM core.ctr_record_consent(p_user_id, t, true, 'SIGNUP') FROM pg_catalog.unnest(v_templates) AS t;
  IF v_marketing IS NOT NULL THEN
    PERFORM core.ctr_record_consent(p_user_id, v_marketing, true, 'SIGNUP');
  END IF;
  RETURN true;
END
$fn$;

-- 9. État des consentements d'une session -------------------------------------------------------
-- Par genre : version en vigueur, version majeure exigée, dernière version acceptée, état courant et
-- réacceptation exigée (genre requis, aucune acceptation ou dernière acceptée < majeure exigée).
-- Session invalide : zéro ligne.
CREATE FUNCTION core.ctr_consent_status(p_token_hash bytea)
  RETURNS TABLE (doc_kind text, required boolean, current_version integer,
                 required_version integer, accepted_version integer, accepted boolean,
                 reaccept_required boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
  v_lang    text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT u.residence_country, pg_catalog.split_part(u.preferred_locale, '-', 1)
    INTO v_country, v_lang
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  RETURN QUERY
  WITH kinds(k, req) AS (VALUES ('TOS_GUEST', true), ('PRIVACY', true), ('MARKETING', false)),
  rows AS (
    SELECT k.k, k.req,
           (SELECT t.version FROM core.ctr_current_template(k.k, v_country, v_lang, false) AS t) AS cur,
           (SELECT t.version FROM core.ctr_current_template(k.k, v_country, v_lang, true) AS t) AS maj,
           (SELECT c.doc_version FROM core.contract_consent AS c
             WHERE c.user_id = v_user AND c.doc_kind = k.k AND c.accepted
             ORDER BY c.seq DESC LIMIT 1) AS acc_version,
           (SELECT c.accepted FROM core.contract_consent AS c
             WHERE c.user_id = v_user AND c.doc_kind = k.k
             ORDER BY c.seq DESC LIMIT 1) AS last_accepted
      FROM kinds AS k
  )
  SELECT r.k, r.req, r.cur, r.maj, r.acc_version, COALESCE(r.last_accepted, false),
         r.req AND (r.acc_version IS NULL OR r.last_accepted IS NOT TRUE
                    OR (r.maj IS NOT NULL AND r.acc_version < r.maj))
    FROM rows AS r
   ORDER BY r.k;
END
$fn$;

-- 10. Acceptation des versions en vigueur (réacceptation) -----------------------------------------
-- p_documents : `[{ "kind": "TOS_GUEST", "version": n }, …]` ; chaque version doit être la version
-- EN VIGUEUR (sinon ctr_document_version_current). Rend le nombre de consentements écrits ; session
-- invalide : -1 (aucune écriture).
CREATE FUNCTION core.ctr_cmd_accept_documents(p_token_hash bytea, p_documents jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user    uuid;
  v_country text;
  v_lang    text;
  v_e       jsonb;
  v_t       core.contract_document_template%ROWTYPE;
  v_n       integer := 0;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN -1;
  END IF;
  IF p_documents IS NULL OR pg_catalog.jsonb_typeof(p_documents) <> 'array'
     OR pg_catalog.jsonb_array_length(p_documents) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'ctr : demande de consentement invalide'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_request_invalid';
  END IF;
  SELECT u.residence_country, pg_catalog.split_part(u.preferred_locale, '-', 1)
    INTO v_country, v_lang
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  FOR v_e IN SELECT d.e FROM pg_catalog.jsonb_array_elements(p_documents) AS d(e) LOOP
    IF pg_catalog.jsonb_typeof(v_e) <> 'object'
       OR NOT COALESCE((v_e ->> 'kind') = ANY (ARRAY['TOS_GUEST', 'PRIVACY']), false)
       OR pg_catalog.jsonb_typeof(v_e -> 'version') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'ctr : demande de consentement invalide'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_request_invalid';
    END IF;
    SELECT * INTO v_t FROM core.ctr_current_template(v_e ->> 'kind', v_country, v_lang, false);
    IF v_t.id IS NULL THEN
      RAISE EXCEPTION 'ctr : aucun document en vigueur'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_unavailable';
    END IF;
    IF (v_e ->> 'version')::numeric IS DISTINCT FROM v_t.version::numeric THEN
      RAISE EXCEPTION 'ctr : version affichée périmée'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_version_current';
    END IF;
    PERFORM core.ctr_record_consent(v_user, v_t.id, true, 'REACCEPT');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

-- 11. Communications commerciales : accord ou révocation (opt-in, jamais pré-coché) --------------
-- Rend 'CHANGED', 'UNCHANGED' (état déjà le même : aucune ligne) ou 'AUTH_REQUIRED'.
CREATE FUNCTION core.ctr_cmd_set_marketing(p_token_hash bytea, p_opt_in boolean)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user    uuid;
  v_country text;
  v_lang    text;
  v_last    boolean;
  v_t       uuid;
BEGIN
  IF p_opt_in IS NULL THEN
    RAISE EXCEPTION 'ctr : demande de consentement invalide'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_request_invalid';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  -- deux bascules concurrentes du même compte : l'une après l'autre
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.contract_consent:MARKETING:' || v_user::text, 0));
  SELECT c.accepted INTO v_last FROM core.contract_consent AS c
   WHERE c.user_id = v_user AND c.doc_kind = 'MARKETING' ORDER BY c.seq DESC LIMIT 1;
  IF COALESCE(v_last, false) = p_opt_in THEN
    RETURN 'UNCHANGED';
  END IF;
  SELECT u.residence_country, pg_catalog.split_part(u.preferred_locale, '-', 1)
    INTO v_country, v_lang
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  SELECT t.id INTO v_t FROM core.ctr_current_template('MARKETING', v_country, v_lang, false) AS t;
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'ctr : aucun document en vigueur (MARKETING)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ctr_document_unavailable';
  END IF;
  PERFORM core.ctr_record_consent(v_user, v_t, p_opt_in, 'SETTINGS');
  RETURN 'CHANGED';
END
$fn$;

-- 12. Historique des consentements de la session (le titulaire seulement, sans C2) ---------------
CREATE FUNCTION core.ctr_consent_history(p_token_hash bytea)
  RETURNS TABLE (doc_kind text, doc_version integer, locale text, accepted boolean,
                 accepted_at timestamptz, context text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.doc_kind, c.doc_version, c.locale, c.accepted, c.accepted_at, c.context
    FROM core.contract_consent AS c
   WHERE c.user_id = (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s)
   ORDER BY c.seq DESC
   LIMIT 200
$fn$;

-- 13. Lecture publique des documents en vigueur (données C0, sans session) -----------------------
CREATE FUNCTION core.ctr_published_documents(p_country text, p_language text)
  RETURNS TABLE (doc_kind text, version integer, is_major boolean, locale text, title text,
                 content_hash bytea, is_draft boolean, valid_from timestamptz)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.kind, t.version, t.is_major, t.locale, t.title, t.content_hash,
         t.legal_review_ref IS NULL, t.valid_from
    FROM (VALUES ('TOS_GUEST'), ('PRIVACY'), ('MARKETING')) AS k(kind)
    CROSS JOIN LATERAL core.ctr_current_template(k.kind, p_country, p_language, false) AS t
   ORDER BY t.kind
$fn$;

-- Texte d'un document : version en vigueur (p_version NULL) ou version passée en vigueur (preuve
-- de ce qui a été accepté, 16 NFR-17). Jamais une version future.
CREATE FUNCTION core.ctr_document_body(p_kind text, p_country text, p_language text,
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
   WHERE p_kind IN ('TOS_GUEST', 'PRIVACY', 'MARKETING')
     AND t.kind = p_kind
     AND t.country_code IS NOT DISTINCT FROM cur.country_code
     AND t.version = COALESCE(p_version, cur.version)
     AND t.valid_from <= platform.now()
     AND (t.locale = p_language OR t.is_authoritative)
   ORDER BY (t.locale = p_language) DESC
   LIMIT 1
$fn$;

-- 14. Publication d'une version (console, famille iam_staff) --------------------------------------
-- Session élevée par TOTP et permission `legal.publish` sur tous les pays (document commun) ou sur
-- le pays du document (cfg_brand_authorize, 0042 : refus journalisés). p_bodies :
-- `{ "es": { "title": …, "body": … }, "en": …, "fr": …, "pt": … }`, les QUATRE langues ensemble
-- (DEC-FONDATEUR-17, 18). Version = suivante du (genre, pays). Jamais rétroactive (valid_from ≥
-- maintenant). Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, PUBLISHED (+ version).
CREATE FUNCTION core.ctr_staff_cmd_publish_document(p_token_hash bytea, p_request_id uuid,
                                                    p_kind text, p_country text,
                                                    p_is_major boolean, p_valid_from timestamptz,
                                                    p_legal_review_ref text, p_bodies jsonb)
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
  IF p_request_id IS NULL OR p_is_major IS NULL OR p_valid_from IS NULL
     OR p_kind IS NULL OR p_kind NOT IN ('TOS_GUEST', 'PRIVACY', 'MARKETING')
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
  IF p_valid_from < v_now THEN
    RAISE EXCEPTION 'ctr : publication rétroactive refusée'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'document_template_not_retroactive';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.contract_document_template:' || p_kind || ':'
                                || COALESCE(p_country, ''), 0));
  SELECT COALESCE(pg_catalog.max(t.version), 0) + 1 INTO v_next
    FROM core.contract_document_template AS t
   WHERE t.kind = p_kind AND t.country_code IS NOT DISTINCT FROM p_country;
  FOREACH v_lang IN ARRAY ARRAY['es', 'en', 'fr', 'pt'] LOOP
    INSERT INTO core.contract_document_template
           (kind, country_code, locale, version, is_major, title, body_md, content_hash,
            legal_review_ref, is_authoritative, valid_from, published_by, request_id)
    VALUES (p_kind, p_country, v_lang, v_next, p_is_major, p_bodies -> v_lang ->> 'title',
            p_bodies -> v_lang ->> 'body', pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
            NULLIF(pg_catalog.btrim(p_legal_review_ref), ''), v_lang = 'es', p_valid_from,
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

-- 15. Droits et propriétaires ---------------------------------------------------------------------
COMMENT ON FUNCTION core.iam_cmd_register_with_consents(uuid, text, text, text, text, text, uuid, bytea, integer, inet, text, jsonb, boolean) IS
  'Inscription (ACC-001) avec consentements versionnés CGU + confidentialité (+ communications si opt-in). SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_consent_status(bytea) IS
  'État des consentements de la session ; réacceptation exigée après une version majeure. SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_cmd_accept_documents(bytea, jsonb) IS
  'Acceptation des versions en vigueur des CGU / confidentialité (REACCEPT). SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_cmd_set_marketing(bytea, boolean) IS
  'Communications commerciales : accord ou révocation. SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_consent_history(bytea) IS
  'Historique des consentements du titulaire de la session (sans C2). SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_published_documents(text, text) IS
  'Documents juridiques en vigueur (C0). SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_document_body(text, text, text, integer) IS
  'Texte d''un document en vigueur ou passé en vigueur (C0). SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb) IS
  'Publication d''une version (4 langues), permission legal.publish, journalisée. SECURITY DEFINER, EXECUTE app_api. US-102.';
COMMENT ON FUNCTION core.ctr_signup_consents_guard() IS
  'Déclencheur différé : aucun compte sans consentement TOS_GUEST et PRIVACY (hors migrator / superutilisateur). US-102.';

REVOKE ALL ON FUNCTION
  core.iam_cmd_register_with_consents(uuid, text, text, text, text, text, uuid, bytea, integer, inet, text, jsonb, boolean),
  core.ctr_consent_status(bytea), core.ctr_cmd_accept_documents(bytea, jsonb),
  core.ctr_cmd_set_marketing(bytea, boolean), core.ctr_consent_history(bytea),
  core.ctr_published_documents(text, text), core.ctr_document_body(text, text, text, integer),
  core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.iam_cmd_register_with_consents(uuid, text, text, text, text, text, uuid, bytea, integer, inet, text, jsonb, boolean),
  core.ctr_consent_status(bytea), core.ctr_cmd_accept_documents(bytea, jsonb),
  core.ctr_cmd_set_marketing(bytea, boolean), core.ctr_consent_history(bytea),
  core.ctr_published_documents(text, text), core.ctr_document_body(text, text, text, integer),
  core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb)
  TO app_api;

-- Propriétaires NOLOGIN (mécanique de 0022 : CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO iam_auth_owner, iam_staff_owner;
ALTER FUNCTION core.iam_cmd_register_with_consents(uuid, text, text, text, text, text, uuid, bytea, integer, inet, text, jsonb, boolean)
  OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_consent_status(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_cmd_accept_documents(bytea, jsonb) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_cmd_set_marketing(bytea, boolean) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_consent_history(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_published_documents(text, text) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_document_body(text, text, text, integer) OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_signup_consents_guard() OWNER TO iam_auth_owner;
ALTER FUNCTION core.ctr_staff_cmd_publish_document(bytea, uuid, text, text, boolean, timestamptz, text, jsonb)
  OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner, iam_staff_owner;

-- 16. Graine : version 1 BROUILLON commune aux pays (textes PROVISOIRES, OQ-BR-24) ----------------
-- En vigueur dès l'origine (date antérieure à toute horloge de test). À remplacer par les textes
-- validés par le juridique, publiés par la console (version 2, majeure) avant la mise en service.
INSERT INTO core.contract_document_template
       (kind, country_code, locale, version, is_major, title, body_md, content_hash,
        legal_review_ref, is_authoritative, valid_from)
SELECT d.kind, NULL, d.locale, 1, true, d.title, d.body,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, d.locale = 'es',
       '2000-01-01T00:00:00Z'
  FROM (VALUES
    ('TOS_GUEST', 'es', 'Términos y condiciones del viajero (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.** Este texto es provisional y no constituye los términos definitivos.\n\n1. Objeto. La plataforma pone en contacto a viajeros con anfitriones particulares que alquilan su propio auto. La plataforma no es una agencia de alquiler.\n2. Cuenta. Debes dar datos exactos, con tu nombre como en tu licencia, y mantener tu contraseña en secreto.\n3. Reservas y pagos. Pagas a la plataforma, que cobra en su nombre y reparte cada pago según las reglas publicadas.\n4. Conducta. Respeta el auto, las reglas del anfitrión y la ley aplicable.\n5. Cambios. Una nueva versión mayor de estos términos te será presentada y deberás aceptarla antes de reservar.\n\nEl texto en español hace fe.'),
    ('TOS_GUEST', 'en', 'Guest terms and conditions (DRAFT)',
     E'**DRAFT — pending legal review.** This text is provisional and is not the final terms.\n\n1. Purpose. The platform connects guests with private hosts who rent out their own car. The platform is not a rental agency.\n2. Account. You must give accurate details, with your name as on your license, and keep your password secret.\n3. Bookings and payments. You pay the platform, which collects in its own name and splits each payment under the published rules.\n4. Conduct. Respect the car, the host''s rules and the applicable law.\n5. Changes. A new major version of these terms will be shown to you and you must accept it before booking.\n\nThe Spanish text prevails.'),
    ('TOS_GUEST', 'fr', 'Conditions générales du voyageur (BROUILLON)',
     E'**BROUILLON — à valider par le juridique.** Ce texte est provisoire et ne constitue pas les conditions définitives.\n\n1. Objet. La plateforme met en relation des voyageurs et des hôtes particuliers qui louent leur propre voiture. La plateforme n''est pas une agence de location.\n2. Compte. Vous devez fournir des informations exactes, avec votre nom tel qu''il figure sur votre permis, et garder votre mot de passe secret.\n3. Réservations et paiements. Vous payez la plateforme, qui encaisse en son nom et répartit chaque paiement selon les règles publiées.\n4. Conduite. Respectez la voiture, les règles de l''hôte et la loi applicable.\n5. Modifications. Une nouvelle version majeure de ces conditions vous sera présentée et vous devrez l''accepter avant de réserver.\n\nLe texte espagnol fait foi.'),
    ('TOS_GUEST', 'pt', 'Termos e condições do viajante (RASCUNHO)',
     E'**RASCUNHO — pendente de validação jurídica.** Este texto é provisório e não constitui os termos definitivos.\n\n1. Objeto. A plataforma conecta viajantes a anfitriões particulares que alugam o próprio carro. A plataforma não é uma locadora.\n2. Conta. Você deve informar dados corretos, com seu nome como na sua CNH, e manter sua senha em segredo.\n3. Reservas e pagamentos. Você paga a plataforma, que recebe em nome próprio e reparte cada pagamento conforme as regras publicadas.\n4. Conduta. Respeite o carro, as regras do anfitrião e a legislação aplicável.\n5. Alterações. Uma nova versão principal destes termos será apresentada a você, e você deverá aceitá-la antes de reservar.\n\nO texto em espanhol prevalece.'),
    ('PRIVACY', 'es', 'Política de privacidad (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.** Este texto es provisional.\n\n1. Datos que tratamos: nombre, correo, teléfono, datos de verificación y de tus viajes.\n2. Finalidad: crear tu cuenta, verificar tu identidad, gestionar reservas y pagos, y cumplir la ley.\n3. Minimización: el anfitrión solo ve tu nombre, tu edad, tu nota y tu estado de verificación.\n4. Tus derechos: acceso, rectificación, supresión y retiro del consentimiento a las comunicaciones.\n5. Conservación: según la ley aplicable y los plazos publicados.\n\nEl texto en español hace fe.'),
    ('PRIVACY', 'en', 'Privacy policy (DRAFT)',
     E'**DRAFT — pending legal review.** This text is provisional.\n\n1. Data we process: name, email, phone, verification data and data about your trips.\n2. Purpose: create your account, verify your identity, handle bookings and payments, and comply with the law.\n3. Minimization: the host only sees your first name, age, rating and verification status.\n4. Your rights: access, correction, erasure and withdrawal of your consent to communications.\n5. Retention: under the applicable law and the published periods.\n\nThe Spanish text prevails.'),
    ('PRIVACY', 'fr', 'Politique de confidentialité (BROUILLON)',
     E'**BROUILLON — à valider par le juridique.** Ce texte est provisoire.\n\n1. Données traitées : nom, adresse e-mail, téléphone, données de vérification et de vos trajets.\n2. Finalités : créer votre compte, vérifier votre identité, gérer les réservations et les paiements, respecter la loi.\n3. Minimisation : l''hôte ne voit que votre prénom, votre âge, votre note et votre statut de vérification.\n4. Vos droits : accès, rectification, effacement et retrait de votre consentement aux communications.\n5. Conservation : selon la loi applicable et les durées publiées.\n\nLe texte espagnol fait foi.'),
    ('PRIVACY', 'pt', 'Política de privacidade (RASCUNHO)',
     E'**RASCUNHO — pendente de validação jurídica.** Este texto é provisório.\n\n1. Dados tratados: nome, e-mail, celular, dados de verificação e das suas viagens.\n2. Finalidade: criar sua conta, verificar sua identidade, gerenciar reservas e pagamentos e cumprir a lei.\n3. Minimização: o anfitrião vê apenas seu nome, sua idade, sua nota e seu status de verificação.\n4. Seus direitos: acesso, correção, exclusão e retirada do consentimento às comunicações.\n5. Conservação: conforme a legislação aplicável e os prazos publicados.\n\nO texto em espanhol prevalece.'),
    ('MARKETING', 'es', 'Comunicaciones comerciales (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.**\n\nAcepto recibir novedades y ofertas por correo. Es opcional: puedo retirar este consentimiento en cualquier momento desde mi cuenta, sin efecto sobre mis reservas.'),
    ('MARKETING', 'en', 'Marketing communications (DRAFT)',
     E'**DRAFT — pending legal review.**\n\nI agree to receive news and offers by email. It is optional: I can withdraw this consent at any time from my account, with no effect on my bookings.'),
    ('MARKETING', 'fr', 'Communications commerciales (BROUILLON)',
     E'**BROUILLON — à valider par le juridique.**\n\nJ''accepte de recevoir des nouveautés et des offres par e-mail. C''est facultatif : je peux retirer ce consentement à tout moment depuis mon compte, sans effet sur mes réservations.'),
    ('MARKETING', 'pt', 'Comunicações comerciais (RASCUNHO)',
     E'**RASCUNHO — pendente de validação jurídica.**\n\nAceito receber novidades e ofertas por e-mail. É opcional: posso retirar este consentimento a qualquer momento na minha conta, sem efeito sobre minhas reservas.')
  ) AS d(kind, locale, title, body);
