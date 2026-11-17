-- 0128 — SUP / AVL / STL : état d'une demande d'annulation lu par la console (O01).
-- US-215 (partie 215b, console) ; 19 US-215 (critères 1 à 4 vus par l'agent : remboursement par
-- jambe, porteur du coût, qualification) ; 16 ADM-006, BKG-035 ; 17 §2.3 (permission
-- ops.platform_cancel, portée pays), §3.2.4 ; ADR-092 (cadre des actions de console), ADR-122
-- (séparation des tâches), ADR-148 (demande d'annulation, 0124) ; ADR-151 (cette migration). Suite
-- du BOARD : N-228. Appliquée sous `migrator`, en une transaction.
--
-- Pourquoi : la console répond 201 STAFF_ACTION_DONE dès que la DEMANDE est enregistrée (0124) ;
-- le règlement se fait quelques secondes plus tard par le travailleur trip_lifecycle et peut finir
-- FIN_REVIEW ou FAILED. L'agent doit lire l'état RÉEL de la demande.
--
-- Cette migration AJOUTE trois fonctions de lecture (aucune écriture de domaine, aucune table) :
--   1. `core.settlement_staff_cancellation_summary(uuid)` (cmd_money_owner, EXECUTE iam_staff_owner) :
--      règlement d'annulation lié : devise, motif qualifié, total payé, remboursement du voyageur,
--      pénalité et compensation de l'hôte, variation par jambe (jamais un prorata) et ordres REFUND
--      (état et montant) ; montants en unités mineures, rendus en texte (bigint exact) ;
--   2. `core.booking_staff_trip_cancellation(uuid)` (cmd_hold_owner, EXECUTE iam_staff_owner) :
--      DERNIÈRE demande d'annulation du trip (action, motif demandé, initiateur, sous-motif, état,
--      code garé, porteur du coût, heures de demande et de décision, règlement) et état du trip ;
--      jamais l'identifiant de l'agent qui l'a demandée ;
--   3. `core.support_staff_trip_cancellation(bytea, uuid, uuid)` (iam_staff_owner, EXECUTE app_api) :
--      session élevée par TOTP, permission `ops.platform_cancel` EN COURS dans le pays du trip
--      (celle des trois actions d'annulation), garde de séparation des tâches (ADR-122 : un trip
--      qui concerne l'agent est refusé) ; chaque refus est journalisé (audit chaîné). Trip inconnu :
--      FORBIDDEN, même issue qu'un trip d'un autre pays (aucun oracle d'existence). Issues : OK
--      (corps), NONE (aucune demande), AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, SELF_FORBIDDEN.
--      Aucune donnée personnelle n'est rendue (codes, montants, identifiants techniques) : la
--      lecture n'est pas inscrite au journal des accès (PROPOSÉ, ADR-151 ; un rafraîchissement de
--      l'écran toutes les quelques secondes n'écrit rien).
--
-- Expand / contract : fonctions AJOUTÉES seulement ; aucun droit sur une table n'est accordé.
--
-- Retour arrière :
--   DROP FUNCTION core.support_staff_trip_cancellation(bytea, uuid, uuid),
--     core.booking_staff_trip_cancellation(uuid), core.settlement_staff_cancellation_summary(uuid).

-- 1. Règlement d'annulation lu par la console (famille cmd_money) ---------------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE FUNCTION core.settlement_staff_cancellation_summary(p_settlement_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'settlementId', s.id,
           'currency', s.currency,
           'reason', s.reason,
           'totalPaidMinor', s.total_paid_minor::text,
           'guestRefundMinor', s.guest_refund_minor::text,
           'hostPenaltyMinor', s.host_penalty_minor::text,
           'hostCompensationMinor', s.host_compensation_minor::text,
           'legs', COALESCE(
             (SELECT pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object('leg', l.leg,
                                                     'variationMinor', l.variation_minor::text)
                       ORDER BY l.leg)
                FROM core.settlement_settlement_leg AS l
               WHERE l.settlement_id = s.id),
             '[]'::jsonb),
           'refunds', COALESCE(
             (SELECT pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object('status', o.status,
                                                     'amountMinor', o.amount_minor::text)
                       ORDER BY o.created_at, o.id)
                FROM core.payment_payment_operation AS o
               WHERE o.settlement_id = s.id AND o.kind = 'REFUND'),
             '[]'::jsonb))
    FROM core.settlement_settlement AS s
   WHERE s.id = p_settlement_id AND s.kind = 'CANCELLATION'
