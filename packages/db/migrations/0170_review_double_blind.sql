-- 0170 — REV : avis réciproques en double aveugle, publication simultanée, avis reçus.
-- Fenêtre de 10 jours (review_window_days), profil public de l'hôte.
-- US-317 ; 19 US-317 (critère 1 : « Given un trip terminé et `review_window_days` = 10, When un seul
-- des deux a noté à J+9, Then aucun avis n'est publié ; à J+10, l'avis donné est publié » ;
-- critère 2 : « Given les deux avis donnés à J+3, When le second est enregistré, Then les deux sont
-- publiés en même temps » ; critère 3 : « avis de l'hôte sur le voyageur publié ⇒ visible sur le
-- profil du voyageur et consultable par lui (droit d'accès, Ley 81) ; texte obligatoire si la note
-- est de 1 à 3 » ; critère 4 : « fiche d'un véhicule ⇒ le bloc de l'hôte montre sa note, son badge,
-- son nombre de trips et son ancienneté (LST-020) ») ; 16 REV-001, REV-002, REV-004, LST-003 /
-- LST-020, EC-42 ; 08 BR-REVIEW-01 à BR-REVIEW-07 ; 22 OQ-P2P-06 (défaut : 10 jours, publication
-- simultanée) ; pré-mortem du lot 3 : L3-PM-48 (avis lu avant publication par l'API, une vue,
-- l'agrégat, une notification, un journal ; J+9 au lieu de J+10 ; avis modifié ; texte contourné ;
-- co-hôte ou trip annulé qui note), RT-L3-D04 ; ADR-130 (US-218, 0104 : `review_review`,
-- `review_rating_aggregate`, immuabilité) ; ADR-183 (US-315 : fin effective = première ligne
-- RETURNED du journal d'état) ; ADR-181 (US-525, 0161 : `messaging_mask_contacts`) ; ADR-190 (cette
-- migration, PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-190, PROPOSÉS, comme Turo) :
--   1. Scellé : un avis donné dans l'application est écrit dans `core.review_submission`, table
--      qu'AUCUN rôle applicatif ne lit et qu'aucune lecture ne sert à l'autre partie. La publication
--      recopie le scellé dans `core.review_review` (registre public de 0104, source IN_APP) et tient
--      `core.review_rating_aggregate` dans la MÊME transaction : avant publication, ni la note ni le
--      texte n'existent hors du scellé (aucune vue, aucun agrégat, aucun événement, aucune
--      notification, aucun journal, aucun compteur) ; la seule lecture du scellé est celle de son
--      auteur (« mon avis, en attente »). Aucune réponse ne dit à une partie si l'autre a noté.
--   2. Qui note, quand : la partie du trip de la SESSION seulement : le voyageur du trip (GUEST) ou
--      le titulaire du compte d'hôte du trip (HOST) ; un co-hôte, un tiers, un trip inconnu ⇒
--      NOT_FOUND (même issue). Fenêtre : de la fin effective (première ligne RETURNED du journal
--      d'état, ADR-183 ; un trip annulé, refusé ou en no-show n'en a pas ⇒ REVIEW_NOT_OPEN) à la fin
--      effective + `review_window_days` jours du pays du trip, comptés au FUSEAU DU TRIP (même heure
--      murale, changements d'heure compris) ; à l'échéance exacte la fenêtre est close. Paramètre
--      absent ou mal formé ⇒ REVIEW_WINDOW_UNKNOWN (fail-closed). Heure de la base
--      (`platform.now()`, relue sous le verrou). Une fois par partie (UQ du scellé ; un avis déjà
--      enregistré par l'ops, US-218, compte aussi) ; ni modification ni retrait par la partie.
--   3. Contenu : note globale 1 à 5 ; sous-notes facultatives (BR-REVIEW-03 ; voyageur : propreté,
--      communication, praticité, exactitude de l'annonce, entretien ; hôte : ponctualité, état de
--      restitution, communication, respect des règles), 1 à 5, clés fermées ; texte facultatif de
--      1000 caractères au plus, OBLIGATOIRE d'au moins 25 caractères si la note est de 1 à 3, pour
--      les deux rôles (BR-REVIEW-04, recommandation LATAM : symétrie). Texte normalisé (NFKC) puis
--      coordonnées masquées AVANT l'écriture par le masquage des messages (`messaging_mask_contacts`
--      de 0161, appelé par `core.messaging_mask_text`, BR-REVIEW-07 « détection des données
--      personnelles avant publication ») : seul le texte masqué est gardé (minimisation).
--   4. Publication (BR-REVIEW-02, OQ-P2P-06) : au premier des deux termes, ni modification ni
--      prolongation : (a) les deux parties ont noté ⇒ publication des deux avis dans la transaction
--      du SECOND enregistrement, au même instant ; (b) échéance de la fenêtre atteinte ⇒ le
--      travailleur `review_publisher` publie l'avis donné. Les deux chemins se sérialisent par un
--      verrou consultatif de transaction par trip ; la publication est idempotente (UQ de 0104 sur
--      (trip, auteur, sujet), agrégat incrémenté pour les seules lignes insérées) : rejeu, deux
--      travailleurs ou un travailleur et un second enregistrement concurrents ⇒ une publication.
--   5. Lectures (aucun droit sur les tables ; prénom seulement, jamais un nom de famille, un
--      contact ni un identifiant de personne) : avis d'un trip pour une partie (S13, A12 : mon avis,
--      avis publiés du trip et, pour l'hôte, profil du voyageur : avis publiés des hôtes sur lui) ;
--      avis reçus par la personne de la session (droit d'accès, Ley 81 ; A13) ; profil public de
--      l'hôte d'une annonce LISTED (LST-020 : prénom, ancienneté au mois, nombre de trips réalisés,
--      note et derniers avis publiés). Nombre de trips : même définition que 0104 (COMPLETED,
--      IN_DISPUTE). Aucun événement ni notification : l'invitation et l'avis de publication
--      (`EVT_REVIEW_INVITATION`, `EVT_REVIEW_PUBLISHED` de 16) sont une suite (ADR-190).
--   6. Avis de l'ops (RECORD_REVIEW, US-218 ; revue du 2026-11-20) : la commande liée de 0104 est
--      remplacée (même signature, propriétaire et droits) : l'avis reçu par e-mail est SCELLÉ comme
--      un avis de l'appli (source OPS_RECORDED, action et agent tracés), sous le même verrou du
--      trip, avec la même fin de fenêtre (première ligne RETURNED, au fuseau du trip ; plus la fin
--      prévue), et publié avec l'autre avis ou à l'échéance ; un avis de l'ops et un avis de
--      l'appli de la même partie s'excluent.
--
-- Issues rendues (jamais levées) :
--   enregistrement : DONE (statut SUBMITTED ou PUBLISHED), AUTH_REQUIRED, NOT_FOUND,
--     REQUEST_INVALID, REVIEW_INVALID, REVIEW_TEXT_REQUIRED, REVIEW_NOT_OPEN, REVIEW_WINDOW_CLOSED,
--     REVIEW_WINDOW_UNKNOWN, REVIEW_ALREADY_SUBMITTED ;
--   lectures : DONE, AUTH_REQUIRED, NOT_FOUND (trip ou annonce), REQUEST_INVALID.
--   Le travailleur lève insufficient_privilege hors de `review_publisher` et invalid_parameter_value
--   pour un lot hors bornes.
--
-- Expand / contract : colonnes NULL ajoutées à `review_review` (texte masqué, sous-notes de l'hôte,
-- scellé d'origine), contrainte `review_source_valid` supprimée et recréée sous le même nom avec une
-- valeur de plus (IN_APP ; lignes existantes : OPS_RECORDED, toujours valides), contraintes de forme
-- ajoutées (lignes existantes : colonnes nouvelles NULL) ; une table ; politiques et droits de
-- colonnes ajoutés ; fonctions ajoutées ; commande liée de RECORD_REVIEW (0104) remplacée à
-- signature, propriétaire et droits identiques (issues inchangées ; l'avis n'est plus publié à
-- l'enregistrement mais scellé) ; aucun droit retiré.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.review_worker_publish_due(integer), core.review_cmd_submit(bytea, uuid,
--     integer, jsonb, text), core.review_trip_read(bytea, uuid), core.review_my_received(bytea),
--     core.review_listing_host_profile(uuid), core.review_publish_trip(uuid),
--     core.review_window_of(uuid), core.review_public_view(uuid), core.messaging_mask_text(text) ;
--   DROP POLICY review_cmd_ins_app ON core.review_review ;
--   DROP POLICY review_cmd_read ON core.iam_user_account ;
--   DROP TABLE core.review_submission ;
--   ALTER TABLE core.review_review DROP CONSTRAINT review_in_app_traced, review_body_length,
--     review_guest_scores_only, review_host_scores_only, DROP COLUMN submission_id, body,
--     contact_masked, punctuality, return_condition, rules_respect ; recréer review_source_valid
--     avec ('OPS_RECORDED') seulement (aucune ligne IN_APP) ;
--   réappliquer core.review_manual_action_record_review de 0104 (sous review_cmd_owner) ;
--   révoquer les droits accordés ci-dessous (review_cmd_owner).

-- 1. Registre public des avis (0104) : texte masqué, sous-notes de l'hôte, scellé d'origine ------
ALTER TABLE core.review_review
  ADD COLUMN submission_id    uuid,
  ADD COLUMN body             text,
  ADD COLUMN contact_masked   boolean,
  ADD COLUMN punctuality      smallint
    CONSTRAINT review_punctuality_range CHECK (punctuality BETWEEN 1 AND 5),
  ADD COLUMN return_condition smallint
    CONSTRAINT review_return_condition_range CHECK (return_condition BETWEEN 1 AND 5),
  ADD COLUMN rules_respect    smallint
    CONSTRAINT review_rules_respect_range CHECK (rules_respect BETWEEN 1 AND 5);
COMMENT ON COLUMN core.review_review.body IS
  'Texte publié de l''avis [C2], coordonnées masquées avant l''écriture (BR-REVIEW-07) ; NULL pour un '
  'avis enregistré par l''ops (le texte reste dans l''e-mail, ADR-130). US-317 (ADR-190).';
COMMENT ON COLUMN core.review_review.submission_id IS
  'Scellé (core.review_submission) dont la publication a écrit cette ligne (source IN_APP). US-317.';

-- source IN_APP (US-317) : contrainte recréée sous le même nom, une valeur de plus
ALTER TABLE core.review_review DROP CONSTRAINT review_source_valid;
ALTER TABLE core.review_review ADD CONSTRAINT review_source_valid
  CHECK (source IN ('OPS_RECORDED', 'IN_APP'));
ALTER TABLE core.review_review
  ADD CONSTRAINT review_in_app_traced CHECK (
    source <> 'IN_APP'
    OR (submission_id IS NOT NULL AND manual_action_id IS NULL AND recorded_by IS NULL
        AND contact_masked IS NOT NULL)),
  ADD CONSTRAINT review_from_submission_masked CHECK (
    submission_id IS NULL OR contact_masked IS NOT NULL),
  ADD CONSTRAINT review_body_length CHECK (
    body IS NULL OR pg_catalog.char_length(body) BETWEEN 1 AND 1000),
  -- sous-notes du voyageur (propreté, praticité, exactitude, entretien) : avis du voyageur seul
  ADD CONSTRAINT review_guest_scores_only CHECK (
    author_role = 'GUEST'
    OR (cleanliness IS NULL AND convenience IS NULL AND accuracy IS NULL AND maintenance IS NULL)),
  -- sous-notes de l'hôte (ponctualité, état de restitution, respect des règles) : avis de l'hôte
  ADD CONSTRAINT review_host_scores_only CHECK (
    author_role = 'HOST'
    OR (punctuality IS NULL AND return_condition IS NULL AND rules_respect IS NULL));
CREATE INDEX review_review_submission_idx ON core.review_review (submission_id)
  WHERE submission_id IS NOT NULL;
CREATE INDEX review_review_trip_idx ON core.review_review (trip_id);

-- 2. Scellé des avis donnés dans l'application ------------------------------------------------------
CREATE TABLE core.review_submission (
  id               uuid        CONSTRAINT review_submission_pkey PRIMARY KEY,
  trip_id          uuid        NOT NULL
    CONSTRAINT review_submission_trip_fkey REFERENCES core.booking_trip (id),
  country_code     text        NOT NULL
    CONSTRAINT review_submission_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  author_user_id   uuid        NOT NULL
    CONSTRAINT review_submission_author_fkey REFERENCES core.iam_user_account (id),
  author_role      text        NOT NULL
    CONSTRAINT review_submission_role_valid CHECK (author_role IN ('GUEST', 'HOST')),
  overall          smallint    NOT NULL
    CONSTRAINT review_submission_overall_range CHECK (overall BETWEEN 1 AND 5),
  cleanliness      smallint CONSTRAINT review_submission_cleanliness CHECK (cleanliness BETWEEN 1 AND 5),
  communication    smallint CONSTRAINT review_submission_communication CHECK (communication BETWEEN 1 AND 5),
  convenience      smallint CONSTRAINT review_submission_convenience CHECK (convenience BETWEEN 1 AND 5),
  accuracy         smallint CONSTRAINT review_submission_accuracy CHECK (accuracy BETWEEN 1 AND 5),
  maintenance      smallint CONSTRAINT review_submission_maintenance CHECK (maintenance BETWEEN 1 AND 5),
  punctuality      smallint CONSTRAINT review_submission_punctuality CHECK (punctuality BETWEEN 1 AND 5),
  return_condition smallint CONSTRAINT review_submission_return_condition CHECK (return_condition BETWEEN 1 AND 5),
  rules_respect    smallint CONSTRAINT review_submission_rules_respect CHECK (rules_respect BETWEEN 1 AND 5),
  -- texte masqué (seul gardé) ; obligatoire d'au moins 25 caractères pour une note de 1 à 3
  body             text
    CONSTRAINT review_submission_body_length CHECK (
      body IS NULL OR pg_catalog.char_length(body) BETWEEN 1 AND 1000),
  contact_masked   boolean     NOT NULL,
  -- IN_APP : donné dans l'application ; OPS_RECORDED : reçu hors application et enregistré par
  -- l'ops (RECORD_REVIEW, US-218), scellé de la même façon (ADR-190, revue du 2026-11-20)
  source           text        NOT NULL
    CONSTRAINT review_submission_source_valid CHECK (source IN ('IN_APP', 'OPS_RECORDED')),
  manual_action_id uuid,
  recorded_by      uuid,
  submitted_at     timestamptz NOT NULL,
  -- échéance de la fenêtre figée à l'enregistrement (ni prolongation, BR-REVIEW-02)
  window_closes_at timestamptz NOT NULL,
  CONSTRAINT review_submission_once UNIQUE (trip_id, author_role),
  CONSTRAINT review_submission_ops_traced CHECK (
    (source = 'OPS_RECORDED') = (manual_action_id IS NOT NULL AND recorded_by IS NOT NULL)),
  CONSTRAINT review_submission_window CHECK (submitted_at < window_closes_at),
  CONSTRAINT review_submission_text_required CHECK (
    overall > 3 OR (body IS NOT NULL AND pg_catalog.char_length(body) >= 25)),
  CONSTRAINT review_submission_guest_scores CHECK (
    author_role = 'GUEST'
    OR (cleanliness IS NULL AND convenience IS NULL AND accuracy IS NULL AND maintenance IS NULL)),
  CONSTRAINT review_submission_host_scores CHECK (
    author_role = 'HOST'
    OR (punctuality IS NULL AND return_condition IS NULL AND rules_respect IS NULL))
);
CREATE INDEX review_submission_due_idx ON core.review_submission (window_closes_at);
COMMENT ON TABLE core.review_submission IS
  'Scellé des avis donnés dans l''application (double aveugle, BR-REVIEW-02) : lu par son auteur '
  'seul, jamais servi à l''autre partie ; publié dans review_review au premier des deux termes. '
  'Immuable. US-317 (ADR-190).';

ALTER TABLE core.review_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.review_submission FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.review_submission FROM PUBLIC;
CREATE POLICY migrator_all ON core.review_submission TO migrator USING (true) WITH CHECK (true);
-- immuable, tout rôle (garde de 0104)
CREATE TRIGGER review_submission_guard BEFORE UPDATE OR DELETE ON core.review_submission
  FOR EACH ROW EXECUTE FUNCTION core.review_record_guard();
CREATE TRIGGER review_submission_no_truncate BEFORE TRUNCATE ON core.review_submission
  FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard();

-- 3. Droits au plus juste de review_cmd_owner (0104) ----------------------------------------------
GRANT SELECT, INSERT ON core.review_submission TO review_cmd_owner;
CREATE POLICY review_cmd_sel ON core.review_submission FOR SELECT TO review_cmd_owner USING (true);
CREATE POLICY review_cmd_ins ON core.review_submission FOR INSERT TO review_cmd_owner
  WITH CHECK (true);
-- publication d'un scellé (la politique de 0104 reste celle des avis de l'ops)
CREATE POLICY review_cmd_ins_app ON core.review_review FOR INSERT TO review_cmd_owner
  WITH CHECK (status = 'PUBLISHED' AND submission_id IS NOT NULL);
-- fuseau du trip (fenêtre au fuseau du trip)
GRANT SELECT (timezone) ON core.booking_trip TO review_cmd_owner;
-- prénom affiché (premier mot du prénom légal ; compte pseudonymisé : rien) et ancienneté
GRANT SELECT (id, legal_first_name, pseudonymized_at, created_at) ON core.iam_user_account
  TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.iam_user_account FOR SELECT TO review_cmd_owner
  USING (true);
-- identité de la session (fonction d'iam_auth_owner : seul son propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO review_cmd_owner;
RESET ROLE;

-- 4. Masquage des coordonnées d'un texte, pour REV (propriétaire messaging_cmd_owner) ------------
-- `messaging_mask_contacts` (0161) s'exécute avec les droits de l'appelant (normalisation de 0084,
-- codes des devises) : cette porte SECURITY DEFINER la sert à review_cmd_owner sans lui donner ces
-- droits. Rend le texte masqué et les natures trouvées ; aucune écriture.
GRANT CREATE ON SCHEMA core TO messaging_cmd_owner;
SET LOCAL ROLE messaging_cmd_owner;
CREATE FUNCTION core.messaging_mask_text(p_text text, OUT masked text, OUT kinds text[])
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.masked, m.kinds FROM core.messaging_mask_contacts(p_text) AS m
$fn$;
COMMENT ON FUNCTION core.messaging_mask_text(text) IS
  'Masquage des coordonnées d''un texte (MSG-007, même détection que les messages) pour le texte '
  'des avis (BR-REVIEW-07). SECURITY DEFINER, EXECUTE review_cmd_owner. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.messaging_mask_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.messaging_mask_text(text) TO review_cmd_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM messaging_cmd_owner;

-- 5. Fonctions de REV (propriétaire review_cmd_owner) ----------------------------------------------
GRANT CREATE ON SCHEMA core TO review_cmd_owner;
SET LOCAL ROLE review_cmd_owner;

-- 5.1 Fenêtre d'un trip (aide interne, droits de l'appelant) : fin effective (première ligne
-- RETURNED, ADR-183) et échéance = fin effective + review_window_days du pays, à la même heure
-- murale du fuseau du trip. Fin inconnue : ended_at NULL ; paramètre absent ou mal formé :
-- closes_at NULL.
CREATE FUNCTION core.review_window_of(p_trip_id uuid)
  RETURNS TABLE (ended_at timestamptz, closes_at timestamptz, window_days integer)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip  record;
  v_end   timestamptz;
  v_days  jsonb;
  v_now   timestamptz := platform.now();
BEGIN
  SELECT t.id, t.country_code, t.timezone INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF v_trip.id IS NULL THEN
    RETURN QUERY SELECT NULL::timestamptz, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;
  SELECT pg_catalog.min(l.at) INTO v_end
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = p_trip_id AND l.to_status = 'RETURNED';
  SELECT v.value INTO v_days
    FROM core.config_param_value AS v
   WHERE v.key = 'review_window_days' AND v.country_code::text = v_trip.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_days IS NULL OR pg_catalog.jsonb_typeof(v_days) <> 'number'
     OR (v_days #>> '{}') !~ '^[1-9][0-9]{0,2}$' OR v_trip.timezone IS NULL THEN
    RETURN QUERY SELECT v_end, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v_end,
         CASE WHEN v_end IS NOT NULL
              THEN ((v_end AT TIME ZONE v_trip.timezone)
                    + pg_catalog.make_interval(days => (v_days #>> '{}')::integer))
                   AT TIME ZONE v_trip.timezone
         END,
         (v_days #>> '{}')::integer;
END
$fn$;
COMMENT ON FUNCTION core.review_window_of(uuid) IS
  'Fenêtre de notation d''un trip : fin effective (première ligne RETURNED, ADR-183) et échéance '
  'à review_window_days jours au fuseau du trip. Aide interne de review_cmd_owner. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_window_of(uuid) FROM PUBLIC;

-- 5.2 Publication des scellés d'un trip (aide interne, droits de l'appelant ; l'appelant tient le
-- verrou consultatif du trip). Recopie chaque scellé non publié dans review_review (voyageur :
-- sujets VEHICLE et HOST ; hôte : sujet GUEST), au même instant, et tient les agrégats des seules
-- lignes insérées. Idempotente (UQ de 0104). Rend le nombre de scellés publiés.
CREATE FUNCTION core.review_publish_trip(p_trip_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
  v_ids uuid[];
  v_n   integer;
BEGIN
  WITH s AS (
    SELECT sub.*
      FROM core.review_submission AS sub
     WHERE sub.trip_id = p_trip_id
       AND NOT EXISTS (SELECT 1 FROM core.review_review AS r WHERE r.submission_id = sub.id)
  ), subj AS (
    SELECT s.*, x.ord, x.subject_type, x.subject_id
      FROM s
      JOIN core.booking_trip AS t ON t.id = s.trip_id
     CROSS JOIN LATERAL (VALUES (1, 'VEHICLE', t.vehicle_id), (2, 'HOST', t.org_id),
                                (3, 'GUEST', t.guest_user_id)) AS x(ord, subject_type, subject_id)
     WHERE (s.author_role = 'GUEST' AND x.subject_type IN ('VEHICLE', 'HOST'))
        OR (s.author_role = 'HOST' AND x.subject_type = 'GUEST')
  ), ins AS (
    INSERT INTO core.review_review AS r
           (id, trip_id, country_code, author_user_id, author_role, subject_type, subject_id,
            overall, cleanliness, communication, convenience, accuracy, maintenance, punctuality,
            return_condition, rules_respect, body, contact_masked, status, source,
            manual_action_id, recorded_by, submission_id, published_at, created_at)
    SELECT platform.uuid_v7(), subj.trip_id, subj.country_code, subj.author_user_id,
           subj.author_role, subj.subject_type, subj.subject_id, subj.overall, subj.cleanliness,
           subj.communication, subj.convenience, subj.accuracy, subj.maintenance,
           subj.punctuality, subj.return_condition, subj.rules_respect, subj.body,
           subj.contact_masked, 'PUBLISHED', subj.source, subj.manual_action_id,
           subj.recorded_by, subj.id, v_now, v_now
      FROM subj
     ORDER BY subj.ord
    ON CONFLICT ON CONSTRAINT review_unique_per_party DO NOTHING
    RETURNING r.id
  )
  SELECT pg_catalog.array_agg(ins.id) INTO v_ids FROM ins;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- agrégats des sujets publiés, même transaction (ordre fixe des sujets, formule de 0104)
  INSERT INTO core.review_rating_aggregate AS a
         (subject_type, subject_id, review_count, overall_sum, avg_overall_x100, updated_at)
  SELECT r.subject_type, r.subject_id, 1, r.overall, r.overall * 100, v_now
    FROM core.review_review AS r
   WHERE r.id = ANY (v_ids)
   ORDER BY CASE r.subject_type WHEN 'VEHICLE' THEN 1 WHEN 'HOST' THEN 2 ELSE 3 END
  ON CONFLICT ON CONSTRAINT review_rating_aggregate_pkey DO UPDATE
     SET review_count = a.review_count + 1,
         overall_sum = a.overall_sum + EXCLUDED.overall_sum,
         avg_overall_x100 = ((a.overall_sum + EXCLUDED.overall_sum) * 200 + (a.review_count + 1))
                            / (2 * (a.review_count + 1)),
         updated_at = EXCLUDED.updated_at;

  SELECT pg_catalog.count(DISTINCT r.submission_id)::integer INTO v_n
    FROM core.review_review AS r WHERE r.id = ANY (v_ids);
  RETURN v_n;
END
$fn$;
COMMENT ON FUNCTION core.review_publish_trip(uuid) IS
  'Publication des scellés d''un trip (BR-REVIEW-02) : recopie dans review_review au même instant, '
  'agrégats des seules lignes insérées ; idempotente. Aide interne de review_cmd_owner, appelée '
  'sous le verrou consultatif du trip. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_publish_trip(uuid) FROM PUBLIC;

-- 5.3 Avis publié servi (aide interne) : prénom de l'auteur, rôle, notes, texte masqué, heure de
-- publication ; jamais un identifiant de personne ni un nom de famille. Une ligne par avis : celle
-- du sujet HOST pour un avis du voyageur (le sujet VEHICLE porte la même note et le même texte).
CREATE FUNCTION core.review_public_view(p_review_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'authorRole', r.author_role,
           'authorName', NULLIF(pg_catalog.left(pg_catalog.split_part(
                                  pg_catalog.btrim(u.legal_first_name), ' ', 1), 40), ''),
           'overall', r.overall,
           'subScores', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                          'cleanliness', r.cleanliness, 'communication', r.communication,
                          'convenience', r.convenience, 'accuracy', r.accuracy,
                          'maintenance', r.maintenance, 'punctuality', r.punctuality,
                          'returnCondition', r.return_condition,
                          'rulesRespect', r.rules_respect)),
           'text', r.body,
           'publishedAt', pg_catalog.to_char(r.published_at AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM core.review_review AS r
    LEFT JOIN core.iam_user_account AS u
      ON u.id = r.author_user_id AND u.pseudonymized_at IS NULL
   WHERE r.id = p_review_id AND r.status = 'PUBLISHED'
$fn$;
COMMENT ON FUNCTION core.review_public_view(uuid) IS
  'Avis publié servi : prénom de l''auteur, rôle, notes, texte masqué, heure de publication ; aucun '
  'identifiant de personne. Aide interne de review_cmd_owner. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_public_view(uuid) FROM PUBLIC;

-- 5.4 Enregistrement de l'avis de la partie du trip de la session (S13, A12)
CREATE FUNCTION core.review_cmd_submit(p_token_hash bytea, p_trip_id uuid, p_overall integer,
                                       p_sub_scores jsonb, p_text text)
  RETURNS TABLE (outcome text, status text, submitted_at timestamptz, published_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c_guest_keys constant text[] := ARRAY['cleanliness', 'communication', 'convenience', 'accuracy',
                                        'maintenance'];
  c_host_keys  constant text[] := ARRAY['punctuality', 'returnCondition', 'communication',
                                        'rulesRespect'];
  v_user   uuid;
  v_trip   record;
  v_role   text;
  v_holder uuid;
  v_sub    jsonb := COALESCE(p_sub_scores, '{}'::jsonb);
  v_key    text;
  v_val    jsonb;
  v_text   text;
  v_kinds  text[];
  v_win    record;
  v_now    timestamptz;
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_other  boolean;
  v_pub    timestamptz;
BEGIN
  IF p_trip_id IS NULL OR p_overall IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- personne de la SESSION (IDOR : jamais un identifiant de personne reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- partie du trip : voyageur, ou titulaire du compte d'hôte ; co-hôte, tiers, trip inconnu :
  -- même issue
  SELECT t.id, t.country_code, t.org_id, t.guest_user_id INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF v_trip.id IS NOT NULL THEN
    SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = v_trip.org_id;
    v_role := CASE WHEN v_trip.guest_user_id = v_user THEN 'GUEST'
                   WHEN v_holder = v_user THEN 'HOST' END;
  END IF;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- contenu (BR-REVIEW-03, BR-REVIEW-04) : jugé avant toute lecture d'état
  IF p_overall < 1 OR p_overall > 5 OR pg_catalog.jsonb_typeof(v_sub) <> 'object' THEN
    RETURN QUERY SELECT 'REVIEW_INVALID'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  FOR v_key, v_val IN SELECT e.key, e.value FROM pg_catalog.jsonb_each(v_sub) AS e LOOP
    IF NOT (v_key = ANY (CASE v_role WHEN 'GUEST' THEN c_guest_keys ELSE c_host_keys END))
       OR pg_catalog.jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ '^[1-5]$' THEN
      RETURN QUERY SELECT 'REVIEW_INVALID'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
      RETURN;
    END IF;
  END LOOP;
  -- texte normalisé (NFKC) et coordonnées masquées AVANT toute écriture (BR-REVIEW-07, même
  -- détection que les messages) : seul le texte masqué est jugé et gardé
  IF p_text IS NOT NULL THEN
    SELECT m.masked, m.kinds INTO v_text, v_kinds FROM core.messaging_mask_text(p_text) AS m;
    IF v_kinds IS NULL THEN
      RAISE EXCEPTION 'avis : masquage indisponible'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    -- blancs de bord retirés par une classe explicite (espaces, tabulations, fins de ligne)
    v_text := NULLIF(pg_catalog.regexp_replace(v_text, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                     '');
  END IF;
  IF v_text IS NOT NULL AND pg_catalog.char_length(v_text) > 1000 THEN
    RETURN QUERY SELECT 'REVIEW_INVALID'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_overall <= 3 AND (v_text IS NULL OR pg_catalog.char_length(v_text) < 25) THEN
    RETURN QUERY SELECT 'REVIEW_TEXT_REQUIRED'::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz;
    RETURN;
  END IF;

  -- avis du trip sérialisés (verrou consultatif de transaction, par trip) : deux enregistrements,
  -- ou un enregistrement et le travailleur, se suivent ; le second lit l'état du premier
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('review_trip:' || p_trip_id::text, 0));
  v_now := platform.now();

  -- une fois par partie (scellé, ou avis déjà enregistré par l'ops, US-218)
  IF EXISTS (SELECT 1 FROM core.review_submission AS s
              WHERE s.trip_id = p_trip_id AND s.author_role = v_role)
     OR EXISTS (SELECT 1 FROM core.review_review AS r
                 WHERE r.trip_id = p_trip_id AND r.author_role = v_role) THEN
    RETURN QUERY SELECT 'REVIEW_ALREADY_SUBMITTED'::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz;
    RETURN;
  END IF;
  -- fenêtre : fin effective (ADR-183) + review_window_days au fuseau du trip ; close à l'échéance
  SELECT * INTO v_win FROM core.review_window_of(p_trip_id);
  IF v_win.ended_at IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_NOT_OPEN'::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_win.closes_at IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_UNKNOWN'::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v_now < v_win.ended_at OR v_now >= v_win.closes_at THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_CLOSED'::text, NULL::text, NULL::timestamptz,
                        NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO core.review_submission
         (id, trip_id, country_code, author_user_id, author_role, overall, cleanliness,
          communication, convenience, accuracy, maintenance, punctuality, return_condition,
          rules_respect, body, contact_masked, source, submitted_at, window_closes_at)
  VALUES (v_id, p_trip_id, v_trip.country_code, v_user, v_role, p_overall::smallint,
          (v_sub ->> 'cleanliness')::smallint, (v_sub ->> 'communication')::smallint,
          (v_sub ->> 'convenience')::smallint, (v_sub ->> 'accuracy')::smallint,
          (v_sub ->> 'maintenance')::smallint, (v_sub ->> 'punctuality')::smallint,
          (v_sub ->> 'returnCondition')::smallint, (v_sub ->> 'rulesRespect')::smallint,
          v_text, COALESCE(pg_catalog.cardinality(v_kinds) > 0, false), 'IN_APP', v_now,
          v_win.closes_at);

  -- l'autre partie a déjà noté (scellé ou avis de l'ops) : publication simultanée, ici
  v_other := EXISTS (SELECT 1 FROM core.review_submission AS s
                      WHERE s.trip_id = p_trip_id AND s.author_role <> v_role)
             OR EXISTS (SELECT 1 FROM core.review_review AS r
                         WHERE r.trip_id = p_trip_id AND r.author_role <> v_role);
  IF v_other THEN
    PERFORM core.review_publish_trip(p_trip_id);
    SELECT pg_catalog.min(r.published_at) INTO v_pub
      FROM core.review_review AS r WHERE r.submission_id = v_id;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, CASE WHEN v_pub IS NULL THEN 'SUBMITTED' ELSE 'PUBLISHED' END,
                      v_now, v_pub;
END
$fn$;
COMMENT ON FUNCTION core.review_cmd_submit(bytea, uuid, integer, jsonb, text) IS
  'Avis de la partie du trip de la session (voyageur ou titulaire du compte d''hôte) : fenêtre '
  'review_window_days depuis la fin effective, une fois, texte exigé de 1 à 3, coordonnées masquées ; '
  'scellé jusqu''à la publication simultanée (second avis) ou l''échéance. SECURITY DEFINER, EXECUTE '
  'app_api. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_cmd_submit(bytea, uuid, integer, jsonb, text) FROM PUBLIC;

-- 5.5 Avis d'un trip pour une partie du trip de la session (S13, A12) : rôle, prénom de l'autre
-- partie, fenêtre, MON avis (scellé ou publié), avis PUBLIÉS du trip et, pour l'hôte, profil du
-- voyageur (avis publiés des hôtes sur lui, 5 derniers). Jamais l'avis non publié de l'autre, ni
-- un signe qu'il existe.
CREATE FUNCTION core.review_trip_read(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, view jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_trip    record;
  v_holder  uuid;
  v_role    text;
  v_win     record;
  v_now     timestamptz := platform.now();
  v_name    text;
  v_mine    jsonb;
  v_pub     jsonb;
  v_profile jsonb;
  v_iso     constant text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT t.id, t.org_id, t.guest_user_id, t.timezone INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF v_trip.id IS NOT NULL THEN
    SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = v_trip.org_id;
    v_role := CASE WHEN v_trip.guest_user_id = v_user THEN 'GUEST'
                   WHEN v_holder = v_user THEN 'HOST' END;
  END IF;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_win FROM core.review_window_of(p_trip_id);
  -- prénom de l'autre partie (premier mot du prénom légal ; compte pseudonymisé : rien)
  SELECT NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name), ' ', 1),
                                40), '')
    INTO v_name
    FROM core.iam_user_account AS u
   WHERE u.pseudonymized_at IS NULL
     AND u.id = CASE v_role WHEN 'GUEST' THEN v_holder ELSE v_trip.guest_user_id END;

  -- mon avis : scellé (en attente ou publié), sinon avis enregistré par l'ops (publié)
  SELECT pg_catalog.jsonb_build_object(
           'status', CASE WHEN EXISTS (SELECT 1 FROM core.review_review AS r
                                        WHERE r.submission_id = s.id) THEN 'PUBLISHED'
                          ELSE 'SUBMITTED' END,
           'overall', s.overall,
           'subScores', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                          'cleanliness', s.cleanliness, 'communication', s.communication,
                          'convenience', s.convenience, 'accuracy', s.accuracy,
                          'maintenance', s.maintenance, 'punctuality', s.punctuality,
                          'returnCondition', s.return_condition,
                          'rulesRespect', s.rules_respect)),
           'text', s.body,
           'contactMasked', s.contact_masked,
           'submittedAt', pg_catalog.to_char(s.submitted_at AT TIME ZONE 'UTC', v_iso))
    INTO v_mine
    FROM core.review_submission AS s
   WHERE s.trip_id = p_trip_id AND s.author_role = v_role AND s.author_user_id = v_user;
  IF v_mine IS NULL THEN
    SELECT pg_catalog.jsonb_build_object(
             'status', 'PUBLISHED', 'overall', r.overall, 'subScores', '{}'::jsonb,
             'text', NULL, 'contactMasked', false,
             'submittedAt', pg_catalog.to_char(r.published_at AT TIME ZONE 'UTC', v_iso))
      INTO v_mine
      FROM core.review_review AS r
     WHERE r.trip_id = p_trip_id AND r.author_role = v_role AND r.status = 'PUBLISHED'
     ORDER BY r.subject_type DESC
     LIMIT 1;
  END IF;

  -- avis PUBLIÉS du trip (une ligne par auteur : sujet HOST pour le voyageur, GUEST pour l'hôte)
  SELECT COALESCE(pg_catalog.jsonb_agg(core.review_public_view(r.id)
                                       ORDER BY r.published_at, r.author_role), '[]'::jsonb)
    INTO v_pub
    FROM core.review_review AS r
   WHERE r.trip_id = p_trip_id AND r.status = 'PUBLISHED' AND r.subject_type IN ('HOST', 'GUEST');

  -- profil du voyageur, servi à l'hôte du trip (avis PUBLIÉS des hôtes sur lui, critère 3)
  IF v_role = 'HOST' THEN
    SELECT pg_catalog.jsonb_build_object(
             'reviewCount', COALESCE(a.review_count, 0),
             'averageX100', a.avg_overall_x100,
             'reviews', COALESCE((
               SELECT pg_catalog.jsonb_agg(core.review_public_view(x.id) ORDER BY x.published_at DESC)
                 FROM (SELECT r.id, r.published_at FROM core.review_review AS r
                        WHERE r.subject_type = 'GUEST' AND r.subject_id = v_trip.guest_user_id
                          AND r.status = 'PUBLISHED'
                        ORDER BY r.published_at DESC, r.id DESC LIMIT 5) AS x), '[]'::jsonb))
      INTO v_profile
      FROM (SELECT 1) AS one
      LEFT JOIN core.review_rating_aggregate AS a
        ON a.subject_type = 'GUEST' AND a.subject_id = v_trip.guest_user_id;
  END IF;

  RETURN QUERY SELECT 'DONE'::text, pg_catalog.jsonb_build_object(
    'viewerRole', v_role,
    'counterpartName', v_name,
    'timezone', v_trip.timezone,
    'windowDays', v_win.window_days,
    'endedAt', pg_catalog.to_char(v_win.ended_at AT TIME ZONE 'UTC', v_iso),
    'closesAt', pg_catalog.to_char(v_win.closes_at AT TIME ZONE 'UTC', v_iso),
    'canSubmit', (v_mine IS NULL AND v_win.ended_at IS NOT NULL AND v_win.closes_at IS NOT NULL
                  AND v_now >= v_win.ended_at AND v_now < v_win.closes_at),
    'mine', v_mine,
    'published', v_pub,
    'guestProfile', v_profile);
END
$fn$;
COMMENT ON FUNCTION core.review_trip_read(bytea, uuid) IS
  'Avis d''un trip pour une partie du trip de la session (S13, A12) : fenêtre, mon avis, avis publiés '
  'du trip, profil du voyageur pour l''hôte ; jamais l''avis non publié de l''autre partie ; trip '
  'd''une autre personne ou inconnu : NOT_FOUND. SECURITY DEFINER, EXECUTE app_api. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_trip_read(bytea, uuid) FROM PUBLIC;

-- 5.6 Avis PUBLIÉS reçus par la personne de la session (droit d'accès, Ley 81 ; A13) : comme
-- voyageur (sujet GUEST) et comme hôte (sujet HOST des comptes dont elle est titulaire), 50
-- derniers de chaque, avec le nombre et la moyenne ×100 arrondie au demi supérieur (formule de 0104) ;
-- comme hôte, son propre prénom affiché, son ancienneté et ses trips réalisés (aperçu A13).
CREATE FUNCTION core.review_my_received(p_token_hash bytea)
  RETURNS TABLE (outcome text, view jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_orgs  uuid[];
  v_guest jsonb;
  v_host  jsonb;
  v_since text;
  v_name  text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT pg_catalog.array_agg(o.id) INTO v_orgs
    FROM core.iam_organization AS o WHERE o.holder_user_id = v_user;
  -- prénom affiché aux voyageurs (aperçu A13) et mois d'inscription de la personne elle-même
  SELECT pg_catalog.to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM'),
         NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name), ' ', 1),
                                40), '')
    INTO v_since, v_name
    FROM core.iam_user_account AS u WHERE u.id = v_user AND u.pseudonymized_at IS NULL;

  SELECT pg_catalog.jsonb_build_object(
           'reviewCount', pg_catalog.count(*),
           'averageX100', CASE WHEN pg_catalog.count(*) > 0
                               THEN (pg_catalog.sum(r.overall) * 200 + pg_catalog.count(*))
                                    / (2 * pg_catalog.count(*)) END,
           'reviews', COALESCE((
             SELECT pg_catalog.jsonb_agg(core.review_public_view(x.id) ORDER BY x.published_at DESC)
               FROM (SELECT q.id, q.published_at FROM core.review_review AS q
                      WHERE q.subject_type = 'GUEST' AND q.subject_id = v_user
                        AND q.status = 'PUBLISHED'
                      ORDER BY q.published_at DESC, q.id DESC LIMIT 50) AS x), '[]'::jsonb))
    INTO v_guest
    FROM core.review_review AS r
   WHERE r.subject_type = 'GUEST' AND r.subject_id = v_user AND r.status = 'PUBLISHED';

  IF v_orgs IS NOT NULL THEN
    SELECT pg_catalog.jsonb_build_object(
             'firstName', v_name,
             'memberSince', v_since,
             'tripCount', (SELECT pg_catalog.count(*) FROM core.booking_trip AS t
                            WHERE t.org_id = ANY (v_orgs) AND t.status IN ('COMPLETED', 'IN_DISPUTE')),
             'reviewCount', pg_catalog.count(*),
             'averageX100', CASE WHEN pg_catalog.count(*) > 0
                                 THEN (pg_catalog.sum(r.overall) * 200 + pg_catalog.count(*))
                                      / (2 * pg_catalog.count(*)) END,
             'reviews', COALESCE((
               SELECT pg_catalog.jsonb_agg(core.review_public_view(x.id) ORDER BY x.published_at DESC)
                 FROM (SELECT q.id, q.published_at FROM core.review_review AS q
                        WHERE q.subject_type = 'HOST' AND q.subject_id = ANY (v_orgs)
                          AND q.status = 'PUBLISHED'
                        ORDER BY q.published_at DESC, q.id DESC LIMIT 50) AS x), '[]'::jsonb))
      INTO v_host
      FROM core.review_review AS r
     WHERE r.subject_type = 'HOST' AND r.subject_id = ANY (v_orgs) AND r.status = 'PUBLISHED';
  END IF;

  RETURN QUERY SELECT 'DONE'::text,
                      pg_catalog.jsonb_build_object('asGuest', v_guest, 'asHost', v_host);
END
$fn$;
COMMENT ON FUNCTION core.review_my_received(bytea) IS
  'Avis publiés reçus par la personne de la session, comme voyageur et comme hôte (droit d''accès, '
  'Ley 81 ; A13) : nombre, moyenne, 50 derniers, prénom des auteurs. SECURITY DEFINER, EXECUTE '
  'app_api. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_my_received(bytea) FROM PUBLIC;

-- 5.7 Profil public de l'hôte d'une annonce LISTED (LST-020) : prénom, ancienneté au mois, nombre
-- de trips réalisés, nombre d'avis, moyenne ×100 et 5 derniers avis publiés sur l'hôte. Annonce
-- inconnue ou non LISTED, titulaire du compte pseudonymisé : NOT_FOUND. Ni nom de famille, ni contact, ni
-- identifiant de compte.
CREATE FUNCTION core.review_listing_host_profile(p_listing_id uuid)
  RETURNS TABLE (outcome text, view jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org    uuid;
  v_holder uuid;
  v_name   text;
  v_since  text;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT l.org_id INTO v_org
    FROM core.catalog_listing AS l WHERE l.id = p_listing_id AND l.status = 'LISTED';
  IF v_org IS NOT NULL THEN
    SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = v_org;
    SELECT NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name), ' ',
                                                        1), 40), ''),
           pg_catalog.to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM')
      INTO v_name, v_since
      FROM core.iam_user_account AS u
     WHERE u.id = v_holder AND u.pseudonymized_at IS NULL;
  END IF;
  IF v_name IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, pg_catalog.jsonb_build_object(
           'firstName', v_name,
           'memberSince', v_since,
           'tripCount', (SELECT pg_catalog.count(*) FROM core.booking_trip AS t
                          WHERE t.org_id = v_org AND t.status IN ('COMPLETED', 'IN_DISPUTE')),
           'reviewCount', COALESCE(a.review_count, 0),
           'averageX100', a.avg_overall_x100,
           'reviews', COALESCE((
             SELECT pg_catalog.jsonb_agg(core.review_public_view(x.id) ORDER BY x.published_at DESC)
               FROM (SELECT r.id, r.published_at FROM core.review_review AS r
                      WHERE r.subject_type = 'HOST' AND r.subject_id = v_org
                        AND r.status = 'PUBLISHED'
                      ORDER BY r.published_at DESC, r.id DESC LIMIT 5) AS x), '[]'::jsonb))
    FROM (SELECT 1) AS one
    LEFT JOIN core.review_rating_aggregate AS a
      ON a.subject_type = 'HOST' AND a.subject_id = v_org;
