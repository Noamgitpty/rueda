-- 0182 — CLM : frais annexes, suite de la red team du lot 3 (US-313) : une demande contestée puis
-- annulée par l'hôte ne se redemande plus, et chaque pièce retenue est décrite au voyageur et à
-- l'ops. US-706 (suite) ; constats F-L3-FRA-01 (élevé : contestation, annulation puis redemande
-- du même frais = fenêtre neuve de 72 h sans décision de l'ops ; rejet définitif contourné) et
-- F-L3-FRA-02 (moyen : un fichier quelconque de l'hôte tient lieu de preuve d'un nettoyage et n'est
-- décrit ni au voyageur ni à la console). 08 BR-REIMB-01 (nettoyage / tabac : « photos dans les
-- fenêtres de 24 h »), BR-REIMB-02 (la fenêtre du voyageur ne se rouvre jamais), BR-REIMB-03,
-- BR-REIMB-05 (doublons), SM-5 (CANCELLED_BY_HOST final) ; 16 CLM-021 (le voyageur voit les preuves
-- avant de payer) ; ADR-197 (0177), ADR-202 (cette migration, PROPOSÉ). Appliquée sous `migrator`,
-- en une transaction.
--
-- Principes (ADR-202, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. F-L3-FRA-01 : l'annulation par l'hôte d'une demande CONTESTÉE vaut abandon définitif du frais
--      pour ce trip (SM-5 : CANCELLED_BY_HOST est un état final ; comme Turo, l'hôte qui retire une
--      demande contestée ne la renvoie pas). Une demande du même type sur le même trip est refusée
--      `INCIDENTAL_DUPLICATE` dès qu'il existe une demande vivante, rejetée, ou annulée après une
--      contestation (`disputed_at` posé) ; seule une demande annulée AVANT toute contestation libère
--      le type (l'hôte corrige une erreur avant que le voyageur ait répondu). Garantie en base :
--      l'index unique `claim_incidental_live_unique` est recréé avec ce prédicat. Toute commande qui
--      écrit une demande (demande, annulation, contestation, décision, débit) prend d'abord le
--      verrou du trip : une annulation et une redemande, ou une annulation et une décision, se
--      sérialisent ; la seconde relit l'état validé par la première.
--   2. F-L3-FRA-02 : chaque pièce retenue est décrite à ceux qui la jugent, avant de payer ou de
--      décider : la vue des parties rend, pour un fichier de l'hôte, son type (MIME) et l'heure
--      serveur de dépôt (jamais son identifiant), en plus des photos des séries ; la console rend en
--      outre l'identifiant, la taille, l'empreinte SHA-256 et le nombre de pièces. Lecture par lien
--      signé et vignettes : suite (route d'envoi des octets, ADR-197 n° 19).
--   3. 08 BR-REIMB-01 (nettoyage / tabac : photos dans les fenêtres de 24 h) appliqué, fail-closed :
--      sans photo de l'intérieur au retour, un nettoyage ou un tabac n'est demandé que si au moins un
--      fichier de l'hôte retenu a été reçu par le serveur entre la fin effective et la fin effective
--      + `incidental_cleaning_photo_window_h` (nouveau, PROPOSÉ 24 h PA / PY, comme Turo ; absent ou
--      mal formé : `PARAM_MISSING`, aucune demande). Les fichiers sont des images (JPEG ou WebP,
--      politique de 0177) ; jamais plus lourd que Turo : aucune photo des séries n'est exigée en plus.
--   4. Écritures par commandes seulement ; RLS ENABLE + FORCE inchangées ; aucun droit applicatif ;
--      aucune constante de pays (hors du bloc généré des paramètres) ; aucun interrupteur écrit.
--
-- Existant : la bêta n'est servie nulle part (aucun frais annexe en production) ; les graines du test
-- des migrations sur base peuplée (l0-us046) n'écrivent aucun frais annexe. Si une demande annulée
-- après contestation coexistait avec une demande du même type sur le même trip, CREATE UNIQUE INDEX
-- échouerait et la migration serait refusée (fail-closed, rien n'est effacé ni masqué).
--
-- Expand / contract : index recréé sous le même nom (prédicat plus strict) ; une fonction et une
-- clé de paramètre AJOUTÉES ; la politique de lecture des paramètres élargie à la nouvelle clé ;
-- trois fonctions remplacées à signature, propriétaire et droits identiques (demande : une issue
-- de plus pour un type abandonné, `PARAM_MISSING` si la nouvelle clé manque ; vues : un élément
-- `HOST_FILE` de plus dans `evidence`, `evidenceCount` dans la console). La version N de l'API
-- refuse une vue qui porte un élément inconnu (lecture défensive) : l'API et le site sont livrés
-- avec cette migration.
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   DROP INDEX core.claim_incidental_live_unique ; recréer l'index de 0177 (WHERE status <>
--     'CANCELLED_BY_HOST') ;
--   corps de core.claim_cmd_submit_incidental, core.claim_incidental_view et
--     core.claim_incidental_staff_view de 0177 rétablis (CREATE OR REPLACE) ;
--   DROP FUNCTION core.claim_incidental_host_file_meta(uuid, uuid[]) ;
--   ALTER POLICY cmd_money_incidental_param_read : liste des clés de 0177 ;
--   DELETE des valeurs puis de la définition de `incidental_cleaning_photo_window_h` (section 5).

-- 1. Une demande contestée puis annulée bloque le type (F-L3-FRA-01) -----------------------------
-- une demande par (trip, type) hors annulation de l'hôte AVANT toute contestation : un rejet de
-- l'ops est définitif (revue code n° 1 d'US-706), l'annulation d'une demande contestée aussi
DROP INDEX core.claim_incidental_live_unique;
CREATE UNIQUE INDEX claim_incidental_live_unique ON core.claim_incidental_invoice (trip_id, fee_type)
  WHERE (status <> 'CANCELLED_BY_HOST' OR disputed_at IS NOT NULL);
COMMENT ON INDEX core.claim_incidental_live_unique IS
  'CLM : une demande de frais annexe par (trip, type), sauf une demande annulée par l''hôte avant '
  'toute contestation ; un rejet de l''ops et une annulation après contestation sont définitifs '
  '(F-L3-FRA-01). US-706 (ADR-197, ADR-202).';

-- 2. Description des fichiers de l'hôte (cmd_hold_owner) -----------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Fichiers de l'hôte rattachés à CE trip parmi les identifiants donnés : type (MIME), taille,
-- empreinte, heure serveur de dépôt, supprimé ou non (jamais le contenu ni le déposant). Aucune
-- ligne pour un fichier non rattaché, rattaché à un autre trip, ou une photo d'une série.
CREATE FUNCTION core.claim_incidental_host_file_meta(p_trip_id uuid, p_files uuid[])
  RETURNS TABLE (file_id uuid, mime text, bytes bigint, sha256 bytea, received_at timestamptz,
                 deleted boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.file_id, f.mime, f.bytes, h.sha256, h.received_at, f.deleted_at IS NOT NULL
    FROM core.claim_incidental_host_file AS h
    JOIN core.audit_file_asset AS f ON f.id = h.file_id
   WHERE h.trip_id = p_trip_id AND h.file_id = ANY (COALESCE(p_files, '{}'::uuid[]))
$fn$;
COMMENT ON FUNCTION core.claim_incidental_host_file_meta(uuid, uuid[]) IS
  'Interne (US-706 suite, ADR-202, F-L3-FRA-02) : description des fichiers de preuve de l''hôte '
  'rattachés à ce trip (type, taille, empreinte, heure serveur de dépôt). EXECUTE cmd_money_owner.';
REVOKE ALL ON FUNCTION core.claim_incidental_host_file_meta(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_incidental_host_file_meta(uuid, uuid[]) TO cmd_money_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Paramètre lu par la commande de demande (cmd_money_owner) ------------------------------------
ALTER POLICY cmd_money_incidental_param_read ON core.config_param_value
  USING (key IN ('incidental_host_window_h', 'invoice_guest_response_h',
                 'incidental_cleaning_max_minor', 'fuel_refill_max',
                 'incidental_evidence_trip_photos_only', 'incidental_fuel_extras_block',
                 'incidental_fuel_early_end_block', 'incidental_cleaning_photo_window_h'));

-- 4. Commandes et vues remplacées (cmd_money_owner ; signature, propriétaire et droits de 0177) ---
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 4.1 Demande d'un frais annexe par l'hôte (0177 § 3.3), plus : type abandonné après une
-- contestation ⇒ INCIDENTAL_DUPLICATE (F-L3-FRA-01) ; nettoyage ou tabac sans photo de l'intérieur
-- ⇒ fichier de l'hôte reçu dans la fenêtre des photos (F-L3-FRA-02) ; fenêtre absente ⇒
-- PARAM_MISSING.
CREATE OR REPLACE FUNCTION core.claim_cmd_submit_incidental(p_token_hash bytea, p_trip_id uuid,
                                                 p_request_id uuid, p_fee_type text,
                                                 p_amount_minor bigint, p_description text,
                                                 p_evidence uuid[])
  RETURNS TABLE (outcome text, invoice_id uuid, response_due_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p        record;
  f        record;
  v_old    core.claim_incidental_invoice%ROWTYPE;
  v_now    timestamptz;
  v_win    jsonb;
  v_resp   jsonb;
  v_cap    jsonb;
  v_win_h  integer;
  v_resp_h integer;
  v_cap_m  bigint;
  v_ev     uuid[];
  v_n      integer;
  v_known  integer;
  v_fuel_o boolean;
  v_fuel_i boolean;
  v_inner  boolean;
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
  v_desc   text := pg_catalog.btrim(p_description);
  v_due    timestamptz;
  v_only   boolean;
  v_extras boolean;
  v_early  boolean;
  v_files  integer := 0;
  v_post   integer := 0;
  v_pwin   jsonb;
  v_pwin_h integer;
BEGIN
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL OR p.role <> 'HOST' THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- verrou du trip (un seul écrivain d'argent du trip), puis lecture de l'heure
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = p_trip_id FOR UPDATE;
  v_now := platform.now();
  -- rejeu : la même requête rend la même demande, quel que soit le contenu reçu
  SELECT * INTO v_old FROM core.claim_incidental_invoice AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.trip_id <> p_trip_id OR v_old.host_user_id <> p.user_id THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    ELSE
      RETURN QUERY SELECT 'ALREADY_SUBMITTED'::text, v_old.id, v_old.response_due_at;
    END IF;
    RETURN;
  END IF;
  -- liste fermée de BR-REIMB-01 / BR-PAY-06
  IF p_fee_type IS NULL OR p_fee_type NOT IN ('FUEL', 'CLEANING', 'SMOKING', 'EV_CHARGE',
                                               'MILEAGE', 'TOLL', 'TICKET', 'LATE_RETURN') THEN
    RETURN QUERY SELECT 'INCIDENTAL_TYPE_NOT_ALLOWED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_fee_type NOT IN ('FUEL', 'CLEANING', 'SMOKING') THEN
    RETURN QUERY SELECT 'INCIDENTAL_TYPE_NOT_SUPPORTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_desc IS NULL OR pg_catalog.char_length(v_desc) NOT BETWEEN 10 AND 500
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO f FROM core.claim_incidental_trip_facts(p_trip_id);
  IF f.end_at IS NULL THEN
    RETURN QUERY SELECT 'INCIDENTAL_TRIP_NOT_ENDED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- délais du pays (heure de la base) ; absents ou mal formés : aucune demande
  v_win := core.claim_incidental_param('incidental_host_window_h', f.country_code);
  v_resp := core.claim_incidental_param('invoice_guest_response_h', f.country_code);
  -- fenêtre des photos d'un nettoyage ou d'un tabac après la fin effective (08 BR-REIMB-01
  -- « photos dans les fenêtres de 24 h » ; 0182, F-L3-FRA-02)
  v_pwin := core.claim_incidental_param('incidental_cleaning_photo_window_h', f.country_code);
  IF pg_catalog.jsonb_typeof(v_win) = 'number' AND (v_win #>> '{}') ~ '^[1-9][0-9]{0,3}$' THEN
    v_win_h := (v_win #>> '{}')::integer;
  END IF;
  IF pg_catalog.jsonb_typeof(v_resp) = 'number' AND (v_resp #>> '{}') ~ '^[1-9][0-9]{0,2}$'
     AND (v_resp #>> '{}')::integer <= 720 THEN
    v_resp_h := (v_resp #>> '{}')::integer;
  END IF;
  IF pg_catalog.jsonb_typeof(v_pwin) = 'number' AND (v_pwin #>> '{}') ~ '^[1-9][0-9]{0,2}$'
     AND (v_pwin #>> '{}')::integer <= 720 THEN
    v_pwin_h := (v_pwin #>> '{}')::integer;
  END IF;
  -- contrôles plus stricts que Turo en paramètres du pays (DEC-FONDATEUR-22, ADR-197 n° 4)
  v_only := core.claim_incidental_bool('incidental_evidence_trip_photos_only', f.country_code);
  v_extras := core.claim_incidental_bool('incidental_fuel_extras_block', f.country_code);
  v_early := core.claim_incidental_bool('incidental_fuel_early_end_block', f.country_code);
  IF v_win_h IS NULL OR v_resp_h IS NULL OR v_pwin_h IS NULL OR v_only IS NULL
     OR v_extras IS NULL OR v_early IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_now > f.end_at + pg_catalog.make_interval(hours => v_win_h) THEN
    RETURN QUERY SELECT 'INCIDENTAL_WINDOW_CLOSED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- pièces : chaque fichier est une photo d'une série SUBMITTED du trip (aucune existence révélée)
  SELECT pg_catalog.array_agg(DISTINCT e ORDER BY e) INTO v_ev
    FROM pg_catalog.unnest(p_evidence) AS e WHERE e IS NOT NULL;
  v_n := COALESCE(pg_catalog.cardinality(v_ev), 0);
  SELECT pg_catalog.count(DISTINCT ph.file_id)::integer,
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKIN' AND ph.slot_group = 'FUEL'), false),
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKOUT' AND ph.slot_group = 'FUEL'), false),
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKOUT' AND ph.slot_group = 'INTERIOR'), false)
    INTO v_known, v_fuel_o, v_fuel_i, v_inner
    FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
   WHERE ph.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]));
  -- photos du trip seulement (vrai) ; sinon aussi les fichiers déposés par l'hôte depuis le début
  IF NOT v_only THEN
    -- fichiers de l'hôte rattachés à CE trip dès l'envoi (jamais un autre trip)
    SELECT pg_catalog.count(DISTINCT hf.file_id)::integer INTO v_files
      FROM core.claim_incidental_host_files(p_trip_id, p.user_id) AS hf
     WHERE hf.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]));
    -- dont ceux reçus par le serveur entre la fin effective et la fin + la fenêtre des photos :
    -- seuls ceux-là montrent l'état au retour (08 BR-REIMB-01 ; 0182, F-L3-FRA-02)
    SELECT pg_catalog.count(DISTINCT m.file_id)::integer INTO v_post
      FROM core.claim_incidental_host_files(p_trip_id, p.user_id) AS hf
      JOIN core.claim_incidental_host_file_meta(p_trip_id, v_ev) AS m ON m.file_id = hf.file_id
     WHERE m.received_at >= f.end_at
       AND m.received_at <= f.end_at + pg_catalog.make_interval(hours => v_pwin_h);
  END IF;
  IF v_n = 0 OR v_n > 10 OR v_known + v_files <> v_n
     OR (p_fee_type = 'FUEL' AND NOT (v_fuel_o AND v_fuel_i)) THEN
    RETURN QUERY SELECT 'CLAIM_EVIDENCE_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- règles de non-facturation (BR-FUEL-01 à 03, BR-RETURN-05)
  IF p_fee_type = 'FUEL' THEN
    IF v_extras AND f.extras_sold THEN
      RETURN QUERY SELECT 'INCIDENTAL_FUEL_PREPAID'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF (v_early AND f.terminated_early) OR f.fuel_out IS NULL OR f.fuel_in IS NULL OR f.fuel_in >= f.fuel_out THEN
      RETURN QUERY SELECT 'INCIDENTAL_NOT_BILLABLE'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
  -- nettoyage : photo de l'intérieur au retour, ou (photos du trip non exigées) fichier de l'hôte
  -- reçu dans la fenêtre des photos après la fin effective (0182, F-L3-FRA-02)
  ELSIF NOT v_inner AND (v_only OR v_post = 0) THEN
    RETURN QUERY SELECT 'INCIDENTAL_NOT_BILLABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- plafond du pays (unités mineures de la devise) ; absent ou illisible : aucune demande
  v_cap := core.claim_incidental_param(CASE p_fee_type WHEN 'FUEL' THEN 'fuel_refill_max'
                                                       ELSE 'incidental_cleaning_max_minor' END,
                                       f.country_code);
  IF pg_catalog.jsonb_typeof(v_cap) IN ('string', 'number')
     AND (v_cap #>> '{}') ~ '^(0|[1-9][0-9]{0,14})$' THEN
    v_cap_m := (v_cap #>> '{}')::bigint;
  END IF;
  IF v_cap_m IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_amount_minor > v_cap_m THEN
    RETURN QUERY SELECT 'INCIDENTAL_AMOUNT_ABOVE_CAP'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- une demande vivante, rejetée, ou annulée APRÈS une contestation du voyageur bloque le type :
  -- l'annulation d'une demande contestée vaut abandon définitif (0182, F-L3-FRA-01 ; SM-5
  -- CANCELLED_BY_HOST est final, la fenêtre du voyageur ne se rouvre jamais, BR-REIMB-02)
  IF EXISTS (SELECT 1 FROM core.claim_incidental_invoice AS x
              WHERE x.trip_id = p_trip_id AND x.fee_type = p_fee_type
                AND (x.status <> 'CANCELLED_BY_HOST' OR x.disputed_at IS NOT NULL)) THEN
    RETURN QUERY SELECT 'INCIDENTAL_DUPLICATE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_due := v_now + pg_catalog.make_interval(hours => v_resp_h);
  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  INSERT INTO core.claim_incidental_invoice
         (id, trip_id, country_code, currency, org_id, host_user_id, guest_user_id, request_id,
          fee_type, amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, description, evidence_file_ids, trip_end_at, host_deadline_at,
          notified_at, response_hours, response_due_at, next_check_at)
  VALUES (v_id, f.trip_id, f.country_code, f.currency, f.org_id, p.user_id, f.guest_user_id,
          p_request_id, p_fee_type, p_amount_minor, p_amount_minor, 0, 0, 0, v_desc, v_ev,
          f.end_at, f.end_at + pg_catalog.make_interval(hours => v_win_h), v_now, v_resp_h, v_due,
          v_due);
  -- avis au voyageur (NTF : parties du trip lues en base ; aucun texte de l'hôte dans l'avis)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('invoice.status_changed', 1, 'incidental_invoice', v_id, 0, f.country_code, p.user_id,
          'HOST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'invoice_id', v_id, 'trip_id', f.trip_id, 'status', 'AWAITING_GUEST',
            'fee_type', p_fee_type, 'amount_minor', p_amount_minor::text, 'currency', f.currency,
            'response_due_at', pg_catalog.to_char(v_due AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
          f.trip_id::text);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN QUERY SELECT 'SUBMITTED'::text, v_id, v_due;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_submit_incidental(bytea, uuid, uuid, text, bigint, text, uuid[]) IS
  'Demande d''un frais annexe par le titulaire du compte d''hôte (liste fermée, photos du trip, '
  'délai de l''hôte, plafond du pays, jambes figées HOST 100 %) ; notifiée à l''heure de la base, '
  'réponse du voyageur sous invoice_guest_response_h ; une demande annulée après contestation '
  'bloque le type pour ce trip ; nettoyage : photo de l''intérieur au retour ou fichier de l''hôte '
  'reçu dans la fenêtre des photos. EXECUTE app_api. US-706 (ADR-197, ADR-202).';

-- 4.2 Vue des parties (0177 § 3.7), plus : chaque pièce retenue décrite, fichiers de l'hôte compris
-- (type, heure serveur de dépôt ; F-L3-FRA-02).
CREATE OR REPLACE FUNCTION core.claim_incidental_view(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  p       record;
  f       record;
  v_now   timestamptz := platform.now();
  v_win   jsonb;
  v_win_h integer;
  v_list  jsonb;
  v_ph    jsonb;
  v_iso   text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
  v_can   boolean;
  v_open  boolean;
  v_caps  jsonb;
BEGIN
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN '{"outcome": "NOT_FOUND"}'::jsonb;
  END IF;
  SELECT * INTO f FROM core.claim_incidental_trip_facts(p_trip_id);
  v_win := core.claim_incidental_param('incidental_host_window_h', f.country_code);
  IF pg_catalog.jsonb_typeof(v_win) = 'number' AND (v_win #>> '{}') ~ '^[1-9][0-9]{0,3}$' THEN
    v_win_h := (v_win #>> '{}')::integer;
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', i.id, 'feeType', i.fee_type, 'amountMinor', i.amount_minor::text,
           'status', i.status,
           'notifiedAt', pg_catalog.to_char(i.notified_at AT TIME ZONE 'UTC', v_iso),
           'responseDueAt', pg_catalog.to_char(i.response_due_at AT TIME ZONE 'UTC', v_iso),
           'windowOpen', i.status = 'AWAITING_GUEST' AND v_now < i.response_due_at,
           'description', i.description,
           'evidenceCount', pg_catalog.cardinality(i.evidence_file_ids),
           -- chaque pièce retenue est décrite (0182, F-L3-FRA-02) : photo d'une série (côté,
           -- emplacement, auteur, heure serveur) ou fichier de l'hôte (type, heure serveur de
           -- dépôt) ; jamais un identifiant de fichier
           'evidence', COALESCE((SELECT pg_catalog.jsonb_agg(e.j ORDER BY e.k, e.r, e.s)
                         FROM (SELECT pg_catalog.jsonb_build_object(
                                 'kind', ph.kind, 'slotCode', ph.slot_code,
                                 'slotGroup', ph.slot_group, 'takenBy', ph.taken_by_role,
                                 'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC',
                                                                  v_iso)) AS j,
                                 ph.kind AS k, ph.received_at AS r, ph.slot_code AS s
                                 FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
                                WHERE ph.file_id = ANY (i.evidence_file_ids)
                               UNION ALL
                               SELECT pg_catalog.jsonb_build_object(
                                 'kind', 'HOST_FILE', 'takenBy', 'HOST', 'mime', m.mime,
                                 'receivedAt', pg_catalog.to_char(m.received_at AT TIME ZONE 'UTC',
                                                                  v_iso)),
                                 'HOST_FILE', m.received_at, m.file_id::text
                                 FROM core.claim_incidental_host_file_meta(p_trip_id,
                                                                          i.evidence_file_ids) AS m)
                              AS e), '[]'::jsonb),
           'disputeReason', i.dispute_reason,
           'decision', CASE WHEN i.decided_at IS NULL THEN NULL
                            WHEN i.status = 'REJECTED' THEN 'REJECTED' ELSE 'CHARGE' END,
           'decisionRationale', i.decision_rationale,
           'chargeStatus', CASE WHEN i.charge_id IS NULL THEN NULL
                                WHEN c.status = 'CHARGED' THEN 'PAID'
                                WHEN c.status = 'UNPAID' THEN 'UNPAID'
                                ELSE 'PROCESSING' END)
           ORDER BY i.notified_at DESC, i.fee_type), '[]'::jsonb)
    INTO v_list
    FROM core.claim_incidental_invoice AS i
    LEFT JOIN core.payment_post_trip_charge AS c ON c.id = i.charge_id
   WHERE i.trip_id = p_trip_id;
  v_can := p.role = 'HOST' AND f.end_at IS NOT NULL AND v_win_h IS NOT NULL
           AND v_now <= f.end_at + pg_catalog.make_interval(hours => v_win_h);
  v_open := p.role = 'GUEST'
            AND EXISTS (SELECT 1 FROM core.claim_incidental_invoice AS i
                         WHERE i.trip_id = p_trip_id AND i.status = 'AWAITING_GUEST'
                           AND v_now < i.response_due_at);
  -- identifiants des photos : à l'hôte qui peut demander, au voyageur qui peut contester
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'fileId', ph.file_id, 'kind', ph.kind, 'slotCode', ph.slot_code,
           'slotGroup', ph.slot_group, 'takenBy', ph.taken_by_role)), '[]'::jsonb)
    INTO v_ph
    FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
   WHERE v_can OR v_open;
  -- plafonds du pays (aide du montant de l'hôte ; revue ux n° 3) ; NULL : non fixé
  IF p.role = 'HOST' THEN
    -- valeur illisible : non rendue (aide seulement ; la commande refuse PARAM_MISSING)
    SELECT pg_catalog.jsonb_object_agg(k.fee, CASE WHEN k.v ~ '^(0|[1-9][0-9]{0,14})$' THEN k.v END)
      INTO v_caps
      FROM (VALUES
              ('FUEL', core.claim_incidental_param('fuel_refill_max', f.country_code) #>> '{}'),
              ('CLEANING',
               core.claim_incidental_param('incidental_cleaning_max_minor', f.country_code) #>> '{}'),
              ('SMOKING',
               core.claim_incidental_param('incidental_cleaning_max_minor', f.country_code) #>> '{}'))
           AS k(fee, v);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK', 'viewerRole', p.role, 'currency', f.currency, 'timezone', f.timezone,
    'endedAt', CASE WHEN f.end_at IS NULL THEN NULL
                    ELSE pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', v_iso) END,
    'hostDeadlineAt', CASE WHEN f.end_at IS NULL OR v_win_h IS NULL THEN NULL
                           ELSE pg_catalog.to_char((f.end_at + pg_catalog.make_interval(
                                  hours => v_win_h)) AT TIME ZONE 'UTC', v_iso) END,
    'canSubmit', v_can,
    'feeTypes', '["FUEL", "CLEANING", "SMOKING"]'::jsonb,
    'caps', v_caps,
    'invoices', v_list, 'photos', v_ph);
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_view(bytea, uuid) IS
  'Vue des frais annexes d''un trip pour l''hôte titulaire ou le voyageur (demandes, échéance, '
  'état du débit, chaque pièce retenue décrite, photos du trip utilisables comme pièces). '
  'EXECUTE app_api. US-706 (ADR-197, ADR-202).';

-- 4.3 Vue de la console (0177 § 3.9), plus : nombre de pièces et chaque pièce décrite, fichiers de
-- l'hôte compris (identifiant, type, taille, empreinte, heure serveur de dépôt ; F-L3-FRA-02).
CREATE OR REPLACE FUNCTION core.claim_incidental_staff_view(p_invoice_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'id', i.id, 'tripId', i.trip_id, 'country', i.country_code, 'currency', i.currency,
           'feeType', i.fee_type, 'amountMinor', i.amount_minor::text,
           'legs', pg_catalog.jsonb_build_object('HOST', i.leg_host_minor::text,
                     'INSURER', i.leg_insurer_minor::text,
                     'TAX_THIRD_PARTY', i.leg_tax_third_party_minor::text,
                     'PLATFORM', i.leg_platform_minor::text),
           'status', i.status, 'description', i.description,
           -- chaque pièce retenue est décrite à l'ops (0182, F-L3-FRA-02) : photo d'une série
           -- (côté, emplacement, auteur, heure serveur) ou fichier de l'hôte (identifiant, type,
           -- taille, empreinte, heure serveur de dépôt)
           'evidenceCount', pg_catalog.cardinality(i.evidence_file_ids),
           'evidence', COALESCE((SELECT pg_catalog.jsonb_agg(e.j ORDER BY e.k, e.r, e.s)
                         FROM (SELECT pg_catalog.jsonb_build_object(
                                 'kind', ph.kind, 'slotCode', ph.slot_code,
                                 'slotGroup', ph.slot_group, 'takenBy', ph.taken_by_role,
                                 'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS j,
                                 ph.kind AS k, ph.received_at AS r, ph.slot_code AS s
                                 FROM core.claim_incidental_trip_photos(i.trip_id) AS ph
                                WHERE ph.file_id = ANY (i.evidence_file_ids)
                               UNION ALL
                               SELECT pg_catalog.jsonb_build_object(
                                 'kind', 'HOST_FILE', 'takenBy', 'HOST', 'fileId', m.file_id,
                                 'mime', m.mime, 'bytes', m.bytes::text,
                                 'sha256', pg_catalog.encode(m.sha256, 'hex'),
                                 'deleted', m.deleted,
                                 'receivedAt', pg_catalog.to_char(m.received_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
                                 'HOST_FILE', m.received_at, m.file_id::text
                                 FROM core.claim_incidental_host_file_meta(i.trip_id,
                                                                          i.evidence_file_ids) AS m)
                              AS e), '[]'::jsonb),
           'disputeEvidence', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'kind', ph.kind, 'slotCode', ph.slot_code, 'takenBy', ph.taken_by_role))
                         FROM core.claim_incidental_trip_photos(i.trip_id) AS ph
                        WHERE ph.file_id = ANY (i.dispute_evidence_file_ids)), '[]'::jsonb),
           'notifiedAt', pg_catalog.to_char(i.notified_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'responseDueAt', pg_catalog.to_char(i.response_due_at AT TIME ZONE 'UTC',
                                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputedAt', pg_catalog.to_char(i.disputed_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputeReason', i.dispute_reason,
           'decidedRole', i.decided_role, 'decisionRationale', i.decision_rationale,
           'chargeBasis', i.charge_basis, 'executionCode', i.execution_code,
           'deferCount', i.defer_count,
           'reviewRequiredAt', pg_catalog.to_char(i.review_required_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM core.claim_incidental_invoice AS i WHERE i.id = p_invoice_id
$fn$;
COMMENT ON FUNCTION core.claim_incidental_staff_view(uuid) IS
  'Console : vue d''un frais annexe (montant, jambes, chaque pièce retenue décrite, contestation, '
  'décision). EXECUTE iam_staff_owner. US-706 (ADR-197, ADR-202).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 5. Paramètre `incidental_cleaning_photo_window_h` : bloc GÉNÉRÉ depuis
-- apps/api/src/modules/cfg/data/params.json (`renderParamSeedSql`, groupe `embedded` de
-- POST_SEED_PARAMS) ; seed-sql.test.ts exige ce bloc à l'identique. Ne pas l'éditer à la main.
-- 0182 — graine complémentaire : paramètres « incidental_cleaning_photo_window_h* » (US-706 suite ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « incidental_cleaning_photo_window_h » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('incidental_cleaning_photo_window_h', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-REIMB-01 (nettoyage / tabac : « photos dans les fenêtres de 24 h ») ; 16 CLM-021 ; ADR-197, ADR-202 (F-L3-FRA-02) : sans photo de l’intérieur au retour, un nettoyage ou un tabac n’est demandé que si au moins un fichier de l’hôte rattaché au trip a été reçu par le serveur entre la fin effective et la fin effective + cette durée ; absent ou mal formé : aucune demande (fail-closed)', 'PROPOSÉ comme Turo (ADR-202) : 24 h après la fin du trip, comme la fenêtre des photos de Turo reprise par 08');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('incidental_cleaning_photo_window_h', 'PA', 'COUNTRY', NULL, NULL, '24'::jsonb, 'graine US-706 suite : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-202)'),
  ('incidental_cleaning_photo_window_h', 'PY', 'COUNTRY', NULL, NULL, '24'::jsonb, 'graine US-706 suite : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-202)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'incidental\_cleaning\_photo\_window\_h%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre incidental_cleaning_photo_window_h* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
