-- 0059 — SUP : cadre des actions de console (commande de domaine liée, aucun montant, pièces, FINANCE à deux personnes).
-- Catalogue minimal complet, règles de saisie, pièces des actions d'enregistrement seul, liaison
-- des commandes de domaine, et décisions FINANCE à deux personnes lancées depuis la console.
-- US-101 ; 19 US-101 ; 17 §1.8 D7, §2.3 (matrice, commandes FINANCE à deux personnes, RLS-24),
-- §3.2.13 (`manual_action`), §10 NN9 et « catalogue minimal des actions de console » ; C-v3-05 ;
-- ADR-062 (console), ADR-091 (ce cadre). Appliquée sous `migrator`.
--
-- Principes (ADR-091) :
--   - UNE commande de console, `core.iam_staff_cmd_manual_action(…, p_evidence uuid[])`
--     (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api), dans cet ordre : session
--     (preuve de possession), données, niveau TOTP, pays du sujet relu en base, permission et
--     portée pays, règles de saisie de l'action, idempotence, disponibilité, puis :
--       * RECORD_ONLY : motif ET pièces (au moins une, `audit_file_asset` du seau des preuves),
--         aucun effet de domaine ;
--       * DOMAIN_COMMAND : la commande de domaine LIÉE à l'action est appelée DANS LA MÊME
--         TRANSACTION (même instruction) ; son issue décide de l'écriture de `manual_action` ;
--     et l'audit est écrit EN DERNIER (passation US-009) ;
--   - l'agent ne saisit JAMAIS un montant : `input` n'admet que les clés déclarées par l'action,
--     des chaînes courtes, jamais un nombre ni une chaîne numérique ; aucune clé déclarée ne peut
--     ressembler à un montant (contrainte du catalogue) ; les montants viennent du moteur ;
--   - liaison des commandes de domaine par la table `support_manual_action_handler` (INSERT par
--     migration seulement ; une story qui livre sa commande AJOUTE la liaison, sans réécrire ce
--     cadre). La signature et les droits du gestionnaire sont vérifiés à la liaison (déclencheur) ;
--     l'appel est un EXECUTE dont le nom vient de pg_proc (jamais du client) et dont toutes les
--     valeurs sont liées (USING) : dérogation `dynamic-sql` justifiée ;
--   - FINANCE (`ISSUE_BORDEREAU`, `DECIDE_ADVANCE`, `WRITE_OFF_RECEIVABLE`) : la commande liée est
--     `cmd_request_finance_action` (0036) : l'action n'est qu'une DEMANDE ; l'effet n'a lieu qu'à
--     `cmd_approve_finance_action` par une SECONDE personne distincte (RLS-24, inchangé) ;
--   - les actions dont la commande de domaine n'existe pas encore restent indisponibles
--     (UNAVAILABLE, journalisé) : aucun changement d'état n'est imité (17 §10 NN9).
--
-- Défauts PROPOSÉS (fail-closed, ADR-091) : permission et type de sujet de chaque action
-- nouvelle ; une pièce au moins pour toute action d'enregistrement seul ; 20 pièces au plus ;
-- clés de saisie : `decision` pour les décisions, aucune ailleurs.
--
-- Retour arrière :
--   réappliquer la définition de 0034 de core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid,
--     text, jsonb) (sous iam_staff_owner) ;
--   DROP FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[]),
--     core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.support_subject_country(text, uuid), core.support_staff_holds_permission(uuid, text),
--     core.support_manual_action_handler_guard();
--   DROP TABLE core.support_manual_action_handler;
--   ALTER TABLE core.support_manual_action DROP COLUMN outcome, DROP COLUMN domain_ref;
--   DELETE FROM core.support_manual_action_catalog WHERE action_code NOT IN
--     ('CANCEL_TRIP_PLATFORM', 'DECLARE_NO_SHOW', 'RECORD_CLAIM');
--   ALTER TABLE core.support_manual_action_catalog DROP COLUMN input_keys, contrainte de sujet de 0034 ;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-101%';
--   révoquer les droits ci-dessous accordés à iam_staff_owner.

