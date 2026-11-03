-- 9700 — fixtures des preuves d'US-062 (rôle P2P_HOST, tables d'argent, minimisation). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : poser les lignes que les écrivains métier de leurs stories créeront (avance de Kmino :
-- US-224 / US-709 ; bordereau et position de l'assureur : US-227), donner par ERREUR une
-- permission à un co-hôte (RLS-28), poser une date de naissance, et relire les colonnes du
-- personnel qu'aucun rôle applicatif ne lit. SECURITY DEFINER sous migrator (les triggers de garde
-- s'appliquent aussi à migrator), search_path figé, aucun SQL dynamique. La portée (compte
-- d'hôte, pays, devise) est relue du trip, comme le feront les commandes réelles.
--
-- `us062_worker_write_off` est CÉDÉE à cmd_money_owner : elle exécute réellement, sous ce
-- propriétaire et sous le contexte du travailleur appelant, un passage en perte, pour prouver que
-- la politique cmd_advance_upd le refuse à tout travailleur (réserve 3 d'US-056).
--
-- Retour arrière : DROP FUNCTION test_fixture.us062_insert_advance(uuid, uuid, text, bigint),
--   test_fixture.us062_insert_bordereau(uuid, text, text, bigint),
--   test_fixture.us062_insert_bordereau_line(uuid, uuid, bigint),
--   test_fixture.us062_insert_insurer_ledger(uuid, text, text, bigint),
--   test_fixture.us062_set_permission_overrides(uuid, uuid, text[]),
--   test_fixture.us062_set_birth_date(uuid, date), test_fixture.us062_advance_row(uuid),
--   test_fixture.us062_bordereau_row(uuid), test_fixture.us062_approval_row(uuid),
--   test_fixture.us062_force_decision(uuid, uuid, uuid, uuid),
--   test_fixture.us062_worker_write_off(uuid), test_fixture.us062_try_delete(text),
--   test_fixture.us062_try_truncate(text);

CREATE FUNCTION test_fixture.us062_insert_advance(p_id uuid, p_trip_id uuid, p_cause text,
                                                  p_amount bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_platform_advance
         (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
          receivable_minor)
  SELECT p_id, t.country_code, t.currency, t.id, t.org_id, p_cause, p_amount,
         CASE WHEN p_cause = 'RELEASED_LEG' THEN 'TRIP_PLATFORM_LEG' ELSE 'COUNTRY_PLATFORM_BALANCE' END,
         CASE WHEN p_cause IN ('RELEASED_LEG', 'HOST_COMPENSATION') THEN p_amount ELSE 0 END
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
$fn$;

CREATE FUNCTION test_fixture.us062_insert_bordereau(p_id uuid, p_country text, p_currency text,
                                                    p_total bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_insurer_bordereau
         (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor)
  VALUES (p_id, pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), p_country, p_currency,
          tstzrange('2031-01-01T00:00:00Z', '2031-02-01T00:00:00Z', '[)'), p_total)
$fn$;

CREATE FUNCTION test_fixture.us062_insert_bordereau_line(p_bordereau_id uuid, p_trip_id uuid,
                                                         p_amount bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_insurer_bordereau_line
         (bordereau_id, country_code, trip_id, segment_no, amount_minor)
  SELECT p_bordereau_id, t.country_code, t.id, 1, p_amount
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
$fn$;

CREATE FUNCTION test_fixture.us062_insert_insurer_ledger(p_insurer_id uuid, p_country text,
                                                         p_currency text, p_payable bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_insurer_ledger_state (insurer_id, country_code, currency, payable_minor)
  VALUES (p_insurer_id, p_country, p_currency, p_payable)
$fn$;

-- Le titulaire accorde par ERREUR une permission unitaire à un co-hôte (RLS-28).
CREATE FUNCTION test_fixture.us062_set_permission_overrides(p_user_id uuid, p_org_id uuid,
                                                            p_permissions text[])
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_membership SET permission_overrides = p_permissions
   WHERE user_id = p_user_id AND org_id = p_org_id
$fn$;

CREATE FUNCTION test_fixture.us062_set_birth_date(p_user_id uuid, p_date date)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account SET date_of_birth = p_date WHERE id = p_user_id
$fn$;

-- Colonnes du personnel, illisibles par tout rôle applicatif : relues ici pour les preuves.
CREATE FUNCTION test_fixture.us062_advance_row(p_id uuid)
  RETURNS TABLE (status text, decided_by uuid, decision_second_by uuid, written_off_by uuid,
                 write_off_second_by uuid, written_off boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.status, a.decided_by, a.decision_second_by, a.written_off_by, a.write_off_second_by,
         a.written_off_at IS NOT NULL
    FROM core.settlement_platform_advance AS a WHERE a.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us062_bordereau_row(p_id uuid)
  RETURNS TABLE (status text, issued_by uuid, second_validated_by uuid, approval_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.status, b.issued_by, b.second_validated_by, b.approval_id
    FROM core.settlement_insurer_bordereau AS b WHERE b.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us062_approval_row(p_id uuid)
  RETURNS TABLE (action text, status text, requested_by uuid, approved_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.action, f.status, f.requested_by, f.approved_by
    FROM core.settlement_finance_approval AS f WHERE f.id = p_id
$fn$;

-- Écriture DIRECTE d'une décision sous migrator, sans demande approuvée correspondante : le
-- trigger advance_transition_guard / advance_two_person_rule doit la refuser à tous les rôles.
CREATE FUNCTION test_fixture.us062_force_decision(p_id uuid, p_by uuid, p_second uuid,
                                                  p_approval_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_platform_advance
     SET decided_by = p_by, decision_second_by = p_second, decision_approval_id = p_approval_id
   WHERE id = p_id
$fn$;

-- Passage en perte tenté sous cmd_money_owner par un TRAVAILLEUR (contexte de l'appelant).
CREATE FUNCTION test_fixture.us062_worker_write_off(p_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE core.settlement_platform_advance SET status = 'WRITTEN_OFF' WHERE id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- DELETE / TRUNCATE sous migrator (propriétaire des tables) : les triggers money_no_delete et
-- money_no_truncate doivent les refuser à tous les rôles. Une branche statique par table.
CREATE FUNCTION test_fixture.us062_try_delete(p_table text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_table
    WHEN 'settlement_finance_approval' THEN DELETE FROM core.settlement_finance_approval;
    WHEN 'settlement_platform_advance' THEN DELETE FROM core.settlement_platform_advance;
    WHEN 'settlement_insurer_ledger_state' THEN DELETE FROM core.settlement_insurer_ledger_state;
    WHEN 'settlement_insurer_bordereau' THEN DELETE FROM core.settlement_insurer_bordereau;
    WHEN 'settlement_insurer_bordereau_line' THEN DELETE FROM core.settlement_insurer_bordereau_line;
  END CASE;
END
$fn$;

-- Tables non référencées par une clé étrangère (sinon TRUNCATE est refusé avant les triggers).
CREATE FUNCTION test_fixture.us062_try_truncate(p_table text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_table
    WHEN 'settlement_platform_advance' THEN TRUNCATE core.settlement_platform_advance;
    WHEN 'settlement_insurer_ledger_state' THEN TRUNCATE core.settlement_insurer_ledger_state;
    WHEN 'settlement_insurer_bordereau_line' THEN TRUNCATE core.settlement_insurer_bordereau_line;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us062_try_delete(text), test_fixture.us062_try_truncate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us062_try_delete(text), test_fixture.us062_try_truncate(text) TO app_api;

REVOKE ALL ON FUNCTION
  test_fixture.us062_insert_advance(uuid, uuid, text, bigint),
  test_fixture.us062_insert_bordereau(uuid, text, text, bigint),
  test_fixture.us062_insert_bordereau_line(uuid, uuid, bigint),
  test_fixture.us062_insert_insurer_ledger(uuid, text, text, bigint),
  test_fixture.us062_set_permission_overrides(uuid, uuid, text[]),
  test_fixture.us062_set_birth_date(uuid, date),
  test_fixture.us062_advance_row(uuid),
  test_fixture.us062_bordereau_row(uuid),
  test_fixture.us062_approval_row(uuid),
  test_fixture.us062_force_decision(uuid, uuid, uuid, uuid),
  test_fixture.us062_worker_write_off(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us062_insert_advance(uuid, uuid, text, bigint),
  test_fixture.us062_insert_bordereau(uuid, text, text, bigint),
  test_fixture.us062_insert_bordereau_line(uuid, uuid, bigint),
  test_fixture.us062_insert_insurer_ledger(uuid, text, text, bigint),
  test_fixture.us062_set_permission_overrides(uuid, uuid, text[]),
  test_fixture.us062_set_birth_date(uuid, date),
  test_fixture.us062_advance_row(uuid),
  test_fixture.us062_bordereau_row(uuid),
  test_fixture.us062_approval_row(uuid),
  test_fixture.us062_force_decision(uuid, uuid, uuid, uuid),
  test_fixture.us062_worker_write_off(uuid)
TO app_api, app_worker;

GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.us062_worker_write_off(uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
