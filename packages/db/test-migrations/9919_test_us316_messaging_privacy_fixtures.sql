-- 9919 — fixtures des preuves de la confidentialité, des rendez-vous et de la rétention de la
-- messagerie (US-316, migration 0166). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE à app_api et
-- app_worker) :
--   1. test_fixture.us316_trip : trip BOOKED de la fixture d'US-525 (`us525_trip`, 9926), appelable
--      aussi depuis la transaction du travailleur (app_worker) ;
--   2. test_fixture.us316_seed_message / us316_seed_meeting : message et rendez-vous accepté
--      ÉCRITS DIRECTEMENT (le travailleur ne peut pas appeler les commandes, réservées à app_api) ;
--   3. test_fixture.us316_messages / us316_meetings / us316_events : relecture de ce que les rôles
--      applicatifs ne lisent pas (textes, purge, rendez-vous, événements du trip) ;
--   4. test_fixture.us316_open_case : dossier de support du trip (réclamation) dans un état donné ;
--   5. test_fixture.us316_force_write : écriture DIRECTE par le propriétaire des tables (liste
--      fermée) : preuve que les gardes refusent même hors des rôles applicatifs, et purge d'un
--      message pour la lecture servie.
-- Appelées SEULEMENT dans une transaction ANNULÉE. AUCUN interrupteur de mise en service écrit
-- (17 §0.1). Les attendus des tests viennent de 19 US-316, 16 MSG-001 / LEG-009, 22 OQ-BR-25,
-- 17 §2.3 et d'ADR-186, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us316_trip(text, uuid, uuid, timestamptz,
--   timestamptz), test_fixture.us316_seed_message(uuid, uuid, text, text, timestamptz),
--   test_fixture.us316_messages(uuid), test_fixture.us316_meetings(uuid),
--   test_fixture.us316_events(uuid), test_fixture.us316_open_case(uuid, text),
--   test_fixture.us316_force_write(uuid, text).

CREATE FUNCTION test_fixture.us316_trip(p_country text, p_org uuid, p_guest uuid,
                                        p_start timestamptz, p_end timestamptz)
  RETURNS TABLE (trip_id uuid, org_id uuid, vehicle_id uuid, holder_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- plpgsql : corps résolu à l'appel (9926, qui définit us525_trip, s'applique après 9919)
  RETURN QUERY
  SELECT x.trip_id, x.org_id, x.vehicle_id, x.holder_id
    FROM test_fixture.us525_trip(p_country, p_org, p_guest, 'Ana', 'María José', p_start, p_end)
         AS x;
END
$fn$;

