-- 0166 — MSG : messagerie hôte–voyageur, confidentialité, rendez-vous et rétention.
-- US-316 ; 19 US-316 (critère 1 : « chaque partie voit le prénom de l'autre et jamais son
-- téléphone, son e-mail, son numéro de permis ni l'image d'une pièce » ; critère 2 : « hôte B ⇒ 0
-- ligne ; un co-hôte de portée V1 ne lit pas les fils de V2 (RLS-9) » ; critère 3 : « messages dans
-- le dossier de preuve avec leur horodatage serveur ; à l'échéance de rétention, purgés selon
-- US-111 » ; critère 4 : « proposition de rendez-vous de l'hôte acceptée par le voyageur ⇒ lieu et
-- heure rattachés au trip et repris dans les notifications du trip ») ; 16 MSG-001, MSG-007,
-- LEG-009 ; 17 §2.3 (`host_guest_v`, RLS-9), §3.1.3, §3.2.12, §4.5 ; 22 OQ-BR-25 (défaut : la
-- durée la plus courte) ; pré-mortem du lot 3 : L3-PM-06, L3-PM-45, L3-PM-46, L3-PM-49, L3-PM-50 ;
-- ADR-181 (US-525, 0161 : fils par trip, masquage, texte reçu gardé comme preuve, règle
-- TRIP_MESSAGES) ; ADR-118 (US-111, 0090 : travailleur privacy_request, gel légal) ; ADR-186 (cette
-- migration, PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-186, PROPOSÉS, comme Turo) :
--   1. Confidentialité (critères 1 et 2) : RIEN de nouveau n'est servi d'une partie à l'autre. Les
--      lectures restent celles de 0161 (prénom = premier mot du prénom légal ; texte masqué) et la
--      lecture des rendez-vous ci-dessous ne rend que des codes, un lieu dont les coordonnées sont
--      REFUSÉES à la saisie, et des heures. Aucune pièce jointe : la messagerie de la bêta est en
--      texte seul (aucune colonne, aucun objet, aucun bucket), donc aucune métadonnée de photo
--      servie (L3-PM-06) ; une photo jointe (10b S16) viendra par le bucket privé et la copie sans
--      EXIF d'US-303.
--   2. Rendez-vous (critère 4) : `core.messaging_meeting_proposal`, une proposition de l'hôte
--      (titulaire ou co-hôte de portée) pour la REMISE (PICKUP) ou le RETOUR (RETURN) : lieu (3 à 160
--      caractères, sans coordonnées : téléphone, courriel, identifiant ou lien ⇒ refus
--      MEETING_PLACE_CONTACT, « jamais bloquer, sauf coordonnées », L3-PM-49) et heure (dans le
--      futur ; remise entre le début du trip − 1 jour et sa fin ; retour entre son début et sa fin
--      + 1 jour). Une nouvelle proposition remplace (SUPERSEDED) celle en attente du même sens.
--      Le voyageur l'accepte ou la refuse ; acceptée, elle EST le rendez-vous du trip pour ce sens
--      (un seul ACCEPTED par trip et par sens ; l'ancien passe SUPERSEDED) et l'événement
--      `trip.meeting.confirmed` (trip_id, meeting_id, kind, meet_at : JAMAIS le lieu) part vers NTF,
--      qui avise les deux parties avec l'heure ; le lieu se lit dans l'appli (aperçu sans contenu,
--      L3-PM-45 ; aucun lieu dans l'archive des notifications, L3-PM-50). Remise : trip BOOKED ou
--      CHECKIN_OPEN ; retour : BOOKED, CHECKIN_OPEN, IN_PROGRESS ou OVERDUE ; sinon
--      MEETING_NOT_ALLOWED. Mêmes parties et même IDOR que 0161 (`core.messaging_party`) : toute
--      autre personne ⇒ NOT_FOUND.
--   3. Rétention (critère 3, L3-PM-50) : `core.privacy_worker_message_purge`, appelée par le
--      travailleur privacy_request (US-111) : à l'échéance `evidence_retention_months` du pays
--      (plancher de 15 mois, comme 0090) depuis la DERNIÈRE activité du trip (fin prévue, mise à
--      jour, opération monétaire, dernier message, dernière proposition), le texte reçu ET le texte
--      servi des messages et le lieu des rendez-vous sont effacés (NULL, `purged_at`) ; une ligne au
--      journal `audit_retention_log` (règle TRIP_MESSAGES, une fois). JAMAIS pendant un litige : trip
--      hors des statuts clos (IN_DISPUTE compris), rétrofacturation ou incident inscrits, dossier de
--      support OUVERT ou EN ATTENTE sur le trip (réclamation), demande d'une partie bloquée par une
--      obligation légale (fail-closed). Le reste (auteurs, heures serveur, statuts, signaux par
--      codes) demeure : preuve qu'un échange a eu lieu, sans son contenu. Le dossier de preuve
--      (US-308) lit le texte reçu tant qu'il n'est pas purgé.
--
-- Issues rendues (jamais levées) :
--   lecture des rendez-vous : DONE (une ligne d'en-tête si aucun, sinon une par proposition),
--     AUTH_REQUIRED, NOT_FOUND ;
--   proposition : DONE (enregistrée, ou rejouée avec le même identifiant), AUTH_REQUIRED,
--     NOT_FOUND, MEETING_NOT_ALLOWED, MEETING_INVALID, MEETING_PLACE_CONTACT, REQUEST_INVALID ;
--   réponse : DONE (ou rejouée), AUTH_REQUIRED, NOT_FOUND, MEETING_NOT_ALLOWED,
--     MEETING_NOT_PENDING, MEETING_EXPIRED, REQUEST_INVALID.
--
-- Expand / contract : une colonne NULL ajoutée et deux NOT NULL relâchés sur `messaging_message`
-- (la version N lit `body_masked` par `messaging_thread_read`, qui rend déjà NULL pour un message
-- masqué : un message purgé est servi comme un message masqué) ; une contrainte de forme ajoutée
-- (lignes existantes : purged_at NULL, textes présents) ; garde de 0161 remplacée à signature et
-- propriétaire identiques (définition recopiée, bloc US-316 marqué) ; une table ; droits de
-- colonnes et politiques ajoutés ; une ligne de référence mise à jour (règle TRIP_MESSAGES : son
-- travailleur) ; quatre fonctions ajoutées ; aucune fonction existante d'API remplacée.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.privacy_worker_message_purge(integer),
--     core.messaging_cmd_answer_meeting(bytea, uuid, uuid, text),
--     core.messaging_cmd_propose_meeting(bytea, uuid, uuid, text, text, timestamptz),
--     core.messaging_meeting_read(bytea, uuid) ;
--   DROP POLICY messaging_cmd_meeting_event ON core.outbox_outbox_event ;
--   DROP POLICY privacy_cmd_read ON core.messaging_message_thread ;
--   DROP POLICY privacy_cmd_read, privacy_cmd_purge ON core.messaging_message ;
--   DROP TABLE core.messaging_meeting_proposal ; DROP FUNCTION core.messaging_meeting_guard() ;
--   REVOKE des droits de colonnes ajoutés (booking_trip, support_support_case, outbox) ;
--   UPDATE core.audit_retention_rule SET enforced_by = 'MANUAL',
--     tables = '{core.messaging_message}' WHERE code = 'TRIP_MESSAGES' ;
--   recréer core.messaging_record_guard() de 0161 ;
--   ALTER TABLE core.messaging_message DROP CONSTRAINT messaging_message_purge_shape,
--     DROP COLUMN purged_at ; (SET NOT NULL de body et body_masked seulement sans ligne purgée).

-- 1. Purge des messages : colonne et forme (17 §3.1.3 : la purge efface le contenu, garde la ligne)
ALTER TABLE core.messaging_message ADD COLUMN purged_at timestamptz;
ALTER TABLE core.messaging_message ALTER COLUMN body DROP NOT NULL;
ALTER TABLE core.messaging_message ALTER COLUMN body_masked DROP NOT NULL;
ALTER TABLE core.messaging_message ADD CONSTRAINT messaging_message_purge_shape CHECK (
  (purged_at IS NULL AND body IS NOT NULL AND body_masked IS NOT NULL)
  OR (purged_at IS NOT NULL AND body IS NULL AND body_masked IS NULL AND purged_at >= sent_at));
COMMENT ON COLUMN core.messaging_message.purged_at IS
  'Instant de la purge du texte (règle TRIP_MESSAGES, OQ-BR-25) : texte reçu et texte servi '
  'effacés, la ligne (auteur, heure serveur, statut) demeure. US-316 (ADR-186).';

-- 2. Garde de 0161, recopiée ; bloc US-316 : purge (une fois, textes effacés, rien d'autre)
CREATE OR REPLACE FUNCTION core.messaging_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- conditions imbriquées : chaque table n'évalue que ses propres colonnes (fonction compilée par
  -- table de déclencheur)
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'messaging_message' THEN
      IF OLD.hidden_at IS NULL AND NEW.hidden_at IS NOT NULL
         AND (NEW.id, NEW.thread_id, NEW.author_user_id, NEW.author_role, NEW.body,
              NEW.body_masked, NEW.channel_origin, NEW.status, NEW.sent_at, NEW.purged_at)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.thread_id, OLD.author_user_id, OLD.author_role, OLD.body,
              OLD.body_masked, OLD.channel_origin, OLD.status, OLD.sent_at, OLD.purged_at) THEN
        RETURN NEW;
      END IF;
      -- US-316 (ADR-186) : purge à l'échéance TRIP_MESSAGES, une seule fois ; seuls les deux
      -- textes deviennent NULL ; auteur, heure, statut et masquage inchangés
      IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
         AND NEW.body IS NULL AND NEW.body_masked IS NULL
         AND (NEW.id, NEW.thread_id, NEW.author_user_id, NEW.author_role, NEW.channel_origin,
              NEW.status, NEW.sent_at, NEW.hidden_at)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.thread_id, OLD.author_user_id, OLD.author_role, OLD.channel_origin,
              OLD.status, OLD.sent_at, OLD.hidden_at) THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'messaging_message_flag' THEN
      IF OLD.outcome IS NULL AND NEW.outcome IS NOT NULL
         AND (NEW.id, NEW.message_id, NEW.kind, NEW.matched, NEW.review_item_id, NEW.created_at)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.message_id, OLD.kind, OLD.matched, OLD.review_item_id, OLD.created_at)
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'messagerie : % refusé sur % (preuve, jamais supprimée)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'messaging_record_guarded';
END
$fn$;
REVOKE ALL ON FUNCTION core.messaging_record_guard() FROM PUBLIC;

