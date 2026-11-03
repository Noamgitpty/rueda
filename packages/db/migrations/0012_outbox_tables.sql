-- 0012 — BUS : outbox transactionnelle, reçus de consommation, lettres mortes, tâches planifiées.
-- US-008 ; 17 §4.1 (enveloppe), §4.2 (outbox, inbox, échecs, purge), §3.1.4 (classes), tableau des
-- entités transverses (outbox_event, inbox_receipt, dead_letter, scheduled_job) ; ADR-011, ADR-050.
-- Appliquée sous `migrator`.
--
-- Bêta (D1) : schéma unique `core`, tables préfixées par le schéma cible du module BUS (`outbox`,
-- packages/db/schemas.ts) : core.outbox_outbox_event -> outbox.outbox_event au passage par module.
--
-- `scheduled_job` : 17 la décrit comme « la table du moteur de files (pg-boss) ». ADR-050 (PROPOSÉ)
-- explique pourquoi la Bêta la porte elle-même (RLS ENABLE + FORCE, platform.now(), rôles de
-- production) derrière le port de file du module BUS (`OutboxRelay`, `JobRunner`, `PeriodicScheduler`,
-- `BusMetrics`, `scheduleJob`, `WorkerTransactions`, ADR-050 point 8) ; un adaptateur pg-boss reste possible.
--
-- Numérotation : règle de packages/db/migrations/README.md (numéro strictement supérieur au plus
-- grand de origin/main à la fusion ; renuméroter à la mise à jour de la branche).
--
-- Retour arrière (tables vides) :
--   DROP TABLE core.outbox_dead_letter, core.outbox_inbox_receipt, core.outbox_scheduled_job,
--     core.outbox_outbox_event;
--   DROP FUNCTION platform.uuid_v7();

-- 0. Identifiant UUID v7 (17 §4.1 : event_id = UUID v7) ---------------------------------------
-- 48 bits d'horodatage en millisecondes (horloge de la base : platform.now()), version 7, variante
-- RFC 9562 héritée de gen_random_uuid() (v4) ; les 74 autres bits sont aléatoires.
CREATE FUNCTION platform.uuid_v7()
  RETURNS uuid
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT encode(
           set_bit(set_bit(
             overlay(uuid_send(gen_random_uuid())
                     PLACING substring(int8send(floor(extract(epoch FROM platform.now()) * 1000)::bigint) FROM 3)
                     FROM 1 FOR 6),
             52, 1), 53, 1),
           'hex')::uuid
$fn$;

COMMENT ON FUNCTION platform.uuid_v7() IS
  'UUID v7 (RFC 9562) horodaté par platform.now() : identifiant des événements (17 §4.1). US-008.';
REVOKE ALL ON FUNCTION platform.uuid_v7() FROM PUBLIC;

-- 1. outbox_event (17 §4.1, §4.2) — classe A ---------------------------------------------------
CREATE TABLE core.outbox_outbox_event (
  id                uuid        PRIMARY KEY DEFAULT platform.uuid_v7(),   -- event_id
  type              text        NOT NULL
    CONSTRAINT outbox_event_type_format
      CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length(type) <= 120),
  schema_version    integer     NOT NULL
    CONSTRAINT outbox_event_schema_version_positive CHECK (schema_version >= 1),
  occurred_at       timestamptz NOT NULL DEFAULT platform.now(),          -- heure serveur du fait
  aggregate_type    text        NOT NULL
    CONSTRAINT outbox_event_aggregate_type_format CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  aggregate_id      uuid        NOT NULL,
  aggregate_version bigint      NOT NULL
    CONSTRAINT outbox_event_aggregate_version_valid CHECK (aggregate_version >= 0),
  -- pays de l'agrégat : format seulement (la liste fait foi dans la configuration, US-013)
  country_code      text
    CONSTRAINT outbox_event_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- acteur : {user_id, role} ou SYSTEM (17 §4.1)
  actor_user_id     uuid,
  actor_role        text        NOT NULL
    CONSTRAINT outbox_event_actor_role_format CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  correlation_id    uuid        NOT NULL,
  causation_id      uuid,
  -- identifiants et valeurs non sensibles ; aucune donnée C3 ni C4 (17 §4.1)
  payload           jsonb       NOT NULL
    CONSTRAINT outbox_event_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  -- agrégat monétaire (trip_id ou hold_id) : un seul consommateur à la fois par clé (17 §4.2, F32)
  partition_key     text
    CONSTRAINT outbox_event_partition_key_length CHECK (length(partition_key) BETWEEN 1 AND 200),
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  published_at      timestamptz,
  attempts          integer     NOT NULL DEFAULT 0
    CONSTRAINT outbox_event_attempts_valid CHECK (attempts >= 0),
  last_error        text
    CONSTRAINT outbox_event_last_error_length CHECK (length(last_error) <= 200),
  CONSTRAINT outbox_event_actor_shape CHECK ((actor_role = 'SYSTEM') = (actor_user_id IS NULL))
);

-- relais : WHERE published_at IS NULL ORDER BY id … FOR UPDATE SKIP LOCKED (17 §4.2)
CREATE INDEX outbox_event_unpublished_idx ON core.outbox_outbox_event (id)
  WHERE (published_at IS NULL);

COMMENT ON TABLE core.outbox_outbox_event IS
  'BUS outbox_event (17 §4.1, §4.2) : insérée dans la transaction du changement d''état ; publiée '
  'par le relais outbox_relay. Classe A (purge 90 j après publication, story de purge à venir).';