-- Message d'une partie, à l'heure donnée (texte servi = texte reçu : aucun masquage ici)
CREATE FUNCTION test_fixture.us316_seed_message(p_trip uuid, p_author uuid, p_role text,
                                                p_body text, p_sent_at timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_thread uuid;
  v_id     uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.messaging_message_thread (id, trip_id, created_at)
  VALUES (pg_catalog.gen_random_uuid(), p_trip, p_sent_at)
  ON CONFLICT ON CONSTRAINT messaging_message_thread_trip_unique DO NOTHING;
  SELECT th.id INTO v_thread FROM core.messaging_message_thread AS th WHERE th.trip_id = p_trip;
  INSERT INTO core.messaging_message (id, thread_id, author_user_id, author_role, body, body_masked,
                                      channel_origin, status, sent_at)
  VALUES (v_id, v_thread, p_author, p_role, p_body, p_body, 'IN_APP', 'SENT', p_sent_at);
  RETURN v_id;
END
$fn$;

-- Rendez-vous ACCEPTÉ écrit directement (le travailleur ne peut pas appeler les commandes)
CREATE FUNCTION test_fixture.us316_seed_meeting(p_trip uuid, p_host uuid, p_kind text,
                                                p_place text, p_meet_at timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id    uuid := pg_catalog.gen_random_uuid();
  v_guest uuid;
BEGIN
  SELECT t.guest_user_id INTO v_guest FROM core.booking_trip AS t WHERE t.id = p_trip;
  INSERT INTO core.messaging_meeting_proposal (id, trip_id, kind, proposed_by, proposer_role,
                                               place_label, meet_at, status, created_at)
  VALUES (v_id, p_trip, p_kind, p_host, 'HOST', p_place, p_meet_at, 'PROPOSED', platform.now());
  UPDATE core.messaging_meeting_proposal
     SET status = 'ACCEPTED', answered_by = v_guest, answered_at = platform.now()
   WHERE id = v_id;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us316_messages(p_trip uuid)
  RETURNS TABLE (id uuid, author_role text, body text, body_masked text, status text,
                 sent_at timestamptz, purged_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.id, m.author_role, m.body, m.body_masked, m.status, m.sent_at, m.purged_at
    FROM core.messaging_message AS m
    JOIN core.messaging_message_thread AS th ON th.id = m.thread_id
   WHERE th.trip_id = p_trip
   ORDER BY m.sent_at, m.id
$fn$;

CREATE FUNCTION test_fixture.us316_meetings(p_trip uuid)
  RETURNS TABLE (id uuid, kind text, proposer_role text, place_label text, meet_at timestamptz,
                 status text, answered_by uuid, purged_at timestamptz, offplatform_codes text[],
                 review_item boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.id, p.kind, p.proposer_role, p.place_label, p.meet_at, p.status, p.answered_by,
         p.purged_at, p.offplatform_codes, p.review_item_id IS NOT NULL
    FROM core.messaging_meeting_proposal AS p
   WHERE p.trip_id = p_trip
   ORDER BY p.created_at, p.id
$fn$;

-- Événements trip.meeting.confirmed du trip (type, acteur, charge utile)
CREATE FUNCTION test_fixture.us316_events(p_trip uuid)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_role text,
                 actor_user_id uuid, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_role, e.actor_user_id, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_trip AND e.type = 'trip.meeting.confirmed'
   ORDER BY e.occurred_at, e.id
$fn$;

-- Dossier de support du trip (réclamation) dans l'état donné (OPEN, PENDING, RESOLVED, CLOSED)
CREATE FUNCTION test_fixture.us316_open_case(p_trip uuid, p_status text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t  record;
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT t.guest_user_id, t.country_code INTO v_t FROM core.booking_trip AS t WHERE t.id = p_trip;
  INSERT INTO core.support_support_case (id, requester_user_id, country_code, trip_id, channel,
                                         category, status)
  VALUES (v_id, v_t.guest_user_id, v_t.country_code, p_trip, 'EMAIL', 'CLAIM', p_status);
  RETURN v_id;
END
$fn$;

-- Écriture directe par le propriétaire des tables (liste fermée, sans SQL dynamique)
CREATE FUNCTION test_fixture.us316_force_write(p_id uuid, p_what text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    -- message
    WHEN 'PURGE' THEN
      UPDATE core.messaging_message SET body = NULL, body_masked = NULL, purged_at = platform.now()
       WHERE id = p_id;
    WHEN 'PURGE_KEEP_BODY' THEN
      UPDATE core.messaging_message SET body_masked = NULL, purged_at = platform.now()
       WHERE id = p_id;
    WHEN 'UNPURGE' THEN
      UPDATE core.messaging_message SET body = 'rétabli', body_masked = 'rétabli', purged_at = NULL
       WHERE id = p_id;
    -- rendez-vous
    WHEN 'MEETING_DELETE' THEN
      DELETE FROM core.messaging_meeting_proposal WHERE id = p_id;
    WHEN 'MEETING_REWRITE_PLACE' THEN
      UPDATE core.messaging_meeting_proposal SET place_label = 'Ailleurs' WHERE id = p_id;
    WHEN 'MEETING_MOVE' THEN
      UPDATE core.messaging_meeting_proposal SET meet_at = meet_at + interval '1 hour'
       WHERE id = p_id;
    WHEN 'MEETING_REOPEN' THEN
      UPDATE core.messaging_meeting_proposal
         SET status = 'PROPOSED', answered_by = NULL, answered_at = NULL
       WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'us316_force_write: % inconnu', p_what;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us316_trip(text, uuid, uuid, timestamptz, timestamptz),
  test_fixture.us316_seed_message(uuid, uuid, text, text, timestamptz),
  test_fixture.us316_seed_meeting(uuid, uuid, text, text, timestamptz),
  test_fixture.us316_messages(uuid), test_fixture.us316_meetings(uuid),
  test_fixture.us316_events(uuid), test_fixture.us316_open_case(uuid, text),
  test_fixture.us316_force_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us316_trip(text, uuid, uuid, timestamptz, timestamptz),
  test_fixture.us316_seed_message(uuid, uuid, text, text, timestamptz),
  test_fixture.us316_seed_meeting(uuid, uuid, text, text, timestamptz),
  test_fixture.us316_messages(uuid), test_fixture.us316_meetings(uuid),
  test_fixture.us316_events(uuid), test_fixture.us316_open_case(uuid, text),
  test_fixture.us316_force_write(uuid, text) TO app_api, app_worker;
