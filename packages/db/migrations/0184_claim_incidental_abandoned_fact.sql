-- 0184 — CLM : frais annexes, passe de la porte de la red team du lot 3 (US-313) : un frais abandonné
-- (rejeté par l'ops, ou annulé par l'hôte après une contestation) ne se redemande plus sous un autre
-- type ni avec la même pièce. US-706 (suite, preuves 2) ; constat F-L3-FRA-03 (élevé : nettoyage
-- contesté puis annulé, redemandé sous le type « tabac » avec la même pièce = fenêtre neuve de 72 h
-- sans décision de l'ops). 08 BR-REIMB-02 (la fenêtre du voyageur ne se rouvre jamais), BR-REIMB-03
-- (l'ops tranche une contestation), BR-REIMB-05 (doublons interdits), SM-5 (CANCELLED_BY_HOST et
-- REJECTED finals) ; ADR-197 (0177), ADR-202 (0182), ADR-204 (cette migration, PROPOSÉ). Appliquée
-- sous `migrator`, en une transaction.
--
-- Principes (ADR-204, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Un frais est ABANDONNÉ quand sa demande est REJECTED (décision de l'ops) ou CANCELLED_BY_HOST
--      après une contestation (`disputed_at` posé, 0182). Le FAIT abandonné est (a) celui du type de
--      la demande ET de son groupe : nettoyage et tabac forment un seul groupe « intérieur » (le même
--      état de l'habitacle, 08 BR-REIMB-01 : même plafond, mêmes photos) ; le carburant est seul dans
--      le sien ; et (b) chacune des pièces de la demande. Une nouvelle demande du même trip dont le
--      type est du groupe d'un frais abandonné, ou qui reprend une de ses pièces (quel que soit son
--      type), est refusée `INCIDENTAL_DUPLICATE` (signal existant, aucun texte nouveau) : aucune
--      fenêtre du voyageur ne se rouvre, aucun avis n'est émis, rien n'est écrit.
--   2. Inchangé (0182) : une demande annulée AVANT toute contestation libère son type et ses pièces ;
--      deux demandes vivantes du groupe « intérieur » (nettoyage et tabac) coexistent, chacune avec
--      sa propre fenêtre (08 BR-REIMB-01 les liste séparément) ; le rejeu rend la même demande.
--   3. Concurrence : la règle porte sur plusieurs lignes (groupe, pièces), elle n'est pas un index.
--      Toute commande qui écrit une demande (demande, annulation, contestation, décision, débit)
--      prend d'abord le verrou du trip (0177, 0182) : une redemande et l'annulation ou le rejet
--      d'une demande du même trip se sérialisent, la seconde relit l'état validé par la première
--      (preuve à deux connexions : `l0-us706-incidental-abandoned-race.test.ts`). L'index unique
--      `claim_incidental_live_unique` de 0182 reste la garantie du même type.
--   4. Écritures par commandes seulement ; RLS ENABLE + FORCE inchangées ; aucun droit applicatif ;
--      aucune constante de pays ; aucun paramètre ni interrupteur écrit.
--
-- Existant : la bêta n'est servie nulle part (aucun frais annexe en production) ; la règle ne juge
-- que les nouvelles demandes, rien n'est réécrit.
--
-- Expand / contract : une fonction remplacée à signature, propriétaire et droits identiques
-- (`core.claim_cmd_submit_incidental`, corps de 0182 plus le bloc « frais abandonné ») ; issue
-- existante, aucune forme de réponse nouvelle : la version N de l'API est compatible.
--
-- Retour arrière (jamais en production : nouvelle migration) : corps de
--   core.claim_cmd_submit_incidental de 0182 rétabli (CREATE OR REPLACE).

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Demande d'un frais annexe par l'hôte (0182 § 4.1), plus : fait abandonné (groupe du type ou
-- pièce d'une demande rejetée ou annulée après contestation) ⇒ INCIDENTAL_DUPLICATE (F-L3-FRA-03).
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
  -- frais ABANDONNÉ (rejeté par l'ops, ou annulé par l'hôte après une contestation) : le même fait
  -- ne se redemande plus sous un autre type du même groupe (nettoyage et tabac : l'état de
  -- l'habitacle) ni avec une de ses pièces, quel que soit le type (0184, F-L3-FRA-03, ADR-204 ;
  -- BR-REIMB-02 : la fenêtre du voyageur ne se rouvre jamais ; verrou du trip pris plus haut)
  IF EXISTS (SELECT 1 FROM core.claim_incidental_invoice AS x
              WHERE x.trip_id = p_trip_id
                AND (x.status = 'REJECTED'
                     OR (x.status = 'CANCELLED_BY_HOST' AND x.disputed_at IS NOT NULL))
                AND ((CASE WHEN x.fee_type IN ('CLEANING', 'SMOKING') THEN 'INTERIOR'
                           ELSE x.fee_type END)
                     = (CASE WHEN p_fee_type IN ('CLEANING', 'SMOKING') THEN 'INTERIOR'
                             ELSE p_fee_type END)
                     OR x.evidence_file_ids && v_ev)) THEN
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
  'bloque le type pour ce trip ; un frais rejeté ou annulé après contestation bloque son groupe '
  '(nettoyage et tabac) et ses pièces ; nettoyage : photo de l''intérieur au retour ou fichier de l''hôte '
  'reçu dans la fenêtre des photos. EXECUTE app_api. US-706 (ADR-197, ADR-202, ADR-204).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
