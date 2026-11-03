-- 0201 — IAM : commandes de l'adaptateur interne du port d'authentification (comptes, sessions,
-- vérification d'email). US-010 ; 17 §2.3, §3.2.1, §6.6 ; 16 ACC-001 ; ADR-021 (défaut :
-- implémentation interne derrière le port), ADR-052. Appliquée sous `migrator`.
--
-- Pourquoi des fonctions SECURITY DEFINER : l'authentification a lieu AVANT qu'un acteur soit
-- connu (aucun contexte app.* posé) ; app_api ne reçoit donc aucun droit de table IAM (0200) et
-- passe par ces seules commandes, à surface minimale :
--   - aucun SQL dynamique, search_path figé (pg_catalog, pg_temp), noms qualifiés ;
--   - horloge = platform.now() seulement (expires_at calculé ici, jamais reçu du client) ;
--   - EXECUTE accordé au seul app_api (ni PUBLIC, ni app_worker, ni app_anon) ;
--   - sessions désignées par le SHA-256 du jeton (preuve de possession), jamais par un identifiant
--     de personne, sauf l'ouverture (après vérification du mot de passe par l'API) ;
--   - propriétaire `migrator` (propriétaire des tables, politique migrator_all), comme les
--     fonctions de trigger d'intégrité d'ADR-048 : `migrator` ne peut pas céder une fonction à un
--     propriétaire NOLOGIN sans en être membre, et l'amorçage refuse toute appartenance. Un
--     propriétaire dédié (`iam_auth_owner`) est PROPOSÉ dans ADR-052 pour la revue sécurité.
--
-- Limite (17 §2.3 « Limite de la RLS », RLS-18) : qui exécute du SQL arbitraire sous app_api peut
-- appeler ces commandes (par exemple ouvrir une session pour un compte). La parade est la même que
-- pour le contexte app.* : requêtes paramétrées seules, aucune construction de SQL côté API.
--
-- Bornes PROPOSÉES (ADR-052, registre 17 §7.2 à compléter) :
--   - durée d'une session : 300 s à 30 j ; ramenée à 8 h pour un compte qui a un rôle interne
--     en cours (17 §3.2.1 « expiration courte pour staff (PROPOSÉ 8 h) ») ;
--   - durée d'un lien de vérification : 300 s à 7 j (ACC-001 : 24 h PROPOSÉ, choisi par l'API).
--
-- Retour arrière :
--   DROP FUNCTION core.iam_cmd_register(uuid, text, text, text, text, text, uuid, bytea, integer, inet),
--     core.iam_cmd_verify_email(bytea), core.iam_auth_lookup(text),
--     core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text),
--     core.iam_session_resolve(bytea), core.iam_cmd_revoke_session(bytea, text),
--     core.iam_cmd_revoke_all_sessions(bytea);

