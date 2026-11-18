-- 0140 — AVL / SUP : hôte défaillant, annulation de ses trips à venir par l'ops, voyageurs remboursés
-- intégralement par le règlement, sans attendre l'hôte.
-- US-224 (partie 224e, argent / back-end) ; 19 US-224 critère 5 (« Given un hôte défaillant
-- (BR-TRUST-09), When ses trips futurs sont annulés, Then chaque voyageur est remboursé intégralement
-- sans attendre l'hôte ») ; BOARD N-236 ; 08 BR-TRUST-09 (« suspendre les nouvelles réservations d'un
-- hôte défaillant ; prévenir les voyageurs concernés » ; « remboursé intégralement par le règlement
-- (motifs FULL de BR-CXL : variation négative de toutes les jambes, vecteur TJ06), sans attendre
-- l'hôte »), BR-CXL-14 (`HOST_ACCOUNT_CLOSED` : remboursement intégral, 0 gain de l'hôte quel que
-- soit le moment), table de décision n° 13, vecteur T22 ; 17 §2.3 (permission ops.platform_cancel),
-- §10 ; ADR-092 (cadre des actions de console), ADR-122 (séparation des tâches), ADR-124 (hôte
-- restreint : nouvelles réservations refusées, voyageurs prévenus), ADR-148 (annulations réglées dans
-- la transition, 0124) ; ADR-163 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-163, PROPOSÉS, comme Turo : la plateforme suspend l'hôte, annule ses trips à venir
-- et rembourse chaque voyageur en entier ; l'hôte n'est versé qu'après le trajet, sa jambe HOST est
-- encore chez le PSP) :
--   1. nouvelle action de console `CANCEL_HOST_TRIPS` (sujet ORGANIZATION = le compte d'hôte, même
--      permission que les annulations à l'unité : ops.platform_cancel ; aucune saisie) ; contrôles du
--      cadre d'US-101 (session TOTP, permission dans le pays du compte, garde ADR-122 : titulaire et
--      membres du compte, idempotence par request_id, journal chaîné) ;
--   2. commande liée `core.booking_manual_action_cancel_host_trips` (cmd_hold_owner, EXECUTE
--      iam_staff_owner) : l'hôte doit être SUSPENDU (restriction active de son titulaire, ADR-124 :
--      plus aucune nouvelle réservation ; sinon HOST_NOT_RESTRICTED, rien n'est écrit) ; pour chaque
--      trip du compte dont l'état a une sortie CANCEL vers CANCELLED_BY_PLATFORM (trips à venir :
--      réservés, check-in ouvert ; jamais un trip commencé), sans demande vivante, une demande
--      `core.booking_trip_cancellation` PENDING est écrite, comme celle de `CANCEL_TRIP_PLATFORM`
--      au motif `HOST_ACCOUNT_CLOSED` (motif DÉRIVÉ de l'action, jamais reçu : N-131 ; initiateur
--      PLATFORM ; heure serveur) ; identifiant de la demande dérivé de l'action et du trip ; un
--      voyageur qui est l'agent lui-même ⇒ SELF_FORBIDDEN (défense en profondeur) ; aucun trip ⇒
--      NO_TRIP_TO_CANCEL. Aucun montant n'est saisi ni lu ;
--   3. chaque demande est réglée par le travailleur trip_lifecycle comme toute annulation (0124,
--      `TripCancellationProcessor`) : moteur unique, motif FULL, remboursement intégral calculé par
--      le règlement (variation négative de toutes les jambes, TJ06), instances de remboursement et
--      ordres REFUND de Kmino dans la même transaction ; aucune pénalité ni aucun gain de l'hôte
--      (BR-CXL-14) ; la jambe HOST, jamais versée avant le trajet (BR-PAYOUT-02), est débitée chez le
--      PSP : rien n'attend l'hôte ;
--   4. un état devenu incompatible entre la demande et le règlement (check-in commencé) est relu sous
--      les verrous par le travailleur : la demande est garée, le trip ne change pas (0124, inchangé).
--
-- Hors de cette migration (ADR-163, passation docs/team/handoffs/US-224.md, partie 224e) : bouton de
-- la fiche 360° de l'hôte dans la console et ses textes (l'action est accessible par la route
-- générique `POST /console/actions`) ; proposition de véhicules similaires au voyageur ; pénalités
-- et sanctions de l'hôte défaillant (BR-HP-05) ; trips commencés (litige SM-7, reprise de E5).
--
-- Expand / contract : fonction, ligne de catalogue et liaison AJOUTÉES ; rien n'est retiré.
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'CANCEL_HOST_TRIPS';
--   DELETE FROM core.support_manual_action_catalog WHERE action_code = 'CANCEL_HOST_TRIPS';
--   DROP FUNCTION core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text,
--     uuid, text).

