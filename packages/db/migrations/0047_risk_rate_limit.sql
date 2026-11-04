-- 0047 — RISK : compteurs de débit partagés entre instances, plafond journalier de SMS par pays
-- et journal agrégé des abus (tableau de sécurité).
-- US-052 ; 17 §6.6 « Limitation de débit » (par IP, par compte et par numéro) ; 16 A.8
-- (`RATE_LIMITED`) ; 17 §2.3 (rôles, RLS, liste blanche RLS-15) ; ADR-056 (un appel = une
-- instruction) ; ADR-062 (commandes de console) ; ADR-075. Appliquée sous `migrator`.
--
-- Principes (ADR-075) :
--   - aucune donnée personnelle en clair : une clé de compteur est une EMPREINTE de 32 octets
--     (HMAC-SHA-256 calculé par l'API avec une clé de configuration hors dépôt) ; le téléphone,
--     l'e-mail et l'IP n'entrent jamais en base par ce chemin ;
--   - fenêtre fixe à l'horloge de la base (`platform.now()`), jamais celle du serveur ; le
--     plafond SMS se compte par JOUR LOCAL du pays (fuseau lu dans `config_country`) ;
--   - seuils = paramètres `rate_limit_*` par pays (0046), résolus par l'API et passés à la
--     commande, qui les borne (22023 hors bornes) ;
--   - écriture UNIQUEMENT par commandes SECURITY DEFINER sous le propriétaire NOLOGIN
--     `risk_limit_owner` (EXECUTE à app_api / app_worker selon la commande ; jamais app_anon) ;
--     une commande = un appel = une instruction en autocommit (ADR-056) ;
--   - tout refus est journalisé dans `risk_abuse_event`, agrégé par (genre, portée, empreinte,
--     heure) : une rafale de refus ne crée qu'une ligne ; lecture par le tableau de sécurité
--     (`core.risk_staff_abuse_board`, famille console `iam_staff_owner`, permission
--     `security.read_abuse`, TOTP exigé, refus journalisés à l'audit) ;
--   - aucune lecture de table pour les rôles applicatifs.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.risk_cmd_hit(text, bytea, text, integer, integer, integer),
--     core.risk_cmd_sms_reserve(text, integer, boolean),
--     core.risk_cmd_record_abuse(text, text, bytea, text, text[]),
--     core.risk_cmd_prune(integer, integer),
--     core.risk_staff_abuse_board(bytea, text, integer),
--     core.risk_log_abuse(text, text, bytea, text, text[]);
--   DROP TABLE core.risk_rate_counter, core.risk_abuse_event;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-052%';
--   REVOKE ALL ON core.config_country FROM risk_limit_owner; DROP POLICY risk_limit_select
--     ON core.config_country; REVOKE USAGE ON SCHEMA core, platform FROM risk_limit_owner.

-- 0. Socle du propriétaire (créé NOLOGIN par l'amorçage, accordé à migrator INHERIT FALSE) -------
GRANT USAGE ON SCHEMA platform TO risk_limit_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO risk_limit_owner;
GRANT USAGE ON SCHEMA core TO risk_limit_owner;

-- 1. Permission du tableau de sécurité (PROPOSÉ, 17 §2.3 : à reporter dans la matrice) ----------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('ADMIN',      'security.read_abuse', 'PLATFORM', '2026-11-03T00:00:00Z', 'US-052 : tableau de sécurité (17 §6.6)'),
  ('SUPERADMIN', 'security.read_abuse', 'PLATFORM', '2026-11-03T00:00:00Z', 'US-052 : tableau de sécurité (17 §6.6)');

-- 2. Tables ---------------------------------------------------------------------------------------
-- Compteur à fenêtre fixe : une ligne par (portée, empreinte, début de fenêtre).
CREATE TABLE core.risk_rate_counter (
  scope        text        NOT NULL
    CONSTRAINT risk_rate_counter_scope_format CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'),
  key_hash     bytea       NOT NULL
    CONSTRAINT risk_rate_counter_key_size CHECK (pg_catalog.octet_length(key_hash) = 32),
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  country_code char(2)     REFERENCES core.config_country (code),
  hits         integer     NOT NULL
    CONSTRAINT risk_rate_counter_hits_valid CHECK (hits BETWEEN 1 AND 2000000000),
  CONSTRAINT risk_rate_counter_pkey PRIMARY KEY (scope, key_hash, window_start),
  CONSTRAINT risk_rate_counter_window_valid CHECK (window_end > window_start)
);
CREATE INDEX risk_rate_counter_window_end_idx ON core.risk_rate_counter (window_end);
COMMENT ON TABLE core.risk_rate_counter IS
  'RISK : compteurs de débit à fenêtre fixe (17 §6.6), clés = empreintes HMAC (aucune donnée '
  'personnelle en clair). Écrits par core.risk_cmd_hit / risk_cmd_sms_reserve seulement. US-052.';

-- Journal agrégé des abus : une ligne par (genre, portée, empreinte, heure).
CREATE TABLE core.risk_abuse_event (
  id           bigint      GENERATED ALWAYS AS IDENTITY CONSTRAINT risk_abuse_event_pkey PRIMARY KEY,
  kind         text        NOT NULL
    CONSTRAINT risk_abuse_event_kind_valid CHECK (kind IN (
      'RATE_LIMITED', 'SMS_DAILY_CAP_REACHED', 'BOT_SUSPECTED', 'BOT_CHALLENGED')),
  scope        text        NOT NULL
    CONSTRAINT risk_abuse_event_scope_format CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'),
  key_hash     bytea       NOT NULL
    CONSTRAINT risk_abuse_event_key_size CHECK (pg_catalog.octet_length(key_hash) = 32),
  country_code char(2)     REFERENCES core.config_country (code),
  bucket_start timestamptz NOT NULL,
  first_at     timestamptz NOT NULL,
  last_at      timestamptz NOT NULL,
  occurrences  integer     NOT NULL
    CONSTRAINT risk_abuse_event_occurrences_valid CHECK (occurrences BETWEEN 1 AND 2000000000),
  -- signaux des heuristiques anti-robot (vide pour un dépassement de limite)
  signals      text[]      NOT NULL DEFAULT '{}'
    CONSTRAINT risk_abuse_event_signals_valid CHECK (
      signals <@ ARRAY['REGULAR_RHYTHM', 'NO_BROWSER_HEADERS', 'SIGNUP_BURST']::text[]
      AND pg_catalog.array_position(signals, NULL) IS NULL),
  CONSTRAINT risk_abuse_event_unique UNIQUE (kind, scope, key_hash, bucket_start),
  CONSTRAINT risk_abuse_event_times_valid CHECK (first_at <= last_at AND bucket_start <= first_at)
);
CREATE INDEX risk_abuse_event_board_idx ON core.risk_abuse_event (country_code, bucket_start);
COMMENT ON TABLE core.risk_abuse_event IS
  'RISK : refus de débit, plafond SMS et soupçons de robot, agrégés par heure (17 §6.6). Lu par '
  'le tableau de sécurité (core.risk_staff_abuse_board). US-052.';

-- 3. RLS : ENABLE + FORCE, migrator_all ; aucun droit pour les rôles applicatifs ----------------
ALTER TABLE core.risk_rate_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.risk_rate_counter FORCE ROW LEVEL SECURITY;
ALTER TABLE core.risk_abuse_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.risk_abuse_event FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.risk_rate_counter TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.risk_abuse_event TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.risk_rate_counter, core.risk_abuse_event FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON core.risk_rate_counter TO risk_limit_owner;
CREATE POLICY risk_limit_all ON core.risk_rate_counter TO risk_limit_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON core.risk_abuse_event TO risk_limit_owner;
GRANT INSERT (kind, scope, key_hash, country_code, bucket_start, first_at, last_at, occurrences,
              signals) ON core.risk_abuse_event TO risk_limit_owner;
GRANT UPDATE (last_at, occurrences, signals) ON core.risk_abuse_event TO risk_limit_owner;
CREATE POLICY risk_limit_all ON core.risk_abuse_event TO risk_limit_owner
  USING (true) WITH CHECK (true);
-- fuseau du pays (jour local du plafond SMS)
GRANT SELECT (code, time_zone) ON core.config_country TO risk_limit_owner;
CREATE POLICY risk_limit_select ON core.config_country FOR SELECT TO risk_limit_owner USING (true);
-- tableau de sécurité : lecture seule par la famille console
GRANT SELECT (kind, scope, key_hash, country_code, bucket_start, first_at, last_at, occurrences,
              signals) ON core.risk_abuse_event TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.risk_abuse_event FOR SELECT TO iam_staff_owner USING (true);

-- 4. Aide interne : journal agrégé (SECURITY INVOKER, exécutée sous risk_limit_owner) -----------
CREATE FUNCTION core.risk_log_abuse(p_kind text, p_scope text, p_key_hash bytea, p_country text,
                                    p_signals text[])
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.risk_abuse_event AS e
         (kind, scope, key_hash, country_code, bucket_start, first_at, last_at, occurrences, signals)
  VALUES (p_kind, p_scope, p_key_hash, p_country,
          pg_catalog.date_trunc('hour', platform.now()), platform.now(), platform.now(), 1,
          COALESCE(p_signals, '{}'))
  ON CONFLICT (kind, scope, key_hash, bucket_start) DO UPDATE
     SET last_at = GREATEST(e.last_at, EXCLUDED.last_at),
         occurrences = LEAST(e.occurrences::bigint + 1, 2000000000)::integer,
         signals = ARRAY(SELECT DISTINCT s FROM pg_catalog.unnest(e.signals || EXCLUDED.signals) AS s
                          ORDER BY s)
$fn$;
REVOKE ALL ON FUNCTION core.risk_log_abuse(text, text, bytea, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.risk_log_abuse(text, text, bytea, text, text[]) TO risk_limit_owner;

-- 5. Commandes (SECURITY DEFINER, risk_limit_owner) -----------------------------------------------
-- Compte p_weight événements pour (portée, empreinte) dans la fenêtre fixe courante de p_window_s
-- secondes ; refuse au-delà de p_limit. Rend allowed, hits (après ce comptage) et retry_after_s
-- (secondes jusqu'à la fin de la fenêtre, au moins 1). Un refus est journalisé (RATE_LIMITED).
-- Bornes (22023) : limite 1 à 1 000 000, fenêtre 1 s à 7 j, poids 1 à 100, empreinte 32 octets,
-- pays déclaré ou NULL (limite globale). Le compte continue au-delà de la limite (un client qui
-- insiste reste bloqué jusqu'à la fin de la fenêtre).
CREATE FUNCTION core.risk_cmd_hit(p_scope text, p_key_hash bytea, p_country text, p_limit integer,
                                  p_window_s integer, p_weight integer)
  RETURNS TABLE (allowed boolean, hits integer, retry_after_s integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now   timestamptz := platform.now();
  v_start timestamptz;
  v_end   timestamptz;
  v_hits  integer;
BEGIN
  IF p_scope IS NULL OR p_scope !~ '^[a-z][a-z0-9_]{1,47}$'
     OR p_key_hash IS NULL OR pg_catalog.octet_length(p_key_hash) <> 32
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000000
     OR p_window_s IS NULL OR p_window_s NOT BETWEEN 1 AND 604800
     OR p_weight IS NULL OR p_weight NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'risk_cmd_hit : argument hors bornes' USING ERRCODE = '22023';
  END IF;
  v_start := pg_catalog.to_timestamp(
               pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / p_window_s) * p_window_s);
  v_end := v_start + pg_catalog.make_interval(secs => p_window_s);
  INSERT INTO core.risk_rate_counter AS c
         (scope, key_hash, window_start, window_end, country_code, hits)
  VALUES (p_scope, p_key_hash, v_start, v_end, p_country, p_weight)
  ON CONFLICT (scope, key_hash, window_start) DO UPDATE
     SET hits = LEAST(c.hits::bigint + EXCLUDED.hits, 2000000000)::integer
  RETURNING c.hits INTO v_hits;
  IF v_hits > p_limit THEN
    PERFORM core.risk_log_abuse('RATE_LIMITED', p_scope, p_key_hash, p_country, NULL);
  END IF;
  RETURN QUERY SELECT v_hits <= p_limit, v_hits,
                      GREATEST(1, pg_catalog.ceil(pg_catalog.date_part('epoch', v_end - v_now)))::integer;
END
$fn$;

-- Réserve un SMS sur le plafond journalier du pays (jour LOCAL, fuseau de config_country).
-- Un message critique de trip est toujours accordé, et compté (la dépense reste visible) ; un
-- message non critique est refusé une fois le plafond atteint : l'appelant le bascule sur l'e-mail
-- ou le refuse. `alert` vaut true au PREMIER refus du jour (l'appelant publie l'alerte).
-- Sous app_worker, seul le travailleur `ntf_sender` peut réserver (liste blanche, RLS-25).
CREATE FUNCTION core.risk_cmd_sms_reserve(p_country text, p_cap integer, p_critical boolean)
  RETURNS TABLE (allowed boolean, sent_today integer, alert boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now   timestamptz := platform.now();
  v_tz    text;
  v_start timestamptz;
  v_key   bytea;
  v_hits  integer;
  v_first boolean;
BEGIN
  IF session_user = 'app_worker'
     AND (COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
          OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'ntf_sender') THEN
    RAISE EXCEPTION 'risk_cmd_sms_reserve : travailleur non autorisé' USING ERRCODE = '42501';
  END IF;
  SELECT c.time_zone INTO v_tz FROM core.config_country AS c WHERE c.code = p_country;
  IF v_tz IS NULL OR p_cap IS NULL OR p_cap NOT BETWEEN 1 AND 10000000 OR p_critical IS NULL THEN
    RAISE EXCEPTION 'risk_cmd_sms_reserve : argument hors bornes' USING ERRCODE = '22023';
  END IF;
  v_start := pg_catalog.date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  -- empreinte du pays (aucune donnée personnelle) : portée fixe, une ligne par pays et par jour
  v_key := pg_catalog.sha256(pg_catalog.convert_to('sms_country_day:' || p_country, 'UTF8'));
  -- verrou de la ligne du jour : sérialise les réservations du pays (le dernier SMS sous le
  -- plafond n'est accordé qu'une fois)
  SELECT c.hits INTO v_hits FROM core.risk_rate_counter AS c
   WHERE c.scope = 'sms_country_day' AND c.key_hash = v_key AND c.window_start = v_start
     FOR UPDATE;
  IF NOT p_critical AND COALESCE(v_hits, 0) >= p_cap THEN
    SELECT NOT EXISTS (SELECT 1 FROM core.risk_abuse_event AS e
                        WHERE e.kind = 'SMS_DAILY_CAP_REACHED' AND e.scope = 'sms_country_day'
                          AND e.key_hash = v_key AND e.bucket_start >= v_start)
      INTO v_first;
    PERFORM core.risk_log_abuse('SMS_DAILY_CAP_REACHED', 'sms_country_day', v_key, p_country, NULL);
    RETURN QUERY SELECT false, COALESCE(v_hits, 0), v_first;
    RETURN;
  END IF;
  INSERT INTO core.risk_rate_counter AS c
         (scope, key_hash, window_start, window_end, country_code, hits)
  VALUES ('sms_country_day', v_key, v_start,
          (pg_catalog.date_trunc('day', v_now AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz,
          p_country, 1)
  ON CONFLICT (scope, key_hash, window_start) DO UPDATE
     SET hits = LEAST(c.hits::bigint + 1, 2000000000)::integer
  RETURNING c.hits INTO v_hits;
  RETURN QUERY SELECT true, v_hits, false;
END
$fn$;

-- Soupçon de robot (heuristiques de l'API) : journal agrégé seulement (BOT_SUSPECTED si le client
-- est ralenti, BOT_CHALLENGED s'il est soumis au défi). Signaux limités à la liste du CHECK.
CREATE FUNCTION core.risk_cmd_record_abuse(p_kind text, p_scope text, p_key_hash bytea,
                                           p_country text, p_signals text[])
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('BOT_SUSPECTED', 'BOT_CHALLENGED')
     OR p_key_hash IS NULL OR pg_catalog.octet_length(p_key_hash) <> 32
     OR p_signals IS NULL OR pg_catalog.cardinality(p_signals) = 0 THEN
    RAISE EXCEPTION 'risk_cmd_record_abuse : argument hors bornes' USING ERRCODE = '22023';
  END IF;
  PERFORM core.risk_log_abuse(p_kind, p_scope, p_key_hash, p_country, p_signals);
END
$fn$;

-- Purge (travailleur `risk_pruner` seulement) : compteurs dont la fenêtre est close depuis plus
-- d'une heure, journal plus ancien que p_event_retention_days (7 à 400 j). Au plus p_batch lignes
-- de chaque table par appel (1 à 50 000). Rend le nombre de lignes supprimées.
CREATE FUNCTION core.risk_cmd_prune(p_batch integer, p_event_retention_days integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
  v_n   integer;
  v_m   integer;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'risk_pruner' THEN
    RAISE EXCEPTION 'risk_cmd_prune : travailleur non autorisé' USING ERRCODE = '42501';
  END IF;
  IF p_batch IS NULL OR p_batch NOT BETWEEN 1 AND 50000
     OR p_event_retention_days IS NULL OR p_event_retention_days NOT BETWEEN 7 AND 400 THEN
    RAISE EXCEPTION 'risk_cmd_prune : argument hors bornes' USING ERRCODE = '22023';
  END IF;
  DELETE FROM core.risk_rate_counter AS c
   WHERE (c.scope, c.key_hash, c.window_start) IN (
           SELECT x.scope, x.key_hash, x.window_start FROM core.risk_rate_counter AS x
            WHERE x.window_end < v_now - interval '1 hour'
            LIMIT p_batch);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM core.risk_abuse_event AS e
   WHERE e.id IN (SELECT x.id FROM core.risk_abuse_event AS x
                   WHERE x.last_at < v_now - pg_catalog.make_interval(days => p_event_retention_days)
                   LIMIT p_batch);
  GET DIAGNOSTICS v_m = ROW_COUNT;
  RETURN v_n + v_m;
END
$fn$;

COMMENT ON FUNCTION core.risk_cmd_hit(text, bytea, text, integer, integer, integer) IS
  'Compteur de débit à fenêtre fixe (platform.now()), refus journalisé. US-052, ADR-075.';
COMMENT ON FUNCTION core.risk_cmd_sms_reserve(text, integer, boolean) IS
  'Plafond journalier de SMS du pays (jour local) ; critiques toujours accordés. US-052, ADR-075.';
COMMENT ON FUNCTION core.risk_cmd_record_abuse(text, text, bytea, text, text[]) IS
  'Journal agrégé des soupçons de robot. US-052, ADR-075.';
COMMENT ON FUNCTION core.risk_cmd_prune(integer, integer) IS
  'Purge des compteurs échus et du journal ancien (travailleur risk_pruner). US-052, ADR-075.';

REVOKE ALL ON FUNCTION core.risk_cmd_hit(text, bytea, text, integer, integer, integer),
  core.risk_cmd_sms_reserve(text, integer, boolean),
  core.risk_cmd_record_abuse(text, text, bytea, text, text[]),
  core.risk_cmd_prune(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.risk_cmd_hit(text, bytea, text, integer, integer, integer),
  core.risk_cmd_record_abuse(text, text, bytea, text, text[]) TO app_api;
GRANT EXECUTE ON FUNCTION core.risk_cmd_sms_reserve(text, integer, boolean) TO app_api, app_worker;
GRANT EXECUTE ON FUNCTION core.risk_cmd_prune(integer, integer) TO app_worker;

GRANT CREATE ON SCHEMA core TO risk_limit_owner;
ALTER FUNCTION core.risk_cmd_hit(text, bytea, text, integer, integer, integer) OWNER TO risk_limit_owner;
ALTER FUNCTION core.risk_cmd_sms_reserve(text, integer, boolean) OWNER TO risk_limit_owner;
ALTER FUNCTION core.risk_cmd_record_abuse(text, text, bytea, text, text[]) OWNER TO risk_limit_owner;
ALTER FUNCTION core.risk_cmd_prune(integer, integer) OWNER TO risk_limit_owner;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;

-- 6. Tableau de sécurité (famille console, iam_staff_owner ; EXECUTE au seul app_api) ------------
-- Session élevée (TOTP) et permission `security.read_abuse` sur le pays demandé ; p_country NULL
-- = lignes sans pays (limites globales), réservées à qui a la permission sur TOUS les pays
-- déclarés. Fenêtre de 1 à 168 heures. Rend un agrégat par (genre, portée, heure) : occurrences,
-- nombre d'empreintes distinctes et signaux ; jamais d'empreinte (pseudonyme) ni de donnée
-- personnelle. Refus journalisés à l'audit (2FA_REQUIRED, PERMISSION), aucune ligne rendue.
CREATE FUNCTION core.risk_staff_abuse_board(p_token_hash bytea, p_country text, p_hours integer)
  RETURNS TABLE (kind text, scope text, country_code text, bucket_start timestamptz,
                 occurrences bigint, distinct_keys bigint, signals text[], last_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s     record;
  v_scope text[];
  v_role  text;
  v_hours integer := LEAST(GREATEST(COALESCE(p_hours, 24), 1), 168);
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN;
  END IF;
  IF p_country IS NULL THEN
    SELECT pg_catalog.array_agg(k.code::text ORDER BY k.code) INTO v_scope FROM core.config_country AS k;
  ELSE
    v_scope := ARRAY[p_country];
  END IF;
  v_role := core.iam_staff_permitted(v_s.user_id, 'security.read_abuse', v_scope, NULL);
  IF v_s.mfa_level <> 'TOTP' OR v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF',
                                 CASE WHEN v_s.mfa_level <> 'TOTP' THEN 'STAFF_ACCESS_DENIED'
                                      ELSE 'STAFF_FORBIDDEN' END,
                                 'ABUSE_BOARD', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_s.mfa_level <> 'TOTP' THEN '2FA_REQUIRED' ELSE 'PERMISSION' END,
                                   'attempted', 'ABUSE_BOARD_READ', 'permission', 'security.read_abuse',
                                   'country', p_country), NULL, NULL);
    RETURN;
  END IF;
  RETURN QUERY
    SELECT e.kind, e.scope, e.country_code::text, e.bucket_start,
           pg_catalog.sum(e.occurrences)::bigint, pg_catalog.count(DISTINCT e.key_hash)::bigint,
           ARRAY(SELECT DISTINCT s FROM core.risk_abuse_event AS x
                  CROSS JOIN LATERAL pg_catalog.unnest(x.signals) AS s
                 WHERE x.kind = e.kind AND x.scope = e.scope AND x.bucket_start = e.bucket_start
                   AND x.country_code IS NOT DISTINCT FROM e.country_code
                 ORDER BY s),
           pg_catalog.max(e.last_at)
      FROM core.risk_abuse_event AS e
     WHERE e.country_code IS NOT DISTINCT FROM p_country
       AND e.bucket_start >= pg_catalog.date_trunc('hour', platform.now())
                             - pg_catalog.make_interval(hours => v_hours - 1)
     GROUP BY e.kind, e.scope, e.country_code, e.bucket_start
     ORDER BY e.bucket_start DESC, e.kind, e.scope;
END
$fn$;
COMMENT ON FUNCTION core.risk_staff_abuse_board(bytea, text, integer) IS
  'Tableau de sécurité (security.read_abuse, TOTP) : abus agrégés par heure, sans empreinte. US-052.';
REVOKE ALL ON FUNCTION core.risk_staff_abuse_board(bytea, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.risk_staff_abuse_board(bytea, text, integer) TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.risk_staff_abuse_board(bytea, text, integer) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