-- Inscription (ACC-001) : compte PENDING_EMAIL + lien de vérification. Email déjà pris ⇒ false,
-- sans erreur ni écriture (l'API répond comme pour un succès : anti-énumération).
CREATE FUNCTION core.iam_cmd_register(
  p_user_id                 uuid,
  p_email                   text,
  p_password_hash           text,
  p_legal_first_name        text,
  p_legal_last_name         text,
  p_preferred_locale        text,
  p_verification_id         uuid,
  p_verification_token_hash bytea,
  p_verification_ttl_s      integer,
  p_ip                      inet
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_user uuid;
BEGIN
  IF p_verification_ttl_s IS NULL OR p_verification_ttl_s NOT BETWEEN 300 AND 604800 THEN
    RAISE EXCEPTION 'iam : durée du lien hors bornes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_password_hash IS NULL THEN  -- l'inscription par mot de passe exige un hachage (SSO : plus tard)
    RAISE EXCEPTION 'iam : hachage absent' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.iam_user_account AS u
         (id, email, password_hash, legal_first_name, legal_last_name, preferred_locale, status)
  VALUES (p_user_id, p_email, p_password_hash, p_legal_first_name, p_legal_last_name,
          p_preferred_locale, 'PENDING_EMAIL')
  ON CONFLICT ON CONSTRAINT user_account_email_unique DO NOTHING
  RETURNING u.id INTO v_user;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO core.iam_email_verification (id, user_id, email, token_hash, sent_at, expires_at, ip)
  VALUES (p_verification_id, v_user, p_email, p_verification_token_hash, v_now,
          v_now + pg_catalog.make_interval(secs => p_verification_ttl_s), p_ip);
  RETURN true;
END
$fn$;

-- Vérification d'email : jeton à usage unique, non expiré ; PENDING_EMAIL -> ACTIVE.
CREATE FUNCTION core.iam_cmd_verify_email(p_token_hash bytea)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now   timestamptz := platform.now();
  v_user  uuid;
  v_email text;
BEGIN
  UPDATE core.iam_email_verification AS v
     SET consumed_at = v_now
   WHERE v.token_hash = p_token_hash AND v.consumed_at IS NULL AND v.expires_at > v_now
  RETURNING v.user_id, v.email INTO v_user, v_email;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  -- l'adresse prouvée doit être l'adresse actuelle du compte
  UPDATE core.iam_user_account AS u
     SET email_verified_at = v_now,
         status = CASE WHEN u.status = 'PENDING_EMAIL' THEN 'ACTIVE' ELSE u.status END
   WHERE u.id = v_user AND u.email = v_email;
  RETURN FOUND;
END
$fn$;

-- Lecture des éléments de vérification du mot de passe (fait par l'API : argon2id). Rend le
-- hachage (C4) au seul app_api ; aucune ligne si l'email est inconnu.
CREATE FUNCTION core.iam_auth_lookup(p_email text)
  RETURNS TABLE (user_id uuid, password_hash text, status text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.id, u.password_hash, u.status
    FROM core.iam_user_account AS u
   WHERE u.email = p_email
$fn$;

-- Ouverture d'une session après authentification. Rend expires_at, ou NULL si le compte ne peut
-- pas se connecter (inconnu, CLOSED, BANNED). Jamais de prolongation d'une session existante :
-- chaque connexion crée un jeton neuf (parade à la fixation de session).
CREATE FUNCTION core.iam_cmd_open_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_token_hash bytea,
  p_ttl_s      integer,
  p_mfa_level  text,
  p_ip         inet,
  p_user_agent text
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now     timestamptz := platform.now();
  v_ttl     interval;
  v_status  text;
  v_expires timestamptz;
BEGIN
  IF p_ttl_s IS NULL OR p_ttl_s NOT BETWEEN 300 AND 2592000 THEN
    RAISE EXCEPTION 'iam : durée de session hors bornes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- FOR SHARE : une fermeture concurrente du compte attend la fin de l'ouverture
  SELECT u.status INTO v_status FROM core.iam_user_account AS u WHERE u.id = p_user_id FOR SHARE;
  IF v_status IS NULL OR v_status IN ('CLOSED', 'BANNED') THEN
    RETURN NULL;
  END IF;
  v_ttl := pg_catalog.make_interval(secs => p_ttl_s);
  IF EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
              WHERE a.user_id = p_user_id AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
    v_ttl := LEAST(v_ttl, interval '8 hours');
  END IF;
  v_expires := v_now + v_ttl;
  INSERT INTO core.iam_session (id, user_id, token_hash, expires_at, ip, user_agent, mfa_level, created_at)
  VALUES (p_session_id, p_user_id, p_token_hash, v_expires, p_ip,
          pg_catalog.left(p_user_agent, 512), p_mfa_level, v_now);
  RETURN v_expires;
END
$fn$;

-- Résolution d'un jeton : une ligne seulement si la session est ni révoquée ni expirée (horloge
-- de la base) et si le compte peut encore se connecter. Sinon aucune ligne (l'API répond 401).
CREATE FUNCTION core.iam_session_resolve(p_token_hash bytea)
  RETURNS TABLE (session_id uuid, user_id uuid, mfa_level text, expires_at timestamptz)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id, s.user_id, s.mfa_level, s.expires_at
    FROM core.iam_session AS s
    JOIN core.iam_user_account AS u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > platform.now()
     AND u.status NOT IN ('CLOSED', 'BANNED')
$fn$;

-- Révocation d'une session par son jeton (déconnexion, rotation). Définitive.
CREATE FUNCTION core.iam_cmd_revoke_session(p_token_hash bytea, p_reason text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('LOGOUT', 'ROTATED') THEN
    RAISE EXCEPTION 'iam : motif de révocation refusé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.iam_session AS s
     SET revoked_at = platform.now(), revoked_reason = p_reason
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL;
  RETURN FOUND;
END
$fn$;

-- « Se déconnecter partout » : la session présentée doit être valide ; toutes les sessions
-- vivantes de son titulaire sont révoquées. Rend le nombre de sessions révoquées.
CREATE FUNCTION core.iam_cmd_revoke_all_sessions(p_token_hash bytea)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_user uuid;
  v_n    integer;
BEGIN
  SELECT s.user_id INTO v_user
    FROM core.iam_session AS s
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > v_now;
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE core.iam_session AS s
     SET revoked_at = v_now, revoked_reason = 'LOGOUT_ALL'
   WHERE s.user_id = v_user AND s.revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

COMMENT ON FUNCTION core.iam_cmd_register(uuid, text, text, text, text, text, uuid, bytea, integer, inet) IS
  'Inscription (ACC-001) ; email pris => false sans écriture. SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_cmd_verify_email(bytea) IS
  'Lien de vérification à usage unique ; PENDING_EMAIL -> ACTIVE. SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_auth_lookup(text) IS
  'Hachage argon2id et statut pour la vérification par l''API. SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text) IS
  'Ouverture de session (jeton neuf), staff <= 8 h. SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_session_resolve(bytea) IS
  'Session ni révoquée ni expirée (platform.now()), compte actif. SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_cmd_revoke_session(bytea, text) IS
  'Révocation définitive par jeton (LOGOUT, ROTATED). SECURITY DEFINER, EXECUTE app_api. US-010.';
COMMENT ON FUNCTION core.iam_cmd_revoke_all_sessions(bytea) IS
  'Révocation de toutes les sessions du titulaire du jeton. SECURITY DEFINER, EXECUTE app_api. US-010.';

REVOKE ALL ON FUNCTION
  core.iam_cmd_register(uuid, text, text, text, text, text, uuid, bytea, integer, inet),
  core.iam_cmd_verify_email(bytea),
  core.iam_auth_lookup(text),
  core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text),
  core.iam_session_resolve(bytea),
  core.iam_cmd_revoke_session(bytea, text),
  core.iam_cmd_revoke_all_sessions(bytea)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  core.iam_cmd_register(uuid, text, text, text, text, text, uuid, bytea, integer, inet),
  core.iam_cmd_verify_email(bytea),
  core.iam_auth_lookup(text),
  core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text),
  core.iam_session_resolve(bytea),
  core.iam_cmd_revoke_session(bytea, text),
  core.iam_cmd_revoke_all_sessions(bytea)
TO app_api;
