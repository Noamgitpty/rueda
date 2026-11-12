-- 0074 — CAT : file d'ajout au catalogue véhicules (demande de l'hôte, file de l'ops, rattachement de la variante).
-- US-114 ; 19 US-114 ; 16 ADM-036 (« Données : catalog_addition_request ; review_queue_item de type
-- CATALOG_ADDITION » ; « refus motivé → le véhicule reste en brouillon, non publiable »), HST-050
-- (« modèle absent → Autre … → demande d'ajout, véhicule en brouillon et non publiable ») ;
-- 17 §3.2.3 (`catalog_addition_request`), §4.5 (`catalog.addition_request.resolved`), §7.2
-- (`catalog_addition_sla_business_h` = 24) ; 22 OQ-CAT-01 (g) ; ADR-034, ADR-094, ADR-097 (files de
-- revue, réutilisées), ADR-099 ; ADR-104 (cette migration). Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-104, PROPOSÉ) :
--   - une demande par véhicule hors catalogue : la création d'un véhicule SANS variante (repli
--     texte make_text / model_text) ouvre, DANS LA MÊME INSTRUCTION, une demande `OPEN` et son
--     élément de la file CATALOG_ADDITION (mécanisme d'US-109 : `core.support_enqueue_review`,
--     échéance posée par la base depuis `catalog_addition_sla_business_h` du pays ; file
--     indisponible : rien n'est créé, l'erreur est levée) ; 19 US-114 critère 1 ;
--   - un véhicule sans variante n'est jamais publiable : la soumission de son annonce rend
--     CATALOG_ADDITION_PENDING et l'annonce reste DRAFT (après la complétude des photos, avant les
--     CGU et l'activation) ;
--   - après un refus, l'hôte corrige marque et modèle et redemande (`catalog_cmd_request_addition`) ;
--     une demande OPEN par véhicule (index unique partiel) : CATALOG_REQUEST_DUPLICATE (16 ADM-036) ;
--   - l'ops (permission de la file, `ops.review_listing_host`, dans le pays de l'élément ; élément
--     pris en charge par lui, ADMIN : sa portée ; TOTP) lit la demande et tranche par la console :
--     MERGE (variante ACTIVE existante du marché et de l'année du véhicule), APPROVE (marque,
--     modèle reprises si leur slug existe, variante créée : source HOST_REQUEST, licence saisie par
--     l'ops, vérifiée par lui, marché = pays de la demande) ou REJECT (motif d'une liste fermée) ;
--     19 US-114 critère 2 ;
--   - à l'approbation ou au rapprochement, le véhicule reçoit `variant_id` (son repli texte est
--     effacé, la demande le garde) ; l'élément de file est clos (DONE, décision APPROVED / MERGED /
--     REJECTED) ; l'événement `catalog.addition_request.resolved` part par l'outbox vers NTF, qui
--     notifie l'hôte demandeur (`host_user_id`) ; la décision est au journal chaîné ;
--   - commandes de l'hôte : catalog_cmd_owner (hôte de la session, compte titulaire, pays du
--     compte) ; commandes de la console : iam_staff_owner, qui appelle les fonctions de domaine du
--     catalogue (catalog_cmd_owner, EXECUTE à iam_staff_owner seul) : le staff n'a aucun droit sur
--     les tables du catalogue (cadre d'ADR-092 : la console vérifie, le domaine agit) ;
--   - table de classe D (aucune suppression), RLS ENABLE + FORCE, aucun droit applicatif.
--
-- Défauts PROPOSÉS (fail-closed, ADR-104) : motifs de refus INSUFFICIENT_DETAILS, UNKNOWN_MODEL,
-- NOT_ELIGIBLE ; VIN masqué = 11 premiers caractères d'un VIN de 17 (constructeur, modèle, année,
-- usine), numéro de série caché ; licence saisie par l'ops de 10 à 500 caractères ; 30 variantes
-- proposées au rapprochement ; une variante créée vaut pour le seul pays de la demande.
--
-- Expand / contract : table, index, fonctions et politiques ajoutés ; droits ajoutés aux
-- propriétaires NOLOGIN ; corps de `core.catalog_cmd_create_vehicle` (0067) et de
-- `core.catalog_cmd_submit_listing` (0070) remplacés à signature, propriétaire et droits
-- identiques. Le COMPORTEMENT se resserre, volontairement : aucune annonce n'a pu être soumise en
-- production (`p2p_private_hosts_enabled` vaut false partout). Aucun véhicule n'existe en
-- production : aucune demande à reprendre (un véhicule sans variante et sans demande pourra en
-- ouvrir une par `catalog_cmd_request_addition`).
--
-- Retour arrière :
--   réappliquer core.catalog_cmd_create_vehicle de 0067 et core.catalog_cmd_submit_listing de
--     0070 (sous catalog_cmd_owner) ;
--   DROP FUNCTION core.support_staff_catalog_addition(bytea, uuid, uuid),
--     core.support_staff_resolve_catalog_addition(bytea, uuid, uuid, text, uuid, jsonb, text),
--     core.catalog_addition_detail(uuid, text),
--     core.catalog_resolve_addition(uuid, text, uuid, text, text, uuid, jsonb, text, uuid),
--     core.catalog_cmd_request_addition(bytea, uuid, uuid, text, text, text),
--     core.catalog_host_addition_requests(bytea, uuid),
--     core.catalog_addition_open(uuid, text, uuid, uuid, text, text, integer, text, text),
--     core.catalog_slug(text) ;
--   DROP TABLE core.catalog_addition_request ;
--   DROP POLICY catalog_addition_insert ON core.catalog_vehicle_make, core.catalog_vehicle_model,
--     core.catalog_vehicle_variant ; DROP POLICY catalog_cmd_read ON
--     core.support_review_queue_item ; DROP POLICY catalog_cmd_event_insert ON
--     core.outbox_outbox_event ; révoquer les droits accordés ci-dessous.