-- 3. Rendez-vous du trip (critère 4) -----------------------------------------------------------------
CREATE TABLE core.messaging_meeting_proposal (
  id            uuid        PRIMARY KEY,
  trip_id       uuid        NOT NULL REFERENCES core.booking_trip (id),
  kind          text        NOT NULL
    CONSTRAINT messaging_meeting_kind_valid CHECK (kind IN ('PICKUP', 'RETURN')),
  proposed_by   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  proposer_role text        NOT NULL
    CONSTRAINT messaging_meeting_proposer_valid CHECK (proposer_role IN ('HOST', 'CO_HOST')),
  -- [C2] lieu convenu, sans coordonnées (refusées à la saisie) ; effacé à l'échéance TRIP_MESSAGES
  place_label   text
    CONSTRAINT messaging_meeting_place_length
      CHECK (pg_catalog.char_length(place_label) BETWEEN 3 AND 160),
  meet_at       timestamptz NOT NULL,
  status        text        NOT NULL
    CONSTRAINT messaging_meeting_status_valid
      CHECK (status IN ('PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED')),
  answered_by   uuid        REFERENCES core.iam_user_account (id),
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  purged_at     timestamptz,
  CONSTRAINT messaging_meeting_answer_shape CHECK (
    (answered_by IS NULL) = (answered_at IS NULL)
    AND (status <> 'PROPOSED' OR answered_by IS NULL)
    AND (status NOT IN ('ACCEPTED', 'DECLINED') OR answered_by IS NOT NULL)),
  CONSTRAINT messaging_meeting_answer_after CHECK (answered_at IS NULL OR answered_at >= created_at),
  CONSTRAINT messaging_meeting_purge_shape CHECK (
    (purged_at IS NULL AND place_label IS NOT NULL)
    OR (purged_at IS NOT NULL AND place_label IS NULL AND purged_at >= created_at))
);
-- une proposition en attente et un rendez-vous accepté au plus, par trip et par sens
CREATE UNIQUE INDEX messaging_meeting_one_pending ON core.messaging_meeting_proposal (trip_id, kind)
  WHERE status = 'PROPOSED';
