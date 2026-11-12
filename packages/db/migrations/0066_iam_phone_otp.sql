-- 0066 — IAM : vérification du téléphone par OTP (code à usage unique envoyé par SMS).
-- US-104 ; 19 US-104 ; 16 VER-013 (« code 6 chiffres … valable 10 min ; 5 essais puis blocage
-- 1 h » ; erreurs OTP_INVALID, OTP_EXPIRED, OTP_LOCKED, ACCOUNT_DUPLICATE_PHONE) ; 08 BR-VERIF-06 ;
-- 17 §3.2.1 (`otp_challenge` : code_hash [C4], expires_at, attempts, locked_until ; purge 30 j),
-- §4.5 (`iam.phone.verified` : user_id, channel, line_type), §6.6 (OTP, limitation de débit),
-- §7.2 (`otp_ttl_min`, `otp_max_attempts`, `otp_lock_min`, `otp_sms_fallback_s`, par pays) ;
-- ADR-098 (cette migration). Appliquée sous `migrator`.
--
-- Principes (ADR-098) :
--   - envoi ASYNCHRONE, sans code en clair à rejouer (suite N-23 appliquée à l'OTP) : la demande
--     (`core.iam_cmd_phone_otp_request`, app_api) n'écrit qu'un défi SANS code et l'événement
--     `iam.otp.requested` (identifiant du défi seulement) dans la même transaction ; le travailleur
--     `iam_otp_sender` tire le code (CSPRNG), en dépose l'empreinte HMAC-SHA-256 par
--     `core.iam_worker_otp_issue` puis l'envoie. Le code n'existe en clair que dans la mémoire du
--     travailleur, le temps de l'envoi : jamais en base, dans l'outbox, une file ou un journal ;
--   - l'empreinte est calculée par l'application sous une clé hors base (`RUEDA_OTP_KEY`) : une
--     copie de la base ne permet pas de retrouver un code par force brute (10^6 codes) ;
--   - la base juge tout, à son horloge (`platform.now()`), avec les paramètres du PAYS du défi
--     (lus ici, jamais reçus du client) : durée de vie, essais, blocage, délai de renvoi ;
--   - essais bornés : chaque code faux compte ; au `otp_max_attempts`-ième, le défi est bloqué
--     `otp_lock_min` minutes (`OTP_LOCKED`) et aucun code, même juste, n'est plus accepté ; un
--     nouveau défi demandé pendant le blocage est refusé ; les échecs d'un défi encore vivant se
--     reportent sur le défi suivant (un renvoi ne remet pas le compteur à zéro) ;
--   - comparaison en temps constant (`core.iam_otp_hash_equal`), sur des empreintes de 32 octets ;
--   - aucune énumération : la demande rend la même issue (`SENT`) que le numéro soit libre ou déjà
--     vérifié par un autre compte ; le refus `ACCOUNT_DUPLICATE_PHONE` (16 VER-013) n'est rendu
--     qu'APRÈS la preuve de possession du numéro (code juste) ;
--   - un numéro vérifié n'appartient qu'à un compte (index unique de 0010, ACC-014), sous verrou
--     consultatif par numéro ;
--   - purge à 30 jours (17 §3.2.1) par le travailleur `iam_otp_pruner`, bornée par la politique.
--
-- Écarts PROPOSÉS avec 17 §3.2.1 (à reporter, ADR-098) : `code_hash` devient NULL tant que le
-- travailleur n'a pas tiré le code (contrainte `otp_challenge_issued`) ; colonnes ajoutées
-- `country_code` (pays du parcours, porteur des paramètres) et `issued_at` (code tiré et envoyé).
--
-- Retour arrière :
--   DROP FUNCTION core.iam_cmd_phone_otp_request(bytea, text, text),
--     core.iam_cmd_phone_otp_verify(bytea, bytea[]), core.iam_phone_otp_state(bytea),
--     core.iam_worker_otp_issue(uuid, bytea), core.iam_worker_otp_prune(integer),
--     core.iam_otp_param(text, text), core.iam_otp_hash_equal(bytea, bytea);
--   DROP POLICY iam_auth_select, iam_auth_insert, iam_auth_update, iam_auth_delete
--     ON core.iam_otp_challenge;
--   DROP POLICY iam_auth_otp_read ON core.config_param_value;
--   DROP POLICY iam_auth_otp_event_ins ON core.outbox_outbox_event;
--   révoquer les droits accordés ci-dessous ; DROP INDEX core.otp_challenge_user_latest_idx ;
--   ALTER TABLE core.iam_otp_challenge DROP CONSTRAINT otp_challenge_issued,
--     DROP CONSTRAINT otp_challenge_code_hash_sha256, DROP CONSTRAINT otp_challenge_country_format,
--     DROP COLUMN issued_at, DROP COLUMN country_code, ALTER COLUMN code_hash SET NOT NULL
--   (table vide de défis sans code seulement).

-- 1. Défi : code tiré par le travailleur, pays du parcours -----------------------------------------
ALTER TABLE core.iam_otp_challenge ALTER COLUMN code_hash DROP NOT NULL;
ALTER TABLE core.iam_otp_challenge
  ADD COLUMN country_code text,                                   -- pays du parcours (paramètres)
  ADD COLUMN issued_at    timestamptz;                            -- code tiré et envoyé
ALTER TABLE core.iam_otp_challenge
  ADD CONSTRAINT otp_challenge_code_hash_sha256
    CHECK (code_hash IS NULL OR pg_catalog.octet_length(code_hash) = 32),
  ADD CONSTRAINT otp_challenge_issued CHECK ((code_hash IS NULL) = (issued_at IS NULL)),
  ADD CONSTRAINT otp_challenge_country_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
CREATE INDEX otp_challenge_user_latest_idx
  ON core.iam_otp_challenge (user_id, purpose, created_at DESC, id DESC);
COMMENT ON TABLE core.iam_otp_challenge IS
  'IAM otp_challenge (17 §3.2.1, VER-013). Code tiré par le travailleur iam_otp_sender ; seule '
  'son empreinte HMAC-SHA-256 (clé hors base) est stockée. Écrite par les commandes 0066 '
  'seulement ; purge à 30 jours. US-104 (ADR-098).';

-- 2. Droits d'iam_auth_owner (propriétaire des commandes de l'OTP) ---------------------------------
GRANT SELECT ON core.iam_otp_challenge TO iam_auth_owner;
GRANT INSERT (id, user_id, phone_e164, channel, expires_at, attempts, purpose, country_code)
  ON core.iam_otp_challenge TO iam_auth_owner;
