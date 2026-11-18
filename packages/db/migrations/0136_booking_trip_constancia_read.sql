-- 0136 — CTR / AVL : constancia d'arrendamiento d'un trip et recherche de l'hôte par plaque et date
-- (lecture seule). US-212 ; 19 US-212 critère 1 (« Given un trip BOOKED, When la constancia est
-- ouverte, Then plaque, période exacte (fuseau du pays), hôte (pièce masquée) et identité du
-- conducteur en es et en ; recherche par plaque et date possible pour l'hôte ») ; 16 LEG-026
-- (« téléchargeable par le voyageur et par l'hôte » ; parcours alternatif EC-48 : amende reçue
-- après le trip ⇒ l'hôte télécharge la constancia de la période) ; 08 BR-TT-03 (PV de
-- stationnement imputables jusqu'à 24 h après la fin) ; 17 §2.3 point 5 (IDOR) ; pré-mortem du
-- lot 2 : L2-PM-26, L2-PM-35 ; ADR-143 (contrat figé), ADR-162 (cette migration).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-162, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - la constancia n'a AUCUN fait propre : elle reprend les faits FIGÉS de la DERNIÈRE version du
--     contrat de location du trip (0122 : `terms` du registre immuable, `identity` de la partie
--     nominative), jamais recalculés depuis le devis, la fiche ou le véhicule (une plaque changée
--     après la réservation ne change pas la constancia) ; elle suit le contrat : une nouvelle
--     version du contrat donne une nouvelle constancia ; la signature horodatée (16 LEG-026) est
--     celle du voyageur sur cette version, rendue à l'heure locale du trip par la base ;
--   - aucun fichier stocké : le PDF est rendu à la demande par l'API (même rendu déterministe que
--     le contrat, `ctr.pdf/1`), son empreinte est calculée au rendu (ADR-162) ;
--   - minimisation (L2-PM-35) : du conducteur, le nom figé du contrat (prénom et initiale) ; de
--     l'hôte, prénom et initiale (le contrat porte son nom complet, la constancia est présentée à
--     des tiers) ; jamais de pièce, de contact, d'adresse exacte (nom du lieu et ville seulement) ;
--   - parties seulement : le voyageur du trip ou le TITULAIRE du compte d'hôte, jugés par la
--     session (jamais un identifiant de personne reçu) ; autre personne, trip inconnu : NOT_FOUND,
--     même réponse ; trip annulé (partition CANCELLED de 0101) : NOT_AVAILABLE ; aucun contrat :
--     NOT_GENERATED ; partie nominative pseudonymisée (rétention) : ERASED ;
--   - recherche de l'hôte (EC-48) : trips de son compte dont la plaque FIGÉE au contrat (comparée
--     sans casse, espaces ni tirets) et la période locale couvrent la date demandée, jusqu'au
--     lendemain de la fin (BR-TT-03 : 24 h) ; jamais le trip d'un autre compte ;
--   - aucun interrupteur lu ni écrit ; aucune constante de pays (fuseau du trip).
--
-- Droits : aucun nouveau. `cmd_hold_owner` lit déjà `booking_trip` (`public_ref`, `timezone`,
-- `scheduled_start`, `scheduled_end`, `status`, `org_id`, `guest_user_id` : 0032, 0097, 0122),
-- `iam_organization.holder_user_id` (0037, 0122), `iam_user_account` (`legal_first_name`,
-- `legal_last_name`, `preferred_locale`, `pseudonymized_at` : 0122) et les trois tables du contrat
-- (0122), par ses politiques `cmd_hold_*` existantes.
--
-- Expand / contract : deux fonctions AJOUTÉES seulement.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_trip_constancia(bytea, uuid),
--     core.booking_host_constancia_search(bytea, text, date).

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 1. Constancia d'un trip pour sa partie de la session (SECURITY DEFINER, EXECUTE app_api) ------
CREATE FUNCTION core.booking_trip_constancia(p_token_hash bytea, p_trip_id uuid)
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
  h        record;
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
  SELECT u.legal_first_name, u.legal_last_name, u.pseudonymized_at INTO h
    FROM core.iam_user_account AS u WHERE u.id = t.holder_user_id;
  IF d.pseudonymized_at IS NOT NULL OR h.pseudonymized_at IS NOT NULL
     OR h.legal_first_name IS NULL THEN
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
         h.legal_first_name
           || CASE WHEN pg_catalog.btrim(COALESCE(h.legal_last_name, '')) = '' THEN ''
                   ELSE ' ' || pg_catalog.left(pg_catalog.btrim(h.legal_last_name), 1) || '.' END,
         d.identity ->> 'guestName', d.identity ->> 'plate', d.identity ->> 'handoverPlace',
         d.identity ->> 'handoverCity',
         pg_catalog.to_char(v_signed AT TIME ZONE t.timezone, 'YYYY-MM-DD HH24:MI');
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_constancia(bytea, uuid) IS
  'Constancia d''arrendamiento d''un trip pour sa partie de la session (voyageur ou titulaire du '
  'compte d''hôte) : faits figés de la dernière version du contrat (période, véhicule, plaque, lieu '
  'de remise, total), hôte en prénom et initiale, conducteur du contrat, signature horodatée à '
  'l''heure locale ; NOT_FOUND, NOT_AVAILABLE (annulé), NOT_GENERATED, ERASED sinon. SECURITY '
  'DEFINER, EXECUTE app_api. US-212 (ADR-162).';
