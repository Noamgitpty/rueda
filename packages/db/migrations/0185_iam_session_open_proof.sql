-- 0185 — IAM : ouverture de session sur PREUVE SIGNÉE (F-RLS-03, EXC-003). US-410 (S-07, lot 4,
-- rattachée à US-003) ; ADR-205 (PROPOSÉ) ; ADR-089 (F-RLS-03) ; 17 §2.3 RLS-18 (« contexte
-- forgeable sous SQL arbitraire ») ; revue sécurité #92 n° 3 ; pré-mortem du lot 4 L4-PM-01 à 05.
-- Appliquée sous `migrator`, en une transaction.
--
-- Constat : `core.iam_cmd_open_session(session, compte, empreinte, …)` (0011, 0033) faisait
-- confiance à son appelant. Du SQL arbitraire sous `app_api` ouvrait une session pour N'IMPORTE
-- QUEL compte (RT-RLS-18, caractérisation « LIMITE DOCUMENTÉE »).
--
-- Parade (ADR-205, choix « contexte signé HMAC », comme la preuve d'élévation MFA d'ADR-062) :
--   1. La commande exige une PREUVE : HMAC-SHA-256 sous une clé que l'API tient de son coffre
--      (`RUEDA_SESSION_OPEN_KEY`) et que la base garde dans `core.iam_session_open_key`, lue par
--      `iam_auth_owner` SEULEMENT (aucun rôle applicatif, aucune fonction ne la rend, aucun réglage
--      `app.*`). Du SQL arbitraire sous `app_api` ne peut donc pas signer.
--   2. Message signé (forme v1) : UTF-8('rueda-session-open-v1') ‖ UUID de session (16) ‖ UUID du
--      compte (16) ‖ empreinte du jeton (32) ‖ durée demandée (int4 BE) ‖ instant d'émission en
--      millisecondes de `platform.now()` (int8 BE). Un champ modifié rend la preuve fausse.
--   3. Preuve fraîche : émise au plus 60 s avant l'appel (et 5 s après, au plus), à l'horloge de la
--      base (l'API lit `platform.now()` juste avant de signer). Au-delà : refus.
--   4. Usage unique : la session et l'empreinte du jeton sont uniques ; un rejeu (même session ou
--      même jeton), y compris concurrent, est refusé `session_proof_replayed` (42501).
--   5. Comparaison sur les empreintes SHA-256 des deux preuves (temps indépendant des octets
--      communs : un attaquant ne contrôle pas l'empreinte).
--   6. Échec FERMÉ : aucune clé installée => aucune session (`session_proof_unavailable`, 42501).
--      Tous les refus sont 42501, sans valeur dans le message ; ils sont jugés AVANT de lire le
--      compte (aucun oracle d'existence ou d'état sans preuve valable).
--   7. Rotation sans coupure (comme 0053) : deux emplacements (1 = courante, 2 = suivante) ; la
--      base accepte les deux pendant le redéploiement de l'API, l'ancienne 24 h au plus après la
--      pose de la suivante (fenêtre bornée en base) ; `core.iam_session_open_key_rotate`
--      (INSTALL, STAGE, PROMOTE, ABORT) sous `migrator` SEULEMENT (EXECUTE accordé à personne).
--   L'ancienne signature à 7 arguments est SUPPRIMÉE (aucune version servie en production : aucun
--   déploiement de production n'a eu lieu, GL-01) ; la nouvelle a 9 arguments (+ instant, preuve).
--   Propriétaire (iam_auth_owner), droits (EXECUTE au seul app_api) et corps métier (bornes de la
--   durée, MFA `NONE` seulement, compte fermé ou banni => NULL, 8 h pour le staff) inchangés.
--
-- Retour arrière :
--   DROP FUNCTION core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text, bigint, bytea);
--   réappliquer la définition de 0033 de core.iam_cmd_open_session(uuid, uuid, bytea, integer,
--     text, inet, text) (sous iam_auth_owner), ses droits de 0011 et son propriétaire de 0022 ;
--   DROP FUNCTION core.iam_session_open_key_rotate(text, bytea);
--   DROP FUNCTION core.iam_session_open_proof(bytea, uuid, uuid, bytea, integer, bigint);
--   REVOKE EXECUTE ON FUNCTION core.iam_hmac_sha256(bytea, bytea) FROM iam_auth_owner;
--   DROP TABLE core.iam_session_open_key.
--   (Le retour arrière ROUVRE F-RLS-03 : décision de l'orchestrateur, revue sécurité.)

-- 1. Clé de la preuve d'ouverture (secret géré : AUCUNE valeur dans le dépôt) ------------------
-- Installée par l'exploitation sous `migrator` (runbook docs/ops/SECRET_ROTATION.md § 3.4, CLI
-- packages/db/src/rotation/cli.ts), ou par la fixture de test 9901 (clé de TEST publique).
CREATE TABLE core.iam_session_open_key (
  id           smallint    CONSTRAINT session_open_key_pkey PRIMARY KEY
    CONSTRAINT session_open_key_slot CHECK (id IN (1, 2)),
  key          bytea       NOT NULL                                   -- [C4]
    CONSTRAINT session_open_key_length CHECK (pg_catalog.octet_length(key) BETWEEN 32 AND 64),
  installed_at timestamptz NOT NULL DEFAULT platform.now()
);
ALTER TABLE core.iam_session_open_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_session_open_key FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_session_open_key TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.iam_session_open_key FROM PUBLIC;
COMMENT ON TABLE core.iam_session_open_key IS
  'Clé HMAC de la preuve d''ouverture de session (ADR-205, F-RLS-03). id 1 = courante ; id 2 = '
  'suivante, le temps d''une rotation. Lue par iam_auth_owner seulement ; installée hors '
  'application. Absente => aucune session ouverte. US-410.';