CREATE UNIQUE INDEX messaging_meeting_one_accepted ON core.messaging_meeting_proposal (trip_id, kind)
  WHERE status = 'ACCEPTED';
CREATE INDEX messaging_meeting_trip_idx ON core.messaging_meeting_proposal (trip_id, created_at, id);
COMMENT ON TABLE core.messaging_meeting_proposal IS
  'MSG : proposition de rendez-vous de l''hôte (remise ou retour : lieu sans coordonnées, heure), '
  'acceptée ou refusée par le voyageur ; ACCEPTED = rendez-vous du trip pour ce sens. Jamais '
  'supprimée ; lieu purgé à l''échéance TRIP_MESSAGES. US-316 (ADR-186).';
COMMENT ON COLUMN core.messaging_meeting_proposal.place_label IS
  'Lieu convenu [C2], sans téléphone, courriel, identifiant ni lien (refusés à la saisie) ; servi '
  'aux seules parties du trip, jamais dans une notification ; NULL après la purge (purged_at).';

-- Garde : ni suppression ni TRUNCATE ; transitions fermées ; purge du lieu une fois
CREATE FUNCTION core.messaging_meeting_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.trip_id, NEW.kind, NEW.proposed_by, NEW.proposer_role, NEW.meet_at,
          NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.trip_id, OLD.kind, OLD.proposed_by, OLD.proposer_role, OLD.meet_at,
          OLD.created_at) THEN
    -- réponse du voyageur : PROPOSED → ACCEPTED ou DECLINED, réponse posée une fois
    IF OLD.status = 'PROPOSED' AND NEW.status IN ('ACCEPTED', 'DECLINED')
       AND OLD.answered_by IS NULL AND NEW.answered_by IS NOT NULL
       AND (NEW.place_label, NEW.purged_at) IS NOT DISTINCT FROM (OLD.place_label, OLD.purged_at)
    THEN
      RETURN NEW;
    END IF;
    -- remplacement : en attente ou accepté → SUPERSEDED, réponse inchangée
    IF OLD.status IN ('PROPOSED', 'ACCEPTED') AND NEW.status = 'SUPERSEDED'
       AND (NEW.answered_by, NEW.answered_at, NEW.place_label, NEW.purged_at)
           IS NOT DISTINCT FROM (OLD.answered_by, OLD.answered_at, OLD.place_label, OLD.purged_at)
    THEN
      RETURN NEW;
    END IF;
    -- purge (TRIP_MESSAGES) : lieu effacé une fois, rien d'autre
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NEW.place_label IS NULL
       AND (NEW.status, NEW.answered_by, NEW.answered_at)
           IS NOT DISTINCT FROM (OLD.status, OLD.answered_by, OLD.answered_at) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'messagerie : % refusé sur % (rendez-vous, jamais supprimé)', TG_OP,
    TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'messaging_meeting_guarded';
