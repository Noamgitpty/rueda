-- 0076 — KYC : décision de l'ops (KYC_DECISION), mise en file des revues manuelles, alerte de délai, dossier KYC complété.
-- US-106 ; 19 US-106 (« Given un dossier en revue, When l'ops enregistre KYC_DECISION, Then motif,
-- auteur et contrôles cochés (liveness, pièce selon le statut, liste des permis, doublons) sont
-- journalisés » ; « Given un dossier entré à 09:00 un jour ouvré, When 13:00 passe sans décision,
-- Then alerte ») ; 16 ADM-002 (file KYC, SLA 4 h ouvrées, alerte, `DECISION_RATIONALE_REQUIRED`),
-- VER-002 / VER-003 (« score sous le seuil ⇒ MANUAL_REVIEW, décision ops motivée et journalisée »),
-- VER-005, VER-006 (liste des permis, refus motivé), ACC-014 (comptes liés repérés à la revue) ;
-- 08 BR-VERIF-01, BR-VERIF-02, BR-ACC-03, SM-3 (MANUAL_REVIEW → APPROVED | REJECTED |
-- MORE_INFO_REQUIRED) ; 17 §2.3 (`kyc.decide`, `kyc.read_sensitive`), §3.2.2, §3.2.13, §4.5,
-- §7.2 (`kyc_review_sla_business_h`), §10 (`KYC_DECISION`) ; 22 OQ-BR-21 (défaut PROPOSÉ) ;
-- ADR-092 (cadre des actions de console), ADR-097 (files), ADR-102 (vérification d'identité),
-- ADR-106 (cette migration). Appliquée sous `migrator`.
--
-- Principes (ADR-106) :
--   - MISE EN FILE : toute entrée d'un dossier courant en `MANUAL_REVIEW` met la personne dans la
--     file KYC (déclencheur `kyc_verification_review_queue`, propriétaire kyc_cmd_owner, par
--     `core.support_enqueue_review` d'US-109 : échéance posée par la base, pays de la personne) ;
--     toute sortie de `MANUAL_REVIEW` qui n'est pas une décision de l'ops (retrait du
--     consentement : RECHECK) ANNULE l'élément vivant. Une mise en file impossible (personne sans
--     pays, paramètre absent) ne bloque pas le rappel du fournisseur : le dossier reste en revue
--     (réservation fermée, fail-closed) et le travailleur `review_sla_watch` le remet en file
--     (verrou de la personne, relecture), en alertant UNE fois par épisode de revue
--     (`review_unqueued_at`) tant qu'il n'y parvient pas ;
--   - DÉCISION : action de console `KYC_DECISION` (cadre d'US-101 : TOTP, `kyc.decide` dans le
--     pays de la personne, motif de 10 à 1000 caractères, idempotence, audit en dernier) liée à
--     la commande de domaine `core.kyc_manual_action_decision`. Saisie (énumérations FERMÉES) :
--     `decision` ∈ {APPROVED, REJECTED, MORE_INFO_REQUIRED} et les QUATRE contrôles cochés,
--     chacun ∈ {PASSED, FAILED} : `livenessCheck` (VER-002 / VER-003), `idDocumentCheck` (pièce
--     selon le statut, VER-005), `licenseListCheck` (liste des permis, VER-006), `duplicateCheck`
--     (comptes liés, ACC-014). Motif, auteur, décision et contrôles sont journalisés dans la ligne
--     `manual_action` (input, reason, actor) et l'audit chaîné ;
--   - la commande juge, sous le verrou de la personne (même clé que l'ouverture, le rappel et le
--     retrait) : dossier courant en `MANUAL_REVIEW` seulement (un retrait du consentement l'a fait
--     passer en RECHECK : refus `NOT_IN_REVIEW`, jamais une décision qui le contredit) ; élément
--     KYC vivant pris en charge PAR L'ACTEUR (verrou de la file, US-109) ; jamais sa propre
--     vérification ; contrôles cohérents avec la décision (APPROVED : tous PASSED ; REJECTED : au
--     moins un FAILED) ; APPROVED exige en plus le consentement biométrique en vigueur et un
--     permis de conduire DÉFINITIF non expiré (fin du jour d'échéance dans le fuseau du pays du
--     dossier) ; aucune écriture avant la fin des contrôles ;
--   - effet : élément clos (DONE, décision), dossier passé à l'état décidé (motif dérivé du
--     premier contrôle en échec, catégorie seulement : BR-VERIF-03), auteur (`reviewed_by`),
--     document accepté si APPROVED, événement `kyc.verification.status_changed` (17 §4.5 ; la
--     notification EVT_KYC_APPROVED d'US-021 part sur `to = APPROVED`) ;
--   - OQ-BR-21 (défaut PROPOSÉ, fail-closed) : liste des permis PROVISOIRE ; IDP, permis non
--     latins, pièce inconnue ou permis non définitif vont en revue (déjà vrai en 0072) ; l'ops ne
--     peut approuver qu'un permis de conduire définitif valable (`LICENSE_NOT_ACCEPTED` sinon ;
--     un IDP seul est refusé, BR-VERIF-02) ;
--   - ALERTE DE DÉLAI : le travailleur `review_sla_watch` marque une fois (`sla_breached_at`)
--     chaque élément ouvert dont l'échéance est passée et émet `support.review_queue.sla_breached`
--     (16 ADM-002 `EVT_REVIEW_SLA_BREACH`) ; l'API relaie une alerte sur le canal d'exploitation ;
--   - DOSSIER KYC (suite N-57) : la lecture de la file (0064, `kyc.read_sensitive`, élément
--     assigné, READ_C3 journalisé AVANT) rend désormais les données minimales de la vérification
--     courante (état, motif, champs minimaux du permis, scores [C3], consentement en vigueur),
--     lues par `core.kyc_staff_dossier` (kyc_cmd_owner, EXECUTE à iam_staff_owner seulement) :
--     c'est la SEULE lecture des tables KYC par le staff ; la fiche 360° montre le statut SM-3,
--     jamais une pièce ni un score.
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'KYC_DECISION';
--   DELETE FROM core.support_manual_action_subject WHERE subject_type = 'IDENTITY_VERIFICATION';
--   UPDATE core.support_manual_action_catalog SET input_keys = '{decision}',
--     input_values = '{"decision": ["APPROVED", "REJECTED"]}' WHERE action_code = 'KYC_DECISION';
--   réappliquer les définitions de 0064 de core.support_staff_kyc_dossier et
--     core.support_staff_profile (sous iam_staff_owner) ;
--   DROP TRIGGER kyc_verification_review_queue ON core.kyc_identity_verification;
--   DROP FUNCTION core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.kyc_country_of_verification(uuid), core.kyc_review_enqueue(uuid, uuid),
--     core.kyc_verification_review_queue(), core.kyc_staff_dossier(uuid),
--     core.kyc_staff_status(uuid), core.kyc_worker_enqueue_reviews(integer),
--     core.support_worker_review_sla(integer);
--   ALTER TABLE core.support_review_queue_item DROP COLUMN sla_breached_at;
--   ALTER TABLE core.kyc_identity_verification DROP COLUMN review_unqueued_at;
--   DROP POLICY kyc_cmd_read_tos ON core.contract_consent ; DROP POLICY kyc_cmd_accept ON
--     core.kyc_identity_document ; DROP POLICY kyc_cmd_event_ops ON core.outbox_outbox_event ;
--   DROP POLICY kyc_cmd_select ON core.support_review_queue_item ; DROP POLICY iam_staff_sla_event
--     ON core.outbox_outbox_event ; révoquer les droits accordés ci-dessous.