END
$fn$;
COMMENT ON FUNCTION core.review_listing_host_profile(uuid) IS
  'Profil public de l''hôte d''une annonce LISTED (LST-020) : prénom, ancienneté au mois, trips '
  'réalisés, note, 5 derniers avis publiés ; aucun identifiant ni nom de famille. SECURITY DEFINER, '
  'EXECUTE app_api. US-317 (ADR-190).';
REVOKE ALL ON FUNCTION core.review_listing_host_profile(uuid) FROM PUBLIC;

-- 5.8 Travailleur review_publisher : scellés dont la fenêtre est échue (ou dont l'autre partie a
-- noté par un autre chemin) publiés, un trip à la fois sous son verrou consultatif, dans l'ordre
-- des échéances (deux travailleurs prennent les verrous dans le même ordre). Rend le nombre de
-- scellés publiés.
CREATE FUNCTION core.review_worker_publish_due(p_batch integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_trip uuid;
  v_n    integer := 0;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'review_publisher' THEN
    RAISE EXCEPTION 'avis : réservé au travailleur review_publisher'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'avis : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_trip IN
    SELECT d.trip_id
      FROM (SELECT s.trip_id, pg_catalog.min(s.window_closes_at) AS due
              FROM core.review_submission AS s
             WHERE NOT EXISTS (SELECT 1 FROM core.review_review AS r WHERE r.submission_id = s.id)
               AND (s.window_closes_at <= v_now
                    OR EXISTS (SELECT 1 FROM core.review_review AS o
                                WHERE o.trip_id = s.trip_id AND o.author_role <> s.author_role))
             GROUP BY s.trip_id
             ORDER BY due, s.trip_id
             LIMIT p_batch) AS d
     ORDER BY d.due, d.trip_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('review_trip:' || v_trip::text, 0));
    v_n := v_n + core.review_publish_trip(v_trip);
  END LOOP;
  RETURN v_n;
