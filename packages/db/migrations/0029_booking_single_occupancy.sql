-- 0029 — AVL : table d'occupation unique, blocages de l'hôte et tampons autonomes.
-- US-022 ; 16 CAL-011, CAL-004 ; 08 BR-BOOK-05, BR-BOOK-07, BR-BOOK-10 ; 17 §2.3 (droits
-- d'écriture, rôles d'exécution des commandes, RLS-15), §2.5 (sources de vérité, ordre global des
-- verrous, « Blocages iCal » : blocage manuel chevauchant un trip refusé), §3.2.4 ; ADR-048,
-- ADR-053, ADR-056 ; ADR-060. Appliquée sous `migrator`.
--
-- La table `core.booking_vehicle_occupancy` (0004) reste la SEULE source de vérité de la
-- disponibilité d'un véhicule, tous canaux confondus (HOLD de checkout, TRIP, HOST_BLOCK, BUFFER) :
-- une seule contrainte d'exclusion GiST WHERE (active), un verrou consultatif par véhicule pour
-- tout écrivain (17 §2.5 M2). Cette migration :
--   1. rattache chaque occupation au compte d'hôte et au pays du véhicule (`org_id`,
--      `country_code`, clé composée vers iam_organization) et interdit qu'un même véhicule porte
--      des occupations de deux comptes d'hôte (exclusion `occupancy_vehicle_single_org`, PROPOSÉ en
--      attendant la clé étrangère vers catalog_vehicle) ; un hold et son occupation désignent le
--      même véhicule, le même compte et le même pays (clé composée) ;
--   2. fonctions de période : `core.booking_occupied_period` (tampon matérialisé [début, fin +
--      tampon), BR-BOOK-05) et `core.booking_buffer_minutes` (paramètre `buffer_minutes` du pays) ;
--   3. commandes SECURITY DEFINER sous `cmd_hold_owner` (propriétaire NOLOGIN dédié, jamais
--      migrator ; liste blanche RLS-15) :
--        - core.booking_cmd_place_host_block(vehicle, début, fin) et
--          core.booking_cmd_remove_host_block(blocage) : hôte titulaire ou co-hôte de portée,
--          EXECUTE au seul app_api ;
--        - core.booking_cmd_place_buffer(trip, début) : tampon autonome après un trip rendu,
--          travailleur `trip_lifecycle`, EXECUTE au seul app_worker ;
--   4. lectures d'app_api par colonnes : calendrier de l'hôte (son compte, sa portée de véhicules)
--      et ADMIN du pays ; aucun identifiant du personnel, ni ref_type / ref_id, ni ical_uid.
--
-- Tables vides en production à ce stade (aucun écrivain hors tests) : les colonnes NOT NULL sans
-- défaut et les contraintes sont validées immédiatement.
--
-- Retour arrière (tables vides) :
--   DROP FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz),
--     core.booking_cmd_remove_host_block(uuid), core.booking_cmd_place_buffer(uuid, timestamptz),
--     core.booking_occupied_period(timestamptz, timestamptz, integer),
--     core.booking_buffer_minutes(text);
--   DROP POLICY occupancy_host_read, occupancy_staff_read, cmd_occ_sel, cmd_block_ins,
--     cmd_block_upd, cmd_buffer_ins ON core.booking_vehicle_occupancy;
--   DROP POLICY cmd_hold_read ON core.iam_organization, core.booking_trip, core.config_param_value;
--   REVOKE ALL ON core.booking_vehicle_occupancy, core.iam_organization, core.booking_trip,
--     core.config_param_value FROM cmd_hold_owner;  REVOKE SELECT ON core.booking_vehicle_occupancy
--     FROM app_api;  REVOKE USAGE ON SCHEMA core FROM cmd_hold_owner;
--   REVOKE EXECUTE ON FUNCTION app.actor_id(), app.org_id(), app.vehicle_scope() FROM cmd_hold_owner;
--   SET ROLE policy_fn_owner; REVOKE EXECUTE ON FUNCTION app.host_covers_vehicle(uuid)
--     FROM cmd_hold_owner; RESET ROLE;
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT checkout_hold_occupancy_party_fk;
--   ALTER TABLE core.booking_vehicle_occupancy DROP CONSTRAINT occupancy_party_unique,
--     DROP CONSTRAINT occupancy_vehicle_single_org, DROP CONSTRAINT occupancy_org_country_fk,
--     DROP CONSTRAINT occupancy_country_code_format, DROP COLUMN org_id, DROP COLUMN country_code;
--   DROP INDEX core.occupancy_org_vehicle_idx;

