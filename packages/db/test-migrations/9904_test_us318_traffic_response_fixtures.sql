-- 9904 — fixtures des preuves de la suite d'US-318 (refacturation : référence unique, délai de
-- réponse du voyageur, contestation, décision de l'ops, plafond ; migration 0181, ADR-201). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : relire une
-- refacturation et son avis (aucun rôle applicatif ne les lit), poser une nouvelle version d'un
-- paramètre traffic_guest_* (preuve du refus fail-closed, transaction ANNULÉE) et tenter une
-- écriture interdite. « Échue » est lue par le prédicat de production
-- `core.claim_traffic_charge_eligible`, jamais recopié. Les attendus des tests viennent de 08
-- (BR-TT-02 : 48 h pour payer ou contester ; BR-REIMB-02 / 03 / 05), 19 US-318 et du rapport de
-- la red team (F-L3-SIN-01, F-L3-SIN-02), jamais de ces fixtures. AUCUNE fixture n'écrit un
-- interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us318s_* (voir la liste des droits en fin de fichier).

-- État d'une refacturation lu par objet (jamais par la file globale)
CREATE FUNCTION test_fixture.us318s_state(p_id uuid)
  RETURNS TABLE (rules_version smallint, reference text, reference_key text, guest_user_id uuid,
                 guest_status text, execution_status text, execution_code text,
                 response_hours integer, response_due_at timestamptz, cap_minor bigint,
                 accepted_at timestamptz, disputed_at timestamptz, dispute_reason text,
                 dispute_evidence_file_ids uuid[], decided_role text, decision_rationale text,
                 charge_basis text, charge_id uuid, due boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.rules_version, x.reference, x.reference_key, x.guest_user_id, x.guest_status,
         x.execution_status, x.execution_code, x.response_hours, x.response_due_at, x.cap_minor,
         x.accepted_at, x.disputed_at, x.dispute_reason, x.dispute_evidence_file_ids,
         x.decided_role, x.decision_rationale, x.charge_basis, x.charge_id,
         core.claim_traffic_charge_eligible(x.rules_version, x.execution_status, x.guest_status,
                                            x.response_due_at, x.next_check_at, platform.now())
    FROM core.claim_traffic_charge AS x WHERE x.id = p_id
$fn$;

-- Refacturations d'un trip (nombre et identifiants, ordre stable par référence)
CREATE FUNCTION test_fixture.us318s_charges(p_trip uuid)
  RETURNS TABLE (id uuid, reference_key text, kind text, amount_minor bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.id, x.reference_key, x.kind, x.amount_minor
    FROM core.claim_traffic_charge AS x WHERE x.trip_id = p_trip
   ORDER BY x.reference_key, x.request_id
$fn$;

-- Avis au voyageur (outbox) d'une refacturation
CREATE FUNCTION test_fixture.us318s_events(p_charge uuid)
  RETURNS TABLE (type text, aggregate_type text, actor_role text, actor_user_id uuid,
                 country_code text, payload jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.actor_role, e.actor_user_id, e.country_code::text, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_charge AND e.aggregate_type = 'traffic_charge'
$fn$;

-- Nouvelle version d'un paramètre traffic_guest_* du pays (valeur illisible ou autre valeur ;
-- transaction ANNULÉE seulement)
CREATE FUNCTION test_fixture.us318s_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('traffic_guest_response_h', 'traffic_guest_charge_max_minor') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-318 suite (annulé)');
END
$fn$;

-- Écritures interdites (la garde claim_p2p_guard s'applique aussi sous migrator)
CREATE FUNCTION test_fixture.us318s_try_write(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'REOPEN_WINDOW' THEN
    UPDATE core.claim_traffic_charge
       SET response_due_at = response_due_at + interval '1 day',
           response_hours = response_hours + 24
     WHERE id = p_id;
  ELSIF p_what = 'UNDISPUTE' THEN
    UPDATE core.claim_traffic_charge
       SET guest_status = 'AWAITING_GUEST', disputed_at = NULL, dispute_reason = NULL,
           dispute_evidence_file_ids = NULL
     WHERE id = p_id;
  ELSIF p_what = 'REFERENCE' THEN
    UPDATE core.claim_traffic_charge SET reference = reference || 'X' WHERE id = p_id;
  ELSIF p_what = 'REDECIDE' THEN
    UPDATE core.claim_traffic_charge
       SET decision_rationale = decision_rationale || ' (réécrit)' WHERE id = p_id;
  END IF;
END
$fn$;

-- Refacturation du trip en attente du voyageur (matrice des routes d'US-043 : décision d'une
-- refacturation NON contestée ⇒ 409, autre pays ⇒ FORBIDDEN) ; pièce : photo d'une série du trip
-- (fixture 9907) ; une seule lecture de l'horloge
CREATE FUNCTION test_fixture.us318s_insert_charge(p_trip uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id   uuid := pg_catalog.gen_random_uuid();
  v_now  timestamptz := platform.now();
  v_file uuid := test_fixture.us706_photo(p_trip, 'CHECKOUT', 'EXT_04', 'HOST');
BEGIN
  INSERT INTO core.claim_traffic_charge
         (id, trip_id, country_code, currency, org_id, declared_by, kind, occurred_at, file_id,
          amount_minor, fee_bps, admin_fee_minor, total_minor, leg_host_minor, leg_insurer_minor,
          leg_tax_third_party_minor, leg_platform_minor, trip_start_at, trip_end_at, deadline_at,
          request_id, declared_at, next_check_at, rules_version, guest_user_id, reference,
          response_hours, response_due_at, cap_minor, guest_status)
  SELECT v_id, t.id, t.country_code, t.currency, t.org_id, o.holder_user_id, 'TOLL',
         v_now - interval '36 hours', v_file, 100, 500, 5, 105, 100, 0, 0, 5,
         v_now - interval '2 days', v_now - interval '1 day', v_now + interval '100 days',
         pg_catalog.gen_random_uuid(), v_now, v_now + interval '48 hours', 2, t.guest_user_id,
         'US043-' || pg_catalog.left(v_id::text, 8), 48, v_now + interval '48 hours', 100000,
         'AWAITING_GUEST'
    FROM core.booking_trip AS t JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip;
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us318s_state(uuid),
  test_fixture.us318s_charges(uuid),
  test_fixture.us318s_events(uuid),
  test_fixture.us318s_param_version(text, text, jsonb),
  test_fixture.us318s_try_write(text, uuid),
  test_fixture.us318s_insert_charge(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us318s_state(uuid),
  test_fixture.us318s_charges(uuid),
  test_fixture.us318s_events(uuid),
  test_fixture.us318s_param_version(text, text, jsonb),
  test_fixture.us318s_try_write(text, uuid),
  test_fixture.us318s_insert_charge(uuid)
TO app_worker, app_api;
