-- 0173 — TRP / SUP : escalade de non-restitution lancée par l'ops et vue des retards (bêta).
-- US-306 ; 19 US-306 (« Given un trip qui passe OVERDUE, When la vue est ouverte, Then il apparaît en
-- ≤ 1 min avec son étape » ; « Given une escalade, When l'ops lance ESCALATE_OVERDUE, Then l'étape,
-- le motif et les gabarits produits (mise en demeure, plainte pré-remplie à déposer par l'hôte) sont
-- journalisés et l'hôte est informé ») ; 16 TRP-038 (Bêta pilote SIMPLIFIÉ : étapes horodatées,
-- gabarits préparés par l'ops et remis à l'hôte), ADM-022 (liste des trips en retard, étape, sans
-- carte GPS), EC-20 ; 08 BR-RETURN-04 (T+2 h contact, T+6 h mise en demeure, T+24 h plainte par
-- l'hôte), BR-DAMAGE-10 ; 17 §3.2.10 (`overdue_case.stage` T30M, T2H, T6H, T24H, RESOLVED), §4.5
-- (`trip.overdue.escalated` : trip_id, stage), §7.2 (`overdue_escalation_hours` +2 h, +6 h, +24 h,
-- décidé), §10 (action de console `ESCALATE_OVERDUE`) ; 22 OQ-BR-17 (défaut : aucune récupération
-- ni coupure par la plateforme) ; pré-mortem du lot 3 : L3-PM-17, L3-PM-28 ; ADR-092 (cadre des
-- actions), ADR-122 / ADR-177 (séparation des tâches), ADR-188 (dossier de retard, US-305) ; ADR-193
-- (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-193, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - l'escalade est une ACTION DE CONSOLE (`ESCALATE_OVERDUE`, permission ops.force_terminate_trip,
--     OPS_AGENT et ADMIN dans le pays du trip, session élevée par TOTP, garde de séparation des
--     tâches d'ADR-122 / ADR-177 : jamais un trip dont l'agent est partie ou lié) ; sa commande
--     liée `core.trip_manual_action_escalate_overdue` (cmd_hold_owner, EXECUTE iam_staff_owner) :
--       * saisie fermée `escalationStep` ∈ {CONTACT, FORMAL_NOTICE, POLICE_REPORT} (étapes T2H, T6H,
--         T24H du dossier ; mots seulement, jamais un chiffre ni un montant) ; absente ⇒ refus ;
--       * verrous du voyageur puis du véhicule (ordre global de 17 §2.5, celui du travailleur
--         trip_overdue), heure SERVEUR lue après eux ; seul un trip OVERDUE dont le dossier existe ;
--       * UNE étape à la fois, dans l'ordre : l'étape demandée doit être la suivante du dossier
--         (sinon OVERDUE_STEP_OUT_OF_ORDER : une escalade déjà faite ne se rejoue jamais, même par
--         une seconde connexion ou un autre agent) et son heure atteinte (fin prévue +
--         `overdue_escalation_hours` du pays ; sinon OVERDUE_STEP_TOO_EARLY ; paramètre absent ou
--         mal formé ⇒ PARAM_MISSING, aucune heure devinée) ;
--       * effets, dans la même transaction que `manual_action` et l'audit de la console (qui portent
--         le MOTIF de l'agent) : étape du dossier avancée, ligne d'escalade
--         `trip_ops_overdue_escalation` (étape, gabarits produits, heure) et UN événement
--         `trip.overdue.escalated` (hôte prévenu par NTF, gabarits dans l'e-mail) ;
--   - gabarits PRODUITS = codes fermés de l'étape : CONTACT ⇒ CONTACT_SCRIPT ; FORMAL_NOTICE ⇒
--     DEMAND_LETTER (au nom de l'hôte) et GPS_REQUEST ; POLICE_REPORT ⇒ POLICE_REPORT_DRAFT (plainte
--     pré-remplie À DÉPOSER PAR L'HÔTE). Textes en es / en / fr / pt-BR dans @rueda/i18n, remplis
--     de la référence du trip et de la fin prévue seulement (aucune donnée du voyageur : son
--     identité figure au contrat de location que l'hôte détient ; minimisation, ADR-193) ;
--   - la plateforme ne dépose AUCUNE plainte, ne coupe ni ne récupère AUCUN véhicule (OQ-BR-17) :
--     aucune écriture sur le véhicule, l'occupation, un interrupteur ni l'argent ; le versement de
--     l'hôte n'est pas bloqué (16 TRP-038) ;
--   - le trip RESTE `OVERDUE` (SM-1) à l'étape T24H : le passage `UNRETURNED` est renvoyé à US-318
--     (vol et non-restitution), avec le retour, l'inspection et le rendez-vous d'un trip UNRETURNED
--     qu'aucune commande n'accepte encore (0158, 0163, 0166) : un état qui bloquerait le retour du
--     véhicule n'est jamais posé (fail-closed pour l'hôte, ADR-193) ; la prolongation tacite
--     d'US-305 continue (statut inchangé) ;
--   - vue des retards (16 ADM-022, « vue overdue_board ») : `core.support_staff_overdue_board`
--     (iam_staff_owner, EXECUTE app_api) : session élevée, pays où l'agent détient
--     ops.force_terminate_trip seulement (aucune fuite entre pays), trips dont il est partie ou lié
--     écartés (ADR-122) AVANT la limite de 500 lignes, troncature signalée (`truncated`) ; lignes lues EN DIRECT (aucun cache) : un trip passé OVERDUE par le
--     travailleur (60 s) y figure à la lecture suivante, avec son étape. Aucune donnée personnelle
--     rendue (identifiants techniques, étapes, heures) : les contacts passent par la fiche 360°,
--     journalisée (minimisation) ;
--   - aucune constante de pays : heures d'escalade lues du paramètre du pays, pays de la portée
--     de l'agent lus dans config ; aucun interrupteur lu ni écrit.
--
-- Écarts PROPOSÉS à 17 (ADR-193) : `escalation(trip_id, step, at, by, documents[])` de 16 TRP-038
-- devient la table `trip_ops_overdue_escalation` (l'agent et le motif restent dans
-- `support_manual_action`, que la ligne désigne par son identifiant) plutôt que `overdue_case.actions
-- jsonb` ; `trip.overdue.escalated` porte aussi `host_user_id`, `documents`, `scheduled_end` et
-- `escalated_at` (contrat NTF) ; `UNRETURNED` renvoyé à US-318 (ci-dessus).
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   trip_overdue_case_immutable (23000)       → IMMUTABLE_RECORD (étape reculée, sautée, ou avancée
--                                               hors de la console) ;
--   trip_overdue_escalation_immutable (23000) → IMMUTABLE_RECORD (réécriture ou suppression) ;
--   trip_overdue_escalation_unique (23505)    → INVARIANT_VIOLATION (une étape par trip, en défense).
--
-- Expand / contract : une table, des fonctions, des droits et des politiques AJOUTÉS ; la garde du
-- dossier (0168) est remplacée à signature identique et n'admet qu'une avance d'étape de plus ; la
-- politique cmd_hold_overdue_param_read (0168) lit en plus `overdue_escalation_hours` ; l'action
-- ESCALATE_OVERDUE (0060, indisponible jusqu'ici, aucune ligne manual_action n'en dépend) reçoit sa
-- clé de saisie et sa commande liée. Rien de retiré.
--
-- Retour arrière (base sans escalade) :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'ESCALATE_OVERDUE' ;
--   UPDATE core.support_manual_action_catalog SET input_keys = '{}', input_values = '{}'
--     WHERE action_code = 'ESCALATE_OVERDUE' ;
--   DROP FUNCTION core.support_staff_overdue_board(bytea, uuid),
--     core.trip_overdue_board(text[]),
--     core.trip_manual_action_escalate_overdue(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.trip_overdue_escalation_hours(text) ;
--   DROP TABLE core.trip_ops_overdue_escalation ; DROP FUNCTION core.trip_overdue_escalation_guard() ;
--   réappliquer core.trip_overdue_case_guard() de 0168 ;
--   ALTER POLICY cmd_hold_overdue_param_read ON core.config_param_value
--     USING (key IN ('overdue_detection_minutes', 'overdue_occupancy_step_minutes')) ;
--   DROP POLICY cmd_hold_overdue_staff_sel, cmd_hold_overdue_staff_upd
--     ON core.trip_ops_overdue_case ;
--   DROP POLICY cmd_trip_escalation_event_ins ON core.outbox_outbox_event ;
--   REVOKE UPDATE (stage) ON core.trip_ops_overdue_case FROM cmd_hold_owner ;
--   REVOKE SELECT, INSERT ON core.trip_ops_overdue_escalation FROM cmd_hold_owner (table supprimée).

-- 1. Dossier de retard : l'étape avance d'UN cran, par la console seulement -----------------------
-- Définition de 0168 recopiée ; seul le bloc de l'étape change (US-306) : T30M → T2H → T6H → T24H,
-- jamais reculée ni sautée, et seulement sous le contexte STAFF (la commande liée de la console) ;
-- RESOLVED reste fermé (aucun écrivain). migrator exempté (propriétaire, L0-05).
CREATE OR REPLACE FUNCTION core.trip_overdue_case_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user = 'migrator' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end
     OR NEW.detection_minutes IS DISTINCT FROM OLD.detection_minutes
     OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
     -- US-306 : étape suivante seulement, par la commande liée de la console (contexte STAFF)
     OR (NEW.stage IS DISTINCT FROM OLD.stage
         AND (app.actor_kind() IS DISTINCT FROM 'STAFF'
              OR NEW.stage IS DISTINCT FROM CASE OLD.stage WHEN 'T30M' THEN 'T2H'
                                                           WHEN 'T2H' THEN 'T6H'
                                                           WHEN 'T6H' THEN 'T24H' END))
     OR (OLD.next_trip_id IS NOT NULL AND NEW.next_trip_id IS DISTINCT FROM OLD.next_trip_id)
     OR NEW.use_until < OLD.use_until OR NEW.occupancy_until < OLD.occupancy_until THEN
    RAISE EXCEPTION 'overdue case: frozen facts are immutable'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_overdue_case_immutable';
  END IF;
  RETURN NEW;
END
$fn$;

-- 2. Escalades (16 TRP-038 « escalation(trip_id, step, at, by, documents[]) », classe B) ----------
-- Une ligne par étape franchie ; `id` = identifiant de l'action de console (`support_manual_action`,
-- qui porte l'agent, son rôle, le pays et le MOTIF, écrite par la console après cette commande dans
-- la même transaction : aucune clé étrangère possible, la ligne est jointe par l'identifiant).
-- Aucune donnée personnelle : ni l'agent, ni le motif, ni une donnée du voyageur.
CREATE TABLE core.trip_ops_overdue_escalation (
  id             uuid        NOT NULL
    CONSTRAINT trip_overdue_escalation_pkey PRIMARY KEY,
  case_id        uuid        NOT NULL REFERENCES core.trip_ops_overdue_case (id),
  trip_id        uuid        NOT NULL REFERENCES core.booking_trip (id),
  country_code   text        NOT NULL
    CONSTRAINT trip_overdue_escalation_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  from_stage     text        NOT NULL
    CONSTRAINT trip_overdue_escalation_from_valid CHECK (from_stage IN ('T30M', 'T2H', 'T6H')),
  stage          text        NOT NULL
    CONSTRAINT trip_overdue_escalation_stage_valid CHECK (stage IN ('T2H', 'T6H', 'T24H')),
  -- gabarits produits à cette étape (codes fermés ; textes dans @rueda/i18n, remis à l'hôte)
  documents      text[]      NOT NULL
    CONSTRAINT trip_overdue_escalation_documents_valid CHECK (
          pg_catalog.cardinality(documents) BETWEEN 1 AND 4
      AND pg_catalog.array_position(documents, NULL) IS NULL
      AND documents <@ ARRAY['CONTACT_SCRIPT', 'DEMAND_LETTER', 'GPS_REQUEST',
                             'POLICE_REPORT_DRAFT']::text[]),
  escalated_at   timestamptz NOT NULL,
  -- heure à partir de laquelle l'étape était permise (fin prévue + heures du pays), figée
  due_at         timestamptz NOT NULL,
  event_id       uuid        NOT NULL,
  CONSTRAINT trip_overdue_escalation_unique UNIQUE (trip_id, stage),
  CONSTRAINT trip_overdue_escalation_order CHECK (
    (from_stage, stage) IN (('T30M', 'T2H'), ('T2H', 'T6H'), ('T6H', 'T24H'))),
  CONSTRAINT trip_overdue_escalation_after_due CHECK (escalated_at >= due_at)
);
CREATE INDEX trip_overdue_escalation_case_idx ON core.trip_ops_overdue_escalation (case_id);
COMMENT ON TABLE core.trip_ops_overdue_escalation IS
  'TRP escalation (16 TRP-038, ADM-022) : une ligne par étape de non-restitution franchie par '
  'l''ops (T2H, T6H, T24H), gabarits produits, heure serveur ; id = action de console (agent et '
  'motif dans support_manual_action). Écrite par core.trip_manual_action_escalate_overdue '
  'seulement ; jamais réécrite ni supprimée. US-306 (ADR-193).';

CREATE FUNCTION core.trip_overdue_escalation_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user = 'migrator' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'overdue escalation: append-only'
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'trip_overdue_escalation_immutable';
END
$fn$;
CREATE TRIGGER trip_overdue_escalation_guard
  BEFORE UPDATE OR DELETE ON core.trip_ops_overdue_escalation
  FOR EACH ROW EXECUTE FUNCTION core.trip_overdue_escalation_guard();
REVOKE ALL ON FUNCTION core.trip_overdue_escalation_guard() FROM PUBLIC;

ALTER TABLE core.trip_ops_overdue_escalation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_overdue_escalation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.trip_ops_overdue_escalation TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.trip_ops_overdue_escalation FROM PUBLIC;

-- 3. Droits et politiques de cmd_hold_owner (au plus juste) ---------------------------------------
-- Escalades : écrites et lues sous le contexte STAFF (commande liée et vue de la console) seulement
GRANT SELECT, INSERT ON core.trip_ops_overdue_escalation TO cmd_hold_owner;
CREATE POLICY cmd_hold_escalation_sel ON core.trip_ops_overdue_escalation FOR SELECT
  TO cmd_hold_owner
  USING (app.actor_kind() = 'STAFF');
CREATE POLICY cmd_hold_escalation_ins ON core.trip_ops_overdue_escalation FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'STAFF');

-- Dossier : lu et avancé d'une étape sous le contexte STAFF (la garde juge l'ordre)
GRANT UPDATE (stage) ON core.trip_ops_overdue_case TO cmd_hold_owner;
CREATE POLICY cmd_hold_overdue_staff_sel ON core.trip_ops_overdue_case FOR SELECT TO cmd_hold_owner
  USING (app.actor_kind() = 'STAFF');
CREATE POLICY cmd_hold_overdue_staff_upd ON core.trip_ops_overdue_case FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'STAFF' AND stage IN ('T30M', 'T2H', 'T6H'))
  WITH CHECK (app.actor_kind() = 'STAFF' AND stage IN ('T2H', 'T6H', 'T24H'));

-- Événement de l'escalade (17 §4.5) : attribué à l'agent de la session (OPS_AGENT ou ADMIN)
CREATE POLICY cmd_trip_escalation_event_ins ON core.outbox_outbox_event FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'trip' AND type = 'trip.overdue.escalated'
              AND actor_role IN ('OPS_AGENT', 'ADMIN')
              AND app.actor_kind() = 'STAFF' AND actor_user_id = app.actor_id());

-- Paramètre lu : heures d'escalade du pays (17 §7.2, décidé), en plus de ceux d'US-305
ALTER POLICY cmd_hold_overdue_param_read ON core.config_param_value
  USING (key IN ('overdue_detection_minutes', 'overdue_occupancy_step_minutes',
                 'overdue_escalation_hours'));

-- 4. Catalogue : saisie fermée de l'étape (mots seulement ; jamais un montant) ---------------------
UPDATE core.support_manual_action_catalog
   SET input_keys = '{escalationStep}',
       input_values = '{"escalationStep": ["CONTACT", "FORMAL_NOTICE", "POLICE_REPORT"]}'::jsonb
 WHERE action_code = 'ESCALATE_OVERDUE';

-- 5. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 5.1 Heures d'escalade en vigueur du pays (`overdue_escalation_hours`, JSON [h1, h2, h3]) : trois
-- entiers strictement croissants entre 1 et 720 ; sinon NULL et l'appelant refuse (PARAM_MISSING).
-- SECURITY INVOKER, interne.
CREATE FUNCTION core.trip_overdue_escalation_hours(p_country text)
  RETURNS integer[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_value jsonb;
  v_hours integer[];
BEGIN
  SELECT v.value INTO v_value
    FROM core.config_param_value AS v
   WHERE v.key = 'overdue_escalation_hours'
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= platform.now()
     AND (v.valid_to IS NULL OR v.valid_to > platform.now())
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_value IS NULL OR pg_catalog.jsonb_typeof(v_value) <> 'array'
     OR pg_catalog.jsonb_array_length(v_value) <> 3
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_value) AS e(x)
                 WHERE pg_catalog.jsonb_typeof(e.x) <> 'number'
                    OR (e.x #>> '{}') !~ '^[0-9]{1,3}$') THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.array_agg((e.x #>> '{}')::integer ORDER BY e.n)
    INTO v_hours
    FROM pg_catalog.jsonb_array_elements(v_value) WITH ORDINALITY AS e(x, n);
  IF v_hours[1] < 1 OR v_hours[2] <= v_hours[1] OR v_hours[3] <= v_hours[2]
     OR v_hours[3] > 720 THEN
    RETURN NULL;
  END IF;
  RETURN v_hours;
END
$fn$;
COMMENT ON FUNCTION core.trip_overdue_escalation_hours(text) IS
  'Interne : heures d''escalade du pays (overdue_escalation_hours, trois entiers croissants) ; '
  'NULL si absentes ou mal formées. US-306 (ADR-193).';

-- 5.2 Commande liée à ESCALATE_OVERDUE (signature imposée par le cadre d'US-101). Contrôles d'accès
-- faits AVANT l'appel par core.iam_staff_cmd_manual_action (session TOTP, permission
-- ops.force_terminate_trip dans le pays du trip, saisie fermée, garde ADR-122, idempotence par
-- request_id). Rien n'est écrit sur un refus.
CREATE FUNCTION core.trip_manual_action_escalate_overdue(p_token_hash bytea, p_action_id uuid,
                                                          p_action_code text, p_subject_id uuid,
                                                          p_input jsonb, p_reason text,
                                                          p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_step    text;
  v_target  text;
  v_t       record;
  v_holder  uuid;
  c         record;
  v_next    text;
  v_hours   integer[];
  v_due     timestamptz;
  v_now     timestamptz;
  v_docs    text[];
  v_event   uuid;
BEGIN
  IF p_action_code IS DISTINCT FROM 'ESCALATE_OVERDUE'
     OR p_action_id IS NULL OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_reason IS NULL OR p_input IS NULL
     OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'escalade : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- étape demandée (énumération fermée déjà contrôlée par la console) → étape du dossier
  v_step := p_input ->> 'escalationStep';
  IF v_step IS NULL THEN
    RETURN QUERY SELECT 'OVERDUE_STEP_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_target := CASE v_step WHEN 'CONTACT' THEN 'T2H'
                          WHEN 'FORMAL_NOTICE' THEN 'T6H'
                          WHEN 'POLICE_REPORT' THEN 'T24H' END;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'escalade : étape inconnue' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT tr.id, tr.guest_user_id, tr.vehicle_id, tr.org_id INTO v_t
    FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = v_t.org_id;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122, comptes liés compris)
  IF v_t.guest_user_id = p_actor OR v_holder = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- même ordre de verrous que la détection des retards et les commandes du trip (17 §2.5) :
  -- voyageur, puis véhicule (tous les écrivains du dossier les prennent : le travailleur
  -- trip_overdue et cette commande) ; l'état et le dossier sont relus ensuite, puis l'heure serveur
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guest:' || v_t.guest_user_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('veh:' || v_t.vehicle_id::text, 0));
  SELECT tr.id, tr.status, tr.country_code, tr.scheduled_end, tr.row_version INTO v_t
    FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;
  IF v_t.status IS DISTINCT FROM 'OVERDUE' THEN
    RETURN QUERY SELECT 'TRIP_NOT_OVERDUE'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  SELECT oc.id, oc.stage, oc.scheduled_end INTO c
    FROM core.trip_ops_overdue_case AS oc WHERE oc.trip_id = v_t.id;
  IF c.id IS NULL THEN
    RETURN QUERY SELECT 'OVERDUE_CASE_MISSING'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_now := platform.now();
  -- une étape à la fois, dans l'ordre : une étape déjà franchie ne se rejoue jamais
  v_next := CASE c.stage WHEN 'T30M' THEN 'T2H' WHEN 'T2H' THEN 'T6H' WHEN 'T6H' THEN 'T24H' END;
  IF v_next IS DISTINCT FROM v_target THEN
    RETURN QUERY SELECT 'OVERDUE_STEP_OUT_OF_ORDER'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_hours := core.trip_overdue_escalation_hours(v_t.country_code);
  IF v_hours IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- heure de l'étape : fin prévue (figée au dossier) + heures du pays (BR-RETURN-04, EC-20)
  v_due := c.scheduled_end + pg_catalog.make_interval(hours => v_hours[
             CASE v_target WHEN 'T2H' THEN 1 WHEN 'T6H' THEN 2 ELSE 3 END]);
  IF v_now < v_due THEN
    RETURN QUERY SELECT 'OVERDUE_STEP_TOO_EARLY'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_docs := CASE v_target WHEN 'T2H' THEN ARRAY['CONTACT_SCRIPT']
                          WHEN 'T6H' THEN ARRAY['DEMAND_LETTER', 'GPS_REQUEST']
                          ELSE ARRAY['POLICE_REPORT_DRAFT'] END;

  UPDATE core.trip_ops_overdue_case SET stage = v_target WHERE id = c.id;
  -- l'hôte (titulaire du compte d'hôte) est prévenu par NTF ; aucune donnée du voyageur.
  -- Identifiant posé ici (UUID v7, 17 §4.1, comme 0119) : cmd_hold_owner ne relit pas l'outbox
  v_event := platform.uuid_v7();
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES (v_event, 'trip.overdue.escalated', 1, 'trip', v_t.id, v_t.row_version,
          v_t.country_code, p_actor, p_actor_role, p_action_id, p_action_id,
          pg_catalog.jsonb_build_object('trip_id', v_t.id, 'stage', v_target,
                                        'host_user_id', v_holder,
                                        'documents', pg_catalog.to_jsonb(v_docs),
                                        'scheduled_end', c.scheduled_end,
                                        'escalated_at', v_now),
          v_t.id::text);
  INSERT INTO core.trip_ops_overdue_escalation (id, case_id, trip_id, country_code, from_stage,
                                                stage, documents, escalated_at, due_at, event_id)
  VALUES (p_action_id, c.id, v_t.id, v_t.country_code, c.stage, v_target, v_docs, v_now, v_due,
          v_event);
  RETURN QUERY SELECT 'DONE'::text, p_action_id, ARRAY[v_event];
END
$fn$;
COMMENT ON FUNCTION core.trip_manual_action_escalate_overdue(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à ESCALATE_OVERDUE (cadre d''US-101) : étape suivante du dossier de retard '
  '(CONTACT T2H, FORMAL_NOTICE T6H, POLICE_REPORT T24H), une à la fois, à fin prévue + '
  'overdue_escalation_hours du pays (heure serveur après les verrous du voyageur puis du '
  'véhicule) ; ligne d''escalade, gabarits produits et trip.overdue.escalated (hôte prévenu) ; '
  'aucune action sur le véhicule, aucun montant. EXECUTE iam_staff_owner. US-306 (ADR-193).';

-- 5.3 Lignes de la vue des retards pour des pays donnés (appelée par la vue de la console après
-- les contrôles d'accès). Trips OVERDUE / UNRETURNED du pays, dossier, étape, prochaine étape et son
-- heure, escalades. Identifiants techniques, codes et heures seulement. Contexte STAFF exigé.
CREATE FUNCTION core.trip_overdue_board(p_countries text[])
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' OR p_countries IS NULL
     OR pg_catalog.array_position(p_countries, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'overdue board: forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(r.item ORDER BY r.scheduled_end, r.id)
      FROM (
        SELECT t.id, t.scheduled_end,
               pg_catalog.jsonb_build_object(
                 'tripId', t.id,
                 'country', t.country_code,
                 'status', t.status,
                 'stage', c.stage,
                 'scheduledEnd', t.scheduled_end,
                 'detectedAt', c.detected_at,
                 'lateMinutes', GREATEST(0, pg_catalog.floor(
                   EXTRACT(EPOCH FROM (v_now - t.scheduled_end)) / 60)::bigint),
                 'nextStep', CASE c.stage WHEN 'T30M' THEN 'CONTACT'
                                          WHEN 'T2H' THEN 'FORMAL_NOTICE'
                                          WHEN 'T6H' THEN 'POLICE_REPORT' END,
                 'nextStepAt', CASE WHEN h.hours IS NULL OR c.id IS NULL THEN NULL
                                    ELSE c.scheduled_end + pg_catalog.make_interval(hours =>
                                      h.hours[CASE c.stage WHEN 'T30M' THEN 1
                                                           WHEN 'T2H' THEN 2
                                                           WHEN 'T6H' THEN 3 END]) END,
                 'paramMissing', h.hours IS NULL,
                 'nextTripAtRisk', c.next_trip_id IS NOT NULL,
                 'escalations', COALESCE((
                   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'stage', e.stage, 'escalatedAt', e.escalated_at,
                            'documents', pg_catalog.to_jsonb(e.documents))
                            ORDER BY e.escalated_at, e.id)
                     FROM core.trip_ops_overdue_escalation AS e
                    WHERE e.trip_id = t.id), '[]'::jsonb)) AS item
          FROM core.booking_trip AS t
          LEFT JOIN core.trip_ops_overdue_case AS c ON c.trip_id = t.id
          CROSS JOIN LATERAL (
            SELECT core.trip_overdue_escalation_hours(t.country_code) AS hours) AS h
         WHERE t.status IN ('OVERDUE', 'UNRETURNED')
           AND t.country_code = ANY (p_countries)
         ORDER BY t.scheduled_end, t.id
         -- plafond technique (la vue filtre puis limite à 500 et signale la troncature)
         LIMIT 5000) AS r), '[]'::jsonb);
END
$fn$;
COMMENT ON FUNCTION core.trip_overdue_board(text[]) IS
  'Interne à la vue des retards (16 ADM-022) : trips OVERDUE / UNRETURNED des pays donnés, étape, '
  'prochaine étape et son heure, escalades ; aucune donnée personnelle. SECURITY DEFINER, EXECUTE '
  'iam_staff_owner. US-306 (ADR-193).';

REVOKE ALL ON FUNCTION core.trip_overdue_escalation_hours(text),
  core.trip_manual_action_escalate_overdue(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.trip_overdue_board(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.trip_manual_action_escalate_overdue(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.trip_overdue_board(text[])
  TO iam_staff_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 6. Liaison de l'action (garde d'ADR-092 à l'INSERT : signature, SECURITY DEFINER, propriétaire
-- NOLOGIN autre qu'iam_staff_owner, EXECUTE à iam_staff_owner et à aucun rôle applicatif)
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('ESCALATE_OVERDUE',
        'core.trip_manual_action_escalate_overdue(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-306');

-- 7. Vue des retards de la console (famille iam_staff_owner, EXECUTE app_api) ---------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Issues : AUTH_REQUIRED (non journalisé), MFA_REQUIRED et FORBIDDEN (journalisés), OK. Pays de la
-- vue : ceux où l'agent détient ops.force_terminate_trip (rôle EN COURS, portée pays) ; aucun ⇒
-- FORBIDDEN. Trips qui concernent l'agent (partie ou compte lié) écartés (ADR-122). Lecture sans
-- donnée personnelle : non inscrite au journal des accès (comme 0130).
CREATE FUNCTION core.support_staff_overdue_board(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s         record;
  v_countries text[];
  v_rows      jsonb;
  v_all       jsonb;
  v_kept      integer;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'vue des retards : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'READ', 'permission', 'ops.force_terminate_trip',
                                   'field_or_file', 'overdue_board'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT pg_catalog.array_agg(cc.code::text ORDER BY cc.code) INTO v_countries
    FROM core.config_country AS cc
   WHERE core.iam_staff_permitted(v_s.user_id, 'ops.force_terminate_trip', ARRAY[cc.code::text],
                                  NULL) IS NOT NULL;
  IF v_countries IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', 'READ', 'permission', 'ops.force_terminate_trip',
                                   'field_or_file', 'overdue_board'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- séparation des tâches D'ABORD (ADR-122), puis la limite de 500 : un trip écarté ne prend
  -- jamais la place d'un autre ; la troncature est signalée (`truncated`), jamais silencieuse
  v_all := core.trip_overdue_board(v_countries);
  SELECT COALESCE(pg_catalog.jsonb_agg(k.item ORDER BY k.n) FILTER (WHERE k.rn <= 500),
                  '[]'::jsonb),
         pg_catalog.count(*)
    INTO v_rows, v_kept
    FROM (SELECT x.item, x.n, pg_catalog.row_number() OVER (ORDER BY x.n) AS rn
            FROM pg_catalog.jsonb_array_elements(v_all) WITH ORDINALITY AS x(item, n)
           WHERE NOT core.support_actor_conflict(v_s.user_id, 'TRIP',
                                                 (x.item ->> 'tripId')::uuid)) AS k;
  RETURN QUERY SELECT 'OK'::text,
                      pg_catalog.jsonb_build_object('countries', pg_catalog.to_jsonb(v_countries),
                                                    'readAt', platform.now(),
                                                    'truncated',
                                                      v_kept > 500
                                                      OR pg_catalog.jsonb_array_length(v_all) >= 5000,
                                                    'trips', v_rows);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_overdue_board(bytea, uuid) IS
  'Console : vue des retards (16 ADM-022) : trips OVERDUE / UNRETURNED des pays où l''agent '
  'détient ops.force_terminate_trip, étape d''escalade, prochaine étape et son heure ; trips qui '
  'concernent l''agent écartés (ADR-122) ; refus journalisés ; aucune donnée personnelle rendue. '
  'EXECUTE app_api. US-306 (ADR-193).';
REVOKE ALL ON FUNCTION core.support_staff_overdue_board(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_overdue_board(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
