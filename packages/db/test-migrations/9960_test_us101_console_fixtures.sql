-- 9960 — fixtures des preuves du cadre des actions de console (US-101, migration 0059). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle :
--   - une action de TEST `TEST_PROBE_ACTION` (DOMAIN_COMMAND, sujet TRIP, permission
--     claim.declare) LIÉE par la vraie table de liaison à une commande de domaine sonde CONFORME
--     (SECURITY DEFINER, propriétaire NOLOGIN cmd_golive_owner, EXECUTE au seul iam_staff_owner).
--     Selon `input.probeMode`, elle écrit un effet (`test_fixture.us101_probe_effect`) et rend DONE,
--     refuse (NOT_ELIGIBLE), ou lève une erreur APRÈS avoir écrit : preuve que la commande liée est
--     appelée dans la MÊME transaction que manual_action et l'audit (critère 1 de 19 US-101) ;
--   - une action de TEST `TEST_PROBE_APPROVAL` (requires_approval), non liée : la base refuse d'y
--     lier autre chose que la demande FINANCE, et refuse l'appel si on l'y force ; une action de
--     TEST `TEST_PROBE_EXPOSED`, non liée, pour une liaison exposée après coup ;
--   - un gestionnaire NON CONFORME par contrôle de la garde (retour, types, modes, colonnes,
--     search_path, SECURITY DEFINER, propriétaire, EXECUTE iam_staff_owner, EXECUTE rôle
--     applicatif) ;
--   - des pièces (`audit_file_asset`) du seau des preuves et d'un autre seau ;
--   - des lectures et des essais ANNULÉS : catalogue, liaisons, types de sujet, garde appliquée à
--     toutes les liaisons (et à une liaison exposée après coup), résolveurs.
-- SECURITY DEFINER sous migrator, search_path figé. `us101_resolve` appelle un résolveur déclaré
-- par EXECUTE (nom lu dans pg_proc, valeur liée) : fixture de test, hors du lint des migrations.
--
-- Retour arrière : DELETE FROM core.support_manual_action_handler WHERE action_code LIKE 'TEST_%' ;
--   DELETE FROM core.support_manual_action_catalog WHERE action_code LIKE 'TEST_%' ;
--   DROP FUNCTION test_fixture.us101_* ; DROP TABLE test_fixture.us101_probe_effect ;
--   REVOKE USAGE ON SCHEMA test_fixture FROM iam_staff_owner, cmd_golive_owner.

CREATE TABLE test_fixture.us101_probe_effect (
  request_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  actor      uuid NOT NULL,
  actor_role text NOT NULL,
  at         timestamptz NOT NULL DEFAULT platform.now()
);
GRANT USAGE ON SCHEMA test_fixture TO iam_staff_owner, cmd_golive_owner;
GRANT INSERT ON test_fixture.us101_probe_effect TO cmd_golive_owner;

-- Gestionnaire sonde CONFORME ------------------------------------------------------------------
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