$fn$;
COMMENT ON FUNCTION core.settlement_staff_cancellation_summary(uuid) IS
  'Règlement d''annulation lu par la console : montants en unités mineures (texte), variation par '
  'jambe, ordres REFUND (état, montant) ; aucune donnée personnelle. EXECUTE iam_staff_owner '
  'seulement (core.support_staff_trip_cancellation). US-215 (ADR-151).';
REVOKE ALL ON FUNCTION core.settlement_staff_cancellation_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_staff_cancellation_summary(uuid) TO iam_staff_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. Dernière demande d'annulation d'un trip (famille cmd_hold) -----------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_staff_trip_cancellation(p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'cancellationId', c.id,
           'tripId', c.trip_id,
           'country', c.country_code,
           'action', c.action_code,
           'requestedReason', c.requested_reason,
           'initiator', c.initiator,
           'subReason', c.sub_reason,
           'status', c.status,
           'outcomeCode', c.outcome_code,
           'costBearer', c.cost_bearer,
           'settlementId', c.settlement_id,
           'requestedAt', c.requested_at,
           'decidedAt', c.decided_at,
           'tripStatus', t.status)
    FROM core.booking_trip_cancellation AS c
    JOIN core.booking_trip AS t ON t.id = c.trip_id
   WHERE c.trip_id = p_trip_id
   ORDER BY c.requested_at DESC, c.created_at DESC, c.id DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.booking_staff_trip_cancellation(uuid) IS
  'Dernière demande d''annulation d''un trip pour la console : action, motif demandé, initiateur, '
  'sous-motif, état, code garé, porteur du coût, heures, règlement, état du trip ; jamais l''agent '
  'demandeur. EXECUTE iam_staff_owner seulement (core.support_staff_trip_cancellation). US-215 '
  '(ADR-151).';
REVOKE ALL ON FUNCTION core.booking_staff_trip_cancellation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_staff_trip_cancellation(uuid) TO iam_staff_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Lecture de la console (famille iam_staff_owner, EXECUTE app_api) -----------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

CREATE FUNCTION core.support_staff_trip_cancellation(p_token_hash bytea, p_request_id uuid,
                                                     p_trip_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_reason  text;
  v_body    jsonb;
  v_stl     jsonb;
BEGIN
  IF p_request_id IS NULL OR p_trip_id IS NULL THEN
    RAISE EXCEPTION 'état d''annulation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'TRIP', p_trip_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'READ', 'permission', 'ops.platform_cancel',
                                   'field_or_file', 'trip_cancellation'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.support_country_of_trip(p_trip_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'ops.platform_cancel', ARRAY[v_country], NULL);
  END IF;
  v_reason := CASE
    -- trip inconnu : même issue qu'un trip hors de la portée (aucun oracle d'existence)
    WHEN v_country IS NULL THEN 'NOT_FOUND'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN core.support_actor_conflict(v_s.user_id, 'TRIP', p_trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN', 'TRIP',
                                 p_trip_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'READ', 'permission', 'ops.platform_cancel',
                                   'field_or_file', 'trip_cancellation')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country)
                                    END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_body := core.booking_staff_trip_cancellation(p_trip_id);
  IF v_body IS NULL THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_body ->> 'settlementId' IS NOT NULL THEN
    v_stl := core.settlement_staff_cancellation_summary((v_body ->> 'settlementId')::uuid);
  END IF;
  RETURN QUERY SELECT 'OK'::text,
                      v_body || pg_catalog.jsonb_build_object('settlement', v_stl);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_trip_cancellation(bytea, uuid, uuid) IS
  'Console : état de la dernière demande d''annulation d''un trip (O01) ; session élevée, '
  'permission ops.platform_cancel dans le pays du trip, garde ADR-122 ; refus journalisés ; aucune '
  'donnée personnelle rendue. EXECUTE app_api. US-215 (ADR-151).';
REVOKE ALL ON FUNCTION core.support_staff_trip_cancellation(bytea, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_trip_cancellation(bytea, uuid, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
