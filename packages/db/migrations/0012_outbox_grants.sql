-- 0012 — BUS : droits et politiques RLS de l'outbox, de la file, des reçus et des lettres mortes.
-- US-008 ; 17 §2.3 (rôles, « une politique explicite par travailleur »), §4.2 ; ADR-035, ADR-050.
-- Appliquée sous `migrator`.
--
-- Principes (même grille que 0007) :
--   - PUBLIC, app_anon : rien ;
--   - DELETE, TRUNCATE : personne (la purge à 90 j viendra avec sa story et son travailleur) ;
--   - politiques séparées par commande SQL, toutes conditionnées au contexte de session
--     (17 §2.3) : contexte absent ⇒ aucune ligne visible, aucune écriture (fail-closed) ;
--   - colonnes bornées par GRANT INSERT / UPDATE (colonnes) : un producteur ne choisit ni
--     occurred_at, ni created_at, ni published_at ; une tâche naît CREATED, sans tentative.
--
-- Qui fait quoi :
--   - producteurs (app_api avec un acteur GUEST / HOST / STAFF ; app_worker avec un nom de
--     travailleur) : INSERT dans outbox_event, dans la transaction de leur changement d'état ;
--     ni lecture, ni modification ;
--   - relais `outbox_relay` (app_worker) : lit les événements, pose published_at une seule fois ;
--   - tâches : tout producteur peut en ajouter (fan-out du relais, minuteries) ; seul le
--     travailleur nommé `name` lit, réclame, termine ou fait échouer les tâches de SA file ;
--   - reçus et lettres mortes : seul le consommateur concerné (consumer = app.worker_name()).
--
-- Retour arrière : DROP POLICY <politiques ci-dessous> ; REVOKE ALL ON core.outbox_* FROM app_api,
--   app_worker ; REVOKE EXECUTE ON FUNCTION <fonctions de 0011>, platform.uuid_v7() FROM app_api,
--   app_worker.

-- Les valeurs par défaut (id, occurred_at…) s'évaluent sous le rôle qui insère.
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO app_api, app_worker;

-- core.outbox_outbox_event ---------------------------------------------------------------------
GRANT INSERT (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version,
              country_code, actor_user_id, actor_role, correlation_id, causation_id, payload,
              partition_key)
  ON core.outbox_outbox_event TO app_api, app_worker;
GRANT SELECT ON core.outbox_outbox_event TO app_worker;
GRANT UPDATE (published_at, attempts, last_error) ON core.outbox_outbox_event TO app_worker;

CREATE POLICY api_insert ON core.outbox_outbox_event FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY worker_insert ON core.outbox_outbox_event FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);
CREATE POLICY worker_select_relay ON core.outbox_outbox_event FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'outbox_relay');
-- un événement publié ne bouge plus (classe A)
CREATE POLICY worker_update_relay ON core.outbox_outbox_event FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'outbox_relay'
         AND published_at IS NULL)
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'outbox_relay');

-- core.outbox_scheduled_job --------------------------------------------------------------------
GRANT INSERT (name, run_at, payload, singleton_key, event_id, max_attempts)
  ON core.outbox_scheduled_job TO app_api, app_worker;
GRANT SELECT ON core.outbox_scheduled_job TO app_worker;
GRANT UPDATE (state, attempts, run_at, locked_until, last_error, completed_at)
  ON core.outbox_scheduled_job TO app_worker;

CREATE POLICY api_insert ON core.outbox_scheduled_job FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF')
              AND state = 'CREATED' AND attempts = 0);
CREATE POLICY worker_insert ON core.outbox_scheduled_job FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL
              AND state = 'CREATED' AND attempts = 0);
CREATE POLICY worker_select_own_queue ON core.outbox_scheduled_job FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND name = app.worker_name());
CREATE POLICY worker_update_own_queue ON core.outbox_scheduled_job FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND name = app.worker_name())
  WITH CHECK (app.actor_kind() = 'WORKER' AND name = app.worker_name());

-- core.outbox_inbox_receipt (ajout seul) -------------------------------------------------------
GRANT SELECT ON core.outbox_inbox_receipt TO app_worker;
GRANT INSERT (consumer, event_id) ON core.outbox_inbox_receipt TO app_worker;
CREATE POLICY worker_select_own ON core.outbox_inbox_receipt FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND consumer = app.worker_name());
CREATE POLICY worker_insert_own ON core.outbox_inbox_receipt FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND consumer = app.worker_name());

-- core.outbox_dead_letter (ajout seul ; rejeu par la console : story à venir) -------------------
GRANT SELECT ON core.outbox_dead_letter TO app_worker;
GRANT INSERT (consumer, event_id, job_id, attempts, last_error)
  ON core.outbox_dead_letter TO app_worker;
CREATE POLICY worker_select_own ON core.outbox_dead_letter FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND consumer = app.worker_name());
CREATE POLICY worker_insert_own ON core.outbox_dead_letter FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND consumer = app.worker_name());

-- Fonctions (0011) : SECURITY INVOKER, donc bornées par ce qui précède --------------------------
GRANT EXECUTE ON FUNCTION
  core.outbox_relay_claim(integer),
  core.outbox_mark_published(uuid[]),
  core.outbox_record_relay_failure(uuid[], text),
  core.outbox_enqueue(text, jsonb, text, uuid, timestamptz, interval, integer),
  core.outbox_claim_jobs(integer, interval),
  core.outbox_begin_receipt(uuid),
  core.outbox_complete_job(uuid),
  core.outbox_fail_job(uuid, text, interval),
  core.outbox_reap_expired_jobs()
TO app_worker;
-- l'API programme des minuteries dans la transaction d'une commande (17 §2.11)
GRANT EXECUTE ON FUNCTION
  core.outbox_enqueue(text, jsonb, text, uuid, timestamptz, interval, integer)
TO app_api;
