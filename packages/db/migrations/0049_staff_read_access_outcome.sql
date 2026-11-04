-- 0049 — Console : issue d'accès des lectures du staff (403 au lieu d'une liste vide).
-- US-043 ; 16 ADM-001 (« toute action non autorisée renvoie 403 et est journalisée ») ; 17 §2.3 ;
-- ADR-062, ADR-067, ADR-075, ADR-077. Appliquée sous `migrator`.
--
-- Défaut trouvé par la matrice des routes (US-043) : trois lectures de la console refusent en
-- base (refus JOURNALISÉ, aucune ligne rendue) mais l'API ne peut pas distinguer ce refus d'une
-- liste vide et répond 200 : GET /staff/audit (audit.read), GET /console/brand/versions[/{id}]
-- (brand.edit) et GET /console/security/abuse (security.read_abuse, dont un ADMIN d'un pays qui
-- lit le tableau de l'autre pays). Aucune donnée ne fuit, mais un refus se présente comme un succès.
--
-- Correction : core.iam_staff_read_access(jeton, permission, portée) rend l'issue d'accès de ces
-- trois lectures, sans rien écrire (le refus reste journalisé par la lecture elle-même). L'API ne
-- l'appelle que si la lecture rend zéro ligne, et répond alors 401 / 403 selon l'issue. Les mêmes
-- règles que les lectures : session vivante d'un compte ACTIVE (core.iam_staff_session), TOTP,
-- permission en cours via core.iam_staff_permitted. Portée : 'ANY' (au moins un rôle qui porte la
-- permission, comme iam_staff_audit_read), 'ALL' (tous les pays déclarés, comme les lectures de la
-- marque commune et le tableau sans pays) ou un code pays. Permissions acceptées : liste fermée des
-- trois lectures (aucun oracle général des permissions).
--
-- Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, OK. Propriétaire iam_staff_owner (famille
-- iam_staff, liste blanche RLS-15), EXECUTE au seul app_api, search_path figé.
--
-- Retour arrière : DROP FUNCTION core.iam_staff_read_access(bytea, text, text);

CREATE FUNCTION core.iam_staff_read_access(p_token_hash bytea, p_permission text, p_scope text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s         record;
  v_countries text[];
  v_ok        boolean;
BEGIN
  IF p_permission IS NULL
     OR p_permission NOT IN ('audit.read', 'brand.edit', 'security.read_abuse')
     OR p_scope IS NULL OR NOT (p_scope IN ('ANY', 'ALL') OR p_scope ~ '^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'console : permission ou portée de lecture invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN 'MFA_REQUIRED';
  END IF;
  IF p_scope = 'ANY' THEN
    SELECT EXISTS (
      SELECT 1
        FROM core.iam_staff_role_assignment AS a
        JOIN core.iam_role_permission AS p ON p.role = a.role
       WHERE a.user_id = v_s.user_id
         AND (a.expires_at IS NULL OR a.expires_at > platform.now())
         AND p.permission_code = p_permission
         AND p.valid_from <= platform.now()
         AND (p.valid_to IS NULL OR p.valid_to > platform.now()))
      INTO v_ok;
  ELSE
    IF p_scope = 'ALL' THEN
      SELECT pg_catalog.array_agg(k.code::text ORDER BY k.code) INTO v_countries
        FROM core.config_country AS k;
    ELSE
      v_countries := ARRAY[p_scope];
    END IF;
    v_ok := core.iam_staff_permitted(v_s.user_id, p_permission, COALESCE(v_countries, '{}'), NULL)
            IS NOT NULL;
  END IF;
  RETURN CASE WHEN v_ok THEN 'OK' ELSE 'FORBIDDEN' END;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_read_access(bytea, text, text) IS
  'Issue d''accès des lectures de la console (audit.read, brand.edit, security.read_abuse) : '
  '403 au lieu d''une liste vide, sans écriture. US-043.';

REVOKE ALL ON FUNCTION core.iam_staff_read_access(bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_read_access(bytea, text, text) TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_read_access(bytea, text, text) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
