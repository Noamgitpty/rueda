-- 0101 — CAT : recherche publique par zone, lieu de remise, dates et heures.
-- US-201 ; 19 US-201 (critères 1 à 4) ; 16 SRC-001 / SRC-002 (bêta : liste des villes et zones
-- déclarées par les hôtes, `SEARCH_DATES_INVALID`, `SEARCH_LOCATION_REQUIRED`,
-- `SEARCH_DURATION_EXCEEDED`), LST-007 ; 08 BR-BOOK-03 (pas de 30 min), BR-BOOK-04 (préavis),
-- BR-BOOK-05 (tampon), BR-BOOK-06 ; 17 §0.1 (interrupteurs), §2.3 (sonde `catalog.vehicle_is_free`,
-- RLS-15, RLS-17, `availability_probe_per_minute`), §3.2.3, §7.2 (`max_trip_days`,
-- `buffer_minutes`) ; 22 OQ-P2P-05 ; BOARD N-78 ; pré-mortem du lot 2 L2-PM-13, L2-PM-29,
-- L2-PM-32 ; L1-PM-19 ; ADR-099, ADR-101, ADR-114 ; ADR-128 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-128, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - lecture seule, aucune écriture : deux fonctions `SECURITY DEFINER` (propriétaire
--     catalog_cmd_owner, déjà propriétaire de la fiche publique `core.catalog_public_listing`),
--     EXECUTE au seul app_api (route publique de l'API, comme la fiche ; ni app_worker ni
--     app_anon) ;
--   - n'apparaissent que les annonces LISTED d'hôtes ACTIVABLES : compte d'hôte ACTIVE, titulaire
--     sans restriction active, pays ouvert (`p2p_private_hosts_enabled`) et contrat d'assureur
--     actif (`insurer_contract_active`) ; interrupteur absent = false (17 §0.1) : en production,
--     tant que le fondateur n'a rien ouvert, la recherche est VIDE ; véhicule non libéré ;
--   - colonnes C0 seulement (celles de la fiche publique) : ville, zone saisie par l'hôte et point
--     arrondi au centième de degré ; jamais le nom ni l'adresse du lieu, son point exact, la
--     plaque, le VIN, le compte d'hôte ni l'occupation (L1-PM-19, L2-PM-29) ;
--   - dates et heures saisies en heure LOCALE du lieu (pas de 30 min), converties dans le fuseau
--     du pays pour les contrôles et dans celui du véhicule pour la disponibilité ; l'instant UTC
--     rendu porte le fuseau du véhicule (critère 3, L2-PM-13) ; horloge : `platform.now()` ;
--   - refus (issue rendue, aucune exception) : pays inconnu ou ville absente ⇒
--     SEARCH_LOCATION_REQUIRED ; date mal formée, hors pas de 30 min, fin ≤ début ou début passé
--     ⇒ SEARCH_DATES_INVALID ; durée > `max_trip_days` ⇒ SEARCH_DURATION_EXCEEDED ; paramètre du
--     pays absent ⇒ SEARCH_UNAVAILABLE (fail-closed) ;
--   - disponibilité lue UNIQUEMENT par la sonde `core.catalog_vehicle_is_free` (RLS-17) sur la
--     période occupée [début, fin + `buffer_minutes`) (BR-BOOK-05, même période que la pose d'un
--     hold) : arrondie à l'heure par la sonde, elle ne révèle ni les bornes d'un trip ni un hold à
--     la seconde ; un hold vivant ou un blocage de l'hôte écarte le véhicule ; le préavis du lieu
--     (`core.catalog_effective_notice_minutes`) aussi (préavis inconnu : écarté). La limite de
--     débit `availability_probe_per_minute` est appliquée par l'API (17 §2.3) ;
--   - au plus 50 résultats (défaut 20), les plus récemment publiés d'abord ; au plus 500 zones.
--
-- Expand / contract : fonctions, politiques et droits ajoutés ; aucune table ni colonne modifiée.
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_public_search(text, text, text, timestamp, timestamp, integer),
--     core.catalog_public_search_areas(text), core.catalog_search_host_open(uuid, text),
--     core.catalog_search_param_int(text, text) ;
--   DROP POLICY catalog_cmd_search_read ON core.config_param_value, core.iam_restriction ;
--   REVOKE SELECT (user_id, active) ON core.iam_restriction FROM catalog_cmd_owner ;
--   REVOKE EXECUTE ON FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) FROM catalog_cmd_owner.

-- 1. Droits de catalog_cmd_owner, au plus juste -------------------------------------------------
-- sonde de disponibilité (seule lecture de l'occupation par la recherche, RLS-17) ; le droit est
-- donné par son propriétaire (migrator n'en est que membre, mécanique de 0067 pour policy_fn_owner)
SET LOCAL ROLE catalog_probe_owner;
GRANT EXECUTE ON FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) TO catalog_cmd_owner;
RESET ROLE;
-- durée maximale d'un trip et tampon entre trips du pays (17 §7.2) : ces deux clés seulement
CREATE POLICY catalog_cmd_search_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('max_trip_days', 'buffer_minutes'));
-- restriction active du titulaire du compte d'hôte (la pose d'un hold la refuse) : existence seule
GRANT SELECT (user_id, active) ON core.iam_restriction TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_search_read ON core.iam_restriction FOR SELECT TO catalog_cmd_owner
  USING (active);

