-- 0171 — AVL / STL / MSG / PAY : no-show et refus du véhicule déclarés par l'hôte, le voyageur ou
-- l'ops, réglés par le moteur unique (cxl-beta/2) dans la transaction de la transition.
-- US-307 ; 19 US-307 (« Given T+50 min (grâce 60), When DECLARE_NO_SHOW est demandé, Then
-- NO_SHOW_TOO_EARLY » ; « Given le trip A et un no-show déclaré par l'hôte avec message tracé (T05),
-- When il est réglé, Then remboursement 138,22 et jambes de TJ04b ; sans message de l'hôte tracé
-- (T39, hôte inéligible), toute la retenue va à PLATFORM (TJ05a) et la jambe HOST capturée est
-- réaffectée (TJ05b, reallocate, capacité SUPPORTS_PAYOUT_ADJUSTMENT) » ; « Given un refus du
-- véhicule validé (REFUSE_AT_PICKUP, motif propreté ou sécurité), Then remboursement intégral
-- (motif FULL) et pénalité de l'hôte au host_ledger ; refus pour permis non conforme ⇒ T07 avec
-- preuve validée, T08 sans » ; « Given un no-show de l'hôte (30 min sans présentation), When le
-- voyageur le signale avec preuve, Then annulation HOST_NO_SHOW, remboursement intégral et pénalité
-- de l'hôte (BR-CXL-13) » ; variante PY) ; 16 TRP-015 (NO_SHOW_TOO_EARLY, NO_SHOW_WINDOW_CLOSED,
-- hostMessageTraced), TRP-007 (REFUSED_AT_PICKUP, REFUSAL_AFTER_CHECKIN), EC-01, EC-04 ; 08
-- BR-CXL-04, BR-CXL-08, BR-CXL-12, BR-CXL-13, table de décision (lignes 2, 3, 7, 8), E7 règles 3
-- et 7 ; 17 §2.5 (verrous voyageur → véhicule → trip), §2.8 (capacité inconnue = « non »),
-- §3.2.4, §3.2.12, §3.2.13 ; 22 OQ-BR-45 (retenue de l'hôte inéligible à PLATFORM, comme Turo),
-- OQ-BR-33 (60 min) ; pré-mortem du lot 3 : L3-PM-11, L3-PM-18, L3-PM-19, L3-PM-20, L3-PM-55 ;
-- ADR-148 (annulations réglées dans la transition), ADR-153 (host_ledger), ADR-183 (remise),
-- ADR-191 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-191, PROPOSÉS, comme Turo : docs/team/COMME_TURO.md) :
--   1. une déclaration est une DEMANDE `core.booking_trip_cancellation` (0124), réglée par le
--      travailleur `trip_lifecycle` existant (moteur unique, règlement, transition avec
--      settlement_id, ordres REFUND bornés, contrainte différée des remboursements, pénalité au
--      host_ledger par le déclencheur de 0129) ; aucun nouveau chemin d'argent ;
--   2. quatre auteurs, motif DEMANDÉ et initiateur DÉRIVÉS de l'auteur (jamais reçus, N-131) :
--        - l'hôte titulaire déclare le voyageur absent (`HOST_DECLARE_NO_SHOW` ⇒ GUEST_NO_SHOW) ;
--        - le voyageur signale l'hôte absent (`GUEST_REPORT_HOST_NO_SHOW` ⇒ HOST_NO_SHOW) : la
--          demande attend la validation de l'ops (AWAITING_REVIEW ; comme Turo, le support vérifie),
--          l'hôte est prévenu (`trip.no_show.reported`) ;
--        - l'ops, par la console (cadre d'US-101) : `DECLARE_NO_SHOW` (absentParty GUEST ; HOST :
--          valide le signalement en attente, sinon déclare ; NONE : rejette le signalement)
--          et `REFUSE_AT_PICKUP` (refusalReason : CLEANLINESS ou SAFETY ⇒ CLEANLINESS_SAFETY_VALID ;
--          INVALID_LICENSE, IDENTITY_NOT_VERIFIED ou OTHER_DRIVER_SENT ⇒
--          HOST_CANCELLED_DUE_TO_GUEST, requalifié HOST_CANCELLED sans preuve validée : T07 / T08) ;
--   3. délais en heure SERVEUR (`platform.now()`) depuis le début PRÉVU du trip : no-show du
--      voyageur à partir de `no_show_at` (début + no_show_grace_minutes du pays, figé, OQ-BR-33) ;
--      no-show de l'hôte à partir du début + 30 min (BR-CXL-13) ; fin de la fenêtre de déclaration
--      au début + 72 h (BR-CXL-08, POLICY du moteur) ; avant ⇒ NO_SHOW_TOO_EARLY, après ⇒
--      NO_SHOW_WINDOW_CLOSED. Ces délais (et ceux du message) sont des règles de 08, communes aux
--      deux pays, lus d'une seule source : `core.booking_no_show_policy()` ;
--   4. preuves (L3-PM-20 : « preuve = photo à l'heure serveur ou message tracé ») :
--        - `host_message_traced` (BR-CXL-08) : un message de l'hôte (titulaire ou co-hôte) dans le
--          fil du trip, envoyé dans [début − 1 h ; déclaration − 15 min] et suivi de 15 min sans
--          réponse du voyageur (08 BR-CXL-08 ; `core.booking_no_show_traced`, lu par la messagerie,
--          jamais reçu) ; faux ⇒ la déclaration est ACCEPTÉE et
--          l'hôte est inéligible (T39 : toute la retenue à PLATFORM, OQ-BR-45) ;
--        - no-show de l'hôte signalé par le voyageur : le même fait, côté voyageur (message du
--          voyageur dans la même fenêtre, 15 min sans réponse de l'hôte) ; absent ⇒
--          NO_SHOW_EVIDENCE_REQUIRED, rien n'est écrit ; par la console : une pièce jointe par
--          l'agent ou ce même message, relus au règlement (sinon la demande est garée FAILED,
--          TRIP_NO_SHOW_EVIDENCE_MISSING) ;
--        - refus pour permis : preuve validée = au moins une pièce jointe par l'agent (règle 2,
--          0124, inchangée) ;
--   5. présence : un no-show n'est pas déclarable contre une partie présente (contrôle du permis
--      écrit par l'hôte, ou validation de la remise par la partie déclarée absente ; US-315) ⇒
--      NO_SHOW_PARTY_PRESENT ; un refus du véhicule après la validation de la remise par le
--      voyageur ⇒ REFUSAL_AFTER_CHECKIN (BR-CXL-04, 16 TRP-007) ;
--   6. aucune déclaration ne se rejoue : identifiant de la demande fourni par le client (clé
--      d'idempotence) ; même identifiant, même trip, même auteur ⇒ l'issue d'origine ; un autre
--      ⇒ REQUEST_INVALID ; une demande vivante sur le trip ⇒ CANCELLATION_PENDING (index unique de
--      0124 en défense) ; verrous consultatifs du voyageur puis du véhicule (17 §2.5) ;
--   7. moteur `cxl-beta/2` (packages/money, ADR-191) : `cxl-beta/1` plus la ligne n° 8 de 08
--      (CLEANLINESS_SAFETY_VALID : FULL, gains 0, pénalité `cleanliness`, REFUSED_AT_PICKUP) ;
--      vérificateur SQL `core.settlement_verify_cxl_beta_2` (rejoue cxl-beta/1, puis la ligne
--      n° 8) ; le rejeu de 0054 choisit le vérificateur par la version stockée ;
--   8. réaffectation (TJ05b, 08 E7 règle 3) : `core.payment_assert_payout_adjustment` refuse
--      l'ordre LEG_REALLOCATION si `SUPPORTS_PAYOUT_ADJUSTMENT` n'est pas VALIDÉE pour le moyen
--      du compte PSP du trip (17 §2.8 : capacité inconnue = « non ») ; la demande est alors garée
--      FIN_REVIEW (LEG_REALLOCATION_UNSUPPORTED), rien n'est remboursé ni réaffecté ;
--   9. aucun montant saisi ni lu par une déclaration ; aucun interrupteur écrit ; aucune
--      constante de pays (hors bloc GÉNÉRÉ du paramètre, section 15) ;
--  10. signalement du voyageur jamais sans issue (revues de la PR #283) : la validation par l'ops
--      rejoue les obstacles d'état (`core.booking_no_show_report_obstacle` : remise pas ouverte,
--      transition interdite, hôte présent) et refuse net (NO_SHOW_REPORT_INVALIDATED) ; le
--      travailleur trip_lifecycle (`core.booking_worker_no_show_review_alerts`) marque UNE fois
--      (`review_alerted_at`) un signalement en attente depuis `no_show_report_review_alert_minutes`
--      du pays (STALE ; absent ou non positif : au premier passage, fail-closed) ou devenu
--      inapplicable (BLOCKED : autre demande vivante, obstacle d'état) ; STL lève l'alerte
--      TRIP_NO_SHOW_REPORT_UNRESOLVED (P2, comptes par pays et par cause, PROPOSÉ).
--
-- Codes (packages/db/src/errors.ts, sans DETAIL) :
--   leg_reallocation_unsupported (55000)    → FIN_REVIEW_REQUIRED (garé FIN_REVIEW par STL) ;
--   trip_no_show_evidence_missing (55000)   → INVARIANT_VIOLATION (garé FAILED par STL) ;
--   trip_cancellation_traced_shape (23514)  → INVARIANT_VIOLATION ;
--   trip_cancellation_action_valid, trip_cancellation_reason_valid : CHECK de 0124 recréés.
-- Issues des commandes (refus : rien n'est écrit) : DONE, NOT_FOUND, REQUEST_INVALID,
--   CHECKIN_NOT_OPEN, TRIP_TRANSITION_FORBIDDEN, NO_SHOW_TOO_EARLY, NO_SHOW_WINDOW_CLOSED,
--   NO_SHOW_PARTY_PRESENT, NO_SHOW_EVIDENCE_REQUIRED, CANCELLATION_PENDING ; console en plus :
--   SELF_FORBIDDEN, NO_SHOW_PARTY_REQUIRED, REFUSAL_REASON_REQUIRED, REFUSAL_AFTER_CHECKIN,
--   NO_REPORT_PENDING, NO_SHOW_REPORT_INVALIDATED.
--
-- Expand / contract : colonne, fonctions, droits et politiques AJOUTÉS ; deux CHECK de 0124
-- recréés sous le même nom, élargis (une demande valide de 0124 reste valide) ; corps de
-- `core.settlement_assert_balanced` (0054), `core.booking_cancellation_cost_bearer` et
-- `core.booking_cmd_trip_settle_cancellation` (0124) remplacés à signature, propriétaire et droits
-- identiques ; politique de lecture des pièces de la console élargie aux deux actions ; lignes du
-- catalogue des deux actions : clés de saisie ajoutées (actions indisponibles jusqu'ici : aucune
-- ligne `manual_action` n'en dépend) ; liaisons ajoutées.
--
-- Retour arrière :
--   DELETE des valeurs puis de la définition de no_show_report_review_alert_minutes ;
--   ALTER POLICY cmd_hold_cancel_read ON core.config_param_value (définition de 0124) ;
--   DELETE FROM core.support_manual_action_handler
--    WHERE action_code IN ('DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP') ;
--   UPDATE core.support_manual_action_catalog SET input_keys = '{}', input_values = '{}'
--    WHERE action_code IN ('DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP') ;
--   réappliquer core.settlement_assert_balanced (0054), core.booking_cancellation_cost_bearer et
--     core.booking_cmd_trip_settle_cancellation (0124) ;
--   DROP FUNCTION core.trip_no_show_view(bytea, uuid), core.trip_cmd_report_no_show(bytea, uuid,
--     uuid), core.trip_no_show_state(uuid, text), core.booking_manual_action_no_show(bytea, uuid,
--     text, uuid, jsonb, text, uuid, text), core.booking_trip_cancellation_flags(uuid),
--     core.payment_assert_payout_adjustment(uuid, text), core.messaging_wait_traced(uuid, text,
--     timestamptz, timestamptz, interval), core.settlement_verify_cxl_beta_2(jsonb),
--     core.booking_no_show_traced(uuid, text, timestamptz), core.booking_no_show_policy(),
--     core.booking_worker_no_show_review_alerts(integer),
--     core.booking_no_show_report_obstacle(uuid), core.booking_no_show_party_present(uuid, text) ;
--   DROP INDEX core.trip_cancellation_review_unique ; DROP POLICY cmd_hold_cancel_review_upd,
--     cmd_hold_cancel_alert_upd ON core.booking_trip_cancellation ;
--   ALTER POLICY cmd_hold_trip_notice_ins (définition de 0132) ;
--   ALTER POLICY cmd_hold_cancel_read ON core.support_manual_action USING (action_code IN
--     ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM')) ;
--   DROP POLICY cmd_hold_cancel_party_ins ON core.booking_trip_cancellation ;
--   recréer les CHECK de 0124 ; ALTER TABLE core.booking_trip_cancellation
--     DROP COLUMN host_message_traced, DROP COLUMN review_alerted_at ; révoquer les droits
--     accordés ci-dessous.

-- 1. STL : vérificateur du moteur cxl-beta/2 (fonction pure, SECURITY INVOKER, migrator) ---------
-- cxl-beta/2 = cxl-beta/1 + ligne n° 8 de 08 (CLEANLINESS_SAFETY_VALID). Pour les onze motifs de
-- cxl-beta/1, le rejeu EST celui de cxl-beta/1 (seule la version écrite change). Pour la ligne
-- n° 8 : la ligne n° 6 (HOST_CANCELLED) a la même qualification (FULL), la même compensation
-- (aucune), la même éligibilité (aucune) et donc les mêmes montants et jambes ; seuls changent le
-- motif, l'état cible (REFUSED_AT_PICKUP) et la pénalité (barème `cleanliness`, BR-CSP-03, au lieu
-- de cxlEarly / cxlLate). Le vérificateur rejoue donc cxl-beta/1 sur la ligne n° 6, pénalité
-- exemptée, puis pose ces trois champs. Rend les sorties comparables à la version stockée.
CREATE FUNCTION core.settlement_verify_cxl_beta_2(p_inputs jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  e       jsonb;
  p       jsonb;
  v_cur   text;
  v_in    jsonb;
  v_out   jsonb;
  v_pen   numeric := 0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_inputs) IS DISTINCT FROM 'object'
     OR (p_inputs ->> 'engineVersion') IS DISTINCT FROM 'cxl-beta/2' THEN
    RAISE EXCEPTION 'settlement replay: engine version not verifiable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_unsupported';
  END IF;
  e := p_inputs -> 'event';
  p := p_inputs -> 'params';
  v_in := pg_catalog.jsonb_set(p_inputs, '{engineVersion}', '"cxl-beta/1"'::jsonb);
  IF pg_catalog.jsonb_typeof(e) IS DISTINCT FROM 'object'
     OR (e ->> 'reason') IS DISTINCT FROM 'CLEANLINESS_SAFETY_VALID' THEN
    -- onze motifs de cxl-beta/1 : rejeu identique (motif inconnu : refusé par cxl-beta/1)
    v_out := core.settlement_verify_cxl_beta_1(v_in);
    RETURN v_out || pg_catalog.jsonb_build_object('engineVersion', 'cxl-beta/2');
  END IF;
  -- ligne n° 8 : montants de la ligne n° 6 (FULL, gains 0), pénalité exemptée dans le rejeu
  v_in := pg_catalog.jsonb_set(v_in, '{event}',
            e || pg_catalog.jsonb_build_object('reason', 'HOST_CANCELLED',
                                               'hostPenaltyWaived', true));
  v_out := core.settlement_verify_cxl_beta_1(v_in);
  IF (v_out ->> 'reason') IS DISTINCT FROM 'HOST_CANCELLED'
     OR (v_out ->> 'qualification') IS DISTINCT FROM 'FULL'
     OR (v_out ->> 'origin') IS DISTINCT FROM 'EVENT' THEN
    RAISE EXCEPTION 'settlement replay: cleanliness refusal not settled in full'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  -- pénalité de propreté / sécurité (BR-CSP-03) : barème par devise, absent quand il est dû ⇒ refus
  IF NOT COALESCE((e -> 'hostPenaltyWaived') = 'true'::jsonb, false) THEN
    v_cur := p_inputs -> 'trip' -> 'currency' ->> 'code';
    IF pg_catalog.jsonb_typeof(p -> 'hostPenalty') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'settlement replay: host penalty schedule missing'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
    END IF;
    v_pen := core.settlement_verify_minor(p -> 'hostPenalty' -> 'cleanliness', v_cur);
  END IF;
  RETURN v_out || pg_catalog.jsonb_build_object(
    'engineVersion', 'cxl-beta/2',
    'requestedReason', 'CLEANLINESS_SAFETY_VALID',
    'reason', 'CLEANLINESS_SAFETY_VALID',
    'targetState', 'REFUSED_AT_PICKUP',
    'hostPenaltyMinor', v_pen::bigint::text);
END
$fn$;
COMMENT ON FUNCTION core.settlement_verify_cxl_beta_2(jsonb) IS
  'Vérificateur indépendant du moteur cxl-beta/2 (08 BR-CXL, ligne n° 8 BR-CXL-04 / BR-CSP-03) : '
  'cxl-beta/1 pour ses onze motifs, puis le refus du véhicule validé ; ne produit aucun montant '
  'stocké. US-307 (ADR-191).';
REVOKE ALL ON FUNCTION core.settlement_verify_cxl_beta_2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_verify_cxl_beta_2(jsonb) TO cmd_money_owner, app_worker;

-- 2. STL : rejeu des entrées par la version stockée (corps de 0054 §4.1 recopié ; seul le bloc
--    marqué US-307 change : cxl-beta/1 et cxl-beta/2 ont chacun leur vérificateur) ---------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE OR REPLACE FUNCTION core.settlement_assert_balanced()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s            record;
  v_trip_org   uuid;
  v_trip_cur   text;
  v_legs       integer;
  v_signed     bigint;
  v_variation  bigint;
  v_advance    bigint;
  v_basis      bigint;
  v_host       bigint;
  v_tax3       bigint;
  v_line_amt   bigint;
  v_line_ref   bigint;
  v_line_ret   bigint;
  v_tax_paid   bigint;
  v_tax_ref    bigint;
  v_tax_ret    bigint;
  v_tax3_ret   bigint;
  v_mismatch   integer;
  v_captured   integer;
  v_prev_ref   bigint;
  v_expected   jsonb;
  v_actual     jsonb;
  v_lines_j    jsonb;
  v_taxes_j    jsonb;
  v_settled_j  jsonb;
  v_basis_j    jsonb;
BEGIN
  SELECT * INTO s FROM core.settlement_settlement AS x WHERE x.id = NEW.id;

  SELECT t.org_id, t.currency INTO v_trip_org, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = s.trip_id;
  IF v_trip_org IS DISTINCT FROM s.org_id OR v_trip_cur IS DISTINCT FROM s.currency THEN
    RAISE EXCEPTION 'settlement %: compte d''hôte ou devise différents du trip', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_mismatch';
  END IF;

  -- remboursement de la version remplacée : Σ variations = − (remboursement v n+1 − remboursement v n)
  v_prev_ref := 0;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT p.guest_refund_minor INTO v_prev_ref
      FROM core.settlement_settlement AS p WHERE p.id = s.supersedes_id;
  END IF;

  SELECT count(*)::integer, COALESCE(sum(l.kept_minor - l.advance_minor), 0),
         COALESCE(sum(l.variation_minor), 0), COALESCE(sum(l.advance_minor), 0),
         COALESCE(sum(l.basis_minor), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'HOST'), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'TAX_THIRD_PARTY'), 0)
    INTO v_legs, v_signed, v_variation, v_advance, v_basis, v_host, v_tax3
    FROM core.settlement_settlement_leg AS l WHERE l.settlement_id = s.id;

  SELECT COALESCE(sum(x.amount_minor), 0), COALESCE(sum(x.refund_minor), 0),
         COALESCE(sum(x.retained_minor), 0)
    INTO v_line_amt, v_line_ref, v_line_ret
    FROM core.settlement_settlement_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(sum(x.tax_paid_minor), 0), COALESCE(sum(x.tax_refund_minor), 0),
         COALESCE(sum(x.retained_tax_minor), 0),
         COALESCE(sum(x.retained_tax_minor) FILTER (WHERE x.third_party), 0)
    INTO v_tax_paid, v_tax_ref, v_tax_ret, v_tax3_ret
    FROM core.settlement_settlement_tax_line AS x WHERE x.settlement_id = s.id;

  IF v_legs <> 4
     OR v_signed <> s.retained_minor + s.retained_tax_minor          -- Σ jambes = retenu TTC
     OR v_variation <> v_prev_ref - s.guest_refund_minor              -- Σ variations = − Δ remboursement
     OR v_host <> s.host_from_guest_minor                             -- HOST = hostFromGuest (E7)
     OR v_tax3 <> v_tax3_ret                                          -- TAX_THIRD_PARTY = taxe tiers retenue
     OR v_line_amt + v_tax_paid <> s.total_paid_minor                 -- lignes + taxes = total payé
     OR v_line_ref + v_tax_ref <> s.guest_refund_minor
     OR v_line_ret <> s.retained_minor
     OR v_tax_ref <> s.tax_refund_minor
     OR v_tax_ret <> s.retained_tax_minor THEN
    RAISE EXCEPTION 'settlement %: invariants de montant ou de jambe violés', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_unbalanced';
  END IF;

  IF s.negative_leg IS DISTINCT FROM (v_advance > 0) THEN
    RAISE EXCEPTION 'settlement %: drapeau negative_leg incohérent avec les avances', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_negative_leg_flag';
  END IF;

  -- Base de la variation : version n (supersession) ou état capturé (v1).
  SELECT count(*)::integer INTO v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = s.trip_id AND b.segment_no = s.segment_no;
  IF s.supersedes_id IS NOT NULL AND v_captured = 0 THEN
    -- une requalification suppose des fonds capturés tenus par jambe (ADR-057)
    RAISE EXCEPTION 'settlement %: version n+1 sans état capturé tenu (trip_leg_balance)', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_capture_missing';
  END IF;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_mismatch
      FROM core.settlement_settlement_leg AS cur
      LEFT JOIN core.settlement_settlement_leg AS prev
        ON prev.settlement_id = s.supersedes_id AND prev.leg = cur.leg
     WHERE cur.settlement_id = s.id
       AND (prev.leg IS NULL OR cur.basis_minor <> prev.kept_minor - prev.advance_minor);
  ELSE
    IF v_captured > 0 THEN
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
        LEFT JOIN core.settlement_trip_leg_balance AS b
          ON b.trip_id = s.trip_id AND b.segment_no = s.segment_no AND b.leg = cur.leg
       WHERE cur.settlement_id = s.id
         AND (b.leg IS NULL OR cur.basis_minor <> b.captured_minor);
    ELSE
      -- état capturé non tenu : jambes ≥ 0 (E7 règle 5) et Σ = total payé ; l'égalité jambe par
      -- jambe à l'état capturé RECALCULÉ est contrôlée par le rejeu ci-dessous (US-049, RC-1)
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
       WHERE cur.settlement_id = s.id AND cur.basis_minor < 0;
      IF v_basis <> s.total_paid_minor THEN
        v_mismatch := v_mismatch + 1;
      END IF;
    END IF;
  END IF;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'settlement %: base des variations différente de la version n ou de la capture', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_basis_mismatch';
  END IF;

  -- US-049 (RC-1) : la version n+1 porte sur le même devis figé que la version n (08 E1, BR-CXL-03)
  IF s.supersedes_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS p
                      WHERE p.id = s.supersedes_id AND p.engine_version = s.engine_version
                        AND (p.inputs::jsonb -> 'trip') = (s.inputs::jsonb -> 'trip')) THEN
    RAISE EXCEPTION 'settlement %: trip ou version du moteur différents de la version n', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_inputs_changed';
  END IF;

  -- US-049 (RC-1) : rejeu indépendant des entrées ; tout champ différent ⇒ refus (08 E4)
  -- US-307 (ADR-191) : un vérificateur par version du moteur (cxl-beta/1 de 0054, cxl-beta/2)
  IF s.kind IS DISTINCT FROM 'CANCELLATION' OR s.engine_version IS NULL
     OR s.engine_version NOT IN ('cxl-beta/1', 'cxl-beta/2') THEN
    RAISE EXCEPTION 'settlement %: nature ou version du moteur sans vérificateur', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_unsupported';
  END IF;
  IF s.engine_version = 'cxl-beta/1' THEN
    v_expected := core.settlement_verify_cxl_beta_1(s.inputs::jsonb);
  ELSE
    v_expected := core.settlement_verify_cxl_beta_2(s.inputs::jsonb);
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.line_type, pg_catalog.jsonb_build_array(
           x.amount_minor::text, x.refund_minor::text, x.retained_minor::text)), '{}'::jsonb)
    INTO v_lines_j
    FROM core.settlement_settlement_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.tax_group, pg_catalog.jsonb_build_array(
           x.third_party::text, x.tax_paid_minor::text, x.tax_refund_minor::text,
           x.retained_tax_minor::text)), '{}'::jsonb)
    INTO v_taxes_j
    FROM core.settlement_settlement_tax_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(l.leg, (l.kept_minor - l.advance_minor)::text), '{}'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(l.leg, l.basis_minor::text), '{}'::jsonb)
    INTO v_settled_j, v_basis_j
    FROM core.settlement_settlement_leg AS l WHERE l.settlement_id = s.id;

  v_actual := pg_catalog.jsonb_build_object(
    'kind', s.kind,
    'engineVersion', s.engine_version,
    'currency', s.currency,
    'requestedReason', s.requested_reason,
    'reason', s.reason,
    'origin', s.origin,
    'qualification', s.qualification,
    'targetState', s.target_state,
    'hostEligible', s.host_eligible,
    'negativeLeg', s.negative_leg,
    'totalPaidMinor', s.total_paid_minor::text,
    'guestRefundMinor', s.guest_refund_minor::text,
    'taxRefundMinor', s.tax_refund_minor::text,
    'retainedMinor', s.retained_minor::text,
    'retainedTaxMinor', s.retained_tax_minor::text,
    'hostFromGuestMinor', s.host_from_guest_minor::text,
    'hostCompensationMinor', s.host_compensation_minor::text,
    'hostEarningsMinor', s.host_earnings_minor::text,
    'platformNetMinor', s.platform_net_minor::text,
    'hostPenaltyMinor', s.host_penalty_minor::text,
    'lines', v_lines_j,
    'taxGroups', v_taxes_j,
    'settled', v_settled_j);
  IF s.supersedes_id IS NULL THEN
    -- v1 : base des variations = état capturé recalculé depuis les entrées
    v_actual := v_actual || pg_catalog.jsonb_build_object('capture', v_basis_j);
  ELSE
    v_expected := v_expected - 'capture';
  END IF;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'settlement %: montants différents du rejeu des entrées', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_mismatch';
  END IF;
  RETURN NULL;
