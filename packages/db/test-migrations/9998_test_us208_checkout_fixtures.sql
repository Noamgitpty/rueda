-- 9998 — fixtures des preuves du checkout (US-208, migration 0108). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelée
-- SEULEMENT dans des transactions de test ANNULÉES :
--   1. `us208_listed_listing` : annonce LISTED d'un compte d'hôte de fixture (US-202,
--      `us202_listed_listing`), avec la boîte de vitesses et le mode de réservation donnés (états
--      que l'hôte pose par ses commandes d'US-115 ; ici sans passer par la publication) ;
--   2. `us208_checkout_rows` : relecture brute du rattachement d'un hold (aucun rôle applicatif ne
--      le lit) : les attendus viennent de 16 et 19, jamais de cette relecture ;
--   3. `us208_consent_rows` : relecture brute des consentements CHECKOUT d'une personne ;
--   4. `us208_try_write` : écriture directe sous migrator (immuabilité, tous rôles) ;
--   5. `us208_publish_document` : nouvelle version d'un document du checkout (genre, pays), comme la
--      console de publication d'US-102, valable à platform.now() de la transaction de test ;
--   6. `us208_set_param` / `us208_close_param` : nouvelle valeur ou fermeture d'un paramètre
--      `quote_*` d'un pays (comme la console de configuration), à platform.now().
--
-- Retour arrière : DROP FUNCTION test_fixture.us208_listed_listing(text, bigint, text, boolean),
--   test_fixture.us208_checkout_rows(uuid), test_fixture.us208_consent_rows(uuid),
--   test_fixture.us208_try_write(uuid, text), test_fixture.us208_publish_document(text, text),
--   test_fixture.us208_set_param(text, text, jsonb), test_fixture.us208_close_param(text, text).

CREATE FUNCTION test_fixture.us208_listed_listing(p_country text, p_daily_price_minor bigint,
                                                  p_transmission text, p_instant_book boolean)
  RETURNS TABLE (listing_id uuid, vehicle_id uuid, org_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM test_fixture.us202_listed_listing(p_country, p_daily_price_minor) AS x;
  UPDATE core.catalog_vehicle SET transmission = p_transmission WHERE id = r.vehicle_id;
  UPDATE core.catalog_listing SET instant_book = p_instant_book WHERE id = r.listing_id;
  RETURN QUERY SELECT r.listing_id, r.vehicle_id, r.org_id;
END
$fn$;

CREATE FUNCTION test_fixture.us208_checkout_rows(p_hold_id uuid)
  RETURNS TABLE (quote_id uuid, guest_user_id uuid, country_code text, manual_confirmed boolean,
                 terms jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.quote_id, a.guest_user_id, a.country_code::text, a.manual_confirmed_at IS NOT NULL,
         (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'kind', t.doc_kind, 'version', t.doc_version, 'locale', t.locale,
                   'consentKind', c.doc_kind, 'consentVersion', c.doc_version,
                   'consentContext', c.context, 'consentUser', c.user_id,
                   'sameTemplate', c.template_id = t.template_id) ORDER BY t.doc_kind)
            FROM core.booking_checkout_terms AS t
            JOIN core.contract_consent AS c ON c.id = t.consent_id
           WHERE t.hold_id = a.hold_id)
    FROM core.booking_checkout_acceptance AS a
   WHERE a.hold_id = p_hold_id
$fn$;

CREATE FUNCTION test_fixture.us208_consent_rows(p_user_id uuid)
  RETURNS TABLE (doc_kind text, doc_version integer, context text, country_code text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.doc_kind, c.doc_version, c.context, c.country_code::text
    FROM core.contract_consent AS c
   WHERE c.user_id = p_user_id AND c.context = 'CHECKOUT'
   ORDER BY c.seq
$fn$;

-- Écriture directe sous migrator : mise à jour, suppression, TRUNCATE. Rend le SQLSTATE et la
-- contrainte de l'erreur, ou 'OK'.
CREATE FUNCTION test_fixture.us208_try_write(p_hold_id uuid, p_kind text)
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
      WHEN 'acceptance' THEN
        UPDATE core.booking_checkout_acceptance SET manual_confirmed_at = NULL
         WHERE hold_id = p_hold_id;
      WHEN 'terms' THEN
        UPDATE core.booking_checkout_terms SET doc_version = doc_version + 1
         WHERE hold_id = p_hold_id;
      WHEN 'delete' THEN
        DELETE FROM core.booking_checkout_terms WHERE hold_id = p_hold_id;
      WHEN 'truncate' THEN
        TRUNCATE core.booking_checkout_terms;
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

-- Version suivante (mineure) d'un document du checkout, propre au pays, dans les quatre langues.
CREATE FUNCTION test_fixture.us208_publish_document(p_kind text, p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
BEGIN
  SELECT COALESCE(pg_catalog.max(t.version), 0) + 1 INTO v_version
    FROM core.contract_document_template AS t
   WHERE t.kind = p_kind AND t.country_code::text = p_country;
  INSERT INTO core.contract_document_template
         (kind, country_code, locale, version, is_major, title, body_md, content_hash,
          legal_review_ref, is_authoritative, valid_from)
  SELECT p_kind, p_country, l.locale, v_version, false, 'Fixture ' || p_kind, 'Fixture.',
         pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, l.locale = 'es',
         platform.now()
    FROM (VALUES ('es'), ('en'), ('fr'), ('pt')) AS l(locale);
  RETURN v_version;
END
$fn$;

CREATE FUNCTION test_fixture.us208_set_param(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- valid_from posé par la garde de 0008 (platform.now()) ; clés du devis seulement
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  SELECT p_key, p_country, 'COUNTRY', p_value, 'test US-208 : valeur de test'
   WHERE p_key LIKE 'quote\_%'
$fn$;

CREATE FUNCTION test_fixture.us208_close_param(p_key text, p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.config_param_value
     SET valid_to = platform.now()
   WHERE key = p_key AND key LIKE 'quote\_%' AND country_code = p_country
     AND scope_type = 'COUNTRY' AND valid_to IS NULL
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us208_listed_listing(text, bigint, text, boolean),
  test_fixture.us208_checkout_rows(uuid), test_fixture.us208_consent_rows(uuid),
  test_fixture.us208_try_write(uuid, text), test_fixture.us208_publish_document(text, text),
  test_fixture.us208_set_param(text, text, jsonb), test_fixture.us208_close_param(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us208_listed_listing(text, bigint, text, boolean),
  test_fixture.us208_checkout_rows(uuid), test_fixture.us208_consent_rows(uuid),
  test_fixture.us208_try_write(uuid, text), test_fixture.us208_publish_document(text, text),
  test_fixture.us208_set_param(text, text, jsonb), test_fixture.us208_close_param(text, text)
  TO app_api;