-- 1. Catalogue : saisie de KYC_DECISION (décision et contrôles cochés, énumérations fermées) -------
-- Élargissement : la version N n'envoyait que `decision` (APPROVED, REJECTED) à une action
-- indisponible (aucune commande liée) ; aucune ligne `manual_action` n'en dépend.
UPDATE core.support_manual_action_catalog
   SET input_keys = '{decision,livenessCheck,idDocumentCheck,licenseListCheck,duplicateCheck}',
       input_values = '{"decision": ["APPROVED", "REJECTED", "MORE_INFO_REQUIRED"],
                        "livenessCheck": ["PASSED", "FAILED"],
                        "idDocumentCheck": ["PASSED", "FAILED"],
                        "licenseListCheck": ["PASSED", "FAILED"],
                        "duplicateCheck": ["PASSED", "FAILED"]}'::jsonb
 WHERE action_code = 'KYC_DECISION';

-- 2. Éléments de file : alerte de délai émise une fois ---------------------------------------------
ALTER TABLE core.support_review_queue_item ADD COLUMN sla_breached_at timestamptz;
COMMENT ON COLUMN core.support_review_queue_item.sla_breached_at IS
  'Instant où le travailleur review_sla_watch a signalé le dépassement de l''échéance (une seule '
  'alerte par élément). US-106 (ADR-106).';
GRANT UPDATE (sla_breached_at) ON core.support_review_queue_item TO iam_staff_owner;

-- alerte de délai : événement support.review_queue.sla_breached (SYSTEM)
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO iam_staff_owner;
CREATE POLICY iam_staff_sla_event ON core.outbox_outbox_event FOR INSERT TO iam_staff_owner
  WITH CHECK (type = 'support.review_queue.sla_breached' AND aggregate_type = 'review_queue_item'
              AND actor_role = 'SYSTEM');

-- 3. Droits de kyc_cmd_owner, au plus juste ---------------------------------------------------------
-- pays de la personne (dernière acceptation des CGU, 0059) : lu par core.ctr_account_country
GRANT EXECUTE ON FUNCTION core.ctr_account_country(uuid) TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read_tos ON core.contract_consent FOR SELECT TO kyc_cmd_owner
  USING (doc_kind = 'TOS_GUEST');
-- file KYC : élément vivant et prise en charge (lecture seule ; écritures par les commandes
-- d'iam_staff_owner)
GRANT SELECT (id, queue, subject_type, subject_id, country_code, status, assignee_id)
  ON core.support_review_queue_item TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.support_review_queue_item FOR SELECT TO kyc_cmd_owner
  USING (queue = 'KYC');
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid),
  core.support_close_review_item(uuid, text, text, uuid) TO kyc_cmd_owner;
