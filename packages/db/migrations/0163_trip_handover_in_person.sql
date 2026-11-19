-- 0163 — TRP / AVL : remise et retour du véhicule entre particuliers, en personne (bêta).
-- US-315 ; 19 US-315 (« Given un trip BOOKED sans preuve de paiement par webhook ou sans contrat
-- signé, When l'hôte ouvre la remise, Then elle est bloquée » ; « Given le contrôle du permis à la
-- remise, When l'hôte le fait, Then il compare le permis présenté au prénom, à la photo de profil et
-- à l'année de naissance du compte, coche les points de VER-015 et n'accède jamais au numéro de
-- permis ni à l'image d'une pièce ; un écart bloque la remise » ; « Given les photos de départ de
-- l'hôte et celles du voyageur, When l'une des deux séries est incomplète, Then la remise ne passe
-- pas IN_PROGRESS ; l'heure de début effective est l'heure serveur de la seconde validation » ;
-- « Given le retour à 10:20 serveur, When les deux parties valident les photos de retour,
-- kilométrage et carburant, Then la fin effective est 10:20, l'occupation est libérée par
-- commande » ; « Given p2p_contactless_handover_enabled = false, When l'hôte propose une remise
-- sans rencontre, Then elle n'est pas proposée ») ; 16 TRP-002 (ouverture 24 h avant le début ou
-- dès la réservation si plus tardive ; CHECKIN_NOT_OPEN, CHECKIN_PAYMENT_NOT_CONFIRMED,
-- CHECKIN_STEP_INCOMPLETE, CONTRACT_NOT_SIGNED ; « paiement confirmé et caution autorisée »),
-- VER-015 (6 points, CHECKIN_LICENSE_CHECK_INCOMPLETE, trip_identity_check), TRP-033 (retour) ;
-- 08 BR-PICKUP-01, BR-PICKUP-03, BR-PICKUP-05, BR-PICKUP-08, BR-VERIF-07, BR-RETURN-01 ;
-- 17 §2.11, §3.2.2 (`trip_identity_check`), §3.2.10 (`trip_inspection`, `key_handover`), §7.2
-- (`p2p_contactless_handover_enabled`) ; pré-mortem du lot 3 : L3-PM-08 à L3-PM-14 ; ADR-183 (cette
-- migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-183, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - la partie est celle de la SESSION (empreinte du jeton) : l'hôte titulaire du compte d'hôte du
--     trip ou le voyageur du trip ; toute autre personne, trip inconnu : NOT_FOUND (même réponse) ;
--     co-hôte : suite ;
--   - ouverture (BOOKED → CHECKIN_OPEN) par l'une ou l'autre partie, au plus tôt 24 h avant le
--     début (règle commune de 08 BR-PICKUP-01, pas une constante de pays), SEULEMENT si la base
--     relit, au moment même : paiement du loyer SUCCEEDED prouvé par webhook signé
--     (`proof_type` = WEBHOOK_SIGNED ; un POLL ne suffit pas) et `payment_status` CONFIRMED,
--     dernière version du contrat signée par le voyageur, caution décidée et, si elle est exigée,
--     autorisée (`AUTHORIZED`), contrat d'assureur actif dans le pays
--     (`insurer_contract_active`), voyageur éligible (restriction, consentement, conducteur :
--     `booking_guest_eligibility` de son hold), conducteur principal approuvé, hôte sans
--     restriction et compte d'hôte actif. Une condition illisible ⇒ bloqué (fail-closed) ;
--   - contrôle du permis (VER-015) par l'hôte seul, en CHECKIN_OPEN : six cases cochées par lui ;
--     la base ne sert à l'hôte que le prénom, l'initiale du nom et l'année de naissance du
--     voyageur (jamais un numéro, une pièce, une image, une date complète) ; un point non
--     conforme ⇒ TRIP_ID_FAILED (motif de la liste), définitif : la remise ne passe plus, le refus
--     et sa décision appartiennent à US-307 ;
--   - validation de chaque partie (`trip_ops_handover_validation`, une par partie et par sens) :
--     sa série de photos validée (US-303), compteur et carburant relevés par elle, remise EN
--     PERSONNE seulement (sans rencontre : CONTACTLESS_UNAVAILABLE, OQ-P2P-05) ; au départ, les
--     conditions de l'ouverture relues et, pour l'hôte, le permis contrôlé conforme ;
--   - transition à la SECONDE validation, sous les verrous consultatifs du voyageur puis du
--     véhicule (ordre global de 17 §2.5, celui de booking_trip_lock) : départ CHECKIN_OPEN ou
--     START_WINDOW_EXPIRED → IN_PROGRESS (motif CHECKIN_VALIDATED ; `checkin_validated_at` =
--     platform.now(), début effectif) ; retour IN_PROGRESS ou OVERDUE → RETURNED (motif
--     CHECKOUT_VALIDATED ; fin effective = heure de la PREMIÈRE ligne RETURNED du journal d'état,
--     celle que lit déjà la caution, 0153), occupations libérées par la même commande (I-OCC) ;
--     clés remises (`trip_ops_key_handover`, OUT puis IN) à la même heure ; une seule transition,
--     idempotente (ALREADY_VALIDATED, heure d'origine) ;
--   - heure SERVEUR partout ; aucune heure reçue du client ; aucune file hors ligne (ADR-005,
--     ADR-039 : repli au lot 5, US-524) ;
--   - aucun montant, aucune écriture d'argent : la libération de la jambe HOST (`release_at`) a un
--     écrivain unique, US-708 (S-06), qui lit la fin effective ;
--   - aucun interrupteur écrit ; aucune constante de pays.
--
-- Écarts PROPOSÉS à 17 (ADR-183) : `trip_inspection.status = VALIDATED` n'est pas utilisé (la
-- validation de la partie est une ligne de `trip_ops_handover_validation`, la série reste
-- SUBMITTED, US-303 inchangée) ; relevés `odometer_km`, `fuel_level_eighths` portés par la
-- validation de chaque partie plutôt que par la série ; `trip_identity_check.evidence_file_ids`
-- (preuve d'un refus) arrive avec US-307 ; `key_handover.direction` OUT / IN comme 17.
--
-- Expand / contract : tables, fonctions, droits et politiques AJOUTÉS ; une politique de lecture
-- de la configuration ÉLARGIE (`cmd_hold_inspection_param_read` : + p2p_contactless_handover_enabled) ;
-- une colonne de plus lue par cmd_hold_owner (`iam_user_account.date_of_birth`, année seulement
-- rendue). Rien de retiré.
--
-- Retour arrière (base sans remise) :
--   DROP FUNCTION core.trip_cmd_validate_handover(bytea, uuid, text, integer, integer, text),
--     core.trip_cmd_identity_check(bytea, uuid, jsonb, text), core.trip_cmd_open_checkin(bytea, uuid),
--     core.trip_handover_view(bytea, uuid, text), core.trip_handover_apply(uuid, text, text, text,
--       text, uuid, uuid), core.trip_handover_blockers(uuid), core.trip_handover_lock(uuid),
--     core.trip_handover_party(bytea, uuid) ;
--   DROP TABLE core.trip_ops_key_handover, core.trip_ops_handover_validation,
--     core.trip_ops_identity_check ;
--   DROP POLICY cmd_trip_handover_upd ON core.booking_trip ;
--   DROP POLICY cmd_trip_handover_occ_upd ON core.booking_vehicle_occupancy ;
--   DROP POLICY cmd_trip_handover_guest_occ_upd ON core.booking_guest_occupancy ;
--   ALTER POLICY cmd_hold_inspection_param_read ON core.config_param_value
--     USING (key IN ('photo_max_kb', 'photo_max_px', 'clock_skew_flag_h')) ;
--   REVOKE SELECT (date_of_birth) ON core.iam_user_account FROM cmd_hold_owner.

-- 1. Contrôle du permis à la remise (17 §3.2.2 `trip_identity_check`, classe B) ----------------
-- TRIP_ID_PENDING = aucune ligne ; une ligne écrite est définitive (aucune mise à jour).
CREATE TABLE core.trip_ops_identity_check (
  trip_id           uuid        NOT NULL REFERENCES core.booking_trip (id)
    CONSTRAINT trip_identity_check_pkey PRIMARY KEY,
  country_code      text        NOT NULL
    CONSTRAINT trip_identity_check_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status            text        NOT NULL
    CONSTRAINT trip_identity_check_status_valid CHECK (status IN ('TRIP_ID_OK', 'TRIP_ID_FAILED')),
  -- les six points de VER-015 cochés par l'hôte (booléens seulement, aucune donnée de la pièce)
  checklist         jsonb       NOT NULL
    CONSTRAINT trip_identity_check_checklist_shape CHECK (
      pg_catalog.jsonb_typeof(checklist) = 'object'
      AND checklist ?& ARRAY['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions']
      AND (checklist - ARRAY['face', 'name', 'birthYear', 'valid', 'provisional',
                             'restrictions']::text[]) = '{}'::jsonb
      AND pg_catalog.jsonb_typeof(checklist -> 'face') = 'boolean'
      AND pg_catalog.jsonb_typeof(checklist -> 'name') = 'boolean'
      AND pg_catalog.jsonb_typeof(checklist -> 'birthYear') = 'boolean'
      AND pg_catalog.jsonb_typeof(checklist -> 'valid') = 'boolean'
      AND pg_catalog.jsonb_typeof(checklist -> 'provisional') = 'boolean'
      AND pg_catalog.jsonb_typeof(checklist -> 'restrictions') = 'boolean'),
  failure_subreason text
    CONSTRAINT trip_identity_check_subreason_valid CHECK (failure_subreason IN
      ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT')),
  checked_by        uuid        NOT NULL REFERENCES core.iam_user_account (id),
  checked_at        timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT trip_identity_check_failure_coherent
    CHECK ((status = 'TRIP_ID_FAILED') = (failure_subreason IS NOT NULL))
);
COMMENT ON TABLE core.trip_ops_identity_check IS
  'KYC / TRP trip_identity_check (17 §3.2.2, 16 VER-015) : contrôle du permis présenté, six points '
  'cochés par l''hôte à la remise, sans aucune donnée de la pièce ; TRIP_ID_OK ou TRIP_ID_FAILED, '
  'définitif. Écrit par core.trip_cmd_identity_check seulement. US-315 (ADR-183).';

-- 2. Validation de la remise ou du retour par une partie (classe B, jamais modifiée) -----------
CREATE TABLE core.trip_ops_handover_validation (
  trip_id        uuid        NOT NULL REFERENCES core.booking_trip (id),
  country_code   text        NOT NULL
    CONSTRAINT trip_handover_validation_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  kind           text        NOT NULL
    CONSTRAINT trip_handover_validation_kind_valid CHECK (kind IN ('CHECKIN', 'CHECKOUT')),
  performer_role text        NOT NULL
    CONSTRAINT trip_handover_validation_role_valid CHECK (performer_role IN ('HOST', 'GUEST')),
  performed_by   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  -- relevés de la partie (photos FUEL et ODOMETER de sa série : la preuve)
  odometer_km    integer     NOT NULL
    CONSTRAINT trip_handover_validation_odometer_range CHECK (odometer_km BETWEEN 0 AND 9999999),
  fuel_eighths   smallint    NOT NULL
    CONSTRAINT trip_handover_validation_fuel_range CHECK (fuel_eighths BETWEEN 0 AND 8),
  -- remise en personne seulement (OQ-P2P-05, p2p_contactless_handover_enabled = false)
  method         text        NOT NULL
    CONSTRAINT trip_handover_validation_method_valid CHECK (method = 'IN_PERSON'),
  validated_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT trip_handover_validation_pkey PRIMARY KEY (trip_id, kind, performer_role)
);
COMMENT ON TABLE core.trip_ops_handover_validation IS
  'TRP : validation de la remise (CHECKIN) ou du retour (CHECKOUT) par une partie (hôte ou '
  'voyageur), ses relevés et son heure serveur ; la seconde validation fait la transition SM-1. '
  'Écrite par core.trip_cmd_validate_handover seulement. US-315 (ADR-183).';

-- 3. Clés remises (17 §3.2.10 `key_handover`, classe B) ----------------------------------------
CREATE TABLE core.trip_ops_key_handover (
  id        uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT trip_key_handover_pkey PRIMARY KEY,
  trip_id   uuid        NOT NULL REFERENCES core.booking_trip (id),
  direction text        NOT NULL
    CONSTRAINT trip_key_handover_direction_valid CHECK (direction IN ('OUT', 'IN')),
  -- LOCKBOX (P1) et CONTACTLESS (p2p_contactless_handover_enabled) hors du périmètre de la bêta
  method    text        NOT NULL
    CONSTRAINT trip_key_handover_method_valid CHECK (method = 'IN_PERSON'),
  at        timestamptz NOT NULL,
  by_user   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  CONSTRAINT trip_key_handover_one_per_direction UNIQUE (trip_id, direction)
);
COMMENT ON TABLE core.trip_ops_key_handover IS
  'TRP key_handover (17 §3.2.10) : clés remises en personne, au départ (OUT, par l''hôte) et au '
  'retour (IN, par le voyageur), à l''heure de la transition SM-1. US-315 (ADR-183).';

-- 3.1 Registres en ajout seul : jamais d'UPDATE, de DELETE ni de TRUNCATE
CREATE TRIGGER trip_handover_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_identity_check
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');
CREATE TRIGGER trip_handover_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_handover_validation
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');
CREATE TRIGGER trip_handover_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_key_handover
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');
CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_identity_check
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');
CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_handover_validation
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');
CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_key_handover
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable');

-- 4. RLS : aucun droit applicatif ; commandes sous cmd_hold_owner ------------------------------
ALTER TABLE core.trip_ops_identity_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_identity_check FORCE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_handover_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_handover_validation FORCE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_key_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_key_handover FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.trip_ops_identity_check TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.trip_ops_handover_validation TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.trip_ops_key_handover TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.trip_ops_identity_check, core.trip_ops_handover_validation,
  core.trip_ops_key_handover FROM PUBLIC;

GRANT SELECT, INSERT ON core.trip_ops_identity_check, core.trip_ops_handover_validation,
  core.trip_ops_key_handover TO cmd_hold_owner;
CREATE POLICY cmd_hold_handover_sel ON core.trip_ops_identity_check FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_handover_ins ON core.trip_ops_identity_check FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'HOST' AND checked_by = app.actor_id());
CREATE POLICY cmd_hold_handover_sel ON core.trip_ops_handover_validation FOR SELECT
  TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_handover_ins ON core.trip_ops_handover_validation FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = performer_role AND performed_by = app.actor_id());
CREATE POLICY cmd_hold_handover_sel ON core.trip_ops_key_handover FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_handover_ins ON core.trip_ops_key_handover FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() IN ('HOST', 'GUEST'));