-- 1. Compte d'hôte et pays de l'occupation ------------------------------------------------------
ALTER TABLE core.booking_vehicle_occupancy
  ADD COLUMN org_id       uuid NOT NULL,
  ADD COLUMN country_code text NOT NULL
    CONSTRAINT occupancy_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- un compte d'hôte est mono-pays (17 §2.3) : l'occupation porte le pays de son hôte, sur lequel
  -- portent les politiques du staff (portée par pays, RLS-20)
  ADD CONSTRAINT occupancy_org_country_fk
    FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization (id, country_code),
  -- un véhicule appartient à un seul compte d'hôte : toutes ses occupations (actives ou non)
  -- portent le même org_id. PROPOSÉ (ADR-060) : remplacé par la clé étrangère
  -- (vehicle_id, org_id, country_code) vers catalog_vehicle quand le catalogue existe.
  -- cible de la clé composée du hold (véhicule, compte et pays de l'occupation = ceux du hold)
  ADD CONSTRAINT occupancy_party_unique UNIQUE (id, vehicle_id, org_id, country_code);


-- politique de l'hôte (org_id = app.org_id()) et contrôles de suppression côté IAM
CREATE INDEX occupancy_org_vehicle_idx ON core.booking_vehicle_occupancy (org_id, vehicle_id);

COMMENT ON COLUMN core.booking_vehicle_occupancy.org_id IS
  'Compte d''hôte du véhicule (US-022) ; jamais choisi par le client : app.org_id() vérifié '
  '(blocage), hold ou trip (HOLD, TRIP, BUFFER).';

-- 2. Période occupée et tampon (BR-BOOK-05, CAL-004) ------------------------------------------
-- Tampon matérialisé : [début, fin + tampon), semi-ouvert (17 §2.5 « Sources de vérité »). Un
-- retour à 12:00 avec un tampon de 120 min occupe jusqu'à 14:00 exclu : un départ à 14:00 est
-- libre, à 13:00 il ne l'est pas. Tampon négatif ou fin non postérieure au début : erreur.
CREATE FUNCTION core.booking_occupied_period(
  p_start          timestamptz,
  p_end            timestamptz,
  p_buffer_minutes integer
)
  RETURNS tstzrange
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_buffer_minutes < 0 OR p_end <= p_start THEN
    RAISE EXCEPTION 'occupied period: invalid bounds'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  RETURN pg_catalog.tstzrange(p_start, p_end + pg_catalog.make_interval(mins => p_buffer_minutes),
                              '[)');
END
$fn$;

-- Tampon du pays (`buffer_minutes`, 17 §7.2, défaut PROPOSÉ 120 ; l'annonce pourra porter sa
-- propre valeur avec le catalogue). Valeur en vigueur à platform.now() ; absente ou mal formée
-- => NULL, et l'appelant refuse (fail_mode BLOCK de la définition, 17 §7.1 point 7).
-- SECURITY INVOKER : lit config_param_value sous la RLS de l'appelant.
CREATE FUNCTION core.booking_buffer_minutes(p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,5}$'
              THEN (v.value #>> '{}')::integer END
    FROM core.config_param_value v CROSS JOIN t
   WHERE v.key = 'buffer_minutes'
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

COMMENT ON FUNCTION core.booking_occupied_period(timestamptz, timestamptz, integer) IS
  'Période occupée [début, fin + tampon) (BR-BOOK-05, 17 §2.5). US-022.';
COMMENT ON FUNCTION core.booking_buffer_minutes(text) IS
  'Paramètre buffer_minutes du pays en vigueur à platform.now() ; NULL si absent. US-022.';

REVOKE ALL ON FUNCTION core.booking_occupied_period(timestamptz, timestamptz, integer),
  core.booking_buffer_minutes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_occupied_period(timestamptz, timestamptz, integer),
  core.booking_buffer_minutes(text) TO app_api, app_worker, cmd_hold_owner;

-- 3. Droits de cmd_hold_owner (au plus juste, colonne par colonne) ------------------------------
GRANT USAGE ON SCHEMA core TO cmd_hold_owner;
-- contexte de session et portée de l'hôte (les politiques et les commandes sont évaluées sous le
-- propriétaire)
GRANT EXECUTE ON FUNCTION app.actor_id(), app.org_id(), app.vehicle_scope() TO cmd_hold_owner;
-- app.host_covers_vehicle appartient à policy_fn_owner (0024) : seul son propriétaire peut en
-- accorder l'exécution. migrator l'endosse le temps de l'octroi (SET TRUE, INHERIT FALSE : ADR-044
-- amendé), sans hériter d'aucun de ses droits ; la liste blanche RLS-15 inscrit cmd_hold_owner.
SET LOCAL ROLE policy_fn_owner;
GRANT EXECUTE ON FUNCTION app.host_covers_vehicle(uuid) TO cmd_hold_owner;
RESET ROLE;

