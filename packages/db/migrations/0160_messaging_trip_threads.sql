-- 0160 — MSG : messagerie par trip entre le voyageur et l'hôte, masquage des coordonnées et
-- signal « paiement hors plateforme » (marché gris).
-- US-525 ; 19 US-525 (« Given "escríbeme al +507 6xxx-xxxx", When le message est envoyé, Then le
-- numéro est masqué et le message signalé ; un visiteur sans trip ne peut pas écrire » ; « Given un
-- message contenant "efectivo" ou "por fuera", When il est envoyé, Then il est signalé à l'ops et
-- l'expéditeur voit un rappel que tout paiement passe par Kmino ») ; 16 MSG-001 / MSG-007 ; 08
-- BR-BOOK-02, BR-TRUST-02, BR-TRUST-06 ; 17 §2.2 (MSG), §2.3 (`message.trip_thread`, RLS-9, point 5
-- : IDOR), §3.1.3 (classe D : `hidden_at`), §3.2.12 (`message_thread`, `message`, `message_flag`),
-- §3.2.13 (`review_queue_item`, file GRAY_MARKET) ; 22 OQ-BR-25 (rétention) ; pré-mortem du lot 3 :
-- L3-PM-45, L3-PM-46, L3-PM-49 ; BOARD N-400, N-401, N-416 ; ADR-176 (catalogue de motifs
-- `core.catalog_offplatform_pattern`, RÉUTILISÉ ici) ; ADR-181 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- Bêta (D1) : schéma unique `core`, préfixe `messaging_` (schéma cible `messaging`, schemas.ts) :
-- `messaging.message_thread` → `core.messaging_message_thread`, etc.
--
-- Principes (ADR-181, PROPOSÉS, comme Turo) :
--   - UN fil par trip (`booking_trip` : le trip n'existe qu'à partir de BOOKED, BR-BOOK-02 : aucun
--     contact avant la réservation), créé par la base au premier message ;
--   - parties : le voyageur du trip, le titulaire du compte d'hôte, un co-hôte ACTIF dont la portée
--     couvre le véhicule du trip (RLS-9) ; titulaire et co-hôte détiennent `message.trip_thread`
--     (matrice 17 §2.3, semée ici ; permission unitaire du titulaire comprise). Toute autre
--     personne, trip inconnu, identifiant mal formé : NOT_FOUND, même issue (aucun oracle) ;
--   - identité de la SESSION (empreinte du jeton, `core.iam_session_resolve`), jamais un identifiant
--     de personne reçu ;
--   - écriture tant que `platform.now()` ≤ fin prévue du trip + `review_window_days` du pays (16
--     MSG-001 : « fil en lecture seule » ensuite, MESSAGE_THREAD_CLOSED) ; paramètre absent ⇒
--     fermé (fail-closed) ; la lecture reste ouverte ;
--   - masquage (MSG-007) : téléphones (7 chiffres ou plus, chiffres en toutes lettres compris),
--     courriels (« arroba », « punto » compris), identifiants « @… », liens et noms de domaine sont
--     remplacés par « ••• » dans le texte SERVI (`body_masked`) ; le texte reçu (`body`) reste
--     comme preuve (`hostMessageTraced` de 08, dossier du trip), jamais servi aux parties. Un
--     montant (« 1.500.000 Gs », « $ 1,250.00 »), une date (« 19/11/2026 ») ou une heure ne sont
--     pas masqués ;
--   - marché gris : motifs du catalogue de 0155 (`core.catalog_offplatform_pattern`, RÉUTILISÉ :
--     aucune liste recopiée), plus des motifs propres à la messagerie (`applies_to` = MESSAGE :
--     « por fuera », « sin pasar por la app »…) qui ne s'appliquent PAS aux textes publics de
--     l'hôte (la zone et la ville gardent les règles d'ADR-176) ;
--   - JAMAIS de refus d'un texte légitime (jamais plus lourd que Turo, DEC-FONDATEUR-22) : le
--     message est enregistré ; coordonnées masquées et proposition hors plateforme ⇒ message
--     FLAGGED, une ligne `messaging_message_flag` par nature (codes seulement, jamais de texte), et
--     le fil dans la file GRAY_MARKET de l'ops (un élément vivant par fil) ; file indisponible ⇒
--     exception, rien d'écrit (jamais un signal perdu : l'expéditeur réessaie) ;
--   - rappel à l'expéditeur : l'issue rend `masked` et `off_platform` ; le texte du rappel est dans
--     le catalogue (`web.s16.*`) ;
--   - rétention (22 OQ-BR-25, défaut le plus court, PROPOSÉ) : règle `TRIP_MESSAGES` = durée de la
--     preuve `evidence_retention_months` du pays (plancher de 15 mois de REQ-PAY-DMG-11, la plus
--     courte compatible avec la preuve), à compter de la dernière activité du trip, purge du texte ;
--     appliquée par la procédure tracée (MANUAL) jusqu'au travailleur d'US-316 / US-111 ;
--   - aucun droit applicatif sur les tables : lecture et écriture par les deux fonctions
--     ci-dessous (EXECUTE au seul app_api) ; aucun texte de message dans un journal ni un événement.
--
-- Issues rendues (jamais levées) :
--   lecture : DONE (une ligne d'en-tête si le fil est vide, sinon une ligne par message),
--     AUTH_REQUIRED, NOT_FOUND, REQUEST_INVALID (limite hors [1, 200]) ;
--   écriture : DONE (message enregistré ou rejoué avec le même identifiant), AUTH_REQUIRED,
--     NOT_FOUND, MESSAGE_THREAD_CLOSED, MESSAGE_INVALID (texte vide ou de plus de 2 000
--     caractères), REQUEST_INVALID (identifiant absent ou déjà pris par un autre message).
--   Levée : gray_market_unavailable (55000) quand la file GRAY_MARKET ne peut pas recevoir le
--   signal (l'API répond 503).
--
-- Expand / contract : trois tables, une colonne ajoutée au catalogue de motifs (défaut ALL) et une
-- politique resserrée (le propriétaire du catalogue ne lit que les motifs ALL : comportement de
-- 0155 inchangé), deux lignes de matrice, un propriétaire NOLOGIN (amorçage), ses droits et
-- politiques, une règle de rétention ; aucune fonction existante remplacée.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.messaging_cmd_post_message(bytea, uuid, uuid, text),
--     core.messaging_thread_read(bytea, uuid, integer), core.messaging_party(uuid, uuid),
--     core.messaging_offplatform_codes(text), core.messaging_mask_contacts(text) ;
--   DROP POLICY messaging_cmd_* (tables ci-dessous) ; REVOKE des droits de messaging_cmd_owner ;
--   DROP TABLE core.messaging_message_flag, core.messaging_message, core.messaging_message_thread ;
--   DROP FUNCTION core.messaging_record_guard() ;
--   DELETE FROM core.catalog_offplatform_pattern WHERE applies_to = 'MESSAGE' ;
--   ALTER POLICY catalog_cmd_read ON core.catalog_offplatform_pattern USING (true) ;
--   ALTER TABLE core.catalog_offplatform_pattern DROP COLUMN applies_to ;
--   DELETE FROM core.audit_retention_rule WHERE code = 'TRIP_MESSAGES' ;
--   DELETE FROM core.iam_role_permission WHERE permission_code = 'message.trip_thread'.

-- 1. Permission de la matrice (17 §2.3 : `message.trip_thread`, P2P_HOST « oui », CO_HOST « lim. »
--    : véhicules de sa portée ; le voyageur, partie de SON trip, n'a pas besoin d'une permission) --
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('P2P_HOST', 'message.trip_thread', 'ORG',     '2026-11-19T00:00:00Z',
   'US-525 : matrice 17 §2.3 (fil des trips de son compte d''hôte)'),
  ('CO_HOST',  'message.trip_thread', 'VEHICLE', '2026-11-19T00:00:00Z',
   'US-525 : matrice 17 §2.3 (lim. : trips des véhicules de sa portée, RLS-9)');

-- 2. Tables (17 §3.2.12) ---------------------------------------------------------------------------
-- 2.1 Fil : un par trip (UQ), créé par la base au premier message
CREATE TABLE core.messaging_message_thread (
  id         uuid        PRIMARY KEY,
  trip_id    uuid        NOT NULL REFERENCES core.booking_trip (id)
    CONSTRAINT messaging_message_thread_trip_unique UNIQUE,
  created_at timestamptz NOT NULL DEFAULT platform.now()
);
COMMENT ON TABLE core.messaging_message_thread IS
  'MSG message_thread (17 §3.2.12) : un fil par trip, entre le voyageur et l''hôte (titulaire ou '
  'co-hôte de portée), écrit par la seule commande de la messagerie. US-525 (ADR-181).';

-- 2.2 Message : jamais supprimé (preuve hostMessageTraced, 08 ; dossier du trip) ; seul `hidden_at`
--     se pose, une fois (classe D, 17 §3.1.3)
CREATE TABLE core.messaging_message (
  id             uuid        PRIMARY KEY,
  thread_id      uuid        NOT NULL REFERENCES core.messaging_message_thread (id),
  author_user_id uuid        NOT NULL REFERENCES core.iam_user_account (id),
  author_role    text        NOT NULL
    CONSTRAINT messaging_message_author_role_valid CHECK (author_role IN ('GUEST', 'HOST', 'CO_HOST')),
  -- [C2] texte reçu, gardé comme preuve, jamais servi aux parties
  body           text        NOT NULL
    CONSTRAINT messaging_message_body_length CHECK (pg_catalog.char_length(body) BETWEEN 1 AND 2000),
  -- [C2] texte servi aux parties : coordonnées remplacées par « ••• »
  body_masked    text        NOT NULL
    CONSTRAINT messaging_message_body_masked_length
      CHECK (pg_catalog.char_length(body_masked) BETWEEN 1 AND 4000),
  channel_origin text        NOT NULL DEFAULT 'IN_APP'
    CONSTRAINT messaging_message_channel_valid CHECK (channel_origin IN ('IN_APP', 'WHATSAPP_RELAY')),
  -- 16 MSG-001 « États : message SENT / FLAGGED »
  status         text        NOT NULL
    CONSTRAINT messaging_message_status_valid CHECK (status IN ('SENT', 'FLAGGED')),
  sent_at        timestamptz NOT NULL DEFAULT platform.now(),
  hidden_at      timestamptz,
  CONSTRAINT messaging_message_hidden_after_sent CHECK (hidden_at IS NULL OR hidden_at >= sent_at)
);
CREATE INDEX messaging_message_thread_idx ON core.messaging_message (thread_id, sent_at, id);
COMMENT ON TABLE core.messaging_message IS
  'MSG message (17 §3.2.12) : texte reçu (preuve, C2) et texte servi masqué (C2), heure serveur, '
  'SENT ou FLAGGED ; jamais supprimé, seulement masqué (hidden_at). US-525 (ADR-181).';
COMMENT ON COLUMN core.messaging_message.body IS
  'Texte reçu [C2], gardé comme preuve (hostMessageTraced, dossier du trip) ; jamais servi aux '
  'parties ; purgé à l''échéance de la règle TRIP_MESSAGES (OQ-BR-25).';
COMMENT ON COLUMN core.messaging_message.body_masked IS
  'Texte servi aux parties [C2] : téléphones, courriels, identifiants et liens remplacés par « ••• ».';

-- 2.3 Signal : une ligne par nature et par message ; CODES seulement (jamais le texte)
CREATE TABLE core.messaging_message_flag (
  id             uuid        PRIMARY KEY,
  message_id     uuid        NOT NULL REFERENCES core.messaging_message (id),
  kind           text        NOT NULL
    CONSTRAINT messaging_message_flag_kind_valid
      CHECK (kind IN ('CONTACT_MASKED', 'GRAY_MARKET_KEYWORD', 'ABUSE')),
  -- natures masquées (PHONE, EMAIL, HANDLE, LINK) ou codes des motifs du catalogue
  matched        text[]      NOT NULL
    CONSTRAINT messaging_message_flag_matched_codes
      CHECK (pg_catalog.cardinality(matched) BETWEEN 1 AND 32
             AND pg_catalog.array_to_string(matched, ',')
                 ~ '^[A-Z][A-Z0-9_]{1,63}(,[A-Z][A-Z0-9_]{1,63})*$'),
  -- élément de la file GRAY_MARKET qui porte le signal (un par fil)
  review_item_id uuid        NOT NULL,
  reviewed_by    uuid,
  outcome        text
    CONSTRAINT messaging_message_flag_outcome_valid
      CHECK (outcome IS NULL OR outcome IN ('CONFIRMED', 'DISMISSED')),
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT messaging_message_flag_once UNIQUE (message_id, kind),
  CONSTRAINT messaging_message_flag_review_shape CHECK ((reviewed_by IS NULL) = (outcome IS NULL))
);
COMMENT ON TABLE core.messaging_message_flag IS
  'MSG message_flag (17 §3.2.12) : coordonnées masquées ou proposition de paiement hors '
  'plateforme, codes seulement, élément de la file GRAY_MARKET (MSG-007). US-525 (ADR-181).';

-- 2.4 Garde : ni suppression ni TRUNCATE ; un message ne change que par la pose unique de
--     hidden_at ; un fil ne change jamais ; un signal ne change que par sa décision (console, N-418)
CREATE FUNCTION core.messaging_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'messaging_message'
     AND OLD.hidden_at IS NULL AND NEW.hidden_at IS NOT NULL
     AND (NEW.id, NEW.thread_id, NEW.author_user_id, NEW.author_role, NEW.body, NEW.body_masked,
          NEW.channel_origin, NEW.status, NEW.sent_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.thread_id, OLD.author_user_id, OLD.author_role, OLD.body, OLD.body_masked,
          OLD.channel_origin, OLD.status, OLD.sent_at) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'messaging_message_flag'
     AND OLD.outcome IS NULL AND NEW.outcome IS NOT NULL
     AND (NEW.id, NEW.message_id, NEW.kind, NEW.matched, NEW.review_item_id, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.message_id, OLD.kind, OLD.matched, OLD.review_item_id, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'messagerie : % refusé sur % (preuve, jamais supprimée)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'messaging_record_guarded';
END
$fn$;
REVOKE ALL ON FUNCTION core.messaging_record_guard() FROM PUBLIC;
CREATE TRIGGER messaging_message_thread_guard BEFORE UPDATE OR DELETE ON core.messaging_message_thread
  FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard();
CREATE TRIGGER messaging_message_guard BEFORE UPDATE OR DELETE ON core.messaging_message
  FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard();
CREATE TRIGGER messaging_message_flag_guard BEFORE UPDATE OR DELETE ON core.messaging_message_flag
  FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard();
CREATE TRIGGER messaging_message_thread_no_truncate BEFORE TRUNCATE ON core.messaging_message_thread
  FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard();
CREATE TRIGGER messaging_message_no_truncate BEFORE TRUNCATE ON core.messaging_message
  FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard();
CREATE TRIGGER messaging_message_flag_no_truncate BEFORE TRUNCATE ON core.messaging_message_flag
  FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard();

ALTER TABLE core.messaging_message_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_message_thread FORCE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_message FORCE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_message_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.messaging_message_flag FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.messaging_message_thread TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.messaging_message TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.messaging_message_flag TO migrator USING (true) WITH CHECK (true);
-- aucun droit pour app_api, app_worker ni app_anon : fils et messages passent par les fonctions
REVOKE ALL ON core.messaging_message_thread, core.messaging_message, core.messaging_message_flag
  FROM PUBLIC;

-- 3. Catalogue de motifs de 0155 RÉUTILISÉ (ADR-176) : portée d'un motif -----------------------------
-- ALL : textes publics de l'hôte (0155) ET messagerie ; MESSAGE : messagerie seulement (une
-- conversation privée parle de rendez-vous : « por fuera » y signale ; il ne doit pas refuser une
-- zone publique). Le propriétaire du catalogue (catalog_cmd_owner) ne lit plus que les motifs ALL :
-- la règle de 0155 est inchangée.
ALTER TABLE core.catalog_offplatform_pattern
  ADD COLUMN applies_to text NOT NULL DEFAULT 'ALL'
    CONSTRAINT catalog_offplatform_pattern_applies_to_valid CHECK (applies_to IN ('ALL', 'MESSAGE'));
ALTER POLICY catalog_cmd_read ON core.catalog_offplatform_pattern USING (applies_to = 'ALL');
COMMENT ON COLUMN core.catalog_offplatform_pattern.applies_to IS
  'Portée du motif : ALL (textes publics de l''hôte, 0155, et messagerie) ou MESSAGE (messagerie '
  'seulement). US-525 (ADR-181).';

INSERT INTO core.catalog_offplatform_pattern (code, lang, pattern, story, applies_to) VALUES
  -- « por fuera », « sin pasar por la app », « te pago directo / aparte / en persona »
  ('ES_MSG_OUTSIDE', 'es',
   '\m(por (a)?fuera|sin pasar por (la )?(app|aplicacion|plataforma)|te (lo )?pago (directo|aparte|en persona|a vos|a ti))\M',
   'US-525', 'MESSAGE'),
  ('EN_MSG_OUTSIDE', 'en',
   '\m(outside (of )?(the )?(app|platform)|pay (you|me) (directly|in person|on the side)|off the books|under the table)\M',
   'US-525', 'MESSAGE'),
  ('FR_MSG_OUTSIDE', 'fr',
   '\m(en dehors de (la )?(plateforme|application|appli)|je (te|vous) paie (directement|en main propre)|au noir)\M',
   'US-525', 'MESSAGE'),
  ('PT_MSG_OUTSIDE', 'pt',
   '\m(por fora|fora do (app|aplicativo)|te pago (direto|por fora|em maos)|pagar em maos|pago em maos)\M',
   'US-525', 'MESSAGE');

-- 4. Rétention (22 OQ-BR-25, défaut le plus court compatible avec la preuve, PROPOSÉ) ----------------
INSERT INTO core.audit_retention_rule (code, param_key, anchor, action, tables, enforced_by, story)
VALUES ('TRIP_MESSAGES', 'evidence_retention_months', 'TRIP_LAST_ACTIVITY', 'PURGE',
        '{core.messaging_message}', 'MANUAL', 'US-525');

-- 5. Socle de messaging_cmd_owner (NOLOGIN, amorçage) : droits au plus juste -----------------------
GRANT USAGE ON SCHEMA core, platform TO messaging_cmd_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO messaging_cmd_owner;

-- identité de la session (fonction d'iam_auth_owner : seul son propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO messaging_cmd_owner;
RESET ROLE;
-- normalisation des textes de 0084 (NFKC, invisibles retirés ; propriétaire catalog_cmd_owner)
SET LOCAL ROLE catalog_cmd_owner;
GRANT EXECUTE ON FUNCTION core.catalog_public_text_norm(text) TO messaging_cmd_owner;
RESET ROLE;
-- mise en file GRAY_MARKET (fonction d'iam_staff_owner, US-109)
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid)
  TO messaging_cmd_owner;
RESET ROLE;

-- trip : parties, véhicule, pays, fin prévue, fuseau (affichage des heures)
GRANT SELECT (id, country_code, org_id, vehicle_id, guest_user_id, scheduled_end, timezone)
  ON core.booking_trip TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.booking_trip FOR SELECT TO messaging_cmd_owner
  USING (true);
-- compte d'hôte (titulaire), appartenances (titulaire, co-hôte et sa portée), matrice
GRANT SELECT (id, holder_user_id) ON core.iam_organization TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.iam_organization FOR SELECT TO messaging_cmd_owner
  USING (true);
GRANT SELECT (user_id, org_id, role, status, vehicle_scope, permission_overrides)
  ON core.iam_membership TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.iam_membership FOR SELECT TO messaging_cmd_owner
  USING (true);
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission
  TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.iam_role_permission FOR SELECT TO messaging_cmd_owner
  USING (permission_code = 'message.trip_thread');
-- prénom affiché (premier mot du prénom légal ; compte pseudonymisé : rien)
GRANT SELECT (id, legal_first_name, pseudonymized_at) ON core.iam_user_account
  TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.iam_user_account FOR SELECT TO messaging_cmd_owner
  USING (true);
-- fenêtre d'écriture (16 MSG-001 : fin du trip + review_window_days) seulement
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.config_param_value FOR SELECT TO messaging_cmd_owner
  USING (key = 'review_window_days');
-- codes des devises déclarées (un montant n'est pas un téléphone ; aucune constante de pays)
GRANT SELECT (code) ON core.config_currency TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.config_currency FOR SELECT TO messaging_cmd_owner
  USING (true);
-- motifs du signal hors plateforme : toutes portées (ALL et MESSAGE)
GRANT SELECT (code, pattern) ON core.catalog_offplatform_pattern TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_read ON core.catalog_offplatform_pattern FOR SELECT
  TO messaging_cmd_owner USING (true);

-- tables de la messagerie : lecture, insertion ; aucune mise à jour (hidden_at et la décision d'un
-- signal relèvent de la console, N-418), aucune suppression
GRANT SELECT, INSERT ON core.messaging_message_thread TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_sel ON core.messaging_message_thread FOR SELECT TO messaging_cmd_owner
  USING (true);
CREATE POLICY messaging_cmd_ins ON core.messaging_message_thread FOR INSERT TO messaging_cmd_owner
  WITH CHECK (true);
GRANT SELECT, INSERT ON core.messaging_message TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_sel ON core.messaging_message FOR SELECT TO messaging_cmd_owner
  USING (true);
CREATE POLICY messaging_cmd_ins ON core.messaging_message FOR INSERT TO messaging_cmd_owner
  WITH CHECK (hidden_at IS NULL AND channel_origin = 'IN_APP');
GRANT SELECT, INSERT ON core.messaging_message_flag TO messaging_cmd_owner;
CREATE POLICY messaging_cmd_sel ON core.messaging_message_flag FOR SELECT TO messaging_cmd_owner
  USING (true);
CREATE POLICY messaging_cmd_ins ON core.messaging_message_flag FOR INSERT TO messaging_cmd_owner
  WITH CHECK (reviewed_by IS NULL AND outcome IS NULL AND kind <> 'ABUSE');

-- 6. Fonctions (propriétaire messaging_cmd_owner) ---------------------------------------------------
GRANT CREATE ON SCHEMA core TO messaging_cmd_owner;
SET LOCAL ROLE messaging_cmd_owner;

-- 6.1 Masquage des coordonnées (MSG-007). Texte normalisé (NFKC, invisibles retirés : « 1️⃣ »
-- devient « 1 », chiffres pleine chasse ramenés) puis, dans l'ordre, remplacés par « ••• » :
--   LINK   : adresse web (« http… », « www… ») ;
--   EMAIL  : courriel, y compris « arroba », « (at) », « punto », « ponto », « dot » ;
--   HANDLE : identifiant « @… » ;
--   LINK   : nom de domaine courant (« wa.me/… », « bit.ly/… », « exemple.com », « exemple.com.xx ») ;
--   PHONE  : suite de 7 à 20 chiffres séparés par des blancs, points, tirets ou parenthèses
--            (« +507 6123-4567 », « 0981 123 456 »), SAUF un montant (chiffres groupés par trois, ou
--            précédés / suivis d'un signe monétaire ou du code d'une devise déclarée dans
--            `config_currency` : « 1.500.000 », « $ 1,250.00 », « 1 500 000 <code> ») ou une date
--            (« 19.11.2026 ») ; « / » et « : » ne séparent pas (dates, heures) ;
--   PHONE  : suite d'au moins 7 chiffres dont au moins un en toutes lettres (es, en, pt-BR :
--            « seis uno dos tres cuatro cinco seis »).
-- Rend le texte masqué et les natures trouvées (codes). Réduit le risque sans prétendre à
-- l'exhaustivité (homoglyphes, chiffres en lettres françaises, image d'un numéro : limites d'ADR-181).
CREATE FUNCTION core.messaging_mask_contacts(p_text text, OUT masked text, OUT kinds text[])
  LANGUAGE plpgsql
  STABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c_mask   constant text := '•••';
  c_phone  constant text := '\+?[0-9][0-9[:space:]().-]{5,}[0-9]';
  c_tok    constant text := '(cero|zero|uno|una|um|uma|one|dos|dois|duas|two|tres|three|cuatro|'
                            'quatro|four|cinco|five|seis|six|siete|sete|seven|ocho|oito|eight|'
                            'nueve|nove|nine|[0-9]+)';
  v_text   text;
  v_prev   text;
  v_low    text;
  v_out    text;
  v_m      text;
  v_digits text;
  v_before text;
  v_after  text;
  v_at     integer;
  v_pos    integer;
  v_last   integer;
  v_end    integer;
  v_words  integer;
  v_hit    boolean;
  -- codes des devises déclarées, en minuscules, en mots entiers (alternatives d'expression)
  v_cur    text := COALESCE((SELECT pg_catalog.string_agg(
                                       '|\m' || pg_catalog.lower(c.code::text) || '\M', '')
                               FROM core.config_currency AS c), '');
BEGIN
  kinds := '{}'::text[];
  v_text := core.catalog_public_text_norm(p_text);
  IF v_text IS NULL THEN
    masked := NULL;
    RETURN;
  END IF;

  -- adresses web
  v_prev := v_text;
  v_text := pg_catalog.regexp_replace(v_text, '(https?://|www\.)[^[:space:]]+', c_mask, 'gi');
  IF v_text <> v_prev THEN kinds := kinds || 'LINK'::text; END IF;
  -- courriels (forme écrite en mots comprise)
  v_prev := v_text;
  v_text := pg_catalog.regexp_replace(v_text,
    '[[:alnum:]._%+-]+[[:space:]]*(@|\(at\)|\[at\]|\marroba\M)[[:space:]]*[[:alnum:]-]+'
    '([[:space:]]*(\.|\mpunto\M|\mponto\M|\mdot\M)[[:space:]]*[[:alpha:]]{2,})+',
    c_mask, 'gi');
  IF v_text <> v_prev THEN kinds := kinds || 'EMAIL'::text; END IF;
  -- identifiants « @… »
  v_prev := v_text;
  v_text := pg_catalog.regexp_replace(v_text, '@[[:alnum:]_.]{2,}', c_mask, 'gi');
  IF v_text <> v_prev THEN kinds := kinds || 'HANDLE'::text; END IF;
  -- noms de domaine courants (liens courts compris)
  v_prev := v_text;
  v_text := pg_catalog.regexp_replace(v_text,
    '\m[[:alnum:]-]{2,}(\.[[:alnum:]-]+)*\.(com|net|org|info|io|co|me|app|biz|ly|link|ee|gl|gg|to|'
    'tv|xyz|site|online)(\.[[:alpha:]]{2})?\M(/[^[:space:]]*)?',
    c_mask, 'gi');
  IF v_text <> v_prev AND NOT ('LINK' = ANY (kinds)) THEN kinds := kinds || 'LINK'::text; END IF;

  -- téléphones en chiffres (montants, dates exclus)
  v_out := ''; v_last := 1; v_pos := 1; v_hit := false;
  LOOP
    v_at := pg_catalog.regexp_instr(v_text, c_phone, v_pos);
    EXIT WHEN v_at = 0;
    v_m := pg_catalog.regexp_substr(v_text, c_phone, v_pos);
    v_end := v_at + pg_catalog.length(v_m);
    v_digits := pg_catalog.regexp_replace(v_m, '[^0-9]', '', 'g');
    v_before := pg_catalog.lower(pg_catalog.substr(v_text, GREATEST(1, v_at - 8),
                                                   v_at - GREATEST(1, v_at - 8)));
    v_after := pg_catalog.lower(pg_catalog.substr(v_text, v_end, 12));
    IF pg_catalog.length(v_digits) BETWEEN 7 AND 20
       AND (pg_catalog.left(v_m, 1) = '+'
            OR NOT (
              -- montant : chiffres groupés par trois (« 1.500.000 », « 150,000.50 »)
              (pg_catalog.length(v_digits) <= 12
               AND v_m ~ '^[0-9]{1,3}([.,][0-9]{3})+([.,][0-9]{1,2})?$')
              -- montant : signe monétaire ou code d'une devise déclarée (config_currency, aucune
              -- constante de pays) juste avant ou juste après
              OR v_before ~ ('([$€£¥₲₡₱₹]' || v_cur || ')[[:space:]]*$')
              OR v_after ~ ('^[[:space:]]*([$€£¥₲₡₱₹]' || v_cur || ')')
              -- date (« 19.11.2026 », « 2026-11-19 »)
              OR v_m ~ '^([0-9]{1,2}[.-][0-9]{1,2}[.-][0-9]{2,4}|[0-9]{4}[.-][0-9]{1,2}[.-][0-9]{1,2})$'))
    THEN
      v_out := v_out || pg_catalog.substr(v_text, v_last, v_at - v_last) || c_mask;
      v_last := v_end;
      v_hit := true;
    END IF;
    v_pos := v_end;
  END LOOP;
  v_text := v_out || pg_catalog.substr(v_text, v_last);

  -- téléphones écrits en toutes lettres (au moins un mot, au moins 7 chiffres) : détectés sur le
  -- texte en minuscules sans accents, découpés sur le texte servi (même longueur ; sinon le texte
  -- en minuscules devient le texte servi)
  v_low := pg_catalog.translate(pg_catalog.lower(v_text), 'áàâãäéèêëíìîïóòôõöúùûüçñ',
                                'aaaaaeeeeiiiiooooouuuucn');
  IF pg_catalog.length(v_low) <> pg_catalog.length(v_text) THEN
    v_text := v_low;
  END IF;
  v_out := ''; v_last := 1; v_pos := 1;
  LOOP
    v_at := pg_catalog.regexp_instr(v_low, '\m' || c_tok || '\M([[:space:],.-]+' || c_tok || '\M)+',
                                    v_pos);
    EXIT WHEN v_at = 0;
    v_m := pg_catalog.regexp_substr(v_low, '\m' || c_tok || '\M([[:space:],.-]+' || c_tok || '\M)+',
                                    v_pos);
    v_end := v_at + pg_catalog.length(v_m);
    v_words := pg_catalog.regexp_count(v_m, '[[:alpha:]]+');
    IF v_words >= 1
       AND v_words + pg_catalog.length(pg_catalog.regexp_replace(v_m, '[^0-9]', '', 'g')) >= 7 THEN
      v_out := v_out || pg_catalog.substr(v_text, v_last, v_at - v_last) || c_mask;
      v_last := v_end;
      v_hit := true;
    END IF;
    v_pos := v_end;
  END LOOP;
  v_text := v_out || pg_catalog.substr(v_text, v_last);
  IF v_hit THEN kinds := kinds || 'PHONE'::text; END IF;

  masked := v_text;
END
$fn$;
COMMENT ON FUNCTION core.messaging_mask_contacts(text) IS
  'Texte servi d''un message (MSG-007) : téléphones (chiffres ou lettres), courriels, identifiants '
  'et liens remplacés par « ••• » ; montants, dates et heures gardés ; natures trouvées. Aide interne '
  'sous messaging_cmd_owner. US-525 (ADR-181).';
REVOKE ALL ON FUNCTION core.messaging_mask_contacts(text) FROM PUBLIC;

-- 6.2 Codes des motifs « paiement hors plateforme » trouvés (catalogue de 0155, toutes portées),
-- sur le texte normalisé, en minuscules et sans accents (même lecture que 0155)
CREATE FUNCTION core.messaging_offplatform_codes(p_text text)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (
    SELECT pg_catalog.translate(pg_catalog.lower(core.catalog_public_text_norm(p_text)),
                                'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') AS v
  )
  SELECT COALESCE(pg_catalog.array_agg(m.code ORDER BY m.code), '{}'::text[])
    FROM core.catalog_offplatform_pattern AS m, t
   WHERE t.v ~ m.pattern
$fn$;
COMMENT ON FUNCTION core.messaging_offplatform_codes(text) IS
  'Codes des motifs de core.catalog_offplatform_pattern (ADR-176, portées ALL et MESSAGE) trouvés '
  'dans un message. Aide interne sous messaging_cmd_owner. US-525 (ADR-181).';
REVOKE ALL ON FUNCTION core.messaging_offplatform_codes(text) FROM PUBLIC;

-- 6.3 Partie d'un trip : GUEST (voyageur du trip), HOST (titulaire du compte d'hôte), CO_HOST
-- (co-hôte ACTIF dont la portée couvre le véhicule, RLS-9) ; titulaire et co-hôte détiennent
-- message.trip_thread (matrice en vigueur ou permission unitaire du titulaire). Aucune ligne pour
-- toute autre personne (révoquée, invitée, hors portée, autre hôte, visiteur) ou un trip inconnu.
CREATE FUNCTION core.messaging_party(p_user uuid, p_trip_id uuid)
  RETURNS TABLE (role text, country_code text, org_id uuid, guest_user_id uuid,
                 scheduled_end timestamptz, timezone text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.role, t.country_code, t.org_id, t.guest_user_id, t.scheduled_end, t.timezone
    FROM core.booking_trip AS t
   CROSS JOIN LATERAL (
     SELECT 'GUEST'::text AS role, 0 AS rank WHERE t.guest_user_id = p_user
     UNION ALL
     SELECT CASE m.role WHEN 'P2P_HOST' THEN 'HOST' ELSE 'CO_HOST' END,
            CASE m.role WHEN 'P2P_HOST' THEN 1 ELSE 2 END
       FROM core.iam_membership AS m
       JOIN core.iam_organization AS o ON o.id = m.org_id
      WHERE m.org_id = t.org_id
        AND m.user_id = p_user
        AND m.status = 'ACTIVE'
        AND ((m.role = 'P2P_HOST' AND o.holder_user_id = m.user_id)
             OR (m.role = 'CO_HOST' AND t.vehicle_id = ANY (m.vehicle_scope)))
        AND ('message.trip_thread' = ANY (m.permission_overrides)
             OR EXISTS (SELECT 1
                          FROM core.iam_role_permission AS rp
                         WHERE rp.role = m.role
                           AND rp.permission_code = 'message.trip_thread'
                           AND rp.valid_from <= platform.now()
                           AND (rp.valid_to IS NULL OR rp.valid_to > platform.now())))
   ) AS x
   WHERE p_user IS NOT NULL AND t.id = p_trip_id
   ORDER BY x.rank
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.messaging_party(uuid, uuid) IS
  'Partie d''un trip pour la messagerie : voyageur, titulaire du compte d''hôte ou co-hôte actif de '
  'portée (RLS-9), avec message.trip_thread ; aucune ligne sinon. Aide interne sous '
  'messaging_cmd_owner. US-525 (ADR-181).';
REVOKE ALL ON FUNCTION core.messaging_party(uuid, uuid) FROM PUBLIC;

-- 6.4 Lecture du fil (S16) par une partie du trip de la session : en-tête (rôle de la session,
-- prénom de l'autre partie, écriture possible, fin de la fenêtre, fuseau du trip) répété sur chaque ligne ; les
-- p_limit derniers messages, du plus ancien au plus récent ; texte MASQUÉ seulement (jamais `body`),
-- prénom de l'auteur (premier mot du prénom légal), `masked` ; `off_platform` pour les messages de
-- la session seulement (rappel). Fil vide : une ligne d'en-tête, message_id NULL.
CREATE FUNCTION core.messaging_thread_read(p_token_hash bytea, p_trip_id uuid, p_limit integer)
  RETURNS TABLE (outcome text, viewer_role text, counterpart_name text, writable boolean,
                 closes_at timestamptz, timezone text, message_id uuid, mine boolean, author_role text,
                 author_name text, body text, masked boolean, off_platform boolean,
                 sent_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_party   record;
  v_days    jsonb;
  v_closes  timestamptz;
  v_name    text;
  v_now     timestamptz := platform.now();
BEGIN
  IF p_trip_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::boolean, NULL::text,
                        NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  -- personne de la SESSION (IDOR : jamais un identifiant de personne reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::boolean, NULL::text,
                        NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_party FROM core.messaging_party(v_user, p_trip_id);
  IF v_party.role IS NULL THEN
    -- trip d'une autre personne, inconnu, co-hôte hors portée ou révoqué : même issue
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::boolean,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::boolean, NULL::text,
                        NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  -- fenêtre d'écriture : fin prévue + review_window_days du pays ; absente ou mal formée : fermé
  SELECT v.value INTO v_days
    FROM core.config_param_value AS v
   WHERE v.key = 'review_window_days' AND v.country_code::text = v_party.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_days IS NOT NULL AND pg_catalog.jsonb_typeof(v_days) = 'number'
     AND (v_days #>> '{}') ~ '^[0-9]{1,3}$' THEN
    v_closes := v_party.scheduled_end
                + pg_catalog.make_interval(days => (v_days #>> '{}')::integer);
  END IF;
  -- prénom de l'autre partie : le titulaire du compte d'hôte pour le voyageur, le voyageur sinon
  SELECT NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name), ' ', 1),
                                40), '')
    INTO v_name
    FROM core.iam_user_account AS u
   WHERE u.pseudonymized_at IS NULL
     AND u.id = CASE WHEN v_party.role = 'GUEST'
                     THEN (SELECT o.holder_user_id FROM core.iam_organization AS o
                            WHERE o.id = v_party.org_id)
                     ELSE v_party.guest_user_id END;

  RETURN QUERY
  SELECT 'DONE'::text, v_party.role, v_name, (v_closes IS NOT NULL AND v_now <= v_closes),
         v_closes, v_party.timezone, m.id, m.mine, m.author_role, m.author_name, m.body, m.masked,
         m.off_platform, m.sent_at
    FROM (SELECT 1) AS head
    LEFT JOIN LATERAL (
      SELECT x.*
        FROM (
          SELECT msg.id, msg.author_user_id = v_user AS mine, msg.author_role,
                 NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(au.legal_first_name),
                                                              ' ', 1), 40), '') AS author_name,
                 CASE WHEN msg.hidden_at IS NULL THEN msg.body_masked END AS body,
                 EXISTS (SELECT 1 FROM core.messaging_message_flag AS f
                          WHERE f.message_id = msg.id AND f.kind = 'CONTACT_MASKED') AS masked,
                 (msg.author_user_id = v_user
                  AND EXISTS (SELECT 1 FROM core.messaging_message_flag AS f
                               WHERE f.message_id = msg.id
                                 AND f.kind = 'GRAY_MARKET_KEYWORD')) AS off_platform,
                 msg.sent_at
            FROM core.messaging_message_thread AS th
            JOIN core.messaging_message AS msg ON msg.thread_id = th.id
            LEFT JOIN core.iam_user_account AS au
              ON au.id = msg.author_user_id AND au.pseudonymized_at IS NULL
           WHERE th.trip_id = p_trip_id
           ORDER BY msg.sent_at DESC, msg.id DESC
           LIMIT p_limit) AS x) AS m ON true
   ORDER BY m.sent_at, m.id;
END
$fn$;
COMMENT ON FUNCTION core.messaging_thread_read(bytea, uuid, integer) IS
  'Fil d''un trip (S16) pour une partie du trip de la session : rôle, prénom de l''autre partie, '
  'fenêtre d''écriture, derniers messages en texte masqué (jamais le texte reçu) ; trip d''une '
  'autre personne ou inconnu : NOT_FOUND. SECURITY DEFINER, EXECUTE app_api. US-525 (ADR-181).';
REVOKE ALL ON FUNCTION core.messaging_thread_read(bytea, uuid, integer) FROM PUBLIC;

-- 6.5 Envoi d'un message par une partie du trip de la session (MSG-001, MSG-007). Identifiant
-- choisi par le client (réessai sans doublon : le même identifiant, du même auteur dans le même
-- fil, rend le message enregistré). Texte enregistré tel que reçu (sans les blancs de bord),
-- texte servi masqué ; signal et file GRAY_MARKET dans la MÊME transaction.
CREATE FUNCTION core.messaging_cmd_post_message(p_token_hash bytea, p_trip_id uuid,
                                                p_message_id uuid, p_body text)
  RETURNS TABLE (outcome text, message_id uuid, body text, masked boolean, off_platform boolean,
                 sent_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_party   record;
  v_days    jsonb;
  v_now     timestamptz := platform.now();
  v_thread  uuid;
  v_text    text := pg_catalog.btrim(p_body, E' \t\r\n');
  v_mask    record;
  v_codes   text[];
  v_item    record;
  v_old     record;
BEGIN
  IF p_trip_id IS NULL OR p_message_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  -- partie du trip (visiteur sans trip, autre hôte, co-hôte hors portée : NOT_FOUND, même issue)
  SELECT * INTO v_party FROM core.messaging_party(v_user, p_trip_id);
  IF v_party.role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  -- réessai : le même message (même auteur, même fil) est rendu tel qu'enregistré, sans nouveau
  -- signal ; un identifiant déjà pris ailleurs est refusé
  SELECT msg.id, msg.author_user_id, th.trip_id, msg.body_masked, msg.sent_at INTO v_old
    FROM core.messaging_message AS msg
    JOIN core.messaging_message_thread AS th ON th.id = msg.thread_id
   WHERE msg.id = p_message_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.author_user_id IS DISTINCT FROM v_user OR v_old.trip_id IS DISTINCT FROM p_trip_id THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::boolean,
                          NULL::boolean, NULL::timestamptz;
      RETURN;
    END IF;
    RETURN QUERY
    SELECT 'DONE'::text, v_old.id, v_old.body_masked,
           EXISTS (SELECT 1 FROM core.messaging_message_flag AS f
                    WHERE f.message_id = v_old.id AND f.kind = 'CONTACT_MASKED'),
           EXISTS (SELECT 1 FROM core.messaging_message_flag AS f
                    WHERE f.message_id = v_old.id AND f.kind = 'GRAY_MARKET_KEYWORD'),
           v_old.sent_at;
    RETURN;
  END IF;
  -- fenêtre d'écriture (16 MSG-001) : fin prévue + review_window_days ; absente : fermé
  SELECT v.value INTO v_days
    FROM core.config_param_value AS v
   WHERE v.key = 'review_window_days' AND v.country_code::text = v_party.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_days IS NULL OR pg_catalog.jsonb_typeof(v_days) <> 'number'
     OR (v_days #>> '{}') !~ '^[0-9]{1,3}$'
     OR v_now > v_party.scheduled_end + pg_catalog.make_interval(days => (v_days #>> '{}')::integer)
  THEN
    RETURN QUERY SELECT 'MESSAGE_THREAD_CLOSED'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_text IS NULL OR pg_catalog.char_length(v_text) < 1 OR pg_catalog.char_length(v_text) > 2000
  THEN
    RETURN QUERY SELECT 'MESSAGE_INVALID'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  -- masquage et signal (sur le texte reçu)
  SELECT * INTO v_mask FROM core.messaging_mask_contacts(v_text);
  v_codes := core.messaging_offplatform_codes(v_text);
  IF v_mask.masked IS NULL OR pg_catalog.char_length(pg_catalog.btrim(v_mask.masked)) < 1
     OR pg_catalog.char_length(v_mask.masked) > 4000 THEN
    -- texte fait d'invisibles seulement, ou que la normalisation allonge au-delà de la borne
    RETURN QUERY SELECT 'MESSAGE_INVALID'::text, NULL::uuid, NULL::text, NULL::boolean,
                        NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  -- fil du trip (un par trip ; deux premiers messages concurrents : le second lit le fil créé)
  INSERT INTO core.messaging_message_thread AS th (id, trip_id, created_at)
  VALUES (pg_catalog.gen_random_uuid(), p_trip_id, v_now)
  ON CONFLICT ON CONSTRAINT messaging_message_thread_trip_unique DO NOTHING;
  SELECT th.id INTO v_thread FROM core.messaging_message_thread AS th WHERE th.trip_id = p_trip_id;

  INSERT INTO core.messaging_message AS msg
         (id, thread_id, author_user_id, author_role, body, body_masked, channel_origin, status,
          sent_at)
  VALUES (p_message_id, v_thread, v_user, v_party.role, v_text, v_mask.masked, 'IN_APP',
          CASE WHEN pg_catalog.cardinality(v_mask.kinds) > 0
                    OR pg_catalog.cardinality(v_codes) > 0 THEN 'FLAGGED' ELSE 'SENT' END,
          v_now);

  IF pg_catalog.cardinality(v_mask.kinds) > 0 OR pg_catalog.cardinality(v_codes) > 0 THEN
    -- signal à l'ops : le fil dans la file GRAY_MARKET (un élément vivant par fil) ; file
    -- indisponible : exception, rien d'écrit (jamais un signal perdu)
    SELECT q.outcome, q.item_id INTO v_item
      FROM core.support_enqueue_review('GRAY_MARKET', 'MESSAGE_THREAD', v_thread,
                                       v_party.country_code, v_user) AS q;
    IF v_item.outcome IS NULL OR v_item.outcome NOT IN ('CREATED', 'EXISTS')
       OR v_item.item_id IS NULL THEN
      RAISE EXCEPTION 'messagerie : file GRAY_MARKET indisponible (%)', COALESCE(v_item.outcome, '?')
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'gray_market_unavailable';
    END IF;
    IF pg_catalog.cardinality(v_mask.kinds) > 0 THEN
      INSERT INTO core.messaging_message_flag (id, message_id, kind, matched, review_item_id,
                                               created_at)
      VALUES (pg_catalog.gen_random_uuid(), p_message_id, 'CONTACT_MASKED', v_mask.kinds,
              v_item.item_id, v_now);
    END IF;
    IF pg_catalog.cardinality(v_codes) > 0 THEN
      INSERT INTO core.messaging_message_flag (id, message_id, kind, matched, review_item_id,
                                               created_at)
      VALUES (pg_catalog.gen_random_uuid(), p_message_id, 'GRAY_MARKET_KEYWORD', v_codes,
              v_item.item_id, v_now);
    END IF;
  END IF;

  RETURN QUERY SELECT 'DONE'::text, p_message_id, v_mask.masked,
                      pg_catalog.cardinality(v_mask.kinds) > 0,
                      pg_catalog.cardinality(v_codes) > 0, v_now;
END
$fn$;
COMMENT ON FUNCTION core.messaging_cmd_post_message(bytea, uuid, uuid, text) IS
  'Message d''une partie du trip de la session (MSG-001) : fenêtre review_window_days, texte '
  'masqué servi (MSG-007), coordonnées et paiement hors plateforme signalés (message_flag, file '
  'GRAY_MARKET), jamais refusés ; réessai idempotent. SECURITY DEFINER, EXECUTE app_api. US-525 '
  '(ADR-181).';
REVOKE ALL ON FUNCTION core.messaging_cmd_post_message(bytea, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.messaging_thread_read(bytea, uuid, integer),
  core.messaging_cmd_post_message(bytea, uuid, uuid, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM messaging_cmd_owner;
