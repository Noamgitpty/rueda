-- 0185 — PLATFORM : garde de reprise après une restauration (US-402, ADR-206 PROPOSÉ ; L4-PM-19,
-- L4-PM-20 ; 17 §6.4 ; 16 ADM-034 / ADM-035). Appliquée sous `migrator`, en une transaction.
-- Numéro : le premier libre sur `main` au moment de l'écriture (contiguïté, migrations/README.md) ;
-- renuméroté à la fusion si 0185 à 0188 (réservés au BOARD par d'autres stories) passent avant.
--
-- Problème (L4-PM-19, critique) : une base restaurée à un instant T ne sait rien de ce qui a été
-- exécuté chez le PSP (débit, remboursement, débit MIT, versement) ni envoyé (avis) APRÈS T. Si les
-- travailleurs repartent tout de suite, l'outbox et les files rejouent ce qui était en attente à T
-- et les processus métier recréent ce qui a été perdu : double débit, double versement, avis
-- envoyés deux fois. Une commande exécutée au PSP après T et ABSENTE de la base restaurée ne peut
-- être retrouvée que par une lecture du PSP (rapprochement, N-420, lot C).
--
-- Règle (ADR-206, PROPOSÉE, fail-closed) : après une restauration, AUCUNE tâche n'est réclamée
-- (`core.outbox_claim_jobs` ne rend rien) tant que la garde de reprise est levée ; donc aucun
-- travailleur n'émet quoi que ce soit (commandes d'argent, versements, avis, files périodiques,
-- traitement des webhooks). L'outbox et les tâches restent intactes, en attente. La garde est
-- levée de deux façons, indépendantes :
--   1. DÉTECTION AUTOMATIQUE : la ligne de temps (timeline) de PostgreSQL change à chaque promotion
--      d'une instance restaurée (restauration à un instant donné, au plus récent, depuis une copie).
--      La ligne de temps attendue est enregistrée par cette migration et par chaque levée ; une base
--      dont la ligne de temps courante diffère est une base restaurée ⇒ garde levée. Ligne de temps
--      illisible ⇒ garde levée (fail-closed).
--   2. MAIN DE L'EXPLOITATION : `platform.recovery_place_hold(motif)` (travailleur ou ops) pose une
--      garde explicite, par exemple avant une restauration logique (pg_restore, portabilité), qui ne
--      change pas la ligne de temps.
-- La levée (`platform.recovery_release`) n'appartient qu'à `migrator` (outil d'exploitation
-- `packages/db/src/restore/release-cli.ts`, après le rapprochement avec le PSP, docs/ops/
-- BACKUP_RESTORE.md « Reprise gardée ») : aucun rôle applicatif ne peut la lever.
-- Les interrupteurs de mise en service ne sont ni lus ni touchés ici (contrainte 7).
--
-- Retour arrière : migration corrective qui remet le corps de 0013 dans core.outbox_claim_jobs,
--   puis DROP FUNCTION platform.recovery_release(text), platform.recovery_place_hold(text),
--   platform.recovery_status(), platform.recovery_hold_active(), platform.recovery_timeline() ;
--   DROP TABLE platform.recovery_hold, platform.recovery_guard. Aucune donnée métier touchée.

-- 1. Ligne de temps courante (WAL) : 8 premiers chiffres hexadécimaux du nom du segment courant.
--    `pg_current_wal_lsn` et `pg_walfile_name` sont exécutables par PUBLIC (fonctions du système) ;
--    illisible (instance en récupération, droit retiré) ⇒ NULL, que la garde traite comme levée.
CREATE FUNCTION platform.recovery_timeline()
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN ('x' || pg_catalog.substr(pg_catalog.pg_walfile_name(pg_catalog.pg_current_wal_lsn()), 1, 8))::bit(32)::integer;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION platform.recovery_timeline() IS
  'Ligne de temps courante de l''instance (US-402, ADR-206) ; NULL si illisible (garde levée).';
REVOKE ALL ON FUNCTION platform.recovery_timeline() FROM PUBLIC;

