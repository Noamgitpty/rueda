-- 0011 — BUS : fonctions du relais, de la file et de la consommation idempotente.
-- US-008 ; 17 §4.2 ; ADR-050. Appliquée sous `migrator`.
--
-- Toutes ces fonctions sont SECURITY INVOKER : elles s'exécutent sous le rôle appelant (app_api,
-- app_worker), donc SOUS SA RLS et ses droits par colonne (0012). Elles ne donnent aucun droit ;
-- elles fixent seulement la forme des écritures (une seule façon de réclamer, terminer, échouer).
-- Le travailleur est désigné par le contexte de session (app.actor_kind = 'WORKER',
-- app.worker_name, 17 §2.3) : une file = un travailleur, un reçu = un consommateur. Contexte absent
-- ⇒ aucune ligne visible (fail-closed). search_path figé, aucun SQL dynamique, horloge
-- platform.now() seulement (17 §1.3) : l'application passe des durées, jamais « l'heure courante ».
--
-- Retour arrière :
--   DROP FUNCTION core.outbox_relay_claim(integer), core.outbox_mark_published(uuid[]),
--     core.outbox_record_relay_failure(uuid[], text),
--     core.outbox_enqueue(text, jsonb, text, uuid, timestamptz, interval, integer),
--     core.outbox_claim_jobs(integer, interval), core.outbox_begin_receipt(uuid),
--     core.outbox_complete_job(uuid), core.outbox_fail_job(uuid, text, interval),
--     core.outbox_reap_expired_jobs();

-- 1. Relais (17 §4.2) : lot d'événements non publiés, verrouillés, sans attendre les autres relais.
CREATE FUNCTION core.outbox_relay_claim(p_limit integer)
  RETURNS SETOF core.outbox_outbox_event
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'outbox_relay_claim : taille de lot hors bornes' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT e.*
      FROM core.outbox_outbox_event e
     WHERE e.published_at IS NULL
     ORDER BY e.id
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED;
END
$fn$;

