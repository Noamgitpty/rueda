-- 9900 — fixtures de la matrice d'autorisations (US-043, ADR-077). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (et à ses copies) ; la base `rueda_test_*_prod` n'a pas le
-- schéma test_fixture. SECURITY DEFINER sous migrator (propriétaire des tables, politique
-- `migrator_all`), search_path figé, hors liste blanche RLS-15 (qui porte sur la base de production).
--
--   1. us043_expected(relation, source, prédicat, paramètres, colonne d'identifiant, par pays) :
--      ATTENDU d'une cellule de la matrice, calculé SANS la RLS des rôles applicatifs (migrator
--      voit tout) dans la transaction et l'instantané de l'appelant (REPEATABLE READ) : nombre de
--      lignes qui satisfont le prédicat de la matrice, empreinte md5 de leurs identifiants et
--      nombre par pays. Le prédicat est un texte de la matrice (packages/db/authorization-matrix.json,
--      revue sécurité) ; les valeurs (acteur, compte d'hôte, pays…) sont des PARAMÈTRES liés ($1,
--      jsonb). C'est le seul SQL dynamique des fixtures : relation et colonnes validées par le
--      catalogue (to_regclass, pg_attribute), jamais concaténées sans quote_ident.
--   2. us043_seed_subject_key(type, sujet) : clé par sujet de test (wrapped_dek aléatoire, KMS
--      fictif), pour peupler audit_subject_key (son écrivain réel est la couche d'audit, US-009).
--   3. us043_seed_submerchant(compte d'hôte) : sous-marchand PENDING sur un compte FAKE du pays du
--      compte d'hôte (son écrivain réel est la commande du travailleur payment_command, US-061).
--   4. us043_enable_totp(compte) : facteur TOTP ACTIF (référence de coffre fictive), pour que la
--      console reconnaisse une session élevée de test (test:int des routes d'apps/api) ; le
--      parcours réel d'enrôlement est prouvé par l0-iam-staff-mfa et pg-staff-store.int.test.ts.
--
-- Retour arrière : DROP FUNCTION test_fixture.us043_expected(text, text, text, jsonb, text, boolean),
--   test_fixture.us043_seed_subject_key(text, uuid), test_fixture.us043_seed_submerchant(uuid),
--   test_fixture.us043_enable_totp(uuid);

CREATE FUNCTION test_fixture.us043_expected(p_relation text, p_source text, p_predicate text,
                                            p_params jsonb, p_id_column text, p_by_country boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_rel     regclass := pg_catalog.to_regclass(COALESCE(NULLIF(p_source, ''), p_relation));
  v_id      text;
  v_n       bigint;
  v_ids     text;
  v_country jsonb := '{}'::jsonb;
BEGIN
  IF v_rel IS NULL OR (SELECT n.nspname FROM pg_catalog.pg_class c
                         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE c.oid = v_rel) NOT IN ('core', 'platform') THEN
    RAISE EXCEPTION 'us043_expected: relation inconnue %', p_relation;
  END IF;
  IF p_id_column IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = v_rel AND attname = p_id_column AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'us043_expected: colonne % absente de %', p_id_column, p_relation;
  END IF;
  v_id := CASE WHEN p_id_column IS NULL THEN 'NULL::text'
               ELSE pg_catalog.format('r.%I::text', p_id_column) END;
  EXECUTE pg_catalog.format(
    'SELECT count(*), pg_catalog.md5(COALESCE(pg_catalog.string_agg(%s, '','' ORDER BY %s), '''')) '
    'FROM %s AS r WHERE (%s)', v_id, v_id, v_rel, p_predicate)
    INTO v_n, v_ids USING p_params;
  IF p_by_country THEN
    EXECUTE pg_catalog.format(
      'SELECT COALESCE(pg_catalog.jsonb_object_agg(k, n), ''{}''::jsonb) FROM ('
      'SELECT COALESCE(r.country_code::text, '''') AS k, count(*) AS n FROM %s AS r WHERE (%s) '
      'GROUP BY 1) AS x', v_rel, p_predicate)
      INTO v_country USING p_params;
  END IF;
  RETURN pg_catalog.jsonb_build_object('n', v_n, 'ids', v_ids, 'countries', v_country);
END
$fn$;

CREATE FUNCTION test_fixture.us043_seed_subject_key(p_type text, p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
  VALUES (p_type, p_id, pg_catalog.decode(pg_catalog.md5(pg_catalog.random()::text) || pg_catalog.md5(pg_catalog.random()::text), 'hex'), 'test:us043')
  ON CONFLICT DO NOTHING
$fn$;

CREATE FUNCTION test_fixture.us043_seed_submerchant(p_org_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_account  uuid := pg_catalog.gen_random_uuid();
  v_id       uuid := pg_catalog.gen_random_uuid();
  v_country  text;
  v_currency text;
BEGIN
  SELECT o.country_code, c.currency::text INTO v_country, v_currency
    FROM core.iam_organization AS o
    JOIN core.config_country AS c ON c.code = o.country_code
   WHERE o.id = p_org_id;
  INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
  VALUES (v_account, 'FAKE', v_country, 'SANDBOX', 'PENDING_VALIDATION',
          pg_catalog.replace(v_account::text, '-', ''));
  INSERT INTO core.payment_psp_submerchant
         (id, psp_account_id, org_id, country_code, attempt_no, idem_plain, payout_currency)
  VALUES (v_id, v_account, p_org_id, v_country, 1,
          pg_catalog.format('submerchant:%s:a1', p_org_id), v_currency);
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us043_enable_totp(p_user_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_auth_factor (id, user_id, kind, secret_ref, enabled_at)
  VALUES (pg_catalog.gen_random_uuid(), p_user_id, 'TOTP', 'fake-vault:us043', platform.now())
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us043_enable_totp(uuid),
  test_fixture.us043_expected(text, text, text, jsonb, text, boolean),
  test_fixture.us043_seed_subject_key(text, uuid),
  test_fixture.us043_seed_submerchant(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us043_expected(text, text, text, jsonb, text, boolean)
  TO app_api, app_worker;
GRANT EXECUTE ON FUNCTION
  test_fixture.us043_enable_totp(uuid),
  test_fixture.us043_seed_subject_key(text, uuid),
  test_fixture.us043_seed_submerchant(uuid)
  TO app_api;