-- 2. Ligne de temps attendue (une ligne) et gardes explicites.
CREATE TABLE platform.recovery_guard (
  singleton         boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  expected_timeline integer     NOT NULL CHECK (expected_timeline > 0),
  recorded_at       timestamptz NOT NULL DEFAULT platform.now(),
  recorded_by       text        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE platform.recovery_guard IS
  'Ligne de temps attendue de l''instance (US-402, ADR-206) : écrite par la migration 0185 puis par '
  'chaque levée de la garde (platform.recovery_release, sous migrator). Différente de la courante '
  '⇒ base restaurée ⇒ aucune tâche réclamée.';

CREATE TABLE platform.recovery_hold (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  reason      text        NOT NULL CHECK (pg_catalog.length(reason) BETWEEN 3 AND 200),
  placed_at   timestamptz NOT NULL DEFAULT platform.now(),
  placed_by   text        NOT NULL DEFAULT current_user,
  released_at timestamptz,
  released_by text,
  release_note text CHECK (release_note IS NULL OR pg_catalog.length(release_note) BETWEEN 3 AND 500),
  CONSTRAINT recovery_hold_release_complete
    CHECK ((released_at IS NULL) = (released_by IS NULL)
           AND (released_at IS NULL) = (release_note IS NULL))
);

COMMENT ON TABLE platform.recovery_hold IS
  'Gardes de reprise explicites (US-402, ADR-206) : posées par platform.recovery_place_hold, '
  'levées par platform.recovery_release (migrator) ; jamais supprimées (trace de la reprise).';

ALTER TABLE platform.recovery_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.recovery_guard FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.recovery_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.recovery_hold FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.recovery_guard FROM PUBLIC;
REVOKE ALL ON platform.recovery_hold FROM PUBLIC;
GRANT SELECT ON platform.recovery_guard TO guard_owner;
GRANT SELECT, INSERT ON platform.recovery_hold TO guard_owner;

CREATE POLICY guard_read ON platform.recovery_guard FOR SELECT TO guard_owner USING (true);
CREATE POLICY migrator_read ON platform.recovery_guard FOR SELECT TO migrator USING (true);
CREATE POLICY migrator_record ON platform.recovery_guard FOR INSERT TO migrator WITH CHECK (true);
CREATE POLICY migrator_rerecord ON platform.recovery_guard
  FOR UPDATE TO migrator USING (true) WITH CHECK (true);

CREATE POLICY guard_read ON platform.recovery_hold FOR SELECT TO guard_owner USING (true);
CREATE POLICY guard_place ON platform.recovery_hold
  FOR INSERT TO guard_owner WITH CHECK (released_at IS NULL);
CREATE POLICY migrator_read ON platform.recovery_hold FOR SELECT TO migrator USING (true);
CREATE POLICY migrator_place ON platform.recovery_hold
  FOR INSERT TO migrator WITH CHECK (released_at IS NULL);
CREATE POLICY migrator_release ON platform.recovery_hold
  FOR UPDATE TO migrator USING (released_at IS NULL) WITH CHECK (released_at IS NOT NULL);

-- Une garde levée ne se rouvre pas ; ni la ligne de temps ni une garde ne se suppriment.
CREATE FUNCTION platform.recovery_hold_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
     AND NEW.id = OLD.id AND NEW.reason = OLD.reason AND NEW.placed_at = OLD.placed_at
     AND NEW.placed_by = OLD.placed_by THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'recovery hold: append-only (placed once, released once)'
    USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'recovery_hold_append_only';
END
$fn$;
REVOKE ALL ON FUNCTION platform.recovery_hold_immutable() FROM PUBLIC;
CREATE TRIGGER recovery_hold_append_only
  BEFORE UPDATE OR DELETE ON platform.recovery_hold
  FOR EACH ROW EXECUTE FUNCTION platform.recovery_hold_immutable();

CREATE FUNCTION platform.recovery_no_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'recovery guard: no truncate'
    USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'recovery_no_truncate';
END
$fn$;
REVOKE ALL ON FUNCTION platform.recovery_no_truncate() FROM PUBLIC;
CREATE TRIGGER recovery_hold_no_truncate
  BEFORE TRUNCATE ON platform.recovery_hold
  FOR EACH STATEMENT EXECUTE FUNCTION platform.recovery_no_truncate();
CREATE TRIGGER recovery_guard_no_truncate
  BEFORE TRUNCATE ON platform.recovery_guard
  FOR EACH STATEMENT EXECUTE FUNCTION platform.recovery_no_truncate();
CREATE TRIGGER recovery_guard_no_delete
  BEFORE DELETE ON platform.recovery_guard
  FOR EACH ROW EXECUTE FUNCTION platform.recovery_no_truncate();

-- Ligne de temps attendue = celle de l'instance qui applique cette migration.
INSERT INTO platform.recovery_guard (expected_timeline)
VALUES (COALESCE(platform.recovery_timeline(), 1));

-- 3. Garde active ? Gardes explicites ouvertes, ou ligne de temps différente / illisible.
CREATE FUNCTION platform.recovery_hold_active()
  RETURNS boolean
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM platform.recovery_hold AS h WHERE h.released_at IS NULL)
      OR NOT EXISTS (SELECT 1 FROM platform.recovery_guard AS g
                      WHERE g.singleton
                        AND g.expected_timeline IS NOT DISTINCT FROM platform.recovery_timeline())
