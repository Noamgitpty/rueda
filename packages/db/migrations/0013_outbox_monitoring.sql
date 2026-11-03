-- 0013 — BUS : métriques de l'outbox et des files (âge, profondeur, lettres mortes).
-- US-008 ; 17 §6.3 (« âge maximal de l'outbox non publiée (> 2 min) », alertes), §6.7 (âge de
-- l'outbox p99 < 30 s) ; ADR-050 « Observabilité » ; revue architecture US-008, constat 2.
-- Appliquée sous `migrator`.
--
-- Lecture réservée au travailleur `bus_monitor` (app_worker, contexte WORKER) : il est le seul à
-- voir toutes les files, l'outbox et les lettres mortes ; aucune écriture. La fonction est
-- SECURITY INVOKER : sous un autre contexte, elle ne voit rien et renvoie des zéros (fail-closed).
--
-- Retour arrière :
--   DROP FUNCTION core.outbox_metrics();
--   DROP POLICY worker_select_monitor ON core.outbox_outbox_event, core.outbox_scheduled_job,
--     core.outbox_dead_letter (une instruction par table).

CREATE POLICY worker_select_monitor ON core.outbox_outbox_event FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bus_monitor');
CREATE POLICY worker_select_monitor ON core.outbox_scheduled_job FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bus_monitor');
CREATE POLICY worker_select_monitor ON core.outbox_dead_letter FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bus_monitor');

-- Une ligne par métrique (et par file) ; âges en secondes entières, jamais négatifs.
CREATE FUNCTION core.outbox_metrics()
  RETURNS TABLE (metric text, queue text, value bigint)
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH clock AS (SELECT platform.now() AS t),
  unpublished AS (
    SELECT e.created_at FROM core.outbox_outbox_event e WHERE e.published_at IS NULL
  ),
  jobs AS (
    SELECT j.name, j.state, j.run_at FROM core.outbox_scheduled_job j
  )
  SELECT 'outbox_unpublished', NULL::text, count(*)::bigint FROM unpublished
  UNION ALL
  SELECT 'outbox_oldest_age_s', NULL::text,
         GREATEST(0, COALESCE(floor(extract(epoch FROM (SELECT t FROM clock) - min(u.created_at))), 0))::bigint
    FROM unpublished u
  UNION ALL
  SELECT 'queue_ready', j.name, count(*)::bigint
    FROM jobs j WHERE j.state = 'CREATED' AND j.run_at <= (SELECT t FROM clock) GROUP BY j.name
  UNION ALL
  SELECT 'queue_scheduled', j.name, count(*)::bigint
    FROM jobs j WHERE j.state = 'CREATED' AND j.run_at > (SELECT t FROM clock) GROUP BY j.name
  UNION ALL
  SELECT 'queue_active', j.name, count(*)::bigint
    FROM jobs j WHERE j.state = 'ACTIVE' GROUP BY j.name
  UNION ALL
  SELECT 'queue_failed', j.name, count(*)::bigint
    FROM jobs j WHERE j.state = 'FAILED' GROUP BY j.name
  UNION ALL
  SELECT 'queue_oldest_ready_age_s', j.name,
         GREATEST(0, floor(extract(epoch FROM (SELECT t FROM clock) - min(j.run_at))))::bigint
    FROM jobs j WHERE j.state = 'CREATED' AND j.run_at <= (SELECT t FROM clock) GROUP BY j.name
  UNION ALL
  SELECT 'dead_letter_open', d.consumer, count(*)::bigint
    FROM core.outbox_dead_letter d WHERE d.replayed_at IS NULL GROUP BY d.consumer
$fn$;

COMMENT ON FUNCTION core.outbox_metrics() IS
  'Métriques du bus (17 §6.3) : âge et volume de l''outbox non publiée, profondeur des files, '
  'lettres mortes ouvertes. Lisible par bus_monitor seulement (RLS). US-008, ADR-050.';
REVOKE ALL ON FUNCTION core.outbox_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.outbox_metrics() TO app_worker;
