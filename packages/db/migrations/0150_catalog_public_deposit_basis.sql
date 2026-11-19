-- 0150 — CAT : base de la caution annoncée AVANT le checkout (fiche S03, cartes S01 / S02).
-- US-701 (partie 701c, critère T70 c ; BOARD N-372, N-89) ; 19 US-701 ; 16 SRC-011, PAY-011
-- (T70 c) ; 08 BR-PAY-06 « Moment de l'évaluation » (avant le checkout, seuls COUNTRY et CLASS,
-- connus du véhicule), « Source unique du montant » (`deposit_amount[pays][classe]`, plus
-- `catalog_deposit_policy.amount_minor`) ; 17 §3.2.3, §2.3 ; ADR-169 (n° 8), ADR-173 (cette
-- migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-173, PROPOSÉS) :
--   - la DÉCISION n'est pas écrite ici : elle reste celle de PAY (`evaluateDepositTriggers` au
--     stade PRE_CHECKOUT puis `depositAmountFor`, les fonctions du checkout), lue par l'API avec
--     les paramètres du pays (`PgDepositRailConfigReader`) ; la base ne rend que ce que le
--     véhicule permet de connaître : pays, devise et classe de valeur du catalogue ;
--   - une fonction `SECURITY DEFINER` en lecture seule (propriétaire catalog_cmd_owner, comme les
--     cartes de 0105), EXECUTE au seul app_api ; jamais app_anon ni app_worker ; aucune écriture ;
--   - annonces LISTED seulement (même visibilité que `core.catalog_public_listing`, 0067) ; au plus
--     50 identifiants lus (`SEARCH_LIMIT_MAX`, une page de résultats) ;
--   - la classe n'est jamais rendue au visiteur (l'API ne rend que le statut et le montant,
--     BR-PAY-06 : « jamais les déclencheurs ») ; aucune colonne personnelle ni [C2] : ni compte
--     d'hôte, ni plaque, ni VIN, ni lieu.
--
-- Expand / contract : une fonction AJOUTÉE ; aucune table, colonne, politique ni droit modifiés
-- (catalog_cmd_owner lit déjà `catalog_listing` et `catalog_vehicle.value_class`, 0103 et 0105).
-- `core.catalog_public_cards` (0105) et `core.catalog_public_terms` (0118) gardent leur colonne
-- `deposit_amount_minor` pour l'API N-1 ; l'API N ne la lit plus. Leur contraction (et la lecture de
-- `catalog_deposit_policy` par le contrat de location, 0122) est une suite (S-13 de la passation).
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_public_deposit_basis(uuid[]).

GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;

CREATE FUNCTION core.catalog_public_deposit_basis(p_listing_ids uuid[])
  RETURNS TABLE (listing_id uuid, country_code text, currency text, value_class text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.country_code::text, l.currency::text, v.value_class::text
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
   WHERE l.id = ANY (p_listing_ids[1:50])
     AND l.status = 'LISTED'
   ORDER BY l.id
$fn$;
COMMENT ON FUNCTION core.catalog_public_deposit_basis(uuid[]) IS
  'Base de la caution annoncée avant le checkout (T70 c) : pays, devise et classe de valeur du '
  'catalogue des annonces LISTED demandées (50 au plus) ; la décision reste celle de PAY. Lecture '
  'seule. SECURITY DEFINER, EXECUTE app_api. US-701 (ADR-173).';

REVOKE ALL ON FUNCTION core.catalog_public_deposit_basis(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_deposit_basis(uuid[]) TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement, mécanique de 0047 / 0061 / 0105)
ALTER FUNCTION core.catalog_public_deposit_basis(uuid[]) OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