REVOKE ALL ON FUNCTION core.booking_trip_constancia(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_trip_constancia(bytea, uuid) TO app_api;

-- 2. Recherche de l'hôte par plaque et date (EC-48 ; SECURITY DEFINER, EXECUTE app_api) ---------
-- Issues : DONE (zéro à vingt lignes), AUTH_REQUIRED (session absente), REQUEST_INVALID (plaque
-- de moins de 2 ou de plus de 12 caractères utiles, date absente).
CREATE FUNCTION core.booking_host_constancia_search(p_token_hash bytea, p_plate text, p_date date)
  RETURNS TABLE (outcome text, trip_id uuid, public_ref text, status text, start_local text,
                 end_local text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_plate text := pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_plate, ''),
                                                             '[^A-Za-z0-9]', '', 'g'));
  v_fmt   CONSTANT text := 'YYYY-MM-DD HH24:MI';
BEGIN
  IF p_date IS NULL OR pg_catalog.length(v_plate) < 2 OR pg_catalog.length(v_plate) > 12 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  -- titulaire du compte d'hôte de la SESSION (IDOR : jamais un identifiant de compte reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, tr.id, tr.public_ref, tr.status,
         pg_catalog.to_char(tr.scheduled_start AT TIME ZONE tr.timezone, v_fmt),
         pg_catalog.to_char(tr.scheduled_end AT TIME ZONE tr.timezone, v_fmt)
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
    CROSS JOIN LATERAL (
      SELECT p.identity, p.pseudonymized_at
        FROM core.contract_generated_document AS gd
        JOIN core.contract_document_party AS p ON p.document_id = gd.id
       WHERE gd.trip_id = tr.id
       ORDER BY gd.version DESC
       LIMIT 1) AS c
   WHERE o.holder_user_id = v_user
     AND tr.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                       'UNRETURNED', 'RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                       'COMPLETED', 'IN_DISPUTE')
     AND c.pseudonymized_at IS NULL
     AND pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(c.identity ->> 'plate', ''),
                                                    '[^A-Za-z0-9]', '', 'g')) = v_plate
     AND (tr.scheduled_start AT TIME ZONE tr.timezone)::date <= p_date
     AND ((tr.scheduled_end + interval '24 hours') AT TIME ZONE tr.timezone)::date >= p_date
   ORDER BY tr.scheduled_start, tr.id
   LIMIT 20;
END
$fn$;
COMMENT ON FUNCTION core.booking_host_constancia_search(bytea, text, date) IS
  'Trips du compte d''hôte de la session dont la plaque figée au contrat et la période locale '
  '(jusqu''à 24 h après la fin, BR-TT-03) couvrent la date demandée (EC-48) : référence, statut, '
  'période locale ; au plus vingt. SECURITY DEFINER, EXECUTE app_api. US-212 (ADR-162).';
REVOKE ALL ON FUNCTION core.booking_host_constancia_search(bytea, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_host_constancia_search(bytea, text, date) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