-- 1. Table (17 §3.2.3 catalog_addition_request ; classe D) ---------------------------------------
CREATE TABLE core.catalog_addition_request (
  id                  uuid        PRIMARY KEY,
  org_id              uuid        NOT NULL,
  country_code        text        NOT NULL
                      CONSTRAINT catalog_addition_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- véhicule en attente (17 : « le vehicle en attente reçoit variant_id ») ; même compte, même pays
  vehicle_id          uuid        NOT NULL,
  requested_by        uuid        NOT NULL REFERENCES core.iam_user_account (id),
  origin              text        NOT NULL DEFAULT 'WIZARD_OTHER'
                      CONSTRAINT catalog_addition_origin_valid CHECK (origin IN ('WIZARD_OTHER', 'OPS')),
  make_text           text        NOT NULL
                      CONSTRAINT catalog_addition_make_valid
                      CHECK (pg_catalog.btrim(make_text) <> '' AND pg_catalog.char_length(make_text) <= 80),
  model_text          text        NOT NULL
                      CONSTRAINT catalog_addition_model_valid
                      CHECK (pg_catalog.btrim(model_text) <> '' AND pg_catalog.char_length(model_text) <= 80),
  year                integer     NOT NULL
                      CONSTRAINT catalog_addition_year_range CHECK (year BETWEEN 1950 AND 2100),
  trim_text           text
                      CONSTRAINT catalog_addition_trim_valid
                      CHECK (trim_text IS NULL OR (pg_catalog.btrim(trim_text) <> ''
                                                   AND pg_catalog.char_length(trim_text) <= 80)),
  -- constructeur, modèle, année et usine seulement (numéro de série caché), PROPOSÉ
  vin_masked          text
                      CONSTRAINT catalog_addition_vin_masked_format
                      CHECK (vin_masked ~ '^[A-HJ-NPR-Z0-9]{11}\*{6}$'),
  status              text        NOT NULL DEFAULT 'OPEN'
                      CONSTRAINT catalog_addition_status_valid
                      CHECK (status IN ('OPEN', 'APPROVED', 'MERGED', 'REJECTED')),
  resolved_variant_id uuid        REFERENCES core.catalog_vehicle_variant (id),
  reject_reason       text
                      CONSTRAINT catalog_addition_reject_reason_valid
                      CHECK (reject_reason IN ('INSUFFICIENT_DETAILS', 'UNKNOWN_MODEL', 'NOT_ELIGIBLE')),
  reviewed_by         uuid        REFERENCES core.iam_user_account (id),
  reviewed_at         timestamptz,
  review_item_id      uuid        REFERENCES core.support_review_queue_item (id),
  sla_due_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_addition_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
    REFERENCES core.catalog_vehicle (id, org_id, country_code),
  CONSTRAINT catalog_addition_reviewed CHECK (
    (status = 'OPEN') = (reviewed_by IS NULL) AND (reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT catalog_addition_variant CHECK (
    (status IN ('APPROVED', 'MERGED')) = (resolved_variant_id IS NOT NULL)),
  CONSTRAINT catalog_addition_rejected CHECK ((status = 'REJECTED') = (reject_reason IS NOT NULL))
);
-- une demande ouverte par véhicule (16 ADM-036 CATALOG_REQUEST_DUPLICATE)
CREATE UNIQUE INDEX catalog_addition_vehicle_open_unique ON core.catalog_addition_request (vehicle_id)
  WHERE status = 'OPEN';
CREATE INDEX catalog_addition_org_idx ON core.catalog_addition_request (org_id, vehicle_id, created_at);
CREATE TRIGGER catalog_addition_no_delete
  BEFORE DELETE ON core.catalog_addition_request
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_addition_no_truncate
  BEFORE TRUNCATE ON core.catalog_addition_request
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();
ALTER TABLE core.catalog_addition_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_addition_request FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_addition_request TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_addition_request FROM PUBLIC;
COMMENT ON TABLE core.catalog_addition_request IS
  'CAT catalog_addition_request (17 §3.2.3, 16 ADM-036) : demande d''ajout au catalogue d''un '
  'véhicule hors catalogue ; élément de la file CATALOG_ADDITION ; à l''approbation, le véhicule '
  'reçoit variant_id. Aucun droit applicatif ; jamais supprimée. US-114 (ADR-104).';

-- 2. Droits de catalog_cmd_owner (commandes de l'hôte et fonctions de domaine) --------------------
GRANT SELECT, INSERT ON core.catalog_addition_request TO catalog_cmd_owner;
GRANT UPDATE (status, resolved_variant_id, reject_reason, reviewed_by, reviewed_at)
  ON core.catalog_addition_request TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_addition_request TO catalog_cmd_owner
  USING (true) WITH CHECK (true);

-- rattachement de la variante (repli texte effacé) et nouvelle saisie après un refus
GRANT UPDATE (variant_id, make_text, model_text, trim_override, value_class)
  ON core.catalog_vehicle TO catalog_cmd_owner;

-- échéance de l'élément de file, recopiée sur la demande (file CATALOG_ADDITION seulement)
GRANT SELECT (id, queue, sla_due_at) ON core.support_review_queue_item TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.support_review_queue_item FOR SELECT TO catalog_cmd_owner
  USING (queue = 'CATALOG_ADDITION');

-- catalogue : rapprochement (lecture) et ajout validé par l'ops (source HOST_REQUEST, ACTIVE)
GRANT SELECT (slug, aliases) ON core.catalog_vehicle_make TO catalog_cmd_owner;
GRANT INSERT (id, slug, name, status, source, source_ref, license_note)
  ON core.catalog_vehicle_make TO catalog_cmd_owner;
CREATE POLICY catalog_addition_insert ON core.catalog_vehicle_make FOR INSERT TO catalog_cmd_owner
  WITH CHECK (source = 'HOST_REQUEST' AND status = 'ACTIVE');
GRANT SELECT (slug, body_type) ON core.catalog_vehicle_model TO catalog_cmd_owner;
GRANT INSERT (id, make_id, slug, name, body_type, seats_default, doors_default, status, source,
              source_ref, license_note)
  ON core.catalog_vehicle_model TO catalog_cmd_owner;
CREATE POLICY catalog_addition_insert ON core.catalog_vehicle_model FOR INSERT TO catalog_cmd_owner
  WITH CHECK (source = 'HOST_REQUEST' AND status = 'ACTIVE');
GRANT SELECT (trim_name, transmission, fuel_type, drive, seats, doors)
  ON core.catalog_vehicle_variant TO catalog_cmd_owner;
GRANT INSERT (id, model_id, year_from, year_to, trim_name, transmission, fuel_type, drive, seats,
              doors, value_class, market, status, source, source_ref, license_note, verified_by,
              verified_at)
  ON core.catalog_vehicle_variant TO catalog_cmd_owner;
CREATE POLICY catalog_addition_insert ON core.catalog_vehicle_variant FOR INSERT TO catalog_cmd_owner
  WITH CHECK (source = 'HOST_REQUEST' AND status = 'ACTIVE' AND market IS NOT NULL
              AND verified_by IS NOT NULL AND verified_at IS NOT NULL);

-- événement catalog.addition_request.resolved (17 §4.5) : identifiant et heures posés par la base
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO catalog_cmd_owner;
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_event_insert ON core.outbox_outbox_event FOR INSERT TO catalog_cmd_owner
  WITH CHECK (type = 'catalog.addition_request.resolved'
              AND aggregate_type = 'catalog_addition_request'
              AND actor_role IN ('OPS_AGENT', 'ADMIN') AND actor_user_id IS NOT NULL);

-- mise en file par le mécanisme d'US-109 (fonctions d'iam_staff_owner : seul leur propriétaire
-- accorde EXECUTE ; revue architecture US-109, n° 1)
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid)
  TO catalog_cmd_owner;
RESET ROLE;

-- 3. Aides (propriétaire migrator, SECURITY INVOKER, EXECUTE à catalog_cmd_owner) ----------------
-- Slug d'un nom (minuscules, accents retirés, séparateurs en tirets) ; NULL si rien ne reste.
CREATE FUNCTION core.catalog_slug(p_name text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.translate(pg_catalog.lower(p_name),
                                'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', '-', 'g'), '-'), '')
