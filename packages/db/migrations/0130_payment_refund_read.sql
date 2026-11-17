-- 0130 — PAY / AVL / SUP : lecture du remboursement par le voyageur, l'hôte et la console (S10).
-- US-224 (partie 224d, écrans) ; 19 US-224 (critère 1 : « le remboursement est visible du voyageur,
-- de l'hôte (jambe HOST seulement) et de l'ops ») ; 16 PAY-021 ; 08 SM-8, E3, BR-PAY-08 (date
-- d'émission, jamais une date de réception) ; 10b S10, UX-31, UXQ-11 ; 17 v6 §3.2.7
-- (`refund_instance`) ; ADR-147, ADR-150 ; ADR-154 (cette migration). Suite du BOARD : N-235.
-- Appliquée sous `migrator`, en une transaction.
--
-- Cette migration AJOUTE trois fonctions de LECTURE (aucune écriture de domaine, aucune table,
-- aucun droit sur une table) :
--   1. `core.payment_trip_refund_view(uuid, text)` (cmd_money_owner, EXECUTE cmd_hold_owner et
--      iam_staff_owner) : instances SM-8 d'un trip, vue choisie par l'appelant de confiance :
--        - GUEST : état, montant remboursé au voyageur, rail, date d'émission ; jamais une jambe ni
--          un motif de blocage (l'avance de Kmino concerne l'hôte) ;
--        - HOST : état, part de la jambe HOST du remboursement (impact sur ses gains), date
--          d'émission ; jamais le montant total ni le rail du voyageur (critère 1 : jambe HOST
--          seulement) ;
--        - STAFF : tout (jambes demandées, ordre, motif de blocage, alerte FIN, tentative, version
--          du règlement, avance) ;
--      une instance SUPERSEDED ou CANCELLED (remplacée par la version suivante) n'est montrée qu'au
--      staff. Montants en unités mineures, rendus en TEXTE (bigint exact), jamais recalculés ;
--      dates en ISO 8601 UTC (millisecondes) ;
--   2. `core.booking_trip_refunds(bytea, uuid)` (cmd_hold_owner, EXECUTE app_api) : la partie de la
--      session (voyageur du trip ou TITULAIRE du compte d'hôte, jugée en base comme le contrat,
--      0122) lit sa vue ; toute autre personne, un trip inconnu ou une session absente reçoivent
--      NOT_FOUND (même réponse, aucun oracle) ;
--   3. `core.support_staff_trip_refunds(bytea, uuid, uuid)` (iam_staff_owner, EXECUTE app_api) :
--      session élevée par TOTP, permission `ops.platform_cancel` (OPS_AGENT, ADMIN) OU
--      `finance.platform_advance` (FINANCE, ADMIN) EN COURS dans le pays du trip, garde de
--      séparation des tâches (ADR-122) ; chaque refus est journalisé (audit chaîné) ; trip inconnu :
--      FORBIDDEN, même issue qu'un trip hors de la portée. Aucune donnée personnelle rendue (codes,
--      montants, identifiants techniques) : lecture non inscrite au journal des accès (comme 0128).
--
-- Expand / contract : fonctions AJOUTÉES seulement.
--
-- Retour arrière :
--   DROP FUNCTION core.support_staff_trip_refunds(bytea, uuid, uuid),
--     core.booking_trip_refunds(bytea, uuid), core.payment_trip_refund_view(uuid, text).