END
$fn$;


RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 3. PAY : capacité de réaffectation exigée (TJ05b, 08 E7 règle 3 ; 17 §2.8 : inconnue = « non ») --
-- Lecture fail-closed de 0040 (`core.payment_capability_bool` : version en vigueur, VALIDATED_*
-- seulement). Appelée par le travailleur avant tout ordre LEG_REALLOCATION d'un règlement
-- d'annulation (STL, `TripCancellationProcessor`) ; refus ⇒ la transaction est annulée et la demande
-- garée FIN_REVIEW (LEG_REALLOCATION_UNSUPPORTED) : rien n'est remboursé ni réaffecté.
GRANT EXECUTE ON FUNCTION core.payment_capability_bool(text, text, text, text), core.payment_capability_value(text, text, text, text) TO cmd_money_owner;
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE FUNCTION core.payment_assert_payout_adjustment(p_account_id uuid, p_method text)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  a record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' THEN
    RAISE EXCEPTION 'payment: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payment_command_forbidden';
  END IF;
  SELECT x.provider, x.country_code INTO a FROM core.payment_psp_account AS x WHERE x.id = p_account_id;
  IF a.provider IS NULL
     OR NOT core.payment_capability_bool(a.provider, a.country_code, p_method,
                                         'SUPPORTS_PAYOUT_ADJUSTMENT') THEN
    RAISE EXCEPTION 'payment: payout adjustment not validated for this account'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_reallocation_unsupported';
  END IF;