$fn$;

-- Ouverture d'une demande pour un véhicule du compte (appelée par les commandes de l'hôte, sous
-- catalog_cmd_owner) : ligne OPEN, élément de la file CATALOG_ADDITION (échéance de la base),
-- échéance recopiée. File indisponible (paramètre absent, pays discordant) : erreur, rien n'est
-- écrit (fail-closed : jamais un véhicule hors catalogue sans demande). Rend l'id de la demande.
CREATE FUNCTION core.catalog_addition_open(p_org uuid, p_country text, p_vehicle uuid, p_user uuid,
                                           p_make text, p_model text, p_year integer,
                                           p_trim text, p_vin text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id   uuid := pg_catalog.gen_random_uuid();
  v_item record;
  v_due  timestamptz;
BEGIN
  SELECT * INTO v_item
    FROM core.support_enqueue_review('CATALOG_ADDITION', 'CATALOG_ADDITION_REQUEST', v_id, p_country,
                                     p_user);
  IF v_item.outcome IS DISTINCT FROM 'CREATED' THEN
    RAISE EXCEPTION 'file d''ajout au catalogue indisponible (%)', COALESCE(v_item.outcome, 'NULL')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT i.sla_due_at INTO v_due
    FROM core.support_review_queue_item AS i WHERE i.id = v_item.item_id;
  INSERT INTO core.catalog_addition_request (id, org_id, country_code, vehicle_id, requested_by,
                                             origin, make_text, model_text, year, trim_text,
                                             vin_masked, review_item_id, sla_due_at)
  VALUES (v_id, p_org, p_country, p_vehicle, p_user, 'WIZARD_OTHER', pg_catalog.btrim(p_make),
          pg_catalog.btrim(p_model), p_year, NULLIF(pg_catalog.btrim(p_trim), ''),
          CASE WHEN p_vin ~ '^[A-HJ-NPR-Z0-9]{17}$' THEN pg_catalog.left(p_vin, 11) || '******' END,
          v_item.item_id, v_due);
  RETURN v_id;
END
$fn$;

COMMENT ON FUNCTION core.catalog_slug(text) IS
  'Slug d''un nom de marque ou de modèle (minuscules, sans accent, tirets). US-114.';
COMMENT ON FUNCTION core.catalog_addition_open(uuid, text, uuid, uuid, text, text, integer, text, text) IS
  'Demande d''ajout OPEN et élément de la file CATALOG_ADDITION (échéance de la base) ; file '
  'indisponible : erreur, rien n''est écrit. Exécutée sous catalog_cmd_owner. US-114 (ADR-104).';
REVOKE ALL ON FUNCTION core.catalog_slug(text),
  core.catalog_addition_open(uuid, text, uuid, uuid, text, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_slug(text),
  core.catalog_addition_open(uuid, text, uuid, uuid, text, text, integer, text, text)
  TO catalog_cmd_owner;

-- 4. Commandes de l'hôte et fonctions de domaine (SECURITY DEFINER, catalog_cmd_owner) -----------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 4.1 Véhicule (corps de 0067 recopié ; une étape ajoutée en fin : un véhicule sans variante
-- ouvre sa demande d'ajout dans la même instruction, 19 US-114 critère 1)
CREATE OR REPLACE FUNCTION core.catalog_cmd_create_vehicle(p_token_hash bytea, p_org uuid,
                                                           p_location_id uuid, p_plate text,
                                                           p_vin text, p_variant_id uuid,
                                                           p_make_text text, p_model_text text,
                                                           p_year integer, p_trim text,
                                                           p_transmission text, p_seats smallint,
                                                           p_fuel_type text, p_odometer_km integer,
                                                           p_gps_installed boolean,
                                                           p_lien_declared boolean)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h       record;
  v_loc   record;
  v_var   record;
  v_class text;
  v_plate text := core.catalog_normalize_plate(p_plate);
  v_vin   text := core.catalog_normalize_vin(p_vin);
  v_id    uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- champs obligatoires et formats (16 HST-011 VEHICLE_FIELD_REQUIRED)
  IF v_plate IS NULL OR v_plate !~ '^[A-Z0-9]{2,12}$'
     OR (p_vin IS NOT NULL AND (v_vin IS NULL OR v_vin !~ '^[A-Z0-9]{5,17}$'))
     OR p_year IS NULL OR p_year NOT BETWEEN 1950 AND 2100
     OR (v_vin IS NOT NULL AND v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' AND p_year >= 1981)
     OR p_transmission IS NULL OR p_transmission NOT IN ('MANUAL', 'AUTOMATIC')
     OR p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 60
     OR p_fuel_type IS NULL OR p_fuel_type NOT IN ('GASOLINE', 'DIESEL', 'HYBRID', 'EV')
     OR (p_odometer_km IS NOT NULL AND p_odometer_km NOT BETWEEN 0 AND 3000000)
     OR (p_trim IS NOT NULL AND (pg_catalog.btrim(p_trim) = '' OR pg_catalog.char_length(p_trim) > 80))
     OR (p_variant_id IS NULL AND (p_make_text IS NULL OR pg_catalog.btrim(p_make_text) = ''
                                   OR pg_catalog.char_length(p_make_text) > 80
                                   OR p_model_text IS NULL OR pg_catalog.btrim(p_model_text) = ''
                                   OR pg_catalog.char_length(p_model_text) > 80))
     OR (p_variant_id IS NOT NULL AND (p_make_text IS NOT NULL OR p_model_text IS NOT NULL)) THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- lieu de remise du MÊME compte (un lieu d'un autre compte : même réponse qu'inconnu)
  SELECT l.id, l.timezone INTO v_loc
    FROM core.catalog_location AS l
   WHERE l.id = p_location_id AND l.org_id = p_org AND l.country_code = h.country_code;
  IF v_loc.id IS NULL THEN
    RETURN QUERY SELECT 'LOCATION_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  -- variante : ACTIVE (elle, son modèle, sa marque), du marché du pays, produite l'année dite
  IF p_variant_id IS NOT NULL THEN
    SELECT v.id, v.status AS v_status, o.status AS o_status, m.status AS m_status, v.market,
           v.year_from, v.year_to, v.value_class
      INTO v_var
      FROM core.catalog_vehicle_variant AS v
      JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
      JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
     WHERE v.id = p_variant_id;
    IF v_var.id IS NULL OR v_var.v_status = 'PENDING_REVIEW' OR v_var.o_status = 'PENDING_REVIEW'
       OR v_var.m_status = 'PENDING_REVIEW'
       OR (v_var.market IS NOT NULL AND v_var.market::text <> h.country_code) THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_NOT_FOUND'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_var.v_status = 'RETIRED' OR v_var.o_status = 'RETIRED' OR v_var.m_status = 'RETIRED' THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_RETIRED'::text, NULL::uuid;
      RETURN;
    END IF;
    IF p_year < v_var.year_from OR (v_var.year_to IS NOT NULL AND p_year > v_var.year_to) THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_NOT_FOUND'::text, NULL::uuid;
      RETURN;
    END IF;
    v_class := v_var.value_class;
  END IF;
  -- doublons sérialisés (deux créations concurrentes de la même plaque ou du même VIN) ; la
  -- contrainte unique reste le filet (23505 traduit en VEHICLE_PLATE_DUPLICATE)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cat.plate:' || h.country_code || ':' || v_plate, 0));
  IF v_vin IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.vin:' || v_vin, 0));
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS x
              WHERE (x.country_code = h.country_code AND x.plate = v_plate)
                 OR (v_vin IS NOT NULL AND x.vin = v_vin)) THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO core.catalog_vehicle (id, org_id, country_code, home_location_id, timezone, plate,
                                      vin, variant_id, make_text, model_text, year, trim_override,
                                      value_class, transmission, seats, fuel_type, odometer_km,
                                      lien_declared, gps_installed, created_by)
    VALUES (v_id, p_org, h.country_code, v_loc.id, v_loc.timezone, v_plate, v_vin, p_variant_id,
            CASE WHEN p_variant_id IS NULL THEN pg_catalog.btrim(p_make_text) END,
            CASE WHEN p_variant_id IS NULL THEN pg_catalog.btrim(p_model_text) END,
            p_year, NULLIF(pg_catalog.btrim(p_trim), ''), v_class, p_transmission,
            p_seats, p_fuel_type, p_odometer_km, COALESCE(p_lien_declared, false),
            COALESCE(p_gps_installed, false), h.user_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END;
  -- hors catalogue (« Autre » de l'assistant) : demande d'ajout et élément de file (US-114)
  IF p_variant_id IS NULL THEN
    PERFORM core.catalog_addition_open(p_org, h.country_code, v_id, h.user_id, p_make_text,
                                       p_model_text, p_year, p_trim, v_vin);
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text, integer, text, text, smallint, text, integer, boolean, boolean) IS
  'Véhicule de l''hôte : plaque et VIN uniques, variante du marché du compte ; hors catalogue : '
  'demande d''ajout et élément de file dans la même instruction. SECURITY DEFINER, EXECUTE '
  'app_api. US-115 (ADR-099) ; US-114 (ADR-104).';

-- 4.2 Soumission (corps de 0070 recopié ; une étape ajoutée après la complétude des photos : un
-- véhicule sans variante du catalogue n'est pas publiable, 16 HST-050 / ADM-036)
CREATE OR REPLACE FUNCTION core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid,
                                                           p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_status  text;
  v_vehicle uuid;
  v_min     bigint;
  v_photos  integer;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status, l.vehicle_id INTO v_status, v_vehicle
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- photos (BR-LIST-05, 16 HST-012) : photos non retirées et non refusées
  v_min := core.catalog_param_int('listing_min_photos', h.country_code);
  IF v_min IS NULL OR v_min < 1 THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_photos
    FROM core.catalog_listing_photo AS p
   WHERE p.listing_id = p_listing_id AND p.deleted_at IS NULL AND p.status <> 'REJECTED';
  IF v_photos < v_min THEN
    RETURN QUERY SELECT 'PHOTO_MIN_COUNT'::text, NULL::uuid;
    RETURN;
  END IF;
  -- véhicule rattaché au catalogue (16 HST-050 « véhicule en brouillon et non publiable » ;
  -- 19 US-114 critère 1) ; sinon l'annonce reste DRAFT
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS v
              WHERE v.id = v_vehicle AND v.variant_id IS NULL) THEN
    RETURN QUERY SELECT 'CATALOG_ADDITION_PENDING'::text, NULL::uuid;
    RETURN;
  END IF;
  -- CGU de l'hôte acceptées dans leur version exigée, dans le pays du compte (19 US-126 ; 16
  -- LEG-001 ; L1-PM-28 : garde dans la commande) ; sinon l'annonce reste DRAFT
  IF core.ctr_host_terms_required(h.user_id, h.country_code) THEN
    RETURN QUERY SELECT 'TERMS_REACCEPT_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- compte d'hôte activé (17 §2.4 ; BOARD N-37) et pays ouvert aux hôtes particuliers (16 HST-005)
  IF h.org_status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.config_go_live('p2p_private_hosts_enabled', h.country_code) THEN
    RETURN QUERY SELECT 'HOST_NOT_ACTIVATED'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET status = 'PENDING_REVIEW', submitted_at = platform.now(), updated_by = h.user_id
   WHERE l.id = p_listing_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (h.user_id, 'P2P_HOST', 'LISTING_SUBMITTED', 'LISTING', p_listing_id,
          pg_catalog.jsonb_build_object('status', 'DRAFT'),
          pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW', 'orgId', p_org,
                                        'country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Soumission SM-2 DRAFT -> PENDING_REVIEW : photos, véhicule au catalogue, CGU de l''hôte, compte '
  'ACTIVE, pays ouvert ; journalisée. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; '
  'US-126 (ADR-100) ; US-114 (ADR-104).';

-- 4.3 Nouvelle demande de l'hôte pour son véhicule hors catalogue (après un refus, ou véhicule
-- sans demande) : marque et modèle corrigés sur le véhicule, demande OPEN et élément de file.
-- Issues : DONE (id de la demande), AUTH_REQUIRED, FORBIDDEN (compte d'un autre),
-- HOST_ACCOUNT_SUSPENDED, VEHICLE_FIELD_REQUIRED, VEHICLE_NOT_FOUND (véhicule d'un autre compte :
-- même réponse), CATALOG_ALREADY_LINKED (variante déjà rattachée), CATALOG_REQUEST_DUPLICATE
-- (demande OPEN, 16 ADM-036).
CREATE FUNCTION core.catalog_cmd_request_addition(p_token_hash bytea, p_org uuid, p_vehicle_id uuid,
                                                  p_make_text text, p_model_text text, p_trim text)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h     record;
  v_veh record;
  v_id  uuid;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_make_text IS NULL OR pg_catalog.btrim(p_make_text) = ''
     OR pg_catalog.char_length(p_make_text) > 80
     OR p_model_text IS NULL OR pg_catalog.btrim(p_model_text) = ''
     OR pg_catalog.char_length(p_model_text) > 80
     OR (p_trim IS NOT NULL AND (pg_catalog.btrim(p_trim) = '' OR pg_catalog.char_length(p_trim) > 80)) THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- véhicule du MÊME compte, verrouillé : deux demandes concurrentes sont sérialisées
  SELECT v.id, v.variant_id, v.year, v.vin INTO v_veh
    FROM core.catalog_vehicle AS v
   WHERE v.id = p_vehicle_id AND v.org_id = p_org AND v.country_code = h.country_code
     FOR UPDATE;
  IF v_veh.id IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_veh.variant_id IS NOT NULL THEN
    RETURN QUERY SELECT 'CATALOG_ALREADY_LINKED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_addition_request AS r
              WHERE r.vehicle_id = p_vehicle_id AND r.status = 'OPEN') THEN
    RETURN QUERY SELECT 'CATALOG_REQUEST_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_vehicle AS v
     SET make_text = pg_catalog.btrim(p_make_text), model_text = pg_catalog.btrim(p_model_text),
         trim_override = NULLIF(pg_catalog.btrim(p_trim), '')
   WHERE v.id = p_vehicle_id;
  v_id := core.catalog_addition_open(p_org, h.country_code, p_vehicle_id, h.user_id, p_make_text,
                                     p_model_text, v_veh.year, p_trim, v_veh.vin);
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_request_addition(bytea, uuid, uuid, text, text, text) IS
  'Nouvelle demande d''ajout au catalogue pour un véhicule hors catalogue du compte de la session '
  '(une OPEN par véhicule : CATALOG_REQUEST_DUPLICATE). SECURITY DEFINER, EXECUTE app_api. US-114.';

-- 4.4 Demandes de l'hôte (la dernière de chaque véhicule) ; session invalide ou compte d'un
-- autre : 0 ligne. Ni l'auteur de la décision, ni le VIN.
CREATE FUNCTION core.catalog_host_addition_requests(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (request_id uuid, vehicle_id uuid, status text, make_text text, model_text text,
                 reject_reason text, sla_due_at timestamptz, created_at timestamptz,
                 reviewed_at timestamptz)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT DISTINCT ON (r.vehicle_id) r.id, r.vehicle_id, r.status, r.make_text, r.model_text,
         r.reject_reason, r.sla_due_at, r.created_at, r.reviewed_at
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_addition_request AS r ON r.org_id = p_org AND r.country_code = h.country_code
   WHERE h.outcome = 'OK'
   ORDER BY r.vehicle_id, r.created_at DESC, r.id DESC
$fn$;
COMMENT ON FUNCTION core.catalog_host_addition_requests(bytea, uuid) IS
  'Dernière demande d''ajout de chaque véhicule du compte de la session. SECURITY DEFINER, '
  'EXECUTE app_api. US-114.';

-- 4.5 Fonction de domaine : demande vue par l'ops (aucune donnée personnelle : marque, modèle,
-- année, finition, VIN masqué, caractéristiques déclarées du véhicule) et variantes candidates
-- (ACTIVE, du marché et de l'année du véhicule, marque reconnue par slug, nom ou alias). NULL si
-- la demande est inconnue ou d'un autre pays. EXECUTE à iam_staff_owner seul.
CREATE FUNCTION core.catalog_addition_detail(p_addition_id uuid, p_country text)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r      record;
  v_cand jsonb;
BEGIN
  SELECT a.id, a.status, a.make_text, a.model_text, a.year, a.trim_text, a.vin_masked,
         a.country_code, a.sla_due_at, a.created_at, a.reject_reason, a.resolved_variant_id,
         v.transmission, v.seats, v.fuel_type
    INTO r
    FROM core.catalog_addition_request AS a
    JOIN core.catalog_vehicle AS v ON v.id = a.vehicle_id
   WHERE a.id = p_addition_id AND a.country_code = p_country;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'variantId', c.id, 'make', c.make_name, 'model', c.model_name, 'yearFrom', c.year_from,
           'yearTo', c.year_to, 'trim', c.trim_name, 'transmission', c.transmission,
           'fuelType', c.fuel_type, 'drive', c.drive, 'seats', c.seats,
           'modelMatch', c.model_match)
           ORDER BY c.model_match DESC, c.model_name, c.year_from, c.id)
    INTO v_cand
    FROM (SELECT v.id, ma.name AS make_name, mo.name AS model_name, v.year_from, v.year_to,
                 v.trim_name, v.transmission, v.fuel_type, v.drive, v.seats,
                 (mo.slug = core.catalog_slug(r.model_text)) AS model_match
            FROM core.catalog_vehicle_variant AS v
            JOIN core.catalog_vehicle_model AS mo ON mo.id = v.model_id
            JOIN core.catalog_vehicle_make AS ma ON ma.id = mo.make_id
           WHERE v.status = 'ACTIVE' AND mo.status = 'ACTIVE' AND ma.status = 'ACTIVE'
             AND (v.market IS NULL OR v.market::text = r.country_code)
             AND v.year_from <= r.year AND (v.year_to IS NULL OR v.year_to >= r.year)
             AND (ma.slug = core.catalog_slug(r.make_text)
                  OR EXISTS (SELECT 1 FROM pg_catalog.unnest(ma.aliases) AS x(alias)
                              WHERE core.catalog_slug(x.alias) = core.catalog_slug(r.make_text)))
           ORDER BY (mo.slug = core.catalog_slug(r.model_text)) DESC, mo.name, v.year_from, v.id
           LIMIT 30) AS c;
  RETURN pg_catalog.jsonb_build_object(
    'requestId', r.id, 'status', r.status, 'country', r.country_code, 'makeText', r.make_text,
    'modelText', r.model_text, 'year', r.year, 'trimText', r.trim_text, 'vinMasked', r.vin_masked,
    'transmission', r.transmission, 'seats', r.seats, 'fuelType', r.fuel_type,
    'slaDueAt', r.sla_due_at, 'createdAt', r.created_at, 'rejectReason', r.reject_reason,
    'resolvedVariantId', r.resolved_variant_id,
    'candidates', COALESCE(v_cand, '[]'::jsonb));
END
$fn$;
COMMENT ON FUNCTION core.catalog_addition_detail(uuid, text) IS
  'Demande d''ajout vue par l''ops et variantes candidates ; NULL si inconnue ou d''un autre pays. '
  'SECURITY DEFINER, EXECUTE iam_staff_owner seul (console). US-114 (ADR-104).';

-- 4.6 Fonction de domaine : décision de l'ops sur une demande OPEN du pays p_country. L'acteur et
-- son rôle viennent de la commande de console (session, TOTP, permission et prise en charge
-- vérifiées par elle). Véhicule PUIS demande verrouillés (même ordre que 4.3). Issues :
--   RESOLVED (status, variant_id) ; NOT_OPEN (déjà tranchée) ; COUNTRY_MISMATCH ;
--   CATALOG_VARIANT_NOT_FOUND (MERGE : variante inconnue, non ACTIVE, d'un autre marché ou d'une
--   autre année) ; CATALOG_VARIANT_EXISTS (APPROVE : la variante existe déjà, la rapprocher) ;
--   CATALOG_ENTRY_INVALID (APPROVE : saisie invalide, marque ou modèle non ACTIVE, année du
--   véhicule hors des années de la variante ; REJECT : motif inconnu).
-- Saisie d'APPROVE (`p_entry`, clés fermées) : makeName, modelName, bodyType, yearFrom, yearTo,
-- trimName, transmission, fuelType, drive, seats, doors, valueClass, licenseNote.
CREATE FUNCTION core.catalog_resolve_addition(p_addition_id uuid, p_country text, p_actor uuid,
                                              p_actor_role text, p_decision text,
                                              p_variant_id uuid, p_entry jsonb,
                                              p_reject_reason text, p_correlation uuid)
  RETURNS TABLE (outcome text, status text, variant_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now      timestamptz := platform.now();
  v_req      record;
  v_vehicle  uuid;
  v_veh      record;
  v_var      record;
  v_status   text;
  v_variant  uuid;
  v_class    text;
  v_make     uuid;
  v_model    uuid;
  v_ok       boolean;
  e_make     text;
  e_model    text;
  e_body     text;
  e_from     integer;
  e_to       integer;
  e_trim     text;
  e_trans    text;
  e_fuel     text;
  e_drive    text;
  e_seats    integer;
  e_doors    integer;
  e_class    text;
  e_license  text;
  v_src_ref  text;
BEGIN
  IF p_addition_id IS NULL OR p_country IS NULL OR p_actor IS NULL
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('OPS_AGENT', 'ADMIN')
     OR p_decision IS NULL OR p_decision NOT IN ('MERGE', 'APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'file d''ajout : décision invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- véhicule d'abord (même ordre de verrous que la demande de l'hôte), puis la demande
  SELECT a.vehicle_id INTO v_vehicle FROM core.catalog_addition_request AS a WHERE a.id = p_addition_id;
  IF v_vehicle IS NULL THEN
    RETURN QUERY SELECT 'NOT_OPEN'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT v.id, v.year, v.variant_id INTO v_veh
    FROM core.catalog_vehicle AS v WHERE v.id = v_vehicle FOR UPDATE;
  SELECT a.id, a.status, a.country_code, a.org_id, a.vehicle_id, a.requested_by INTO v_req
    FROM core.catalog_addition_request AS a WHERE a.id = p_addition_id FOR UPDATE;
  IF v_req.country_code IS DISTINCT FROM p_country THEN
    RETURN QUERY SELECT 'COUNTRY_MISMATCH'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_req.status <> 'OPEN' OR v_veh.variant_id IS NOT NULL THEN
    RETURN QUERY SELECT 'NOT_OPEN'::text, v_req.status, NULL::uuid;
    RETURN;
  END IF;

  IF p_decision = 'REJECT' THEN
    IF p_reject_reason IS NULL
       OR p_reject_reason NOT IN ('INSUFFICIENT_DETAILS', 'UNKNOWN_MODEL', 'NOT_ELIGIBLE') THEN
      RETURN QUERY SELECT 'CATALOG_ENTRY_INVALID'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_status := 'REJECTED';

  ELSIF p_decision = 'MERGE' THEN
    SELECT v.id, v.value_class INTO v_var
      FROM core.catalog_vehicle_variant AS v
      JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
      JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
     WHERE v.id = p_variant_id
       AND v.status = 'ACTIVE' AND o.status = 'ACTIVE' AND m.status = 'ACTIVE'
       AND (v.market IS NULL OR v.market::text = v_req.country_code)
       AND v.year_from <= v_veh.year AND (v.year_to IS NULL OR v.year_to >= v_veh.year);
    IF v_var.id IS NULL THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_NOT_FOUND'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_status := 'MERGED';
    v_variant := v_var.id;
    v_class := v_var.value_class;

  ELSE
    -- APPROVE : saisie fermée, types vérifiés avant toute conversion
    v_ok := p_entry IS NOT NULL AND pg_catalog.jsonb_typeof(p_entry) = 'object'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_entry) AS k(key)
                       WHERE k.key <> ALL (ARRAY['makeName', 'modelName', 'bodyType', 'yearFrom',
                                                 'yearTo', 'trimName', 'transmission', 'fuelType',
                                                 'drive', 'seats', 'doors', 'valueClass',
                                                 'licenseNote']))
      AND pg_catalog.jsonb_typeof(p_entry -> 'makeName') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'modelName') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'bodyType') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'transmission') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'fuelType') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'drive') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'licenseNote') = 'string'
      AND pg_catalog.jsonb_typeof(p_entry -> 'yearFrom') = 'number'
      AND (p_entry ->> 'yearFrom') ~ '^[0-9]{4}$'
      AND pg_catalog.jsonb_typeof(p_entry -> 'seats') = 'number'
      AND (p_entry ->> 'seats') ~ '^[0-9]{1,2}$'
      AND pg_catalog.jsonb_typeof(p_entry -> 'doors') = 'number'
      AND (p_entry ->> 'doors') ~ '^[0-9]$'
      AND (NOT (p_entry ? 'yearTo') OR pg_catalog.jsonb_typeof(p_entry -> 'yearTo') = 'null'
           OR (pg_catalog.jsonb_typeof(p_entry -> 'yearTo') = 'number'
               AND (p_entry ->> 'yearTo') ~ '^[0-9]{4}$'))
      AND (NOT (p_entry ? 'trimName') OR pg_catalog.jsonb_typeof(p_entry -> 'trimName') IN ('null', 'string'))
      AND (NOT (p_entry ? 'valueClass') OR pg_catalog.jsonb_typeof(p_entry -> 'valueClass') IN ('null', 'string'));
    IF v_ok THEN
      e_make := pg_catalog.btrim(p_entry ->> 'makeName');
      e_model := pg_catalog.btrim(p_entry ->> 'modelName');
      e_body := p_entry ->> 'bodyType';
      e_from := (p_entry ->> 'yearFrom')::integer;
      e_to := (p_entry ->> 'yearTo')::integer;
      e_trim := NULLIF(pg_catalog.btrim(p_entry ->> 'trimName'), '');
      e_trans := p_entry ->> 'transmission';
      e_fuel := p_entry ->> 'fuelType';
      e_drive := p_entry ->> 'drive';
      e_seats := (p_entry ->> 'seats')::integer;
      e_doors := (p_entry ->> 'doors')::integer;
      e_class := p_entry ->> 'valueClass';
      e_license := pg_catalog.btrim(p_entry ->> 'licenseNote');
      v_ok := e_make <> '' AND pg_catalog.char_length(e_make) <= 80
        AND core.catalog_slug(e_make) IS NOT NULL
        AND e_model <> '' AND pg_catalog.char_length(e_model) <= 80
        AND core.catalog_slug(e_model) IS NOT NULL
        AND e_body IN ('SUV', 'PICKUP', 'SEDAN', 'HATCHBACK', 'VAN', 'MINIVAN', 'COUPE',
                       'CONVERTIBLE', 'WAGON')
        AND e_from BETWEEN 1950 AND 2100 AND (e_to IS NULL OR e_to BETWEEN e_from AND 2100)
        AND (e_trim IS NULL OR pg_catalog.char_length(e_trim) <= 80)
        AND e_trans IN ('MT', 'AT', 'CVT', 'DCT')
        AND e_fuel IN ('GASOLINE', 'DIESEL', 'HYBRID', 'PHEV', 'EV', 'LPG')
        AND e_drive IN ('FWD', 'RWD', 'AWD', '4X4')
        AND e_seats BETWEEN 1 AND 60 AND e_doors BETWEEN 1 AND 6
        AND (e_class IS NULL OR e_class IN ('STANDARD', 'PREMIUM', 'LUXE'))
        AND pg_catalog.char_length(e_license) BETWEEN 10 AND 500
        -- la variante couvre l'année du véhicule en attente
        AND e_from <= v_veh.year AND (e_to IS NULL OR e_to >= v_veh.year);
    END IF;
    IF NOT COALESCE(v_ok, false) THEN
      RETURN QUERY SELECT 'CATALOG_ENTRY_INVALID'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_src_ref := 'US-114 demande ' || p_addition_id::text;
    -- deux approbations concurrentes d'une même marque ou d'un même modèle : sérialisées
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('cat.catalog_entry:' || core.catalog_slug(e_make), 0));
    SELECT m.id, m.status INTO v_var FROM core.catalog_vehicle_make AS m
     WHERE m.slug = core.catalog_slug(e_make);
    IF v_var.id IS NOT NULL AND v_var.status <> 'ACTIVE' THEN
      RETURN QUERY SELECT 'CATALOG_ENTRY_INVALID'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_make := v_var.id;
    IF v_make IS NULL THEN
      v_make := pg_catalog.gen_random_uuid();
      INSERT INTO core.catalog_vehicle_make (id, slug, name, status, source, source_ref, license_note)
      VALUES (v_make, core.catalog_slug(e_make), e_make, 'ACTIVE', 'HOST_REQUEST', v_src_ref,
              e_license);
    END IF;
    SELECT o.id, o.status INTO v_var FROM core.catalog_vehicle_model AS o
     WHERE o.make_id = v_make AND o.slug = core.catalog_slug(e_model);
    IF v_var.id IS NOT NULL AND v_var.status <> 'ACTIVE' THEN
      RETURN QUERY SELECT 'CATALOG_ENTRY_INVALID'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_model := v_var.id;
    IF v_model IS NULL THEN
      v_model := pg_catalog.gen_random_uuid();
      INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, body_type, seats_default,
                                              doors_default, status, source, source_ref,
                                              license_note)
      VALUES (v_model, v_make, core.catalog_slug(e_model), e_model, e_body, e_seats, e_doors,
              'ACTIVE', 'HOST_REQUEST', v_src_ref, e_license);
    END IF;
    -- clé naturelle de 0063 (marché = pays de la demande) : une variante existante se rapproche
    IF EXISTS (SELECT 1 FROM core.catalog_vehicle_variant AS v
                WHERE v.model_id = v_model AND v.year_from = e_from
                  AND v.trim_name IS NOT DISTINCT FROM e_trim AND v.transmission = e_trans
                  AND v.fuel_type = e_fuel AND v.drive = e_drive
                  AND v.market::text = v_req.country_code) THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_EXISTS'::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    v_variant := pg_catalog.gen_random_uuid();
    INSERT INTO core.catalog_vehicle_variant (id, model_id, year_from, year_to, trim_name,
                                              transmission, fuel_type, drive, seats, doors,
                                              value_class, market, status, source, source_ref,
                                              license_note, verified_by, verified_at)
    VALUES (v_variant, v_model, e_from, e_to, e_trim, e_trans, e_fuel, e_drive, e_seats, e_doors,
            e_class, v_req.country_code, 'ACTIVE', 'HOST_REQUEST', v_src_ref, e_license, p_actor,
            v_now);
    v_status := 'APPROVED';
    v_class := e_class;
  END IF;

  UPDATE core.catalog_addition_request AS a
     SET status = v_status, resolved_variant_id = v_variant,
         reject_reason = CASE WHEN v_status = 'REJECTED' THEN p_reject_reason END,
         reviewed_by = p_actor, reviewed_at = v_now
   WHERE a.id = p_addition_id;
  IF v_variant IS NOT NULL THEN
    -- le véhicule en attente reçoit sa variante ; le repli texte reste sur la demande
    UPDATE core.catalog_vehicle AS v
       SET variant_id = v_variant, make_text = NULL, model_text = NULL, value_class = v_class
     WHERE v.id = v_req.vehicle_id;
  END IF;
  -- 17 §4.5 : request_id, status, resolved_variant_id ; destinataire de NTF : l'hôte demandeur
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload)
  VALUES ('catalog.addition_request.resolved', 1, 'catalog_addition_request', p_addition_id, 1,
          v_req.country_code, p_actor, p_actor_role, COALESCE(p_correlation, pg_catalog.gen_random_uuid()),
          pg_catalog.jsonb_build_object('request_id', p_addition_id, 'status', v_status,
                                        'resolved_variant_id', v_variant,
                                        'vehicle_id', v_req.vehicle_id, 'org_id', v_req.org_id,
                                        'host_user_id', v_req.requested_by,
                                        'reject_reason',
                                        CASE WHEN v_status = 'REJECTED' THEN p_reject_reason END));
  RETURN QUERY SELECT 'RESOLVED'::text, v_status, v_variant;