-- 4.1 Transitions de la remise (contexte posé par la commande APRÈS la vérification de la session :
-- actor_kind HOST et org_id du compte d'hôte, ou GUEST et actor_id du voyageur ; comme les demandes
-- de réservation de 0126). Seules les paires de SM-1 passent (table des transitions et journal de
-- la même transaction : garde trip_transition_guard de 0099).
CREATE POLICY cmd_trip_handover_upd ON core.booking_trip FOR UPDATE TO cmd_hold_owner
  USING (status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE')
         AND ((app.actor_kind() = 'HOST' AND org_id = app.org_id())
              OR (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id())))
  WITH CHECK (status IN ('CHECKIN_OPEN', 'IN_PROGRESS', 'RETURNED')
              AND ((app.actor_kind() = 'HOST' AND org_id = app.org_id())
                   OR (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id())));
-- retour : l'occupation du trip RETURNED est libérée par la même commande (I-OCC, 0006)
CREATE POLICY cmd_trip_handover_occ_upd ON core.booking_vehicle_occupancy FOR UPDATE
  TO cmd_hold_owner
  USING (kind = 'TRIP' AND ref_type = 'TRIP' AND active
         AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                      WHERE t.id = booking_vehicle_occupancy.ref_id AND t.status = 'RETURNED'
                        AND ((app.actor_kind() = 'HOST' AND t.org_id = app.org_id())
                             OR (app.actor_kind() = 'GUEST'
                                 AND t.guest_user_id = app.actor_id()))))
  WITH CHECK (kind = 'TRIP' AND ref_type = 'TRIP' AND NOT active
              AND deactivated_reason = 'TRIP_TERMINAL'
              AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                           WHERE t.id = booking_vehicle_occupancy.ref_id AND t.status = 'RETURNED'
                             AND ((app.actor_kind() = 'HOST' AND t.org_id = app.org_id())
                                  OR (app.actor_kind() = 'GUEST'
                                      AND t.guest_user_id = app.actor_id()))));