GRANT UPDATE (code_hash, issued_at, attempts, locked_until, consumed_at)
  ON core.iam_otp_challenge TO iam_auth_owner;
GRANT DELETE ON core.iam_otp_challenge TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.iam_otp_challenge FOR SELECT TO iam_auth_owner USING (true);
-- un défi naît sans code, ni essai consommé au-delà du report, ni blocage, ni consommation
CREATE POLICY iam_auth_insert ON core.iam_otp_challenge FOR INSERT TO iam_auth_owner
  WITH CHECK (code_hash IS NULL AND issued_at IS NULL AND consumed_at IS NULL
              AND locked_until IS NULL AND purpose = 'PHONE_VERIFY' AND channel = 'SMS'
              AND user_id IS NOT NULL AND phone_e164 IS NOT NULL AND country_code IS NOT NULL);
-- un défi consommé ne change plus
CREATE POLICY iam_auth_update ON core.iam_otp_challenge FOR UPDATE TO iam_auth_owner
  USING (consumed_at IS NULL) WITH CHECK (true);
-- purge seulement au-delà de 30 jours (17 §3.2.1)
CREATE POLICY iam_auth_delete ON core.iam_otp_challenge FOR DELETE TO iam_auth_owner
  USING (created_at < platform.now() - pg_catalog.make_interval(days => 30));

-- numéro vérifié du compte (le compte doit avoir son e-mail vérifié : politique iam_auth_update
-- de 0022, inchangée)
GRANT UPDATE (phone_e164, phone_verified_at) ON core.iam_user_account TO iam_auth_owner;

-- paramètres de l'OTP du pays du défi (17 §7.2 ; politiques permissives : s'ajoute à 0061)
CREATE POLICY iam_auth_otp_read ON core.config_param_value FOR SELECT TO iam_auth_owner
  USING (key IN ('otp_ttl_min', 'otp_max_attempts', 'otp_lock_min', 'otp_sms_fallback_s'));

