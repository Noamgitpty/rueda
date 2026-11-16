-- 0106 — CAT : fiche du véhicule (S03) : galerie, contrôle des dates, lieu de remise exact.
-- US-204 ; 19 US-204 (critères 1 à 3) ; 16 LST-002 (galerie : ordre de l'hôte, photo en erreur
-- remplacée), LST-003 / LST-020 (bêta SIMPLIFIÉ), LST-006 (`DATES_NOTICE_TOO_SHORT`,
-- `DATES_UNAVAILABLE` ; LST-008 DIFFÉRÉ : le sélecteur refuse les dates occupées), LST-007 (zone
-- avant la réservation, adresse exacte au `GUEST` du trip après `BOOKED`) ; 08 BR-BOOK-02
-- (masquage avant réservation), BR-BOOK-03 (pas de 30 min), BR-BOOK-04 (préavis), BR-BOOK-05
-- (tampon), BR-BOOK-09 (lieu de remise), BR-LIST-05 (photos) ; 17 §2.3 (sonde
-- `catalog.vehicle_is_free`, RLS-15, RLS-17), §3.2.3, §7.2 ; 22 OQ-P2P-05 ; pré-mortem du lot 2
-- L2-PM-29 ; ADR-099, ADR-101, ADR-127 ; ADR-132 (cette migration). Appliquée sous `migrator`, en
-- une transaction.
--
-- Principes (ADR-132, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - lecture seule, aucune écriture : trois fonctions `SECURITY DEFINER` (propriétaire
--     catalog_cmd_owner, déjà propriétaire de la fiche publique et de la recherche), EXECUTE au
--     seul app_api ;
--   - galerie (`core.catalog_public_gallery`) : photos NON RETIRÉES et NON REFUSÉES d'une annonce
--     LISTED, dans l'ordre de l'hôte (`position`), au plus 50 ; identifiant et clé de dépôt
--     (bucket public PUBLIC_LISTING, C0, métadonnées retirées au dépôt) seulement : ni le texte
--     libre `alt_text`, ni le fichier, ni l'auteur. Même règle que la publication (0084 : une
--     photo compte tant qu'elle n'est pas refusée), il n'existe pas de revue photo par photo
--     (`listing_manual_review_required` = false, DEC-FONDATEUR-22) ;
--   - contrôle des dates de la fiche (`core.catalog_public_slot_check`) : heures LOCALES du lieu
--     au pas de 30 min, converties dans le fuseau du véhicule (hérité du pays) ; mêmes refus que la
--     recherche d'US-201 (SEARCH_DATES_INVALID, SEARCH_DURATION_EXCEEDED, SEARCH_UNAVAILABLE),
--     puis le PRÉAVIS du lieu (`core.catalog_effective_notice_minutes`, borne incluse comme la
--     pose d'un hold) ⇒ DATES_NOTICE_TOO_SHORT avec le préavis en minutes (le voyageur sait quoi
--     changer), puis l'hôte activable et la sonde `core.catalog_vehicle_is_free` sur
--     [début, fin + `buffer_minutes`) ⇒ DATES_UNAVAILABLE, sans rien de l'occupation en cause
--     (booléen arrondi à l'heure par la sonde, RLS-17). La limite de débit
--     `availability_probe_per_minute` est appliquée par l'API, comme pour la recherche ;
--   - lieu de remise exact (`core.catalog_guest_meeting_point`) : libellé et adresse du lieu du
--     véhicule de l'annonce, rendus au SEUL voyageur de la session (empreinte du jeton) qui a un
--     trip de ce véhicule dans un état confirmé et non terminé (BOOKED, CHECKIN_OPEN,
--     START_WINDOW_EXPIRED, IN_PROGRESS, OVERDUE) ; tout autre cas (visiteur, autre voyageur,
--     trip annulé ou terminé, session invalide) : aucune ligne, sans rien révéler. Jamais le
--     point exact, le compte d'hôte ni le trip. La vue du trip après le retour, jusqu'à la purge à
--     fin + `review_window_days`, reste à US-514 (fail-closed : moins tôt retiré, jamais plus
--     longtemps montré) ;
--   - `catalog_cmd_owner` reçoit la lecture de trois colonnes de `booking_trip` (voyageur,
--     véhicule, statut), politique bornée aux états confirmés non terminés ; aucun autre droit.
--
-- Expand / contract : fonctions, politique et droit ajoutés ; aucune table ni colonne modifiée.
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_public_gallery(uuid),
--     core.catalog_public_slot_check(uuid, timestamp, timestamp),
--     core.catalog_guest_meeting_point(bytea, uuid) ;
--   DROP POLICY catalog_cmd_guest_read ON core.booking_trip ;
--   REVOKE SELECT (guest_user_id, vehicle_id, status) ON core.booking_trip FROM catalog_cmd_owner.

-- 1. Lecture des trips du voyageur par catalog_cmd_owner (trois colonnes, états confirmés) -------
GRANT SELECT (guest_user_id, vehicle_id, status) ON core.booking_trip TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_guest_read ON core.booking_trip FOR SELECT TO catalog_cmd_owner
  USING (status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE'));

-- 2. Galerie de la fiche (16 LST-002 ; 19 US-204 critère 1) ----------------------------------------
-- Photos de l'annonce LISTED dans l'ordre de l'hôte ; annonce inconnue ou non publiée : 0 ligne.
CREATE FUNCTION core.catalog_public_gallery(p_listing_id uuid)
  RETURNS TABLE (photo_id uuid, photo_order smallint, storage_key text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.id, p.position,
         -- clé de dépôt de la commande d'ajout (0097) : listing/<annonce>/<photo>
         'listing/' || l.id::text || '/' || p.id::text
    FROM core.catalog_listing AS l
    JOIN core.catalog_listing_photo AS p ON p.listing_id = l.id
   WHERE l.id = p_listing_id AND l.status = 'LISTED'
     AND p.deleted_at IS NULL AND p.status <> 'REJECTED'
   ORDER BY p.position, p.id
   LIMIT 50
$fn$;
COMMENT ON FUNCTION core.catalog_public_gallery(uuid) IS
  'Galerie d''une annonce LISTED : photos non retirées et non refusées, ordre de l''hôte, au plus '
  '50 ; identifiant, rang et clé du bucket public seulement. SECURITY DEFINER, EXECUTE app_api. '
  'US-204 (ADR-132).';

-- 3. Dates choisies sur la fiche (16 LST-006 ; 19 US-204 critère 2) --------------------------------
-- UNE ligne : issue OK (instants UTC, fuseau du véhicule, préavis) ou issue de refus.
CREATE FUNCTION core.catalog_public_slot_check(p_listing_id uuid, p_start_local timestamp,
                                               p_end_local timestamp)
  RETURNS TABLE (outcome text, start_at timestamptz, end_at timestamptz, timezone text,
                 notice_minutes integer)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now      timestamptz := platform.now();
  v_country  text;
  v_org      uuid;
  v_vehicle  uuid;
  v_tz       text;
  v_released timestamptz;
  v_start    timestamptz;
  v_end      timestamptz;
  v_max_days integer;
  v_buffer   integer;
  v_notice   integer;
BEGIN
  SELECT l.country_code, l.org_id, v.id, v.timezone, v.released_at
    INTO v_country, v_org, v_vehicle, v_tz, v_released
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
   WHERE l.id = p_listing_id AND l.status = 'LISTED';
  IF v_vehicle IS NULL THEN
    outcome := 'LISTING_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;
  -- heures locales au pas de 30 min (08 BR-BOOK-03), bornes finies (même règle que 0103)
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
  v_start := p_start_local AT TIME ZONE v_tz;
  v_end   := p_end_local AT TIME ZONE v_tz;
  IF v_end <= v_start OR v_start <= v_now THEN
    outcome := 'SEARCH_DATES_INVALID';
    RETURN NEXT;
    RETURN;
  END IF;
  v_max_days := core.catalog_search_param_int('max_trip_days', v_country);
  v_buffer   := core.catalog_search_param_int('buffer_minutes', v_country);
  v_notice   := core.catalog_effective_notice_minutes(v_vehicle);
  IF v_max_days IS NULL OR v_max_days < 1 OR v_buffer IS NULL OR v_notice IS NULL THEN
    outcome := 'SEARCH_UNAVAILABLE';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_end - v_start > pg_catalog.make_interval(days => v_max_days) THEN
    outcome := 'SEARCH_DURATION_EXCEEDED';
    RETURN NEXT;
    RETURN;
  END IF;
  -- préavis du lieu (16 CAL-003, LST-006) : borne incluse, comme la pose d'un hold (0071)
  IF v_start < v_now + pg_catalog.make_interval(mins => v_notice) THEN
    outcome := 'DATES_NOTICE_TOO_SHORT';
    notice_minutes := v_notice;
    RETURN NEXT;
    RETURN;
  END IF;
  -- hôte activable et véhicule libre sur la période et son tampon (sonde RLS-17, sans détail)
  IF v_released IS NOT NULL
     OR NOT core.catalog_search_host_open(v_org, v_country)
     OR core.catalog_vehicle_is_free(
          v_vehicle,
          pg_catalog.tstzrange(v_start, v_end + pg_catalog.make_interval(mins => v_buffer), '[)'))
        IS NOT TRUE THEN
    outcome := 'DATES_UNAVAILABLE';
    RETURN NEXT;
    RETURN;
  END IF;
  outcome := 'OK';
  start_at := v_start;
  end_at := v_end;
  timezone := v_tz;
  notice_minutes := v_notice;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.catalog_public_slot_check(uuid, timestamp, timestamp) IS
  'Dates choisies sur la fiche d''une annonce LISTED (heures locales, pas de 30 min) : refus de la '
  'recherche, préavis du lieu (DATES_NOTICE_TOO_SHORT), hôte activable et sonde vehicle_is_free '
  'avec tampon (DATES_UNAVAILABLE) ; une ligne. SECURITY DEFINER, EXECUTE app_api. US-204 '
  '(ADR-132).';

-- 4. Lieu de remise exact, au voyageur d'un trip confirmé (16 LST-007 ; 19 US-204 critère 3) -------
CREATE FUNCTION core.catalog_guest_meeting_point(p_token_hash bytea, p_listing_id uuid)
  RETURNS TABLE (place_label text, address_line text, city text, area_label text,
                 location_kind text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT loc.place_label, loc.address_line, loc.city, loc.area_label, loc.kind
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
    JOIN core.catalog_location AS loc ON loc.id = v.home_location_id
   WHERE l.id = p_listing_id
     AND EXISTS (SELECT 1
                   FROM core.booking_trip AS t
                  WHERE t.guest_user_id = v_user AND t.vehicle_id = v.id
                    AND t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED',
                                     'IN_PROGRESS', 'OVERDUE'));
END
$fn$;
COMMENT ON FUNCTION core.catalog_guest_meeting_point(bytea, uuid) IS
  'Lieu de remise exact (libellé, adresse, ville, zone, type) du véhicule d''une annonce, rendu au '
  'seul voyageur de la session ayant un trip confirmé non terminé de ce véhicule ; sinon 0 ligne. '
  'SECURITY DEFINER, EXECUTE app_api. US-204 (ADR-132).';

REVOKE ALL ON FUNCTION core.catalog_public_gallery(uuid),
  core.catalog_public_slot_check(uuid, timestamp, timestamp),
  core.catalog_guest_meeting_point(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_gallery(uuid),
  core.catalog_public_slot_check(uuid, timestamp, timestamp),
  core.catalog_guest_meeting_point(bytea, uuid) TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement, mécanique de 0047 / 0061 / 0103)
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_gallery(uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_slot_check(uuid, timestamp, timestamp)
  OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_guest_meeting_point(bytea, uuid) OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
