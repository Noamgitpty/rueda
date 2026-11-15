-- 0101 — AVL : lecture des trips de l'hôte (espace hôte, accueil A02 et réservations A05).
-- US-219 ; 19 US-219 (« Given une confirmation à 10:00, When l'hôte rafraîchit à 10:01, Then le
-- trip apparaît en tête des prochaines remises » ; « Given un trip, When l'hôte l'ouvre, Then il voit
-- le prénom, l'âge, la note et le statut de vérification du voyageur, jamais le numéro de permis ni
-- l'image d'une pièce (`host_guest_v`, US-062) » ; « Given l'hôte A, When il appelle la liste des trips
-- de l'hôte B, Then 0 ligne ») ; 16 HDB-001 / HDB-002 (onglets À venir / En cours / Terminés /
-- Annulés ; colonnes n° de réservation, véhicule, voyageur, début et fin, statut du paiement, gains
-- estimés de la jambe `HOST` ; filtres par véhicule et date ; « montant de la jambe `HOST` seul
-- (RLS-28 : titulaire seulement) ») ; 17 §2.3 (`host_guest_v`, RLS-2, RLS-9, RLS-28, point 5 :
-- IDOR) ; 10b §3.8 UX-39, UX-43 ; pré-mortem du lot 2 : L2-PM-10, L2-PM-35 ; ADR-064 ; ADR-128
-- (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-128, PROPOSÉS) :
--   - LECTURE SEULE : aucune table, aucune écriture ; l'état du trip ne change que par les commandes
--     d'US-207 (0099) ;
--   - une fonction `core.booking_host_trips(jeton, compte, onglet, véhicule, du, au, trip, limite)`,
--     SECURITY DEFINER sous `host_view_owner` (propriétaire des vues minimisées de l'hôte, US-062),
--     EXECUTE au seul `app_api`. L'hôte est celui de la SESSION (empreinte du jeton) ; le compte
--     demandé doit être l'un de ses comptes d'hôte TITULAIRES (`core.iam_host_accounts`, US-107) ;
--     sinon une seule ligne `FORBIDDEN` et aucun trip (l'API répond 404, rien n'est révélé de
--     l'existence du compte ni du trip, 17 §2.3 point 5) ;
--   - minimisation (NOUVELLE-16, 17 `host_guest_v`) : du voyageur, seuls le prénom, l'âge (années
--     révolues à la date locale du trip), la note (NULL : agrégat des avis à venir, US-218) et le
--     statut de vérification (identité APPROVED, courante et non échue) ; jamais son identifiant, son
--     nom, son contact, son permis ni une pièce. Compte pseudonymisé : ni prénom, ni âge ;
--   - gains estimés : montant EXPLICITE de la jambe `HOST` de l'opération qui a converti le hold en
--     trip (`payment_operation_leg`, 08 E7 règle 1), jamais recalculé ; NULL pour un trip annulé (le
--     règlement d'une annulation n'est pas une estimation, US-314 / US-541). Titulaire seulement
--     (RLS-28) : `iam_host_accounts` ne rend que ses comptes titulaires ;
--   - onglets (16 HDB-002) : UPCOMING (BOOKED, CHECKIN_OPEN), IN_PROGRESS (START_WINDOW_EXPIRED,
--     IN_PROGRESS, OVERDUE, UNRETURNED), DONE (RETURNED, TERMINATED_EARLY, VEHICLE_LOST, POST_TRIP,
--     COMPLETED, IN_DISPUTE), CANCELLED (CANCELLED_BY_*, REFUSED_AT_PICKUP, NO_SHOW_*). À venir :
--     début le plus proche d'abord (prochaines remises en tête, UX-39) ; en cours : fin la plus
--     proche d'abord (prochains retours) ; terminés et annulés : les plus récents d'abord ;
--   - filtres : véhicule ; dates locales du trip (fuseau figé `booking_trip.timezone`, celui du pays),
--     un trip est retenu s'il chevauche [du, au] ; limite bornée à 200 lignes.
--
-- Issues rendues (jamais levées) : DONE (une ligne par trip, zéro ligne possible), FORBIDDEN
-- (compte d'un autre hôte ou session invalide), REQUEST_INVALID (onglet inconnu, limite hors
-- [1, 200], période inversée).
--
-- Retour arrière :
--   DROP FUNCTION core.booking_host_trips(bytea, uuid, text, uuid, date, date, uuid, integer) ;
--   DROP POLICY host_view_read ON core.booking_checkout_hold ;
--   DROP POLICY host_view_read ON core.payment_payment_operation_leg ;
--   DROP POLICY host_view_read ON core.kyc_identity_verification ;
--   REVOKE les droits accordés ci-dessous à host_view_owner (colonnes de booking_trip au-delà de
--   0035, booking_checkout_hold, payment_payment_operation_leg, kyc_identity_verification, EXECUTE de
--   core.iam_host_accounts).

-- 1. Lectures de host_view_owner ------------------------------------------------------------------
-- comptes d'hôte titulaires de la session (fonction d'iam_auth_owner : seul son propriétaire
-- accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_host_accounts(bytea) TO host_view_owner;
RESET ROLE;

-- trip : colonnes d'affichage (0035 accordait id, org_id, vehicle_id, guest_user_id, timezone ;
-- politique host_view_read de 0035 inchangée)
GRANT SELECT (public_ref, country_code, currency, scheduled_start, scheduled_end, booked_at,
              status, payment_status, source_hold_id)
  ON core.booking_trip TO host_view_owner;

