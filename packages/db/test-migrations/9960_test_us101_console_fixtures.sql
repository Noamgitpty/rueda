-- 9960 — fixtures des preuves du cadre des actions de console (US-101, migration 0059). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle :
--   - une action de TEST `TEST_PROBE_ACTION` (DOMAIN_COMMAND, sujet TRIP, permission
--     claim.declare) LIÉE par la vraie table de liaison à une commande de domaine sonde : elle
--     écrit un effet (`test_fixture.us101_probe_effect`) puis, selon `input.probeMode`, rend DONE,
--     refuse (NOT_ELIGIBLE) ou lève une erreur APRÈS avoir écrit. Elle prouve que la commande liée
--     est appelée dans la MÊME transaction que manual_action et l'audit (critère 1 de 19 US-101) ;
--     aucune commande de domaine d'état n'existe encore en production ;
--   - des pièces (`audit_file_asset`) du seau des preuves et d'un autre seau ;
--   - deux essais du CONTRÔLE de la base, annulés : clés de saisie interdites au catalogue, et
--     liaison d'un gestionnaire non conforme.
-- SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique.
--
-- Retour arrière : DELETE FROM core.support_manual_action_handler WHERE action_code = 'TEST_PROBE_ACTION' ;
--   DELETE FROM core.support_manual_action_catalog WHERE action_code = 'TEST_PROBE_ACTION' ;
--   DROP FUNCTION test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     test_fixture.us101_probe_effects(uuid), test_fixture.us101_insert_file(uuid, text),
--     test_fixture.us101_try_catalog_keys(text[]), test_fixture.us101_try_bind(text, text),
--     test_fixture.us101_manual_action(uuid), test_fixture.us101_catalog() ;
--   DROP TABLE test_fixture.us101_probe_effect.

CREATE TABLE test_fixture.us101_probe_effect (
  request_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  actor      uuid NOT NULL,
  actor_role text NOT NULL,
  at         timestamptz NOT NULL DEFAULT platform.now()
);

CREATE FUNCTION test_fixture.us101_probe_handler(p_token_hash bytea, p_action_id uuid,
                                                 p_action_code text, p_subject_id uuid,
                                                 p_input jsonb, p_reason text, p_actor uuid,
                                                 p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_mode text := COALESCE(p_input ->> 'probeMode', 'done');
BEGIN
  IF v_mode = 'refuse' THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  INSERT INTO test_fixture.us101_probe_effect (request_id, subject_id, actor, actor_role)
  VALUES (p_action_id, p_subject_id, p_actor, p_actor_role);
  IF v_mode = 'fail' THEN
    RAISE EXCEPTION 'sonde US-101 : échec après écriture' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT 'DONE'::text, p_action_id, ARRAY[p_action_id];
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT USAGE ON SCHEMA test_fixture TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;

INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys)
VALUES ('TEST_PROBE_ACTION', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, '{probeMode}');
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('TEST_PROBE_ACTION',
        'test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-101');

-- Effets de la sonde pour un sujet.
CREATE FUNCTION test_fixture.us101_probe_effects(p_subject_id uuid)
  RETURNS TABLE (request_id uuid, actor uuid, actor_role text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.request_id, e.actor, e.actor_role FROM test_fixture.us101_probe_effect AS e
   WHERE e.subject_id = p_subject_id ORDER BY e.at, e.request_id
$fn$;

-- Pièce reçue (C1, sans clé de sujet) dans le seau donné.
CREATE FUNCTION test_fixture.us101_insert_file(p_id uuid, p_bucket text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, source,
                                     classification, retention_class)
  VALUES (p_id, p_bucket, 'us101/' || p_id::text, 'application/pdf', 1024,
          pg_catalog.sha256(pg_catalog.convert_to(p_id::text, 'UTF8')), 'STAFF_UPLOAD', 'C1',
          'EVIDENCE')
$fn$;

-- Ligne manual_action complète (colonnes du cadre d'US-101).
CREATE FUNCTION test_fixture.us101_manual_action(p_id uuid)
  RETURNS TABLE (action_code text, mode text, country_code text, actor_role text, outcome text,
                 domain_ref uuid, input jsonb, evidence_file_ids uuid[], emitted_event_ids uuid[],
                 audit_log_id bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.action_code, m.mode, m.country_code, m.actor_role, m.outcome, m.domain_ref, m.input,
         m.evidence_file_ids, m.emitted_event_ids, m.audit_log_id
    FROM core.support_manual_action AS m WHERE m.id = p_id
$fn$;

-- Catalogue des actions, avec la liaison éventuelle (le test compare à 17 §10 et 19 US-101).
CREATE FUNCTION test_fixture.us101_catalog()
  RETURNS TABLE (action_code text, permission_code text, mode text, subject_type text,
                 available boolean, input_keys text[], bound boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.action_code, c.permission_code, c.mode, c.subject_type, c.available, c.input_keys,
         EXISTS (SELECT 1 FROM core.support_manual_action_handler AS h
                  WHERE h.action_code = c.action_code)
    FROM core.support_manual_action_catalog AS c ORDER BY c.action_code
$fn$;

-- Essai, ANNULÉ, d'une action de catalogue avec ces clés de saisie : SQLSTATE et contrainte du
-- refus, ou 'OK' si la base l'aurait admise.
CREATE FUNCTION test_fixture.us101_try_catalog_keys(p_keys text[])
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_state text;
  v_constraint text;
BEGIN
  BEGIN
    INSERT INTO core.support_manual_action_catalog
           (action_code, permission_code, mode, subject_type, available, input_keys)
    VALUES ('TEST_KEYS_ACTION', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, p_keys);
    RAISE EXCEPTION 'annulé' USING ERRCODE = 'P0002';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  END;
  RETURN CASE WHEN v_state = 'P0002' THEN 'OK' ELSE v_state || ':' || COALESCE(v_constraint, '') END;
END
$fn$;

-- Essai, ANNULÉ, de liaison d'un gestionnaire à une action : SQLSTATE et contrainte, ou 'OK'.
CREATE FUNCTION test_fixture.us101_try_bind(p_action text, p_handler text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_state text;
  v_constraint text;
BEGIN
  BEGIN
    DELETE FROM core.support_manual_action_handler AS h WHERE h.action_code = p_action;
    INSERT INTO core.support_manual_action_handler (action_code, handler, story)
    VALUES (p_action, p_handler::regprocedure, 'US-101');
    RAISE EXCEPTION 'annulé' USING ERRCODE = 'P0002';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  END;
  RETURN CASE WHEN v_state = 'P0002' THEN 'OK' ELSE v_state || ':' || COALESCE(v_constraint, '') END;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us101_catalog(),
  test_fixture.us101_probe_effects(uuid),
  test_fixture.us101_insert_file(uuid, text),
  test_fixture.us101_manual_action(uuid),
  test_fixture.us101_try_catalog_keys(text[]),
  test_fixture.us101_try_bind(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us101_catalog(),
  test_fixture.us101_probe_effects(uuid),
  test_fixture.us101_insert_file(uuid, text),
  test_fixture.us101_manual_action(uuid),
  test_fixture.us101_try_catalog_keys(text[]),
  test_fixture.us101_try_bind(text, text)
TO app_api;