END
$fn$;
COMMENT ON FUNCTION core.catalog_resolve_addition(uuid, text, uuid, text, text, uuid, jsonb, text, uuid) IS
  'Décision de l''ops sur une demande d''ajout (MERGE, APPROVE, REJECT) : variante rattachée au '
  'véhicule, catalogue complété (HOST_REQUEST), événement catalog.addition_request.resolved. '
  'SECURITY DEFINER, EXECUTE iam_staff_owner seul (console). US-114 (ADR-104).';

REVOKE ALL ON FUNCTION core.catalog_cmd_request_addition(bytea, uuid, uuid, text, text, text),
  core.catalog_host_addition_requests(bytea, uuid), core.catalog_addition_detail(uuid, text),
  core.catalog_resolve_addition(uuid, text, uuid, text, text, uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_cmd_request_addition(bytea, uuid, uuid, text, text, text),
  core.catalog_host_addition_requests(bytea, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.catalog_addition_detail(uuid, text),
  core.catalog_resolve_addition(uuid, text, uuid, text, text, uuid, jsonb, text, uuid)
  TO iam_staff_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 5. Commandes de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) --------
-- Permission de la file (`ops.review_listing_host`, support_review_queue) EN COURS dans le pays de
-- l'élément ; élément ouvert de la file CATALOG_ADDITION pris en charge par l'acteur (ADMIN : tout
-- élément de sa portée) ; TOTP. Refus journalisés (STAFF_ACCESS_DENIED, STAFF_FORBIDDEN) ; issues
-- communes : AUTH_REQUIRED, MFA_REQUIRED, CASE_REQUIRED (permission détenue, élément non pris en
-- charge, clos ou d'une autre file), FORBIDDEN (introuvable, sans permission, pays discordant).
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Garde commune : rend (refus, rôle, élément). Refus journalisé ici.
CREATE FUNCTION core.support_staff_catalog_item(p_user uuid, p_item_id uuid, p_attempted text,
                                                p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'CATALOG_ADDITION' OR v_item.subject_type <> 'CATALOG_ADDITION_REQUEST'
      THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;
REVOKE ALL ON FUNCTION core.support_staff_catalog_item(uuid, uuid, text, uuid) FROM PUBLIC;

-- 5.1 Demande d'ajout d'un élément de la file (lecture ; aucune donnée personnelle).
-- Issues : GRANTED (demande et variantes candidates) et les issues communes.
CREATE FUNCTION core.support_staff_catalog_addition(p_token_hash bytea, p_request_id uuid,
                                                    p_item_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_g    record;
  v_body jsonb;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'file d''ajout : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'CATALOG_ADDITION_READ'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_g FROM core.support_staff_catalog_item(v_s.user_id, p_item_id,
                                                          'CATALOG_ADDITION_READ', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  v_body := core.catalog_addition_detail(v_g.subject_id, v_g.country_code);
  IF v_body IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'GRANTED'::text,
    v_body || pg_catalog.jsonb_build_object('itemId', p_item_id);
END
$fn$;

-- 5.2 Décision (MERGE, APPROVE, REJECT) : fonction de domaine du catalogue, clôture de l'élément
-- (DONE, décision APPROVED / MERGED / REJECTED) et journal chaîné, dans la même instruction.
-- Issues : RESOLVED, NOT_OPEN, CATALOG_VARIANT_NOT_FOUND, CATALOG_VARIANT_EXISTS,
-- CATALOG_ENTRY_INVALID et les issues communes.
CREATE FUNCTION core.support_staff_resolve_catalog_addition(p_token_hash bytea, p_request_id uuid,
                                                            p_item_id uuid, p_decision text,
                                                            p_variant_id uuid, p_entry jsonb,
                                                            p_reject_reason text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s   record;
  v_g   record;
  v_r   record;
  v_c   record;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_decision IS NULL
     OR p_decision NOT IN ('MERGE', 'APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'file d''ajout : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'CATALOG_ADDITION_RESOLVE'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_g FROM core.support_staff_catalog_item(v_s.user_id, p_item_id,
                                                          'CATALOG_ADDITION_RESOLVE', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_r
    FROM core.catalog_resolve_addition(v_g.subject_id, v_g.country_code, v_s.user_id, v_g.role,
                                       p_decision, p_variant_id, p_entry, p_reject_reason,
                                       p_request_id);
  IF v_r.outcome = 'COUNTRY_MISMATCH' THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_r.outcome <> 'RESOLVED' THEN
    RETURN QUERY SELECT v_r.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_c FROM core.support_close_review_item(p_item_id, 'DONE', v_r.status, v_s.user_id);
  IF v_c.outcome <> 'CLOSED' THEN
    RAISE EXCEPTION 'file d''ajout : élément non clos' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- journal EN DERNIER (passation US-009)
  PERFORM core.iam_staff_audit(v_s.user_id, v_g.role, 'CATALOG_ADDITION_RESOLVED',
                               'CATALOG_ADDITION_REQUEST', v_g.subject_id,
                               pg_catalog.jsonb_build_object('status', 'OPEN'),
                               pg_catalog.jsonb_build_object('country', v_g.country_code,
                                 'status', v_r.status, 'variantId', v_r.variant_id,
                                 'itemId', p_item_id, 'rejectReason',
                                 CASE WHEN v_r.status = 'REJECTED' THEN p_reject_reason END),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'RESOLVED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'requestId', v_g.subject_id, 'status', v_r.status,
    'variantId', v_r.variant_id);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_catalog_item(uuid, uuid, text, uuid) IS
  'Garde des commandes de la file d''ajout : élément CATALOG_ADDITION ouvert, permission de la '
  'file dans son pays, pris en charge par l''acteur (ADMIN : sa portée) ; refus journalisé. '
  'Aide interne sous iam_staff_owner. US-114 (ADR-104).';
COMMENT ON FUNCTION core.support_staff_catalog_addition(bytea, uuid, uuid) IS
  'Demande d''ajout d''un élément de la file CATALOG_ADDITION et variantes candidates (console, '
  'TOTP, élément pris en charge). SECURITY DEFINER, EXECUTE app_api. US-114 (ADR-104).';
COMMENT ON FUNCTION core.support_staff_resolve_catalog_addition(bytea, uuid, uuid, text, uuid, jsonb, text) IS
  'Décision de l''ops sur une demande d''ajout (MERGE, APPROVE, REJECT), élément clos, journal '
  'chaîné. SECURITY DEFINER, EXECUTE app_api. US-114 (ADR-104).';
REVOKE ALL ON FUNCTION core.support_staff_catalog_addition(bytea, uuid, uuid),
  core.support_staff_resolve_catalog_addition(bytea, uuid, uuid, text, uuid, jsonb, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_catalog_addition(bytea, uuid, uuid),
  core.support_staff_resolve_catalog_addition(bytea, uuid, uuid, text, uuid, jsonb, text)
  TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
