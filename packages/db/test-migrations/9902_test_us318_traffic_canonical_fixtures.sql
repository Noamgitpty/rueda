-- 9902 — fixtures des preuves de la suite 2 d'US-318 (refacturation : clé canonique du PV, unicité
-- par compte d'hôte du pays, seuil cumulé du trip et revue de l'ops ; migration 0183, ADR-203).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : relire la clé
-- canonique calculée par la fonction de PRODUCTION (`core.claim_traffic_reference_key`, jamais
-- recopiée), relire les refacturations d'un trip (aucun rôle applicatif ne les lit), fermer le
-- paramètre `traffic_trip_charge_max_minor` (preuve du refus fail-closed, transaction ANNULÉE).
-- Les attendus des tests viennent d'ADR-203 (exemples de la clé canonique), de 08 (BR-REIMB-05,
-- BR-TT-02) et du rapport de la red team (F-L3-SIN-03 à 05), jamais de ces fixtures. AUCUNE
-- fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us318t_* (voir la liste des droits en fin de fichier).

-- Clé canonique d'une référence, par la fonction de production
CREATE FUNCTION test_fixture.us318t_reference_key(p_reference text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.claim_traffic_reference_key(p_reference)
$fn$;

-- Refacturations d'un trip lues par objet (jamais la table entière) ; ordre stable sans UUID
CREATE FUNCTION test_fixture.us318t_charges(p_trip uuid)
  RETURNS TABLE (id uuid, reference text, reference_key text, reference_canonical_key text,
                 amount_minor bigint, guest_status text, ops_review_required boolean,
                 execution_status text, execution_code text, charge_basis text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.id, x.reference, x.reference_key, x.reference_canonical_key, x.amount_minor,
         x.guest_status, x.ops_review_required, x.execution_status, x.execution_code,
         x.charge_basis
    FROM core.claim_traffic_charge AS x
   WHERE x.trip_id = p_trip
   ORDER BY x.declared_at, x.reference_canonical_key, x.amount_minor
$fn$;

-- Ferme la valeur en vigueur du seuil cumulé du pays (transaction ANNULÉE des tests)
CREATE FUNCTION test_fixture.us318t_param_close(p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE core.config_param_value AS v
     SET valid_to = platform.now() + pg_catalog.make_interval(secs => 0.01)
   WHERE v.key = 'traffic_trip_charge_max_minor' AND v.country_code = p_country
     AND v.scope_type = 'COUNTRY' AND v.valid_to IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- Tentative d'écriture interdite : la revue de l'ops est figée (garde claim_p2p_guard, aussi sous
-- migrator)
CREATE FUNCTION test_fixture.us318t_try_write(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'CLEAR_REVIEW' THEN
    UPDATE core.claim_traffic_charge SET ops_review_required = false WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'écriture inconnue : %', p_what USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us318t_reference_key(text),
  test_fixture.us318t_charges(uuid),
  test_fixture.us318t_param_close(text),
  test_fixture.us318t_try_write(text, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us318t_reference_key(text),
  test_fixture.us318t_charges(uuid),
  test_fixture.us318t_param_close(text),
  test_fixture.us318t_try_write(text, uuid)
TO app_worker, app_api;