-- événements iam.otp.requested (identifiant du défi seulement) et iam.phone.verified (17 §4.5)
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO iam_auth_owner;
CREATE POLICY iam_auth_otp_event_ins ON core.outbox_outbox_event FOR INSERT TO iam_auth_owner
  WITH CHECK (((type = 'iam.otp.requested' AND aggregate_type = 'otp_challenge')
               OR (type = 'iam.phone.verified' AND aggregate_type = 'user_account'))
              AND actor_role = 'GUEST' AND actor_user_id IS NOT NULL);

-- 3. Primitives (SECURITY INVOKER ; EXECUTE au seul iam_auth_owner) -------------------------------
-- Paramètre entier strictement positif du pays, en vigueur à platform.now() ; NULL si absent.
CREATE FUNCTION core.iam_otp_param(p_key text, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[1-9][0-9]{0,5}$'
              THEN (v.value #>> '{}')::integer END
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Égalité de deux empreintes de 32 octets en temps constant : chaque octet est lu, l'écart est
-- accumulé par OU, aucune sortie anticipée. Absente ou d'une autre longueur : faux.
CREATE FUNCTION core.iam_otp_hash_equal(p_a bytea, p_b bytea)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_diff integer := 0;
  i      integer;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR pg_catalog.octet_length(p_a) <> 32
     OR pg_catalog.octet_length(p_b) <> 32 THEN
    RETURN false;
  END IF;
  FOR i IN 0..31 LOOP
    v_diff := v_diff | (pg_catalog.get_byte(p_a, i) # pg_catalog.get_byte(p_b, i));
  END LOOP;
  RETURN v_diff = 0;
END
$fn$;

REVOKE ALL ON FUNCTION core.iam_otp_param(text, text), core.iam_otp_hash_equal(bytea, bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_otp_param(text, text), core.iam_otp_hash_equal(bytea, bytea)
  TO iam_auth_owner;

-- 4. État du téléphone de la personne de la session (SECURITY DEFINER, EXECUTE app_api) -----------
-- Ses seules données : numéro vérifié, numéro en attente, délais (secondes, horloge de la base),
-- essais restants. Session invalide : AUTH_REQUIRED et rien d'autre.
CREATE FUNCTION core.iam_phone_otp_state(p_token_hash bytea)
  RETURNS TABLE (outcome text, verified_phone text, pending_phone text, resend_after_s integer,
                 expires_in_s integer, locked_for_s integer, attempts_left integer)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_now    timestamptz := platform.now();
  v_acc    record;
  v_c      record;
  v_max    integer;
  v_wait   integer;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::integer,
                        NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  SELECT u.phone_e164, u.phone_verified_at INTO v_acc
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  SELECT c.* INTO v_c FROM core.iam_otp_challenge AS c
   WHERE c.user_id = v_user AND c.purpose = 'PHONE_VERIFY'
   ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
  IF v_c.id IS NOT NULL AND v_c.locked_until IS NOT NULL AND v_c.locked_until > v_now THEN
    RETURN QUERY SELECT 'OK'::text,
      CASE WHEN v_acc.phone_verified_at IS NOT NULL THEN v_acc.phone_e164 END, NULL::text,
      NULL::integer, NULL::integer,
      pg_catalog.ceil(EXTRACT(EPOCH FROM (v_c.locked_until - v_now)))::integer, 0;
    RETURN;
  END IF;
  IF v_c.id IS NULL OR v_c.consumed_at IS NOT NULL OR v_c.expires_at <= v_now THEN
    RETURN QUERY SELECT 'OK'::text,
      CASE WHEN v_acc.phone_verified_at IS NOT NULL THEN v_acc.phone_e164 END, NULL::text,
      NULL::integer, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  v_max := core.iam_otp_param('otp_max_attempts', v_c.country_code);
  v_wait := core.iam_otp_param('otp_sms_fallback_s', v_c.country_code);
  RETURN QUERY SELECT 'OK'::text,
    CASE WHEN v_acc.phone_verified_at IS NOT NULL THEN v_acc.phone_e164 END, v_c.phone_e164,
    CASE WHEN v_wait IS NULL THEN NULL::integer
         ELSE GREATEST(0, pg_catalog.ceil(EXTRACT(EPOCH FROM (
                v_c.created_at + pg_catalog.make_interval(secs => v_wait) - v_now)))::integer) END,
    pg_catalog.ceil(EXTRACT(EPOCH FROM (v_c.expires_at - v_now)))::integer,
    NULL::integer,
    CASE WHEN v_max IS NULL THEN NULL::integer ELSE GREATEST(0, v_max - v_c.attempts) END;
END
$fn$;

-- 5. Demande d'un code (SECURITY DEFINER, EXECUTE app_api) ----------------------------------------
-- Issues : SENT (défi créé, iam.otp.requested émis), AUTH_REQUIRED, REQUEST_INVALID (numéro hors
-- E.164), COUNTRY_UNKNOWN, NOT_ELIGIBLE (e-mail non vérifié, compte fermé ou pseudonymisé),
-- ALREADY_VERIFIED (ce numéro est déjà celui, vérifié, du compte), PARAM_MISSING (paramètre du
-- pays absent : rien n'est écrit, fail-closed), LOCKED (blocage en cours), RESEND_WAIT (même numéro
-- demandé avant `otp_sms_fallback_s`). Un numéro vérifié par un AUTRE compte rend SENT, comme un
-- numéro libre (aucune énumération). Rien n'est écrit hors SENT.
CREATE FUNCTION core.iam_cmd_phone_otp_request(p_token_hash bytea, p_phone text, p_country text)
  RETURNS TABLE (outcome text, challenge_id uuid, resend_after_s integer, expires_in_s integer,
                 locked_for_s integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user     uuid;
  v_now      timestamptz := platform.now();
  v_acc      record;
  v_last     record;
  v_ttl      integer;
  v_max      integer;
  v_lock     integer;
  v_wait     integer;
  v_attempts integer := 0;
  v_id       uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  IF p_country IS NULL
     OR NOT EXISTS (SELECT 1 FROM core.config_country AS k WHERE k.code::text = p_country) THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  SELECT u.id, u.status, u.email_verified_at, u.pseudonymized_at, u.phone_e164,
         u.phone_verified_at
    INTO v_acc
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  IF v_acc.id IS NULL OR v_acc.email_verified_at IS NULL OR v_acc.pseudonymized_at IS NOT NULL
     OR v_acc.status NOT IN ('ACTIVE', 'RESTRICTED') THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  IF v_acc.phone_verified_at IS NOT NULL AND v_acc.phone_e164 = p_phone THEN
    RETURN QUERY SELECT 'ALREADY_VERIFIED'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  v_ttl := core.iam_otp_param('otp_ttl_min', p_country);
  v_max := core.iam_otp_param('otp_max_attempts', p_country);
  v_lock := core.iam_otp_param('otp_lock_min', p_country);
  v_wait := core.iam_otp_param('otp_sms_fallback_s', p_country);
  IF v_ttl IS NULL OR v_max IS NULL OR v_lock IS NULL OR v_wait IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;

  -- une demande à la fois par personne (deux onglets) : la seconde voit le défi de la première
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.otp:' || v_user::text, 0));
  SELECT c.* INTO v_last FROM core.iam_otp_challenge AS c
   WHERE c.user_id = v_user AND c.purpose = 'PHONE_VERIFY'
   ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
  IF v_last.id IS NOT NULL AND v_last.locked_until IS NOT NULL AND v_last.locked_until > v_now THEN
    RETURN QUERY SELECT 'LOCKED'::text, NULL::uuid, NULL::integer, NULL::integer,
      pg_catalog.ceil(EXTRACT(EPOCH FROM (v_last.locked_until - v_now)))::integer;
    RETURN;
  END IF;
  IF v_last.id IS NOT NULL AND v_last.consumed_at IS NULL AND v_last.expires_at > v_now
     AND v_last.phone_e164 = p_phone
     AND v_last.created_at + pg_catalog.make_interval(secs => v_wait) > v_now THEN
    RETURN QUERY SELECT 'RESEND_WAIT'::text, NULL::uuid,
      pg_catalog.ceil(EXTRACT(EPOCH FROM (
        v_last.created_at + pg_catalog.make_interval(secs => v_wait) - v_now)))::integer,
      pg_catalog.ceil(EXTRACT(EPOCH FROM (v_last.expires_at - v_now)))::integer,
      NULL::integer;
    RETURN;
  END IF;
  -- un renvoi ne remet pas les échecs à zéro : ceux d'un défi vivant et jamais bloqué (créé dans
  -- la fenêtre de blocage) se reportent sur le nouveau défi
  IF v_last.id IS NOT NULL AND v_last.consumed_at IS NULL AND v_last.locked_until IS NULL
     AND v_last.created_at > v_now - pg_catalog.make_interval(mins => v_lock) THEN
    v_attempts := LEAST(v_last.attempts, GREATEST(v_max - 1, 0));
  END IF;

  v_id := platform.uuid_v7();
  INSERT INTO core.iam_otp_challenge (id, user_id, phone_e164, channel, expires_at, attempts,
                                      purpose, country_code)
  VALUES (v_id, v_user, p_phone, 'SMS', v_now + pg_catalog.make_interval(mins => v_ttl),
          v_attempts, 'PHONE_VERIFY', p_country);
  -- le travailleur tire le code : l'événement ne porte que l'identifiant du défi (aucun numéro)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('iam.otp.requested', 1, 'otp_challenge', v_id, 0, p_country, v_user, 'GUEST',
          pg_catalog.gen_random_uuid(), pg_catalog.jsonb_build_object('challenge_id', v_id),
          v_id::text);
  RETURN QUERY SELECT 'SENT'::text, v_id, v_wait, v_ttl * 60, NULL::integer;
END
$fn$;

-- 6. Code tiré par le travailleur (SECURITY DEFINER, EXECUTE app_worker, `iam_otp_sender`) --------
-- Dépose l'empreinte du code d'un défi encore vivant, le plus récent de la personne, sans code.
-- Issues : ISSUED (rend numéro, pays, langue et minutes restantes : de quoi rendre le SMS),
-- GONE (défi inconnu ou purgé), ALREADY_ISSUED (tâche rejouée : rien n'est renvoyé), EXPIRED,
-- LOCKED, SUPERSEDED (un défi plus récent existe). Rien n'est écrit hors ISSUED.
CREATE FUNCTION core.iam_worker_otp_issue(p_challenge_id uuid, p_code_hash bytea)
  RETURNS TABLE (outcome text, phone_e164 text, country_code text, locale text,
                 expires_in_min integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
  v_c   record;
  v_loc text;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'iam_otp_sender' THEN
    RAISE EXCEPTION 'iam : réservé au travailleur iam_otp_sender'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_challenge_id IS NULL OR p_code_hash IS NULL OR pg_catalog.octet_length(p_code_hash) <> 32 THEN
    RAISE EXCEPTION 'iam : empreinte de code invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT c.* INTO v_c FROM core.iam_otp_challenge AS c WHERE c.id = p_challenge_id FOR UPDATE;
  IF v_c.id IS NULL THEN
    RETURN QUERY SELECT 'GONE'::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_c.issued_at IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_ISSUED'::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_c.consumed_at IS NOT NULL OR v_c.expires_at <= v_now THEN
    RETURN QUERY SELECT 'EXPIRED'::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_c.locked_until IS NOT NULL AND v_c.locked_until > v_now THEN
    RETURN QUERY SELECT 'LOCKED'::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_otp_challenge AS n
              WHERE n.user_id = v_c.user_id AND n.purpose = v_c.purpose
                AND (n.created_at, n.id) > (v_c.created_at, v_c.id)) THEN
    RETURN QUERY SELECT 'SUPERSEDED'::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  UPDATE core.iam_otp_challenge AS c SET code_hash = p_code_hash, issued_at = v_now
   WHERE c.id = v_c.id;
  SELECT u.preferred_locale INTO v_loc FROM core.iam_user_account AS u WHERE u.id = v_c.user_id;
  RETURN QUERY SELECT 'ISSUED'::text, v_c.phone_e164, v_c.country_code, v_loc,
    GREATEST(1, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_c.expires_at - v_now)) / 60)::integer);
END
$fn$;

-- 7. Saisie du code (SECURITY DEFINER, EXECUTE app_api) -------------------------------------------
-- `p_code_hashes` : empreintes du code saisi sous la clé courante (et, le temps d'une rotation,
-- l'ancienne), 1 à 2 empreintes de 32 octets. Le défi jugé est le plus récent de la personne.
-- Issues : PHONE_VERIFIED (numéro posé et vérifié, iam.phone.verified émis), AUTH_REQUIRED,
-- PARAM_MISSING, OTP_EXPIRED (aucun défi vivant, ou durée de vie dépassée : aucun essai compté),
-- OTP_LOCKED (blocage en cours, ou posé par cet échec), OTP_INVALID (essais restants rendus),
-- ACCOUNT_DUPLICATE_PHONE (code juste, mais numéro déjà vérifié par un autre compte : défi
-- consommé, rien d'autre n'est écrit).
CREATE FUNCTION core.iam_cmd_phone_otp_verify(p_token_hash bytea, p_code_hashes bytea[])
  RETURNS TABLE (outcome text, attempts_left integer, locked_for_s integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_now     timestamptz := platform.now();
  v_c       record;
  v_max     integer;
  v_lock    integer;
  v_match   boolean := false;
  v_h       bytea;
  v_version integer;
BEGIN
  IF p_code_hashes IS NULL OR pg_catalog.cardinality(p_code_hashes) NOT BETWEEN 1 AND 2
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_code_hashes) AS h(v)
                 WHERE h.v IS NULL OR pg_catalog.octet_length(h.v) <> 32) THEN
    RAISE EXCEPTION 'iam : empreintes de code invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.otp:' || v_user::text, 0));
  SELECT c.* INTO v_c FROM core.iam_otp_challenge AS c
   WHERE c.user_id = v_user AND c.purpose = 'PHONE_VERIFY'
   ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     FOR UPDATE;
  IF v_c.id IS NULL OR (v_c.consumed_at IS NOT NULL AND v_c.locked_until IS NULL) THEN
    RETURN QUERY SELECT 'OTP_EXPIRED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  IF v_c.locked_until IS NOT NULL AND v_c.locked_until > v_now THEN
    RETURN QUERY SELECT 'OTP_LOCKED'::text, 0,
      pg_catalog.ceil(EXTRACT(EPOCH FROM (v_c.locked_until - v_now)))::integer;
    RETURN;
  END IF;
  IF v_c.consumed_at IS NOT NULL OR v_c.locked_until IS NOT NULL OR v_c.expires_at <= v_now THEN
    RETURN QUERY SELECT 'OTP_EXPIRED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  v_max := core.iam_otp_param('otp_max_attempts', v_c.country_code);
  v_lock := core.iam_otp_param('otp_lock_min', v_c.country_code);
  IF v_max IS NULL OR v_lock IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  -- chaque empreinte est comparée en entier (aucune sortie anticipée) ; défi sans code : aucune
  -- égalité possible, l'essai compte
  FOREACH v_h IN ARRAY p_code_hashes LOOP
    v_match := core.iam_otp_hash_equal(v_c.code_hash, v_h) OR v_match;
  END LOOP;
  IF NOT v_match THEN
    IF v_c.attempts + 1 >= v_max THEN
      UPDATE core.iam_otp_challenge AS c
         SET attempts = v_c.attempts + 1,
             locked_until = v_now + pg_catalog.make_interval(mins => v_lock)
       WHERE c.id = v_c.id;
      RETURN QUERY SELECT 'OTP_LOCKED'::text, 0, v_lock * 60;
      RETURN;
    END IF;
    UPDATE core.iam_otp_challenge AS c SET attempts = v_c.attempts + 1 WHERE c.id = v_c.id;
    RETURN QUERY SELECT 'OTP_INVALID'::text, v_max - (v_c.attempts + 1), NULL::integer;
    RETURN;
  END IF;

  -- possession prouvée : un numéro vérifié n'appartient qu'à un compte (ACC-014)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.phone:' || v_c.phone_e164, 0));
  UPDATE core.iam_otp_challenge AS c SET consumed_at = v_now WHERE c.id = v_c.id;
  IF EXISTS (SELECT 1 FROM core.iam_user_account AS u
              WHERE u.phone_e164 = v_c.phone_e164 AND u.phone_verified_at IS NOT NULL
                AND u.id <> v_user) THEN
    RETURN QUERY SELECT 'ACCOUNT_DUPLICATE_PHONE'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  UPDATE core.iam_user_account AS u
     SET phone_e164 = v_c.phone_e164, phone_verified_at = v_now
   WHERE u.id = v_user
  RETURNING u.row_version INTO v_version;
  IF v_version IS NULL THEN
    -- compte devenu non modifiable entre-temps (politique iam_auth_update) : rien n'est vérifié
    RAISE EXCEPTION 'iam : compte non modifiable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('iam.phone.verified', 1, 'user_account', v_user, v_version, v_c.country_code, v_user,
          'GUEST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('user_id', v_user, 'channel', v_c.channel,
                                        'line_type', NULL::text),
          v_user::text);
  RETURN QUERY SELECT 'PHONE_VERIFIED'::text, NULL::integer, NULL::integer;