-- lecture par le seul propriétaire de la commande (jamais un rôle applicatif)
GRANT SELECT (id, key, installed_at) ON core.iam_session_open_key TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.iam_session_open_key FOR SELECT TO iam_auth_owner USING (true);

-- 2. Message et preuve (SECURITY INVOKER, IMMUTABLE ; EXECUTE au seul iam_auth_owner) -----------
GRANT EXECUTE ON FUNCTION core.iam_hmac_sha256(bytea, bytea) TO iam_auth_owner;

CREATE FUNCTION core.iam_session_open_proof(p_key bytea, p_session_id uuid, p_user_id uuid,
                                            p_token_hash bytea, p_ttl_s integer,
                                            p_issued_at_ms bigint)
  RETURNS bytea
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_hmac_sha256(
           p_key,
           pg_catalog.convert_to('rueda-session-open-v1', 'UTF8')
             || pg_catalog.uuid_send(p_session_id) || pg_catalog.uuid_send(p_user_id)
             || p_token_hash || pg_catalog.int4send(p_ttl_s) || pg_catalog.int8send(p_issued_at_ms))
$fn$;
COMMENT ON FUNCTION core.iam_session_open_proof(bytea, uuid, uuid, bytea, integer, bigint) IS
  'Preuve v1 d''ouverture de session (ADR-205) : HMAC-SHA-256(clé, « rueda-session-open-v1 » ‖ '
  'session ‖ compte ‖ empreinte ‖ durée ‖ instant ms). EXECUTE à iam_auth_owner seulement. US-410.';
REVOKE ALL ON FUNCTION core.iam_session_open_proof(bytea, uuid, uuid, bytea, integer, bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_session_open_proof(bytea, uuid, uuid, bytea, integer, bigint)
  TO iam_auth_owner;

-- 3. Ouverture de session : preuve exigée ---------------------------------------------------------
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma accordé le temps du remplacement (comme 0033, 0053).
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;

DROP FUNCTION core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text);

CREATE FUNCTION core.iam_cmd_open_session(
  p_session_id   uuid,
  p_user_id      uuid,
  p_token_hash   bytea,
  p_ttl_s        integer,
  p_mfa_level    text,
  p_ip           inet,
  p_user_agent   text,
  p_issued_at_ms bigint,
  p_proof        bytea
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now     timestamptz := platform.now();
  v_now_ms  bigint;
  v_keys    bytea[];
  v_ttl     interval;
  v_status  text;
  v_expires timestamptz;
BEGIN
  -- US-410 : la preuve d'abord, avant toute lecture du compte (aucun oracle sans preuve). La
  -- courante (1) n'est plus acceptée 24 h après la pose de la suivante (2), même sans PROMOTE.
  SELECT pg_catalog.array_agg(k.key ORDER BY k.id) INTO v_keys
    FROM core.iam_session_open_key AS k
   WHERE k.id = 2
      OR (k.id = 1 AND NOT EXISTS (SELECT 1 FROM core.iam_session_open_key AS n
                                    WHERE n.id = 2
                                      AND n.installed_at <= v_now - interval '24 hours'));
  IF v_keys IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'session_proof_unavailable';
  END IF;
  IF p_proof IS NULL OR p_issued_at_ms IS NULL OR pg_catalog.octet_length(p_proof) <> 32
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.unnest(v_keys) AS k(key)
        WHERE pg_catalog.sha256(core.iam_session_open_proof(k.key, p_session_id, p_user_id,
                                                            p_token_hash, p_ttl_s, p_issued_at_ms))
              = pg_catalog.sha256(p_proof)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'session_proof_refused';
  END IF;
  v_now_ms := pg_catalog.floor(EXTRACT(EPOCH FROM v_now) * 1000)::bigint;
  IF p_issued_at_ms < v_now_ms - 60000 OR p_issued_at_ms > v_now_ms + 5000 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'session_proof_expired';
  END IF;

  IF p_ttl_s IS NULL OR p_ttl_s NOT BETWEEN 300 AND 2592000 THEN
    RAISE EXCEPTION 'iam : durée de session hors bornes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- US-012 : une session naît sans MFA ; l'élévation passe par core.iam_staff_cmd_elevate
  IF p_mfa_level IS DISTINCT FROM 'NONE' THEN
    RAISE EXCEPTION 'iam : niveau MFA refusé à l''ouverture' USING ERRCODE = 'invalid_parameter_value';
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
  -- usage unique : même session ou même jeton => rejeu (la clé primaire et session_token_unique
  -- tranchent aussi deux rejeux concurrents : le second attend le premier puis échoue ici)
  BEGIN
    INSERT INTO core.iam_session (id, user_id, token_hash, expires_at, ip, user_agent, mfa_level,
                                  created_at)
    VALUES (p_session_id, p_user_id, p_token_hash, v_expires, p_ip,
            pg_catalog.left(p_user_agent, 512), 'NONE', v_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'session_proof_replayed';
  END;
  RETURN v_expires;
END
$fn$;

COMMENT ON FUNCTION core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text, bigint, bytea) IS
  'Ouverture d''une session après authentification, sur preuve HMAC v1 (ADR-205 ; sous l''une des '
  'clés installées), fraîche (60 s) et à usage unique ; refus 42501 sans preuve valable ou sans '
  'clé (fail-closed). SECURITY DEFINER, EXECUTE app_api. US-010, US-012, US-410.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

REVOKE ALL ON FUNCTION
  core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text, bigint, bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text, bigint, bytea)