-- Gestionnaires NON CONFORMES : chacun échoue à un seul contrôle (les précédents passent) -----------
CREATE FUNCTION test_fixture.us101_bad_return(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text $fn$;
CREATE FUNCTION test_fixture.us101_bad_types(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input text, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
CREATE FUNCTION test_fixture.us101_bad_modes(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text,
  OUT outcome text, OUT ref_id uuid, OUT emitted_event_ids uuid[])
  RETURNS SETOF record LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
CREATE FUNCTION test_fixture.us101_bad_columns(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (status text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
CREATE FUNCTION test_fixture.us101_bad_search_path(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
CREATE FUNCTION test_fixture.us101_bad_invoker(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
-- propriétaire de connexion (migrator) : refusé
CREATE FUNCTION test_fixture.us101_bad_owner(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
CREATE FUNCTION test_fixture.us101_bad_no_staff_exec(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;
-- conforme en tout, sauf un droit accordé à app_api (ce qu'un GRANT ultérieur produirait)
CREATE FUNCTION test_fixture.us101_bad_app_exec(p_token_hash bytea, p_action_id uuid,
  p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'DONE'::text, NULL::uuid, '{}'::uuid[] $fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_return(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_types(bytea, uuid, text, uuid, text, text, uuid, text),
  test_fixture.us101_bad_modes(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_columns(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_search_path(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_invoker(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_owner(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_no_staff_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_app_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_return(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_types(bytea, uuid, text, uuid, text, text, uuid, text),
  test_fixture.us101_bad_modes(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_columns(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_search_path(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_invoker(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_owner(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  test_fixture.us101_bad_app_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text)
TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION
  test_fixture.us101_bad_app_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text) TO app_api;
-- propriétaire NOLOGIN pour les gestionnaires qui doivent passer le contrôle « propriétaire »
GRANT CREATE ON SCHEMA test_fixture TO cmd_golive_owner;
ALTER FUNCTION test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO cmd_golive_owner;
ALTER FUNCTION test_fixture.us101_bad_no_staff_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO cmd_golive_owner;
ALTER FUNCTION test_fixture.us101_bad_app_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO cmd_golive_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_golive_owner;

INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES ('TEST_PROBE_ACTION', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, '{probeMode}',
        '{"probeMode": ["done", "refuse", "fail"]}', false),
       ('TEST_PROBE_APPROVAL', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, '{probeMode}',
        '{"probeMode": ["done", "refuse", "fail"]}', true),
       ('TEST_PROBE_EXPOSED', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, '{}', '{}', false);
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('TEST_PROBE_ACTION',
        'test_fixture.us101_probe_handler(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-101');

-- Lectures -----------------------------------------------------------------------------------------
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

-- Catalogue, avec la commande liée (le test compare à 17 §2.3 et §10, et à ADR-091).
CREATE FUNCTION test_fixture.us101_catalog()
  RETURNS TABLE (action_code text, permission_code text, mode text, subject_type text,
                 available boolean, input_keys text[], input_values jsonb, requires_approval boolean,
                 handler text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.action_code, c.permission_code, c.mode, c.subject_type, c.available, c.input_keys,
         c.input_values, c.requires_approval,
         (SELECT pg_catalog.regexp_replace(h.handler::text, ',\s+', ',', 'g')
            FROM core.support_manual_action_handler AS h WHERE h.action_code = c.action_code)
    FROM core.support_manual_action_catalog AS c ORDER BY c.action_code
$fn$;

-- Types de sujet déclarés et leur résolveur.
CREATE FUNCTION test_fixture.us101_subjects()
  RETURNS TABLE (subject_type text, resolver text, why text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.subject_type, s.resolver::text, core.support_subject_resolver_check(s.resolver)
    FROM core.support_manual_action_subject AS s ORDER BY s.subject_type
$fn$;

-- Pays d'un sujet par le résolveur DÉCLARÉ de son type ; `known` faux si le type n'est pas déclaré.
CREATE FUNCTION test_fixture.us101_resolve(p_type text, p_id uuid)
  RETURNS TABLE (known boolean, country text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_resolver regprocedure;
  v_call     text;
  v_country  text;
BEGIN
  SELECT s.resolver INTO v_resolver FROM core.support_manual_action_subject AS s
   WHERE s.subject_type = p_type;
  IF v_resolver IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  SELECT pg_catalog.format('SELECT %I.%I($1)', n.nspname, p.proname) INTO v_call
    FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE p.oid = v_resolver;
  EXECUTE v_call INTO v_country USING p_id;
  RETURN QUERY SELECT true, v_country;
END
$fn$;

-- Contrôles (sans écriture) ------------------------------------------------------------------------
CREATE FUNCTION test_fixture.us101_check(p_action text, p_handler text)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.support_manual_action_handler_check(p_action, p_handler::regprocedure)
$fn$;

-- La garde réappliquée à TOUTES les liaisons en base : aucune ligne = toutes conformes.
CREATE FUNCTION test_fixture.us101_check_all_bindings()
  RETURNS TABLE (action_code text, handler text, why text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.action_code, h.handler::text, core.support_manual_action_handler_check(h.action_code, h.handler)
    FROM core.support_manual_action_handler AS h
   WHERE core.support_manual_action_handler_check(h.action_code, h.handler) IS NOT NULL
   ORDER BY h.action_code
$fn$;

-- Même contrôle, dans une transaction ANNULÉE où une liaison existe vers un gestionnaire exposé à
-- app_api (ce que produirait un GRANT postérieur à la liaison) : rend ce que le contrôle trouve.
-- Le déclencheur de liaison est contourné le temps de l'essai, comme le serait une liaison
-- antérieure au GRANT.
CREATE FUNCTION test_fixture.us101_check_all_with_exposed()
  RETURNS TABLE (action_code text, why text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_found jsonb;
BEGIN
  BEGIN
    ALTER TABLE core.support_manual_action_handler DISABLE TRIGGER manual_action_handler_guard;
    INSERT INTO core.support_manual_action_handler (action_code, handler, story)
    VALUES ('TEST_PROBE_EXPOSED',
            'test_fixture.us101_bad_app_exec(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
            'US-101');
    ALTER TABLE core.support_manual_action_handler ENABLE TRIGGER manual_action_handler_guard;
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.action_code, c.why) ORDER BY c.action_code)
      INTO v_found FROM test_fixture.us101_check_all_bindings() AS c;
    RAISE EXCEPTION 'annulé' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;
  RETURN QUERY SELECT e ->> 0, e ->> 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_found, '[]')) AS e;
END
$fn$;

-- Liaison FORCÉE (déclencheur contourné) : simule une liaison devenue non conforme après coup,
-- pour prouver le contrôle à l'appel. À retirer par us101_unbind dans le même test.
CREATE FUNCTION test_fixture.us101_force_bind(p_action text, p_handler text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_action NOT LIKE 'TEST\_%' THEN
    RAISE EXCEPTION 'fixture : actions de test seulement';
  END IF;
  ALTER TABLE core.support_manual_action_handler DISABLE TRIGGER manual_action_handler_guard;
  INSERT INTO core.support_manual_action_handler (action_code, handler, story)
  VALUES (p_action, p_handler::regprocedure, 'US-101');
  ALTER TABLE core.support_manual_action_handler ENABLE TRIGGER manual_action_handler_guard;
END
$fn$;

CREATE FUNCTION test_fixture.us101_unbind(p_action text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.support_manual_action_handler AS h
   WHERE h.action_code = p_action AND p_action LIKE 'TEST\_%'
$fn$;

-- Essai, ANNULÉ, d'une action de catalogue avec ces clés et valeurs : SQLSTATE et contrainte du
-- refus, ou 'OK' si la base l'aurait admise.
CREATE FUNCTION test_fixture.us101_try_catalog(p_keys text[], p_values jsonb)
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
           (action_code, permission_code, mode, subject_type, available, input_keys, input_values)
    VALUES ('TEST_KEYS_ACTION', 'claim.declare', 'DOMAIN_COMMAND', 'TRIP', false, p_keys, p_values);
    RAISE EXCEPTION 'annulé' USING ERRCODE = 'P0002';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  END;
  RETURN CASE WHEN v_state = 'P0002' THEN 'OK' ELSE v_state || ':' || COALESCE(v_constraint, '') END;
END
$fn$;

-- Essai, ANNULÉ, de liaison d'un gestionnaire à une action, par le déclencheur : SQLSTATE et
-- contrainte, ou 'OK'.
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

-- Essai, ANNULÉ, de déclaration d'un type de sujet : SQLSTATE et contrainte, ou 'OK'.
CREATE FUNCTION test_fixture.us101_try_declare(p_type text, p_resolver text)
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
    INSERT INTO core.support_manual_action_subject (subject_type, resolver, story)
    VALUES (p_type, p_resolver::regprocedure, 'US-101');
    RAISE EXCEPTION 'annulé' USING ERRCODE = 'P0002';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  END;
  RETURN CASE WHEN v_state = 'P0002' THEN 'OK' ELSE v_state || ':' || COALESCE(v_constraint, '') END;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us101_probe_effects(uuid),
  test_fixture.us101_insert_file(uuid, text),
  test_fixture.us101_manual_action(uuid),
  test_fixture.us101_catalog(),
  test_fixture.us101_subjects(),
  test_fixture.us101_resolve(text, uuid),
  test_fixture.us101_check(text, text),
  test_fixture.us101_check_all_bindings(),
  test_fixture.us101_check_all_with_exposed(),
  test_fixture.us101_force_bind(text, text),
  test_fixture.us101_unbind(text),
  test_fixture.us101_try_catalog(text[], jsonb),
  test_fixture.us101_try_bind(text, text),
  test_fixture.us101_try_declare(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us101_probe_effects(uuid),
  test_fixture.us101_insert_file(uuid, text),
  test_fixture.us101_manual_action(uuid),
  test_fixture.us101_catalog(),
  test_fixture.us101_subjects(),
  test_fixture.us101_resolve(text, uuid),
  test_fixture.us101_check(text, text),
  test_fixture.us101_check_all_bindings(),
  test_fixture.us101_check_all_with_exposed(),
  test_fixture.us101_force_bind(text, text),
  test_fixture.us101_unbind(text),
  test_fixture.us101_try_catalog(text[], jsonb),
  test_fixture.us101_try_bind(text, text),
  test_fixture.us101_try_declare(text, text)
TO app_api;
