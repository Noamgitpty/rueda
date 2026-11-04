-- 0052 — IAM : rotation SANS COUPURE de la clé de preuve d'élévation MFA du staff.
-- US-051 ; 19 US-051 (« Given un secret de préproduction, When la rotation est exercée, Then le
-- service continue sans interruption visible et l'ancien secret est refusé ») ; 17 §6.4 (secrets
-- et clés : « procédure de recréation documentée »), §6.6 (« rotation documentée ») ; ADR-062,
-- ADR-082. Appliquée sous `migrator`.
--
-- La clé HMAC de la preuve d'élévation (0033, ADR-062) vit à DEUX endroits : `RUEDA_STAFF_MFA_PROOF_KEY`
-- de l'API, qui calcule la preuve, et `core.iam_mfa_proof_key`, avec laquelle la base la recalcule.
-- Avec une seule ligne, changer l'une avant l'autre refuse toute élévation le temps du
-- déploiement (et chaque refus compte comme un échec du facteur). Cette migration :
--   1. admet une SECONDE ligne (`id` = 2 : clé SUIVANTE, posée le temps d'une rotation) ;
--   2. remplace core.iam_staff_cmd_elevate : la preuve est acceptée si elle correspond à l'UNE
--      des clés installées. Aucune autre ligne ne change (corps de 0033 recopié à l'identique,
--      hors la lecture de la clé et la comparaison) ;
--   3. core.iam_mfa_proof_key_rotate(action, clé) : les quatre gestes de l'exploitation, sous
--      `migrator` SEULEMENT (propriétaire ; EXECUTE retiré à PUBLIC, accordé à personne) :
--        INSTALL  première clé (id 1), refusée si une clé existe déjà ;
--        STAGE    clé suivante (id 2) : la base accepte alors l'ancienne ET la nouvelle ;
--        PROMOTE  la clé suivante devient la seule (id 1) : l'ancienne est REFUSÉE ;
--        ABORT    retire la clé suivante (rotation abandonnée).
--      Ordre d'une rotation (docs/ops/SECRET_ROTATION.md) : STAGE, déploiement de l'API avec la
--      nouvelle clé, PROMOTE. Aucun geste ne rend ni ne journalise une clé.
--
-- Retour arrière :
--   DROP FUNCTION core.iam_mfa_proof_key_rotate(text, bytea);
--   DELETE FROM core.iam_mfa_proof_key WHERE id = 2;
--   ALTER TABLE core.iam_mfa_proof_key DROP CONSTRAINT mfa_proof_key_slot,
--     ADD CONSTRAINT mfa_proof_key_single CHECK (id = 1);
--   réappliquer la définition de 0033 de core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea)
--   (sous iam_staff_owner, comme ci-dessous).

-- 1. Deux emplacements : 1 = courante, 2 = suivante (rotation) ---------------------------------
ALTER TABLE core.iam_mfa_proof_key DROP CONSTRAINT mfa_proof_key_single;
ALTER TABLE core.iam_mfa_proof_key
  ADD CONSTRAINT mfa_proof_key_slot CHECK (id IN (1, 2));
COMMENT ON TABLE core.iam_mfa_proof_key IS
  'Clé HMAC de la preuve d''élévation MFA du staff (ADR-062). id 1 = courante ; id 2 = suivante, '
  'le temps d''une rotation (US-051, ADR-082). Lue par iam_staff_owner seulement ; installée hors '
  'application. Absente => aucune élévation. US-012.';

-- 2. Élévation : preuve acceptée sous l'une des clés installées ---------------------------------
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma accordé le temps du remplacement (comme 0040, 0045). Droits (EXECUTE au
-- seul app_api), propriétaire et entrée RLS-15 inchangés.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

