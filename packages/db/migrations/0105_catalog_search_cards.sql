-- 0105 — CAT : cartes des résultats de la recherche publique (caution, instant du devis).
-- US-203 ; 19 US-203 (critères 1 à 4) ; 16 SRC-008, SRC-011 (« montant de la caution par
-- pré-autorisation sur carte », déclencheurs `COUNTRY` ou `CLASS` seuls évalués avant le checkout,
-- sinon mention générique), SRC-042 (total TTC du devis, PRC-025) ; 08 BR-PAY-06 (caution
-- conditionnelle, T70 c), BR-PRICE-13 ; 17 §3.2.3 (`deposit_policy` par pays et classe), §2.3
-- (sonde), §0.1 ; pré-mortem du lot 2 L2-PM-09, L2-PM-14, L2-PM-29, L2-PM-32 ; ADR-127 (US-201),
-- ADR-131 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-131, PROPOSÉS) :
--   - lecture seule, aucune écriture : une fonction `SECURITY DEFINER` (propriétaire
--     catalog_cmd_owner, comme la recherche d'US-201), EXECUTE au seul app_api ;
--   - elle ENVELOPPE `core.catalog_public_search` (0103) sans rien en changer : mêmes annonces
--     (LISTED, hôte activable, réservation immédiate, préavis, sonde `catalog_vehicle_is_free` sur
--     la période et son tampon : un véhicule réservé, tenu par un hold ou bloqué n'apparaît pas),
--     mêmes issues de refus, mêmes colonnes C0, plus deux colonnes :
--       * `deposit_amount_minor` : caution de la plateforme pour le pays et la classe de valeur du
--         véhicule (`core.catalog_deposit_policy`, version en vigueur à platform.now(), même
--         devise que l'annonce, montant > 0) ; NULL sinon (aucune politique, classe inconnue,
--         devise différente) : le site affiche alors la mention générique (16 SRC-011, T70 c) ;
--         la classe elle-même n'est pas rendue (le voyageur ne voit que le montant, BR-PAY-06) ;
--       * `quoted_at` : platform.now() de la lecture, instant du devis provisoire calculé par
--         l'API (PRC, `prc.quote/2`) ; l'horloge fait foi côté base (contrainte 5) ;
--   - aucune nouvelle colonne personnelle : ni nom, ni adresse, ni point exact du lieu, ni compte
--     d'hôte (L1-PM-19, L2-PM-29).
--
-- Expand / contract : fonction, politique et droit ajoutés ; aucune table, colonne ni fonction de
-- 0103 modifiée. L'API N-1 garde `core.catalog_public_search` (toujours accordée à app_api) ; son
-- retrait éventuel viendra par une migration de contraction distincte.
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_public_cards(text, text, text, timestamp, timestamp,
--     integer) ;
--   DROP POLICY catalog_cmd_search_read ON core.catalog_deposit_policy ;
--   REVOKE SELECT ON core.catalog_deposit_policy FROM catalog_cmd_owner.

-- 1. Lecture de la caution par catalog_cmd_owner (table de plateforme, sans donnée personnelle) --
GRANT SELECT (country_code, value_class, amount_minor, currency, valid_from)
  ON core.catalog_deposit_policy TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_search_read ON core.catalog_deposit_policy FOR SELECT
  TO catalog_cmd_owner USING (true);

-- 2. Cartes des résultats -----------------------------------------------------------------------
CREATE FUNCTION core.catalog_public_cards(p_country text, p_city text, p_area text,
                                                 p_start_local timestamp, p_end_local timestamp,
                                                 p_limit integer)
  RETURNS TABLE (outcome text, listing_id uuid, daily_price_minor bigint, currency text,
                 instant_book boolean, make_name text, model_name text, year integer,
                 transmission text, seats smallint, fuel_type text, location_kind text,
                 city text, area_label text, geo_public_lat numeric, geo_public_lng numeric,
                 timezone text, start_at timestamptz, end_at timestamptz,
                 deposit_amount_minor bigint, quoted_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.outcome, s.listing_id, s.daily_price_minor, s.currency, s.instant_book, s.make_name,
         s.model_name, s.year, s.transmission, s.seats, s.fuel_type, s.location_kind, s.city,
         s.area_label, s.geo_public_lat, s.geo_public_lng, s.timezone, s.start_at, s.end_at,
         CASE WHEN cur.amount_minor > 0 AND cur.currency = s.currency THEN cur.amount_minor END,
         platform.now()
    FROM core.catalog_public_search(p_country, p_city, p_area, p_start_local, p_end_local,
                                    p_limit) WITH ORDINALITY AS s
    LEFT JOIN core.catalog_listing AS l ON l.id = s.listing_id
    LEFT JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
    -- version en vigueur de la caution du pays et de la classe (la plus récente commencée) ; le
    -- montant n'est rendu que s'il est positif et dans la devise de l'annonce
    LEFT JOIN LATERAL (SELECT dp.amount_minor, dp.currency
                         FROM core.catalog_deposit_policy AS dp
                        WHERE dp.country_code = l.country_code
                          AND dp.value_class = v.value_class
                          AND dp.valid_from <= platform.now()
                        ORDER BY dp.valid_from DESC
                        LIMIT 1) AS cur ON true
   ORDER BY s.ordinality
$fn$;
COMMENT ON FUNCTION core.catalog_public_cards(text, text, text, timestamp, timestamp,
                                                     integer) IS
  'Cartes des résultats : catalog_public_search (0103) inchangée, plus la caution en vigueur du '
  'pays et de la classe du véhicule (catalog_deposit_policy, même devise, > 0 ; NULL : mention '
  'générique) et platform.now() de la lecture (instant du devis). SECURITY DEFINER, EXECUTE '
  'app_api. US-203 (ADR-131).';

REVOKE ALL ON FUNCTION core.catalog_public_cards(text, text, text, timestamp, timestamp,
                                                        integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_cards(text, text, text, timestamp,
                                                           timestamp, integer) TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement, mécanique de 0047 / 0061 / 0103)
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_cards(text, text, text, timestamp, timestamp, integer)
  OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
