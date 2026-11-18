-- 0144 — AVL / CAT : lieux de prise et de retour (US-514 ; 19 US-514 ; 16 BKG-016 ; 08 BR-BOOK-09 ;
-- 22 OQ-P2P-05 ; ADR-168). Appliquée sous `migrator`, en une transaction.
--
-- Critères de 19 US-514 :
--   1. « Given une demande avec retour différent, When elle est soumise, Then ONE_WAY_NOT_ALLOWED » :
--      lecture `core.booking_checkout_return_place(jeton, devis, lieu de retour)` (cmd_hold_owner,
--      SECURITY DEFINER, EXECUTE app_api). Le voyageur est celui de la SESSION ; le devis doit être
--      le sien (sinon QUOTE_NOT_FOUND, même réponse qu'un devis inconnu). Lieu de prise = lieu du
--      véhicule de l'annonce du devis (`catalog_vehicle.home_location_id`, un seul lieu en bêta) ;
--      lieu de retour absent ou identique ⇒ DONE ; tout autre ⇒ ONE_WAY_NOT_ALLOWED (one-way
--      interdit au lancement, 16 BKG-016, 08 BR-BOOK-09). Rien n'est écrit : le checkout reste la
--      commande `booking_cmd_checkout` (inchangée), appelée par l'API seulement après DONE.
--   2. « Given un trip BOOKED, When le voyageur ouvre le détail, Then l'adresse exacte du lieu de
--      remise s'affiche ; avant confirmation, seule la zone est visible » : déjà vrai (US-115 fiche
--      publique C0, US-204 `catalog_guest_meeting_point`, US-214 `booking_guest_trips`) ; prouvé
--      de nouveau par l0-us514-meeting-place.
--   3. « Given la fin du trip + review_window_days, When la purge tourne, Then l'adresse de l'hôte
--      disparaît de la vue du voyageur » : les deux lectures du voyageur qui rendent l'adresse
--      (`catalog_guest_meeting_point`, `booking_guest_trips`) ne la rendent plus au-delà de la fin
--      prévue du trip + `review_window_days` du pays (horloge de la base, `platform.now()`) ;
--      paramètre absent ou mal formé ⇒ jamais rendue (fail-closed). La « purge » est cette borne,
--      jugée à chaque lecture : l'adresse appartient au lieu de l'hôte (aucune copie sur le trip,
--      aucune donnée à effacer, minimisation). Les états qui la rendent restent ceux d'US-204 et
--      d'US-214 (à venir ou en cours, PROPOSÉ, comme Turo) : la borne ne joue que pour un trip resté
--      en cours ou en retard (OVERDUE, UNRETURNED) au-delà de la fenêtre.
--   Lieu figé à la réservation : un lieu (`catalog_location` : libellé, adresse, ville, zone, point)
--   et le lieu d'un véhicule (`catalog_vehicle.home_location_id`) ne sont modifiables par AUCUN rôle
--   applicatif ni propriétaire de commandes (aucun droit UPDATE sur ces colonnes, 0067, 0071) :
--   le lieu lu pour un trip est celui de sa réservation (prouvé par l0-us514-meeting-place).
--
-- Droits ajoutés (lecture seulement) :
--   - catalog_cmd_owner : SELECT (country_code, scheduled_end) de booking_trip (politique
--     catalog_cmd_guest_read de 0106 inchangée : états confirmés non terminés) ; politique
--     catalog_cmd_meeting_read sur config_param_value (clé review_window_days seulement ;
--     colonnes déjà accordées par 0067) ;
--   - cmd_hold_owner : politique cmd_hold_meeting_read sur config_param_value (clé
--     review_window_days seulement ; colonnes déjà accordées par 0032). Les autres colonnes lues
--     sont déjà accordées (0032, 0067, 0097, 0108, 0122).
--   Politiques AJOUTÉES (permissives), aucune politique existante modifiée.
--
-- Expand / contract : fonction AJOUTÉE ; deux fonctions REMPLACÉES à signature et colonnes
-- identiques (propriétaire, droits EXECUTE et search_path inchangés) ; droits et politiques
-- AJOUTÉS ; aucune table ni colonne.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_checkout_return_place(bytea, uuid, uuid) ;
--   réappliquer les corps de core.catalog_guest_meeting_point (0106) et de
--   core.booking_guest_trips (0136) ;
--   DROP POLICY catalog_cmd_meeting_read ON core.config_param_value ;
--   DROP POLICY cmd_hold_meeting_read ON core.config_param_value ;
--   REVOKE SELECT (country_code, scheduled_end) ON core.booking_trip FROM catalog_cmd_owner.