CREATE OR REPLACE FUNCTION core.iam_staff_cmd_elevate(p_token_hash bytea, p_factor_id uuid, p_step bigint,
                                                      p_proof bytea)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_s      record;
  v_f      record;
  v_keys   bytea[];
  v_reason text;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
                  WHERE a.user_id = v_s.user_id AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'USER', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'NOT_STAFF'), NULL, NULL);
    RETURN 'NOT_STAFF';
  END IF;
  -- US-051 : courante (1) et, pendant une rotation, suivante (2)
  SELECT pg_catalog.array_agg(k.key ORDER BY k.id) INTO v_keys
    FROM core.iam_mfa_proof_key AS k WHERE k.id IN (1, 2);
  IF v_keys IS NULL THEN
    RETURN 'UNAVAILABLE';
  END IF;
  SELECT f.id, f.enabled_at, f.last_used_step, f.locked_until, f.enrollment_expires_at,
         f.failed_attempts
    INTO v_f
    FROM core.iam_auth_factor AS f
   WHERE f.id = p_factor_id AND f.user_id = v_s.user_id AND f.kind = 'TOTP' AND f.disabled_at IS NULL
     FOR UPDATE;
  IF v_f.id IS NULL THEN
    v_reason := 'UNKNOWN_FACTOR';
  ELSIF v_f.locked_until IS NOT NULL AND v_f.locked_until > v_now THEN
    RETURN 'LOCKED';
  ELSIF v_f.enabled_at IS NULL AND v_f.enrollment_expires_at <= v_now THEN
    v_reason := 'ENROLLMENT_EXPIRED';
  ELSIF p_proof IS NULL OR p_step IS NULL
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_keys) AS k(key)
                        WHERE core.iam_mfa_proof(k.key, p_token_hash, v_f.id, p_step) = p_proof) THEN
    v_reason := 'BAD_PROOF';
  ELSIF pg_catalog.abs(p_step - core.iam_totp_step_now()) > 1 THEN
    v_reason := 'STEP_OUT_OF_WINDOW';
  ELSIF v_f.last_used_step IS NOT NULL AND p_step <= v_f.last_used_step THEN
    v_reason := 'STEP_REPLAYED';
  END IF;
  IF v_reason IS NOT NULL THEN
    -- la tentative a déjà été comptée (iam_staff_cmd_mfa_attempt / enroll_reveal) ; une preuve
    -- forgée compte en plus, sans jamais lever le verrou
    IF v_f.id IS NOT NULL THEN
      UPDATE core.iam_auth_factor AS f
         SET failed_attempts = LEAST(f.failed_attempts + 1, 5)
       WHERE f.id = v_f.id;
    END IF;
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_MFA_REFUSED', 'USER', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason), NULL, NULL);
    RETURN 'REFUSED';
  END IF;

  UPDATE core.iam_auth_factor AS f
     SET last_used_step = p_step, failed_attempts = 0, locked_until = NULL,
         enabled_at = COALESCE(f.enabled_at, v_now),
         enrollment_code_hash = NULL, enrollment_expires_at = NULL
   WHERE f.id = v_f.id;
  -- revue sécurité US-012, MAJEUR 2 : une session élevée vit 8 h au plus, même ouverte avant
  -- l'attribution du rôle (durée de client) ; jamais prolongée (session_guarded_columns)
  UPDATE core.iam_session AS s
     SET mfa_level = 'TOTP', expires_at = LEAST(s.expires_at, v_now + interval '8 hours')
   WHERE s.id = v_s.session_id;
  PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF',
                               CASE WHEN v_f.enabled_at IS NULL THEN 'STAFF_TOTP_ENROLLED'
                                    ELSE 'STAFF_MFA_VERIFIED' END,
                               'USER', v_s.user_id, NULL,
                               pg_catalog.jsonb_build_object('factorId', v_f.id), NULL, NULL);
  RETURN CASE WHEN v_f.enabled_at IS NULL THEN 'ENROLLED' ELSE 'ELEVATED' END;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea) IS
  'Élévation NONE -> TOTP sur preuve HMAC (sous l''une des clés installées : rotation US-051), '
  'pas à ±1, sans rejeu ; journalisée. US-012.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 3. Gestes de l'exploitation (sous migrator, propriétaire de la table et de la fonction) --------
-- SECURITY INVOKER : seul `migrator` passe la politique migrator_all ; EXECUTE accordé à personne.
CREATE FUNCTION core.iam_mfa_proof_key_rotate(p_action text, p_key bytea DEFAULT NULL)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_current boolean;
  v_next    boolean;
BEGIN
  -- un seul geste à la fois (deux exploitants concurrents se sérialisent)
  LOCK TABLE core.iam_mfa_proof_key IN SHARE ROW EXCLUSIVE MODE;
  SELECT pg_catalog.bool_or(k.id = 1), pg_catalog.bool_or(k.id = 2)
    INTO v_current, v_next
    FROM core.iam_mfa_proof_key AS k;
  v_current := COALESCE(v_current, false);
  v_next := COALESCE(v_next, false);
  IF p_action IN ('INSTALL', 'STAGE') AND
     (p_key IS NULL OR pg_catalog.octet_length(p_key) NOT BETWEEN 32 AND 64) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'mfa_proof_key_invalid',
      DETAIL = 'clé de 32 à 64 octets attendue';
  END IF;
  CASE p_action
    WHEN 'INSTALL' THEN
      IF v_current THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'mfa_proof_key_already_installed';
      END IF;
      INSERT INTO core.iam_mfa_proof_key (id, key) VALUES (1, p_key);
    WHEN 'STAGE' THEN
      IF NOT v_current THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'mfa_proof_key_not_installed';
      END IF;
      IF EXISTS (SELECT 1 FROM core.iam_mfa_proof_key AS k WHERE k.id = 1 AND k.key = p_key) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'mfa_proof_key_unchanged';
      END IF;
      INSERT INTO core.iam_mfa_proof_key (id, key) VALUES (2, p_key)
        ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, installed_at = platform.now();
    WHEN 'PROMOTE' THEN
      IF NOT v_next THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'mfa_proof_key_nothing_staged';
      END IF;
      UPDATE core.iam_mfa_proof_key AS k
         SET key = n.key, installed_at = platform.now()
        FROM core.iam_mfa_proof_key AS n
       WHERE k.id = 1 AND n.id = 2;
      DELETE FROM core.iam_mfa_proof_key AS k WHERE k.id = 2;
    WHEN 'ABORT' THEN
      DELETE FROM core.iam_mfa_proof_key AS k WHERE k.id = 2;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'mfa_proof_key_action_invalid';
  END CASE;
  -- état seulement (jamais une clé) : CURRENT ou CURRENT+NEXT
  RETURN (SELECT pg_catalog.string_agg(CASE k.id WHEN 1 THEN 'CURRENT' ELSE 'NEXT' END, '+'
                                       ORDER BY k.id)
            FROM core.iam_mfa_proof_key AS k);
END
$fn$;

COMMENT ON FUNCTION core.iam_mfa_proof_key_rotate(text, bytea) IS
  'Rotation de la clé de preuve MFA (INSTALL, STAGE, PROMOTE, ABORT), sous migrator seulement ; '
  'rend l''état (CURRENT, CURRENT+NEXT), jamais une clé. US-051, ADR-082.';
REVOKE ALL ON FUNCTION core.iam_mfa_proof_key_rotate(text, bytea) FROM PUBLIC;