-- colonnes lues par les commandes et par leurs politiques (aucune colonne d'audit ni période)
GRANT SELECT (id, vehicle_id, org_id, country_code, kind, source, active, expires_at,
              deactivated_reason, ref_type, ref_id)
  ON core.booking_vehicle_occupancy TO cmd_hold_owner;
GRANT INSERT (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
              ref_type, ref_id, created_by)
  ON core.booking_vehicle_occupancy TO cmd_hold_owner;
GRANT UPDATE (active, deactivated_reason, updated_by)
  ON core.booking_vehicle_occupancy TO cmd_hold_owner;
-- pays du compte d'hôte de la session (blocage) ; trip d'un tampon autonome
GRANT SELECT (id, country_code) ON core.iam_organization TO cmd_hold_owner;
GRANT SELECT (id, status, vehicle_id, org_id, country_code, scheduled_start)
  ON core.booking_trip TO cmd_hold_owner;
-- tampon du pays seulement (US-023 élargira la liste des clés lues par ses commandes)
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO cmd_hold_owner;

-- Politiques par commande SQL (aucune politique DELETE, aucun droit DELETE). Les commandes
-- relisent les occupations d'un véhicule de tous les comptes (contrôle du compte unique) : lecture
-- sans filtre, comme cmd_occ_sel de 17 §2.3, sur les seules colonnes accordées ci-dessus.
CREATE POLICY cmd_occ_sel ON core.booking_vehicle_occupancy FOR SELECT TO cmd_hold_owner
  USING (true);
-- blocage manuel : hôte de la session, sur son compte, sans TTL ni référence
CREATE POLICY cmd_block_ins ON core.booking_vehicle_occupancy FOR INSERT TO cmd_hold_owner
  WITH CHECK (kind = 'HOST_BLOCK' AND source = 'MANUAL' AND active AND expires_at IS NULL
              AND ref_type IS NULL AND ref_id IS NULL
              AND app.actor_kind() = 'HOST' AND org_id = app.org_id());
-- levée d'un blocage manuel de son compte : désactivation seulement (BLOCK_REMOVED)
CREATE POLICY cmd_block_upd ON core.booking_vehicle_occupancy FOR UPDATE TO cmd_hold_owner
  USING (kind = 'HOST_BLOCK' AND source = 'MANUAL' AND active
         AND app.actor_kind() = 'HOST' AND org_id = app.org_id())
  WITH CHECK (kind = 'HOST_BLOCK' AND source = 'MANUAL' AND NOT active
              AND deactivated_reason = 'BLOCK_REMOVED'
              AND app.actor_kind() = 'HOST' AND org_id = app.org_id());
-- tampon autonome : travailleur trip_lifecycle, rattaché à un trip, sans TTL
CREATE POLICY cmd_buffer_ins ON core.booking_vehicle_occupancy FOR INSERT TO cmd_hold_owner
  WITH CHECK (kind = 'BUFFER' AND source = 'SYSTEM' AND active AND expires_at IS NULL
              AND ref_type = 'TRIP' AND ref_id IS NOT NULL
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');

CREATE POLICY cmd_hold_read ON core.iam_organization FOR SELECT TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_read ON core.booking_trip FOR SELECT TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key = 'buffer_minutes');

-- 4. Commandes (17 §2.3 : SECURITY DEFINER, search_path figé, aucun identifiant de personne en
-- paramètre ; org_id, pays, kind, source et période calculés dans la fonction) -----------------
--
-- Erreurs : (SQLSTATE, contrainte) traduits par packages/db/src/errors.ts, sans DETAIL :
--   occupancy_host_forbidden (42501)     → FORBIDDEN (contexte, portée, compte ou pays : même
--                                           réponse, rien n'est révélé sur le véhicule d'un tiers) ;
--   occupancy_vehicle_single_org (23P01) → FORBIDDEN (filet structurel du même contrôle) ;
--   vehicle_occupancy_no_overlap (23P01) → VEHICLE_UNAVAILABLE (créneau pris, quel qu'en soit le
--                                           canal : trip, hold, blocage, tampon) ;
--   occupancy_period_invalid (23514)     → INVALID_PERIOD (PROPOSÉ) ;
--   occupancy_buffer_trip_state (55000)  → INVALID_TRANSITION ;
--   occupancy_buffer_param_missing (55000) → PARAM_MISSING.
-- Forme d'appel (ADR-056 point 4) : un appel = une instruction, dans une transaction courte.

-- 4.1 Blocage manuel (BR-BOOK-07, CAL-011 : refusé s'il chevauche un trip confirmé, un hold, un
-- autre blocage ou un tampon). Verrou du véhicule seulement (aucun guest touché, 17 §2.5 M2).
CREATE FUNCTION core.booking_cmd_place_host_block(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor   uuid := app.actor_id();
  v_org     uuid := app.org_id();
  v_country text;
  v_id      uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOST' OR v_actor IS NULL OR v_org IS NULL
     OR p_vehicle_id IS NULL OR NOT app.host_covers_vehicle(p_vehicle_id) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  SELECT o.country_code INTO v_country FROM core.iam_organization o WHERE o.id = v_org;
  IF v_country IS NULL THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start OR p_end <= platform.now() THEN
    RAISE EXCEPTION 'host block: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- véhicule d'un autre compte d'hôte (ou du même titulaire dans un autre pays) : même réponse
  -- que hors portée ; l'exclusion occupancy_vehicle_single_org reste le filet structurel
  IF EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy vo
              WHERE vo.vehicle_id = p_vehicle_id AND vo.org_id <> v_org) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;

  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, created_by)
  VALUES (v_id, p_vehicle_id, v_org, v_country, 'HOST_BLOCK', 'MANUAL',
          pg_catalog.tstzrange(p_start, p_end, '[)'), true, v_actor);
  RETURN v_id;