TO app_api;

-- 4. Gestes de l'exploitation (sous migrator, propriétaire de la table et de la fonction) --------
-- SECURITY INVOKER : seul `migrator` passe la politique migrator_all ; EXECUTE accordé à personne.
CREATE FUNCTION core.iam_session_open_key_rotate(p_action text, p_key bytea DEFAULT NULL)
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
  LOCK TABLE core.iam_session_open_key IN SHARE ROW EXCLUSIVE MODE;
  SELECT pg_catalog.bool_or(k.id = 1), pg_catalog.bool_or(k.id = 2)
    INTO v_current, v_next
    FROM core.iam_session_open_key AS k;
  v_current := COALESCE(v_current, false);
  v_next := COALESCE(v_next, false);
  IF p_action IN ('INSTALL', 'STAGE') AND
     (p_key IS NULL OR pg_catalog.octet_length(p_key) NOT BETWEEN 32 AND 64) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'session_open_key_invalid',
      DETAIL = 'clé de 32 à 64 octets attendue';
  END IF;
  CASE p_action
    WHEN 'INSTALL' THEN
      IF v_current THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'session_open_key_already_installed';
      END IF;
      INSERT INTO core.iam_session_open_key (id, key) VALUES (1, p_key);
    WHEN 'STAGE' THEN
      IF NOT v_current THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'session_open_key_not_installed';
      END IF;
      IF EXISTS (SELECT 1 FROM core.iam_session_open_key AS k WHERE k.id = 1 AND k.key = p_key) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'session_open_key_unchanged';
      END IF;
      INSERT INTO core.iam_session_open_key (id, key) VALUES (2, p_key)
        ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, installed_at = platform.now();
    WHEN 'PROMOTE' THEN
      IF NOT v_next THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'session_open_key_nothing_staged';
      END IF;
      UPDATE core.iam_session_open_key AS k
         SET key = n.key, installed_at = platform.now()
        FROM core.iam_session_open_key AS n
       WHERE k.id = 1 AND n.id = 2;
      DELETE FROM core.iam_session_open_key AS k WHERE k.id = 2;
    WHEN 'ABORT' THEN
      DELETE FROM core.iam_session_open_key AS k WHERE k.id = 2;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'session_open_key_action_invalid';
  END CASE;
  -- état seulement (jamais une clé) : CURRENT ou CURRENT+NEXT
  RETURN (SELECT pg_catalog.string_agg(CASE k.id WHEN 1 THEN 'CURRENT' ELSE 'NEXT' END, '+'
                                       ORDER BY k.id)
            FROM core.iam_session_open_key AS k);
END
$fn$;

COMMENT ON FUNCTION core.iam_session_open_key_rotate(text, bytea) IS
  'Rotation de la clé de preuve d''ouverture de session (INSTALL, STAGE, PROMOTE, ABORT), sous '
  'migrator seulement ; rend l''état (CURRENT, CURRENT+NEXT), jamais une clé. US-410, ADR-205.';
REVOKE ALL ON FUNCTION core.iam_session_open_key_rotate(text, bytea) FROM PUBLIC;