END
$fn$;
REVOKE ALL ON FUNCTION core.messaging_meeting_guard() FROM PUBLIC;
CREATE TRIGGER messaging_meeting_proposal_guard
  BEFORE UPDATE OR DELETE ON core.messaging_meeting_proposal
  FOR EACH ROW EXECUTE FUNCTION core.messaging_meeting_guard();
CREATE TRIGGER messaging_meeting_proposal_no_truncate BEFORE TRUNCATE ON core.messaging_meeting_proposal
  FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_meeting_guard();

ALTER TABLE core.messaging_meeting_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_meeting_proposal FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.messaging_meeting_proposal FROM PUBLIC;
CREATE POLICY migrator_all ON core.messaging_meeting_proposal TO migrator
  USING (true) WITH CHECK (true);

-- 4. Règle de rétention TRIP_MESSAGES : appliquée par le travailleur privacy_request (US-111) ;
--    le lieu des rendez-vous suit la même durée
UPDATE core.audit_retention_rule
   SET enforced_by = 'WORKER:privacy_request',
       tables = '{core.messaging_message,core.messaging_meeting_proposal}'
 WHERE code = 'TRIP_MESSAGES';

-- 5. Droits au plus juste ---------------------------------------------------------------------------
-- 5.1 messaging_cmd_owner (0161) : début et statut du trip (bornes du rendez-vous) ; rendez-vous ;
--     événement trip.meeting.confirmed (acteur : le voyageur de la session)
GRANT SELECT (scheduled_start, status) ON core.booking_trip TO messaging_cmd_owner;
GRANT SELECT, INSERT ON core.messaging_meeting_proposal TO messaging_cmd_owner;
GRANT UPDATE (status, answered_by, answered_at) ON core.messaging_meeting_proposal
  TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_sel ON core.messaging_meeting_proposal FOR SELECT
  TO messaging_cmd_owner USING (true);
CREATE POLICY messaging_cmd_ins ON core.messaging_meeting_proposal FOR INSERT
  TO messaging_cmd_owner WITH CHECK (status = 'PROPOSED' AND purged_at IS NULL);
CREATE POLICY messaging_cmd_upd ON core.messaging_meeting_proposal FOR UPDATE
  TO messaging_cmd_owner USING (purged_at IS NULL)
  WITH CHECK (status IN ('ACCEPTED', 'DECLINED', 'SUPERSEDED'));
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, payload, partition_key)
  ON core.outbox_outbox_event TO messaging_cmd_owner;
-- identifiant de l'événement (défaut de la colonne id)
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_meeting_event ON core.outbox_outbox_event FOR INSERT
  TO messaging_cmd_owner
  WITH CHECK (type = 'trip.meeting.confirmed' AND aggregate_type = 'trip'
              AND actor_role = 'GUEST' AND actor_user_id IS NOT NULL);

-- 5.2 privacy_cmd_owner (0090) : purge des textes et des lieux ; dossiers de support du trip
--     (réclamation ouverte ⇒ purge suspendue)
GRANT SELECT (trip_id, status) ON core.support_support_case TO privacy_cmd_owner;
GRANT SELECT (id, trip_id) ON core.messaging_message_thread TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.messaging_message_thread FOR SELECT TO privacy_cmd_owner
  USING (true);
GRANT SELECT (id, thread_id, author_user_id, sent_at, purged_at) ON core.messaging_message
  TO privacy_cmd_owner;
GRANT UPDATE (body, body_masked, purged_at) ON core.messaging_message TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.messaging_message FOR SELECT TO privacy_cmd_owner
  USING (true);
CREATE POLICY privacy_cmd_purge ON core.messaging_message FOR UPDATE TO privacy_cmd_owner
  USING (purged_at IS NULL) WITH CHECK (purged_at IS NOT NULL);
GRANT SELECT (id, trip_id, created_at, answered_at, purged_at)
  ON core.messaging_meeting_proposal TO privacy_cmd_owner;
