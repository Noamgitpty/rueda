-- 9200 — fixtures des tests IAM (US-010). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : remplacer, en attendant leurs stories, les écrivains qui n'existent pas encore (console
-- interne US-012 pour les rôles et le statut d'un compte, parcours hôte pour les comptes d'hôte)
-- et lire les colonnes que les rôles applicatifs ne lisent pas (preuve qu'aucun jeton ni mot de
-- passe n'est stocké en clair), sans donner à app_api un droit qu'il n'aura pas en production.
-- SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique.
--
-- Retour arrière : DROP FUNCTION test_fixture.iam_* (voir la liste des GRANT ci-dessous).

CREATE FUNCTION test_fixture.iam_set_account_status(p_user_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account SET status = p_status WHERE id = p_user_id
$fn$;

CREATE FUNCTION test_fixture.iam_grant_staff_role(
  p_id uuid, p_user_id uuid, p_role text, p_country_scope text[], p_granted_by uuid,
  p_expires_at timestamptz
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_staff_role_assignment (id, user_id, role, country_scope, granted_by, expires_at)
  VALUES (p_id, p_user_id, p_role, p_country_scope, p_granted_by, p_expires_at)
$fn$;

CREATE FUNCTION test_fixture.iam_insert_organization(p_id uuid, p_holder_user_id uuid, p_country_code text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_organization (id, holder_user_id, country_code) VALUES (p_id, p_holder_user_id, p_country_code)
$fn$;

CREATE FUNCTION test_fixture.iam_insert_membership(
  p_id uuid, p_user_id uuid, p_org_id uuid, p_role text, p_vehicle_scope uuid[], p_status text
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_membership (id, user_id, org_id, role, vehicle_scope, status)
  VALUES (p_id, p_user_id, p_org_id, p_role, p_vehicle_scope, p_status)
$fn$;

-- Lecture des colonnes stockées d'un compte (preuve : jamais de mot de passe en clair).
CREATE FUNCTION test_fixture.iam_read_account(p_email text)
  RETURNS TABLE (id uuid, password_hash text, status text, email_verified_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.id, u.password_hash, u.status, u.email_verified_at FROM core.iam_user_account AS u WHERE u.email = p_email
$fn$;

-- Lecture brute des sessions d'un compte (preuve : seul le SHA-256 du jeton est stocké).
CREATE FUNCTION test_fixture.iam_read_sessions(p_user_id uuid)
  RETURNS TABLE (id uuid, token_hash bytea, expires_at timestamptz, created_at timestamptz,
                 revoked_at timestamptz, revoked_reason text, user_agent text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id, s.token_hash, s.expires_at, s.created_at, s.revoked_at, s.revoked_reason, s.user_agent
    FROM core.iam_session AS s WHERE s.user_id = p_user_id ORDER BY s.created_at, s.id
$fn$;

-- Écritures forcées sous le propriétaire, pour prouver que le trigger session_guarded_columns
-- les refuse quel que soit l'écrivain.
CREATE FUNCTION test_fixture.iam_force_session_update(p_token_hash bytea, p_kind text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kind = 'UNREVOKE' THEN
    UPDATE core.iam_session SET revoked_at = NULL, revoked_reason = NULL WHERE token_hash = p_token_hash;
  ELSIF p_kind = 'EXTEND' THEN
    UPDATE core.iam_session SET expires_at = expires_at + interval '1 day' WHERE token_hash = p_token_hash;
  ELSIF p_kind = 'STEAL' THEN
    UPDATE core.iam_session SET user_id = (SELECT u.id FROM core.iam_user_account AS u
                                             WHERE u.id <> core.iam_session.user_id LIMIT 1)
     WHERE token_hash = p_token_hash;
  ELSE
    RAISE EXCEPTION 'type inconnu';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.iam_set_account_status(uuid, text),
  test_fixture.iam_grant_staff_role(uuid, uuid, text, text[], uuid, timestamptz),
  test_fixture.iam_insert_organization(uuid, uuid, text),
  test_fixture.iam_insert_membership(uuid, uuid, uuid, text, uuid[], text),
  test_fixture.iam_read_account(text),
  test_fixture.iam_read_sessions(uuid),
  test_fixture.iam_force_session_update(bytea, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.iam_set_account_status(uuid, text),
  test_fixture.iam_grant_staff_role(uuid, uuid, text, text[], uuid, timestamptz),
  test_fixture.iam_insert_organization(uuid, uuid, text),
  test_fixture.iam_insert_membership(uuid, uuid, uuid, text, uuid[], text),
  test_fixture.iam_read_account(text),
  test_fixture.iam_read_sessions(uuid),
  test_fixture.iam_force_session_update(bytea, text)
TO app_api;