RESET ROLE;
-- décision : auteur du dossier, document accepté (IN_REVIEW → ACCEPTED seulement)
GRANT UPDATE (reviewed_by) ON core.kyc_identity_verification TO kyc_cmd_owner;
-- remise en file par le travailleur : dernier échec signalé (une alerte par épisode de revue)
ALTER TABLE core.kyc_identity_verification ADD COLUMN review_unqueued_at timestamptz;
COMMENT ON COLUMN core.kyc_identity_verification.review_unqueued_at IS
  'Dernier échec de mise en file KYC par le travailleur review_sla_watch (alerte une fois par '
  'épisode de revue ; ordre des essais). US-106 (ADR-106).';
GRANT UPDATE (review_unqueued_at) ON core.kyc_identity_verification TO kyc_cmd_owner;
GRANT UPDATE (status) ON core.kyc_identity_document TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_accept ON core.kyc_identity_document FOR UPDATE TO kyc_cmd_owner
  USING (status = 'IN_REVIEW') WITH CHECK (status = 'ACCEPTED');
-- événement d'état dont l'acteur est le membre du staff qui décide (identifiant posé par la
-- commande : elle ne relit pas l'outbox)
GRANT INSERT (id) ON core.outbox_outbox_event TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_event_ops ON core.outbox_outbox_event FOR INSERT TO kyc_cmd_owner
  WITH CHECK (type = 'kyc.verification.status_changed' AND aggregate_type = 'identity_verification'
              AND actor_role IN ('OPS_AGENT', 'ADMIN') AND actor_user_id IS NOT NULL);

-- 4. Mise en file (SECURITY INVOKER, appelée par les fonctions de kyc_cmd_owner) ------------------
-- File KYC de la personne, dans le pays de son compte ; rend l'issue de support_enqueue_review
-- (CREATED, EXISTS, PARAM_MISSING, COUNTRY_MISMATCH, QUEUE_UNKNOWN) ou COUNTRY_UNKNOWN.
CREATE FUNCTION core.kyc_review_enqueue(p_user uuid, p_actor uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_country text := core.ctr_account_country(p_user);
BEGIN
  IF v_country IS NULL THEN
    RETURN 'COUNTRY_UNKNOWN';
  END IF;
  RETURN (SELECT r.outcome
            FROM core.support_enqueue_review('KYC', 'USER_ACCOUNT', p_user, v_country, p_actor) AS r);
END
$fn$;
REVOKE ALL ON FUNCTION core.kyc_review_enqueue(uuid, uuid) FROM PUBLIC;

-- Déclencheur : entrée en MANUAL_REVIEW ⇒ mise en file ; sortie de MANUAL_REVIEW ⇒ élément vivant
-- annulé (la décision de l'ops l'a déjà clos : NOT_OPEN, sans effet). Une mise en file impossible
-- n'annule pas l'écriture (le rappel du fournisseur reste appliqué ; reprise par le travailleur).
CREATE FUNCTION core.kyc_verification_review_queue()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  IF NOT NEW.is_current THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'MANUAL_REVIEW' THEN
    PERFORM core.kyc_review_enqueue(NEW.user_id, NULL);
  ELSIF OLD.status = 'MANUAL_REVIEW' THEN
    SELECT i.id INTO v_item FROM core.support_review_queue_item AS i
     WHERE i.queue = 'KYC' AND i.subject_type = 'USER_ACCOUNT' AND i.subject_id = NEW.user_id
       AND i.status IN ('OPEN', 'IN_REVIEW');
    IF v_item IS NOT NULL THEN
      PERFORM core.support_close_review_item(v_item, 'CANCELLED', NEW.status, NULL);
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.kyc_verification_review_queue() FROM PUBLIC;

-- 5. Type de sujet IDENTITY_VERIFICATION (cadre d'US-101) : pays de la PERSONNE ---------------------
-- Vérification COURANTE seulement (une ancienne vérification est introuvable : FORBIDDEN
-- journalisé) ; pays = celui du compte de la personne, comme l'élément de la file KYC et la lecture
-- du dossier (0064). SECURITY DEFINER : iam_staff_owner ne lit aucune table KYC.
CREATE FUNCTION core.kyc_country_of_verification(p_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.ctr_account_country(v.user_id)
    FROM core.kyc_identity_verification AS v
   WHERE v.id = p_id AND v.is_current
$fn$;
COMMENT ON FUNCTION core.kyc_country_of_verification(uuid) IS
  'Résolveur du type IDENTITY_VERIFICATION : pays du compte de la personne de la vérification '
  'courante ; NULL sinon. EXECUTE iam_staff_owner. US-106 (ADR-106).';
REVOKE ALL ON FUNCTION core.kyc_country_of_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_country_of_verification(uuid) TO iam_staff_owner;

-- 6. Commande de domaine liée à KYC_DECISION (signature imposée par le cadre d'US-101) -------------
-- Issues : DONE (ref_id = la vérification ; événement émis), PRODUCTION_BLOCKED (base de
-- production : KYC fermé, OQ-MK-09), CHECKS_REQUIRED (décision ou contrôle absent),
-- NOT_FOUND (vérification non courante ou inconnue), SELF_FORBIDDEN (l'acteur est la personne),
-- NOT_IN_REVIEW (dossier hors MANUAL_REVIEW : déjà décidé, retrait du consentement…),
-- ITEM_NOT_CLAIMED (aucun élément KYC vivant pris en charge par l'acteur), CHECKS_INCONSISTENT
-- (APPROVED avec un contrôle en échec, REJECTED sans contrôle en échec), CONSENT_WITHDRAWN
-- (APPROVED sans consentement biométrique en vigueur), LICENSE_NOT_ACCEPTED (APPROVED sans permis
-- de conduire définitif valable). Rien n'est écrit avant la fin des contrôles.
CREATE FUNCTION core.kyc_manual_action_decision(p_token_hash bytea, p_action_id uuid,
                                                p_action_code text, p_subject_id uuid,
                                                p_input jsonb, p_reason text,
                                                p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_decision text := p_input ->> 'decision';
  v_live     text := p_input ->> 'livenessCheck';
  v_doc      text := p_input ->> 'idDocumentCheck';
  v_list     text := p_input ->> 'licenseListCheck';
  v_dup      text := p_input ->> 'duplicateCheck';
  v_now      timestamptz := platform.now();
  v_user     uuid;
  v_v        record;
  v_item     record;
  v_d        record;
  v_tz       text;
  v_end      timestamptz;
  v_failed   boolean;
  v_reason   text;
  v_closed   text;
  v_event    uuid;
BEGIN
  IF p_action_code IS DISTINCT FROM 'KYC_DECISION' OR p_action_id IS NULL OR p_subject_id IS NULL
     OR p_actor IS NULL OR p_actor_role IS NULL OR p_reason IS NULL OR p_input IS NULL THEN
    RAISE EXCEPTION 'décision KYC : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- garde fail-closed en base (OQ-MK-09, L1-PM-05) : environnement inconnu = production
  IF COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RETURN QUERY SELECT 'PRODUCTION_BLOCKED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_decision IS NULL OR v_decision NOT IN ('APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED')
     OR v_live IS NULL OR v_live NOT IN ('PASSED', 'FAILED')
     OR v_doc IS NULL OR v_doc NOT IN ('PASSED', 'FAILED')
     OR v_list IS NULL OR v_list NOT IN ('PASSED', 'FAILED')
     OR v_dup IS NULL OR v_dup NOT IN ('PASSED', 'FAILED') THEN
    RETURN QUERY SELECT 'CHECKS_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  SELECT v.user_id INTO v_user FROM core.kyc_identity_verification AS v
   WHERE v.id = p_subject_id AND v.is_current;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_user = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- consentement, ouverture, rappel, retrait et décision d'une personne : un seul à la fois ;
  -- relecture sans FOR UPDATE (la politique UPDATE masquerait un dossier non courant, 0072)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.id = p_subject_id AND v.is_current;
  IF v_v.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_v.status <> 'MANUAL_REVIEW' THEN
    RETURN QUERY SELECT 'NOT_IN_REVIEW'::text, p_subject_id, '{}'::uuid[];
    RETURN;
  END IF;
  -- verrou de la file (US-109) : l'élément KYC vivant de la personne, pris en charge par l'acteur
  SELECT i.id, i.status, i.assignee_id INTO v_item FROM core.support_review_queue_item AS i
   WHERE i.queue = 'KYC' AND i.subject_type = 'USER_ACCOUNT' AND i.subject_id = v_user
     AND i.status IN ('OPEN', 'IN_REVIEW');
  IF v_item.id IS NULL OR v_item.status <> 'IN_REVIEW'
     OR v_item.assignee_id IS DISTINCT FROM p_actor THEN
    RETURN QUERY SELECT 'ITEM_NOT_CLAIMED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_failed := 'FAILED' IN (v_live, v_doc, v_list, v_dup);
  IF (v_decision = 'APPROVED' AND v_failed) OR (v_decision = 'REJECTED' AND NOT v_failed) THEN
    RETURN QUERY SELECT 'CHECKS_INCONSISTENT'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_decision = 'APPROVED' THEN
    -- jamais une approbation sans le consentement biométrique en vigueur (VER-004)
    IF core.kyc_consent_current(v_user, v_v.country_code::text) IS NULL THEN
      RETURN QUERY SELECT 'CONSENT_WITHDRAWN'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    -- permis de conduire définitif, valable à la décision (BR-VERIF-02 ; OQ-BR-21 : un IDP seul,
    -- un permis provisoire ou de type inconnu n'est jamais approuvé)
    SELECT d.id, d.doc_type, d.is_permanent, d.expiry_date, d.status INTO v_d
      FROM core.kyc_identity_document AS d
     WHERE d.verification_id = v_v.id AND d.attempt = v_v.attempt
     ORDER BY d.created_at DESC, d.id DESC LIMIT 1;
    SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code = v_v.country_code;
    IF v_d.expiry_date IS NOT NULL AND v_tz IS NOT NULL THEN
      v_end := ((v_d.expiry_date + 1)::timestamp AT TIME ZONE v_tz);
    END IF;
    IF v_d.id IS NULL OR v_d.doc_type <> 'DRIVER_LICENSE' OR v_d.is_permanent IS NOT TRUE
       OR v_end IS NULL OR v_end <= v_now THEN
      RETURN QUERY SELECT 'LICENSE_NOT_ACCEPTED'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
  END IF;

  -- effets : élément clos (DONE) AVANT le changement d'état (le déclencheur n'annule donc rien)
  SELECT r.outcome INTO v_closed
    FROM core.support_close_review_item(v_item.id, 'DONE', v_decision, p_actor) AS r;
  IF v_closed IS DISTINCT FROM 'CLOSED' THEN
    RETURN QUERY SELECT 'ITEM_NOT_CLAIMED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_decision = 'APPROVED' THEN
    UPDATE core.kyc_identity_document AS d SET status = 'ACCEPTED'
     WHERE d.id = v_d.id AND d.status = 'IN_REVIEW';
  END IF;
  -- motif : catégorie du premier contrôle en échec (jamais le texte de l'ops, BR-VERIF-03)
  v_reason := CASE
    WHEN v_decision = 'APPROVED' THEN NULL
    WHEN v_live = 'FAILED' THEN 'LIVENESS_FAILED'
    WHEN v_doc = 'FAILED' THEN 'ID_DOCUMENT_REFUSED'
    WHEN v_list = 'FAILED' THEN 'LICENSE_NOT_ACCEPTED'
    WHEN v_dup = 'FAILED' THEN 'DUPLICATE_ACCOUNT'
    ELSE 'MORE_INFO_REQUESTED' END;
  UPDATE core.kyc_identity_verification AS v
     SET status = v_decision, decision_reason_code = v_reason, reviewed_by = p_actor,
         approved_at = CASE WHEN v_decision = 'APPROVED' THEN v_now END,
         expires_at = CASE WHEN v_decision = 'APPROVED' THEN v_end END,
         row_version = v_v.row_version + 1, updated_at = v_now
   WHERE v.id = v_v.id;
  -- identifiant posé ici (UUID v7, 17 §4.1) : kyc_cmd_owner ne relit pas l'outbox (pas de RETURNING)
  v_event := platform.uuid_v7();
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES (v_event, 'kyc.verification.status_changed', 1, 'identity_verification', v_v.id,
          v_v.row_version + 1, v_v.country_code, p_actor, p_actor_role, p_action_id, p_action_id,
          pg_catalog.jsonb_build_object('user_id', v_user, 'from', 'MANUAL_REVIEW',
                                        'to', v_decision, 'reason_code', v_reason),
          v_user::text);
  RETURN QUERY SELECT 'DONE'::text, v_v.id, ARRAY[v_event];
END
$fn$;
COMMENT ON FUNCTION core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à KYC_DECISION (cadre d''US-101) : dossier MANUAL_REVIEW, élément KYC pris en '
  'charge par l''acteur, contrôles cochés cohérents, consentement et permis définitif pour '
  'APPROVED ; élément clos, état décidé, événement. EXECUTE iam_staff_owner. US-106 (ADR-106).';
REVOKE ALL ON FUNCTION core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;

-- 7. Lectures du staff (SECURITY DEFINER, EXECUTE à iam_staff_owner seulement) --------------------
-- Dossier KYC de la personne : appelé par core.support_staff_kyc_dossier APRÈS la ligne READ_C3 du
-- journal d'accès, et par elle seule. Données minimales de la vérification COURANTE : état, motif,
-- tentative, pays du dossier, consentement biométrique en vigueur, champs minimaux du dernier
-- document de la tentative (aucun numéro, aucune image, aucune référence chez le fournisseur) et
-- scores [C3] de la dernière liveness de la tentative (effacés : `erased`).
CREATE FUNCTION core.kyc_staff_dossier(p_user uuid)
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
  SELECT d.doc_type, d.issuing_country, d.expiry_date, d.license_class, d.is_permanent, d.status
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
        'permanent', v_d.is_permanent, 'status', v_d.status) END,
      'liveness', CASE WHEN v_l.result IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'result', v_l.result, 'livenessScore', v_l.liveness_score,
        'faceMatchScore', v_l.face_match_score, 'erased', v_l.erased) END));
END
$fn$;
COMMENT ON FUNCTION core.kyc_staff_dossier(uuid) IS
  'Données minimales de la vérification courante (état, motif, permis, scores C3) pour le dossier '
  'KYC de la file ; EXECUTE iam_staff_owner seulement (lecture journalisée par l''appelant). US-106.';

-- Statut SM-3 de la personne pour la fiche 360° (jamais une pièce ni un score, 16 ADM-005).
CREATE FUNCTION core.kyc_staff_status(p_user uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE((SELECT v.status FROM core.kyc_identity_verification AS v
                    WHERE v.user_id = p_user AND v.is_current), 'NOT_STARTED')
$fn$;
COMMENT ON FUNCTION core.kyc_staff_status(uuid) IS
  'Statut SM-3 de la vérification courante (NOT_STARTED sans vérification) pour la fiche 360° ; '
  'EXECUTE iam_staff_owner seulement. US-106 (ADR-106).';
REVOKE ALL ON FUNCTION core.kyc_staff_dossier(uuid), core.kyc_staff_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_staff_dossier(uuid), core.kyc_staff_status(uuid)
  TO iam_staff_owner;

-- 8. Travailleur review_sla_watch, partie KYC : remise en file des dossiers en revue sans élément --
-- (SECURITY DEFINER, EXECUTE app_worker). Pour chaque candidat : verrou consultatif de la personne
-- TENTÉ (même clé que l'ouverture, le rappel, le retrait et la décision ; pris par une autre
-- transaction : dossier sauté, repris à la passe suivante), puis RELECTURE sous ce verrou (toujours
-- courant, en MANUAL_REVIEW, sans élément vivant) : un retrait du consentement concurrent ne laisse
-- jamais d'élément OPEN périmé. Échec de mise en file : marque `review_unqueued_at` ; un dossier
-- n'est compté dans `unqueued` (alerte P1) qu'à son PREMIER échec de l'épisode de revue (marque
-- absente ou antérieure au dernier changement d'état), ensuite dans `waiting` (aucune alerte). Ordre :
-- d'abord les dossiers jamais tentés dans l'épisode, puis les tentés, du plus ancien essai au plus
-- récent : des dossiers impossibles à mettre en file n'affament jamais la tête du lot.
-- Issues : enqueued (mis en file), unqueued (nouvel échec : alerte), waiting (échec déjà signalé),
-- skipped (verrou pris ailleurs).
CREATE FUNCTION core.kyc_worker_enqueue_reviews(p_batch integer)
  RETURNS TABLE (enqueued integer, unqueued integer, waiting integer, skipped integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_c    record;
  v_v    record;
  v_out  text;
  v_now  timestamptz := platform.now();
  v_ok   integer := 0;
  v_new  integer := 0;
  v_wait integer := 0;
  v_skip integer := 0;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'review_sla_watch' THEN
    RAISE EXCEPTION 'kyc : réservé au travailleur review_sla_watch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'kyc : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_c IN
    SELECT v.id, v.user_id FROM core.kyc_identity_verification AS v
     WHERE v.is_current AND v.status = 'MANUAL_REVIEW'
       AND NOT EXISTS (SELECT 1 FROM core.support_review_queue_item AS i
                        WHERE i.queue = 'KYC' AND i.subject_type = 'USER_ACCOUNT'
                          AND i.subject_id = v.user_id AND i.status IN ('OPEN', 'IN_REVIEW'))
     ORDER BY (v.review_unqueued_at IS NOT NULL AND v.review_unqueued_at >= v.updated_at),
              v.review_unqueued_at NULLS FIRST, v.updated_at, v.id
     LIMIT p_batch
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended('kyc.verification:' || v_c.user_id::text, 0)) THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;
    -- relecture sous le verrou (nouvel instantané) : l'état a pu changer depuis la liste
    SELECT v.status, v.updated_at, v.review_unqueued_at INTO v_v
      FROM core.kyc_identity_verification AS v WHERE v.id = v_c.id AND v.is_current;
    IF v_v.status IS DISTINCT FROM 'MANUAL_REVIEW'
       OR EXISTS (SELECT 1 FROM core.support_review_queue_item AS i
                   WHERE i.queue = 'KYC' AND i.subject_type = 'USER_ACCOUNT'
                     AND i.subject_id = v_c.user_id AND i.status IN ('OPEN', 'IN_REVIEW')) THEN
      CONTINUE;
    END IF;
    v_out := core.kyc_review_enqueue(v_c.user_id, NULL);
    IF v_out IN ('CREATED', 'EXISTS') THEN
      v_ok := v_ok + 1;
      IF v_v.review_unqueued_at IS NOT NULL THEN
        UPDATE core.kyc_identity_verification AS v SET review_unqueued_at = NULL
         WHERE v.id = v_c.id;
      END IF;
    ELSE
      IF v_v.review_unqueued_at IS NULL OR v_v.review_unqueued_at < v_v.updated_at THEN
        v_new := v_new + 1;
      ELSE
        v_wait := v_wait + 1;
      END IF;
      UPDATE core.kyc_identity_verification AS v SET review_unqueued_at = v_now
       WHERE v.id = v_c.id;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_ok, v_new, v_wait, v_skip;
END
$fn$;
COMMENT ON FUNCTION core.kyc_worker_enqueue_reviews(integer) IS
  'Remise en file KYC des dossiers MANUAL_REVIEW sans élément vivant, travailleur '
  'review_sla_watch. SECURITY DEFINER, EXECUTE app_worker. US-106 (ADR-106).';
REVOKE ALL ON FUNCTION core.kyc_worker_enqueue_reviews(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_worker_enqueue_reviews(integer) TO app_worker;

-- déclencheur créé AVANT le transfert de propriété (CREATE TRIGGER exige EXECUTE du créateur)
CREATE TRIGGER kyc_verification_review_queue
  AFTER UPDATE OF status ON core.kyc_identity_verification
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION core.kyc_verification_review_queue();

-- Propriétaire NOLOGIN (mécanique de 0072 : CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_review_enqueue(uuid, uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_verification_review_queue() OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_country_of_verification(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_staff_dossier(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_staff_status(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_worker_enqueue_reviews(integer) OWNER TO kyc_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 9. Liaisons du cadre d'US-101 (contrôlées par leurs déclencheurs) -------------------------------
INSERT INTO core.support_manual_action_subject (subject_type, resolver, story)
VALUES ('IDENTITY_VERIFICATION', 'core.kyc_country_of_verification(uuid)'::regprocedure, 'US-106');
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('KYC_DECISION',
        'core.kyc_manual_action_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-106');

-- 10. Fonctions d'iam_staff_owner : alerte de délai, dossier KYC, fiche 360° ----------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 10.1 Travailleur review_sla_watch, partie files : chaque élément ouvert dont l'échéance est
-- passée est signalé UNE fois (`sla_breached_at`) et un événement `support.review_queue.sla_breached`
-- est émis (aucune donnée personnelle : élément, file, échéance) ; rend les comptes par file et par
-- pays (l'API envoie l'alerte d'exploitation).
CREATE FUNCTION core.support_worker_review_sla(p_batch integer)
  RETURNS TABLE (queue text, country_code text, breached integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
  v_r   record;
  v_ids uuid[] := '{}'::uuid[];
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'review_sla_watch' THEN
    RAISE EXCEPTION 'files : réservé au travailleur review_sla_watch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'files : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_r IN
    SELECT i.id, i.queue, i.country_code, i.sla_due_at
      FROM core.support_review_queue_item AS i
     WHERE i.status IN ('OPEN', 'IN_REVIEW') AND i.sla_breached_at IS NULL
       AND i.sla_due_at <= v_now
     ORDER BY i.sla_due_at, i.id
     LIMIT p_batch
       FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE core.support_review_queue_item AS i SET sla_breached_at = v_now WHERE i.id = v_r.id;
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
    VALUES ('support.review_queue.sla_breached', 1, 'review_queue_item', v_r.id, 0,
            v_r.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('item_id', v_r.id, 'queue', v_r.queue,
                                          'sla_due_at', v_r.sla_due_at, 'severity', 'P2'),
            v_r.id::text);
    v_ids := v_ids || v_r.id;
  END LOOP;
  RETURN QUERY
    SELECT i.queue, i.country_code, pg_catalog.count(*)::integer
      FROM core.support_review_queue_item AS i
     WHERE i.id = ANY (v_ids)
     GROUP BY i.queue, i.country_code
     ORDER BY i.queue, i.country_code;
END
$fn$;
COMMENT ON FUNCTION core.support_worker_review_sla(integer) IS
  'Alerte de délai des files de revue (16 ADM-002) : élément en retard signalé une fois, événement '
  'support.review_queue.sla_breached ; travailleur review_sla_watch. SECURITY DEFINER, EXECUTE '
  'app_worker. US-106 (ADR-106).';
REVOKE ALL ON FUNCTION core.support_worker_review_sla(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_worker_review_sla(integer) TO app_worker;

-- 10.2 Dossier KYC (définition de 0064 recopiée ; seule la fin change, marquée US-106) : SEULEMENT
-- par la file KYC (L1-PM-08), élément ouvert assigné à l'acteur (ADMIN : tout élément de sa
-- portée), permission `kyc.read_sensitive`, journalisé READ_C3 AVANT la lecture. Le dossier rend
-- l'identité déclarée et, depuis US-106, les données minimales de la vérification courante
-- (core.kyc_staff_dossier : état, motif, permis, scores [C3]) ; aucune image.
-- Issues : GRANTED, CASE_REQUIRED (permission détenue, élément non couvert), FORBIDDEN
-- (introuvable ou sans permission dans le pays) ; refus journalisés.
CREATE OR REPLACE FUNCTION core.support_staff_kyc_dossier(p_token_hash bytea, p_request_id uuid,
                                                          p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_item    record;
  v_role    text;
  v_reason  text;
  v_access  uuid;
  v_user    record;
  v_kyc     jsonb;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier KYC : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id
    INTO v_item
    FROM core.support_review_queue_item AS i WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.read_sensitive',
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'KYC' OR v_item.subject_type <> 'USER_ACCOUNT' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    -- pays de l'élément = pays de la personne (revue sécurité US-109, n° 3)
    WHEN core.ctr_account_country(v_item.subject_id) IS DISTINCT FROM v_item.country_code
      THEN 'COUNTRY'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', 'READ_C3', 'field_or_file', 'kyc_dossier')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    -- permission détenue mais élément hors file KYC, clos ou non assigné : CASE_REQUIRED ;
    -- pays discordant : FORBIDDEN
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL AND v_reason <> 'COUNTRY' THEN 'CASE_REQUIRED'
                             ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', v_item.subject_id,
                                            'kyc_dossier', 'READ_C3', v_purpose,
                                            'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  SELECT u.legal_first_name, u.legal_last_name, u.date_of_birth, u.residence_country,
         u.pseudonymized_at
    INTO v_user
    FROM core.iam_user_account AS u WHERE u.id = v_item.subject_id;
  -- US-106 : vérification courante (seule lecture des tables KYC par le staff, ADR-106)
  v_kyc := core.kyc_staff_dossier(v_item.subject_id);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'userId', v_item.subject_id, 'country', v_item.country_code,
    'accessId', v_access, 'kycStatus', v_kyc ->> 'status',
    'verification', v_kyc -> 'verification',
    'pseudonymized', v_user.pseudonymized_at IS NOT NULL,
    'legalFirstName', v_user.legal_first_name, 'legalLastName', v_user.legal_last_name,
    'dateOfBirth', v_user.date_of_birth, 'residenceCountry', v_user.residence_country);
END
$fn$;

-- 10.3 Fiche 360° (définition de 0064 recopiée ; seul le statut KYC change, marqué US-106) :
-- profil, statut KYC SM-3 sans pièce ni score, restrictions, notes internes, comptes d'hôte (fermés
-- à la réservation si le titulaire est restreint), trips comme voyageur, dossiers et éléments de
-- file. Permission `support.read_profile` dans le pays de la personne, couverture (dossier ou
-- élément assigné ; ADMIN : sa portée), journal READ_C2_SUPPORT AVANT la lecture.
CREATE OR REPLACE FUNCTION core.support_staff_profile(p_token_hash bytea, p_request_id uuid,
                                                      p_user_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s          record;
  v_country    text;
  v_role       text;
  v_cover      text;
  v_access     uuid;
  v_u          record;
  v_restricted boolean;
  v_purpose    text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'fiche : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER_ACCOUNT',
                                 p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.ctr_account_country(p_user_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.read_profile', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NOT NULL THEN
    v_cover := core.support_staff_covers_user(v_s.user_id, v_role, p_user_id, v_country);
  END IF;
  IF v_cover IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'USER_ACCOUNT', p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile',
                                   'access_kind', 'READ_C2_SUPPORT')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', p_user_id,
                                            'user_account.profile_360', 'READ_C2_SUPPORT',
                                            v_purpose,
                                            CASE WHEN v_cover LIKE 'scope:%' THEN NULL ELSE v_cover END,
                                            p_request_id, v_country);
  SELECT u.id, u.email, u.email_verified_at, u.phone_e164, u.phone_verified_at, u.legal_first_name,
         u.legal_last_name, u.display_name, u.preferred_locale, u.residence_country, u.status,
         u.pseudonymized_at, u.created_at
    INTO v_u
    FROM core.iam_user_account AS u WHERE u.id = p_user_id;
  v_restricted := EXISTS (SELECT 1 FROM core.iam_restriction AS r
                           WHERE r.user_id = p_user_id AND r.active);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'accessId', v_access, 'country', v_country, 'coverage', pg_catalog.split_part(v_cover, ':', 1),
    'profile', pg_catalog.jsonb_build_object(
      'id', v_u.id, 'email', v_u.email, 'emailVerified', v_u.email_verified_at IS NOT NULL,
      'phone', v_u.phone_e164, 'phoneVerified', v_u.phone_verified_at IS NOT NULL,
      'legalFirstName', v_u.legal_first_name, 'legalLastName', v_u.legal_last_name,
      'displayName', v_u.display_name, 'preferredLocale', v_u.preferred_locale,
      'residenceCountry', v_u.residence_country, 'status', v_u.status,
      'pseudonymized', v_u.pseudonymized_at IS NOT NULL, 'createdAt', v_u.created_at),
    -- statut SM-3 seulement, jamais une pièce ni un score (16 ADM-005) ; US-106
    'kyc', pg_catalog.jsonb_build_object('status', core.kyc_staff_status(p_user_id)),
    'restricted', v_restricted,
    'restrictions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'active', r.active, 'reason', r.reason,
        'createdAt', r.created_at, 'liftedAt', r.lifted_at) ORDER BY r.created_at DESC)
      FROM core.iam_restriction AS r WHERE r.user_id = p_user_id), '[]'::jsonb),
    'notes', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', n.id, 'authorRole', n.author_role, 'body', n.body, 'createdAt', n.created_at)
        ORDER BY n.created_at DESC)
      FROM (SELECT * FROM core.support_internal_note AS x
             WHERE x.subject_type = 'USER_ACCOUNT' AND x.subject_id = p_user_id
             ORDER BY x.created_at DESC LIMIT 50) AS n), '[]'::jsonb),
    -- une même personne apparaît sous ses deux rôles : hôte et voyageur (OQ-P2P-09)
    'hostAccounts', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'orgId', o.id, 'country', o.country_code, 'status', o.status,
        'displayName', o.display_name,
        'bookable', o.status = 'ACTIVE' AND NOT v_restricted) ORDER BY o.country_code)
      FROM core.iam_organization AS o
     WHERE o.holder_user_id = p_user_id AND o.country_code = v_country), '[]'::jsonb),
    'trips', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'publicRef', t.public_ref, 'status', t.status, 'country', t.country_code,
        'scheduledStart', t.scheduled_start, 'scheduledEnd', t.scheduled_end)
        ORDER BY t.scheduled_start DESC)
      FROM (SELECT x.id, x.public_ref, x.status, x.country_code, x.scheduled_start, x.scheduled_end
              FROM core.booking_trip AS x
             WHERE x.guest_user_id = p_user_id AND x.country_code = v_country
             ORDER BY x.scheduled_start DESC LIMIT 50) AS t), '[]'::jsonb),
    'cases', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'category', c.category, 'status', c.status, 'priority', c.priority,
        'channel', c.channel, 'assignedToMe', c.assignee_id IS NOT DISTINCT FROM v_s.user_id,
        'createdAt', c.created_at) ORDER BY c.created_at DESC)
      FROM core.support_support_case AS c
     WHERE c.requester_user_id = p_user_id AND c.country_code = v_country), '[]'::jsonb),
    'queueItems', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id, 'queue', i.queue, 'status', i.status, 'slaDueAt', i.sla_due_at,
        'overdue', i.status IN ('OPEN', 'IN_REVIEW') AND i.sla_due_at <= platform.now())
        ORDER BY i.created_at DESC)
      FROM core.support_review_queue_item AS i
     WHERE i.subject_type = 'USER_ACCOUNT' AND i.subject_id = p_user_id
       AND i.country_code = v_country), '[]'::jsonb));
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