-- 2. scheduled_job (17 : table du moteur de files ; ADR-050) ----------------------------------
-- Une ligne = une tâche à exécuter par le travailleur `name` (= app.worker_name) : livraison d'un
-- événement à un consommateur (event_id renseigné) ou minuterie durable (17 §2.11).
CREATE TABLE core.outbox_scheduled_job (
  id            uuid        PRIMARY KEY DEFAULT platform.uuid_v7(),
  name          text        NOT NULL
    CONSTRAINT scheduled_job_name_format CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  run_at        timestamptz NOT NULL DEFAULT platform.now(),
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT scheduled_job_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  singleton_key text
    CONSTRAINT scheduled_job_singleton_key_length CHECK (length(singleton_key) BETWEEN 1 AND 200),
  event_id      uuid,
  state         text        NOT NULL DEFAULT 'CREATED'
    CONSTRAINT scheduled_job_state_valid CHECK (state IN ('CREATED', 'ACTIVE', 'COMPLETED', 'FAILED')),
  attempts      integer     NOT NULL DEFAULT 0,
  -- 17 §4.2 : 5 tentatives, puis lettre morte
  max_attempts  integer     NOT NULL DEFAULT 5
    CONSTRAINT scheduled_job_max_attempts_valid CHECK (max_attempts BETWEEN 1 AND 25),
  locked_until  timestamptz,
  last_error    text
    CONSTRAINT scheduled_job_last_error_length CHECK (length(last_error) <= 200),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  updated_at    timestamptz NOT NULL DEFAULT platform.now(),
  row_version   integer     NOT NULL DEFAULT 0,
  CONSTRAINT scheduled_job_attempts_valid CHECK (attempts BETWEEN 0 AND max_attempts),
  CONSTRAINT scheduled_job_active_is_leased CHECK ((state = 'ACTIVE') = (locked_until IS NOT NULL)),
  CONSTRAINT scheduled_job_completed_at CHECK ((state = 'COMPLETED') = (completed_at IS NOT NULL))
);

-- au plus une tâche vivante par (travailleur, clé) : fan-out idempotent du relais
CREATE UNIQUE INDEX scheduled_job_singleton ON core.outbox_scheduled_job (name, singleton_key)
  WHERE (singleton_key IS NOT NULL AND state IN ('CREATED', 'ACTIVE'));
CREATE INDEX scheduled_job_due_idx ON core.outbox_scheduled_job (name, run_at)
  WHERE (state IN ('CREATED', 'ACTIVE'));

CREATE TRIGGER touch_row BEFORE UPDATE ON core.outbox_scheduled_job
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

COMMENT ON TABLE core.outbox_scheduled_job IS
  'BUS scheduled_job (17 §2.11, §3.1.4 ; ADR-050) : file durable par travailleur (name = '
  'app.worker_name), réessais à attente exponentielle, minuteries. Classe : purge des tâches terminées.';

-- 3. inbox_receipt (17 §4.2) : un reçu par (consommateur, événement) ---------------------------
CREATE TABLE core.outbox_inbox_receipt (
  consumer     text        NOT NULL
    CONSTRAINT inbox_receipt_consumer_format CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'),
  event_id     uuid        NOT NULL,          -- sans FK : l'outbox est purgée à 90 j (17 §4.2)
  processed_at timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT inbox_receipt_pkey PRIMARY KEY (consumer, event_id)
);

COMMENT ON TABLE core.outbox_inbox_receipt IS
  'BUS inbox_receipt (17 §4.2) : écrit dans la transaction du traitement ; doublon => ignoré. '
  'Purge 90 j (fenêtre de rejeu tolérée : 30 j).';

-- 4. dead_letter (17 §4.2) — classe A ----------------------------------------------------------
CREATE TABLE core.outbox_dead_letter (
  id          uuid        PRIMARY KEY DEFAULT platform.uuid_v7(),
  consumer    text        NOT NULL
    CONSTRAINT dead_letter_consumer_format CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'),
  event_id    uuid,                            -- nul pour une minuterie (tâche sans événement)
  job_id      uuid        NOT NULL
    CONSTRAINT dead_letter_job_unique UNIQUE,  -- sans FK : scheduled_job est purgée
  attempts    integer     NOT NULL
    CONSTRAINT dead_letter_attempts_positive CHECK (attempts >= 1),
  last_error  text
    CONSTRAINT dead_letter_last_error_length CHECK (length(last_error) <= 200),
  parked_at   timestamptz NOT NULL DEFAULT platform.now(),
  replayed_at timestamptz,                     -- rejeu par la console (ADMIN, journalisé) : à venir
  replayed_by uuid,
  CONSTRAINT dead_letter_replay_shape CHECK ((replayed_at IS NULL) = (replayed_by IS NULL))
);

COMMENT ON TABLE core.outbox_dead_letter IS
  'BUS dead_letter (17 §4.2) : tâche épuisée après max_attempts tentatives ; alerte émise par le '
  'travailleur ; rejeu par la console (ADMIN, journalisé), story à venir. Classe A.';

-- 5. RLS ENABLE + FORCE, migrator_all ----------------------------------------------------------
ALTER TABLE core.outbox_outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.outbox_outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.outbox_outbox_event TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.outbox_scheduled_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.outbox_scheduled_job FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.outbox_scheduled_job TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.outbox_inbox_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.outbox_inbox_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.outbox_inbox_receipt TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.outbox_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.outbox_dead_letter FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.outbox_dead_letter TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.outbox_outbox_event, core.outbox_scheduled_job, core.outbox_inbox_receipt,
  core.outbox_dead_letter FROM PUBLIC;