-- Publication confirmée : published_at posé une fois (la politique interdit d'y revenir).
CREATE FUNCTION core.outbox_mark_published(p_ids uuid[])
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE core.outbox_outbox_event
     SET published_at = platform.now(), attempts = attempts + 1, last_error = NULL
   WHERE id = ANY (p_ids) AND published_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- Échec du relais (transaction séparée, après ROLLBACK) : tentative comptée, erreur courte.
CREATE FUNCTION core.outbox_record_relay_failure(p_ids uuid[], p_error text)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE core.outbox_outbox_event
     SET attempts = attempts + 1, last_error = left(p_error, 200)
   WHERE id = ANY (p_ids) AND published_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- 2. File (ADR-050) : ajout d'une tâche. Instant d'exécution = p_run_at (instant métier, ex. début
-- du trip − 24 h) ou platform.now() + p_delay. Doublon vivant (même travailleur, même clé) : rien
-- n'est ajouté et la fonction renvoie false (fan-out idempotent du relais).
CREATE FUNCTION core.outbox_enqueue(
  p_name          text,
  p_payload       jsonb,
  p_singleton_key text        DEFAULT NULL,
  p_event_id      uuid        DEFAULT NULL,
  p_run_at        timestamptz DEFAULT NULL,
  p_delay         interval    DEFAULT interval '0 seconds',
  p_max_attempts  integer     DEFAULT 5
)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_delay IS NULL OR p_delay < interval '0 seconds' THEN
    RAISE EXCEPTION 'outbox_enqueue : délai négatif' USING ERRCODE = '22023';
  END IF;
  -- sans cible : seul l'index partiel scheduled_job_singleton peut entrer en conflit (id = UUID v7)
  INSERT INTO core.outbox_scheduled_job (name, payload, singleton_key, event_id, run_at, max_attempts)
  VALUES (p_name, p_payload, p_singleton_key, p_event_id,
          COALESCE(p_run_at, platform.now() + p_delay), p_max_attempts)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END
$fn$;

-- Réclamation par le travailleur de SA file : tâches échues (ou bail expiré), tentatives restantes.
-- Chaque réclamation compte une tentative (un plantage pendant le traitement en consomme une).
CREATE FUNCTION core.outbox_claim_jobs(p_limit integer, p_lease interval)
  RETURNS SETOF core.outbox_scheduled_job
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'outbox_claim_jobs : taille de lot hors bornes' USING ERRCODE = '22023';
  END IF;
  IF p_lease IS NULL OR p_lease <= interval '0 seconds' THEN
    RAISE EXCEPTION 'outbox_claim_jobs : bail non positif' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    UPDATE core.outbox_scheduled_job j
       SET state = 'ACTIVE', attempts = j.attempts + 1, locked_until = platform.now() + p_lease
     WHERE j.id = ANY (ARRAY(
             SELECT c.id
               FROM core.outbox_scheduled_job c
              WHERE c.name = app.worker_name()
                AND c.run_at <= platform.now()
                AND c.attempts < c.max_attempts
                AND (c.state = 'CREATED'
                     OR (c.state = 'ACTIVE' AND c.locked_until <= platform.now()))
              ORDER BY c.run_at, c.id
              LIMIT p_limit
                FOR UPDATE SKIP LOCKED))
    RETURNING j.*;
END
$fn$;

-- 3. Consommation idempotente (17 §4.2) : reçu (consommateur = app.worker_name(), événement),
-- écrit dans la transaction du traitement. true = premier traitement ; false = doublon, à ignorer.
CREATE FUNCTION core.outbox_begin_receipt(p_event_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  -- worker_name nul ⇒ 23502 (NOT NULL) : pas de reçu anonyme
  INSERT INTO core.outbox_inbox_receipt (consumer, event_id)
  VALUES (app.worker_name(), p_event_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END
$fn$;

-- Tâche terminée (dans la transaction du traitement, avec le reçu).
CREATE FUNCTION core.outbox_complete_job(p_job_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.outbox_scheduled_job
     SET state = 'COMPLETED', completed_at = platform.now(), locked_until = NULL, last_error = NULL
   WHERE id = p_job_id AND name = app.worker_name() AND state = 'ACTIVE';
  RETURN FOUND;
END
$fn$;

-- Échec d'une tentative (transaction séparée, après le ROLLBACK du traitement) :
-- tentatives restantes ⇒ nouvelle échéance platform.now() + base × 2^(tentatives − 1) ('RETRY') ;
-- sinon ⇒ FAILED et lettre morte dans la même transaction ('DEAD_LETTER', le travailleur alerte).
CREATE FUNCTION core.outbox_fail_job(p_job_id uuid, p_error text, p_backoff_base interval)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_job core.outbox_scheduled_job%ROWTYPE;
BEGIN
  IF p_backoff_base IS NULL OR p_backoff_base < interval '0 seconds' THEN
    RAISE EXCEPTION 'outbox_fail_job : attente négative' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job
    FROM core.outbox_scheduled_job
   WHERE id = p_job_id AND name = app.worker_name() AND state = 'ACTIVE'
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE core.outbox_scheduled_job
       SET state = 'FAILED', locked_until = NULL, last_error = left(p_error, 200)
     WHERE id = v_job.id;
    INSERT INTO core.outbox_dead_letter (consumer, event_id, job_id, attempts, last_error)
    VALUES (v_job.name, v_job.event_id, v_job.id, v_job.attempts, left(p_error, 200));
    RETURN 'DEAD_LETTER';
  END IF;
  UPDATE core.outbox_scheduled_job
     SET state = 'CREATED', locked_until = NULL, last_error = left(p_error, 200),
         run_at = platform.now() + p_backoff_base * power(2, v_job.attempts - 1)
   WHERE id = v_job.id;
  RETURN 'RETRY';
END
$fn$;

-- Bail expiré sur une tâche sans tentative restante (le travailleur est mort pendant la dernière) :
-- FAILED et lettre morte ; renvoie les lettres mortes créées pour que le travailleur alerte.
CREATE FUNCTION core.outbox_reap_expired_jobs()
  RETURNS SETOF core.outbox_dead_letter
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
    WITH expired AS (
      UPDATE core.outbox_scheduled_job j
         SET state = 'FAILED', locked_until = NULL, last_error = 'LEASE_EXPIRED'
       WHERE j.id = ANY (ARRAY(
               SELECT c.id
                 FROM core.outbox_scheduled_job c
                WHERE c.name = app.worker_name()
                  AND c.state = 'ACTIVE'
                  AND c.locked_until <= platform.now()
                  AND c.attempts >= c.max_attempts
                  FOR UPDATE SKIP LOCKED))
      RETURNING j.id, j.name, j.event_id, j.attempts
    )
    INSERT INTO core.outbox_dead_letter (consumer, event_id, job_id, attempts, last_error)
    SELECT x.name, x.event_id, x.id, x.attempts, 'LEASE_EXPIRED' FROM expired x
    RETURNING *;
END
$fn$;

COMMENT ON FUNCTION core.outbox_relay_claim(integer) IS
  'Relais : lot d''événements non publiés, FOR UPDATE SKIP LOCKED, ORDER BY id (17 §4.2). US-008.';
COMMENT ON FUNCTION core.outbox_enqueue(text, jsonb, text, uuid, timestamptz, interval, integer) IS
  'File : ajoute une tâche (fan-out idempotent par singleton_key). US-008, ADR-050.';
COMMENT ON FUNCTION core.outbox_claim_jobs(integer, interval) IS
  'File : réclame les tâches échues de la file app.worker_name(), SKIP LOCKED, bail. US-008.';
COMMENT ON FUNCTION core.outbox_begin_receipt(uuid) IS
  'Inbox : reçu (app.worker_name(), event_id) ; false = doublon à ignorer (17 §4.2). US-008.';
COMMENT ON FUNCTION core.outbox_fail_job(uuid, text, interval) IS
  'File : RETRY (attente exponentielle) ou DEAD_LETTER après max_attempts (17 §4.2). US-008.';

REVOKE ALL ON FUNCTION
  core.outbox_relay_claim(integer),
  core.outbox_mark_published(uuid[]),
  core.outbox_record_relay_failure(uuid[], text),
  core.outbox_enqueue(text, jsonb, text, uuid, timestamptz, interval, integer),
  core.outbox_claim_jobs(integer, interval),
  core.outbox_begin_receipt(uuid),
  core.outbox_complete_job(uuid),
  core.outbox_fail_job(uuid, text, interval),
  core.outbox_reap_expired_jobs()
FROM PUBLIC;