END
$fn$;
COMMENT ON FUNCTION core.payment_assert_payout_adjustment(uuid, text) IS
  'Garde : SUPPORTS_PAYOUT_ADJUSTMENT validée pour le compte PSP et le moyen (17 §2.8, inconnue = '
  'non), exigée avant une réaffectation de jambes (08 E7 règle 3, TJ05b). EXECUTE app_worker. '
  'US-307 (ADR-191).';
REVOKE ALL ON FUNCTION core.payment_assert_payout_adjustment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_assert_payout_adjustment(uuid, text) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 4. MSG : attente tracée dans le fil du trip (preuve hostMessageTraced de 08 BR-CXL-08) ----------
-- Vrai si un message de `p_side` (HOST : titulaire ou co-hôte ; GUEST : le voyageur) a été envoyé
-- dans le fil du trip à partir de `p_from`, puis suivi de `p_wait` sans message de l'autre partie,
-- cette attente étant écoulée à `p_at` (`p_from <= sent_at <= p_at − p_wait`). Heure serveur des
-- messages (`sent_at`) ; un message masqué ou purgé reste une trace (la ligne n'est jamais
-- supprimée, 0161). Bornes et attente : `core.booking_no_show_policy()` (section 7 bis), jamais en
-- dur ici. Aucun texte lu.
GRANT CREATE ON SCHEMA core TO messaging_cmd_owner;
SET LOCAL ROLE messaging_cmd_owner;

CREATE FUNCTION core.messaging_wait_traced(p_trip_id uuid, p_side text, p_from timestamptz,
                                           p_at timestamptz, p_wait interval)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(p_side IN ('HOST', 'GUEST') AND p_from IS NOT NULL AND p_at IS NOT NULL
                  AND p_wait IS NOT NULL AND p_wait > interval '0', false)
     AND EXISTS (
           SELECT 1
             FROM core.messaging_message_thread AS th
             JOIN core.messaging_message AS m ON m.thread_id = th.id
            WHERE th.trip_id = p_trip_id
              AND (CASE WHEN p_side = 'HOST' THEN m.author_role IN ('HOST', 'CO_HOST')
                        ELSE m.author_role = 'GUEST' END)
              AND m.sent_at >= p_from
              AND m.sent_at + p_wait <= p_at
              AND NOT EXISTS (
                    SELECT 1 FROM core.messaging_message AS r
                     WHERE r.thread_id = th.id
                       AND (CASE WHEN p_side = 'HOST' THEN r.author_role = 'GUEST'
                                 ELSE r.author_role IN ('HOST', 'CO_HOST') END)
                       AND r.sent_at > m.sent_at
                       AND r.sent_at <= m.sent_at + p_wait))
