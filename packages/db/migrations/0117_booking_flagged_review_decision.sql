-- 0117 — AVL / RISK / SUP / KYC : décision de l'ops sur une réservation signalée, hold de revue
-- échu libéré, dossier de revue de la console, borne de la déclaration d'entrée.
-- US-209 (partie 209b, back-end) ; 19 US-209 (critère 2 : « la réservation passe en revue, n'est
-- pas refusée et la décision ops est motivée ») ; 16 BKG-012, ADM-029, VER-007 ; 17 §2.5 (« Revue
-- ops avant le débit » : à l'approbation, une seule prolongation `expires_at = reviewed_at +
-- hold_ttl_minutes`, borne `reviewed_at + hold_max_total_minutes` ; « revue refusée ou non faite
-- dans le délai ⇒ RELEASED (REVIEW_REJECTED), aucun règlement, aucun débit » ; C8, C20), §3.2.13
-- (`risk_assessment`), §10 (catalogue `REVIEW_FLAGGED_BOOKING`) ; 22 UXQ-08, UXQ-03 ; ADR-092
-- (cadre des actions de console), ADR-097 (files), ADR-122 / ADR-124 (séparation des tâches),
-- ADR-135 ; ADR-141 (cette migration). Suites du BOARD : N-172 (en partie). Appliquée sous
-- `migrator`, en une transaction.
--
-- Cette migration :
--   1. séparation des tâches (ADR-122) : `core.support_subject_parties` connaît une évaluation de
--      sujet HOLD (voyageur du hold, personnes du compte d'hôte) ; avant, le type était « inconnu »
--      et toute prise d'un élément RISK_BOOKING issu du checkout était refusée (conflit présumé) ;
--   2. catalogue : `REVIEW_FLAGGED_BOOKING` porte sur l'évaluation (sujet RISK_ASSESSMENT, celui de
--      l'élément de file) et non plus sur un trip (aucun trip n'existe avant le débit, UXQ-08) ;
--      résolveur de pays du type déclaré ;
--   3. commande liée `core.booking_manual_action_review_flagged` (cmd_hold_owner, EXECUTE au seul
--      iam_staff_owner, signature imposée par le cadre d'US-101) : élément RISK_BOOKING pris en
--      charge par l'acteur ; APPROVED ⇒ `reviewed_at` posé et UNE prolongation (`hold_ttl_minutes`,
--      bornée par `hold_max_total_minutes`, depuis la décision), même échéance sur l'occupation ;
--      REJECTED ⇒ RELEASED / REVIEW_REJECTED, occupation libérée ; aucun débit, aucun règlement ;
--      motif journalisé par la console (manual_action, audit chaîné) ;
--   4. hold de revue échu (jamais revu) : `core.booking_hold_review_lapse` (déclencheur AVANT) fait
--      de toute sortie ACTIVE → EXPIRED d'un hold `review_required` sans `reviewed_at` une
--      libération RELEASED / REVIEW_REJECTED, quel que soit l'écrivain (balayage du travailleur,
--      expiration ciblée 2a de la pose et de la conversion : texte EXPIRY_2A_SQL inchangé) ;
--   5. élément de file d'un hold sorti sans décision (échu, libéré, compensé) : clos CANCELLED par
--      `core.booking_hold_review_item_close` (déclencheur APRÈS, cmd_hold_owner) ; aucune reprise
--      (aucun pays ouvert : aucun élément RISK_BOOKING de hold en production ; un élément orphelin
--      d'une base de recette reste visible, la commande liée le refuse : ITEM_NOT_CLAIMED ou
--      HOLD_NOT_LIVE) ;
--   6. dossier de revue de la console : `core.support_staff_booking_review` (iam_staff_owner,
--      EXECUTE app_api ; permission de la file, élément pris en charge, garde ADR-122, accès
--      journalisé AVANT la lecture) ; aides `core.booking_staff_review_dossier` (cmd_hold_owner) et
--      `core.kyc_staff_entry_declaration` (kyc_cmd_owner) ;
--   7. déclaration d'entrée bornée par personne et par heure (`core.kyc_cmd_declare_entry`, corps
--      de 0112 recopié, bloc marqué US-209b) : RATE_LIMITED au-delà de 5 déclarations en une heure
--      glissante (PROPOSÉ, ADR-141).
--
-- Issues de la commande liée (refus : rien n'est écrit) : DONE (ref_id = le hold), DECISION_REQUIRED,
--   NOT_FOUND (évaluation inconnue ou d'un autre sujet qu'un hold), ALREADY_DECIDED,
--   ITEM_NOT_CLAIMED, SELF_FORBIDDEN, HOLD_NOT_LIVE (APPROVED sur un hold sorti), HOLD_EXPIRED
--   (APPROVED d'un hold de revue échu pas encore balayé), START_PASSED (APPROVED après le début
--   prévu : C20), GUEST_INELIGIBLE (APPROVED d'un voyageur devenu inéligible), PARAM_MISSING,
--   BOOKING_UNAVAILABLE (période du devis introuvable), PAYMENT_IN_FLIGHT (REJECTED pendant un
--   paiement, branche PAY_THEN_REVIEW), CANCELLATION_UNAVAILABLE (REJECTED d'un hold converti :
--   annulation remboursée par US-224).
--
-- Hors de cette migration (passation docs/team/handoffs/US-209.md) : annulation
--   PLATFORM_REVIEW_DELAY à T−2 h (US-224, US-215), refus d'un trip payé en PAY_THEN_REVIEW
--   (US-224), mode BLOCK du permis étranger (OQ-BR-21), écrans S05 et déclaration d'entrée (209c).
--
-- Expand / contract : un déclencheur, des fonctions, une ligne de type de sujet, une liaison, des
-- droits et des politiques AJOUTÉS ; corps de `core.support_subject_parties` (0097) et de
-- `core.kyc_cmd_declare_entry` (0112) remplacés à signature, propriétaire et droits identiques ;
-- sujet du catalogue de `REVIEW_FLAGGED_BOOKING` changé (action indisponible jusqu'ici : aucune
-- ligne `manual_action` n'en dépend).
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'REVIEW_FLAGGED_BOOKING' ;
--   UPDATE core.support_manual_action_catalog SET subject_type = 'TRIP'
--     WHERE action_code = 'REVIEW_FLAGGED_BOOKING' ;
--   DELETE FROM core.support_manual_action_subject WHERE subject_type = 'RISK_ASSESSMENT' ;
--   recréer manual_action_catalog_subject_valid de 0061 ;
--   DROP TRIGGER hold_review_lapse, hold_review_item_close ON core.booking_checkout_hold ;
--   réappliquer core.support_subject_parties de 0097 (sous iam_staff_owner) et
--     core.kyc_cmd_declare_entry de 0112 (sous kyc_cmd_owner) ;
--   DROP FUNCTION core.booking_manual_action_review_flagged(bytea, uuid, text, uuid, jsonb, text,
--     uuid, text), core.booking_hold_review_lapse(), core.booking_hold_review_item_close(),
--     core.booking_staff_review_dossier(uuid), core.kyc_staff_entry_declaration(uuid, text),
--     core.support_staff_booking_review(bytea, uuid, uuid, text),
--     core.support_country_of_risk_assessment(uuid) ;
--   DROP POLICY cmd_hold_review_upd ON core.booking_checkout_hold, cmd_occ_review_upd ON
--     core.booking_vehicle_occupancy, cmd_hold_review_read, cmd_hold_review_decide ON
--     core.risk_assessment, cmd_hold_risk_queue ON core.support_review_queue_item,
--     cmd_hold_review_event ON core.outbox_outbox_event, iam_staff_party_read ON
--     core.booking_checkout_hold ;
--   révoquer les droits accordés ci-dessous.

-- 1. Droits de lecture d'iam_staff_owner : personnes d'un hold, pays d'une évaluation ------------
GRANT SELECT (id, guest_user_id, org_id) ON core.booking_checkout_hold TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.booking_checkout_hold FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (country_code) ON core.risk_assessment TO iam_staff_owner;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 1.1 Personnes concernées par un sujet de la console ; NULL = type inconnu (conflit présumé).
-- Définition de 0097 recopiée à l'identique ; seul le bloc marqué US-209b est ajouté : une
-- évaluation de sujet HOLD (checkout, ADR-135) concerne le voyageur du hold et les personnes du
-- compte d'hôte du véhicule (titulaire, membres de tous ses comptes d'hôte).
CREATE OR REPLACE FUNCTION core.support_subject_parties(p_subject_type text, p_subject_id uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
  h record;  -- US-209b
BEGIN
  IF p_subject_type IS NULL OR p_subject_id IS NULL THEN
    RETURN NULL;
  END IF;
  CASE p_subject_type
    WHEN 'USER_ACCOUNT' THEN
      -- US-122 (F2-C-05) : la personne et les personnes de ses comptes d'hôte
      RETURN core.support_person_people(p_subject_id);
    WHEN 'IDENTITY_VERIFICATION' THEN
      -- US-122 (F2-C-05) : idem pour la personne vérifiée
      RETURN core.support_person_people(
               (SELECT v.user_id FROM core.kyc_identity_verification AS v WHERE v.id = p_subject_id));
    WHEN 'ORGANIZATION' THEN
      RETURN core.support_org_people(p_subject_id);
    WHEN 'LISTING' THEN
      SELECT l.org_id INTO r FROM core.catalog_listing AS l WHERE l.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE' THEN
      SELECT x.org_id INTO r FROM core.catalog_vehicle AS x WHERE x.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE_CLAIM' THEN
      SELECT c.org_id, c.claimant_user_id, x.org_id AS target_org INTO r
        FROM core.catalog_vehicle_claim AS c
        LEFT JOIN core.catalog_vehicle AS x ON x.id = c.target_vehicle_id
       WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.claimant_user_id], NULL)
             || core.support_org_people(r.org_id) || core.support_org_people(r.target_org);
    WHEN 'CATALOG_ADDITION_REQUEST' THEN
      SELECT a.org_id, a.requested_by INTO r
        FROM core.catalog_addition_request AS a WHERE a.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requested_by], NULL) || core.support_org_people(r.org_id);
    WHEN 'TRIP' THEN
      SELECT t.guest_user_id, t.org_id INTO r FROM core.booking_trip AS t WHERE t.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.guest_user_id], NULL) || core.support_org_people(r.org_id);
    WHEN 'SUPPORT_CASE' THEN
      SELECT c.requester_user_id, c.trip_id INTO r
        FROM core.support_support_case AS c WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requester_user_id], NULL)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'PLATFORM_ADVANCE' THEN
      SELECT a.org_id, a.trip_id INTO r
        FROM core.settlement_platform_advance AS a WHERE a.id = p_subject_id;
      RETURN core.support_org_people(r.org_id)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'RISK_ASSESSMENT' THEN
      -- US-122 (F2-C-01) : compte d'hôte de l'évaluation et son sujet (personne ou trip) ; un sujet
      -- d'une autre sorte (HOLD : aucune évaluation n'en porte au lot 1) : conflit présumé
      SELECT a.subject_type, a.subject_id, a.org_id INTO r
        FROM core.risk_assessment AS a WHERE a.id = p_subject_id;
      IF r.subject_type IS NULL THEN
        RETURN '{}'::uuid[];
      ELSIF r.subject_type = 'USER' THEN
        RETURN core.support_org_people(r.org_id) || core.support_person_people(r.subject_id);
      ELSIF r.subject_type = 'TRIP' THEN
        RETURN core.support_org_people(r.org_id)
               || COALESCE(core.support_subject_parties('TRIP', r.subject_id), '{}'::uuid[]);
      -- US-209b (ADR-141) : évaluation d'un hold de checkout (ADR-135) : voyageur du hold, personnes
      -- du compte d'hôte du hold et de celui de l'évaluation ; hold introuvable : conflit présumé
      ELSIF r.subject_type = 'HOLD' THEN
        SELECT ch.guest_user_id, ch.org_id INTO h
          FROM core.booking_checkout_hold AS ch WHERE ch.id = r.subject_id;
        IF h.guest_user_id IS NULL THEN
          RETURN NULL;
        END IF;
        RETURN ARRAY[h.guest_user_id] || core.support_org_people(h.org_id)
               || core.support_org_people(r.org_id);
      END IF;
      RETURN NULL;
    WHEN 'INSURER_BORDEREAU' THEN
      RETURN '{}'::uuid[];
    ELSE
      RETURN NULL;
  END CASE;
END
$fn$;
COMMENT ON FUNCTION core.support_subject_parties(text, uuid) IS
  'Personnes concernées par un sujet de la console (NULL : type inconnu) ; personne et '
  'vérification d''identité : aussi les personnes de ses comptes d''hôte ; évaluation d''un hold : '
  'voyageur et personnes du compte d''hôte. Aide interne sous iam_staff_owner. US-122 (ADR-122, '
  'ADR-124), US-209 (ADR-141).';

-- 1.2 Résolveur du type RISK_ASSESSMENT (cadre d'US-101) : pays de l'évaluation ; NULL sinon.
CREATE FUNCTION core.support_country_of_risk_assessment(p_id uuid)
  RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT a.country_code FROM core.risk_assessment AS a WHERE a.id = p_id $fn$;
COMMENT ON FUNCTION core.support_country_of_risk_assessment(uuid) IS
  'Résolveur du type de sujet RISK_ASSESSMENT des actions de console : pays de l''évaluation. '
  'SECURITY INVOKER sous iam_staff_owner. US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.support_country_of_risk_assessment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_country_of_risk_assessment(uuid) TO iam_staff_owner;

-- 1.3 clôture d'un élément RISK_BOOKING par la commande liée et par le déclencheur du hold
GRANT EXECUTE ON FUNCTION core.support_close_review_item(uuid, text, text, uuid) TO cmd_hold_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 2. Droits de cmd_hold_owner, au plus juste --------------------------------------------------
-- 2.1 évaluation d'un hold : lue et décidée (auteur et date de la revue seulement)
GRANT SELECT (id, country_code, org_id, rules_fired, score, decision, reviewed_by, created_at)
  ON core.risk_assessment TO cmd_hold_owner;
CREATE POLICY cmd_hold_review_read ON core.risk_assessment FOR SELECT TO cmd_hold_owner
  USING (subject_type = 'HOLD');
GRANT UPDATE (reviewed_by, decided_at) ON core.risk_assessment TO cmd_hold_owner;
CREATE POLICY cmd_hold_review_decide ON core.risk_assessment FOR UPDATE TO cmd_hold_owner
  USING (subject_type = 'HOLD' AND decision = 'REVIEW' AND decided_at IS NULL)
  WITH CHECK (subject_type = 'HOLD' AND decision = 'REVIEW' AND decided_at IS NOT NULL
              AND reviewed_by IS NOT NULL);
-- 2.2 élément vivant de la file RISK_BOOKING et sa prise en charge (lecture seule ; la clôture
-- passe par core.support_close_review_item)
GRANT SELECT (id, queue, subject_type, subject_id, country_code, status, assignee_id)
  ON core.support_review_queue_item TO cmd_hold_owner;
CREATE POLICY cmd_hold_risk_queue ON core.support_review_queue_item FOR SELECT TO cmd_hold_owner
  USING (queue = 'RISK_BOOKING');
-- 2.3 décision sur un hold vivant : prolongation unique (reviewed_at, expires_at : le
-- déclencheur hold_guarded_columns n'admet l'échéance que dans l'instruction qui pose
-- reviewed_at) ou libération REVIEW_REJECTED. Aucun rôle applicatif n'a UPDATE sur la table :
-- seules les commandes SECURITY DEFINER de cmd_hold_owner l'écrivent.
GRANT SELECT (release_reason) ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT UPDATE (reviewed_at, expires_at) ON core.booking_checkout_hold TO cmd_hold_owner;
CREATE POLICY cmd_hold_review_upd ON core.booking_checkout_hold FOR UPDATE TO cmd_hold_owner
  USING (status = 'ACTIVE')
  WITH CHECK ((status = 'ACTIVE' AND review_required AND reviewed_at IS NOT NULL)
              OR (status = 'RELEASED' AND release_reason = 'REVIEW_REJECTED'));
GRANT UPDATE (expires_at) ON core.booking_vehicle_occupancy TO cmd_hold_owner;
CREATE POLICY cmd_occ_review_upd ON core.booking_vehicle_occupancy FOR UPDATE TO cmd_hold_owner
  USING (kind = 'HOLD' AND active AND ref_type = 'HOLD')
  WITH CHECK (kind = 'HOLD' AND ref_type = 'HOLD'
              AND (active OR deactivated_reason = 'HOLD_RELEASED'));
-- 2.4 événement de la décision (acteur = le membre du staff ; identifiant posé par la commande)
GRANT INSERT (id) ON core.outbox_outbox_event TO cmd_hold_owner;
CREATE POLICY cmd_hold_review_event ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'checkout_hold' AND type = 'booking.hold.review_decided'
              AND actor_role IN ('OPS_AGENT', 'ADMIN') AND actor_user_id IS NOT NULL);

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 3. Commande liée à REVIEW_FLAGGED_BOOKING (signature imposée par le cadre d'US-101) -----------
-- Les contrôles d'accès (session TOTP, permission kyc.decide dans le pays de l'évaluation, saisie
-- fermée {decision: APPROVED | REJECTED}, garde ADR-122, idempotence par request_id) sont faits
-- par core.iam_staff_cmd_manual_action AVANT l'appel ; cette commande relit l'état sous verrou.
-- Rien n'est écrit avant la fin des contrôles. Aucun montant, aucun débit, aucun règlement.
CREATE FUNCTION core.booking_manual_action_review_flagged(p_token_hash bytea, p_action_id uuid,
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
  v_now      timestamptz;
  v_a        record;
  v_h        record;
  v_item     record;
  v_period   tstzrange;
  v_ttl      integer;
  v_max      integer;
  v_minutes  integer;
  v_expires  timestamptz;
  v_closed   text;
  v_event    uuid;
  v_elig     text;
  n          integer;
BEGIN
  IF p_action_code IS DISTINCT FROM 'REVIEW_FLAGGED_BOOKING' OR p_action_id IS NULL
     OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL OR p_reason IS NULL
     OR p_input IS NULL THEN
    RAISE EXCEPTION 'revue de réservation : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_decision IS NULL OR v_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RETURN QUERY SELECT 'DECISION_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  SELECT a.id, a.subject_id, a.country_code, a.org_id, a.decision, a.decided_at INTO v_a
    FROM core.risk_assessment AS a
   WHERE a.id = p_subject_id AND a.subject_type = 'HOLD';
  IF v_a.id IS NULL OR v_a.decision <> 'REVIEW' THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- même ordre de verrous que la pose et l'expiration ciblée : voyageur, puis véhicule, puis hold
  SELECT ch.guest_user_id, ch.vehicle_id INTO v_h
    FROM core.booking_checkout_hold AS ch WHERE ch.id = v_a.subject_id;
  IF v_h.guest_user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122)
  IF v_h.guest_user_id = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guest:' || v_h.guest_user_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('veh:' || v_h.vehicle_id::text, 0));
  -- relecture de l'évaluation : une seule décision (deux agents, deux demandes)
  SELECT a.decided_at INTO v_a.decided_at FROM core.risk_assessment AS a WHERE a.id = v_a.id;
  IF v_a.decided_at IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_DECIDED'::text, v_a.subject_id, '{}'::uuid[];
    RETURN;
  END IF;
  -- verrou de la file (US-109) : l'élément RISK_BOOKING vivant de l'évaluation, pris en charge
  -- par l'acteur
  SELECT i.id, i.status, i.assignee_id INTO v_item
    FROM core.support_review_queue_item AS i
   WHERE i.queue = 'RISK_BOOKING' AND i.subject_type = 'RISK_ASSESSMENT' AND i.subject_id = v_a.id
     AND i.status IN ('OPEN', 'IN_REVIEW');
  IF v_item.id IS NULL OR v_item.status <> 'IN_REVIEW'
     OR v_item.assignee_id IS DISTINCT FROM p_actor THEN
    RETURN QUERY SELECT 'ITEM_NOT_CLAIMED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- état du hold : lecture, puis verrou de la ligne si elle est vivante (le démarrage du paiement
  -- la verrouille aussi : C8, jamais une décision et une intention de paiement mêlées)
  SELECT ch.id, ch.status, ch.review_required, ch.reviewed_at, ch.expires_at, ch.occupancy_id,
         ch.org_id, ch.vehicle_id, ch.country_code INTO v_h
    FROM core.booking_checkout_hold AS ch WHERE ch.id = v_a.subject_id;
  IF v_h.status = 'ACTIVE' THEN
    SELECT ch.id, ch.status, ch.review_required, ch.reviewed_at, ch.expires_at, ch.occupancy_id,
           ch.org_id, ch.vehicle_id, ch.country_code INTO v_h
      FROM core.booking_checkout_hold AS ch WHERE ch.id = v_a.subject_id
       FOR UPDATE;
    IF v_h.id IS NULL THEN
      RETURN QUERY SELECT 'HOLD_NOT_LIVE'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
  END IF;
  v_now := platform.now();

  IF v_decision = 'APPROVED' THEN
    IF v_h.status = 'CONVERTED' OR v_h.status = 'PAYMENT_IN_FLIGHT' THEN
      -- PAY_THEN_REVIEW : le paiement est parti ; l'approbation ne change rien au hold
      IF v_h.review_required THEN
        RETURN QUERY SELECT 'HOLD_NOT_LIVE'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
    ELSIF v_h.status <> 'ACTIVE' THEN
      RETURN QUERY SELECT 'HOLD_NOT_LIVE'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    ELSIF v_h.review_required THEN
      -- hold de revue : avant son échéance, avant le début prévu (C20), voyageur toujours éligible
      IF v_h.expires_at <= v_now THEN
        RETURN QUERY SELECT 'HOLD_EXPIRED'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      SELECT q.period INTO v_period
        FROM core.booking_checkout_acceptance AS a
        JOIN core.pricing_quote AS q ON q.id = a.quote_id
       WHERE a.hold_id = v_h.id;
      IF v_period IS NULL THEN
        RETURN QUERY SELECT 'BOOKING_UNAVAILABLE'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      IF pg_catalog.lower(v_period) <= v_now THEN
        RETURN QUERY SELECT 'START_PASSED'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      v_elig := core.booking_guest_eligibility(v_h.id);
      IF v_elig IS DISTINCT FROM 'ELIGIBLE' THEN
        RETURN QUERY SELECT 'GUEST_INELIGIBLE'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      v_ttl := core.booking_param_int('hold_ttl_minutes', v_h.country_code);
      v_max := core.booking_param_int('hold_max_total_minutes', v_h.country_code);
      IF v_ttl IS NULL OR v_max IS NULL OR v_ttl < 1 OR v_max < 1 THEN
        RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      -- 17 §2.5 : expires_at = reviewed_at + hold_ttl_minutes, borne reviewed_at + hold_max_total
      v_minutes := LEAST(v_ttl, v_max);
      v_expires := v_now + pg_catalog.make_interval(mins => v_minutes);
    END IF;
  ELSE
    IF v_h.status = 'PAYMENT_IN_FLIGHT' THEN
      RETURN QUERY SELECT 'PAYMENT_IN_FLIGHT'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    ELSIF v_h.status = 'CONVERTED' THEN
      -- PAY_THEN_REVIEW : trip payé ; son annulation remboursée est celle d'US-224 (fail-closed)
      RETURN QUERY SELECT 'CANCELLATION_UNAVAILABLE'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    -- ACTIVE : libéré ci-dessous ; déjà sorti (EXPIRED, RELEASED, COMPENSATED) : décision
    -- enregistrée seulement, aucun effet sur le hold
  END IF;

  -- effets : élément clos (DONE) AVANT le changement d'état du hold (le déclencheur de clôture ne
  -- trouve donc plus d'élément vivant)
  SELECT r.outcome INTO v_closed
    FROM core.support_close_review_item(v_item.id, 'DONE', v_decision, p_actor) AS r;
  IF v_closed IS DISTINCT FROM 'CLOSED' THEN
    RETURN QUERY SELECT 'ITEM_NOT_CLAIMED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  UPDATE core.risk_assessment AS a SET reviewed_by = p_actor, decided_at = v_now
   WHERE a.id = v_a.id AND a.decided_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'revue de réservation : évaluation déjà décidée'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF v_decision = 'APPROVED' AND v_expires IS NOT NULL THEN
    -- prolongation unique : reviewed_at et expires_at dans la MÊME instruction (hold_guarded_columns)
    UPDATE core.booking_checkout_hold AS ch
       SET reviewed_at = v_now, expires_at = v_expires, updated_by = p_actor
     WHERE ch.id = v_h.id AND ch.status = 'ACTIVE' AND ch.reviewed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'revue de réservation : hold modifié pendant la décision'
        USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE core.booking_vehicle_occupancy AS vo
       SET expires_at = v_expires, updated_by = p_actor
     WHERE vo.id = v_h.occupancy_id AND vo.kind = 'HOLD' AND vo.active;
  ELSIF v_decision = 'REJECTED' AND v_h.status = 'ACTIVE' THEN
    UPDATE core.booking_checkout_hold AS ch
       SET status = 'RELEASED', release_reason = 'REVIEW_REJECTED', released_at = v_now,
           released_by = p_actor, updated_by = p_actor
     WHERE ch.id = v_h.id AND ch.status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'revue de réservation : hold modifié pendant la décision'
        USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE core.booking_vehicle_occupancy AS vo
       SET active = false, deactivated_reason = 'HOLD_RELEASED', updated_by = p_actor
     WHERE vo.id = v_h.occupancy_id AND vo.kind = 'HOLD' AND vo.active;
  END IF;
  -- identifiant posé ici (UUID v7, 17 §4.1) : cmd_hold_owner ne relit pas l'outbox. Aucune donnée
  -- personnelle : hold, compte d'hôte, véhicule, décision.
  v_event := platform.uuid_v7();
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES (v_event, 'booking.hold.review_decided', 1, 'checkout_hold', v_h.id, 2, v_h.country_code,
          p_actor, p_actor_role, p_action_id, p_action_id,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'hold_id', v_h.id, 'org_id', v_h.org_id, 'vehicle_id', v_h.vehicle_id,
            'decision', v_decision, 'expires_at', v_expires,
            'released', v_decision = 'REJECTED' AND v_h.status = 'ACTIVE')),
          v_h.id::text);
  RETURN QUERY SELECT 'DONE'::text, v_h.id, ARRAY[v_event];
END
$fn$;
COMMENT ON FUNCTION core.booking_manual_action_review_flagged(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à REVIEW_FLAGGED_BOOKING (cadre d''US-101) : évaluation de hold en revue, élément '
  'RISK_BOOKING pris en charge par l''acteur ; APPROVED ⇒ reviewed_at et prolongation unique '
  '(hold_ttl_minutes, borne hold_max_total_minutes) ; REJECTED ⇒ RELEASED / REVIEW_REJECTED ; '
  'aucun débit. EXECUTE iam_staff_owner. US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.booking_manual_action_review_flagged(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_manual_action_review_flagged(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;

-- 4. Dossier de revue d'une réservation signalée (lu par la console, après le journal d'accès) ---
-- Aucune donnée personnelle du voyageur : références, règles déclenchées (codes et signaux),
-- score, état et échéances du hold, période du devis engagé.
CREATE FUNCTION core.booking_staff_review_dossier(p_assessment uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a      record;
  v_h      record;
  v_period tstzrange;
BEGIN
  SELECT a.id, a.subject_id, a.country_code, a.org_id, a.rules_fired, a.score, a.decision,
         a.reviewed_by, a.decided_at, a.created_at INTO v_a
    FROM core.risk_assessment AS a
   WHERE a.id = p_assessment AND a.subject_type = 'HOLD';
  IF v_a.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT ch.id, ch.guest_user_id, ch.vehicle_id, ch.status, ch.review_required, ch.reviewed_at,
         ch.expires_at, ch.created_at INTO v_h
    FROM core.booking_checkout_hold AS ch WHERE ch.id = v_a.subject_id;
  SELECT q.period INTO v_period
    FROM core.booking_checkout_acceptance AS a
    JOIN core.pricing_quote AS q ON q.id = a.quote_id
   WHERE a.hold_id = v_a.subject_id;
  RETURN pg_catalog.jsonb_build_object(
    'assessmentId', v_a.id, 'holdId', v_h.id, 'guestUserId', v_h.guest_user_id,
    'vehicleId', v_h.vehicle_id, 'orgId', v_a.org_id, 'country', v_a.country_code,
    'rulesFired', v_a.rules_fired, 'score', v_a.score, 'flaggedAt', v_a.created_at,
    'holdStatus', v_h.status, 'reviewBeforeCharge', v_h.review_required,
    'reviewedAt', v_h.reviewed_at, 'expiresAt', v_h.expires_at,
    'startsAt', pg_catalog.lower(v_period), 'endsAt', pg_catalog.upper(v_period));
END
$fn$;
COMMENT ON FUNCTION core.booking_staff_review_dossier(uuid) IS
  'Dossier d''une réservation signalée (évaluation de hold) pour la console : règles, score, état '
  'et échéance du hold, période du devis ; aucune donnée personnelle. EXECUTE iam_staff_owner '
  'seulement (core.support_staff_booking_review). US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.booking_staff_review_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_staff_review_dossier(uuid) TO iam_staff_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 5. Hold de revue échu : RELEASED / REVIEW_REJECTED (17 §2.5), quel que soit l'écrivain ---------
-- Fonctions des déclencheurs créées par migrator (CREATE TRIGGER exige EXECUTE du créateur, comme
-- 0076), puis la seconde transférée à cmd_hold_owner (SECURITY DEFINER) après la création du
-- déclencheur. SECURITY INVOKER, aucune lecture : la ligne seule est réécrite avant l'écriture (les politiques
-- de l'écrivain admettent déjà RELEASED : hold_expiry, cmd_hold_upd, travailleurs de conversion).
CREATE FUNCTION core.booking_hold_review_lapse()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.status := 'RELEASED';
  NEW.release_reason := 'REVIEW_REJECTED';
  NEW.released_at := COALESCE(NEW.expired_at, platform.now());
  NEW.expired_at := NULL;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.booking_hold_review_lapse() IS
  'Déclencheur hold_review_lapse (17 §2.5 « revue non faite dans le délai ⇒ RELEASED '
  '(REVIEW_REJECTED) ») : l''expiration d''un hold de revue jamais revu devient une libération. '
  'US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.booking_hold_review_lapse() FROM PUBLIC;

-- 6. Élément de file d'un hold sorti sans décision : clos CANCELLED ------------------------------
-- SECURITY DEFINER (cmd_hold_owner : lecture de l'évaluation et de la file, clôture) ; appelée
-- par le seul déclencheur (aucun EXECUTE). Décision posée : HOLD_EXPIRED, HOLD_RELEASED ou
-- HOLD_COMPENSATED. Un hold CONVERTED (PAY_THEN_REVIEW) garde son élément : la revue porte sur
-- le trip.
CREATE FUNCTION core.booking_hold_review_item_close()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  SELECT i.id INTO v_item
    FROM core.risk_assessment AS a
    JOIN core.support_review_queue_item AS i
      ON i.queue = 'RISK_BOOKING' AND i.subject_type = 'RISK_ASSESSMENT' AND i.subject_id = a.id
     AND i.status IN ('OPEN', 'IN_REVIEW')
   WHERE a.subject_type = 'HOLD' AND a.subject_id = NEW.id AND a.decision = 'REVIEW'
     AND a.decided_at IS NULL
   LIMIT 1;
  IF v_item IS NOT NULL THEN
    PERFORM core.support_close_review_item(v_item, 'CANCELLED', 'HOLD_' || NEW.status, NULL);
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.booking_hold_review_item_close() IS
  'Déclencheur hold_review_item_close : l''élément RISK_BOOKING d''un hold sorti sans décision '
  '(échu, libéré, compensé) est clos CANCELLED. SECURITY DEFINER, aucun EXECUTE. US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.booking_hold_review_item_close() FROM PUBLIC;

-- 7. Déclencheurs du hold -------------------------------------------------------------------------
-- AVANT : l'ordre alphabétique place hold_guarded_columns avant hold_review_lapse (aucune colonne
-- gardée n'est touchée) et touch_row après.
CREATE TRIGGER hold_review_lapse
  BEFORE UPDATE OF status ON core.booking_checkout_hold
  FOR EACH ROW
  WHEN (OLD.review_required AND OLD.reviewed_at IS NULL AND OLD.status = 'ACTIVE'
        AND NEW.status = 'EXPIRED')
  EXECUTE FUNCTION core.booking_hold_review_lapse();
CREATE TRIGGER hold_review_item_close
  AFTER UPDATE OF status ON core.booking_checkout_hold
  FOR EACH ROW
  WHEN (OLD.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
        AND NEW.status IN ('EXPIRED', 'RELEASED', 'COMPENSATED'))
  EXECUTE FUNCTION core.booking_hold_review_item_close();
-- propriétaire NOLOGIN de la fonction SECURITY DEFINER (CREATE le temps du transfert seulement)
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_hold_review_item_close() OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 8. KYC : déclaration d'entrée lue par la console ; borne par personne et par heure ------------
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

-- Dernière déclaration d'entrée de la personne pour un pays (16 VER-007, UXQ-03 : l'ops contrôle
-- statut et date à la revue) : statut, date [C2], instant ; NULL si aucune. Lue par la console
-- APRÈS le journal d'accès (READ_C2_SUPPORT).
CREATE FUNCTION core.kyc_staff_entry_declaration(p_user uuid, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object('residencyStatus', d.residency_status,
                                       'entryDate', d.entry_date, 'declaredAt', d.declared_at)
    FROM core.kyc_entry_declaration AS d
   WHERE d.user_id = p_user AND d.country_code::text = p_country
   ORDER BY d.declared_at DESC, d.id DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.kyc_staff_entry_declaration(uuid, text) IS
  'Dernière déclaration d''entrée d''une personne pour un pays (statut, date [C2]) pour le dossier '
  'de revue de la console. EXECUTE iam_staff_owner seulement. US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.kyc_staff_entry_declaration(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_staff_entry_declaration(uuid, text) TO iam_staff_owner;

-- Déclaration d'entrée : corps de 0112 recopié, bloc marqué US-209b ajouté (borne par personne et
-- par heure, N-172 : au plus 5 déclarations en une heure glissante, PROPOSÉ ; au-delà RATE_LIMITED).
CREATE OR REPLACE FUNCTION core.kyc_cmd_declare_entry(p_token_hash bytea, p_country text,
                                                      p_residency text, p_entry_date date)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_tz     text;
  v_recent integer;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = p_country;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text;
    RETURN;
  END IF;
  IF p_residency IS NULL OR p_residency NOT IN ('TOURIST', 'RESIDENT')
     OR (p_residency = 'TOURIST' AND p_entry_date IS NULL) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  IF p_entry_date IS NOT NULL
     AND (p_entry_date > (platform.now() AT TIME ZONE v_tz)::date
          OR p_entry_date < DATE '1900-01-01') THEN
    RETURN QUERY SELECT 'KYC_ENTRY_DATE_INVALID'::text;
    RETURN;
  END IF;
  -- US-209b (ADR-141, N-172) : au plus 5 déclarations par personne en une heure glissante, tous
  -- pays (déclarations concurrentes de la même personne sérialisées)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.entry_declaration:' || v_user::text, 0));
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM core.kyc_entry_declaration AS d
   WHERE d.user_id = v_user AND d.declared_at > platform.now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN QUERY SELECT 'RATE_LIMITED'::text;
    RETURN;
  END IF;
  INSERT INTO core.kyc_entry_declaration (user_id, country_code, residency_status, entry_date)
  VALUES (v_user, p_country, p_residency, p_entry_date);
  RETURN QUERY SELECT 'DONE'::text;
END
$fn$;
COMMENT ON FUNCTION core.kyc_cmd_declare_entry(bytea, text, text, date) IS
  'Commande : déclaration d''entrée (statut, date) de la personne de la session (16 VER-007, '
  'UXQ-03) ; date future ⇒ KYC_ENTRY_DATE_INVALID ; plus de 5 en une heure ⇒ RATE_LIMITED. '
  'SECURITY DEFINER, EXECUTE app_api. US-209 (ADR-135, ADR-141).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 9. Dossier de revue de la console (famille iam_staff_owner, EXECUTE app_api) -----------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Lecture du dossier d'un élément RISK_BOOKING issu du checkout : session élevée par TOTP,
-- permission de la file (kyc.decide) dans le pays de l'élément, élément vivant pris en charge par
-- l'agent (ADMIN : tout élément vivant du pays), jamais un sujet qui le concerne (ADR-122) ;
-- journal d'accès (READ_C2_SUPPORT : date d'entrée déclarée) AVANT toute donnée. Issues : GRANTED,
-- AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, CASE_REQUIRED, SELF_FORBIDDEN, NOT_A_BOOKING (élément
-- RISK_BOOKING d'une autre sorte : compte lié, US-127).
CREATE FUNCTION core.support_staff_booking_review(p_token_hash bytea, p_request_id uuid,
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
  v_dossier jsonb;
  v_country text;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'revue de réservation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.decide'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_item.permission_code,
                                       ARRAY[v_item.country_code], NULL);
    SELECT a.country_code INTO v_country FROM core.risk_assessment AS a WHERE a.id = v_item.subject_id;
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'RISK_BOOKING' OR v_item.subject_type <> 'RISK_ASSESSMENT' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    -- évaluation d'un autre pays que l'élément (revue sécurité US-109, n° 3) ; évaluation absente :
    -- NOT_A_BOOKING ci-dessous, après la prise en charge
    WHEN v_country IS NOT NULL AND v_country <> v_item.country_code THEN 'COUNTRY'
    WHEN core.support_actor_conflict(v_s.user_id, v_item.subject_type, v_item.subject_id)
      THEN 'SELF'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.decide',
                                   'access_kind', 'READ_C2_SUPPORT',
                                   'field_or_file', 'booking_review')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'
                             WHEN v_role IS NOT NULL AND v_reason <> 'COUNTRY' THEN 'CASE_REQUIRED'
                             ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- élément RISK_BOOKING d'une évaluation qui n'est pas celle d'un hold (compte lié, US-127)
  v_dossier := core.booking_staff_review_dossier(v_item.subject_id);
  IF v_dossier IS NULL THEN
    RETURN QUERY SELECT 'NOT_A_BOOKING'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'RISK_ASSESSMENT',
                                            v_item.subject_id, 'booking_review', 'READ_C2_SUPPORT',
                                            v_purpose, 'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  RETURN QUERY SELECT 'GRANTED'::text,
    v_dossier || pg_catalog.jsonb_build_object(
      'itemId', p_item_id, 'accessId', v_access, 'itemStatus', v_item.status,
      'entryDeclaration', core.kyc_staff_entry_declaration(
                            (v_dossier ->> 'guestUserId')::uuid, v_item.country_code));
END
$fn$;
COMMENT ON FUNCTION core.support_staff_booking_review(bytea, uuid, uuid, text) IS
  'Console : dossier d''une réservation signalée (élément RISK_BOOKING d''une évaluation de hold) '
  'pris en charge par l''agent ; garde ADR-122 ; accès journalisé avant la lecture. EXECUTE '
  'app_api. US-209 (ADR-141).';
REVOKE ALL ON FUNCTION core.support_staff_booking_review(bytea, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_booking_review(bytea, uuid, uuid, text) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 10. Cadre d'US-101 : type de sujet, sujet de l'action, liaison (contrôlés par leurs
-- déclencheurs) -------------------------------------------------------------------------------
INSERT INTO core.support_manual_action_subject (subject_type, resolver, story)
VALUES ('RISK_ASSESSMENT', 'core.support_country_of_risk_assessment(uuid)'::regprocedure, 'US-209');
-- type de sujet admis par le catalogue : liste de 0061 ÉLARGIE de RISK_ASSESSMENT (toute ligne valide
-- sous la version N le reste)
ALTER TABLE core.support_manual_action_catalog DROP CONSTRAINT manual_action_catalog_subject_valid;
ALTER TABLE core.support_manual_action_catalog ADD CONSTRAINT manual_action_catalog_subject_valid
  CHECK (subject_type IN ('TRIP', 'ORGANIZATION', 'IDENTITY_VERIFICATION', 'LISTING',
                          'SUPPORT_CASE', 'PLATFORM_ADVANCE', 'INSURER_BORDEREAU', 'USER_ACCOUNT',
                          'RISK_ASSESSMENT'));
UPDATE core.support_manual_action_catalog SET subject_type = 'RISK_ASSESSMENT'
 WHERE action_code = 'REVIEW_FLAGGED_BOOKING';
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('REVIEW_FLAGGED_BOOKING',
        'core.booking_manual_action_review_flagged(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-209');
