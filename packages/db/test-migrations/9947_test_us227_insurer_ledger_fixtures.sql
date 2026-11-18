-- 9947 — Fixtures de TEST d'US-227 (0141, ADR-165) : registre de l'assureur et bordereaux. Jamais en
-- production (test-migrations/ seulement). SECURITY DEFINER sous migrator (politiques migrator_all) ;
-- l'appelant reste sous un rôle de production (L0-05).
--
--   - us062_fixture_insurer : assureur et contrat « de structure » du pays, en vigueur un seul jour
--     de 1800 (aucune réservation ne tombe dans sa période : aucune écriture ne lui est rattachée),
--     créés une fois par pays sous verrou consultatif ; donne aux lignes de structure des fixtures
--     de 9700 (US-062) les clés étrangères vers `settlement_insurer` / `settlement_insurer_contract`
--     qu'ajoute 0141 ;
--   - us062_insert_bordereau / us062_insert_insurer_ledger : REMPLACENT les corps de 9700 (mêmes
--     signatures, mêmes droits, mêmes lignes posées) ; seuls changent les identifiants d'assureur
--     et de contrat, désormais réels (clés étrangères de 0141). Aucun attendu des tests appelants
--     ne porte sur ces identifiants ;
--   - us227_contract : assureur ACTIVE et contrat du pays (par défaut : en vigueur depuis une
--     heure, pour dix ans) ; us227_retire_contract le replace ensuite hors du temps des autres
--     fichiers (le fichier de preuves est isolé : aucun autre contrat n'est posé pendant ce temps) ;
--   - us227_entries : écritures du registre d'un trip (lecture des preuves sous app_worker) ;
--   - us227_insert_entry : écriture posée dans le monde de la matrice d'autorisations
--     (l0-us043-authorization-matrix) sur le règlement en tête du trip, pour éprouver chaque
--     cellule de lecture sur des lignes réelles (montant : donnée de test, jamais un attendu ; sans
--     effet si le règlement a déjà son écriture) ;
--   - us227_try_update / us227_try_delete : immuabilité sous le propriétaire de la table.
--
-- Retour arrière : DROP FUNCTION test_fixture.us062_fixture_insurer(text),
--   test_fixture.us227_contract(text, timestamptz, timestamptz), test_fixture.us227_entries(uuid),
--   test_fixture.us227_insert_entry(uuid), test_fixture.us227_try_update(uuid),
--   test_fixture.us227_try_delete(uuid), test_fixture.us227_retire_contract(uuid) ; corps de 9700 rétablis pour us062_insert_bordereau et
--   us062_insert_insurer_ledger.

CREATE FUNCTION test_fixture.us062_fixture_insurer(p_country text)
  RETURNS TABLE (insurer_id uuid, contract_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_from    timestamptz := '1800-01-01T00:00:00Z';
  v_insurer uuid;
  v_id      uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('rueda.us062_fixture_insurer:' || p_country));
  SELECT c.insurer_id, c.id INTO v_insurer, v_id
    FROM core.settlement_insurer_contract AS c
   WHERE c.country_code = p_country AND c.valid_from = v_from;
  IF v_id IS NULL THEN
    v_insurer := pg_catalog.gen_random_uuid();
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.settlement_insurer (id, country_code, name, kind, status)
    VALUES (v_insurer, p_country, 'Assureur de structure (fixture)', 'INSURER', 'ACTIVE');
    INSERT INTO core.settlement_insurer_contract (id, insurer_id, country_code, version,
                                                  vehicle_eligibility, signed_at, valid_from,
                                                  valid_to)
    VALUES (v_id, v_insurer, p_country, 1800,
            pg_catalog.jsonb_build_object('maxVehicleAgeYears', 30,
                                          'valueClasses', pg_catalog.jsonb_build_array('STANDARD'),
                                          'usages', pg_catalog.jsonb_build_array('PARTICULAR')),
            v_from, v_from, v_from + interval '1 day');
  END IF;
  RETURN QUERY SELECT v_insurer, v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION test_fixture.us062_insert_bordereau(p_id uuid, p_country text,
                                                               p_currency text, p_total bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_insurer_bordereau
         (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor)
  SELECT p_id, f.insurer_id, f.contract_id, p_country, p_currency,
         tstzrange('2031-01-01T00:00:00Z', '2031-02-01T00:00:00Z', '[)'), p_total
    FROM test_fixture.us062_fixture_insurer(p_country) AS f
$fn$;

CREATE OR REPLACE FUNCTION test_fixture.us062_insert_insurer_ledger(p_insurer_id uuid,
                                                                    p_country text,
                                                                    p_currency text,
                                                                    p_payable bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_insurer (id, country_code, name, kind, status)
  VALUES (p_insurer_id, p_country, 'Assureur de structure (fixture)', 'INSURER', 'ACTIVE')
  ON CONFLICT DO NOTHING;
  INSERT INTO core.settlement_insurer_ledger_state (insurer_id, country_code, currency, payable_minor)
  VALUES (p_insurer_id, p_country, p_currency, p_payable);
$fn$;

CREATE FUNCTION test_fixture.us227_contract(p_country text, p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (insurer_id uuid, contract_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_insurer uuid := pg_catalog.gen_random_uuid();
  v_id      uuid := pg_catalog.gen_random_uuid();
  v_from    timestamptz := COALESCE(p_from, platform.now() - interval '1 hour');
  v_to      timestamptz := COALESCE(p_to, platform.now() + interval '10 years');
BEGIN
  INSERT INTO core.settlement_insurer (id, country_code, name, kind, license_ref, status)
  VALUES (v_insurer, p_country, 'Aseguradora de prueba', 'INSURER', 'SSRP-TEST-227', 'ACTIVE');
  -- version unique par pays et par date de début (aucune course avec le « max + 1 » des autres
  -- fixtures, qui ne créent que des contrats en vigueur depuis la veille)
  INSERT INTO core.settlement_insurer_contract (id, insurer_id, country_code, version,
                                                vehicle_eligibility, signed_at, valid_from,
                                                valid_to)
  VALUES (v_id, v_insurer, p_country,
          1000000 + (pg_catalog.date_part('epoch', v_from)::bigint % 1000000000)::integer,
          pg_catalog.jsonb_build_object('maxVehicleAgeYears', 30,
                                        'valueClasses', pg_catalog.jsonb_build_array('STANDARD'),
                                        'usages', pg_catalog.jsonb_build_array('PARTICULAR')),
          v_from, v_from, v_to);
  RETURN QUERY SELECT v_insurer, v_id;
END
$fn$;

-- Contrat de test replacé hors du temps des autres fichiers à la fin des preuves : une seconde
-- de 1801 propre au contrat (aucun recouvrement, exclusion GiST de 0081) ; conditions inchangées
-- (garde de 0115) ; écritures et bordereaux gardent son identifiant.
CREATE FUNCTION test_fixture.us227_retire_contract(p_contract uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_insurer_contract AS c
     SET signed_at = x.at, valid_from = x.at, valid_to = x.at + interval '1 second'
    FROM (SELECT '1801-01-01T00:00:00Z'::timestamptz
                 + pg_catalog.make_interval(secs => pg_catalog.abs(pg_catalog.hashtext(p_contract::text))::double precision)
                 AS at) AS x
   WHERE c.id = p_contract
$fn$;

CREATE FUNCTION test_fixture.us227_entries(p_trip_id uuid)
  RETURNS TABLE (id uuid, reason text, amount_minor text, currency text, country_code text,
                 insurer_id uuid, insurer_contract_id uuid, operation_id uuid,
                 settlement_id uuid, settlement_version integer, created_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.id, e.reason, e.amount_minor::text, e.currency, e.country_code, e.insurer_id,
         e.insurer_contract_id, e.operation_id, e.settlement_id, e.settlement_version, e.created_at
    FROM core.settlement_insurer_ledger_entry AS e
   WHERE e.trip_id = p_trip_id
   ORDER BY e.created_at, e.reason, e.id
$fn$;

CREATE FUNCTION test_fixture.us227_insert_entry(p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s record;
BEGIN
  SELECT x.id, x.trip_id, x.segment_no, x.version, x.org_id, x.country_code, x.currency INTO s
    FROM core.settlement_settlement AS x
   WHERE x.trip_id = p_trip_id
   ORDER BY x.version DESC
   LIMIT 1;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'us227_insert_entry: règlement absent';
  END IF;
  INSERT INTO core.settlement_insurer_ledger_entry
         (id, trip_id, segment_no, org_id, country_code, currency, reason, settlement_id,
          settlement_version, amount_minor)
  VALUES (pg_catalog.gen_random_uuid(), s.trip_id, s.segment_no, s.org_id, s.country_code,
          s.currency, 'SETTLEMENT_VARIATION', s.id, s.version, -1)
  ON CONFLICT ON CONSTRAINT insurer_ledger_entry_settlement_unique DO NOTHING;
END
$fn$;

CREATE FUNCTION test_fixture.us227_try_update(p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_insurer_ledger_entry SET amount_minor = amount_minor - 1 WHERE id = p_id
$fn$;

CREATE FUNCTION test_fixture.us227_try_delete(p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.settlement_insurer_ledger_entry WHERE id = p_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us062_fixture_insurer(text),
  test_fixture.us227_contract(text, timestamptz, timestamptz), test_fixture.us227_entries(uuid),
  test_fixture.us227_insert_entry(uuid), test_fixture.us227_try_update(uuid),
  test_fixture.us227_try_delete(uuid), test_fixture.us227_retire_contract(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us227_contract(text, timestamptz, timestamptz), test_fixture.us227_entries(uuid),
  test_fixture.us227_insert_entry(uuid), test_fixture.us227_try_update(uuid),
  test_fixture.us227_try_delete(uuid), test_fixture.us227_retire_contract(uuid)
  TO app_worker, app_api;