-- 1. Catalogue : types de sujet et clés de saisie ---------------------------------------------------
-- Contrainte remplacée sous le même nom (élargie, jamais restreinte).
ALTER TABLE core.support_manual_action_catalog DROP CONSTRAINT manual_action_catalog_subject_valid;
ALTER TABLE core.support_manual_action_catalog ADD CONSTRAINT manual_action_catalog_subject_valid
  CHECK (subject_type IN ('TRIP', 'ORGANIZATION', 'IDENTITY_VERIFICATION', 'LISTING',
                          'SUPPORT_CASE', 'PLATFORM_ADVANCE', 'INSURER_BORDEREAU'));
-- Clés admises dans `input` (références, jamais un montant) : 8 au plus, camelCase, et aucune ne
-- peut nommer un montant (défense en profondeur ; la commande refuse en plus toute valeur numérique).
ALTER TABLE core.support_manual_action_catalog
  ADD COLUMN input_keys text[] NOT NULL DEFAULT '{}'
    CONSTRAINT manual_action_catalog_input_keys_format CHECK (
          pg_catalog.cardinality(input_keys) <= 8
      AND pg_catalog.array_position(input_keys, NULL) IS NULL
      AND pg_catalog.array_to_string(input_keys, ',') ~ '^([a-z][A-Za-z]{0,31}(,[a-z][A-Za-z]{0,31})*)?$'
      AND pg_catalog.array_to_string(input_keys, ',') !~* '(amount|minor|montant|monto|valor|price|prix|precio|fee|total|refund|sum)');
COMMENT ON COLUMN core.support_manual_action_catalog.input_keys IS
  'Clés admises dans manual_action.input pour cette action (chaînes courtes, jamais un montant). US-101.';
COMMENT ON COLUMN core.support_manual_action_catalog.available IS
  'RECORD_ONLY : action ouverte. DOMAIN_COMMAND : ignoré ; disponible ssi une commande est liée '
  '(support_manual_action_handler). US-012, US-101.';

-- Catalogue minimal de 17 §10 (hors CREATE_HOST_ACCOUNT, porté par US-107). Les commandes d'état
-- sont indisponibles tant que leur story ne les lie pas (US-208 annulations, story du no-show,
-- US-123 KYC et vérification d'hôte, US-124 annonce, retards, revue de réservation).
INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys)
VALUES
  ('CANCEL_TRIP_GUEST',          'ops.platform_cancel',           'DOMAIN_COMMAND', 'TRIP',                  false, '{}'),
  ('CANCEL_TRIP_HOST',           'ops.platform_cancel',           'DOMAIN_COMMAND', 'TRIP',                  false, '{}'),
  ('REFUSE_AT_PICKUP',           'kyc.license_check_at_handover', 'DOMAIN_COMMAND', 'TRIP',                  false, '{}'),
  ('KYC_DECISION',               'kyc.decide',                    'DOMAIN_COMMAND', 'IDENTITY_VERIFICATION', false, '{decision}'),
  ('HOST_VERIFICATION_DECISION', 'ops.review_listing_host',       'DOMAIN_COMMAND', 'ORGANIZATION',          false, '{decision}'),
  ('PUBLISH_LISTING',            'ops.review_listing_host',       'DOMAIN_COMMAND', 'LISTING',               false, '{}'),
  ('ESCALATE_OVERDUE',           'ops.force_terminate_trip',      'DOMAIN_COMMAND', 'TRIP',                  false, '{}'),
  ('REVIEW_FLAGGED_BOOKING',     'kyc.decide',                    'DOMAIN_COMMAND', 'TRIP',                  false, '{decision}'),
  ('ISSUE_DECISION',             'dispute.decide',                'RECORD_ONLY',    'TRIP',                  true,  '{}'),
  ('RECORD_CHARGEBACK',          'dispute.decide',                'RECORD_ONLY',    'TRIP',                  true,  '{}'),
  ('OPEN_INCIDENT',              'claim.declare',                 'RECORD_ONLY',    'TRIP',                  true,  '{}'),
  ('RECORD_REVIEW',              'ops.review_listing_host',       'RECORD_ONLY',    'TRIP',                  true,  '{}'),
  ('HANDLE_DSR',                 'data.export',                   'RECORD_ONLY',    'SUPPORT_CASE',          true,  '{}'),
  ('ISSUE_BORDEREAU',            'finance.insurer_bordereau',     'DOMAIN_COMMAND', 'INSURER_BORDEREAU',     false, '{}'),
  ('DECIDE_ADVANCE',             'finance.platform_advance',      'DOMAIN_COMMAND', 'PLATFORM_ADVANCE',      false, '{}'),
  ('WRITE_OFF_RECEIVABLE',       'finance.platform_advance',      'DOMAIN_COMMAND', 'PLATFORM_ADVANCE',      false, '{}');