END
$fn$;

-- 4.2 Levée d'un blocage manuel. Blocage inconnu, d'un autre compte, hors portée, importé (ICAL)
-- ou d'un autre type : FORBIDDEN, sans distinguer les cas. Blocage de son compte déjà levé :
-- false (rejeu idempotent).
CREATE FUNCTION core.booking_cmd_remove_host_block(p_block_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor uuid := app.actor_id();
  v_org   uuid := app.org_id();
  b       record;
  n       integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOST' OR v_actor IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  SELECT vo.vehicle_id, vo.org_id, vo.kind, vo.source
    INTO b
    FROM core.booking_vehicle_occupancy vo
   WHERE vo.id = p_block_id;
  IF NOT FOUND OR b.kind <> 'HOST_BLOCK' OR b.source <> 'MANUAL' OR b.org_id <> v_org
     OR NOT app.host_covers_vehicle(b.vehicle_id) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;

  -- vehicle_id n'est modifiable par personne : le verrou pris est bien celui du véhicule du blocage
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || b.vehicle_id::text, 0));
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'BLOCK_REMOVED', updated_by = v_actor
   WHERE id = p_block_id AND active;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$fn$;

-- 4.3 Tampon autonome (17 §2.5 : « maintenance planifiée après un trip terminé tôt » ; CAL-004,
-- CAL-011 « trip terminé tôt → tampon recalculé »). Après le retour du véhicule, le travailleur
-- trip_lifecycle pose [p_start, p_start + buffer_minutes du pays), rattaché au trip ; jamais par
-- la conversion d'un hold (17 annexe A6). Le trip doit avoir rendu le véhicule (RETURNED,
-- TERMINATED_EARLY, POST_TRIP, COMPLETED : lecture de SM-1, PROPOSÉ) et p_start ne précède pas
-- son début prévu.
CREATE FUNCTION core.booking_cmd_place_buffer(p_trip_id uuid, p_start timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t         record;
  v_minutes integer;
  v_id      uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'buffer: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  SELECT tr.status, tr.vehicle_id, tr.org_id, tr.country_code, tr.scheduled_start
    INTO t
    FROM core.booking_trip tr
   WHERE tr.id = p_trip_id;
  IF NOT FOUND OR t.status NOT IN ('RETURNED', 'TERMINATED_EARLY', 'POST_TRIP', 'COMPLETED') THEN
    RAISE EXCEPTION 'buffer: trip has not returned the vehicle'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'occupancy_buffer_trip_state';
  END IF;
  IF p_start IS NULL OR p_start < t.scheduled_start THEN
    RAISE EXCEPTION 'buffer: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  v_minutes := core.booking_buffer_minutes(t.country_code);
  IF v_minutes IS NULL THEN
    RAISE EXCEPTION 'buffer: parameter buffer_minutes missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'occupancy_buffer_param_missing';
  END IF;
  IF v_minutes = 0 THEN
    RETURN NULL;                       -- aucun tampon dans ce pays : rien à poser
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || t.vehicle_id::text, 0));
  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau déjà repris (le travailleur alerte
  -- l'hôte, EC-19 ; le trip suivant n'est jamais déplacé)
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, ref_type, ref_id)
  VALUES (v_id, t.vehicle_id, t.org_id, t.country_code, 'BUFFER', 'SYSTEM',
          pg_catalog.tstzrange(p_start, p_start + pg_catalog.make_interval(mins => v_minutes), '[)'),
          true, 'TRIP', p_trip_id);
  RETURN v_id;