GRANT UPDATE (place_label, purged_at) ON core.messaging_meeting_proposal TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.messaging_meeting_proposal FOR SELECT
  TO privacy_cmd_owner USING (true);
CREATE POLICY privacy_cmd_purge ON core.messaging_meeting_proposal FOR UPDATE
  TO privacy_cmd_owner USING (purged_at IS NULL) WITH CHECK (purged_at IS NOT NULL);

-- 6. Fonctions de la messagerie (propriétaire messaging_cmd_owner, comme 0161) ------------------------
GRANT CREATE ON SCHEMA core TO messaging_cmd_owner;
SET LOCAL ROLE messaging_cmd_owner;

-- 6.1 Rendez-vous d'un trip pour une partie du trip de la session : en-tête (rôle, proposition
-- possible, fuseau du trip) répété sur chaque ligne ; propositions en attente, acceptées et
-- refusées (les remplacées et les purgées ne sont pas rendues), de la plus ancienne à la plus
-- récente, 20 au plus. Codes, lieu sans coordonnées et heures seulement : aucun nom, aucun contact.
CREATE FUNCTION core.messaging_meeting_read(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, viewer_role text, can_propose boolean, timezone text,
                 meeting_id uuid, kind text, place_label text, meet_at timestamptz, status text,
                 mine boolean, created_at timestamptz, answered_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_party  record;
  v_status text;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::boolean, NULL::text, NULL::uuid,
                        NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::boolean, NULL::text, NULL::uuid,
                        NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_party FROM core.messaging_party(v_user, p_trip_id);
  IF v_party.role IS NULL THEN
    -- trip d'une autre personne, inconnu, co-hôte hors portée ou révoqué : même issue
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::boolean, NULL::text, NULL::uuid,
                        NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT t.status INTO v_status FROM core.booking_trip AS t WHERE t.id = p_trip_id;

  RETURN QUERY
  SELECT 'DONE'::text, v_party.role,
         (v_party.role IN ('HOST', 'CO_HOST')
          AND v_status IN ('BOOKED', 'CHECKIN_OPEN', 'IN_PROGRESS', 'OVERDUE')),
         v_party.timezone, m.id, m.kind, m.place_label, m.meet_at, m.status, m.mine,
         m.created_at, m.answered_at
    FROM (SELECT 1) AS head
    LEFT JOIN LATERAL (
      SELECT x.*
        FROM (
          SELECT p.id, p.kind, p.place_label, p.meet_at, p.status,
                 (p.proposed_by = v_user OR p.answered_by IS NOT DISTINCT FROM v_user) AS mine,
                 p.created_at,
                 p.answered_at
            FROM core.messaging_meeting_proposal AS p
           WHERE p.trip_id = p_trip_id AND p.purged_at IS NULL
             AND p.status IN ('PROPOSED', 'ACCEPTED', 'DECLINED')
           ORDER BY p.created_at DESC, p.id DESC
           LIMIT 20) AS x) AS m ON true
   ORDER BY m.created_at, m.id;
END
$fn$;
COMMENT ON FUNCTION core.messaging_meeting_read(bytea, uuid) IS
  'Rendez-vous d''un trip (remise, retour) pour une partie du trip de la session : en attente, '
  'acceptés, refusés ; lieu sans coordonnées et heures ; trip d''une autre personne ou inconnu : '
  'NOT_FOUND. SECURITY DEFINER, EXECUTE app_api. US-316 (ADR-186).';
REVOKE ALL ON FUNCTION core.messaging_meeting_read(bytea, uuid) FROM PUBLIC;

-- 6.2 Proposition de l'hôte (titulaire ou co-hôte de portée). Identifiant choisi par le client
-- (réessai sans doublon : même identifiant, même auteur, même trip ⇒ la proposition enregistrée).
CREATE FUNCTION core.messaging_cmd_propose_meeting(p_token_hash bytea, p_trip_id uuid,
                                                   p_meeting_id uuid, p_kind text, p_place text,
                                                   p_meet_at timestamptz)
  RETURNS TABLE (outcome text, meeting_id uuid, kind text, place_label text, meet_at timestamptz,
                 status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_party record;
  v_trip  record;
  v_now   timestamptz := platform.now();
  v_place text := pg_catalog.btrim(p_place, E' \t\r\n');
  v_mask  record;
  v_old   record;
BEGIN
  IF p_trip_id IS NULL OR p_meeting_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_party FROM core.messaging_party(v_user, p_trip_id);
  IF v_party.role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- rendez-vous du trip sérialisés (verrou consultatif de transaction, par trip) : deux
  -- propositions ou deux réponses concurrentes se suivent, la seconde lit l'état de la première
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('messaging_meeting:' || p_trip_id::text, 0));
  -- réessai : la même proposition (même auteur, même trip) est rendue telle qu'enregistrée ;
  -- un identifiant déjà pris ailleurs est refusé
  SELECT p.id, p.trip_id, p.proposed_by, p.kind, p.place_label, p.meet_at, p.status INTO v_old
    FROM core.messaging_meeting_proposal AS p WHERE p.id = p_meeting_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.proposed_by IS DISTINCT FROM v_user OR v_old.trip_id IS DISTINCT FROM p_trip_id THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text,
                          NULL::timestamptz, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'DONE'::text, v_old.id, v_old.kind, v_old.place_label, v_old.meet_at,
                        v_old.status;
    RETURN;
  END IF;
  -- seul l'hôte (titulaire ou co-hôte de portée) propose
  IF v_party.role NOT IN ('HOST', 'CO_HOST') THEN
    RETURN QUERY SELECT 'MEETING_NOT_ALLOWED'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('PICKUP', 'RETURN') OR p_meet_at IS NULL
     OR v_place IS NULL OR pg_catalog.char_length(v_place) < 3
     OR pg_catalog.char_length(v_place) > 160 THEN
    RETURN QUERY SELECT 'MEETING_INVALID'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- statut et bornes du trip, relus sous le verrou des rendez-vous
  SELECT t.status, t.scheduled_start, t.scheduled_end INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF (p_kind = 'PICKUP' AND v_trip.status NOT IN ('BOOKED', 'CHECKIN_OPEN'))
     OR (p_kind = 'RETURN'
         AND v_trip.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'IN_PROGRESS', 'OVERDUE')) THEN
    RETURN QUERY SELECT 'MEETING_NOT_ALLOWED'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- heure : dans le futur ; remise entre début − 1 jour et fin ; retour entre début et fin + 1 jour
  IF p_meet_at <= v_now
     OR (p_kind = 'PICKUP' AND (p_meet_at < v_trip.scheduled_start - interval '1 day'
                                OR p_meet_at > v_trip.scheduled_end))
     OR (p_kind = 'RETURN' AND (p_meet_at < v_trip.scheduled_start
                                OR p_meet_at > v_trip.scheduled_end + interval '1 day')) THEN
    RETURN QUERY SELECT 'MEETING_INVALID'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- lieu : aucune coordonnée (téléphone, courriel, identifiant, lien : même détection que les
  -- messages, 0161) ; refus et non masquage (un lieu masqué ne servirait à rien)
  SELECT * INTO v_mask FROM core.messaging_mask_contacts(v_place);
  IF v_mask.kinds IS NULL OR pg_catalog.cardinality(v_mask.kinds) > 0 THEN
    RETURN QUERY SELECT 'MEETING_PLACE_CONTACT'::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- la proposition en attente du même sens est remplacée
  UPDATE core.messaging_meeting_proposal AS p
     SET status = 'SUPERSEDED'
   WHERE p.trip_id = p_trip_id AND p.kind = p_kind AND p.status = 'PROPOSED';
  INSERT INTO core.messaging_meeting_proposal (id, trip_id, kind, proposed_by, proposer_role,
                                               place_label, meet_at, status, created_at)
  VALUES (p_meeting_id, p_trip_id, p_kind, v_user, v_party.role, v_place, p_meet_at, 'PROPOSED',
          v_now);
  RETURN QUERY SELECT 'DONE'::text, p_meeting_id, p_kind, v_place, p_meet_at, 'PROPOSED'::text;