CREATE POLICY cmd_trip_handover_guest_occ_upd ON core.booking_guest_occupancy FOR UPDATE
  TO cmd_hold_owner
  USING (active
         AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                      WHERE t.id = booking_guest_occupancy.trip_id AND t.status = 'RETURNED'
                        AND ((app.actor_kind() = 'HOST' AND t.org_id = app.org_id())
                             OR (app.actor_kind() = 'GUEST'
                                 AND t.guest_user_id = app.actor_id()))))
  WITH CHECK (NOT active
              AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                           WHERE t.id = booking_guest_occupancy.trip_id AND t.status = 'RETURNED'
                             AND ((app.actor_kind() = 'HOST' AND t.org_id = app.org_id())
                                  OR (app.actor_kind() = 'GUEST'
                                      AND t.guest_user_id = app.actor_id()))));

-- 4.2 Lectures complémentaires de cmd_hold_owner (au plus juste)
-- année de naissance du voyageur servie à l'hôte (UX-37, VER-015) ; jamais la date complète
GRANT SELECT (date_of_birth) ON core.iam_user_account TO cmd_hold_owner;
-- remise sans rencontre : lue, jamais écrite (OQ-P2P-05)
ALTER POLICY cmd_hold_inspection_param_read ON core.config_param_value
  USING (key IN ('photo_max_kb', 'photo_max_px', 'clock_skew_flag_h',
                 'p2p_contactless_handover_enabled'));