END
$fn$;

COMMENT ON FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz) IS
  'Commande : blocage manuel de l''hôte (BR-BOOK-07, CAL-011), verrou du véhicule. US-022.';
COMMENT ON FUNCTION core.booking_cmd_remove_host_block(uuid) IS
  'Commande : levée d''un blocage manuel de son compte (BLOCK_REMOVED). US-022.';
COMMENT ON FUNCTION core.booking_cmd_place_buffer(uuid, timestamptz) IS
  'Commande : tampon autonome après un trip rendu (CAL-004), travailleur trip_lifecycle. US-022.';

REVOKE ALL ON FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz),
  core.booking_cmd_remove_host_block(uuid), core.booking_cmd_place_buffer(uuid, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz),
  core.booking_cmd_remove_host_block(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.booking_cmd_place_buffer(uuid, timestamptz) TO app_worker;

-- Transfert au propriétaire dédié (ADR-053, amendement d'ADR-044) : CREATE le temps du transfert.
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_remove_host_block(uuid) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_place_buffer(uuid, timestamptz) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 5. Lectures d'app_api, par colonnes (US-011, MAJEUR 1) ----------------------------------------
-- Calendrier de l'hôte : occupations de son compte, réduites à sa portée de véhicules (titulaire :
-- tous ; co-hôte : vehicle_scope), sans donnée du voyageur (ni ref_type / ref_id d'un hold, 17 §2.5
-- « Visibilité hôte », NOUVELLE-16) ; ADMIN du pays (portée par pays, RLS-20). Le voyageur ne lit
-- pas cette table : la disponibilité lui est donnée par la sonde catalog.vehicle_is_free (US-201).
GRANT SELECT (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
              deactivated_reason, created_at, updated_at)
  ON core.booking_vehicle_occupancy TO app_api;
CREATE POLICY occupancy_host_read ON core.booking_vehicle_occupancy FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id()
         AND app.host_covers_vehicle(vehicle_id));
CREATE POLICY occupancy_staff_read ON core.booking_vehicle_occupancy FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND app.has_staff_role('ADMIN', country_code));