END
$fn$;
COMMENT ON FUNCTION core.messaging_cmd_propose_meeting(bytea, uuid, uuid, text, text, timestamptz)
  IS
  'Proposition de rendez-vous (remise ou retour) par l''hôte du trip de la session : lieu sans '
  'coordonnées, heure bornée par le trip ; remplace la proposition en attente du même sens ; '
  'réessai idempotent. SECURITY DEFINER, EXECUTE app_api. US-316 (ADR-186).';
REVOKE ALL ON FUNCTION core.messaging_cmd_propose_meeting(bytea, uuid, uuid, text, text,
                                                          timestamptz) FROM PUBLIC;

-- 6.3 Réponse du voyageur du trip de la session : ACCEPT ou DECLINE. Acceptée : rendez-vous du
-- trip pour ce sens (l'ancien est remplacé) et événement trip.meeting.confirmed (heure, jamais le
-- lieu) dans la MÊME transaction. Réessai de la même réponse par la même personne : DONE.
CREATE FUNCTION core.messaging_cmd_answer_meeting(p_token_hash bytea, p_trip_id uuid,
                                                  p_meeting_id uuid, p_decision text)
  RETURNS TABLE (outcome text, meeting_id uuid, kind text, meet_at timestamptz, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_party  record;
  v_trip   record;
  v_p      record;
  v_now    timestamptz := platform.now();
  v_target text;
BEGIN
  IF p_trip_id IS NULL OR p_meeting_id IS NULL OR p_decision IS NULL
     OR p_decision NOT IN ('ACCEPT', 'DECLINE') THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_party FROM core.messaging_party(v_user, p_trip_id);
  IF v_party.role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('messaging_meeting:' || p_trip_id::text, 0));
  -- proposition d'un autre trip, inconnue, ou personne hors du trip : même issue
  SELECT p.id, p.kind, p.meet_at, p.status, p.answered_by INTO v_p
    FROM core.messaging_meeting_proposal AS p
   WHERE p.id = p_meeting_id AND p.trip_id = p_trip_id AND p.purged_at IS NULL
   FOR UPDATE;
  IF v_p.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  -- seul le voyageur du trip répond
  IF v_party.role <> 'GUEST' THEN
    RETURN QUERY SELECT 'MEETING_NOT_ALLOWED'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  v_target := CASE p_decision WHEN 'ACCEPT' THEN 'ACCEPTED' ELSE 'DECLINED' END;
  IF v_p.status <> 'PROPOSED' THEN
    -- réessai de la même réponse : rendu tel qu'enregistré ; sinon la proposition n'attend plus
    IF v_p.status = v_target AND v_p.answered_by = v_user THEN
      RETURN QUERY SELECT 'DONE'::text, v_p.id, v_p.kind, v_p.meet_at, v_p.status;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'MEETING_NOT_PENDING'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  SELECT t.status, t.country_code INTO v_trip FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF (v_p.kind = 'PICKUP' AND v_trip.status NOT IN ('BOOKED', 'CHECKIN_OPEN'))
     OR (v_p.kind = 'RETURN'
         AND v_trip.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'IN_PROGRESS', 'OVERDUE')) THEN
    RETURN QUERY SELECT 'MEETING_NOT_ALLOWED'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  -- une heure passée ne s'accepte plus (un refus reste possible)
  IF p_decision = 'ACCEPT' AND v_p.meet_at <= v_now THEN
    RETURN QUERY SELECT 'MEETING_EXPIRED'::text, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;

  IF p_decision = 'ACCEPT' THEN
    UPDATE core.messaging_meeting_proposal AS p
       SET status = 'SUPERSEDED'
     WHERE p.trip_id = p_trip_id AND p.kind = v_p.kind AND p.status = 'ACCEPTED';
  END IF;
  UPDATE core.messaging_meeting_proposal AS p
     SET status = v_target, answered_by = v_user, answered_at = v_now
   WHERE p.id = v_p.id;
  IF p_decision = 'ACCEPT' THEN
    -- avis aux deux parties (NTF, parties lues en base) : heure seulement, jamais le lieu
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
    VALUES ('trip.meeting.confirmed', 1, 'trip', p_trip_id, 0, v_trip.country_code, v_user,
            'GUEST', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object(
              'trip_id', p_trip_id, 'meeting_id', v_p.id, 'kind', v_p.kind,
              'meet_at', pg_catalog.to_char(v_p.meet_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
            p_trip_id::text);
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_p.id, v_p.kind, v_p.meet_at, v_target;
END
$fn$;
COMMENT ON FUNCTION core.messaging_cmd_answer_meeting(bytea, uuid, uuid, text) IS
  'Réponse du voyageur du trip de la session à une proposition de rendez-vous : acceptée, elle '
  'devient le rendez-vous du trip pour ce sens et l''événement trip.meeting.confirmed (heure, '
  'jamais le lieu) part vers NTF ; réessai idempotent. SECURITY DEFINER, EXECUTE app_api. US-316 '
  '(ADR-186).';
REVOKE ALL ON FUNCTION core.messaging_cmd_answer_meeting(bytea, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.messaging_meeting_read(bytea, uuid),
  core.messaging_cmd_propose_meeting(bytea, uuid, uuid, text, text, timestamptz),
  core.messaging_cmd_answer_meeting(bytea, uuid, uuid, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM messaging_cmd_owner;

-- 7. Purge à l'échéance (propriétaire privacy_cmd_owner, travailleur privacy_request, US-111) -------
GRANT CREATE ON SCHEMA core TO privacy_cmd_owner;
SET LOCAL ROLE privacy_cmd_owner;

CREATE FUNCTION core.privacy_worker_message_purge(p_batch integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_t    record;
  v_cols text[];
  v_m    integer;
  v_p    integer;
  v_n    integer := 0;
BEGIN
  PERFORM core.privacy_worker_guard();
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'aud : lot de purge invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_t IN
    WITH months AS (
      -- plancher de 15 mois (REQ-PAY-DMG-11, 08), comme la pseudonymisation de 0090
      SELECT c.country_code, GREATEST((c.v #>> '{}')::integer, 15) AS n
        FROM (SELECT DISTINCT t.country_code,
                     core.privacy_param('evidence_retention_months', t.country_code) AS v
                FROM core.booking_trip AS t) AS c
       WHERE pg_catalog.jsonb_typeof(c.v) = 'number' AND (c.v #>> '{}') ~ '^[0-9]{1,3}$'
         AND (c.v #>> '{}')::integer >= 1
    ), msg AS (
      -- trips qui portent un contenu à purger (messages ou lieux) ; dernière activité de messagerie
      SELECT th.trip_id, pg_catalog.max(m.sent_at) AS last_at
        FROM core.messaging_message_thread AS th
        JOIN core.messaging_message AS m ON m.thread_id = th.id
       WHERE m.purged_at IS NULL
       GROUP BY th.trip_id
      UNION ALL
      SELECT p.trip_id, pg_catalog.max(GREATEST(p.created_at, COALESCE(p.answered_at, p.created_at)))
        FROM core.messaging_meeting_proposal AS p
       WHERE p.purged_at IS NULL
       GROUP BY p.trip_id
    ), content AS (
      SELECT x.trip_id, pg_catalog.max(x.last_at) AS last_at FROM msg AS x GROUP BY x.trip_id
    ), due AS (
      SELECT t.id, t.country_code,
             GREATEST(t.scheduled_end, t.updated_at, k.last_at,
                      (SELECT pg_catalog.max(o.updated_at) FROM core.payment_payment_operation AS o
                        WHERE o.trip_id = t.id))
               + pg_catalog.make_interval(months => m.n) AS due_at
        FROM content AS k
        JOIN core.booking_trip AS t ON t.id = k.trip_id
        JOIN months AS m ON m.country_code = t.country_code
       -- trip clos ; litige (IN_DISPUTE) et tout autre statut vivant : jamais
       WHERE t.status IN ('COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                          'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST',
                          'NO_SHOW_HOST')
         AND NOT EXISTS (SELECT 1 FROM core.audit_retention_log AS l
                          WHERE l.rule_code = 'TRIP_MESSAGES' AND l.subject_id = t.id)
         -- gel légal (fail-closed) : rétrofacturation ou incident inscrits sur le trip
         AND NOT EXISTS (SELECT 1 FROM core.support_manual_action AS a
                          WHERE a.subject_type = 'TRIP' AND a.subject_id = t.id
                            AND a.action_code IN ('RECORD_CHARGEBACK', 'OPEN_INCIDENT'))
         -- réclamation : dossier de support ouvert ou en attente sur le trip
         AND NOT EXISTS (SELECT 1 FROM core.support_support_case AS s
                          WHERE s.trip_id = t.id AND s.status IN ('OPEN', 'PENDING'))
         -- demande du voyageur ou d'un auteur suspendue par une obligation légale de conservation
         AND NOT EXISTS (SELECT 1 FROM core.audit_data_subject_request AS r
                          WHERE r.status = 'BLOCKED_LEGAL_HOLD'
                            AND (r.user_id = t.guest_user_id
                                 OR r.user_id IN (SELECT m2.author_user_id
                                                    FROM core.messaging_message_thread AS th2
                                                    JOIN core.messaging_message AS m2
                                                      ON m2.thread_id = th2.id
                                                   WHERE th2.trip_id = t.id)))
    )
    SELECT d.* FROM due AS d WHERE d.due_at <= v_now ORDER BY d.due_at LIMIT p_batch
  LOOP
    -- relu et verrouillé : un trip rouvert (litige) ou verrouillé ailleurs n'est pas traité
    PERFORM 1 FROM core.booking_trip AS t
      WHERE t.id = v_t.id
        AND t.status IN ('COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                         'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST',
                         'NO_SHOW_HOST')
      FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    UPDATE core.messaging_message AS m
       SET body = NULL, body_masked = NULL, purged_at = v_now
      FROM core.messaging_message_thread AS th
     WHERE th.trip_id = v_t.id AND m.thread_id = th.id AND m.purged_at IS NULL;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    UPDATE core.messaging_meeting_proposal AS p
       SET place_label = NULL, purged_at = v_now
     WHERE p.trip_id = v_t.id AND p.purged_at IS NULL;
    GET DIAGNOSTICS v_p = ROW_COUNT;
    v_cols := ARRAY[]::text[];
    IF v_m > 0 THEN v_cols := v_cols || ARRAY['body', 'body_masked']; END IF;
    IF v_p > 0 THEN v_cols := v_cols || 'place_label'::text; END IF;
    INSERT INTO core.audit_retention_log (rule_code, subject_type, subject_id, country_code,
                                          action, columns, due_at, at)
    VALUES ('TRIP_MESSAGES', 'TRIP', v_t.id, v_t.country_code, 'PURGE', v_cols, v_t.due_at, v_now);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;
COMMENT ON FUNCTION core.privacy_worker_message_purge(integer) IS
  'Purge des messages et des lieux de rendez-vous d''un trip clos à l''échéance TRIP_MESSAGES '
  '(evidence_retention_months, plancher 15 mois, depuis la dernière activité) ; jamais pendant un '
  'litige, une rétrofacturation, un incident, une réclamation ouverte ou un gel légal ; journalisée '
  'une fois. SECURITY DEFINER, EXECUTE app_worker (privacy_request). US-316 (ADR-186).';
REVOKE ALL ON FUNCTION core.privacy_worker_message_purge(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.privacy_worker_message_purge(integer) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM privacy_cmd_owner;