END
$fn$;
COMMENT ON FUNCTION core.review_worker_publish_due(integer) IS
  'Travailleur review_publisher : scellés à l''échéance de la fenêtre (BR-REVIEW-02, J+10) publiés, '
  'un trip à la fois sous son verrou ; idempotent. SECURITY DEFINER, EXECUTE app_worker. US-317 '
  '(ADR-190).';
REVOKE ALL ON FUNCTION core.review_worker_publish_due(integer) FROM PUBLIC;


-- 5.9 Commande liée à RECORD_REVIEW (US-218, 0104) remplacée : même signature, même propriétaire
-- (review_cmd_owner), mêmes droits (EXECUTE iam_staff_owner). Bloc US-317 (revue du 2026-11-20) :
-- l'avis reçu par e-mail passe par le SCELLÉ comme un avis de l'appli (jamais lisible de l'autre
-- partie avant publication) ; verrou consultatif du trip ; même fin de fenêtre que l'appli (première
-- ligne RETURNED, au fuseau du trip) ; publication simultanée si l'autre partie a noté, sinon à
-- l'échéance par le travailleur review_publisher. Issues inchangées ; `ref_id` = le scellé.
CREATE OR REPLACE FUNCTION core.review_manual_action_record_review(p_token_hash bytea, p_action_id uuid,
                                                                    p_action_code text,
                                                                    p_subject_id uuid,
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
  v_role    text := p_input ->> 'authorRole';
  v_overall smallint;
  v_trip    record;
  v_win     record;
  v_author  uuid;
  v_now     timestamptz;
  v_id      uuid := pg_catalog.gen_random_uuid();
BEGIN
  v_overall := CASE p_input ->> 'overall'
                 WHEN 'ONE' THEN 1 WHEN 'TWO' THEN 2 WHEN 'THREE' THEN 3 WHEN 'FOUR' THEN 4
                 WHEN 'FIVE' THEN 5 END;
  IF p_action_code IS DISTINCT FROM 'RECORD_REVIEW' OR v_role IS NULL OR v_overall IS NULL
     OR v_role NOT IN ('GUEST', 'HOST') OR p_actor IS NULL OR p_action_id IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_INPUT_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- état qui fait foi en base (US-207) : trip COMPLETED seulement
  SELECT t.id, t.country_code, t.status, t.org_id, t.guest_user_id INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_subject_id;
  IF v_trip.id IS NULL OR v_trip.status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN QUERY SELECT 'REVIEW_TRIP_NOT_COMPLETED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- avis du trip sérialisés avec ceux de l'appli et le travailleur (même verrou)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('review_trip:' || p_subject_id::text, 0));
  v_now := platform.now();

  -- fenêtre : celle de l'appli (fin effective = première ligne RETURNED, ADR-183) ; sans fin
  -- effective : trip non réalisé (fail-closed) ; paramètre absent ou mal formé : refus
  SELECT * INTO v_win FROM core.review_window_of(p_subject_id);
  IF v_win.ended_at IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_TRIP_NOT_COMPLETED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_win.closes_at IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_now >= v_win.closes_at THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_CLOSED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- auteur relu en base, jamais reçu
  IF v_role = 'GUEST' THEN
    v_author := v_trip.guest_user_id;
  ELSE
    SELECT o.holder_user_id INTO v_author FROM core.iam_organization AS o WHERE o.id = v_trip.org_id;
  END IF;
  IF v_author IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_AUTHOR_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- une fois par partie (scellé de l'appli ou de l'ops, ou avis publié avant 0170)
  IF EXISTS (SELECT 1 FROM core.review_submission AS s
              WHERE s.trip_id = p_subject_id AND s.author_role = v_role)
     OR EXISTS (SELECT 1 FROM core.review_review AS r
                 WHERE r.trip_id = p_subject_id AND r.author_role = v_role) THEN
    RETURN QUERY SELECT 'REVIEW_ALREADY_RECORDED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  INSERT INTO core.review_submission
         (id, trip_id, country_code, author_user_id, author_role, overall, body, contact_masked,
          source, manual_action_id, recorded_by, submitted_at, window_closes_at)
  VALUES (v_id, p_subject_id, v_trip.country_code, v_author, v_role, v_overall, NULL, false,
          'OPS_RECORDED', p_action_id, p_actor, v_now, v_win.closes_at);

  -- l'autre partie a déjà noté : publication simultanée, ici
  IF EXISTS (SELECT 1 FROM core.review_submission AS s
              WHERE s.trip_id = p_subject_id AND s.author_role <> v_role)
     OR EXISTS (SELECT 1 FROM core.review_review AS r
                 WHERE r.trip_id = p_subject_id AND r.author_role <> v_role) THEN
    PERFORM core.review_publish_trip(p_subject_id);
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à RECORD_REVIEW (ADR-092) : avis reçu par e-mail pour un trip COMPLETED, dans la '
  'fenêtre de l''appli (fin effective + review_window_days), une fois par partie, SCELLÉ comme un avis '
  'de l''appli et publié avec l''autre ou à l''échéance. SECURITY DEFINER, EXECUTE iam_staff_owner. '
  'US-218 (ADR-130), US-317 (ADR-190).';

GRANT EXECUTE ON FUNCTION core.review_cmd_submit(bytea, uuid, integer, jsonb, text),
  core.review_trip_read(bytea, uuid), core.review_my_received(bytea),
  core.review_listing_host_profile(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.review_worker_publish_due(integer) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM review_cmd_owner;
