-- 9600 — fixtures des tests du staff et de la console (US-012). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : remplacer les gestes HORS APPLICATION que la production confie à l'exploitation
-- (runbook, ADR-062) — installation de la clé de preuve MFA, facteur en attente du premier ADMIN —
-- et ouvrir directement des sessions déjà élevées pour les preuves RLS qui ne testent pas la MFA
-- elle-même (monde de test/support/rls.ts). SECURITY DEFINER sous migrator, search_path figé,
-- aucun SQL dynamique. La clé de test est une valeur de TEST (dérivée d'une chaîne publique dans
-- test/support/staff.ts), jamais un secret.
--
-- Retour arrière : DROP FUNCTION test_fixture.iam_install_mfa_proof_key(bytea),
--   test_fixture.iam_delete_mfa_proof_key(), test_fixture.iam_open_elevated_session(uuid, bytea),
--   test_fixture.iam_insert_pending_totp(uuid, uuid, text, bytea, integer),
--   test_fixture.iam_read_factors(uuid), test_fixture.iam_read_session_mfa(bytea),
--   test_fixture.iam_hmac_sha256(bytea, bytea), test_fixture.audit_rows_of_actor(uuid),
--   test_fixture.manual_action_row(uuid);

CREATE FUNCTION test_fixture.iam_install_mfa_proof_key(p_key bytea)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_mfa_proof_key (id, key) VALUES (1, p_key) ON CONFLICT (id) DO NOTHING
$fn$;

-- À n'appeler que dans une transaction annulée (preuve « aucune clé => aucune élévation »).
CREATE FUNCTION test_fixture.iam_delete_mfa_proof_key()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.iam_mfa_proof_key
$fn$;

-- Session de staff déjà élevée (TOTP), 8 h : pour les preuves RLS qui ne portent pas sur la MFA.
CREATE FUNCTION test_fixture.iam_open_elevated_session(p_user_id uuid, p_token_hash bytea)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_session (id, user_id, token_hash, expires_at, mfa_level, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_token_hash, platform.now() + interval '8 hours', 'TOTP',
          platform.now())
$fn$;

-- Facteur TOTP en attente (procédure d'amorçage du premier ADMIN, hors application).
CREATE FUNCTION test_fixture.iam_insert_pending_totp(p_factor_id uuid, p_user_id uuid,
                                                     p_secret_ref text, p_code_hash bytea,
                                                     p_ttl_s integer)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_auth_factor (id, user_id, kind, secret_ref, enrollment_code_hash,
                                    enrollment_expires_at)
  VALUES (p_factor_id, p_user_id, 'TOTP', p_secret_ref, p_code_hash,
          platform.now() + pg_catalog.make_interval(secs => p_ttl_s))
$fn$;

CREATE FUNCTION test_fixture.iam_read_factors(p_user_id uuid)
  RETURNS TABLE (id uuid, enabled_at timestamptz, disabled_at timestamptz, last_used_step bigint,
                 failed_attempts integer, locked_until timestamptz, has_code boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.id, f.enabled_at, f.disabled_at, f.last_used_step, f.failed_attempts, f.locked_until,
         f.enrollment_code_hash IS NOT NULL
    FROM core.iam_auth_factor AS f WHERE f.user_id = p_user_id ORDER BY f.created_at, f.id
$fn$;

CREATE FUNCTION test_fixture.iam_read_session_mfa(p_token_hash bytea)
  RETURNS TABLE (mfa_level text, revoked_reason text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.mfa_level, s.revoked_reason FROM core.iam_session AS s WHERE s.token_hash = p_token_hash
$fn$;

-- Accès de test à la primitive (EXECUTE réservé à iam_staff_owner en production) : vecteurs RFC 4231.
CREATE FUNCTION test_fixture.iam_hmac_sha256(p_key bytea, p_msg bytea)
  RETURNS bytea
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_hmac_sha256(p_key, p_msg)
$fn$;

-- Lignes du journal écrites par un acteur (preuve « chaque action est journalisée »).
CREATE FUNCTION test_fixture.audit_rows_of_actor(p_actor uuid)
  RETURNS TABLE (id bigint, actor_role text, action_code text, subject_type text, subject_id uuid,
                 before jsonb, after jsonb, reason text, request_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.actor_role, l.action_code, l.subject_type, l.subject_id, l.before, l.after, l.reason,
         l.request_id
    FROM core.audit_audit_log AS l WHERE l.actor_user_id = p_actor ORDER BY l.id
$fn$;

-- Ligne d'action de console (preuve du rattachement à l'audit).
CREATE FUNCTION test_fixture.manual_action_row(p_id uuid)
  RETURNS TABLE (action_code text, mode text, country_code text, actor_role text, audit_log_id bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.action_code, m.mode, m.country_code, m.actor_role, m.audit_log_id
    FROM core.support_manual_action AS m WHERE m.id = p_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.iam_hmac_sha256(bytea, bytea),
  test_fixture.audit_rows_of_actor(uuid),
  test_fixture.manual_action_row(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.iam_hmac_sha256(bytea, bytea),
  test_fixture.audit_rows_of_actor(uuid),
  test_fixture.manual_action_row(uuid)
TO app_api;

REVOKE ALL ON FUNCTION
  test_fixture.iam_install_mfa_proof_key(bytea),
  test_fixture.iam_delete_mfa_proof_key(),
  test_fixture.iam_open_elevated_session(uuid, bytea),
  test_fixture.iam_insert_pending_totp(uuid, uuid, text, bytea, integer),
  test_fixture.iam_read_factors(uuid),
  test_fixture.iam_read_session_mfa(bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.iam_install_mfa_proof_key(bytea),
  test_fixture.iam_delete_mfa_proof_key(),
  test_fixture.iam_open_elevated_session(uuid, bytea),
  test_fixture.iam_insert_pending_totp(uuid, uuid, text, bytea, integer),
  test_fixture.iam_read_factors(uuid),
  test_fixture.iam_read_session_mfa(bytea)
TO app_api;