-- 1. Droits de lecture (fenêtre de la vue de l'adresse) ----------------------------------------------
GRANT SELECT (country_code, scheduled_end) ON core.booking_trip TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_meeting_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key = 'review_window_days');
CREATE POLICY cmd_hold_meeting_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key = 'review_window_days');

-- 2. Lieu exact de la fiche (US-204), borné à fin prévue + review_window_days ----------------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

CREATE OR REPLACE FUNCTION core.catalog_guest_meeting_point(p_token_hash bytea, p_listing_id uuid)
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
  v_now  timestamptz := platform.now();
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
     AND EXISTS (
       SELECT 1
         FROM core.booking_trip AS t
         -- fenêtre du pays du trip, en vigueur ; aucune ligne ou valeur mal formée : rien rendu
         CROSS JOIN LATERAL (
           SELECT CASE WHEN pg_catalog.jsonb_typeof(pv.value) = 'number'
                            AND (pv.value #>> '{}') ~ '^[1-9][0-9]{0,2}$'
                       THEN pg_catalog.make_interval(days => (pv.value #>> '{}')::integer)
                  END AS span
             FROM core.config_param_value AS pv
            WHERE pv.key = 'review_window_days'
              AND pv.country_code::text = t.country_code::text AND pv.scope_type = 'COUNTRY'
              AND pv.valid_from <= v_now AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
            ORDER BY pv.valid_from DESC
            LIMIT 1) AS rw
        WHERE t.guest_user_id = v_user AND t.vehicle_id = v.id
          AND t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS',
                           'OVERDUE')
          AND v_now <= t.scheduled_end + rw.span);
END
$fn$;
COMMENT ON FUNCTION core.catalog_guest_meeting_point(bytea, uuid) IS
  'Lieu de remise exact (libellé, adresse, ville, zone, type) du véhicule d''une annonce, rendu au '
  'seul voyageur de la session ayant un trip confirmé non terminé de ce véhicule, jusqu''à la fin '
  'prévue + review_window_days du pays (paramètre absent : rien) ; sinon 0 ligne. SECURITY '
  'DEFINER, EXECUTE app_api. US-204 (ADR-132), borne US-514 (ADR-168).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 3. Lectures du voyageur (famille cmd_hold, EXECUTE app_api) --------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 3.1 « Mis viajes » et détail du trip (US-214, 0136) : corps repris tel quel, seule l'adresse
-- exacte est bornée à fin prévue + review_window_days du pays.
CREATE OR REPLACE FUNCTION core.booking_guest_trips(p_token_hash bytea, p_tab text, p_trip_id uuid,
                                         p_limit integer)
  RETURNS TABLE (outcome text, kind text, item_id uuid, public_ref text, tab text, status text,
                 payment_status text, currency text, timezone text, starts_at timestamptz,
                 ends_at timestamptz, respond_by timestamptz, vehicle_make text,
                 vehicle_model text, vehicle_year integer, host_name text, place_label text,
                 place_address text, place_city text, total_minor bigint, contract_state text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_now  timestamptz := platform.now();
BEGIN
  IF (p_tab IS NOT NULL
      AND p_tab NOT IN ('REQUESTED', 'UPCOMING', 'IN_PROGRESS', 'DONE', 'CANCELLED'))
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::text,
                        NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::bigint, NULL::text;
    RETURN;
  END IF;
  -- voyageur de la SESSION (IDOR : jamais un identifiant de personne reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::text,
                        NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::bigint, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, i.kind, i.item_id, i.public_ref, i.tab, i.status, i.payment_status,
         i.currency, i.timezone, i.starts_at, i.ends_at, i.respond_by,
         COALESCE(cv.make_text, mk.name), COALESCE(cv.model_text, md.name), cv.year,
         CASE WHEN hu.pseudonymized_at IS NULL AND hu.legal_first_name IS NOT NULL
              THEN hu.legal_first_name
                   || CASE WHEN pg_catalog.btrim(COALESCE(hu.legal_last_name, '')) = '' THEN ''
                           ELSE ' ' || pg_catalog.left(pg_catalog.btrim(hu.legal_last_name), 1)
                                || '.' END
         END,
         CASE WHEN i.kind = 'TRIP' THEN cl.place_label END,
         -- US-514 : adresse exacte bornée à fin prévue + review_window_days du pays (fail-closed)
         CASE WHEN i.kind = 'TRIP' AND i.tab IN ('UPCOMING', 'IN_PROGRESS')
                   AND v_now <= i.ends_at + rw.span THEN cl.address_line
         END,
         CASE WHEN i.kind = 'REQUEST' OR i.tab IN ('UPCOMING', 'IN_PROGRESS') THEN cl.city END,
         pq.total_minor,
         CASE WHEN i.kind <> 'TRIP' THEN NULL
              WHEN cd.id IS NULL THEN 'NONE'
              WHEN cs.id IS NULL THEN 'TO_SIGN'
              ELSE 'SIGNED' END
    FROM (
      -- trips du voyageur de la session
      SELECT 'TRIP'::text AS kind, t.id AS item_id, t.public_ref, x.tab, t.status,
             t.payment_status, t.currency, t.timezone, t.scheduled_start AS starts_at,
             t.scheduled_end AS ends_at, NULL::timestamptz AS respond_by, t.org_id, t.vehicle_id,
             h.quote_id, t.guest_user_id
        FROM core.booking_trip AS t
        LEFT JOIN core.booking_checkout_hold AS h ON h.id = t.source_hold_id
        CROSS JOIN LATERAL (
          SELECT CASE
                   WHEN t.status IN ('BOOKED', 'CHECKIN_OPEN') THEN 'UPCOMING'
                   WHEN t.status IN ('START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'UNRETURNED')
                     THEN 'IN_PROGRESS'
                   WHEN t.status IN ('RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                                     'COMPLETED', 'IN_DISPUTE') THEN 'DONE'
                   ELSE 'CANCELLED'
                 END) AS x(tab)
       WHERE t.guest_user_id = v_user
         AND (p_trip_id IS NULL OR t.id = p_trip_id)
      UNION ALL
      -- demandes en attente de l'hôte (jamais lues par identifiant ici)
      SELECT 'REQUEST'::text, h.id, NULL::text, 'REQUESTED'::text, h.status, NULL::text,
             q.currency, v.timezone, pg_catalog.lower(q.period), pg_catalog.upper(q.period),
             h.request_respond_by, h.org_id, h.vehicle_id, h.quote_id, h.guest_user_id
        FROM core.booking_checkout_hold AS h
        JOIN core.pricing_quote AS q ON q.id = h.quote_id
        JOIN core.catalog_vehicle AS v ON v.id = h.vehicle_id AND v.org_id = h.org_id
       WHERE h.guest_user_id = v_user
         AND h.kind = 'REQUEST'
         AND (h.status = 'AWAITING_HOST'
              OR (h.status = 'PAYMENT_IN_FLIGHT' AND h.request_respond_by IS NOT NULL))
         AND p_trip_id IS NULL
    ) AS i
    LEFT JOIN core.pricing_quote AS pq ON pq.id = i.quote_id
    LEFT JOIN core.catalog_vehicle AS cv ON cv.id = i.vehicle_id AND cv.org_id = i.org_id
    LEFT JOIN core.catalog_vehicle_variant AS va ON va.id = cv.variant_id
    LEFT JOIN core.catalog_vehicle_model AS md ON md.id = va.model_id
    LEFT JOIN core.catalog_vehicle_make AS mk ON mk.id = md.make_id
    LEFT JOIN core.catalog_location AS cl ON cl.id = cv.home_location_id
    -- US-514 : fenêtre de la vue de l'adresse (paramètre du pays du véhicule, en vigueur ; absent ou
    -- mal formé : NULL, adresse jamais rendue)
    LEFT JOIN LATERAL (
      SELECT CASE WHEN pg_catalog.jsonb_typeof(pv.value) = 'number'
                       AND (pv.value #>> '{}') ~ '^[1-9][0-9]{0,2}$'
                  THEN pg_catalog.make_interval(days => (pv.value #>> '{}')::integer) END AS span
        FROM core.config_param_value AS pv
       WHERE i.kind = 'TRIP' AND pv.key = 'review_window_days'
         AND pv.country_code::text = cv.country_code::text AND pv.scope_type = 'COUNTRY'
         AND pv.valid_from <= v_now AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
       ORDER BY pv.valid_from DESC
       LIMIT 1) AS rw ON true
    LEFT JOIN core.iam_organization AS o ON o.id = i.org_id
    LEFT JOIN core.iam_user_account AS hu ON hu.id = o.holder_user_id
    LEFT JOIN LATERAL (
      SELECT d.id FROM core.contract_generated_document AS d
       WHERE i.kind = 'TRIP' AND d.trip_id = i.item_id
       ORDER BY d.version DESC
       LIMIT 1) AS cd ON true
    LEFT JOIN LATERAL (
      SELECT s.id FROM core.contract_signature AS s
       WHERE s.document_id = cd.id AND s.signer_user_id = i.guest_user_id
         AND s.signer_role = 'GUEST'
       LIMIT 1) AS cs ON true
   WHERE p_tab IS NULL OR i.tab = p_tab
   ORDER BY CASE i.tab WHEN 'REQUESTED' THEN 0 WHEN 'UPCOMING' THEN 1 WHEN 'IN_PROGRESS' THEN 2
                       WHEN 'DONE' THEN 3 ELSE 4 END,
            CASE WHEN i.tab IN ('REQUESTED', 'UPCOMING') THEN i.starts_at
                 WHEN i.tab = 'IN_PROGRESS' THEN i.ends_at END ASC NULLS LAST,
            i.starts_at DESC, i.item_id
   LIMIT p_limit;
END
$fn$;

COMMENT ON FUNCTION core.booking_guest_trips(bytea, text, uuid, integer) IS
  'Trips et demandes en attente du voyageur de la session (S08, S09) : onglet, statut, paiement, '
  'période, auto (sans plaque), hôte en prénom et initiale, lieu de remise minimisé (adresse exacte '
  'd''un trip à venir ou en cours, jusqu''à la fin prévue + review_window_days), total du devis '
  'figé (jamais recalculé), état du contrat ; trip d''une autre personne ou inconnu : aucune ligne. '
  'SECURITY DEFINER, EXECUTE app_api. US-214 (ADR-160), borne US-514 (ADR-168).';

-- 3.2 Lieu de retour demandé au checkout (16 BKG-016 : one-way interdit). Lecture seule, aucune
-- écriture : l'API l'appelle avant `booking_cmd_checkout` quand le corps porte un lieu de retour.
CREATE FUNCTION core.booking_checkout_return_place(p_token_hash bytea, p_quote_id uuid,
                                                   p_return_location_id uuid)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_pickup uuid;
BEGIN
  -- voyageur de la SESSION (IDOR : jamais un identifiant de personne reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    outcome := 'AUTH_REQUIRED';
    RETURN NEXT;
    RETURN;
  END IF;
  -- lieu de prise : celui du véhicule de l'annonce du devis du voyageur (même lecture que 0108)
  SELECT v.home_location_id INTO v_pickup
    FROM core.pricing_quote AS pq
    JOIN core.catalog_listing AS l ON l.id = pq.listing_id
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
   WHERE pq.id = p_quote_id AND pq.guest_user_id = v_user;
  IF v_pickup IS NULL THEN
    outcome := 'QUOTE_NOT_FOUND';
  ELSIF p_return_location_id IS NULL OR p_return_location_id = v_pickup THEN
    outcome := 'DONE';
  ELSE
    outcome := 'ONE_WAY_NOT_ALLOWED';
  END IF;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_return_place(bytea, uuid, uuid) IS
  'Lieu de retour demandé au checkout (16 BKG-016) : DONE si absent ou égal au lieu du véhicule du '
  'devis du voyageur de la session, ONE_WAY_NOT_ALLOWED sinon ; devis inconnu ou d''un autre : '
  'QUOTE_NOT_FOUND ; session invalide : AUTH_REQUIRED. Aucune écriture. SECURITY DEFINER, EXECUTE '
  'app_api. US-514 (ADR-168).';

REVOKE ALL ON FUNCTION core.booking_checkout_return_place(bytea, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_return_place(bytea, uuid, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