-- 1. Catalogue de la console (17 §10 ; cadre d'US-101) -------------------------------------------
INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES ('CANCEL_HOST_TRIPS', 'ops.platform_cancel', 'DOMAIN_COMMAND', 'ORGANIZATION', false, '{}',
        '{}', false);

-- 2. Commande liée (signature imposée par le cadre d'US-101) -------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_manual_action_cancel_host_trips(p_token_hash bytea, p_action_id uuid,
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
  v_org    record;
  r        record;
  v_target text := core.booking_cancellation_target('HOST_ACCOUNT_CLOSED');
  v_n      integer := 0;
BEGIN
  IF p_action_code IS DISTINCT FROM 'CANCEL_HOST_TRIPS' OR p_action_id IS NULL
     OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL OR p_reason IS NULL
     OR p_input IS NULL THEN
    RAISE EXCEPTION 'annulation des trips d''un hôte : action invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT o.id, o.holder_user_id INTO v_org
    FROM core.iam_organization AS o WHERE o.id = p_subject_id;
  IF v_org.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- l'hôte défaillant est d'abord suspendu (08 BR-TRUST-09, ADR-124) : une restriction active de
  -- son titulaire refuse toute nouvelle réservation ; sans elle, rien n'est annulé (fail-closed)
  IF NOT EXISTS (SELECT 1 FROM core.iam_restriction AS x
                  WHERE x.user_id = v_org.holder_user_id AND x.active) THEN
    RETURN QUERY SELECT 'HOST_NOT_RESTRICTED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122 au compte d'hôte) : l'agent
  -- n'annule pas un trip dont il est le voyageur
  IF EXISTS (SELECT 1 FROM core.booking_trip AS t
              WHERE t.org_id = v_org.id AND t.guest_user_id = p_actor) THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- trips à venir : état qui a une sortie CANCEL vers CANCELLED_BY_PLATFORM (paire de SM-1, même
  -- règle que CANCEL_TRIP_PLATFORM) ; une demande vivante d'un trip (autre agent, même instant) le
  -- laisse à sa demande (ON CONFLICT : index trip_cancellation_live_unique)
  FOR r IN
    SELECT t.id, t.country_code
      FROM core.booking_trip AS t
     WHERE t.org_id = v_org.id
       AND EXISTS (SELECT 1 FROM core.booking_trip_transition AS tt
                    WHERE tt.from_status = t.status AND tt.via = 'CANCEL'
                      AND tt.to_status = v_target)
       AND NOT EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                        WHERE c.trip_id = t.id AND c.status IN ('PENDING', 'SETTLED', 'FIN_REVIEW'))
     ORDER BY t.scheduled_start, t.id
  LOOP
    INSERT INTO core.booking_trip_cancellation
           (id, trip_id, country_code, action_code, requested_reason, initiator, sub_reason,
            requested_at, requested_by)
    VALUES (pg_catalog.md5(p_action_id::text || ':' || r.id::text)::uuid, r.id, r.country_code,
            'CANCEL_TRIP_PLATFORM', 'HOST_ACCOUNT_CLOSED', 'PLATFORM', NULL, platform.now(), p_actor)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RETURN QUERY SELECT 'NO_TRIP_TO_CANCEL'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, p_action_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à CANCEL_HOST_TRIPS (cadre d''US-101) : hôte défaillant suspendu (restriction '
  'active), une demande d''annulation PENDING par trip à venir de son compte, motif dérivé '
  'HOST_ACCOUNT_CLOSED (remboursement intégral, 08 BR-TRUST-09, BR-CXL-14), réglée par le '
  'travailleur trip_lifecycle ; aucun montant. EXECUTE iam_staff_owner. US-224e (ADR-163).';
REVOKE ALL ON FUNCTION
  core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Cadre d'US-101 : liaison (contrôlée par le déclencheur de la table) --------------------------
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('CANCEL_HOST_TRIPS',
        'core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-224');