-- Matrice (17 §2.3, colonnes OPS et ADMIN ; PROPOSÉ là où 17 ne nomme pas l'action) -------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT',  'kyc.license_check_at_handover', 'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('OPS_AGENT',  'kyc.decide',                    'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('ADMIN',      'kyc.decide',                    'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('OPS_AGENT',  'ops.review_listing_host',       'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('ADMIN',      'ops.review_listing_host',       'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('OPS_AGENT',  'ops.force_terminate_trip',      'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('ADMIN',      'ops.force_terminate_trip',      'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('OPS_AGENT',  'dispute.decide',                'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3 (FINANCE lim. non semé)'),
  ('ADMIN',      'dispute.decide',                'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3'),
  ('ADMIN',      'data.export',                   'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3 (DSR, journalisé)'),
  ('SUPERADMIN', 'data.export',                   'PLATFORM', '2026-11-03T00:00:00Z', 'US-101 : matrice 17 §2.3 (DSR, journalisé)');

-- 2. manual_action : issue et référence de la commande de domaine ---------------------------------
ALTER TABLE core.support_manual_action
  ADD COLUMN outcome text
    CONSTRAINT manual_action_outcome_valid CHECK (outcome IN ('RECORDED', 'DONE', 'REQUESTED')),
  ADD COLUMN domain_ref uuid;
ALTER TABLE core.support_manual_action
  ADD CONSTRAINT manual_action_evidence_bounded CHECK (pg_catalog.cardinality(evidence_file_ids) <= 20);
COMMENT ON COLUMN core.support_manual_action.outcome IS
  'Issue : RECORDED (enregistrement seul), DONE (commande de domaine appliquée), REQUESTED (demande '
  'FINANCE en attente d''une seconde personne). NULL pour les lignes d''US-012. US-101.';
COMMENT ON COLUMN core.support_manual_action.domain_ref IS
  'Référence rendue par la commande de domaine (par exemple la demande finance_approval). US-101.';

GRANT SELECT (outcome, domain_ref) ON core.support_manual_action TO iam_staff_owner;
GRANT INSERT (evidence_file_ids, emitted_event_ids, outcome, domain_ref)
  ON core.support_manual_action TO iam_staff_owner;

-- 3. Liaison des commandes de domaine ------------------------------------------------------------
CREATE TABLE core.support_manual_action_handler (
  action_code text        CONSTRAINT manual_action_handler_pkey PRIMARY KEY
    REFERENCES core.support_manual_action_catalog (action_code),
  handler     regprocedure NOT NULL,
  story       text        NOT NULL
    CONSTRAINT manual_action_handler_story_format CHECK (story ~ '^US-[0-9]{3}$'),
  bound_at    timestamptz NOT NULL DEFAULT platform.now()
);
ALTER TABLE core.support_manual_action_handler ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_manual_action_handler FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_manual_action_handler TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_manual_action_handler FROM PUBLIC;
GRANT SELECT ON core.support_manual_action_handler TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_manual_action_handler FOR SELECT TO iam_staff_owner
  USING (true);
COMMENT ON TABLE core.support_manual_action_handler IS
  'Commande de domaine liée à une action de console DOMAIN_COMMAND (ADR-091) : ajoutée par la '
  'migration de la story qui livre la commande ; signature et droits vérifiés à la liaison. US-101.';

-- Garde de liaison : action DOMAIN_COMMAND ; signature exacte du gestionnaire
--   (p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb,
--    p_reason text, p_actor uuid, p_actor_role text)
--   RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[]) ;
-- exécutable par iam_staff_owner, JAMAIS par PUBLIC ni par un rôle applicatif.
CREATE FUNCTION core.support_manual_action_handler_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_why text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.support_manual_action_catalog AS c
                  WHERE c.action_code = NEW.action_code AND c.mode = 'DOMAIN_COMMAND') THEN
    RAISE EXCEPTION 'manual_action_handler : action % sans commande de domaine', NEW.action_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'manual_action_handler_domain_only';
  END IF;
  -- comparaisons sur le texte (un oidvector est indexé à partir de 0 : jamais égal à un ARRAY[])
  SELECT CASE
           WHEN NOT (p.proretset AND p.prorettype = 'record'::regtype) THEN 'retour'
           WHEN pg_catalog.array_to_string(p.proallargtypes::regtype[]::text[], ',')
                <> 'bytea,uuid,text,uuid,jsonb,text,uuid,text,text,uuid,uuid[]' THEN 'types'
           WHEN pg_catalog.array_to_string(p.proargmodes::text[], '') <> 'iiiiiiiittt' THEN 'modes'
           WHEN pg_catalog.array_to_string(p.proargnames[9:11], ',')
                <> 'outcome,ref_id,emitted_event_ids' THEN 'colonnes'
           WHEN pg_catalog.array_to_string(p.proconfig, ';') IS DISTINCT FROM
                'search_path=pg_catalog, pg_temp' THEN 'search_path'
           WHEN NOT pg_catalog.has_function_privilege('iam_staff_owner', p.oid, 'EXECUTE')
             THEN 'EXECUTE iam_staff_owner'
           WHEN pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE')
             OR pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE')
             OR pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE')
             THEN 'EXECUTE rôle applicatif'
         END
    INTO v_why
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = NEW.handler;
  IF NOT FOUND OR v_why IS NOT NULL THEN
    RAISE EXCEPTION 'manual_action_handler : gestionnaire % non conforme (%)', NEW.handler,
                    COALESCE(v_why, 'introuvable')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'manual_action_handler_signature';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.support_manual_action_handler_guard() FROM PUBLIC;
CREATE TRIGGER manual_action_handler_guard BEFORE INSERT OR UPDATE ON core.support_manual_action_handler
  FOR EACH ROW EXECUTE FUNCTION core.support_manual_action_handler_guard();

-- 4. Lectures d'iam_staff_owner : pays des sujets, pièces ------------------------------------------
GRANT SELECT (id, country_code) ON core.iam_organization TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_organization FOR SELECT TO iam_staff_owner USING (true);
GRANT SELECT (id, country_code) ON core.settlement_platform_advance TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.settlement_platform_advance FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, country_code) ON core.settlement_insurer_bordereau TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.settlement_insurer_bordereau FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, bucket, deleted_at) ON core.audit_file_asset TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.audit_file_asset FOR SELECT TO iam_staff_owner USING (true);