$fn$;

COMMENT ON FUNCTION platform.recovery_hold_active() IS
  'Garde de reprise active (US-402, ADR-206) : garde explicite ouverte, ou ligne de temps de '
  'l''instance différente de l''attendue (base restaurée) ou illisible. Lue par outbox_claim_jobs.';

-- 4. État lisible par l'exploitation et les tests (aucune donnée métier, aucun secret).
CREATE FUNCTION platform.recovery_status()
  RETURNS TABLE (active boolean, expected_timeline integer, current_timeline integer,
                 open_holds integer)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT platform.recovery_hold_active(),
         (SELECT g.expected_timeline FROM platform.recovery_guard AS g WHERE g.singleton),
         platform.recovery_timeline(),
         (SELECT pg_catalog.count(*)::integer FROM platform.recovery_hold AS h
           WHERE h.released_at IS NULL)
$fn$;

COMMENT ON FUNCTION platform.recovery_status() IS
  'État de la garde de reprise (US-402) : active, lignes de temps attendue et courante, gardes ouvertes.';

-- 5. Pose d'une garde explicite : ouverte aux travailleurs (elle ne fait qu'arrêter les émissions,
--    sens fail-closed) ; motif court, sans donnée personnelle.
CREATE FUNCTION platform.recovery_place_hold(p_reason text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_reason IS NULL OR pg_catalog.length(p_reason) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'recovery hold: reason of 3 to 200 characters expected'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO platform.recovery_hold (reason, placed_by)
  VALUES (p_reason, session_user)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

COMMENT ON FUNCTION platform.recovery_place_hold(text) IS
  'Pose une garde de reprise explicite (US-402, ADR-206) : plus aucune tâche réclamée jusqu''à la levée.';

REVOKE ALL ON FUNCTION platform.recovery_hold_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.recovery_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.recovery_place_hold(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.recovery_timeline() TO guard_owner;
GRANT EXECUTE ON FUNCTION platform.recovery_hold_active() TO app_api, app_worker;
GRANT EXECUTE ON FUNCTION platform.recovery_status() TO app_worker;
GRANT EXECUTE ON FUNCTION platform.recovery_place_hold(text) TO app_worker;
GRANT CREATE ON SCHEMA platform TO guard_owner;
ALTER FUNCTION platform.recovery_hold_active() OWNER TO guard_owner;
ALTER FUNCTION platform.recovery_status() OWNER TO guard_owner;
ALTER FUNCTION platform.recovery_place_hold(text) OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA platform FROM guard_owner;

-- 6. Levée, sous migrator seulement (SECURITY INVOKER) : toutes les gardes ouvertes sont levées
--    avec la note du rapprochement, et la ligne de temps courante devient l'attendue. Refusée si la
--    ligne de temps est illisible. Rend le nombre de gardes explicites levées.
CREATE FUNCTION platform.recovery_release(p_note text)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_timeline integer := platform.recovery_timeline();
  v_count integer;
BEGIN
  IF p_note IS NULL OR pg_catalog.length(p_note) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'recovery release: note of 3 to 500 characters expected'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_timeline IS NULL THEN
    RAISE EXCEPTION 'recovery release: timeline unreadable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'recovery_timeline_readable';
  END IF;
  UPDATE platform.recovery_hold
     SET released_at = platform.now(), released_by = session_user, release_note = p_note
   WHERE released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE platform.recovery_guard
     SET expected_timeline = v_timeline, recorded_at = platform.now(), recorded_by = session_user
   WHERE singleton;
  RETURN v_count;
END
$fn$;

COMMENT ON FUNCTION platform.recovery_release(text) IS
  'Lève la garde de reprise (US-402, ADR-206), sous migrator, après le rapprochement avec le PSP.';
REVOKE ALL ON FUNCTION platform.recovery_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.recovery_release(text) TO migrator;

-- 7. Réclamation des tâches : rien tant que la garde est active (corps de 0013 inchangé sinon).
CREATE OR REPLACE FUNCTION core.outbox_claim_jobs(p_limit integer, p_lease interval)
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
  -- US-402 (ADR-206) : base restaurée ou garde posée ⇒ aucune tâche, aucune émission
  IF platform.recovery_hold_active() THEN
    RETURN;
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
