-- 0136 — AVL : « Mis viajes » et détail du trip du voyageur (S08, S09), lecture seule.
-- US-214 ; 19 US-214 (« Given un guest A, When il demande le trip de B, Then 404 (RLS-1) » ;
-- « Given un trip BOOKED, When il ouvre le détail, Then contrat, constancia et reçu sont
-- téléchargeables ; toute modification passe par le support en Bêta ») ; 16 BKG-027 (liste « Mis
-- viajes » : à venir, passés, annulés ; détail : documents, statut du paiement, lieu de remise et
-- horaires, hôte ; erreur « trip d'un autre » ; permission : GUEST propriétaire du trip) ;
-- 08 BR-MOD-01 ; 17 §2.3 (RLS-1, point 5 : IDOR) ; 10b S08, S09 ; pré-mortem du lot 2 : L2-PM-10,
-- L2-PM-35 ; ADR-128 (0101, lecture de l'hôte), ADR-143 (0122, contrat) ; ADR-160 (cette
-- migration). Appliquée sous `migrator`, en une transaction.
--
-- Cette migration AJOUTE une fonction de LECTURE (aucune table, aucune écriture de domaine) :
--   `core.booking_guest_trips(jeton, onglet, trip, limite)` (cmd_hold_owner, SECURITY DEFINER,
--   EXECUTE au seul app_api). Le voyageur est celui de la SESSION (empreinte du jeton résolue par
--   `core.iam_session_resolve`), jamais un identifiant reçu. Elle rend :
--     - ses trips (`booking_trip.guest_user_id` = la session), par onglet : UPCOMING (BOOKED,
--       CHECKIN_OPEN), IN_PROGRESS (START_WINDOW_EXPIRED, IN_PROGRESS, OVERDUE, UNRETURNED), DONE
--       (RETURNED, TERMINATED_EARLY, VEHICLE_LOST, POST_TRIP, COMPLETED, IN_DISPUTE), CANCELLED
--       (CANCELLED_BY_*, REFUSED_AT_PICKUP, NO_SHOW_*) : même partition que l'hôte (0101) ;
--     - ses demandes envoyées à l'hôte (hold REQUEST, 0126), onglet REQUESTED, avec l'heure limite
--       de réponse écrite par la base : en attente de l'hôte (AWAITING_HOST) ou acceptée dont la
--       capture est en vol (PAYMENT_IN_FLIGHT avec heure limite) ; une demande dont l'autorisation
--       est encore en vol (PAYMENT_IN_FLIGHT SANS heure limite : le voyageur est en train de payer)
--       n'est pas encore envoyée à l'hôte et n'est pas rendue (sa page de paiement la suit) ;
--   et, pour chacune : statut, statut du paiement du trip, devise et fuseau, période, auto (marque,
--   modèle, année ; jamais la plaque), hôte en PRÉNOM et INITIALE (L2-PM-35 ; compte pseudonymisé :
--   rien), total du devis figé (unités mineures, jamais recalculé), état du contrat (aucune version,
--   à signer, signé ; trips seulement).
--   Minimisation du lieu de remise (PROPOSÉ, comme Turo) : adresse exacte et ville d'un trip À
--   VENIR ou EN COURS seulement ; nom du lieu pour tout trip ; une demande ne montre que la ville
--   (l'adresse n'est donnée qu'à la réservation, 16 BKG-016).
--   Un trip d'une autre personne (y compris celui que la session héberge), un trip inconnu : aucune
--   ligne, comme un trip absent (l'API rend 404, aucun oracle d'existence) ; une demande n'est
--   jamais lue par son identifiant ici.
--
-- Issues rendues (jamais levées) : DONE (une ligne par élément, zéro ligne possible),
-- AUTH_REQUIRED (session absente, échue ou révoquée), REQUEST_INVALID (onglet inconnu, limite hors
-- de [1, 200]).
--
-- Droit ajouté : SELECT (payment_status) ON core.booking_trip pour cmd_hold_owner (la politique
-- cmd_hold_read de 0032 couvre déjà la lecture des lignes). Toutes les autres colonnes lues sont
-- déjà accordées à cmd_hold_owner (0032, 0037, 0067, 0071, 0097, 0108, 0116, 0122, 0124, 0126).
--
-- Expand / contract : fonction AJOUTÉE, droit de colonne AJOUTÉ.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_guest_trips(bytea, text, uuid, integer) ;
--   REVOKE SELECT (payment_status) ON core.booking_trip FROM cmd_hold_owner.

-- 1. Droit de lecture de colonne (statut du paiement du trip) -------------------------------------
GRANT SELECT (payment_status) ON core.booking_trip TO cmd_hold_owner;

-- 2. Lecture du voyageur de la session (famille cmd_hold, EXECUTE app_api) -------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_guest_trips(p_token_hash bytea, p_tab text, p_trip_id uuid,
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
         CASE WHEN i.kind = 'TRIP' AND i.tab IN ('UPCOMING', 'IN_PROGRESS') THEN cl.address_line
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
  'période, auto (sans plaque), hôte en prénom et initiale, lieu de remise minimisé, total du '
  'devis figé (jamais recalculé), état du contrat ; trip d''une autre personne ou inconnu : aucune '
  'ligne. SECURITY DEFINER, EXECUTE app_api. US-214 (ADR-160).';

REVOKE ALL ON FUNCTION core.booking_guest_trips(bytea, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_guest_trips(bytea, text, uuid, integer) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
