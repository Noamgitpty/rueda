-- 0154 — CAT : points d'entrée du mode sur demande (recherche, zones, fiche S03, devis S05).
-- US-223 (ouverture du mode, BOARD N-246, GL-26) ; 19 US-223 DoR 2 (« tant que REQUEST n'existe pas,
-- une annonce instant_book = false n'est ni proposée par la recherche ni réservable ») ; 08
-- BR-BOOK-01 (mode REQUEST au choix de l'hôte) ; 22 OQ-P2P-10 (instantanée par défaut, REQUEST
-- optionnel, expiration 4 h) ; 17 §2.5 « Hold de demande REQUEST », §7.2
-- (`booking_request_mode_enabled`, `booking_request_expiry_hours`) ; 10b S03 `web.s03.request` ;
-- ADR-127 (recherche, 0103), ADR-146 (mode, 0125 / 0126), ADR-175 (cette migration). Appliquée
-- sous `migrator`, en une transaction.
--
-- Principes (ADR-175, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - le filtre « réservation immédiate seulement » de la recherche et des zones (0103) est levé
--     PAR PAYS, seulement là où le checkout accepterait la demande : `booking_request_mode_enabled`
--     vrai ET `booking_request_expiry_hours` entier ≥ 1 en vigueur (absent, faux ou mal formé :
--     annonce sur demande écartée, comme avant ; fail-closed) ; la règle du checkout (0126) est
--     inchangée et reste la seule qui crée un hold REQUEST ;
--   - lecture publique `core.catalog_public_request_terms(pays)` pour la fiche S03 et le devis S05
--     (« {host_name} confirma en hasta {count} horas ») : le mode et le délai, rien d'autre ;
--     SECURITY DEFINER (propriétaire catalog_cmd_owner, comme la recherche), EXECUTE au seul
--     app_api ; aucune écriture, aucune donnée personnelle ;
--   - AUCUNE valeur de paramètre n'est changée : `booking_request_mode_enabled` reste faux en PA et
--     en PY (0125) ; son passage à vrai, pays par pays, est une ligne de GL-26 (lot C : PSP avec
--     SUPPORTS_PREAUTH / SUPPORTS_VOID validés, consommateur `payment_command`, notifications,
--     limiteur, CGU), jamais du code de cette story ; tant qu'il est faux, rien ne change en
--     production ni dans la bêta.
--
-- Expand / contract : deux fonctions et une politique AJOUTÉES ; deux fonctions de 0103 remplacées
-- à l'identique (même signature, mêmes colonnes, même propriétaire, mêmes droits) sauf le filtre
-- `instant_book` ; aucune table ni colonne modifiée.
--
-- Retour arrière : recréer `core.catalog_public_areas(text)` et `core.catalog_public_search(...)`
--   avec le corps de 0103 (`AND l.instant_book`) ; DROP FUNCTION
--   core.catalog_public_request_terms(text), core.catalog_request_mode_hours(text) ; DROP POLICY
--   catalog_cmd_request_mode_read ON core.config_param_value ; REVOKE EXECUTE ON FUNCTION
--   core.booking_param_bool(text, text) FROM catalog_cmd_owner.

-- 1. Droits de catalog_cmd_owner, au plus juste -------------------------------------------------
-- les deux seules clés du mode sur demande (politique permissive ajoutée à côté de
-- catalog_cmd_search_read de 0103 : OU, sans recopier sa liste)
CREATE POLICY catalog_cmd_request_mode_read ON core.config_param_value FOR SELECT
  TO catalog_cmd_owner
  USING (key IN ('booking_request_mode_enabled', 'booking_request_expiry_hours'));
-- booléen en vigueur d'un paramètre de pays (0126, SECURITY INVOKER : la politique ci-dessus borne
-- ce que catalog_cmd_owner lit)
GRANT EXECUTE ON FUNCTION core.booking_param_bool(text, text) TO catalog_cmd_owner;

-- 2. Aide interne (SECURITY INVOKER, EXECUTE au seul catalog_cmd_owner) ---------------------------
-- Délai de réponse de l'hôte (heures) si le mode sur demande est ouvert dans le pays ; NULL sinon
-- (paramètre absent, faux, mal typé, ou délai absent / < 1 : fail-closed).
CREATE FUNCTION core.catalog_request_mode_hours(p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN core.booking_param_bool('booking_request_mode_enabled', p_country) IS TRUE
            AND core.catalog_search_param_int('booking_request_expiry_hours', p_country) >= 1
           THEN core.catalog_search_param_int('booking_request_expiry_hours', p_country)
         END
$fn$;
COMMENT ON FUNCTION core.catalog_request_mode_hours(text) IS
  'Délai de réponse de l''hôte (booking_request_expiry_hours) si booking_request_mode_enabled est '
  'vrai dans le pays, NULL sinon (fail-closed). Aide de la recherche sous catalog_cmd_owner. '
  'US-223 (ADR-175).';
REVOKE ALL ON FUNCTION core.catalog_request_mode_hours(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_request_mode_hours(text) TO catalog_cmd_owner;

GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 3. Lecture publique du mode sur demande d'un pays (S03, S05) -----------------------------------
CREATE FUNCTION core.catalog_public_request_terms(p_country text)
  RETURNS TABLE (request_mode_enabled boolean, request_expiry_hours integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.hours IS NOT NULL, h.hours
    FROM (SELECT core.catalog_request_mode_hours(p_country) AS hours) AS h
$fn$;
COMMENT ON FUNCTION core.catalog_public_request_terms(text) IS
  'Mode sur demande du pays : ouvert (booking_request_mode_enabled vrai et délai ≥ 1 h) et délai de '
  'réponse de l''hôte ; fermé : (false, NULL). Lecture seule, aucune donnée personnelle. '
  'SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-175).';
REVOKE ALL ON FUNCTION core.catalog_public_request_terms(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_request_terms(text) TO app_api;

-- 4. Zones de remise (0103 §3, corps recopié ; seul le filtre du mode change) ---------------------
CREATE OR REPLACE FUNCTION core.catalog_public_areas(p_country text)
  RETURNS TABLE (country_code text, city text, area_label text, timezone text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT DISTINCT l.country_code, loc.city, loc.area_label, c.time_zone
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
    JOIN core.catalog_location AS loc ON loc.id = v.home_location_id
    JOIN core.config_country AS c ON c.code::text = l.country_code
   WHERE l.status = 'LISTED'
     -- US-223 (ADR-175) : annonce sur demande seulement si le mode est ouvert dans son pays
     AND (l.instant_book OR core.catalog_request_mode_hours(l.country_code) IS NOT NULL)
     AND (p_country IS NULL OR l.country_code = p_country)
     AND v.released_at IS NULL
     AND core.catalog_search_host_open(l.org_id, l.country_code)
   ORDER BY 1, 2, 3 NULLS FIRST
   LIMIT 500
$fn$;
COMMENT ON FUNCTION core.catalog_public_areas(text) IS
  'Villes et zones de remise des annonces cherchables (LISTED, hôte activable ; sur demande '
  'seulement si le mode est ouvert dans le pays), fuseau du pays ; colonnes C0 seulement. '
  'SECURITY DEFINER, EXECUTE app_api. US-201 (ADR-127), US-223 (ADR-175).';

-- 5. Recherche (0103 §4, corps recopié ; seul le filtre du mode change) ---------------------------
CREATE OR REPLACE FUNCTION core.catalog_public_search(p_country text, p_city text, p_area text,
                                                      p_start_local timestamp,
                                                      p_end_local timestamp, p_limit integer)
  RETURNS TABLE (outcome text, listing_id uuid, daily_price_minor bigint, currency text,
                 instant_book boolean, make_name text, model_name text, year integer,
                 transmission text, seats smallint, fuel_type text, location_kind text,
                 city text, area_label text, geo_public_lat numeric, geo_public_lng numeric,
                 timezone text, start_at timestamptz, end_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tz       text;
  v_now      timestamptz := platform.now();
  v_start    timestamptz;
  v_end      timestamptz;
  v_max_days integer;
  v_buffer   integer;
  v_limit    integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_request  boolean;
BEGIN
  SELECT cc.time_zone INTO v_tz FROM core.config_country AS cc WHERE cc.code::text = p_country;
  IF v_tz IS NULL OR p_city IS NULL OR pg_catalog.btrim(p_city) = '' THEN
    outcome := 'SEARCH_LOCATION_REQUIRED';
    RETURN NEXT;
    RETURN;
  END IF;
  -- heures locales au pas de 30 min (08 BR-BOOK-03), bornes finies
  IF p_start_local IS NULL OR p_end_local IS NULL
     OR NOT pg_catalog.isfinite(p_start_local) OR NOT pg_catalog.isfinite(p_end_local)
     OR pg_catalog.date_trunc('minute', p_start_local) <> p_start_local
     OR pg_catalog.date_trunc('minute', p_end_local) <> p_end_local
     OR pg_catalog.date_part('minute', p_start_local)::integer % 30 <> 0
     OR pg_catalog.date_part('minute', p_end_local)::integer % 30 <> 0 THEN
    outcome := 'SEARCH_DATES_INVALID';
    RETURN NEXT;
    RETURN;
  END IF;
  -- fuseau du pays du lieu (critère 3) ; fin après le début, début dans le futur (16 SRC-001)
  v_start := p_start_local AT TIME ZONE v_tz;
  v_end   := p_end_local AT TIME ZONE v_tz;
  IF v_end <= v_start OR v_start <= v_now THEN
    outcome := 'SEARCH_DATES_INVALID';
    RETURN NEXT;
    RETURN;
  END IF;
  v_max_days := core.catalog_search_param_int('max_trip_days', p_country);
  v_buffer   := core.catalog_search_param_int('buffer_minutes', p_country);
  IF v_max_days IS NULL OR v_max_days < 1 OR v_buffer IS NULL THEN
    outcome := 'SEARCH_UNAVAILABLE';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_end - v_start > pg_catalog.make_interval(days => v_max_days) THEN
    outcome := 'SEARCH_DURATION_EXCEEDED';
    RETURN NEXT;
    RETURN;
  END IF;
  -- US-223 (ADR-175) : annonces sur demande seulement si le mode est ouvert dans le pays
  v_request := core.catalog_request_mode_hours(p_country) IS NOT NULL;

  RETURN QUERY
  SELECT 'OK'::text, l.id, l.daily_price_minor, l.currency, l.instant_book,
         COALESCE(mk.name, v.make_text), COALESCE(mo.name, v.model_text), v.year,
         v.transmission, v.seats, v.fuel_type, loc.kind, loc.city, loc.area_label,
         loc.geo_public[1]::numeric, loc.geo_public[0]::numeric, v.timezone, p.s, p.e
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
    JOIN core.catalog_location AS loc ON loc.id = v.home_location_id
    LEFT JOIN core.catalog_vehicle_variant AS va ON va.id = v.variant_id
    LEFT JOIN core.catalog_vehicle_model AS mo ON mo.id = va.model_id
    LEFT JOIN core.catalog_vehicle_make AS mk ON mk.id = mo.make_id
    -- période dans le fuseau du véhicule (hérité du pays), préavis du lieu du véhicule
    CROSS JOIN LATERAL (SELECT p_start_local AT TIME ZONE v.timezone AS s,
                               p_end_local AT TIME ZONE v.timezone AS e,
                               core.catalog_effective_notice_minutes(v.id) AS notice) AS p
   WHERE l.status = 'LISTED'
     AND (l.instant_book OR v_request)
     AND l.country_code = p_country
     AND loc.city = p_city
     AND (p_area IS NULL OR loc.area_label = p_area)
     AND v.released_at IS NULL
     AND core.catalog_search_host_open(l.org_id, p_country)
     AND p.e > p.s
     AND p.notice IS NOT NULL
     AND p.s >= v_now + pg_catalog.make_interval(mins => p.notice)
     AND core.catalog_vehicle_is_free(
           v.id, pg_catalog.tstzrange(p.s, p.e + pg_catalog.make_interval(mins => v_buffer), '[)'))
         IS TRUE
   ORDER BY l.published_at DESC NULLS LAST, l.id
   LIMIT v_limit;
END
$fn$;
COMMENT ON FUNCTION core.catalog_public_search(text, text, text, timestamp, timestamp, integer) IS
  'Recherche publique : annonces LISTED d''hôtes activables de la ville (et zone) libres sur la '
  'période locale (pas de 30 min, préavis, tampon, sonde vehicle_is_free), à réservation immédiate, '
  'ou sur demande si le mode est ouvert dans le pays ; colonnes C0 et instants dans le fuseau du '
  'véhicule ; issue de refus sinon. SECURITY DEFINER, EXECUTE app_api. US-201 (ADR-127), US-223 '
  '(ADR-175).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