$fn$;
COMMENT ON FUNCTION core.messaging_wait_traced(uuid, text, timestamptz, timestamptz, interval) IS
  'Preuve hostMessageTraced (08 BR-CXL-08) : message d''une partie dans le fil du trip suivi d''une '
  'attente sans réponse de l''autre, à l''heure serveur ; aucun texte lu. EXECUTE cmd_hold_owner. '
  'US-307 (ADR-191).';
REVOKE ALL ON FUNCTION core.messaging_wait_traced(uuid, text, timestamptz, timestamptz, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.messaging_wait_traced(uuid, text, timestamptz, timestamptz, interval)
  TO cmd_hold_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM messaging_cmd_owner;

-- 5. AVL : demande d'annulation étendue aux déclarations (17 §3.2.4 ; 0124) ---------------------
-- hostMessageTraced figé à la déclaration (no-show du voyageur seulement) : l'entrée du moteur
ALTER TABLE core.booking_trip_cancellation ADD COLUMN host_message_traced boolean;
-- signalement du no-show de l'hôte par le voyageur : en attente de la validation de l'ops
-- (AWAITING_REVIEW, comme Turo : le voyageur signale, le support vérifie ; revue sécurité n° 1 de la
-- PR #283) ; validé ⇒ PENDING (réglé par le travailleur), rejeté ⇒ FAILED
-- (HOST_NO_SHOW_REPORT_REJECTED). Un seul signalement en attente par trip ; une demande en attente
-- n'est pas « vivante » au sens de 0124 (aucun écrivain existant n'en tient compte : 0140, 0148).
ALTER TABLE core.booking_trip_cancellation
  DROP CONSTRAINT trip_cancellation_status_valid,
  ADD CONSTRAINT trip_cancellation_status_valid CHECK (
    status IN ('AWAITING_REVIEW', 'PENDING', 'SETTLED', 'FIN_REVIEW', 'FAILED')),
  DROP CONSTRAINT trip_cancellation_status_shape,
  ADD CONSTRAINT trip_cancellation_status_shape CHECK (
    ((status = 'SETTLED') = (settlement_id IS NOT NULL))
    AND ((status = 'SETTLED') = (cost_bearer IS NOT NULL))
    AND ((status IN ('FIN_REVIEW', 'FAILED')) = (outcome_code IS NOT NULL))
    AND ((status IN ('AWAITING_REVIEW', 'PENDING')) = (decided_at IS NULL))),
  ADD CONSTRAINT trip_cancellation_review_shape CHECK (
    status <> 'AWAITING_REVIEW' OR action_code = 'GUEST_REPORT_HOST_NO_SHOW');
CREATE UNIQUE INDEX trip_cancellation_review_unique ON core.booking_trip_cancellation (trip_id)
  WHERE status = 'AWAITING_REVIEW';
COMMENT ON COLUMN core.booking_trip_cancellation.host_message_traced IS
  'No-show du voyageur : message de l''hôte et 15 min sans réponse tracés dans le fil du trip à '
  'l''heure de la déclaration (08 BR-CXL-08, hostMessageTraced), lu par la base, jamais reçu ; '
  'NULL pour tout autre motif. US-307 (ADR-191).';
ALTER TABLE core.booking_trip_cancellation
  DROP CONSTRAINT trip_cancellation_action_valid,
  ADD CONSTRAINT trip_cancellation_action_valid CHECK (
    action_code IN ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM',
                    'DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP', 'HOST_DECLARE_NO_SHOW',
                    'GUEST_REPORT_HOST_NO_SHOW')),
  DROP CONSTRAINT trip_cancellation_reason_valid,
  -- action ⇒ initiateur et motifs admis (0124, puis US-307 : no-show et refus du véhicule)
  ADD CONSTRAINT trip_cancellation_reason_valid CHECK (
       (action_code = 'CANCEL_TRIP_GUEST' AND initiator = 'GUEST'
        AND requested_reason = 'GUEST_CANCELLED' AND sub_reason IS NULL)
    OR (action_code = 'CANCEL_TRIP_HOST' AND initiator = 'HOST'
        AND ((requested_reason = 'HOST_CANCELLED' AND sub_reason IS NULL)
          OR (requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
              AND sub_reason IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT',
                                 'LICENSE_NOT_UPLOADED_1H'))))
    OR (action_code = 'CANCEL_TRIP_PLATFORM' AND initiator = 'PLATFORM' AND sub_reason IS NULL
        AND requested_reason IN ('PLATFORM_TRUST_SAFETY', 'PLATFORM_INCOMPLETE_STEPS',
                                 'GUEST_FRAUD_PROVEN', 'HOST_ACCOUNT_CLOSED',
                                 'PLATFORM_REVIEW_DELAY', 'PSP_FAILURE'))
    OR (action_code = 'DECLARE_NO_SHOW' AND initiator = 'PLATFORM' AND sub_reason IS NULL
        AND requested_reason IN ('GUEST_NO_SHOW', 'HOST_NO_SHOW'))
    OR (action_code = 'REFUSE_AT_PICKUP'
        AND ((initiator = 'GUEST' AND requested_reason = 'CLEANLINESS_SAFETY_VALID'
              AND sub_reason IN ('CLEANLINESS', 'SAFETY'))
          OR (initiator = 'HOST' AND requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
              AND sub_reason IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT'))))
    OR (action_code = 'HOST_DECLARE_NO_SHOW' AND initiator = 'HOST'
        AND requested_reason = 'GUEST_NO_SHOW' AND sub_reason IS NULL)
    OR (action_code = 'GUEST_REPORT_HOST_NO_SHOW' AND initiator = 'GUEST'
        AND requested_reason = 'HOST_NO_SHOW' AND sub_reason IS NULL)),
  ADD CONSTRAINT trip_cancellation_traced_shape CHECK (
    (requested_reason = 'GUEST_NO_SHOW') = (host_message_traced IS NOT NULL));

GRANT INSERT (host_message_traced, status) ON core.booking_trip_cancellation TO cmd_hold_owner;
-- alerte d'un signalement resté sans issue, posée UNE fois par le travailleur (section 12 bis)
ALTER TABLE core.booking_trip_cancellation ADD COLUMN review_alerted_at timestamptz;
ALTER TABLE core.booking_trip_cancellation
  ADD CONSTRAINT trip_cancellation_review_alert_shape CHECK (
    review_alerted_at IS NULL OR action_code = 'GUEST_REPORT_HOST_NO_SHOW');
GRANT UPDATE (review_alerted_at) ON core.booking_trip_cancellation TO cmd_hold_owner;
CREATE POLICY cmd_hold_cancel_alert_upd ON core.booking_trip_cancellation FOR UPDATE
  TO cmd_hold_owner
  USING (status = 'AWAITING_REVIEW' AND review_alerted_at IS NULL
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (status = 'AWAITING_REVIEW' AND review_alerted_at IS NOT NULL
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');
-- délai de l'alerte, lu par le travailleur (0124 élargie d'une clé)
ALTER POLICY cmd_hold_cancel_read ON core.config_param_value
  USING (key IN ('free_cancel_lead', 'last_minute_threshold', 'host_penalty',
                 'platform_funded_host_compensation', 'no_show_report_review_alert_minutes'));
-- déclaration d'une partie du trip (contexte posé par la commande APRÈS la vérification de la
-- session, comme la remise de 0163) : l'hôte déclare le voyageur absent, le voyageur l'hôte
CREATE POLICY cmd_hold_cancel_party_ins ON core.booking_trip_cancellation FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (requested_by = app.actor_id()
              AND ((app.actor_kind() = 'HOST' AND action_code = 'HOST_DECLARE_NO_SHOW'
                    AND status = 'PENDING')
                   OR (app.actor_kind() = 'GUEST'
                       AND action_code = 'GUEST_REPORT_HOST_NO_SHOW'
                       AND status = 'AWAITING_REVIEW')));
-- la console (contexte STAFF de la commande liée) valide ou rejette un signalement en attente ; le
-- règlement reste au seul travailleur trip_lifecycle (cmd_hold_cancel_upd de 0124)
CREATE POLICY cmd_hold_cancel_review_upd ON core.booking_trip_cancellation FOR UPDATE
  TO cmd_hold_owner
  USING (status = 'AWAITING_REVIEW' AND action_code = 'GUEST_REPORT_HOST_NO_SHOW'
         AND app.actor_kind() = 'STAFF')
  WITH CHECK (status IN ('PENDING', 'FAILED') AND action_code = 'GUEST_REPORT_HOST_NO_SHOW'
              AND app.actor_kind() = 'STAFF');
-- l'hôte est prévenu d'un signalement (NTF : trip.no_show.reported ; 0132 élargie)
ALTER POLICY cmd_hold_trip_notice_ins ON core.outbox_outbox_event
  WITH CHECK (type IN ('booking.trip.host_restricted', 'booking.trip.host_restriction_lifted',
                       'trip.no_show.reported')
              AND aggregate_type = 'trip' AND actor_user_id IS NOT NULL);
-- pièces de l'action de console qui a créé la demande (preuve validée, N-131) : + deux actions
ALTER POLICY cmd_hold_cancel_read ON core.support_manual_action
  USING (action_code IN ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM',
                         'DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP'));

-- 6. Catalogue : saisies fermées des deux actions (jamais un montant) --------------------------
-- DECLARE_NO_SHOW : partie absente (GUEST ⇒ GUEST_NO_SHOW ; HOST ⇒ valide le signalement du voyageur
-- en attente, sinon HOST_NO_SHOW ; NONE ⇒ rejette le signalement en attente), obligatoire.
UPDATE core.support_manual_action_catalog
   SET input_keys = '{absentParty}',
       input_values = '{"absentParty": ["GUEST", "HOST", "NONE"]}'::jsonb
 WHERE action_code = 'DECLARE_NO_SHOW';
-- REFUSE_AT_PICKUP : motif du refus, obligatoire (propreté ou sécurité : refus du voyageur, BR-CXL-04 ;
-- permis non conforme : refus de l'hôte « à cause du voyageur », BR-CXL-12).
UPDATE core.support_manual_action_catalog
   SET input_keys = '{refusalReason}',
       input_values = '{"refusalReason": ["CLEANLINESS", "SAFETY", "INVALID_LICENSE", "IDENTITY_NOT_VERIFIED", "OTHER_DRIVER_SENT"]}'::jsonb
 WHERE action_code = 'REFUSE_AT_PICKUP';

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 7. Porteur du coût selon le motif QUALIFIÉ (0124, + ligne n° 8 : l'hôte) ----------------------
CREATE OR REPLACE FUNCTION core.booking_cancellation_cost_bearer(p_reason text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_reason IN ('GUEST_CANCELLED', 'GUEST_NO_SHOW', 'HOST_CANCELLED_DUE_TO_GUEST',
                             'GUEST_FRAUD_PROVEN', 'PLATFORM_INCOMPLETE_STEPS') THEN 'GUEST'
           WHEN p_reason IN ('HOST_CANCELLED', 'HOST_NO_SHOW', 'HOST_ACCOUNT_CLOSED',
                             'CLEANLINESS_SAFETY_VALID') THEN 'HOST'
           WHEN p_reason IN ('PLATFORM_TRUST_SAFETY', 'PLATFORM_REVIEW_DELAY', 'PSP_FAILURE')
             THEN 'PLATFORM'
         END
$fn$;

-- 7 bis. Politique du no-show : UNE seule source des délais (08, communs aux deux pays ; revues
-- architecture n° 3, argent n° 1) ; le test de concordance les compare aux textes de 08 et à la
-- POLICY du moteur (72 h). SECURITY INVOKER, EXECUTE app_worker (lecture pure, aucune donnée).
--   host_absent_after : hôte absent 30 min après le début (BR-CXL-13) ;
--   reply_wait        : 15 min sans réponse après le message (BR-CXL-08) ;
--   message_lead      : le message compte à partir du début − 1 h (BR-CXL-08 `hostEligible`,
--                       « trip.start − 1 h {param} » ; défaut de 08) ;
--   declaration_window: déclaration close au début + 72 h (BR-CXL-08, POLICY du moteur).
CREATE FUNCTION core.booking_no_show_policy()
  RETURNS TABLE (host_absent_after interval, reply_wait interval, message_lead interval,
                 declaration_window interval)
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT interval '30 minutes', interval '15 minutes', interval '1 hour', interval '72 hours'
$fn$;
COMMENT ON FUNCTION core.booking_no_show_policy() IS
  'Délais du no-show (08 BR-CXL-08, BR-CXL-13), une seule source : hôte absent après 30 min, '
  'attente de 15 min, message au plus tôt 1 h avant le début, fenêtre de 72 h. US-307 (ADR-191).';

-- Preuve tracée d'une partie pour une déclaration à `p_at` : message de `p_side` envoyé dans
-- [début − message_lead ; p_at − reply_wait], sans réponse de l'autre pendant reply_wait (08
-- BR-CXL-08). Seule définition de la fenêtre, lue par l'état, la commande et le règlement.
CREATE FUNCTION core.booking_no_show_traced(p_trip_id uuid, p_side text, p_at timestamptz)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE((SELECT core.messaging_wait_traced(t.id, p_side,
                                                     t.scheduled_start - pol.message_lead, p_at,
                                                     pol.reply_wait)
                     FROM core.booking_trip AS t CROSS JOIN core.booking_no_show_policy() AS pol
                    WHERE t.id = p_trip_id), false)
$fn$;
COMMENT ON FUNCTION core.booking_no_show_traced(uuid, text, timestamptz) IS
  'Interne : message d''une partie et attente tracés dans la fenêtre de 08 BR-CXL-08 '
  '(début − 1 h ; déclaration − 15 min). US-307 (ADR-191).';

-- Partie déclarée absente présente : contrôle du permis écrit par l'hôte (les deux parties étaient
-- là), ou validation de la remise par la partie déclarée absente (US-315). Seule définition.
CREATE FUNCTION core.booking_no_show_party_present(p_trip_id uuid, p_side text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM core.trip_ops_identity_check AS ic WHERE ic.trip_id = p_trip_id)
      OR EXISTS (SELECT 1 FROM core.trip_ops_handover_validation AS hv
                  WHERE hv.trip_id = p_trip_id AND hv.kind = 'CHECKIN'
                    AND hv.performer_role = p_side)
$fn$;
COMMENT ON FUNCTION core.booking_no_show_party_present(uuid, text) IS
  'Interne : la partie déclarée absente était présente (contrôle du permis, validation de la '
  'remise). US-307 (ADR-191).';

-- Obstacle d'état d'un signalement du no-show de l'hôte (hors preuve et fenêtre, déjà jugées au
-- signalement) : remise pas ouverte, transition vers NO_SHOW_HOST interdite, hôte présent. Lu par
-- la validation de l'ops (refus net) et par l'alerte du travailleur (BLOCKED). NULL : applicable.
CREATE FUNCTION core.booking_no_show_report_obstacle(p_trip_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN t.status IS NULL THEN 'NOT_FOUND'
           WHEN t.status = 'BOOKED' THEN 'CHECKIN_NOT_OPEN'
           WHEN NOT EXISTS (SELECT 1 FROM core.booking_trip_transition AS tt
                             WHERE tt.from_status = t.status AND tt.to_status = 'NO_SHOW_HOST'
                               AND tt.via = 'CANCEL') THEN 'TRIP_TRANSITION_FORBIDDEN'
           WHEN core.booking_no_show_party_present(p_trip_id, 'HOST') THEN 'NO_SHOW_PARTY_PRESENT'
         END
    FROM (SELECT (SELECT tr.status FROM core.booking_trip AS tr WHERE tr.id = p_trip_id) AS status)
         AS t
$fn$;
COMMENT ON FUNCTION core.booking_no_show_report_obstacle(uuid) IS
  'Interne : obstacle d''état d''un signalement du no-show de l''hôte (remise, transition, '
  'présence), NULL s''il reste applicable. US-307 (ADR-191).';

-- 8. État d'une déclaration de no-show pour une partie (SECURITY INVOKER, interne) --------------
-- p_side = partie DÉCLARÉE ABSENTE (GUEST : l'hôte déclare ; HOST : le voyageur signale) ; à
-- platform.now(). Rend le premier obstacle (NULL = déclarable), la preuve tracée, la fenêtre.
CREATE FUNCTION core.trip_no_show_state(p_trip_id uuid, p_side text)
  RETURNS TABLE (blocker text, message_traced boolean, declarable_from timestamptz,
                 declarable_until timestamptz)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  v_now    timestamptz := platform.now();
  v_from   timestamptz;
  v_until  timestamptz;
  v_traced boolean;
  v_target text;
  pol      record;
BEGIN
  SELECT * INTO pol FROM core.booking_no_show_policy();
  SELECT tr.status, tr.scheduled_start, tr.no_show_at, tr.checkin_validated_at INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.status IS NULL OR p_side IS NULL OR p_side NOT IN ('GUEST', 'HOST') THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- délais depuis le début PRÉVU : grâce du pays figée (no_show_at) ; 30 min pour l'hôte
  -- (BR-CXL-13) ; fenêtre de déclaration fermée à début + 72 h (BR-CXL-08)
  v_from := CASE WHEN p_side = 'GUEST' THEN t.no_show_at
                 ELSE t.scheduled_start + pol.host_absent_after END;
  v_until := t.scheduled_start + pol.declaration_window;
  v_target := CASE WHEN p_side = 'GUEST' THEN 'NO_SHOW_GUEST' ELSE 'NO_SHOW_HOST' END;
  -- preuve : message de la partie PRÉSENTE (celle qui déclare), fenêtre de 08 BR-CXL-08
  v_traced := core.booking_no_show_traced(p_trip_id,
                                          CASE WHEN p_side = 'GUEST' THEN 'HOST' ELSE 'GUEST' END,
                                          v_now);
  RETURN QUERY SELECT
    CASE
      WHEN t.status = 'BOOKED' THEN 'CHECKIN_NOT_OPEN'
      WHEN NOT EXISTS (SELECT 1 FROM core.booking_trip_transition AS tt
                        WHERE tt.from_status = t.status AND tt.to_status = v_target
                          AND tt.via = 'CANCEL') THEN 'TRIP_TRANSITION_FORBIDDEN'
      WHEN v_from IS NULL THEN 'TRIP_TRANSITION_FORBIDDEN'
      WHEN v_now < v_from THEN 'NO_SHOW_TOO_EARLY'
      WHEN v_now > v_until THEN 'NO_SHOW_WINDOW_CLOSED'
      -- partie déclarée absente présente : contrôle du permis écrit par l'hôte (le voyageur était
      -- là, l'hôte aussi), ou validation de la remise par la partie déclarée absente
      WHEN core.booking_no_show_party_present(p_trip_id, p_side) THEN 'NO_SHOW_PARTY_PRESENT'
      WHEN p_side = 'HOST' AND NOT v_traced THEN 'NO_SHOW_EVIDENCE_REQUIRED'
      WHEN EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                    WHERE c.trip_id = p_trip_id
                      AND c.status IN ('AWAITING_REVIEW', 'PENDING', 'SETTLED', 'FIN_REVIEW'))
        THEN 'CANCELLATION_PENDING'
    END,
    v_traced, v_from, v_until;
END
$fn$;
COMMENT ON FUNCTION core.trip_no_show_state(uuid, text) IS
  'Interne : obstacle à la déclaration du no-show d''une partie (heure serveur depuis le début '
  'prévu ; présence ; preuve tracée ; demande vivante) et fenêtre de déclaration. US-307 (ADR-191).';

-- 9. Commande d'une partie : déclarer l'autre partie absente (16 TRP-015) ----------------------
-- La partie est celle de la SESSION (0163 : titulaire du compte d'hôte ou voyageur du trip) ; toute
-- autre personne, trip inconnu : NOT_FOUND. L'hôte déclare le voyageur absent (GUEST_NO_SHOW,
-- hostMessageTraced lu par la base : demande PENDING réglée par le travailleur trip_lifecycle) ; le
-- voyageur signale l'hôte absent (HOST_NO_SHOW, preuve exigée : demande AWAITING_REVIEW, validée ou
-- rejetée par l'ops à la console, l'hôte prévenu par trip.no_show.reported). Verrous du voyageur puis
-- du véhicule (17 §2.5), puis l'état relu. Aucun montant. Course résiduelle (index unique) ⇒
-- CANCELLATION_PENDING, rien d'écrit (revue code n° 2).
CREATE FUNCTION core.trip_cmd_report_no_show(p_token_hash bytea, p_trip_id uuid, p_request_id uuid)
  RETURNS TABLE (outcome text, declaration_id uuid, requested_at timestamptz, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_party  record;
  v_prev   record;
  v_state  record;
  v_side   text;
  v_action text;
  v_reason text;
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
  v_org    text := pg_catalog.current_setting('app.org_id', true);
  v_now    timestamptz := platform.now();
  v_status text;
BEGIN
  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT x.* INTO v_party FROM core.trip_handover_party(p_token_hash, p_trip_id) AS x;
  IF v_party.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- l'hôte déclare le voyageur absent ; le voyageur signale l'hôte absent
  IF v_party.role = 'HOST' THEN
    v_side := 'GUEST';
    v_action := 'HOST_DECLARE_NO_SHOW';
    v_reason := 'GUEST_NO_SHOW';
  ELSE
    v_side := 'HOST';
    v_action := 'GUEST_REPORT_HOST_NO_SHOW';
    v_reason := 'HOST_NO_SHOW';
  END IF;
  PERFORM core.trip_handover_lock(p_trip_id);

  -- rejeu : même identifiant ⇒ l'issue d'origine (même trip, même auteur) ; sinon refus
  SELECT c.id, c.trip_id, c.requested_by, c.action_code, c.requested_at, c.status INTO v_prev
    FROM core.booking_trip_cancellation AS c WHERE c.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.trip_id = p_trip_id AND v_prev.requested_by = v_party.user_id
       AND v_prev.action_code = v_action THEN
      RETURN QUERY SELECT 'DONE'::text, v_prev.id, v_prev.requested_at, v_prev.status;
    ELSE
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    END IF;
    RETURN;
  END IF;

  SELECT x.* INTO v_state FROM core.trip_no_show_state(p_trip_id, v_side) AS x;
  IF v_state.blocker IS NOT NULL THEN
    RETURN QUERY SELECT v_state.blocker, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  v_status := CASE WHEN v_reason = 'HOST_NO_SHOW' THEN 'AWAITING_REVIEW' ELSE 'PENDING' END;

  -- contexte de la partie pour l'insertion (politique cmd_hold_cancel_party_ins), rétabli ensuite
  PERFORM pg_catalog.set_config('app.actor_kind', v_party.role, true);
  PERFORM pg_catalog.set_config('app.actor_id', v_party.user_id::text, true);
  PERFORM pg_catalog.set_config('app.org_id',
                                CASE WHEN v_party.role = 'HOST' THEN v_party.org_id::text ELSE '' END,
                                true);
  BEGIN
    INSERT INTO core.booking_trip_cancellation
           (id, trip_id, country_code, action_code, requested_reason, initiator, sub_reason,
            requested_at, requested_by, host_message_traced, status)
    VALUES (p_request_id, p_trip_id, v_party.country_code, v_action, v_reason, v_party.role, NULL,
            v_now, v_party.user_id,
            CASE WHEN v_reason = 'GUEST_NO_SHOW' THEN v_state.message_traced END, v_status);
  EXCEPTION WHEN unique_violation THEN
    -- une demande vivante écrite par un chemin qui ne prend pas ces verrous : rien d'écrit
    PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
    PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
    PERFORM pg_catalog.set_config('app.org_id', COALESCE(v_org, ''), true);
    RETURN QUERY SELECT 'CANCELLATION_PENDING'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END;
  -- l'hôte est prévenu du signalement (gabarit EVT_TRIP_NO_SHOW_REPORTED) ; aucun motif ni preuve
  IF v_reason = 'HOST_NO_SHOW' THEN
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
    VALUES ('trip.no_show.reported', 1, 'trip', p_trip_id, 0, v_party.country_code,
            v_party.user_id, 'GUEST', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('trip_id', p_trip_id, 'absent_party', 'HOST',
                                          'declaration_id', p_request_id),
            p_trip_id::text);
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  PERFORM pg_catalog.set_config('app.org_id', COALESCE(v_org, ''), true);
  RETURN QUERY SELECT 'DONE'::text, p_request_id, v_now, v_status;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_report_no_show(bytea, uuid, uuid) IS
  'Commande d''une partie du trip : l''hôte déclare le voyageur absent (GUEST_NO_SHOW, '
  'hostMessageTraced lu en base, demande PENDING), le voyageur signale l''hôte absent '
  '(HOST_NO_SHOW, preuve exigée, demande AWAITING_REVIEW validée par l''ops, hôte prévenu) ; '
  'délais en heure serveur depuis le début prévu ; rejeu idempotent. SECURITY DEFINER, EXECUTE '
  'app_api. US-307 (ADR-191).';

-- 10. Lecture d'une partie : peut-elle déclarer l'autre absente, et où en est la demande ? ------
CREATE FUNCTION core.trip_no_show_view(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_party record;
  v_state record;
  t       record;
  c       record;
  v_side  text;
BEGIN
  SELECT x.* INTO v_party FROM core.trip_handover_party(p_token_hash, p_trip_id) AS x;
  IF v_party.user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_FOUND');
  END IF;
  v_side := CASE WHEN v_party.role = 'HOST' THEN 'GUEST' ELSE 'HOST' END;
  SELECT tr.status, tr.timezone, tr.scheduled_start INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  SELECT x.* INTO v_state FROM core.trip_no_show_state(p_trip_id, v_side) AS x;
  -- dernière demande du trip : statut et heure ; motif rendu pour un no-show seulement, sinon
  -- OTHER (jamais GUEST_FRAUD_PROVEN, PLATFORM_TRUST_SAFETY… d'une autre partie : revue sécurité
  -- n° 2) ; jamais un montant ni l'auteur d'une autre partie (seulement « la mienne »)
  SELECT x.id, x.requested_reason, x.status, x.requested_at, x.requested_by INTO c
    FROM core.booking_trip_cancellation AS x
   WHERE x.trip_id = p_trip_id
   ORDER BY x.requested_at DESC, x.id DESC LIMIT 1;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK',
    'viewerRole', v_party.role,
    'absentParty', v_side,
    'tripStatus', t.status,
    'timezone', t.timezone,
    'scheduledStart', t.scheduled_start,
    'declarableFrom', v_state.declarable_from,
    'declarableUntil', v_state.declarable_until,
    'blocker', v_state.blocker,
    'messageTraced', v_state.message_traced,
    'declaration', CASE WHEN c.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'id', c.id,
      'requestedReason', CASE WHEN c.requested_reason IN ('GUEST_NO_SHOW', 'HOST_NO_SHOW')
                              THEN c.requested_reason ELSE 'OTHER' END,
      'status', c.status,
      'requestedAt', c.requested_at, 'mine', c.requested_by = v_party.user_id) END);
END
$fn$;
COMMENT ON FUNCTION core.trip_no_show_view(bytea, uuid) IS
  'Lecture d''une partie du trip : déclaration du no-show de l''autre partie possible ou premier '
  'obstacle, fenêtre en heure serveur, preuve tracée, dernière demande (motif, statut, heure) ; '
  'NOT_FOUND à toute autre personne. SECURITY DEFINER, EXECUTE app_api. US-307 (ADR-191).';

-- 11. Commande liée aux deux actions de console (signature imposée par le cadre d'US-101) -----
-- Contrôles d'accès faits AVANT l'appel par core.iam_staff_cmd_manual_action (session TOTP,
-- permission trip.declare_no_show ou kyc.license_check_at_handover dans le pays du trip, saisie
-- fermée, garde ADR-122, idempotence par request_id). Rien n'est écrit sur un refus. Aucun montant :
-- la demande est réglée par le travailleur trip_lifecycle.
CREATE FUNCTION core.booking_manual_action_no_show(p_token_hash bytea, p_action_id uuid,
                                                  p_action_code text, p_subject_id uuid,
                                                  p_input jsonb, p_reason text, p_actor uuid,
                                                  p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_reason    text;
  v_initiator text;
  v_sub       text;
  v_side      text;
  v_input     text;
  v_target    text;
  v_traced    boolean;
  v_state     record;
  v_t         record;
  v_report    uuid;
BEGIN
  IF p_action_code IS NULL OR p_action_code NOT IN ('DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP')
     OR p_action_id IS NULL OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_reason IS NULL OR p_input IS NULL THEN
    RAISE EXCEPTION 'no-show : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- motif demandé et initiateur DÉRIVÉS de l'action et de la saisie fermée (jamais reçus : N-131)
  IF p_action_code = 'DECLARE_NO_SHOW' THEN
    v_input := p_input ->> 'absentParty';
    IF v_input IS NULL THEN
      RETURN QUERY SELECT 'NO_SHOW_PARTY_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_initiator := 'PLATFORM';
    v_side := v_input;
    -- NONE : rejet d'un signalement du voyageur en attente (aucun motif demandé)
    v_reason := CASE v_input WHEN 'GUEST' THEN 'GUEST_NO_SHOW' WHEN 'HOST' THEN 'HOST_NO_SHOW'
                             WHEN 'NONE' THEN 'NONE' END;
  ELSE
    v_input := p_input ->> 'refusalReason';
    IF v_input IS NULL THEN
      RETURN QUERY SELECT 'REFUSAL_REASON_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_sub := v_input;
    IF v_input IN ('CLEANLINESS', 'SAFETY') THEN
      -- refus du voyageur validé par l'ops (BR-CXL-04, ligne n° 8)
      v_initiator := 'GUEST';
      v_reason := 'CLEANLINESS_SAFETY_VALID';
    ELSE
      -- refus de l'hôte « à cause du voyageur » (BR-CXL-12, règle 2 : preuve validée = pièce)
      v_initiator := 'HOST';
      v_reason := 'HOST_CANCELLED_DUE_TO_GUEST';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'no-show : saisie hors catalogue' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT tr.id, tr.guest_user_id INTO v_t FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122)
  IF v_t.guest_user_id = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  PERFORM core.trip_handover_lock(p_subject_id);
  SELECT tr.id, tr.status, tr.country_code, tr.checkin_validated_at INTO v_t
    FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;

  -- signalement du no-show de l'hôte par le voyageur, en attente : validé (HOST) ou rejeté (NONE)
  -- par l'ops (revue sécurité n° 1 de la PR #283 : comme Turo, le support vérifie avant tout
  -- remboursement ou pénalité). La validation remet la demande au travailleur (PENDING) ; sa preuve
  -- (message du voyageur + attente) est relue au règlement.
  IF p_action_code = 'DECLARE_NO_SHOW' AND v_input IN ('HOST', 'NONE') THEN
    SELECT c.id INTO v_report FROM core.booking_trip_cancellation AS c
     WHERE c.trip_id = v_t.id AND c.status = 'AWAITING_REVIEW';
    IF v_report IS NOT NULL AND v_input = 'NONE' THEN
      UPDATE core.booking_trip_cancellation AS c
         SET status = 'FAILED', outcome_code = 'HOST_NO_SHOW_REPORT_REJECTED',
             decided_at = platform.now()
       WHERE c.id = v_report AND c.status = 'AWAITING_REVIEW';
      RETURN QUERY SELECT 'DONE'::text, v_report, '{}'::uuid[];
      RETURN;
    ELSIF v_report IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                  WHERE c.trip_id = v_t.id AND c.status IN ('PENDING', 'SETTLED', 'FIN_REVIEW')) THEN
        RETURN QUERY SELECT 'CANCELLATION_PENDING'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      -- obstacles d'état rejoués (revues code n° 3, sécurité n° 4) : refus net, jamais un échec
      -- de règlement ; le signalement reste en attente, à rejeter (NONE)
      IF core.booking_no_show_report_obstacle(v_t.id) IS NOT NULL THEN
        RETURN QUERY SELECT 'NO_SHOW_REPORT_INVALIDATED'::text, NULL::uuid, '{}'::uuid[];
        RETURN;
      END IF;
      UPDATE core.booking_trip_cancellation AS c SET status = 'PENDING'
       WHERE c.id = v_report AND c.status = 'AWAITING_REVIEW';
      RETURN QUERY SELECT 'DONE'::text, v_report, '{}'::uuid[];
      RETURN;
    ELSIF v_input = 'NONE' THEN
      RETURN QUERY SELECT 'NO_REPORT_PENDING'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
  END IF;

  IF p_action_code = 'DECLARE_NO_SHOW' THEN
    SELECT x.* INTO v_state FROM core.trip_no_show_state(p_subject_id, v_side) AS x;
    -- l'ops ne porte pas la preuve d'un no-show de l'hôte à la déclaration : pièce jointe à
    -- l'action ou message du voyageur, relus au règlement (sinon FAILED, jamais un règlement)
    IF v_state.blocker IS NOT NULL AND v_state.blocker <> 'NO_SHOW_EVIDENCE_REQUIRED' THEN
      RETURN QUERY SELECT v_state.blocker, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    IF v_side = 'HOST' AND EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                                    WHERE c.trip_id = v_t.id
                                      AND c.status IN ('AWAITING_REVIEW', 'PENDING', 'SETTLED', 'FIN_REVIEW')) THEN
      RETURN QUERY SELECT 'CANCELLATION_PENDING'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_traced := CASE WHEN v_side = 'GUEST' THEN v_state.message_traced END;
  ELSE
    -- refus du véhicule : avant le check-in seulement (BR-CXL-04 (2), 16 TRP-007)
    IF v_t.checkin_validated_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM core.trip_ops_handover_validation AS hv
                   WHERE hv.trip_id = v_t.id AND hv.kind = 'CHECKIN'
                     AND hv.performer_role = 'GUEST') THEN
      RETURN QUERY SELECT 'REFUSAL_AFTER_CHECKIN'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_target := CASE WHEN v_reason = 'CLEANLINESS_SAFETY_VALID' THEN 'REFUSED_AT_PICKUP'
                     ELSE core.booking_cancellation_target(v_reason) END;
    IF NOT EXISTS (
         SELECT 1 FROM core.booking_trip_transition AS tt
          WHERE tt.from_status = v_t.status AND tt.via = 'CANCEL'
            AND tt.to_status IN (v_target,
                                 CASE WHEN v_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
                                      THEN core.booking_cancellation_target('HOST_CANCELLED')
                                 END)) THEN
      RETURN QUERY SELECT CASE WHEN v_t.status = 'BOOKED' THEN 'CHECKIN_NOT_OPEN'
                               ELSE 'TRIP_TRANSITION_FORBIDDEN' END, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                WHERE c.trip_id = v_t.id AND c.status IN ('AWAITING_REVIEW', 'PENDING', 'SETTLED',
                                                         'FIN_REVIEW')) THEN
      RETURN QUERY SELECT 'CANCELLATION_PENDING'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
  END IF;

  INSERT INTO core.booking_trip_cancellation
         (id, trip_id, country_code, action_code, requested_reason, initiator, sub_reason,
          requested_at, requested_by, host_message_traced)
  VALUES (p_action_id, v_t.id, v_t.country_code, p_action_code, v_reason, v_initiator, v_sub,
          platform.now(), p_actor, v_traced);
  RETURN QUERY SELECT 'DONE'::text, p_action_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.booking_manual_action_no_show(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à DECLARE_NO_SHOW (absentParty) et REFUSE_AT_PICKUP (refusalReason), cadre '
  'd''US-101 : motif demandé et initiateur dérivés de l''action et d''une énumération fermée, heure '
  'serveur, délais et présence relus ; demande PENDING réglée par trip_lifecycle ; aucun montant. '
  'EXECUTE iam_staff_owner. US-307 (ADR-191).';

-- 12 bis. Signalements restés sans issue (travailleur trip_lifecycle ; revue architecture n° 3) --
-- Chaque signalement AWAITING_REVIEW non encore alerté est marqué UNE fois (`review_alerted_at`)
-- s'il est devenu inapplicable (BLOCKED : autre demande vivante sur le trip, obstacle d'état) ou
-- s'il attend depuis `no_show_report_review_alert_minutes` du pays (STALE ; valeur absente ou non
-- positive : au premier passage, fail-closed). Rend des comptes par pays et par cause (alerte
-- TRIP_NO_SHOW_REPORT_UNRESOLVED de STL), jamais un identifiant. SKIP LOCKED : deux travailleurs
-- ne marquent jamais le même signalement deux fois.
CREATE FUNCTION core.booking_worker_no_show_review_alerts(p_batch integer)
  RETURNS TABLE (country_code text, reason text, reports integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  r         record;
  v_now     timestamptz := platform.now();
  v_minutes jsonb;
  v_reason  text;
  v_c       text[] := '{}';
  v_r       text[] := '{}';
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'trip: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  FOR r IN
    SELECT c.id, c.trip_id, c.country_code, c.requested_at
      FROM core.booking_trip_cancellation AS c
     WHERE c.status = 'AWAITING_REVIEW' AND c.review_alerted_at IS NULL
     ORDER BY c.requested_at, c.id
     LIMIT LEAST(GREATEST(COALESCE(p_batch, 0), 0), 500)
       FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := NULL;
    IF EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS o
                WHERE o.trip_id = r.trip_id AND o.id <> r.id
                  AND o.status IN ('PENDING', 'SETTLED', 'FIN_REVIEW'))
       OR core.booking_no_show_report_obstacle(r.trip_id) IS NOT NULL THEN
      v_reason := 'BLOCKED';
    ELSE
      v_minutes := NULL;
      SELECT v.value INTO v_minutes
        FROM core.config_param_value AS v
       WHERE v.key = 'no_show_report_review_alert_minutes'
         AND v.country_code::text = r.country_code::text AND v.scope_type = 'COUNTRY'
         AND v.valid_from <= v_now AND (v.valid_to IS NULL OR v.valid_to > v_now)
       ORDER BY v.valid_from DESC
       LIMIT 1;
      IF pg_catalog.jsonb_typeof(v_minutes) IS DISTINCT FROM 'number'
         OR (v_minutes #>> '{}') !~ '^[0-9]{1,6}$' THEN
        v_reason := 'STALE';
      ELSIF (v_minutes #>> '{}')::integer <= 0
         OR r.requested_at + pg_catalog.make_interval(mins => (v_minutes #>> '{}')::integer)
            <= v_now THEN
        v_reason := 'STALE';
      END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      UPDATE core.booking_trip_cancellation AS c SET review_alerted_at = v_now
       WHERE c.id = r.id AND c.status = 'AWAITING_REVIEW' AND c.review_alerted_at IS NULL;
      v_c := v_c || r.country_code::text;
      v_r := v_r || v_reason;
    END IF;
  END LOOP;
  RETURN QUERY
    SELECT x.c, x.r, pg_catalog.count(*)::integer
      FROM ROWS FROM (pg_catalog.unnest(v_c), pg_catalog.unnest(v_r)) AS x(c, r)
     GROUP BY x.c, x.r
     ORDER BY x.c, x.r;
END
$fn$;
COMMENT ON FUNCTION core.booking_worker_no_show_review_alerts(integer) IS
  'Travailleur trip_lifecycle : marque une fois les signalements du no-show de l''hôte restés sans '
  'issue (STALE : délai du pays ; BLOCKED : autre demande vivante ou obstacle d''état) et rend des '
  'comptes par pays et par cause. EXECUTE app_worker. US-307 (ADR-191).';

-- 12. Faits propres aux déclarations, lus par le travailleur (trip_lifecycle) ------------------
CREATE FUNCTION core.booking_trip_cancellation_flags(p_cancellation_id uuid)
  RETURNS TABLE (host_message_traced boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'trip: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  RETURN QUERY SELECT c.host_message_traced FROM core.booking_trip_cancellation AS c
                WHERE c.id = p_cancellation_id;
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_cancellation_flags(uuid) IS
  'Faits d''une demande lus par le travailleur trip_lifecycle en plus de '
  'core.booking_trip_cancellation_begin : hostMessageTraced figé à la déclaration. US-307 (ADR-191).';

-- 13. Transition d'annulation réglée (corps de 0124 §9 recopié ; blocs marqués US-307 : état cible
--     de la ligne n° 8, preuve du no-show de l'hôte, hostMessageTraced dans l'événement lié) -----
CREATE OR REPLACE FUNCTION core.booking_cmd_trip_settle_cancellation(p_cancellation_id uuid, p_settlement_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip      uuid;
  t           record;
  c           record;
  r           record;
  s           record;
  v_reason    text;
  v_origin    text := 'EVENT';
  v_target    text;
  v_evidence  boolean;
  v_event     jsonb;
  v_params    jsonb;
  v_inputs    jsonb;
  v_bearer    text;
  v_version   integer;
  v_proof     boolean;                                                       -- US-307
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  IF v_trip IS NULL THEN
    PERFORM core.booking_trip_cancellations_pending(0);
    RAISE EXCEPTION 'trip: unknown cancellation'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_cancellation_closed';
  END IF;
  SELECT * INTO t FROM core.booking_trip_lock(v_trip, NULL);
  SELECT x.* INTO c FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  -- rejeu : la demande a déjà été réglée par CE règlement (accusé perdu) ⇒ son issue, rien d'écrit
  IF c.status = 'SETTLED' AND c.settlement_id = p_settlement_id THEN
    RETURN pg_catalog.jsonb_build_object('cancellationId', c.id, 'tripId', v_trip,
                                         'status', t.status, 'settlementId', c.settlement_id,
                                         'costBearer', c.cost_bearer, 'replayed', true);
  END IF;
  IF c.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'trip: cancellation % is %', c.id, c.status
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_cancellation_closed';
  END IF;
  SELECT x.* INTO c FROM core.booking_trip_cancellation AS x
   WHERE x.id = p_cancellation_id FOR UPDATE;

  -- preuve validée (règle 2) : au moins une pièce jointe par l'agent à l'action qui a créé la
  -- demande (17 §3.2.13 `manual_action.evidence_file_ids`, pièces du seau des preuves contrôlées
  -- par la console) ; jamais une valeur reçue (N-131)
  v_evidence := EXISTS (SELECT 1 FROM core.support_manual_action AS m
                         WHERE m.id = c.id AND m.action_code = c.action_code
                           AND m.subject_id = v_trip
                           AND pg_catalog.cardinality(m.evidence_file_ids) > 0);

  -- qualification à l'heure SERVEUR de la demande (corps de 0099, 10.4 ; règle 3 sans objet : un
  -- no-show n'est déclaré qu'à partir de no_show_at, US-307)
  v_reason := c.requested_reason;
  IF c.requested_reason = 'GUEST_CANCELLED' THEN                                -- règle 1
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF c.requested_at >= t.no_show_at AND t.checkin_validated_at IS NULL THEN
      v_reason := 'GUEST_NO_SHOW';
      v_origin := 'LATE_GUEST_CANCELLATION';
    END IF;
  ELSIF c.requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST' THEN                 -- règle 2
    IF c.sub_reason IS NULL
       OR c.sub_reason NOT IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT',
                               'LICENSE_NOT_UPLOADED_1H')
       OR NOT v_evidence THEN
      v_reason := 'HOST_CANCELLED';
      v_origin := 'REQUALIFIED_NO_EVIDENCE';
    END IF;
  END IF;
  -- US-307 : ligne n° 8 (refus du véhicule validé) ⇒ REFUSED_AT_PICKUP (cxl-beta/2)
  v_target := CASE WHEN v_reason = 'CLEANLINESS_SAFETY_VALID' THEN 'REFUSED_AT_PICKUP'
                   ELSE core.booking_cancellation_target(v_reason) END;
  IF v_target IS NULL OR NOT EXISTS (
       SELECT 1 FROM core.booking_trip_transition AS tt
        WHERE tt.from_status = t.status AND tt.to_status = v_target AND tt.via = 'CANCEL') THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s (%s)', t.id, t.status, v_target, v_reason);
  END IF;

  -- US-307 : no-show de l'hôte prouvé (L3-PM-20) : message du voyageur suivi de 15 min sans
  -- réponse de l'hôte, au plus tôt au début prévu, à l'heure de la demande ; ou, pour la console,
  -- au moins une pièce jointe par l'agent. Sans preuve : refus, jamais un règlement.
  IF c.requested_reason = 'HOST_NO_SHOW' THEN
    v_proof := core.booking_no_show_traced(v_trip, 'GUEST', c.requested_at)
               OR (c.action_code = 'DECLARE_NO_SHOW' AND v_evidence);
    IF NOT v_proof THEN
      RAISE EXCEPTION 'trip: host no-show without evidence'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_no_show_evidence_missing';
    END IF;
  END IF;

  -- liaison du règlement à la demande : même trip, version 1 en tête, motifs et état de la base ;
  -- entrées canoniques = faits de la base (événement, départ, réservation, devise, paramètres)
  SELECT r0.currency, r0.scheduled_start, r0.booked_at INTO r
    FROM core.booking_trip AS r0 WHERE r0.id = v_trip;
  v_params := core.booking_cancellation_params(t.country_code, r.currency);
  IF v_params IS NULL THEN
    RAISE EXCEPTION 'trip: cancellation parameters missing for %', t.country_code
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
  END IF;
  v_event := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'reason', c.requested_reason,
    'requestedAtMs', core.booking_epoch_ms(c.requested_at),
    'subReason', c.sub_reason,
    'evidenceValidated', CASE WHEN c.requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
                              THEN v_evidence END,
    'checkinValidated', t.checkin_validated_at IS NOT NULL,
    -- US-307 : hostMessageTraced figé à la déclaration (no-show du voyageur seulement)
    'hostMessageTraced', CASE WHEN c.requested_reason = 'GUEST_NO_SHOW'
                              THEN c.host_message_traced END));
  SELECT x.* INTO s FROM core.settlement_cancellation_of(p_settlement_id) AS x;
  v_inputs := s.inputs;
  IF s.id IS NULL OR s.trip_id IS DISTINCT FROM v_trip OR s.segment_no <> 1 OR s.version <> 1
     OR s.supersedes_id IS NOT NULL OR s.kind IS DISTINCT FROM 'CANCELLATION'
     OR s.superseded IS DISTINCT FROM false
     OR s.requested_reason IS DISTINCT FROM c.requested_reason
     OR s.reason IS DISTINCT FROM v_reason
     OR s.origin IS DISTINCT FROM v_origin
     OR s.target_state IS DISTINCT FROM v_target
     OR (v_inputs -> 'event') IS DISTINCT FROM v_event
     OR (v_inputs -> 'params') IS DISTINCT FROM v_params
     OR (v_inputs -> 'trip' -> 'startAtMs') IS DISTINCT FROM
        pg_catalog.to_jsonb(core.booking_epoch_ms(r.scheduled_start))
     OR (v_inputs -> 'trip' -> 'bookedAtMs') IS DISTINCT FROM
        pg_catalog.to_jsonb(core.booking_epoch_ms(r.booked_at))
     OR (v_inputs -> 'trip' -> 'currency' ->> 'code') IS DISTINCT FROM r.currency THEN
    RAISE EXCEPTION 'trip: settlement % does not match cancellation %', p_settlement_id, c.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_cancellation_settlement_mismatch';
  END IF;

  v_bearer := core.booking_cancellation_cost_bearer(v_reason);
  v_version := core.booking_trip_apply_transition(
    t.id, t.status, v_target, v_reason, v_origin, c.initiator, 'CANCEL',
    pg_catalog.jsonb_build_object('initiator', c.initiator, 'requestedReason', c.requested_reason,
                                  'requestedAt', c.requested_at, 'settlementId', p_settlement_id));
  UPDATE core.booking_trip_cancellation AS x
     SET status = 'SETTLED', settlement_id = p_settlement_id, cost_bearer = v_bearer,
         decided_at = platform.now()
   WHERE x.id = c.id AND x.status = 'PENDING';
  RETURN pg_catalog.jsonb_build_object('cancellationId', c.id, 'tripId', t.id, 'from', t.status,
                                       'status', v_target, 'reason', v_reason, 'origin', v_origin,
                                       'requestedReason', c.requested_reason,
                                       'settlementId', p_settlement_id, 'costBearer', v_bearer,
                                       'rowVersion', v_version, 'replayed', false);
END
$fn$;

REVOKE ALL ON FUNCTION core.trip_no_show_state(uuid, text),
  core.trip_cmd_report_no_show(bytea, uuid, uuid), core.trip_no_show_view(bytea, uuid),
  core.booking_manual_action_no_show(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.booking_trip_cancellation_flags(uuid), core.booking_worker_no_show_review_alerts(integer),
  core.booking_no_show_report_obstacle(uuid), core.booking_no_show_party_present(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trip_cmd_report_no_show(bytea, uuid, uuid),
  core.trip_no_show_view(bytea, uuid)
  TO app_api;
GRANT EXECUTE ON FUNCTION
  core.booking_manual_action_no_show(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.booking_trip_cancellation_flags(uuid),
  core.booking_worker_no_show_review_alerts(integer) TO app_worker;
REVOKE ALL ON FUNCTION core.booking_no_show_policy(), core.booking_no_show_traced(uuid, text,
  timestamptz) FROM PUBLIC;
-- lecture pure des délais (test de concordance sous app_worker)
GRANT EXECUTE ON FUNCTION core.booking_no_show_policy() TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 14. Cadre d'US-101 : liaison des deux actions (contrôlées par le déclencheur de la table) ----
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
SELECT a.code,
       'core.booking_manual_action_no_show(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
       'US-307'
  FROM pg_catalog.unnest(ARRAY['DECLARE_NO_SHOW', 'REFUSE_AT_PICKUP']) AS a(code);

-- 15. Paramètre `no_show_report_review_alert_minutes` (alerte d'un signalement sans issue) :
-- bloc GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json (`renderParamSeedSql`, groupe
-- `embedded` de POST_SEED_PARAMS) ; seed-sql.test.ts exige ce bloc à l'identique. Ne pas
-- l'éditer à la main.
-- 0171 — graine complémentaire : paramètres « no_show_report_review_alert_minutes* » (US-307 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « no_show_report_review_alert_minutes » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('no_show_report_review_alert_minutes', 'DURATION', 'min', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 TRP-015 ; 08 BR-CXL-13 ; ADR-191 (revue de la PR #283) : délai après lequel un signalement du no-show de l’hôte par le voyageur, encore en attente de l’ops, lève l’alerte TRIP_NO_SHOW_REPORT_UNRESOLVED (une fois par signalement) ; absent ou non positif : alerte au premier passage (fail-closed)', 'PROPOSÉ comme Turo (ADR-191) : le support vérifie le signalement dans l’heure qui suit, 2 h avant l’alerte');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('no_show_report_review_alert_minutes', 'PA', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-307 : défauts PROPOSÉS (16 TRP-015 ; 08 BR-CXL-13 ; ADR-191)'),
  ('no_show_report_review_alert_minutes', 'PY', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-307 : défauts PROPOSÉS (16 TRP-015 ; 08 BR-CXL-13 ; ADR-191)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'no\_show\_report\_review\_alert\_minutes%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre no_show_report_review_alert_minutes* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