-- opération de conversion du hold d'origine, puis sa jambe HOST (montant explicite)
GRANT SELECT (id, conversion_operation_id) ON core.booking_checkout_hold TO host_view_owner;
CREATE POLICY host_view_read ON core.booking_checkout_hold FOR SELECT TO host_view_owner
  USING (true);
GRANT SELECT (operation_id, leg, amount_minor) ON core.payment_payment_operation_leg
  TO host_view_owner;
CREATE POLICY host_view_read ON core.payment_payment_operation_leg FOR SELECT TO host_view_owner
  USING (true);

-- statut de vérification d'identité du voyageur : statut seulement, jamais le dossier
GRANT SELECT (user_id, status, is_current, expires_at) ON core.kyc_identity_verification
  TO host_view_owner;
CREATE POLICY host_view_read ON core.kyc_identity_verification FOR SELECT TO host_view_owner
  USING (true);

-- 2. Trips du compte d'hôte de la session (A02, A05) ----------------------------------------------
-- créée sous migrator, EXECUTE accordé, puis cédée à host_view_owner (comme 0035)
CREATE FUNCTION core.booking_host_trips(p_token_hash bytea, p_org uuid, p_tab text,
                                        p_vehicle_id uuid, p_from date, p_to date,
                                        p_trip_id uuid, p_limit integer)
  RETURNS TABLE (outcome text, trip_id uuid, public_ref text, tab text, status text,
                 vehicle_id uuid, scheduled_start timestamptz, scheduled_end timestamptz,
                 timezone text, booked_at timestamptz, payment_status text, currency text,
                 host_leg_minor bigint, guest_first_name text, guest_age_years integer,
                 guest_rating numeric, guest_verified boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country text;
BEGIN
  IF (p_tab IS NOT NULL AND p_tab NOT IN ('UPCOMING', 'IN_PROGRESS', 'DONE', 'CANCELLED'))
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to < p_from) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::integer, NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  -- compte d'hôte titulaire de la session (IDOR : jamais un identifiant d'hôte reçu)
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a
   WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::integer, NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, t.id, t.public_ref, x.tab, t.status, t.vehicle_id, t.scheduled_start,
         t.scheduled_end, t.timezone, t.booked_at, t.payment_status, t.currency,
         CASE WHEN x.tab = 'CANCELLED' THEN NULL::bigint
              ELSE (SELECT l.amount_minor
                      FROM core.booking_checkout_hold AS h
                      JOIN core.payment_payment_operation_leg AS l
                        ON l.operation_id = h.conversion_operation_id AND l.leg = 'HOST'
                     WHERE h.id = t.source_hold_id)
         END,
         CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END,
         CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
              THEN pg_catalog.date_part('year',
                     pg_catalog.age((platform.now() AT TIME ZONE t.timezone)::date::timestamp,
                                    u.date_of_birth::timestamp))::integer
         END,
         NULL::numeric,      -- note du voyageur : rating_aggregate (story des avis, US-218)
         EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                  WHERE v.user_id = t.guest_user_id AND v.is_current AND v.status = 'APPROVED'
                    AND (v.expires_at IS NULL OR v.expires_at > platform.now()))
    FROM core.booking_trip AS t
    JOIN core.iam_user_account AS u ON u.id = t.guest_user_id
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN t.status IN ('BOOKED', 'CHECKIN_OPEN') THEN 'UPCOMING'
               WHEN t.status IN ('START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'UNRETURNED')
                 THEN 'IN_PROGRESS'
               WHEN t.status IN ('RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                                 'COMPLETED', 'IN_DISPUTE') THEN 'DONE'
               ELSE 'CANCELLED'
             END) AS x(tab)
   WHERE t.org_id = p_org
     AND t.country_code = v_country
     AND (p_trip_id IS NULL OR t.id = p_trip_id)
     AND (p_tab IS NULL OR x.tab = p_tab)
     AND (p_vehicle_id IS NULL OR t.vehicle_id = p_vehicle_id)
     AND (p_from IS NULL OR t.scheduled_end > (p_from::timestamp AT TIME ZONE t.timezone))
     AND (p_to IS NULL OR t.scheduled_start < ((p_to + 1)::timestamp AT TIME ZONE t.timezone))
   ORDER BY CASE x.tab WHEN 'UPCOMING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'DONE' THEN 2
                       ELSE 3 END,
            CASE WHEN x.tab = 'UPCOMING' THEN t.scheduled_start
                 WHEN x.tab = 'IN_PROGRESS' THEN t.scheduled_end END ASC NULLS LAST,
            t.scheduled_start DESC, t.id
   LIMIT p_limit;
END
$fn$;

COMMENT ON FUNCTION core.booking_host_trips(bytea, uuid, text, uuid, date, date, uuid, integer) IS
  'Trips du compte d''hôte titulaire de la session (A02, A05) : onglet, véhicule, période locale, '
  'statut du paiement, jambe HOST de la conversion ; du voyageur : prénom, âge, note, vérification '
  '(host_guest_v), rien d''autre. FORBIDDEN pour un autre compte. SECURITY DEFINER, EXECUTE '
  'app_api. US-219 (ADR-128).';

REVOKE ALL ON FUNCTION core.booking_host_trips(bytea, uuid, text, uuid, date, date, uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_host_trips(bytea, uuid, text, uuid, date, date, uuid, integer)
  TO app_api;

GRANT CREATE ON SCHEMA core TO host_view_owner;
ALTER FUNCTION core.booking_host_trips(bytea, uuid, text, uuid, date, date, uuid, integer)
  OWNER TO host_view_owner;
REVOKE CREATE ON SCHEMA core FROM host_view_owner;