-- 2. Aides internes (SECURITY INVOKER, EXECUTE au seul catalog_cmd_owner) -------------------------
-- 2.1 Entier d'un paramètre du pays en vigueur à platform.now() ; NULL si absent ou mal formé.
CREATE FUNCTION core.catalog_search_param_int(p_key text, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (pv.value #>> '{}')::integer
    FROM core.config_param_value AS pv
   WHERE pv.key = p_key AND pv.country_code::text = p_country AND pv.scope_type = 'COUNTRY'
     AND pv.valid_from <= platform.now()
     AND (pv.valid_to IS NULL OR pv.valid_to > platform.now())
     AND pg_catalog.jsonb_typeof(pv.value) = 'number' AND (pv.value #>> '{}') ~ '^[0-9]{1,6}$'
   ORDER BY pv.valid_from DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.catalog_search_param_int(text, text) IS
  'Entier d''un paramètre du pays (portée COUNTRY) en vigueur à platform.now() ; NULL si absent. '
  'Aide de la recherche sous catalog_cmd_owner. US-201 (ADR-128).';

-- 2.2 Hôte activable dans le pays : compte ACTIVE, titulaire sans restriction active, pays ouvert
-- aux hôtes particuliers et contrat d'assureur actif (interrupteurs, absent = false).
CREATE FUNCTION core.catalog_search_host_open(p_org uuid, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           EXISTS (SELECT 1
                     FROM core.iam_organization AS o
                    WHERE o.id = p_org AND o.status = 'ACTIVE'
                      AND NOT EXISTS (SELECT 1 FROM core.iam_restriction AS r
                                       WHERE r.user_id = o.holder_user_id AND r.active))
           AND core.config_go_live('p2p_private_hosts_enabled', p_country)
           AND core.config_go_live('insurer_contract_active', p_country),
           false)
$fn$;
COMMENT ON FUNCTION core.catalog_search_host_open(uuid, text) IS
  'Hôte activable : compte ACTIVE, titulaire sans restriction active, p2p_private_hosts_enabled '
  'et insurer_contract_active ouverts dans le pays (absent = false). Aide de la recherche sous '
  'catalog_cmd_owner. US-201 (ADR-128).';

REVOKE ALL ON FUNCTION core.catalog_search_param_int(text, text),
  core.catalog_search_host_open(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_search_param_int(text, text),
  core.catalog_search_host_open(uuid, text) TO catalog_cmd_owner;

-- 3. Zones de remise proposées au visiteur (16 SRC-001, bêta : liste au lieu de l'autocomplétion)
-- Villes et zones saisies par les hôtes des annonces cherchables, sans doublon, avec le fuseau du
-- pays ; `p_country` NULL : tous les pays. Rien d'autre (ni nombre d'annonces, ni point).
CREATE FUNCTION core.catalog_public_search_areas(p_country text)
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
     AND (p_country IS NULL OR l.country_code = p_country)
     AND v.released_at IS NULL
     AND core.catalog_search_host_open(l.org_id, l.country_code)
   ORDER BY 1, 2, 3 NULLS FIRST
   LIMIT 500
$fn$;
COMMENT ON FUNCTION core.catalog_public_search_areas(text) IS
  'Villes et zones de remise des annonces cherchables (LISTED, hôte activable), fuseau du pays ; '
  'colonnes C0 seulement. SECURITY DEFINER, EXECUTE app_api. US-201 (ADR-128).';

-- 4. Recherche (16 SRC-001 ; 19 US-201) -----------------------------------------------------------
-- Une ligne par annonce disponible (issue OK), ou UNE ligne d'issue de refus (colonnes nulles).
-- Aucune ligne : recherche valide sans résultat (SEARCH_NO_RESULTS est un état, 16 SRC-008).
CREATE FUNCTION core.catalog_public_search(p_country text, p_city text, p_area text,
                                           p_start_local timestamp, p_end_local timestamp,
                                           p_limit integer)
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
  'période locale (pas de 30 min, préavis, tampon, sonde vehicle_is_free) ; colonnes C0 et '
  'instants dans le fuseau du véhicule ; issue de refus sinon. SECURITY DEFINER, EXECUTE app_api. '
  'US-201 (ADR-128).';

REVOKE ALL ON FUNCTION core.catalog_public_search_areas(text),
  core.catalog_public_search(text, text, text, timestamp, timestamp, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_search_areas(text),
  core.catalog_public_search(text, text, text, timestamp, timestamp, integer) TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement, mécanique de 0047 / 0061)
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_search_areas(text) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_search(text, text, text, timestamp, timestamp, integer)
  OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