END
$fn$;

-- 8. Purge à 30 jours (SECURITY DEFINER, EXECUTE app_worker, `iam_otp_pruner`) -------------------
CREATE FUNCTION core.iam_worker_otp_prune(p_batch integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'iam_otp_pruner' THEN
    RAISE EXCEPTION 'iam : réservé au travailleur iam_otp_pruner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'iam : lot de purge invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM core.iam_otp_challenge AS c
   WHERE c.id IN (SELECT o.id FROM core.iam_otp_challenge AS o
                   WHERE o.created_at < platform.now() - pg_catalog.make_interval(days => 30)
                   ORDER BY o.created_at LIMIT p_batch);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

COMMENT ON FUNCTION core.iam_phone_otp_state(bytea) IS
  'État du téléphone de la personne de la session (numéro vérifié, en attente, délais, essais). '
  'SECURITY DEFINER, EXECUTE app_api. US-104 (ADR-098).';
COMMENT ON FUNCTION core.iam_cmd_phone_otp_request(bytea, text, text) IS
  'Demande d''un OTP : défi sans code + iam.otp.requested ; paramètres du pays ; même issue SENT '
  'pour un numéro libre ou pris (aucune énumération). SECURITY DEFINER, EXECUTE app_api. US-104.';
COMMENT ON FUNCTION core.iam_worker_otp_issue(uuid, bytea) IS
  'Empreinte du code tiré par le travailleur iam_otp_sender, sur le défi vivant le plus récent. '
  'SECURITY DEFINER, EXECUTE app_worker. US-104 (ADR-098).';
COMMENT ON FUNCTION core.iam_cmd_phone_otp_verify(bytea, bytea[]) IS
  'Saisie d''un OTP : temps constant, essais bornés, blocage du pays, un numéro vérifié par compte. '
  'SECURITY DEFINER, EXECUTE app_api. US-104 (ADR-098).';
COMMENT ON FUNCTION core.iam_worker_otp_prune(integer) IS
  'Purge des défis OTP de plus de 30 jours (17 §3.2.1), travailleur iam_otp_pruner. SECURITY '
  'DEFINER, EXECUTE app_worker. US-104 (ADR-098).';

REVOKE ALL ON FUNCTION core.iam_phone_otp_state(bytea),
  core.iam_cmd_phone_otp_request(bytea, text, text), core.iam_cmd_phone_otp_verify(bytea, bytea[]),
  core.iam_worker_otp_issue(uuid, bytea), core.iam_worker_otp_prune(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_phone_otp_state(bytea),
  core.iam_cmd_phone_otp_request(bytea, text, text), core.iam_cmd_phone_otp_verify(bytea, bytea[])
  TO app_api;
GRANT EXECUTE ON FUNCTION core.iam_worker_otp_issue(uuid, bytea), core.iam_worker_otp_prune(integer)
  TO app_worker;

-- Propriétaire NOLOGIN (mécanique de 0059 / 0061 : CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
ALTER FUNCTION core.iam_phone_otp_state(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_phone_otp_request(bytea, text, text) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_phone_otp_verify(bytea, bytea[]) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_worker_otp_issue(uuid, bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_worker_otp_prune(integer) OWNER TO iam_auth_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;
