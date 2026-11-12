-- 9988 — fixtures des preuves de la file d'ajout au catalogue véhicules (US-114, migration 0074). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Relectures (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) des lignes
-- que les rôles applicatifs ne lisent pas : demandes d'ajout, véhicule, élément de file, événements
-- de l'outbox, lignes du catalogue créées par l'ops. Les attendus du test viennent de 19 US-114,
-- 16 ADM-036 / HST-050 et 17 §3.2.3, §4.5, §7.2, jamais de ces relectures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us114_requests(uuid), test_fixture.us114_vehicle(uuid),
--   test_fixture.us114_item(uuid), test_fixture.us114_events(uuid), test_fixture.us114_variant(uuid).

-- Demandes d'un véhicule, de la plus ancienne à la plus récente.
CREATE FUNCTION test_fixture.us114_requests(p_vehicle uuid)
  RETURNS TABLE (id uuid, org_id uuid, country_code text, requested_by uuid, origin text,
                 make_text text, model_text text, year integer, trim_text text, vin_masked text,
                 status text, resolved_variant_id uuid, reject_reason text, reviewed_by uuid,
                 reviewed boolean, review_item_id uuid, sla_minutes double precision)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.id, r.org_id, r.country_code, r.requested_by, r.origin, r.make_text, r.model_text, r.year,
         r.trim_text, r.vin_masked, r.status, r.resolved_variant_id, r.reject_reason, r.reviewed_by,
         r.reviewed_at IS NOT NULL,
         r.review_item_id, (EXTRACT(EPOCH FROM (r.sla_due_at - r.created_at)) / 60)::double precision
    FROM core.catalog_addition_request AS r
   WHERE r.vehicle_id = p_vehicle
   ORDER BY r.created_at, r.id
$fn$;

-- Rattachement du véhicule au catalogue.
CREATE FUNCTION test_fixture.us114_vehicle(p_vehicle uuid)
  RETURNS TABLE (variant_id uuid, make_text text, model_text text, value_class text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.variant_id, v.make_text, v.model_text, v.value_class
    FROM core.catalog_vehicle AS v WHERE v.id = p_vehicle
$fn$;

-- Élément de file (délai posé par la base, en minutes).
CREATE FUNCTION test_fixture.us114_item(p_item uuid)
  RETURNS TABLE (queue text, subject_type text, subject_id uuid, country_code text, status text,
                 decision text, assignee_id uuid, sla_minutes double precision)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.decision,
         i.assignee_id, (EXTRACT(EPOCH FROM (i.sla_due_at - i.created_at)) / 60)::double precision
    FROM core.support_review_queue_item AS i WHERE i.id = p_item
$fn$;

-- Événements de l'outbox d'une demande.
CREATE FUNCTION test_fixture.us114_events(p_request uuid)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_user_id uuid,
                 actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_user_id, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_request
   ORDER BY e.id
$fn$;

-- Variante du catalogue, son modèle et sa marque, avec leur provenance.
CREATE FUNCTION test_fixture.us114_variant(p_variant uuid)
  RETURNS TABLE (make_slug text, make_source text, model_slug text, model_source text,
                 year_from integer, year_to integer, transmission text, fuel_type text, drive text,
                 seats smallint, market text, status text, source text, license_note text,
                 verified_by uuid, verified boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.slug, m.source, o.slug, o.source, v.year_from, v.year_to, v.transmission, v.fuel_type,
         v.drive, v.seats, v.market::text, v.status, v.source, v.license_note, v.verified_by,
         v.verified_at IS NOT NULL
    FROM core.catalog_vehicle_variant AS v
    JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
    JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
   WHERE v.id = p_variant
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us114_requests(uuid), test_fixture.us114_vehicle(uuid),
  test_fixture.us114_item(uuid), test_fixture.us114_events(uuid), test_fixture.us114_variant(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us114_requests(uuid), test_fixture.us114_vehicle(uuid),
  test_fixture.us114_item(uuid), test_fixture.us114_events(uuid), test_fixture.us114_variant(uuid)
  TO app_api;
