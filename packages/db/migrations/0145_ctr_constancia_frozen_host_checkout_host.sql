-- 0145 — CTR / AVL : hôte de la constancia lu du contrat FIGÉ ; hôte en prénom et initiale au
-- checkout S05 (US-212, partie 212b ; BOARD N-345, N-346 ; 19 US-212 critère 3 ; ADR-162 n° 1 et
-- n° 7). Appliquée sous `migrator`, en une transaction.
--
-- 1. N-345 (revues de code, de sécurité et d'architecture de #234) : `core.booking_trip_constancia`
--    lisait le nom de l'hôte dans `iam_user_account` (état COURANT) alors qu'ADR-162 n° 1 annonce
--    des faits FIGÉS. Corps repris de 0138 (sa seule définition), une seule différence : l'hôte est
--    lu de la partie nominative de la dernière version du contrat (`identity.hostName`, figé par
--    0122 : prénom légal, une espace, nom légal), réduit à prénom et initiale (L2-PM-35) par une
--    règle qui ne dépend QUE du fait figé : premier mot, puis initiale du mot suivant et un point
--    (« María Gómez » ⇒ « María G. » ; un seul mot ⇒ ce mot). Le fait figé ne sépare pas le prénom
--    du nom : pour un prénom composé (« Ana María Gómez »), l'initiale est celle du deuxième prénom
--    (« Ana M. »), plus minimale encore (PROPOSÉ, ADR-162 n° 1). Un changement de nom légal après
--    la réservation ne change donc plus la constancia (prouvé par l0-us212-constancia). Le compte
--    de l'hôte n'est plus lu que pour sa pseudonymisation (droit à l'effacement : ERASED, comme
--    avant) ; un nom figé vide ou absent ⇒ ERASED (aucun nom inventé, fail-closed).
-- 2. N-346 (critère 3, partie S05) : `core.booking_checkout_host_name(jeton, devis)` (cmd_hold_owner,
--    SECURITY DEFINER, EXECUTE app_api) : nom de l'hôte de l'annonce du devis du voyageur de la
--    SESSION, en prénom et initiale : premier mot du prénom légal (le nom public de la fiche,
--    N-37) et initiale du nom légal. Devis inconnu ou d'un autre voyageur : aucune ligne (même
--    réponse que `booking_checkout_quote`, 0108) ; titulaire pseudonymisé ou sans prénom : nom
--    NULL (l'écran ne nomme personne). Aucune pièce, aucun contact, aucun nom complet.
--
-- Droits : aucun nouveau. `cmd_hold_owner` lit déjà `pricing_quote` (`id`, `guest_user_id`,
-- `listing_id` : 0108), `catalog_listing` (`id`, `vehicle_id` : 0067, 0108), `catalog_vehicle`
-- (`id`, `org_id` : 0067), `iam_organization` (`id`, `holder_user_id` : 0032, 0037, 0122) et
-- `iam_user_account` (`legal_first_name`, `legal_last_name`, `pseudonymized_at` : 0122), par ses
-- politiques existantes.
--
-- Expand / contract : une fonction REMPLACÉE à signature et colonnes identiques (propriétaire,
-- droits EXECUTE et search_path inchangés) ; une fonction AJOUTÉE ; aucune table ni colonne.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_checkout_host_name(bytea, uuid) ;
--   réappliquer le corps de core.booking_trip_constancia de 0138.

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 1. Constancia : hôte lu du contrat figé (N-345) ---------------------------------------------------
CREATE OR REPLACE FUNCTION core.booking_trip_constancia(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, viewer_role text, viewer_locale text, trip_status text,
                 contract_version integer, terms jsonb, brand text, host_name text,
                 guest_name text, plate text, handover_place text, handover_city text,
                 signed_at_local text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_locale text;
  t        record;
  v_role   text;
  d        record;
  v_erased timestamptz;
  v_host   text[];
  v_signed timestamptz;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT tr.id, tr.guest_user_id, tr.status, tr.timezone, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  v_role := CASE WHEN v_user IS NULL OR t.id IS NULL THEN NULL
                 WHEN v_user = t.guest_user_id THEN 'GUEST'
                 WHEN v_user = t.holder_user_id THEN 'HOST' END;
  IF v_role IS NULL THEN
    -- autre personne, trip inconnu, session absente : même réponse, rien n'est révélé
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::text, NULL::integer,
                        NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  -- trip annulé (partition CANCELLED de 0101) : aucune location à attester
  IF t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                      'UNRETURNED', 'RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                      'COMPLETED', 'IN_DISPUTE') THEN
    RETURN QUERY SELECT 'NOT_AVAILABLE'::text, v_role, NULL::text, t.status, NULL::integer,
                        NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  -- dernière version du contrat (faits figés) et sa partie nominative
  SELECT gd.id, gd.version, gd.terms, gd.derived, p.identity, p.pseudonymized_at INTO d
    FROM core.contract_generated_document AS gd
    JOIN core.contract_document_party AS p ON p.document_id = gd.id
   WHERE gd.trip_id = t.id
   ORDER BY gd.version DESC
   LIMIT 1;
  IF d.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_GENERATED'::text, v_role, NULL::text, t.status, NULL::integer,
                        NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  -- N-345 : nom de l'hôte FIGÉ au contrat (jamais le compte courant) ; le compte n'est lu que pour
  -- sa pseudonymisation (droit à l'effacement)
  SELECT u.pseudonymized_at INTO v_erased
    FROM core.iam_user_account AS u WHERE u.id = t.holder_user_id;
  v_host := pg_catalog.regexp_split_to_array(
              pg_catalog.btrim(COALESCE(d.identity ->> 'hostName', '')), '\s+');
  IF d.pseudonymized_at IS NOT NULL OR v_erased IS NOT NULL OR v_host[1] = '' THEN
    RETURN QUERY SELECT 'ERASED'::text, v_role, NULL::text, t.status, d.version, NULL::jsonb,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  SELECT u.preferred_locale INTO v_locale FROM core.iam_user_account AS u WHERE u.id = v_user;
  SELECT s.signed_at INTO v_signed
    FROM core.contract_signature AS s
   WHERE s.document_id = d.id AND s.signer_user_id = t.guest_user_id AND s.signer_role = 'GUEST'
   LIMIT 1;
  RETURN QUERY
  SELECT 'OK'::text, v_role, v_locale, t.status, d.version, d.terms, d.derived ->> 'brand',
         v_host[1]
           || CASE WHEN pg_catalog.cardinality(v_host) < 2 THEN ''
                   ELSE ' ' || pg_catalog.left(v_host[2], 1) || '.' END,
         d.identity ->> 'guestName', d.identity ->> 'plate', d.identity ->> 'handoverPlace',
         d.identity ->> 'handoverCity',
         pg_catalog.to_char(v_signed AT TIME ZONE t.timezone, 'YYYY-MM-DD HH24:MI');
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_constancia(bytea, uuid) IS
  'Constancia d''arrendamiento d''un trip pour sa partie de la session (voyageur ou titulaire du '
  'compte d''hôte) : faits figés de la dernière version du contrat (période, véhicule, plaque, lieu '
  'de remise, total, nom de l''hôte réduit à prénom et initiale), conducteur du contrat, signature '
  'horodatée à l''heure locale ; NOT_FOUND, NOT_AVAILABLE (annulé), NOT_GENERATED, ERASED sinon. '
  'SECURITY DEFINER, EXECUTE app_api. US-212 (ADR-162 ; hôte figé : 0145, N-345).';

-- 2. Hôte du devis en prénom et initiale pour S05 (N-346) -------------------------------------------
CREATE FUNCTION core.booking_checkout_host_name(p_token_hash bytea, p_quote_id uuid)
  RETURNS TABLE (quote_id uuid, host_name text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL OR p_quote_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT pq.id,
         CASE WHEN u.pseudonymized_at IS NULL
                   AND pg_catalog.split_part(pg_catalog.btrim(COALESCE(u.legal_first_name, '')),
                                             ' ', 1) <> ''
              THEN pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name),
                                                         ' ', 1), 40)
                   || CASE WHEN pg_catalog.btrim(COALESCE(u.legal_last_name, '')) = '' THEN ''
                           ELSE ' ' || pg_catalog.left(pg_catalog.btrim(u.legal_last_name), 1)
                                || '.' END
         END
    FROM core.pricing_quote AS pq
    JOIN core.catalog_listing AS l ON l.id = pq.listing_id
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
    JOIN core.iam_organization AS o ON o.id = v.org_id
    LEFT JOIN core.iam_user_account AS u ON u.id = o.holder_user_id
   WHERE pq.id = p_quote_id AND pq.guest_user_id = v_user;
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_host_name(bytea, uuid) IS
  'Hôte de l''annonce du devis du voyageur de la session, en prénom et initiale (premier mot du '
  'prénom légal, initiale du nom légal ; NULL si pseudonymisé) pour le checkout S05 ; devis '
  'inconnu ou d''un autre : aucune ligne. SECURITY DEFINER, EXECUTE app_api. US-212 (N-346, '
  'ADR-162).';
REVOKE ALL ON FUNCTION core.booking_checkout_host_name(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_host_name(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