-- 5. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 5.1 Partie de la session sur un trip (SECURITY INVOKER, interne) : HOST (titulaire du compte
-- d'hôte du trip) ou GUEST (voyageur du trip) ; aucune ligne pour toute autre personne.
CREATE FUNCTION core.trip_handover_party(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (user_id uuid, role text, trip_id uuid, org_id uuid, guest_user_id uuid,
                 holder_user_id uuid, country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  t      record;
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT tr.id, tr.org_id, tr.guest_user_id, tr.country_code, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v_user, CASE WHEN v_user = t.guest_user_id THEN 'GUEST' ELSE 'HOST' END,
         t.id, t.org_id, t.guest_user_id, t.holder_user_id, t.country_code
   WHERE v_user = t.guest_user_id OR v_user = t.holder_user_id;
END
$fn$;
COMMENT ON FUNCTION core.trip_handover_party(bytea, uuid) IS
  'Interne : partie de la session sur un trip (HOST titulaire du compte d''hôte, GUEST voyageur) ; '
  'rien pour toute autre personne. US-315 (ADR-183).';

-- 5.2 Verrous de la remise : voyageur puis véhicule (ordre global de 17 §2.5, celui de
-- core.booking_trip_lock et de la conversion), consultatifs de transaction. Toute écriture d'état
-- du trip passe par ces deux verrous : deux validations simultanées s'exécutent l'une après
-- l'autre (la seconde voit la première). SECURITY INVOKER, interne.
CREATE FUNCTION core.trip_handover_lock(p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
BEGIN
  SELECT tr.guest_user_id, tr.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
END
$fn$;
COMMENT ON FUNCTION core.trip_handover_lock(uuid) IS
  'Interne : verrous consultatifs du voyageur puis du véhicule du trip (ordre de 17 §2.5). '
  'US-315 (ADR-183).';

-- 5.3 Conditions de la remise relues par la base (L3-PM-08), dans l'ordre d'affichage ; tableau
-- vide = remise possible. Une condition illisible compte comme non remplie (fail-closed).
--   CHECKIN_PAYMENT_NOT_CONFIRMED : aucun AUTH / CAPTURE du loyer SUCCEEDED prouvé par webhook
--     signé sur le hold du trip, ou statut de paiement du trip autre que CONFIRMED ;
--   CONTRACT_NOT_SIGNED : dernière version du contrat non signée par le voyageur (US-211) ;
--   DEPOSIT_NOT_READY : aucune décision de caution, ou caution exigée non autorisée (US-701) ;
--   INSURER_CONTRACT_INACTIVE : `insurer_contract_active[pays]` faux (16 PRT-001) ;
--   HANDOVER_BLOCKED : voyageur non éligible (restriction, consentement, conducteur), conducteur
--     principal non approuvé, hôte restreint ou compte d'hôte inactif (rien de plus n'est dit à
--     l'autre partie). SECURITY INVOKER, interne.
CREATE FUNCTION core.trip_handover_blockers(p_trip_id uuid)
  RETURNS text[]
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t        record;
  v_dep    record;
  v_out    text[] := '{}'::text[];
BEGIN
  SELECT tr.id, tr.source_hold_id, tr.payment_status, tr.country_code, tr.org_id, o.holder_user_id,
         o.status AS org_status
    INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN ARRAY['HANDOVER_BLOCKED'];
  END IF;
  IF t.source_hold_id IS NULL OR t.payment_status IS DISTINCT FROM 'CONFIRMED'
     OR NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS op
                     WHERE op.hold_id = t.source_hold_id AND op.kind IN ('AUTH', 'CAPTURE')
                       AND op.purpose = 'RENT' AND op.status = 'SUCCEEDED'
                       AND op.proof_type = 'WEBHOOK_SIGNED') THEN
    v_out := v_out || 'CHECKIN_PAYMENT_NOT_CONFIRMED'::text;
  END IF;
  IF NOT COALESCE(core.booking_trip_contract_signed(t.id), false) THEN
    v_out := v_out || 'CONTRACT_NOT_SIGNED'::text;
  END IF;
  SELECT d.mechanism, d.status INTO v_dep
    FROM core.payment_deposit_hold AS d WHERE d.hold_id = t.source_hold_id;
  IF v_dep.mechanism IS NULL
     OR (v_dep.mechanism <> 'NOT_REQUIRED' AND v_dep.status IS DISTINCT FROM 'AUTHORIZED') THEN
    v_out := v_out || 'DEPOSIT_NOT_READY'::text;
  END IF;
  IF NOT COALESCE(core.config_go_live('insurer_contract_active', t.country_code), false) THEN
    v_out := v_out || 'INSURER_CONTRACT_INACTIVE'::text;
  END IF;
  IF t.source_hold_id IS NULL
     OR core.booking_guest_eligibility(t.source_hold_id) IS DISTINCT FROM 'ELIGIBLE'
     OR NOT EXISTS (SELECT 1 FROM core.booking_trip_driver AS d
                     WHERE d.trip_id = t.id AND d.role = 'PRIMARY' AND d.approved_at IS NOT NULL)
     OR t.org_status IS DISTINCT FROM 'ACTIVE'
     OR EXISTS (SELECT 1 FROM core.iam_restriction AS r
                 WHERE r.user_id = t.holder_user_id AND r.active) THEN
    v_out := v_out || 'HANDOVER_BLOCKED'::text;
  END IF;
  RETURN v_out;
END
$fn$;
COMMENT ON FUNCTION core.trip_handover_blockers(uuid) IS
  'Interne : conditions de la remise relues par la base (paiement prouvé par webhook signé, '
  'contrat signé, caution, assureur, éligibilité ; fail-closed). US-315 (ADR-183).';

-- 5.4 Transition de la remise sous le contexte de la partie (politiques de 4.1), puis contexte
-- d'origine rétabli. Journal, état, occupations et événement par core.booking_trip_apply_transition
-- (0099, inchangée). SECURITY INVOKER, interne.
CREATE FUNCTION core.trip_handover_apply(p_trip_id uuid, p_from text, p_to text, p_reason text,
                                         p_role text, p_user uuid, p_org uuid)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_kind    text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor   text := pg_catalog.current_setting('app.actor_id', true);
  v_org     text := pg_catalog.current_setting('app.org_id', true);
  v_version integer;
BEGIN
  PERFORM pg_catalog.set_config('app.actor_kind', p_role, true);
  PERFORM pg_catalog.set_config('app.actor_id', p_user::text, true);
  PERFORM pg_catalog.set_config('app.org_id', CASE WHEN p_role = 'HOST' THEN p_org::text ELSE '' END,
                                true);
  v_version := core.booking_trip_apply_transition(p_trip_id, p_from, p_to, p_reason, NULL,
                                                  'SYSTEM', 'TRANSITION', '{}'::jsonb);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  PERFORM pg_catalog.set_config('app.org_id', COALESCE(v_org, ''), true);
  RETURN v_version;
END
$fn$;
COMMENT ON FUNCTION core.trip_handover_apply(uuid, text, text, text, text, uuid, uuid) IS
  'Interne : transition SM-1 de la remise sous le contexte de la partie, contexte rétabli ensuite. '
  'US-315 (ADR-183).';

-- 5.5 Lecture de la remise (`CHECKIN`) ou du retour (`CHECKOUT`) par une partie du trip : état,
-- ouverture, conditions, contrôle du permis, séries de photos, validations, fin. Données de
-- l'autre partie : à l'hôte, au départ seulement, le prénom, l'initiale du nom et l'année de
-- naissance du voyageur ; au voyageur, rien. NOT_FOUND à toute autre personne.
CREATE FUNCTION core.trip_handover_view(p_token_hash bytea, p_trip_id uuid, p_kind text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  p          record;
  t          record;
  g          record;
  ic         record;
  v_other    text;
  v_blockers text[] := '{}'::text[];
  v_opens    timestamptz;
  v_now      timestamptz := platform.now();
  v_done     timestamptz;
  v_contact  boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('CHECKIN', 'CHECKOUT') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_FOUND');
  END IF;
  SELECT * INTO p FROM core.trip_handover_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_FOUND');
  END IF;
  v_other := CASE p.role WHEN 'HOST' THEN 'GUEST' ELSE 'HOST' END;
  SELECT tr.status, tr.timezone, tr.scheduled_start, tr.checkin_validated_at INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p.trip_id;
  IF p_kind = 'CHECKIN' THEN
    v_opens := t.scheduled_start - interval '24 hours';
    IF t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
      v_blockers := core.trip_handover_blockers(p.trip_id);
    END IF;
    v_done := t.checkin_validated_at;
    SELECT c.status, c.checked_at INTO ic
      FROM core.trip_ops_identity_check AS c WHERE c.trip_id = p.trip_id;
    IF p.role = 'HOST' THEN
      SELECT CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END AS first_name,
             CASE WHEN u.pseudonymized_at IS NULL AND u.legal_last_name IS NOT NULL
                  THEN pg_catalog.upper(pg_catalog.left(u.legal_last_name, 1)) END AS last_initial,
             CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
                  THEN pg_catalog.date_part('year', u.date_of_birth)::integer END AS birth_year
        INTO g
        FROM core.iam_user_account AS u WHERE u.id = p.guest_user_id;
    END IF;
  ELSE
    SELECT pg_catalog.min(l.at) INTO v_done
      FROM core.booking_trip_state_log AS l
     WHERE l.trip_id = p.trip_id AND l.to_status = 'RETURNED';
  END IF;
  -- remise sans rencontre : paramètre du pays (absent ou mal formé ⇒ false) ; jamais proposée en
  -- bêta tant que la commande la refuse (CONTACTLESS_UNAVAILABLE)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(pv.value) = 'boolean' THEN (pv.value #>> '{}')::boolean
         END INTO v_contact
    FROM core.config_param_value AS pv
   WHERE pv.key = 'p2p_contactless_handover_enabled' AND pv.country_code::text = p.country_code
     AND pv.scope_type = 'COUNTRY' AND pv.valid_from <= v_now
     AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
   ORDER BY pv.valid_from DESC
   LIMIT 1;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK',
    'viewerRole', p.role,
    'kind', p_kind,
    'tripStatus', t.status,
    'timezone', t.timezone,
    'opensAt', v_opens,
    'open', CASE p_kind WHEN 'CHECKIN' THEN t.status IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED')
                        ELSE t.status IN ('IN_PROGRESS', 'OVERDUE') END,
    'canOpen', p_kind = 'CHECKIN' AND t.status = 'BOOKED' AND v_now >= v_opens
               AND pg_catalog.cardinality(v_blockers) = 0,
    'blockers', pg_catalog.to_jsonb(v_blockers),
    'identityCheck', CASE WHEN p_kind = 'CHECKIN' THEN pg_catalog.jsonb_build_object(
                       'status', CASE ic.status WHEN 'TRIP_ID_OK' THEN 'OK'
                                                WHEN 'TRIP_ID_FAILED' THEN 'FAILED'
                                                ELSE 'PENDING' END,
                       'checkedAt', ic.checked_at) END,
    'guest', CASE WHEN p_kind = 'CHECKIN' AND p.role = 'HOST' THEN pg_catalog.jsonb_build_object(
               'firstName', g.first_name, 'lastInitial', g.last_initial,
               'birthYear', g.birth_year) END,
    'photos', pg_catalog.jsonb_build_object(
      'mine', COALESCE((SELECT i.status FROM core.trip_ops_inspection AS i
                         WHERE i.trip_id = p.trip_id AND i.kind = p_kind
                           AND i.performer_role = p.role), 'NONE'),
      'other', COALESCE((SELECT i.status FROM core.trip_ops_inspection AS i
                          WHERE i.trip_id = p.trip_id AND i.kind = p_kind
                            AND i.performer_role = v_other), 'NONE')),
    'validations', pg_catalog.jsonb_build_object(
      'mine', (SELECT pg_catalog.jsonb_build_object('validatedAt', v.validated_at,
                                                    'odometerKm', v.odometer_km,
                                                    'fuelEighths', v.fuel_eighths)
                 FROM core.trip_ops_handover_validation AS v
                WHERE v.trip_id = p.trip_id AND v.kind = p_kind AND v.performer_role = p.role),
      'other', (SELECT pg_catalog.jsonb_build_object('validatedAt', v.validated_at,
                                                     'odometerKm', v.odometer_km,
                                                     'fuelEighths', v.fuel_eighths)
                  FROM core.trip_ops_handover_validation AS v
                 WHERE v.trip_id = p.trip_id AND v.kind = p_kind
                   AND v.performer_role = v_other)),
    -- hors du périmètre de la bêta (OQ-P2P-05) : jamais proposée, même si le pays l'ouvrait
    'contactlessOffered', COALESCE(v_contact, false) AND false,
    'completedAt', v_done);
END
$fn$;
COMMENT ON FUNCTION core.trip_handover_view(bytea, uuid, text) IS
  'Remise (CHECKIN) ou retour (CHECKOUT) vus par une partie du trip : état, conditions, permis, '
  'photos, validations, heure de fin ; à l''hôte au départ, prénom, initiale et année de naissance '
  'du voyageur seulement ; NOT_FOUND à toute autre personne. SECURITY DEFINER, EXECUTE app_api. '
  'US-315 (ADR-183).';

-- 5.6 Ouverture de la remise par une partie (BOOKED → CHECKIN_OPEN, motif CHECKIN_WINDOW_OPENED) :
-- au plus tôt 24 h avant le début, conditions relues sous les verrous. Issues : DONE (heure),
-- ALREADY_OPEN (heure de l'ouverture), NOT_FOUND, CHECKIN_NOT_OPEN, puis la première condition
-- non remplie (5.3).
CREATE FUNCTION core.trip_cmd_open_checkin(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, opened_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p          record;
  t          record;
  v_blockers text[];
  v_at       timestamptz;
BEGIN
  SELECT * INTO p FROM core.trip_handover_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM core.trip_handover_lock(p.trip_id);
  SELECT tr.status, tr.scheduled_start INTO t FROM core.booking_trip AS tr WHERE tr.id = p.trip_id;
  IF t.status IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    SELECT pg_catalog.min(l.at) INTO v_at FROM core.booking_trip_state_log AS l
     WHERE l.trip_id = p.trip_id AND l.to_status = 'CHECKIN_OPEN';
    RETURN QUERY SELECT 'ALREADY_OPEN'::text, v_at;
    RETURN;
  END IF;
  IF t.status IS DISTINCT FROM 'BOOKED'
     OR platform.now() < t.scheduled_start - interval '24 hours' THEN
    RETURN QUERY SELECT 'CHECKIN_NOT_OPEN'::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_blockers := core.trip_handover_blockers(p.trip_id);
  IF pg_catalog.cardinality(v_blockers) > 0 THEN
    RETURN QUERY SELECT v_blockers[1], NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM core.trip_handover_apply(p.trip_id, 'BOOKED', 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED',
                                   p.role, p.user_id, p.org_id);
  SELECT pg_catalog.min(l.at) INTO v_at FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = p.trip_id AND l.to_status = 'CHECKIN_OPEN';
  RETURN QUERY SELECT 'DONE'::text, v_at;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_open_checkin(bytea, uuid) IS
  'Ouverture de la remise par une partie du trip (BOOKED → CHECKIN_OPEN), au plus tôt 24 h avant '
  'le début, conditions relues sous les verrous du voyageur puis du véhicule. SECURITY DEFINER, '
  'EXECUTE app_api. US-315 (ADR-183).';

-- 5.7 Contrôle du permis par l'hôte (VER-015), trip CHECKIN_OPEN ou START_WINDOW_EXPIRED : les six
-- points, booléens ; tous cochés ⇒ TRIP_ID_OK ; un point non conforme ⇒ TRIP_ID_FAILED avec un motif
-- de la liste (INVALID_LICENSE par défaut). Issues : DONE (statut, heure), ALREADY_CHECKED (le
-- contrôle d'origine, inchangé), NOT_FOUND, HOST_ONLY, CHECKIN_NOT_OPEN,
-- CHECKIN_LICENSE_CHECK_INCOMPLETE (forme), REQUEST_INVALID (motif).
CREATE FUNCTION core.trip_cmd_identity_check(p_token_hash bytea, p_trip_id uuid, p_checklist jsonb,
                                             p_subreason text)
  RETURNS TABLE (outcome text, status text, checked_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p        record;
  c        record;
  v_status text;
  v_reason text;
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
  v_at     timestamptz := platform.now();
BEGIN
  SELECT * INTO p FROM core.trip_handover_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p.role <> 'HOST' THEN
    RETURN QUERY SELECT 'HOST_ONLY'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM core.trip_handover_lock(p.trip_id);
  SELECT x.status, x.checked_at INTO c
    FROM core.trip_ops_identity_check AS x WHERE x.trip_id = p.trip_id;
  IF c.status IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_CHECKED'::text, c.status, c.checked_at;
    RETURN;
  END IF;
  IF (SELECT tr.status FROM core.booking_trip AS tr WHERE tr.id = p.trip_id)
       NOT IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN QUERY SELECT 'CHECKIN_NOT_OPEN'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_checklist IS NULL OR pg_catalog.jsonb_typeof(p_checklist) IS DISTINCT FROM 'object'
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_checklist)) <> 6
     OR NOT (p_checklist ?& ARRAY['face', 'name', 'birthYear', 'valid', 'provisional',
                                  'restrictions'])
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_checklist) AS e
                 WHERE pg_catalog.jsonb_typeof(e.value) <> 'boolean') THEN
    RETURN QUERY SELECT 'CHECKIN_LICENSE_CHECK_INCOMPLETE'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_checklist) AS e
                  WHERE e.value = 'false'::jsonb) THEN
    IF p_subreason IS NOT NULL THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::timestamptz;
      RETURN;
    END IF;
    v_status := 'TRIP_ID_OK';
  ELSE
    v_reason := COALESCE(p_subreason, 'INVALID_LICENSE');
    IF v_reason NOT IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT') THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::timestamptz;
      RETURN;
    END IF;
    v_status := 'TRIP_ID_FAILED';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  INSERT INTO core.trip_ops_identity_check (trip_id, country_code, status, checklist,
                                            failure_subreason, checked_by, checked_at)
  VALUES (p.trip_id, p.country_code, v_status, p_checklist, v_reason, p.user_id, v_at);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN QUERY SELECT 'DONE'::text, v_status, v_at;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_identity_check(bytea, uuid, jsonb, text) IS
  'Contrôle du permis à la remise par l''hôte (VER-015) : six points cochés, TRIP_ID_OK ou '
  'TRIP_ID_FAILED définitif ; aucune donnée de la pièce. SECURITY DEFINER, EXECUTE app_api. '
  'US-315 (ADR-183).';

-- 5.8 Validation de la remise (CHECKIN) ou du retour (CHECKOUT) par une partie : relevés, remise en
-- personne, sa série validée, conditions (départ) ; la SECONDE validation fait la transition SM-1,
-- à l'heure serveur, et enregistre les clés remises. Ordre des contrôles (documenté, ADR-183) :
-- partie, verrous (voyageur puis véhicule), validation existante (idempotence), mode, fenêtre,
-- relevés, série, conditions (départ), permis (départ), écriture, transition.
-- Issues : DONE (heure de la validation, heure de fin si la transition a eu lieu, statut),
-- ALREADY_VALIDATED (heures d'origine), NOT_FOUND, CONTACTLESS_UNAVAILABLE, REQUEST_INVALID,
-- CHECKIN_NOT_OPEN, CHECKOUT_NOT_OPEN, READING_INVALID, CHECKIN_STEP_INCOMPLETE,
-- CHECKOUT_STEP_INCOMPLETE, CHECKIN_LICENSE_CHECK_INCOMPLETE, IDENTITY_CHECK_FAILED, puis la
-- première condition non remplie (5.3).
CREATE FUNCTION core.trip_cmd_validate_handover(p_token_hash bytea, p_trip_id uuid, p_kind text,
                                                p_odometer_km integer, p_fuel_eighths integer,
                                                p_method text)
  RETURNS TABLE (outcome text, validated_at timestamptz, completed_at timestamptz,
                 trip_status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p          record;
  t          record;
  mine       record;
  v_other    text;
  v_blockers text[];
  v_id       text;
  v_out      integer;
  v_to       text;
  v_done     timestamptz;
  v_kind     text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor    text := pg_catalog.current_setting('app.actor_id', true);
  v_now      timestamptz := platform.now();
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('CHECKIN', 'CHECKOUT') THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO p FROM core.trip_handover_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  v_other := CASE p.role WHEN 'HOST' THEN 'GUEST' ELSE 'HOST' END;
  PERFORM core.trip_handover_lock(p.trip_id);
  SELECT tr.status, tr.checkin_validated_at INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p.trip_id;
  -- idempotence : la validation d'origine, et l'heure de fin si la transition a eu lieu
  SELECT v.validated_at INTO mine
    FROM core.trip_ops_handover_validation AS v
   WHERE v.trip_id = p.trip_id AND v.kind = p_kind AND v.performer_role = p.role;
  IF mine.validated_at IS NOT NULL THEN
    IF p_kind = 'CHECKIN' THEN
      v_done := t.checkin_validated_at;
    ELSE
      SELECT pg_catalog.min(l.at) INTO v_done FROM core.booking_trip_state_log AS l
       WHERE l.trip_id = p.trip_id AND l.to_status = 'RETURNED';
    END IF;
    RETURN QUERY SELECT 'ALREADY_VALIDATED'::text, mine.validated_at, v_done, t.status;
    RETURN;
  END IF;
  -- remise en personne seulement (OQ-P2P-05) : la remise sans rencontre n'est jamais acceptée
  IF p_method IS DISTINCT FROM 'IN_PERSON' THEN
    RETURN QUERY SELECT CASE WHEN p_method = 'CONTACTLESS' THEN 'CONTACTLESS_UNAVAILABLE'
                             ELSE 'REQUEST_INVALID' END,
                        NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF p_kind = 'CHECKIN' AND t.status NOT IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN QUERY SELECT 'CHECKIN_NOT_OPEN'::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF p_kind = 'CHECKOUT' AND t.status NOT IN ('IN_PROGRESS', 'OVERDUE') THEN
    RETURN QUERY SELECT 'CHECKOUT_NOT_OPEN'::text, NULL::timestamptz, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  -- relevés : bornes ; au retour, compteur au moins égal à celui que la partie a relevé au départ
  IF p_odometer_km IS NULL OR p_odometer_km < 0 OR p_odometer_km > 9999999
     OR p_fuel_eighths IS NULL OR p_fuel_eighths < 0 OR p_fuel_eighths > 8
     OR (p_kind = 'CHECKOUT' AND EXISTS (
           SELECT 1 FROM core.trip_ops_handover_validation AS v
            WHERE v.trip_id = p.trip_id AND v.kind = 'CHECKIN' AND v.performer_role = p.role
              AND v.odometer_km > p_odometer_km)) THEN
    RETURN QUERY SELECT 'READING_INVALID'::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- sa propre série validée (US-303 : une série SUBMITTED ne reçoit plus aucune photo)
  IF NOT EXISTS (SELECT 1 FROM core.trip_ops_inspection AS i
                  WHERE i.trip_id = p.trip_id AND i.kind = p_kind AND i.performer_role = p.role
                    AND i.status = 'SUBMITTED') THEN
    RETURN QUERY SELECT CASE p_kind WHEN 'CHECKIN' THEN 'CHECKIN_STEP_INCOMPLETE'
                                    ELSE 'CHECKOUT_STEP_INCOMPLETE' END,
                        NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF p_kind = 'CHECKIN' THEN
    v_blockers := core.trip_handover_blockers(p.trip_id);
    IF pg_catalog.cardinality(v_blockers) > 0 THEN
      RETURN QUERY SELECT v_blockers[1], NULL::timestamptz, NULL::timestamptz, NULL::text;
      RETURN;
    END IF;
    SELECT c.status INTO v_id FROM core.trip_ops_identity_check AS c WHERE c.trip_id = p.trip_id;
    IF v_id = 'TRIP_ID_FAILED' THEN
      RETURN QUERY SELECT 'IDENTITY_CHECK_FAILED'::text, NULL::timestamptz, NULL::timestamptz,
                          NULL::text;
      RETURN;
    END IF;
    IF p.role = 'HOST' AND v_id IS DISTINCT FROM 'TRIP_ID_OK' THEN
      RETURN QUERY SELECT 'CHECKIN_LICENSE_CHECK_INCOMPLETE'::text, NULL::timestamptz,
                          NULL::timestamptz, NULL::text;
      RETURN;
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.actor_kind', p.role, true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  INSERT INTO core.trip_ops_handover_validation (trip_id, country_code, kind, performer_role,
                                                 performed_by, odometer_km, fuel_eighths, method,
                                                 validated_at)
  VALUES (p.trip_id, p.country_code, p_kind, p.role, p.user_id, p_odometer_km,
          p_fuel_eighths::smallint, 'IN_PERSON', v_now);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);

  -- seconde validation : les deux séries validées, le permis conforme (départ), puis la transition
  IF NOT EXISTS (SELECT 1 FROM core.trip_ops_handover_validation AS v
                  WHERE v.trip_id = p.trip_id AND v.kind = p_kind
                    AND v.performer_role = v_other) THEN
    RETURN QUERY SELECT 'DONE'::text, v_now, NULL::timestamptz, t.status;
    RETURN;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.trip_ops_inspection AS i
       WHERE i.trip_id = p.trip_id AND i.kind = p_kind AND i.status = 'SUBMITTED') <> 2
     OR (p_kind = 'CHECKIN' AND v_id IS DISTINCT FROM 'TRIP_ID_OK') THEN
    RAISE EXCEPTION 'trip handover: second validation without both series or a passed check'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_handover_incoherent';
  END IF;
  v_to := CASE p_kind WHEN 'CHECKIN' THEN 'IN_PROGRESS' ELSE 'RETURNED' END;
  v_out := core.trip_handover_apply(p.trip_id, t.status, v_to,
                                    CASE p_kind WHEN 'CHECKIN' THEN 'CHECKIN_VALIDATED'
                                                ELSE 'CHECKOUT_VALIDATED' END,
                                    p.role, p.user_id, p.org_id);
  IF p_kind = 'CHECKIN' THEN
    SELECT tr.checkin_validated_at INTO v_done FROM core.booking_trip AS tr WHERE tr.id = p.trip_id;
  ELSE
    SELECT pg_catalog.min(l.at) INTO v_done FROM core.booking_trip_state_log AS l
     WHERE l.trip_id = p.trip_id AND l.to_status = 'RETURNED';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', p.role, true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  INSERT INTO core.trip_ops_key_handover (trip_id, direction, method, at, by_user)
  VALUES (p.trip_id, CASE p_kind WHEN 'CHECKIN' THEN 'OUT' ELSE 'IN' END, 'IN_PERSON', v_done,
          CASE p_kind WHEN 'CHECKIN' THEN p.holder_user_id ELSE p.guest_user_id END);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN QUERY SELECT 'DONE'::text, v_now, v_done, v_to;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_validate_handover(bytea, uuid, text, integer, integer, text) IS
  'Validation de la remise ou du retour par une partie du trip (relevés, en personne, sa série '
  'validée, conditions et permis au départ) ; la seconde validation fait la transition SM-1 '
  '(IN_PROGRESS ou RETURNED) à l''heure serveur, sous les verrous du voyageur puis du véhicule, et '
  'enregistre les clés remises. SECURITY DEFINER, EXECUTE app_api. US-315 (ADR-183).';

REVOKE ALL ON FUNCTION core.trip_handover_party(bytea, uuid), core.trip_handover_lock(uuid),
  core.trip_handover_blockers(uuid),
  core.trip_handover_apply(uuid, text, text, text, text, uuid, uuid),
  core.trip_handover_view(bytea, uuid, text), core.trip_cmd_open_checkin(bytea, uuid),
  core.trip_cmd_identity_check(bytea, uuid, jsonb, text),
  core.trip_cmd_validate_handover(bytea, uuid, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trip_handover_view(bytea, uuid, text),
  core.trip_cmd_open_checkin(bytea, uuid), core.trip_cmd_identity_check(bytea, uuid, jsonb, text),
  core.trip_cmd_validate_handover(bytea, uuid, text, integer, integer, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