-- 1. Vue des instances d'un trip (famille cmd_money) ----------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE FUNCTION core.payment_trip_refund_view(p_trip_id uuid, p_viewer text)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_trip_id IS NULL OR p_viewer IS NULL OR p_viewer NOT IN ('GUEST', 'HOST', 'STAFF') THEN
    RAISE EXCEPTION 'payment: refund view input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(v.item ORDER BY v.created_at, v.id)
      FROM (
        SELECT ri.created_at, ri.id,
               CASE p_viewer
                 WHEN 'GUEST' THEN pg_catalog.jsonb_build_object(
                   'status', ri.status,
                   'currency', ri.currency,
                   'amountMinor', ri.amount_trip_minor::text,
                   'rail', ri.rail,
                   'plannedAt', pg_catalog.to_char(ri.created_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'issuedAt', pg_catalog.to_char(ri.issued_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                 WHEN 'HOST' THEN pg_catalog.jsonb_build_object(
                   'status', ri.status,
                   'currency', ri.currency,
                   'hostLegMinor', COALESCE(ri.requested_legs ->> 'HOST', '0'),
                   'plannedAt', pg_catalog.to_char(ri.created_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'issuedAt', pg_catalog.to_char(ri.issued_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                 ELSE pg_catalog.jsonb_build_object(
                   'instanceId', ri.id,
                   'status', ri.status,
                   'currency', ri.currency,
                   'amountMinor', ri.amount_trip_minor::text,
                   'rail', ri.rail,
                   'attemptNo', ri.attempt_no,
                   'settlementVersion', ri.settlement_version,
                   'requestedLegs', ri.requested_legs,
                   'orderLegs', COALESCE(
                     (SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text)
                        FROM core.payment_payment_operation_leg AS l
                       WHERE l.operation_id = ri.operation_id),
                     '{}'::jsonb),
                   'orderStatus', o.status,
                   'blockedReason', ri.blocked_reason,
                   'finAlert', ri.fin_alert,
                   'advance', CASE WHEN a.id IS NULL THEN NULL ELSE
                     pg_catalog.jsonb_build_object('status', a.status,
                                                   'amountMinor', a.amount_minor::text) END,
                   'plannedAt', pg_catalog.to_char(ri.created_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'issuedAt', pg_catalog.to_char(ri.issued_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
               END AS item
          FROM core.payment_refund_instance AS ri
          JOIN core.payment_payment_operation AS o ON o.id = ri.operation_id
          LEFT JOIN core.settlement_platform_advance AS a ON a.id = ri.advance_id
         WHERE ri.trip_id = p_trip_id
           -- instance remplacée par la version suivante (ou annulée) : staff seulement
           AND (p_viewer = 'STAFF' OR ri.status NOT IN ('SUPERSEDED', 'CANCELLED'))
      ) AS v), '[]'::jsonb);
END
$fn$;
COMMENT ON FUNCTION core.payment_trip_refund_view(uuid, text) IS
  'Instances de remboursement (SM-8) d''un trip pour une vue : GUEST (montant, rail, date '
  'd''émission), HOST (part de la jambe HOST seulement), STAFF (tout) ; montants en unités '
  'mineures (texte), jamais recalculés. EXECUTE cmd_hold_owner et iam_staff_owner seulement. '
  'US-224 (224d, ADR-154).';
REVOKE ALL ON FUNCTION core.payment_trip_refund_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_trip_refund_view(uuid, text) TO cmd_hold_owner,
  iam_staff_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. Lecture par une partie du trip (famille cmd_hold, EXECUTE app_api) ---------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_trip_refunds(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, viewer_role text, trip_status text, currency text, timezone text,
                 refunds jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  t      record;
  v_role text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT tr.id, tr.status, tr.currency, tr.timezone, tr.guest_user_id, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  v_role := CASE WHEN v_user IS NULL OR t.id IS NULL THEN NULL
                 WHEN v_user = t.guest_user_id THEN 'GUEST'
                 WHEN v_user = t.holder_user_id THEN 'HOST' END;
  IF v_role IS NULL THEN
    -- autre personne, trip inconnu, session absente : même réponse (aucun oracle d'existence)
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_role, t.status, t.currency, t.timezone,
                      core.payment_trip_refund_view(t.id, v_role);
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_refunds(bytea, uuid) IS
  'Remboursements d''un trip pour sa partie de la session (voyageur : montant, rail, date '
  'd''émission ; titulaire du compte d''hôte : jambe HOST seulement) ; NOT_FOUND sinon. SECURITY '
  'DEFINER, EXECUTE app_api. US-224 (224d, ADR-154).';
REVOKE ALL ON FUNCTION core.booking_trip_refunds(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_trip_refunds(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Lecture de la console (famille iam_staff_owner, EXECUTE app_api) -----------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

CREATE FUNCTION core.support_staff_trip_refunds(p_token_hash bytea, p_request_id uuid,
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
BEGIN
  IF p_request_id IS NULL OR p_trip_id IS NULL THEN
    RAISE EXCEPTION 'remboursements : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
                                   'attempted', 'READ',
                                   'permission', 'ops.platform_cancel|finance.platform_advance',
                                   'field_or_file', 'trip_refunds'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.support_country_of_trip(p_trip_id);
  IF v_country IS NOT NULL THEN
    -- l'ops qui annule et la FINANCE qui décide l'avance lisent le même remboursement
    v_role := COALESCE(
      core.iam_staff_permitted(v_s.user_id, 'ops.platform_cancel', ARRAY[v_country], NULL),
      core.iam_staff_permitted(v_s.user_id, 'finance.platform_advance', ARRAY[v_country], NULL));
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
                                   'attempted', 'READ',
                                   'permission', 'ops.platform_cancel|finance.platform_advance',
                                   'field_or_file', 'trip_refunds')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country)
                                    END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text,
                      pg_catalog.jsonb_build_object(
                        'tripId', p_trip_id,
                        'country', v_country,
                        'refunds', core.payment_trip_refund_view(p_trip_id, 'STAFF'));
END
$fn$;
COMMENT ON FUNCTION core.support_staff_trip_refunds(bytea, uuid, uuid) IS
  'Console : remboursements (SM-8) d''un trip, toutes jambes, motif de blocage, alerte FIN ; '
  'session élevée, permission ops.platform_cancel ou finance.platform_advance dans le pays du '
  'trip, garde ADR-122 ; refus journalisés ; aucune donnée personnelle rendue. EXECUTE app_api. '
  'US-224 (224d, ADR-154).';
REVOKE ALL ON FUNCTION core.support_staff_trip_refunds(bytea, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_trip_refunds(bytea, uuid, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
