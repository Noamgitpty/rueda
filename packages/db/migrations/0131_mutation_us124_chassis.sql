-- 0131 — MUTATION TEMPORAIRE (suite N-99 d'US-124, ADR-158) : JAMAIS FUSIONNÉE.
-- M1 engagement de propriété neutralisé ; M2 engagement du créancier neutralisé ;
-- M3 bornes du numéro non ISO 5..16 -> 6..15 ; M4 historique : un seul engagement par sorte.

CREATE OR REPLACE FUNCTION core.catalog_vin_kind(p_vin text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_vin ~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'ISO_3779'
              WHEN p_vin ~ '^[A-Z0-9]{6,15}$' /* MUTATION M3 */ THEN 'CHASSIS'
         END
$fn$;

CREATE OR REPLACE FUNCTION core.catalog_vehicle_blockers(p_vehicle uuid, p_strict boolean)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v        record;
  v_tz     text;
  v_today  date;
  v_age    bigint;
  v_km     bigint;
  v_lender boolean;
  v_state  text;
  v_type   text;
  r        text[] := '{}';
BEGIN
  SELECT x.id, x.country_code, x.variant_id, x.year, x.odometer_km, x.title_holder,
         x.lien_declared, x.released_at, x.vin, x.ownership_attested_at, x.lien_attested_at
    INTO v
    FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle;
  IF v.id IS NULL THEN
    RETURN ARRAY['VEHICLE_NOT_FOUND'];
  END IF;
  IF v.released_at IS NOT NULL THEN
    RETURN ARRAY['VEHICLE_RELEASED'];
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = v.country_code;
  v_age := core.catalog_param_int('elig_age_years_ceiling', v.country_code);
  v_km := core.catalog_param_int('elig_odometer_km_ceiling', v.country_code);
  IF v_tz IS NULL OR v_age IS NULL OR v_age < 1 OR v_km IS NULL OR v_km < 1 THEN
    RETURN ARRAY['PARAM_MISSING'];
  END IF;
  v_today := (platform.now() AT TIME ZONE v_tz)::date;
  -- véhicule hors catalogue : jamais publiable (OQ-CAT-01 g ; US-114)
  IF v.variant_id IS NULL THEN
    r := r || 'CATALOG_ADDITION_PENDING'::text;
  END IF;
  -- âge en années civiles du pays (16 HST-019 : 11 ans refusé au seuil 10)
  IF pg_catalog.date_part('year', v_today)::bigint - v.year > v_age THEN
    r := r || 'VEHICLE_TOO_OLD'::text;
  END IF;
  -- plaque et numéro de châssis saisis (VIN ISO 3779 ou numéro non ISO, quelle que soit l'année :
  -- tout véhicule en porte un ; ADR-113), compteur et titulaire déclarés
  IF v.odometer_km IS NULL OR v.title_holder IS NULL OR v.vin IS NULL THEN
    r := r || 'VEHICLE_FIELD_REQUIRED'::text;
  ELSIF v.odometer_km >= v_km THEN
    -- 08 BR-LIST-02 [NOUS] « < 200 000 km » : le plafond lui-même est refusé
    r := r || 'VEHICLE_MILEAGE_TOO_HIGH'::text;
  END IF;
  -- titre : l'hôte déclare être propriétaire ou autorisé par lui (08 BR-LIST-01, OQ-P2P-02) ;
  -- l'autorisation notariée n'est exigée que si le pays l'impose (elig_doc_owner_authorization)
  IF false /* MUTATION M1 */
     OR (v.title_holder = 'THIRD_PARTY'
         AND core.catalog_document_required('OWNER_AUTHORIZATION', v.country_code)
         AND core.catalog_document_state(p_vehicle, 'OWNER_AUTHORIZATION', p_strict, v_today) <> 'OK') THEN
    r := r || 'VEHICLE_TITLE_MISMATCH'::text;
  END IF;
  -- véhicule financé : accord du créancier DÉCLARÉ (OQ-BR-28 ; paramètre absent ⇒ exigé) ; le
  -- document du créancier seulement si le pays l'impose (elig_doc_lender_consent)
  v_lender := COALESCE(core.catalog_param_bool('vehicle_financed_requires_lender_consent',
                                               v.country_code), true);
  IF v.lien_declared AND v_lender
     AND (false /* MUTATION M2 */
          OR (core.catalog_document_required('LENDER_CONSENT', v.country_code)
              AND core.catalog_document_state(p_vehicle, 'LENDER_CONSENT', p_strict, v_today) <> 'OK')) THEN
    r := r || 'VEHICLE_LENDER_CONSENT_REQUIRED'::text;
  END IF;
  -- pièces exigées par le pays (aucune par défaut)
  FOREACH v_type IN ARRAY ARRAY['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION', 'COMPULSORY_INSURANCE'] LOOP
    IF core.catalog_document_required(v_type, v.country_code) THEN
      v_state := core.catalog_document_state(p_vehicle, v_type, p_strict, v_today);
      IF v_state = 'EXPIRED' AND NOT ('VEHICLE_DOCUMENT_EXPIRED' = ANY (r)) THEN
        r := r || 'VEHICLE_DOCUMENT_EXPIRED'::text;
      ELSIF v_state = 'MISSING' AND NOT ('VEHICLE_DOCUMENT_REQUIRED' = ANY (r)) THEN
        r := r || 'VEHICLE_DOCUMENT_REQUIRED'::text;
      END IF;
    END IF;
  END LOOP;
  RETURN r;
END
$fn$;

GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
CREATE OR REPLACE FUNCTION core.catalog_vehicle_declare(p_token_hash bytea, p_org uuid, p_vehicle uuid,
                                             p_title_holder text, p_lien_declared boolean,
                                             p_odometer_km integer,
                                             p_ownership_attested boolean,
                                             p_lien_attested boolean, p_vin text,
                                             p_locale text, p_catalog_version integer,
                                             p_ownership_text text, p_lien_text text)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w      record;
  v_cur  record;
  v_vin  text := core.catalog_normalize_vin(p_vin);
  v_now  timestamptz := platform.now();
  v_lien boolean := COALESCE(p_lien_declared AND COALESCE(p_lien_attested, false), false);
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT x.vin INTO v_cur FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle;
  IF p_title_holder IS NULL OR p_title_holder NOT IN ('HOST', 'THIRD_PARTY')
     OR p_lien_declared IS NULL OR p_ownership_attested IS NULL
     OR p_odometer_km IS NULL OR p_odometer_km NOT BETWEEN 0 AND 3000000
     OR (p_vin IS NOT NULL AND v_cur.vin IS NOT NULL AND v_vin IS DISTINCT FROM v_cur.vin) THEN
    -- le numéro déjà enregistré ne se change pas ici (contestation N-61 si un autre l'a pris)
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- numéro saisi : VIN ISO 3779 ou numéro non ISO, sinon refus dédié (ADR-113)
  IF p_vin IS NOT NULL AND core.catalog_vin_kind(v_vin) IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_VIN_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_vin IS NOT NULL AND v_cur.vin IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.vin:' || v_vin, 0));
    IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS x
                WHERE x.released_at IS NULL AND x.vin = v_vin AND x.id <> p_vehicle) THEN
      RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;
  BEGIN
    UPDATE core.catalog_vehicle AS x
       SET title_holder = p_title_holder, lien_declared = p_lien_declared,
           odometer_km = p_odometer_km, eligibility_status = 'PENDING',
           vin = COALESCE(x.vin, v_vin),
           ownership_attested_at = CASE WHEN p_ownership_attested THEN v_now END,
           lien_attested_at = CASE WHEN v_lien THEN v_now END
     WHERE x.id = p_vehicle;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END;
  -- un engagement pris = une ligne de l'historique, jamais réécrite (libellé exact affiché)
  INSERT INTO core.catalog_vehicle_attestation (vehicle_id, org_id, country_code, user_id,
                                                statement, statement_key, catalog_version, locale,
                                                statement_text, attested_at)
  SELECT p_vehicle, p_org, w.country_code, w.user_id, s.kind, s.msg_key, p_catalog_version,
         p_locale, s.wording, v_now
    FROM (VALUES ('OWNERSHIP', 'web.vehicleDocs.declaration.owner', p_ownership_text,
                  p_ownership_attested),
                 ('LIEN', 'web.vehicleDocs.declaration.lienOk', p_lien_text, v_lien))
         AS s(kind, msg_key, wording, taken)
   WHERE s.taken /* MUTATION M4 */ AND NOT EXISTS (SELECT 1 FROM core.catalog_vehicle_attestation AS a
                                            WHERE a.vehicle_id = p_vehicle AND a.statement = s.kind);
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_DECLARATION_SAVED', 'VEHICLE', p_vehicle,
          pg_catalog.jsonb_build_object('eligibilityStatus', w.eligibility_status),
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'titleHolder', p_title_holder,
                                        'lienDeclared', p_lien_declared,
                                        'ownershipAttested', p_ownership_attested,
                                        'lienAttested', COALESCE(p_lien_attested, false),
                                        'catalogVersion', p_catalog_version,
                                        'locale', p_locale,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_vehicle;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
