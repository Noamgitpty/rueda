-- 9993 — fixtures des preuves du devis figé (US-202, migration 0099). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. annonce LISTED d'un compte d'hôte de fixture, au prix journalier donné (le pas de prix du
--      pays est une règle de la commande de l'hôte, US-115, pas du devis) ;
--   2. version 2 de tax_line_config d'un pays, groupe marqué third_party (critère 5 d'US-202),
--      valable à platform.now() de la transaction de test (annulée ensuite) ;
--   3. relecture brute d'un devis et de ses lignes (aucun rôle applicatif ne les lit) : les attendus
--      viennent de 08 et des oracles, jamais de cette relecture ;
--   4. tentatives d'écriture directe sous migrator (immuabilité, tous rôles).
--
-- Retour arrière : DROP FUNCTION test_fixture.us202_listed_listing(text, bigint),
--   test_fixture.us202_third_party_taxes(text), test_fixture.us202_quote_row(uuid),
--   test_fixture.us202_quote_lines(uuid), test_fixture.us202_try_write(uuid, text).

CREATE FUNCTION test_fixture.us202_listed_listing(p_country text, p_daily_price_minor bigint)
  RETURNS TABLE (listing_id uuid, vehicle_id uuid, org_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org      uuid := pg_catalog.gen_random_uuid();
  v_vehicle  uuid := pg_catalog.gen_random_uuid();
  v_listing  uuid := pg_catalog.gen_random_uuid();
  v_holder   uuid;
  v_currency text;
BEGIN
  v_holder := test_fixture.create_org(v_org, p_country, 'ACTIVE');
  PERFORM test_fixture.ensure_catalog_vehicle(v_vehicle, v_org, p_country);
  SELECT k.currency::text INTO v_currency FROM core.config_country AS k WHERE k.code::text = p_country;
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, created_by)
  VALUES (v_listing, v_vehicle, v_org, p_country, 'DRAFT', p_daily_price_minor, v_currency,
          'UNLIMITED', v_holder);
  UPDATE core.catalog_listing SET status = 'LISTED' WHERE id = v_listing;
  RETURN QUERY SELECT v_listing, v_vehicle, v_org;
END
$fn$;

CREATE FUNCTION test_fixture.us202_third_party_taxes(p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.pricing_tax_line_config (country_code, line_type, taxable, rate_group, rate_bps,
                                            third_party, version)
  -- valid_from posé par la garde de 0008 (platform.now())
  SELECT c.country_code, c.line_type, c.taxable, c.rate_group, c.rate_bps, c.taxable,
         c.version + 1
    FROM core.pricing_tax_line_config AS c
   WHERE c.country_code::text = p_country
     AND c.version = (SELECT max(x.version) FROM core.pricing_tax_line_config AS x
                       WHERE x.country_code = c.country_code AND x.line_type = c.line_type)
$fn$;

CREATE FUNCTION test_fixture.us202_quote_row(p_id uuid)
  RETURNS SETOF core.pricing_quote
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT * FROM core.pricing_quote WHERE id = p_id
$fn$;

CREATE FUNCTION test_fixture.us202_quote_lines(p_id uuid)
  RETURNS SETOF core.pricing_quote_line
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT * FROM core.pricing_quote_line WHERE quote_id = p_id ORDER BY seq
$fn$;

-- Écriture directe sous migrator : UPDATE d'un montant, passage FROZEN → SUPERSEDED sans date,
-- suppression d'une ligne, TRUNCATE. Rend le SQLSTATE et la contrainte de l'erreur, ou 'OK'.
CREATE FUNCTION test_fixture.us202_try_write(p_id uuid, p_kind text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_state      text;
  v_constraint text;
BEGIN
  BEGIN
    CASE p_kind
      WHEN 'amount' THEN
        UPDATE core.pricing_quote SET total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1,
                                      leg_platform_minor = leg_platform_minor + 1
         WHERE id = p_id;
      WHEN 'line' THEN
        UPDATE core.pricing_quote_line SET tax_minor = tax_minor + 1 WHERE quote_id = p_id;
      WHEN 'delete' THEN
        DELETE FROM core.pricing_quote_line WHERE quote_id = p_id;
      WHEN 'truncate' THEN
        TRUNCATE core.pricing_trip_price_version;
      ELSE
        RETURN 'UNKNOWN';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
    RETURN v_state || ':' || COALESCE(v_constraint, '');
  END;
  RETURN 'OK';
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us202_listed_listing(text, bigint),
  test_fixture.us202_third_party_taxes(text), test_fixture.us202_quote_row(uuid),
  test_fixture.us202_quote_lines(uuid), test_fixture.us202_try_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us202_listed_listing(text, bigint),
  test_fixture.us202_third_party_taxes(text), test_fixture.us202_quote_row(uuid),
  test_fixture.us202_quote_lines(uuid), test_fixture.us202_try_write(uuid, text) TO app_api;
