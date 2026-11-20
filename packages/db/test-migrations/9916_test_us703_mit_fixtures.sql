-- 9916 — fixtures des preuves de la carte enregistrée, du consentement MIT et des débits post-trip
-- (US-703, migration 0169). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser les états
-- que d'autres chemins écrivent (carte enregistrée par le webhook du PSP au lot C ; consentement
-- et rappel donnés par le voyageur au checkout et à la remise, sur un trip né sans hold dans la
-- fixture d'US-011), ajouter une version de règle de réseau de TEST (valeurs posées par le test,
-- jamais tirées d'ici), relire les débits, tentatives, dettes et restrictions (aucun rôle
-- applicatif ne les lit). Les attendus des tests viennent de 19 US-703, 08 (E4, E7 règle 4,
-- BR-PAY-09 bis, T68) et des vecteurs de l'export des oracles, jamais de ces fixtures. AUCUNE
-- fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us703_* (voir la liste des droits en fin de fichier).

-- Carte enregistrée ACTIVE du voyageur sur le compte (la précédente ACTIVE est remplacée)
CREATE FUNCTION test_fixture.us703_card(p_user uuid, p_account uuid, p_network text, p_token text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id      uuid := pg_catalog.gen_random_uuid();
  v_country text;
BEGIN
  SELECT a.country_code INTO v_country FROM core.payment_psp_account AS a WHERE a.id = p_account;
  UPDATE core.payment_payment_instrument AS i
     SET status = 'REPLACED', replaced_at = platform.now()
   WHERE i.user_id = p_user AND i.psp_account_id = p_account AND i.status = 'ACTIVE';
  INSERT INTO core.payment_payment_instrument (id, user_id, psp_account_id, country_code, token_ref,
                                               network, funding, last4, exp_month, exp_year)
  VALUES (v_id, p_user, p_account, v_country, p_token, p_network, 'CREDIT', '4242', 12, 2034);
  RETURN v_id;
END
$fn$;

-- Consentement MIT du voyageur du trip, lié à la carte ; rappel à la remise si demandé
CREATE FUNCTION test_fixture.us703_consent(p_trip uuid, p_instrument uuid, p_scopes text[],
                                           p_reminded boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id   uuid := pg_catalog.gen_random_uuid();
  v_user uuid;
BEGIN
  SELECT t.guest_user_id INTO v_user FROM core.booking_trip AS t WHERE t.id = p_trip;
  INSERT INTO core.payment_mit_consent (id, user_id, trip_id, instrument_id, scopes, consent_key,
                                        catalog_version, locale, bound_at)
  VALUES (v_id, v_user, p_trip, p_instrument, p_scopes, 'web.s05.mitConsent', 104, 'es',
          CASE WHEN p_instrument IS NOT NULL THEN platform.now() END);
  IF p_reminded THEN
    INSERT INTO core.payment_mit_consent_reminder (trip_id, consent_id, user_id, catalog_version,
                                                   locale)
    VALUES (p_trip, v_id, v_user, 104, 'es');
  END IF;
  RETURN v_id;
END
$fn$;

-- Version de règle de TEST (la plus haute fait foi) pour un pays, un réseau et un motif
CREATE FUNCTION test_fixture.us703_rule(p_country text, p_network text, p_reason text,
                                        p_notice_hours integer, p_deadline_days integer,
                                        p_from text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
BEGIN
  SELECT COALESCE(pg_catalog.max(r.version), 0) + 1 INTO v_version
    FROM core.payment_mit_network_rule AS r
   WHERE r.country_code = p_country AND r.network = p_network AND r.reason = p_reason;
  INSERT INTO core.payment_mit_network_rule (country_code, network, reason, version, notice_hours,
                                             deadline_days, deadline_from, retry_offsets_days,
                                             source_ref)
  VALUES (p_country, p_network, p_reason, v_version, p_notice_hours, p_deadline_days, p_from,
          ARRAY[0, 3, 7], 'test US-703');
END
$fn$;

-- Lecture d'un débit post-trip
CREATE FUNCTION test_fixture.us703_charge(p_charge uuid)
  RETURNS TABLE (status text, attempt_no integer, outcome_code text, next_check_at timestamptz,
                 network text, leg_reported boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.status, c.attempt_no, c.outcome_code, c.next_check_at, c.network, c.leg_reported
    FROM core.payment_post_trip_charge AS c WHERE c.id = p_charge
$fn$;

-- Tentatives d'un débit et statut de leur ordre
CREATE FUNCTION test_fixture.us703_attempts(p_charge uuid)
  RETURNS TABLE (attempt_no integer, idem_plain text, operation_id uuid, operation_status text,
                 amount_minor bigint, settled text, do_not_retry boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.attempt_no, a.idem_plain, a.operation_id, o.status, a.amount_minor, a.settled,
         a.do_not_retry
    FROM core.payment_post_trip_charge_attempt AS a
    LEFT JOIN core.payment_payment_operation AS o ON o.id = a.operation_id
   WHERE a.charge_id = p_charge
   ORDER BY a.attempt_no
$fn$;

-- Dette d'un débit
CREATE FUNCTION test_fixture.us703_debt(p_charge uuid)
  RETURNS TABLE (id uuid, status text, opened_reason text, amount_minor bigint,
                 paid_host_minor bigint, paid_insurer_minor bigint,
                 paid_tax_third_party_minor bigint, paid_platform_minor bigint,
                 collection_seq integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.id, d.status, d.opened_reason, d.amount_minor, d.paid_host_minor, d.paid_insurer_minor,
         d.paid_tax_third_party_minor, d.paid_platform_minor, d.collection_seq
    FROM core.payment_debt_balance AS d WHERE d.charge_id = p_charge
$fn$;

-- Restrictions UNPAID_BALANCE actives d'un voyageur
CREATE FUNCTION test_fixture.us703_unpaid_restrictions(p_user uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT count(*)::integer FROM core.iam_restriction AS r
   WHERE r.user_id = p_user AND r.kind = 'UNPAID_BALANCE' AND r.active
$fn$;

-- Écriture directe interdite (gardes) : mise à jour d'un débit, d'une dette ou d'un consentement
CREATE FUNCTION test_fixture.us703_try_write(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'CHARGE_AMOUNT' THEN
    UPDATE core.payment_post_trip_charge SET amount_minor = amount_minor + 1,
                                             leg_platform_minor = leg_platform_minor + 1
     WHERE id = p_id;
  ELSIF p_what = 'DEBT_PAID_DOWN' THEN
    UPDATE core.payment_debt_balance SET paid_host_minor = paid_host_minor - 1 WHERE id = p_id;
  ELSIF p_what = 'CONSENT_REBIND' THEN
    UPDATE core.payment_mit_consent SET instrument_id = NULL, bound_at = NULL WHERE id = p_id;
  ELSIF p_what = 'RULE' THEN
    UPDATE core.payment_mit_network_rule SET notice_hours = 0
     WHERE country_code = (SELECT t.country_code FROM core.booking_trip AS t WHERE t.id = p_id);
  END IF;
END
$fn$;

-- Hold de demande dont le paiement est en vol (PAYMENT_IN_FLIGHT, fixture 9948) d'un voyageur
-- EXISTANT (échéance du hold : heure de la base + 1 jour, garde hold_has_ttl) : consentement et
-- carte du paiement prouvé. PL/pgSQL : 9948 est appliquée APRÈS ce
-- fichier (ordre des numéros), le corps n'est résolu qu'à l'appel
CREATE FUNCTION test_fixture.us703_paying_hold(p_country text, p_guest uuid, p_start timestamptz,
                                               p_end timestamptz, p_total bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_hold uuid;
BEGIN
  SELECT r.hold_id INTO v_hold
    FROM test_fixture.us214_request(p_country, p_guest, 'Luis', 'Benítez', 'Ciudad de prueba',
                                    p_start, p_end, p_total,
                                    platform.now() + interval '1 day', 'IN_FLIGHT') AS r;
  RETURN v_hold;
END
$fn$;

-- Consentement donné au checkout sur un hold (aucune carte encore liée)
CREATE FUNCTION test_fixture.us703_hold_consent(p_hold uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.payment_mit_consent (id, user_id, hold_id, scopes, consent_key, catalog_version,
                                        locale)
  SELECT v_id, h.guest_user_id, h.id,
         ARRAY['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
         'web.s05.mitConsent', 104, 'es'
    FROM core.booking_checkout_hold AS h WHERE h.id = p_hold;
  RETURN v_id;
END
$fn$;

-- Consentement d'un hold relu (liaison à la carte)
CREATE FUNCTION test_fixture.us703_consent_of_hold(p_hold uuid)
  RETURNS TABLE (id uuid, instrument_id uuid, bound_at timestamptz, trip_id uuid,
                 consent_key text, catalog_version integer, locale text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.instrument_id, c.bound_at, c.trip_id, c.consent_key, c.catalog_version, c.locale
    FROM core.payment_mit_consent AS c WHERE c.hold_id = p_hold
$fn$;

-- Forme du consentement du pays (`mit_consent_checkbox_required`, DEC-FONDATEUR-22) : la valeur
-- en vigueur est close à platform.now() ; une nouvelle version est posée si p_value n'est pas NULL
-- (NULL : paramètre ABSENT, fail_mode BLOCK). Cette seule clé ; transaction de test annulée.
CREATE FUNCTION test_fixture.us703_set_consent_param(p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.config_param_value
     SET valid_to = platform.now()
   WHERE key = 'mit_consent_checkbox_required' AND country_code = p_country
     AND scope_type = 'COUNTRY' AND valid_to IS NULL;
  IF p_value IS NOT NULL THEN
    INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
    VALUES ('mit_consent_checkbox_required', p_country, 'COUNTRY', p_value,
            'test US-703 : forme du consentement');
  END IF;
END
$fn$;

-- Cartes d'un voyageur (statut seulement, jamais le jeton)
CREATE FUNCTION test_fixture.us703_cards(p_user uuid)
  RETURNS TABLE (id uuid, status text, network text, last4 text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.network, i.last4
    FROM core.payment_payment_instrument AS i WHERE i.user_id = p_user ORDER BY i.created_at, i.id
$fn$;

-- Règle en vigueur (version la plus haute) d'un pays, d'un réseau et d'un motif
CREATE FUNCTION test_fixture.us703_rule_of(p_country text, p_network text, p_reason text)
  RETURNS TABLE (notice_hours integer, deadline_days integer, deadline_from text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.notice_hours, r.deadline_days, r.deadline_from
    FROM core.payment_mit_network_rule AS r
   WHERE r.country_code = p_country AND r.network = p_network AND r.reason = p_reason
   ORDER BY r.version DESC
   LIMIT 1
$fn$;

-- Valeur en vigueur d'un paramètre du pays (portée COUNTRY, ou NETWORK si `p_network`)
CREATE FUNCTION test_fixture.us703_param(p_key text, p_country text, p_network text)
  RETURNS TABLE (value jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.value
    FROM core.config_param_value AS v
   WHERE v.key = p_key AND v.country_code::text = p_country
     AND (CASE WHEN p_network IS NULL THEN v.scope_type = 'COUNTRY'
               ELSE v.scope_type = 'NETWORK' AND v.network = p_network END)
     AND v.valid_from <= platform.now() AND (v.valid_to IS NULL OR v.valid_to > platform.now())
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us703_card(uuid, uuid, text, text),
  test_fixture.us703_consent(uuid, uuid, text[], boolean),
  test_fixture.us703_rule(text, text, text, integer, integer, text),
  test_fixture.us703_charge(uuid),
  test_fixture.us703_attempts(uuid),
  test_fixture.us703_debt(uuid),
  test_fixture.us703_unpaid_restrictions(uuid),
  test_fixture.us703_try_write(text, uuid),
  test_fixture.us703_paying_hold(text, uuid, timestamptz, timestamptz, bigint),
  test_fixture.us703_hold_consent(uuid),
  test_fixture.us703_consent_of_hold(uuid),
  test_fixture.us703_cards(uuid),
  test_fixture.us703_rule_of(text, text, text),
  test_fixture.us703_param(text, text, text),
  test_fixture.us703_set_consent_param(text, jsonb)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us703_card(uuid, uuid, text, text),
  test_fixture.us703_consent(uuid, uuid, text[], boolean),
  test_fixture.us703_rule(text, text, text, integer, integer, text),
  test_fixture.us703_charge(uuid),
  test_fixture.us703_attempts(uuid),
  test_fixture.us703_debt(uuid),
  test_fixture.us703_unpaid_restrictions(uuid),
  test_fixture.us703_try_write(text, uuid),
  test_fixture.us703_paying_hold(text, uuid, timestamptz, timestamptz, bigint),
  test_fixture.us703_hold_consent(uuid),
  test_fixture.us703_consent_of_hold(uuid),
  test_fixture.us703_cards(uuid),
  test_fixture.us703_rule_of(text, text, text),
  test_fixture.us703_param(text, text, text),
  test_fixture.us703_set_consent_param(text, jsonb)
TO app_worker, app_api;