-- 5. Aides internes (SECURITY INVOKER, exécutées sous iam_staff_owner) -----------------------------
-- Pays d'un sujet, relu en base. `known` = le type a une table en Bêta ; `country` NULL = sujet
-- introuvable. Une story qui crée la table d'un type (IDENTITY_VERIFICATION, LISTING) remplace
-- cette fonction (CREATE OR REPLACE) en ajoutant sa branche.
CREATE FUNCTION core.support_subject_country(p_type text, p_id uuid)
  RETURNS TABLE (known boolean, country text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_type = 'TRIP' THEN
    RETURN QUERY SELECT true, (SELECT t.country_code FROM core.booking_trip AS t WHERE t.id = p_id);
  ELSIF p_type = 'ORGANIZATION' THEN
    RETURN QUERY SELECT true, (SELECT o.country_code FROM core.iam_organization AS o WHERE o.id = p_id);
  ELSIF p_type = 'SUPPORT_CASE' THEN
    RETURN QUERY SELECT true, (SELECT c.country_code FROM core.support_support_case AS c WHERE c.id = p_id);
  ELSIF p_type = 'PLATFORM_ADVANCE' THEN
    RETURN QUERY SELECT true,
      (SELECT a.country_code FROM core.settlement_platform_advance AS a WHERE a.id = p_id);
  ELSIF p_type = 'INSURER_BORDEREAU' THEN
    RETURN QUERY SELECT true,
      (SELECT b.country_code FROM core.settlement_insurer_bordereau AS b WHERE b.id = p_id);
  ELSE
    RETURN QUERY SELECT false, NULL::text;
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION core.support_subject_country(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_subject_country(text, uuid) TO iam_staff_owner;

-- p_user détient-il p_permission par un rôle EN COURS, quel qu'en soit le pays ?
CREATE FUNCTION core.support_staff_holds_permission(p_user uuid, p_permission text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1
                   FROM core.iam_staff_role_assignment AS a
                   JOIN core.iam_role_permission AS p ON p.role = a.role
                  WHERE a.user_id = p_user
                    AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                    AND p.permission_code = p_permission
                    AND p.valid_from <= platform.now()
                    AND (p.valid_to IS NULL OR p.valid_to > platform.now()))
$fn$;
REVOKE ALL ON FUNCTION core.support_staff_holds_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_holds_permission(uuid, text) TO iam_staff_owner;

-- 6. Commande de domaine FINANCE liée (une demande, jamais un effet d'argent) ---------------------
-- La demande relit elle-même session, TOTP, contexte STAFF, permission, portée pays et éligibilité
-- du sujet, et journalise ses refus (0036). Les deux approbateurs restent deux personnes distinctes
-- (cmd_approve_finance_action, appelée par la console hors de ce cadre).
CREATE FUNCTION core.support_manual_action_finance_request(p_token_hash bytea, p_action_id uuid,
                                                           p_action_code text, p_subject_id uuid,
                                                           p_input jsonb, p_reason text,
                                                           p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.outcome, f.approval_id, '{}'::uuid[]
    FROM core.settlement_cmd_request_finance_action(p_token_hash, p_action_id, p_action_code,
                                                    p_subject_id, p_reason) AS f
$fn$;
REVOKE ALL ON FUNCTION core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text,
                                                                  uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text,
                                                                     uuid, text) TO iam_staff_owner;

-- la demande FINANCE est appelée par le gestionnaire, sous iam_staff_owner (son propriétaire
-- cmd_money_owner accorde le droit ; ADR-044 amendé)
SET LOCAL ROLE cmd_money_owner;
GRANT EXECUTE ON FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text)
  TO iam_staff_owner;
RESET ROLE;

INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES
  ('ISSUE_BORDEREAU',
   'core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
   'US-101'),
  ('DECIDE_ADVANCE',
   'core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
   'US-101'),
  ('WRITE_OFF_RECEIVABLE',
   'core.support_manual_action_finance_request(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
   'US-101');

-- 7. Commande de console (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) ------------
-- `migrator` ne crée ni ne remplace une fonction d'iam_staff_owner qu'en devenant lui (ADR-044
-- amendé, comme 0053) ; CREATE sur le schéma accordé le temps de la définition.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Issues : AUTH_REQUIRED (non journalisé : aucun acteur), MFA_REQUIRED, FORBIDDEN, UNAVAILABLE,
-- REFUSED (la commande de domaine a refusé ; `detail` = son issue), RECORDED, DONE, REQUESTED,
-- DUPLICATE (déjà reçue : `detail` = l'issue d'origine). Tout est journalisé sauf AUTH_REQUIRED et
-- DUPLICATE. Données invalides (motif, `input`, pièces) : 22023, rien n'est écrit.
CREATE FUNCTION core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid,
                                                 p_action_code text, p_subject_id uuid,
                                                 p_reason text, p_input jsonb, p_evidence uuid[])
  RETURNS TABLE (outcome text, action_id uuid, domain_ref uuid, detail text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s        record;
  v_cat      record;
  v_subject  record;
  v_prev     record;
  v_h        record;
  v_input    jsonb := COALESCE(p_input, '{}'::jsonb);
  v_evidence uuid[] := COALESCE(p_evidence, '{}'::uuid[]);
  v_country  text;
  v_role     text;
  v_why      text;
  v_key      text;
  v_value    jsonb;
  v_handler  regprocedure;
  v_call     text;
  v_outcome  text;
  v_ref      uuid;
  v_events   uuid[] := '{}'::uuid[];
  v_audit    bigint;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT c.action_code, c.permission_code, c.mode, c.subject_type, c.available, c.input_keys INTO v_cat
    FROM core.support_manual_action_catalog AS c WHERE c.action_code = p_action_code;
  IF v_cat.action_code IS NULL OR p_request_id IS NULL OR p_subject_id IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000
     OR pg_catalog.jsonb_typeof(v_input) <> 'object' OR pg_catalog.octet_length(v_input::text) > 4096
     OR pg_catalog.cardinality(v_evidence) > 20 OR pg_catalog.array_position(v_evidence, NULL) IS NOT NULL
     OR (SELECT pg_catalog.count(DISTINCT e) FROM pg_catalog.unnest(v_evidence) AS e)
        <> pg_catalog.cardinality(v_evidence) THEN
    RAISE EXCEPTION 'console : action, motif ou données invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', v_cat.action_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- pays du sujet, relu en base (jamais reçu du client), puis permission et portée pays
  SELECT r.known, r.country INTO v_subject
    FROM core.support_subject_country(v_cat.subject_type, p_subject_id) AS r;
  IF v_subject.known THEN
    v_country := v_subject.country;
    IF v_country IS NULL THEN
      v_why := 'SUBJECT_NOT_FOUND';
    ELSE
      v_role := core.iam_staff_permitted(v_s.user_id, v_cat.permission_code, ARRAY[v_country], NULL);
      IF v_role IS NULL THEN
        v_why := CASE WHEN core.support_staff_holds_permission(v_s.user_id, v_cat.permission_code)
                      THEN 'COUNTRY_SCOPE' ELSE 'PERMISSION' END;
      END IF;
    END IF;
  ELSIF NOT core.support_staff_holds_permission(v_s.user_id, v_cat.permission_code) THEN
    v_why := 'PERMISSION';
  END IF;
  IF v_why IS NOT NULL THEN
    -- 16 ADM-001 : action interdite => 403 journalisé ; sujet introuvable et hors portée : même issue
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why,
                                   'attempted', v_cat.action_code,
                                   'permission', v_cat.permission_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF NOT v_subject.known THEN
    -- type de sujet sans table en Bêta : aucune commande ne peut encore y être liée
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code),
                                 p_reason, p_request_id);
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- règles de saisie de l'action : clés déclarées seulement, chaînes courtes, JAMAIS un nombre ni
  -- une chaîne numérique (l'agent ne saisit jamais un montant : 19 US-101, 17 §10 NN3)
  FOR v_key, v_value IN SELECT e.key, e.value FROM pg_catalog.jsonb_each(v_input) AS e LOOP
    IF NOT (v_key = ANY (v_cat.input_keys))
       OR pg_catalog.jsonb_typeof(v_value) <> 'string'
       OR pg_catalog.char_length(v_value #>> '{}') NOT BETWEEN 1 AND 200
       OR (v_value #>> '{}') ~ '^\s*[-+]?[0-9]+([.,\s][0-9]+)*\s*$' THEN
      RAISE EXCEPTION 'console : donnée % refusée (clé non déclarée, ou montant)', v_key
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  -- pièces : obligatoires pour une action d'enregistrement seul ; toujours des preuves reçues
  -- (seau PRIVATE_EVIDENCE, non supprimées)
  IF v_cat.mode = 'RECORD_ONLY' AND pg_catalog.cardinality(v_evidence) = 0 THEN
    RAISE EXCEPTION 'console : pièce obligatoire' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.cardinality(v_evidence) > 0
     AND (SELECT pg_catalog.count(*) FROM core.audit_file_asset AS f
           WHERE f.id = ANY (v_evidence) AND f.bucket = 'PRIVATE_EVIDENCE' AND f.deleted_at IS NULL)
         <> pg_catalog.cardinality(v_evidence) THEN
    RAISE EXCEPTION 'console : pièce inconnue' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- idempotence par (action, sujet, request_id) ; un request_id réutilisé ailleurs est refusé
  SELECT m.id, m.action_code, m.subject_id, m.outcome, m.domain_ref INTO v_prev
    FROM core.support_manual_action AS m WHERE m.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action_code = v_cat.action_code AND v_prev.subject_id = p_subject_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id, v_prev.domain_ref, v_prev.outcome;
      RETURN;
    END IF;
    RAISE EXCEPTION 'console : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- disponibilité : RECORD_ONLY ouverte au catalogue ; DOMAIN_COMMAND liée à sa commande
  SELECT h.handler INTO v_handler
    FROM core.support_manual_action_handler AS h WHERE h.action_code = v_cat.action_code;
  IF (v_cat.mode = 'RECORD_ONLY' AND NOT v_cat.available)
     OR (v_cat.mode = 'DOMAIN_COMMAND' AND v_handler IS NULL) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                   'country', v_country), p_reason, p_request_id);
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_cat.mode = 'RECORD_ONLY' THEN
    v_outcome := 'RECORDED';
  ELSE
    -- commande de domaine liée, dans la MÊME transaction : nom lu dans pg_catalog (jamais reçu),
    -- toutes les valeurs liées ; une erreur annule tout (aucune ligne, aucun audit)
    SELECT pg_catalog.format('SELECT h.outcome, h.ref_id, h.emitted_event_ids FROM %I.%I($1, $2, $3, $4, $5, $6, $7, $8) AS h',
                             n.nspname, p.proname)
      INTO v_call
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE p.oid = v_handler;
    EXECUTE v_call INTO v_h
      USING p_token_hash, p_request_id, v_cat.action_code, p_subject_id, v_input,
            pg_catalog.btrim(p_reason), v_s.user_id, v_role;
    IF v_h.outcome IS NULL THEN
      RAISE EXCEPTION 'console : la commande de domaine n''a rendu aucune issue';
    END IF;
    IF v_h.outcome NOT IN ('DONE', 'REQUESTED') THEN
      PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_REFUSED', v_cat.subject_type,
                                   p_subject_id, NULL,
                                   pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                     'country', v_country, 'domainOutcome', v_h.outcome,
                                     'domainRef', v_h.ref_id), p_reason, p_request_id);
      RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, v_h.ref_id, v_h.outcome::text;
      RETURN;
    END IF;
    v_outcome := v_h.outcome;
    v_ref := v_h.ref_id;
    v_events := COALESCE(v_h.emitted_event_ids, '{}'::uuid[]);
  END IF;

  INSERT INTO core.support_manual_action (id, action_code, mode, subject_type, subject_id, country_code,
                                          actor_user_id, actor_role, input, evidence_file_ids, reason,
                                          emitted_event_ids, outcome, domain_ref, request_id)
  VALUES (p_request_id, v_cat.action_code, v_cat.mode, v_cat.subject_type, p_subject_id, v_country,
          v_s.user_id, v_role, v_input, v_evidence, pg_catalog.btrim(p_reason),
          v_events, v_outcome, v_ref, p_request_id);
  v_audit := core.iam_staff_audit(v_s.user_id, v_role,
                                  CASE v_outcome WHEN 'RECORDED' THEN 'MANUAL_ACTION_RECORDED'
                                                 WHEN 'DONE' THEN 'MANUAL_ACTION_DONE'
                                                 ELSE 'MANUAL_ACTION_REQUESTED' END,
                                  v_cat.subject_type, p_subject_id, NULL,
                                  pg_catalog.jsonb_build_object('manualActionId', p_request_id,
                                    'action', v_cat.action_code, 'mode', v_cat.mode,
                                    'country', v_country, 'outcome', v_outcome,
                                    'domainRef', v_ref,
                                    'evidence', pg_catalog.cardinality(v_evidence)),
                                  p_reason, p_request_id);
  UPDATE core.support_manual_action AS m SET audit_log_id = v_audit WHERE m.id = p_request_id;
  RETURN QUERY SELECT v_outcome, p_request_id, v_ref, NULL::text;
END
$fn$;

-- Forme d'US-012 (sans pièces) : même cadre, mêmes règles ; une action d'enregistrement seul y est
-- donc refusée (22023, pièce obligatoire). Gardée pour la version encore servie (expand / contract).
CREATE OR REPLACE FUNCTION core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid,
                                                            p_action_code text, p_subject_id uuid,
                                                            p_reason text, p_input jsonb)
  RETURNS TABLE (outcome text, action_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
    SELECT r.outcome, r.action_id
      FROM core.iam_staff_cmd_manual_action(p_token_hash, p_request_id, p_action_code, p_subject_id,
                                            p_reason, p_input, '{}'::uuid[]) AS r;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[]) IS
  'Action de console (17 §3.2.13, §10) : TOTP, permission, portée pays, aucun montant saisi, pièces '
  'des actions d''enregistrement seul, commande de domaine liée dans la même transaction ; refus '
  'journalisés. US-101 (ADR-091).';
COMMENT ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb) IS
  'Forme d''US-012 sans pièces : délègue au cadre d''US-101 (ADR-091).';

REVOKE ALL ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[])
  TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
