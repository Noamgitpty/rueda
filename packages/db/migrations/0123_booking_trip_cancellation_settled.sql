-- 0123 — AVL / STL / SUP : annulations du voyageur, de l'hôte et de la plateforme déclenchées par
-- l'ops, réglées par le moteur unique dans la transaction de la transition, remboursées par les
-- ordres bornés d'US-224a.
-- US-215 (partie 215a, serveur) ; 19 US-215 (critères 1 à 5, DoR du recalage du lot 2 : « le
-- règlement de l'annulation (08 SM-1, invariant 4) est calculé dans la même transaction que la
-- transition d'annulation […], qui pose alors settlement_id au journal et dans trip.status_changed ;
-- aucune route d'annulation n'est ouverte sans ce règlement ») ; 19 US-224 DoR (1) ; 16 BKG-028,
-- BKG-032, BKG-035, ADM-006 ; 08 BR-CXL-01, BR-CXL-06, BR-CXL-12, BR-CXL-13, BR-CXL-14, règles de
-- qualification 1 et 2, E7 règle 7, SM-1 invariant 4, SM-8 ; 17 §2.5 (verrous voyageur → véhicule →
-- trip), §3.2.4, §3.2.13, §4.5, §7.2, §10 ; ADR-092 (cadre des actions de console), ADR-122
-- (séparation des tâches), ADR-126 (machine à états du trip), ADR-145 (ordres de règlement) ;
-- ADR-148 (cette migration). Suites du BOARD : N-131 (en partie). Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-148, PROPOSÉS, comme Turo : le voyageur ou l'hôte demande l'annulation au support,
-- l'ops la déclenche, Kmino rembourse sans attendre l'hôte) :
--   1. l'ops DEMANDE l'annulation par la console (`CANCEL_TRIP_GUEST`, `CANCEL_TRIP_HOST`,
--      `CANCEL_TRIP_PLATFORM`, permission ops.platform_cancel, cadre d'US-101) ; la commande liée
--      `core.booking_manual_action_cancel_trip` DÉRIVE le motif demandé et l'initiateur de l'action
--      (jamais reçus : N-131), lit le sous-motif ou le motif plateforme dans une énumération FERMÉE,
--      pose l'heure SERVEUR de la demande (`platform.now()`, règle de qualification 1) et écrit une
--      demande `core.booking_trip_cancellation` (PENDING). Aucun montant n'est saisi ni lu ;
--   2. le travailleur `trip_lifecycle` règle chaque demande en UNE transaction (STL,
--      `TripCancellationProcessor`) : `core.booking_trip_cancellation_begin` (verrous voyageur →
--      véhicule → trip, faits du trip, devis figé, paramètres du pays), moteur unique de
--      `@rueda/money` (`cxl-beta/1`) sur le devis figé rejoué, `core.settlement_cmd_record`
--      (travailleur settlement), `core.booking_cmd_trip_cancel_settle` (ci-dessous), puis les ordres
--      REFUND bornés de 0121 (travailleur payment_command) ;
--   3. `core.booking_cmd_trip_cancel_settle` requalifie la demande en base (règles 1 et 2 de BR-CXL,
--      à l'heure de la DEMANDE ; preuve validée = au moins une pièce de la console jointe à l'action,
--      N-131), puis LIE le règlement à la demande : même trip, version 1, motif demandé, motif
--      qualifié, origine et état cible égaux à la qualification de la base ; événement, instants du
--      trip (départ, réservation) et paramètres du pays dans les entrées canoniques égaux aux faits
--      de la base (le rejeu de 0054 contrôle ensuite chaque montant et la base des jambes =
--      l'encaissé tenu par jambe) ; toute différence ⇒ refus, rien n'est écrit. La transition pose
--      `settlement_id` au journal et dans `trip.status_changed` (invariant 4) et libère le créneau
--      dans la même transaction (I-OCC, inchangé) ; `cost_bearer` est déduit du motif QUALIFIÉ ;
--   4. contrainte différée `trip_cancellation_refunded` : à la validation, une demande réglée porte
--      un trip encaissé (quatre jambes tenues, Σ = total payé du règlement) et des ordres REFUND non
--      échoués du règlement dont la somme est EXACTEMENT le remboursement du voyageur : jamais un
--      règlement d'annulation sans ses remboursements dans la même transaction (19 US-224 DoR (1)) ;
--   5. refus d'un calcul (règlement hors bornes, jambe négative : décision FINANCE d'US-224b ;
--      paramètre manquant ; état du trip devenu incompatible) : la transaction est annulée, puis la
--      demande est garée par `core.booking_cmd_trip_cancel_park` (FIN_REVIEW ou FAILED, code seul) ;
--      le trip ne change pas.
--
-- Codes (SQLSTATE, contrainte) traduits par packages/db/src/errors.ts, sans DETAIL :
--   trip_cancellation_closed (55000)             → CANCELLATION_NOT_PENDING (PROPOSÉ) ;
--   trip_cancellation_live_unique (23505)        → CANCELLATION_PENDING (PROPOSÉ ; défense de la
--                                                  commande liée, qui rend l'issue d'abord) ;
--   trip_cancellation_settlement_mismatch (23000) → INVARIANT_VIOLATION ;
--   trip_cancellation_uncaptured (23000)         → INVARIANT_VIOLATION ;
--   trip_cancellation_unrefunded (23000)         → INVARIANT_VIOLATION ;
--   trip_transition_forbidden, trip_param_missing, trip_command_forbidden : codes de 0099.
-- Issues de la commande liée (refus : rien n'est écrit) : DONE (ref_id = la demande),
--   NOT_FOUND, SELF_FORBIDDEN, CANCEL_REASON_REQUIRED (16 BKG-035), TRIP_TRANSITION_FORBIDDEN,
--   CANCELLATION_PENDING.
--
-- Hors de cette migration (passation docs/team/handoffs/US-215.md) : écrans de la console et
-- textes (215b) ; écriture de la pénalité au `host_ledger` (table d'US-224b : la pénalité est portée
-- par le règlement, `host_penalty_minor`, jamais par une jambe) ; annulation automatique
-- `PLATFORM_REVIEW_DELAY` à T−2 h et refus d'un trip payé en `PAY_THEN_REVIEW` (US-224b, N-201) ;
-- requalification SM-7 (versions n+1).
--
-- Expand / contract : table, fonctions, déclencheur, droits et politiques AJOUTÉS ; corps de
-- `core.booking_trip_apply_transition` (0099) remplacé à signature, propriétaire et droits
-- identiques (le règlement lu dans `p_extra`, absent ⇒ NULL comme avant) ; lignes du catalogue des
-- trois actions d'annulation : clés de saisie ajoutées (actions indisponibles jusqu'ici : aucune
-- ligne `manual_action` n'en dépend) ; liaisons ajoutées.
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code IN ('CANCEL_TRIP_GUEST',
--     'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM') ;
--   UPDATE core.support_manual_action_catalog SET input_keys = '{}', input_values = '{}'
--     WHERE action_code IN ('CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM') ;
--   réappliquer core.booking_trip_apply_transition de 0099 (sous cmd_hold_owner) ;
--   DROP TRIGGER trip_cancellation_refunded ON core.booking_trip_cancellation ;
--   DROP FUNCTION core.booking_manual_action_cancel_trip(bytea, uuid, text, uuid, jsonb, text, uuid,
--     text), core.booking_trip_cancellation_begin(uuid), core.booking_cmd_trip_cancel_settle(uuid,
--     uuid), core.booking_cmd_trip_cancel_park(uuid, text, text),
--     core.booking_trip_cancellations_pending(integer), core.booking_cancellation_params(text, text),
--     core.booking_cancellation_cost_bearer(text), core.booking_epoch_ms(timestamptz),
--     core.settlement_assert_cancellation_refunded(), core.settlement_cancellation_of(uuid) ;
--   DROP TABLE core.booking_trip_cancellation ;
--   DROP POLICY cmd_hold_cancel_read ON core.config_param_value, cmd_hold_cancel_read ON
--     core.support_manual_action ;
--   révoquer les droits accordés ci-dessous.

-- 1. Demande d'annulation (17 §3.2.4 ; classe C1, écrite par commande seulement) -----------------
CREATE TABLE core.booking_trip_cancellation (
  -- identifiant = celui de l'action de console (request_id de manual_action, idempotence d'US-101)
  id               uuid        NOT NULL,
  trip_id          uuid        NOT NULL,
  country_code     text        NOT NULL,
  action_code      text        NOT NULL,
  -- motif DEMANDÉ (table de décision de BR-CXL), dérivé de l'action et de la saisie fermée
  requested_reason text        NOT NULL,
  -- initiateur dérivé de l'action (audit et pénalités, jamais la branche : BR-CXL)
  initiator        text        NOT NULL,
  sub_reason       text,
  -- heure SERVEUR de la demande (règle de qualification 1)
  requested_at     timestamptz NOT NULL,
  -- agent de la console (acteur de la session élevée)
  requested_by     uuid        NOT NULL,
  status           text        NOT NULL DEFAULT 'PENDING',
  settlement_id    uuid,
  -- qui porte le coût (16 BKG-035), déduit du motif QUALIFIÉ au règlement
  cost_bearer      text,
  outcome_code     text,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT trip_cancellation_pkey PRIMARY KEY (id),
  CONSTRAINT trip_cancellation_trip_fkey FOREIGN KEY (trip_id) REFERENCES core.booking_trip (id),
  CONSTRAINT trip_cancellation_settlement_fkey
    FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement (id),
  CONSTRAINT trip_cancellation_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT trip_cancellation_action_valid CHECK (
    action_code IN ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM')),
  -- action ⇒ initiateur et motifs admis (motifs du sous-ensemble bêta, 17 NN3)
  CONSTRAINT trip_cancellation_reason_valid CHECK (
       (action_code = 'CANCEL_TRIP_GUEST' AND initiator = 'GUEST'
        AND requested_reason = 'GUEST_CANCELLED' AND sub_reason IS NULL)
    OR (action_code = 'CANCEL_TRIP_HOST' AND initiator = 'HOST'
        AND ((requested_reason = 'HOST_CANCELLED' AND sub_reason IS NULL)
          OR (requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
              AND sub_reason IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT',
                                 'LICENSE_NOT_UPLOADED_1H'))))
    OR (action_code = 'CANCEL_TRIP_PLATFORM' AND initiator = 'PLATFORM' AND sub_reason IS NULL
        AND requested_reason IN ('PLATFORM_TRUST_SAFETY', 'PLATFORM_INCOMPLETE_STEPS',
                                 'GUEST_FRAUD_PROVEN', 'HOST_ACCOUNT_CLOSED',
                                 'PLATFORM_REVIEW_DELAY', 'PSP_FAILURE'))),
  CONSTRAINT trip_cancellation_status_valid CHECK (
    status IN ('PENDING', 'SETTLED', 'FIN_REVIEW', 'FAILED')),
  CONSTRAINT trip_cancellation_cost_bearer_valid CHECK (
    cost_bearer IS NULL OR cost_bearer IN ('GUEST', 'HOST', 'PLATFORM')),
  CONSTRAINT trip_cancellation_outcome_format CHECK (
    outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  -- forme de chaque statut : réglée ⇔ règlement et porteur du coût ; garée ⇔ code ; décidée ⇔ heure
  CONSTRAINT trip_cancellation_status_shape CHECK (
    ((status = 'SETTLED') = (settlement_id IS NOT NULL))
    AND ((status = 'SETTLED') = (cost_bearer IS NOT NULL))
    AND ((status IN ('FIN_REVIEW', 'FAILED')) = (outcome_code IS NOT NULL))
    AND ((status = 'PENDING') = (decided_at IS NULL)))
);
-- une seule demande vivante (en attente, réglée ou en revue FINANCE) par trip ; un échec libère
CREATE UNIQUE INDEX trip_cancellation_live_unique ON core.booking_trip_cancellation (trip_id)
  WHERE status IN ('PENDING', 'SETTLED', 'FIN_REVIEW');
CREATE INDEX trip_cancellation_pending_idx ON core.booking_trip_cancellation (requested_at)
  WHERE status = 'PENDING';
CREATE UNIQUE INDEX trip_cancellation_settlement_unique
  ON core.booking_trip_cancellation (settlement_id) WHERE settlement_id IS NOT NULL;
COMMENT ON TABLE core.booking_trip_cancellation IS
  'Demande d''annulation d''un trip déclenchée par l''ops (CANCEL_TRIP_GUEST / HOST / PLATFORM) : '
  'motif demandé et initiateur dérivés de l''action, heure serveur de la demande ; réglée par le '
  'travailleur trip_lifecycle dans la transaction de la transition (règlement, ordres REFUND). '
  'Écrite par commande seulement. US-215, ADR-148.';
COMMENT ON COLUMN core.booking_trip_cancellation.cost_bearer IS
  'Qui porte le coût de l''annulation (16 BKG-035 cost_bearer) : GUEST, HOST ou PLATFORM, déduit '
  'du motif qualifié au règlement (PROPOSÉ, ADR-148). US-215.';

ALTER TABLE core.booking_trip_cancellation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip_cancellation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip_cancellation TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.booking_trip_cancellation FROM PUBLIC;

-- 2. Droits de cmd_hold_owner et de cmd_money_owner (au plus juste) ------------------------------
GRANT SELECT, INSERT (id, trip_id, country_code, action_code, requested_reason, initiator,
                      sub_reason, requested_at, requested_by),
      UPDATE (status, settlement_id, cost_bearer, outcome_code, decided_at)
  ON core.booking_trip_cancellation TO cmd_hold_owner;
CREATE POLICY cmd_hold_cancel_sel ON core.booking_trip_cancellation FOR SELECT TO cmd_hold_owner
  USING (true);
-- la demande naît de la console (contexte STAFF), en attente, sans règlement
CREATE POLICY cmd_hold_cancel_ins ON core.booking_trip_cancellation FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND requested_by = app.actor_id());
-- elle n'est réglée ou garée que par le travailleur trip_lifecycle, une seule fois
CREATE POLICY cmd_hold_cancel_upd ON core.booking_trip_cancellation FOR UPDATE TO cmd_hold_owner
  USING (status = 'PENDING'
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (status IN ('SETTLED', 'FIN_REVIEW', 'FAILED')
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');
GRANT SELECT (id, trip_id, status, settlement_id) ON core.booking_trip_cancellation
  TO cmd_money_owner;
CREATE POLICY cmd_money_cancel_sel ON core.booking_trip_cancellation FOR SELECT TO cmd_money_owner
  USING (true);

-- faits du trip lus par la commande liée et le travailleur (départ, réservation, devise, hold)
GRANT SELECT (id, guest_user_id, vehicle_id, org_id, status, country_code, currency,
              scheduled_start, booked_at, source_hold_id, row_version, no_show_at,
              checkin_validated_at)
  ON core.booking_trip TO cmd_hold_owner;
-- devis figé du trip (rejoué par le moteur de devis, jamais écrit)
GRANT SELECT (id, engine_version, inputs, inputs_hash, outputs, outputs_hash, total_minor, currency)
  ON core.pricing_quote TO cmd_hold_owner;
-- journal d'état : le règlement de l'annulation (invariant 4 de SM-1)
GRANT INSERT (settlement_id) ON core.booking_trip_state_log TO cmd_hold_owner;
-- règlement lié à la demande : lu par core.settlement_cancellation_of (cmd_money_owner, section
-- 11) ; aucun droit de cmd_hold_owner sur les tables de STL
-- pièces de l'action de console qui a créé la demande (preuve validée, N-131)
GRANT SELECT (id, action_code, subject_id, evidence_file_ids) ON core.support_manual_action
  TO cmd_hold_owner;
CREATE POLICY cmd_hold_cancel_read ON core.support_manual_action FOR SELECT TO cmd_hold_owner
  USING (action_code IN ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM'));
-- paramètres d'annulation du pays (17 §7.2) ; no_show_grace_minutes est déjà lue (0099)
CREATE POLICY cmd_hold_cancel_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('free_cancel_lead', 'last_minute_threshold', 'host_penalty',
                 'platform_funded_host_compensation'));

-- 3. Catalogue : saisies fermées des actions d'annulation (jamais un montant) -------------------
-- CANCEL_TRIP_HOST : sous-motif « à cause du voyageur » (08 règle 2) ; absent ⇒ HOST_CANCELLED.
-- Les valeurs du catalogue n'admettent aucun chiffre : LICENSE_NOT_UPLOADED désigne le sous-motif
-- LICENSE_NOT_UPLOADED_1H de 08.
UPDATE core.support_manual_action_catalog
   SET input_keys = '{subReason}',
       input_values = '{"subReason": ["INVALID_LICENSE", "IDENTITY_NOT_VERIFIED", "OTHER_DRIVER_SENT", "LICENSE_NOT_UPLOADED"]}'::jsonb
 WHERE action_code = 'CANCEL_TRIP_HOST';
-- CANCEL_TRIP_PLATFORM : motif plateforme obligatoire (16 BKG-035, CANCEL_REASON_REQUIRED)
UPDATE core.support_manual_action_catalog
   SET input_keys = '{platformReason}',
       input_values = '{"platformReason": ["PLATFORM_TRUST_SAFETY", "PLATFORM_INCOMPLETE_STEPS", "GUEST_FRAUD_PROVEN", "HOST_ACCOUNT_CLOSED", "PLATFORM_REVIEW_DELAY", "PSP_FAILURE"]}'::jsonb
 WHERE action_code = 'CANCEL_TRIP_PLATFORM';

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 4. Aides internes (SECURITY INVOKER, cmd_hold_owner ; aucun EXECUTE accordé) -------------------
-- Instant UTC en millisecondes entières (forme des entrées du moteur, 08 « Définitions »).
CREATE FUNCTION core.booking_epoch_ms(p_at timestamptz)
  RETURNS bigint
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.floor(EXTRACT(EPOCH FROM p_at) * 1000)::bigint
$fn$;

-- Porteur du coût selon le motif QUALIFIÉ (16 BKG-035, PROPOSÉ comme Turo) : le voyageur pour ses
-- annulations, son no-show, sa fraude et ses étapes incomplètes ; l'hôte pour ses annulations et la
-- fermeture de son compte ; sinon la plateforme (geste commercial plafonné à 0 tant que
-- DEC-FONDATEUR-01 est ouverte).
CREATE FUNCTION core.booking_cancellation_cost_bearer(p_reason text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_reason IN ('GUEST_CANCELLED', 'GUEST_NO_SHOW', 'HOST_CANCELLED_DUE_TO_GUEST',
                             'GUEST_FRAUD_PROVEN', 'PLATFORM_INCOMPLETE_STEPS') THEN 'GUEST'
           WHEN p_reason IN ('HOST_CANCELLED', 'HOST_NO_SHOW', 'HOST_ACCOUNT_CLOSED') THEN 'HOST'
           WHEN p_reason IN ('PLATFORM_TRUST_SAFETY', 'PLATFORM_REVIEW_DELAY', 'PSP_FAILURE')
             THEN 'PLATFORM'
         END
$fn$;

-- Paramètres du moteur pour le pays, à platform.now(), dans la forme CANONIQUE des entrées du
-- règlement (`SettlementParams` de @rueda/money, sérialisé par canonicalJson : montants
-- { "amountMinor": { "$bigint": "…" }, "currency": "…" }) ; NULL si un paramètre exigé manque ou
-- est mal formé (BLOCK : jamais une valeur par défaut). `host_penalty` absent ⇒ clé omise (le
-- moteur refuse s'il en a besoin) ; `platform_funded_host_compensation` absent ⇒ clé omise
-- (option B, DEC-FONDATEUR-01).
CREATE FUNCTION core.booking_cancellation_params(p_country text, p_currency text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts),
  v AS (
    SELECT DISTINCT ON (c.key) c.key, c.value
      FROM core.config_param_value AS c CROSS JOIN t
     WHERE c.key IN ('no_show_grace_minutes', 'last_minute_threshold', 'free_cancel_lead',
                     'host_penalty', 'platform_funded_host_compensation')
       AND c.country_code::text = p_country AND c.scope_type = 'COUNTRY'
       AND c.valid_from <= t.ts AND (c.valid_to IS NULL OR c.valid_to > t.ts)
     ORDER BY c.key, c.valid_from DESC
  ),
  p AS (
    SELECT (SELECT v.value FROM v WHERE v.key = 'no_show_grace_minutes') AS ngm,
           (SELECT v.value FROM v WHERE v.key = 'last_minute_threshold') AS lmt,
           (SELECT v.value FROM v WHERE v.key = 'free_cancel_lead') AS fcl,
           (SELECT v.value FROM v WHERE v.key = 'host_penalty') AS hp,
           (SELECT v.value FROM v WHERE v.key = 'platform_funded_host_compensation') AS pfhc
  )
  SELECT CASE
           WHEN p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN NULL
           WHEN pg_catalog.jsonb_typeof(p.ngm) IS DISTINCT FROM 'number'
                OR (p.ngm #>> '{}') !~ '^[0-9]{1,6}$'
                OR pg_catalog.jsonb_typeof(p.lmt) IS DISTINCT FROM 'number'
                OR (p.lmt #>> '{}') !~ '^[0-9]{1,6}$'
                OR pg_catalog.jsonb_typeof(p.fcl) IS DISTINCT FROM 'number'
                OR (p.fcl #>> '{}') !~ '^[0-9]{1,6}$' THEN NULL
           WHEN p.hp IS NOT NULL AND (
                  pg_catalog.jsonb_typeof(p.hp) IS DISTINCT FROM 'object'
                  OR (p.hp ->> 'cxlEarly') !~ '^[0-9]{1,18}$'
                  OR (p.hp ->> 'cxlLate') !~ '^[0-9]{1,18}$'
                  OR (p.hp ->> 'hostNoShow') !~ '^[0-9]{1,18}$'
                  OR (p.hp ->> 'cleanliness') !~ '^[0-9]{1,18}$'
                  OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p.hp)) <> 4)
             THEN NULL
           ELSE
             pg_catalog.jsonb_build_object(
               'noShowGraceMinutes', (p.ngm #>> '{}')::integer,
               'lastMinuteThresholdHours', (p.lmt #>> '{}')::integer,
               'freeCancelLeadHours', (p.fcl #>> '{}')::integer)
             || CASE WHEN p.hp IS NULL THEN '{}'::jsonb ELSE
                  pg_catalog.jsonb_build_object('hostPenalty', (
                    SELECT pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_object(
                             'amountMinor', pg_catalog.jsonb_build_object('$bigint',
                                              ((p.hp ->> k)::numeric)::text),
                             'currency', p_currency))
                      FROM pg_catalog.unnest(ARRAY['cxlEarly', 'cxlLate', 'hostNoShow',
                                                   'cleanliness']) AS k)) END
             || CASE WHEN p.pfhc IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('platformFundedHostCompensation', p.pfhc)
                END
         END
    FROM p
$fn$;

-- 5. Transition appliquée (0099, 10.2) : corps recopié ; seuls les blocs marqués US-215 changent
-- (règlement de l'annulation lu dans p_extra : journal et trip.status_changed ; absent ⇒ NULL,
-- comme avant pour toute autre transition et pour la commande d'annulation de 0099).
CREATE OR REPLACE FUNCTION core.booking_trip_apply_transition(
  p_trip_id    uuid,
  p_from       text,
  p_to         text,
  p_reason     text,
  p_origin     text,
  p_actor_role text,
  p_via        text,
  p_extra      jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version    integer;
  v_country    text;
  v_segment    uuid;
  -- US-215 (invariant 4 de SM-1) : règlement calculé dans la même transaction
  v_settlement uuid := (p_extra ->> 'settlementId')::uuid;
BEGIN
  -- 17 §4.5 : trip.cancellation.qualified porte le segment (le règlement est clé sur
  -- (trip, segment, version), 08 invariant 4). Bêta : le segment n° 1, écrit à la naissance (ou par
  -- le rattrapage de 0099) et jamais supprimé (no_delete) ; absent ⇒ refus (fail-closed).
  IF p_via = 'CANCEL' THEN
    SELECT s.id INTO v_segment FROM core.booking_trip_segment s
     WHERE s.trip_id = p_trip_id AND s.seq = 1;
    IF v_segment IS NULL THEN
      RAISE EXCEPTION 'trip: segment 1 missing'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_segment_missing';
    END IF;
  END IF;

  INSERT INTO core.booking_trip_state_log
         (id, trip_id, from_status, to_status, kind, reason_code, origin, actor_role,
          settlement_id)                                                           -- US-215
  VALUES (pg_catalog.gen_random_uuid(), p_trip_id, p_from, p_to, 'TRANSITION', p_reason, p_origin,
          p_actor_role, v_settlement);                                             -- US-215

  IF p_via = 'CANCEL' THEN
    UPDATE core.booking_trip
       SET status = p_to, cancellation_reason = p_reason,
           cancel_initiator = p_extra ->> 'initiator',
           cancel_requested_at = (p_extra ->> 'requestedAt')::timestamptz
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSIF p_to = 'TERMINATED_EARLY' THEN
    UPDATE core.booking_trip SET status = p_to, termination_reason = p_reason
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSIF p_to = 'IN_PROGRESS' AND p_from IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    UPDATE core.booking_trip SET status = p_to, checkin_validated_at = platform.now()
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSE
    UPDATE core.booking_trip SET status = p_to
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  END IF;

  -- I-OCC : un état qui ne tient plus le créneau libère l'occupation du véhicule et celle du
  -- voyageur, dans la même transaction (vérifiée au COMMIT par les triggers différés de 0006)
  IF core.booking_trip_holds_slot(p_from) AND NOT core.booking_trip_holds_slot(p_to) THEN
    UPDATE core.booking_vehicle_occupancy
       SET active = false, deactivated_reason = 'TRIP_TERMINAL'
     WHERE kind = 'TRIP' AND ref_type = 'TRIP' AND ref_id = p_trip_id AND active;
    UPDATE core.booking_guest_occupancy SET active = false WHERE trip_id = p_trip_id AND active;
  END IF;

  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  SELECT e.type, 1, 'trip', p_trip_id, v_version, v_country, 'SYSTEM',
         pg_catalog.gen_random_uuid(), e.payload, p_trip_id::text
    FROM (VALUES
            ('trip.cancellation.qualified',
             pg_catalog.jsonb_build_object('trip_id', p_trip_id, 'segment_id', v_segment,
                                           'requested_reason', p_extra ->> 'requestedReason',
                                           'reason', p_reason, 'origin', p_origin,
                                           'initiator', p_extra ->> 'initiator',
                                           'requested_at', p_extra ->> 'requestedAt',
                                           'to', p_to)),
            ('trip.status_changed',
             pg_catalog.jsonb_build_object('trip_id', p_trip_id, 'from', p_from, 'to', p_to,
                                           'reason', p_reason,
                                           'settlement_id', v_settlement)))        -- US-215
         AS e(type, payload)
   WHERE e.type = 'trip.status_changed' OR p_via = 'CANCEL';
  RETURN v_version;
END
$fn$;

-- 6. Commande liée aux trois actions d'annulation (signature imposée par le cadre d'US-101) -----
-- Contrôles d'accès faits AVANT l'appel par core.iam_staff_cmd_manual_action (session TOTP,
-- permission ops.platform_cancel dans le pays du trip, saisie fermée, garde ADR-122, idempotence par
-- request_id). Rien n'est écrit sur un refus. Aucun montant, aucun règlement ici : la demande est
-- réglée par le travailleur trip_lifecycle (core.booking_cmd_trip_cancel_settle).
CREATE FUNCTION core.booking_manual_action_cancel_trip(p_token_hash bytea, p_action_id uuid,
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
  v_reason    text;
  v_initiator text;
  v_sub       text;
  v_t         record;
BEGIN
  IF p_action_code IS NULL
     OR p_action_code NOT IN ('CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM')
     OR p_action_id IS NULL OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_reason IS NULL OR p_input IS NULL THEN
    RAISE EXCEPTION 'annulation : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- motif demandé et initiateur DÉRIVÉS de l'action (jamais reçus : N-131) ; saisie déjà
  -- contrôlée contre l'énumération fermée du catalogue par la console
  IF p_action_code = 'CANCEL_TRIP_GUEST' THEN
    v_reason := 'GUEST_CANCELLED';
    v_initiator := 'GUEST';
  ELSIF p_action_code = 'CANCEL_TRIP_HOST' THEN
    v_initiator := 'HOST';
    v_sub := p_input ->> 'subReason';
    IF v_sub IS NULL THEN
      v_reason := 'HOST_CANCELLED';
    ELSE
      v_reason := 'HOST_CANCELLED_DUE_TO_GUEST';
      IF v_sub = 'LICENSE_NOT_UPLOADED' THEN
        v_sub := 'LICENSE_NOT_UPLOADED_1H';
      END IF;
    END IF;
  ELSE
    v_initiator := 'PLATFORM';
    v_reason := p_input ->> 'platformReason';
    IF v_reason IS NULL THEN
      RETURN QUERY SELECT 'CANCEL_REASON_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
  END IF;

  SELECT tr.id, tr.guest_user_id, tr.vehicle_id INTO v_t
    FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122)
  IF v_t.guest_user_id = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- même ordre de verrous que les commandes du trip (17 §2.5) : voyageur, puis véhicule ; l'état est
  -- relu ensuite (aucune transition ne passe pendant la demande)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guest:' || v_t.guest_user_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('veh:' || v_t.vehicle_id::text, 0));
  SELECT tr.id, tr.status, tr.country_code INTO v_t
    FROM core.booking_trip AS tr WHERE tr.id = p_subject_id;

  -- paire de SM-1 (critère 1 d'US-207, inconditionnel) : l'état courant a une sortie CANCEL vers un
  -- état que le motif demandé peut atteindre après qualification (règle 1 : GUEST_NO_SHOW ;
  -- règle 2 : HOST_CANCELLED) ; un trip commencé ou terminé est refusé ici
  IF NOT EXISTS (
       SELECT 1 FROM core.booking_trip_transition AS tt
        WHERE tt.from_status = v_t.status AND tt.via = 'CANCEL'
          AND tt.to_status IN (
                core.booking_cancellation_target(v_reason),
                CASE v_reason
                  WHEN 'GUEST_CANCELLED' THEN core.booking_cancellation_target('GUEST_NO_SHOW')
                  WHEN 'HOST_CANCELLED_DUE_TO_GUEST'
                    THEN core.booking_cancellation_target('HOST_CANCELLED')
                END)) THEN
    RETURN QUERY SELECT 'TRIP_TRANSITION_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- une seule demande vivante par trip (index trip_cancellation_live_unique en défense)
  IF EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
              WHERE c.trip_id = v_t.id AND c.status IN ('PENDING', 'SETTLED', 'FIN_REVIEW')) THEN
    RETURN QUERY SELECT 'CANCELLATION_PENDING'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  INSERT INTO core.booking_trip_cancellation
         (id, trip_id, country_code, action_code, requested_reason, initiator, sub_reason,
          requested_at, requested_by)
  VALUES (p_action_id, v_t.id, v_t.country_code, p_action_code, v_reason, v_initiator, v_sub,
          platform.now(), p_actor);
  RETURN QUERY SELECT 'DONE'::text, p_action_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.booking_manual_action_cancel_trip(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à CANCEL_TRIP_GUEST / HOST / PLATFORM (cadre d''US-101) : motif demandé et '
  'initiateur dérivés de l''action, sous-motif ou motif plateforme d''une énumération fermée, '
  'heure serveur de la demande ; demande PENDING réglée par le travailleur trip_lifecycle ; aucun '
  'montant. EXECUTE iam_staff_owner. US-215 (ADR-148).';

-- 7. Demandes en attente (travailleur trip_lifecycle) --------------------------------------------
CREATE FUNCTION core.booking_trip_cancellations_pending(p_limit integer)
  RETURNS TABLE (id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'trip: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  RETURN QUERY
    SELECT c.id FROM core.booking_trip_cancellation AS c
     WHERE c.status = 'PENDING'
     ORDER BY c.requested_at, c.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 500);
END
$fn$;

-- 8. Ouverture du règlement d'une demande (travailleur trip_lifecycle) ---------------------------
-- Verrous voyageur → véhicule → trip (booking_trip_lock), puis la demande ; rend les faits que le
-- moteur lit : instants en ms, motif, sous-motif, preuve validée DÉRIVÉE des pièces de l'action,
-- check-in, devis figé et paramètres du pays (forme canonique). Aucune ligne si la demande n'est
-- plus en attente. Rien n'est écrit.
CREATE FUNCTION core.booking_trip_cancellation_begin(p_cancellation_id uuid)
  RETURNS TABLE (cancellation_id uuid, trip_id uuid, segment_id uuid, country_code text,
                 currency text, trip_status text, trip_row_version integer, start_at_ms bigint,
                 booked_at_ms bigint, requested_reason text, initiator text, sub_reason text,
                 evidence_validated boolean, checkin_validated boolean, requested_at_ms bigint,
                 quote_engine_version text, quote_inputs text, quote_inputs_hash text,
                 quote_outputs text, quote_outputs_hash text, quote_total_minor text,
                 quote_currency text, params jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_trip uuid;
  t      record;
  c      record;
  r      record;
  q      record;
  v_seg  uuid;
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  IF v_trip IS NULL THEN
    -- contrôle du travailleur même sur une demande inconnue (aucune sonde hors trip_lifecycle)
    PERFORM core.booking_trip_cancellations_pending(0);
    RETURN;
  END IF;
  SELECT * INTO t FROM core.booking_trip_lock(v_trip, NULL);
  SELECT x.* INTO c FROM core.booking_trip_cancellation AS x
   WHERE x.id = p_cancellation_id AND x.status = 'PENDING' FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN;
  END IF;
  SELECT tr.currency, tr.scheduled_start, tr.booked_at, tr.source_hold_id INTO r
    FROM core.booking_trip AS tr WHERE tr.id = v_trip;
  SELECT s.id INTO v_seg FROM core.booking_trip_segment AS s WHERE s.trip_id = v_trip AND s.seq = 1;
  SELECT pq.engine_version, pq.inputs, pq.inputs_hash, pq.outputs, pq.outputs_hash,
         pq.total_minor::text AS total_minor, pq.currency INTO q
    FROM core.booking_checkout_acceptance AS a
    JOIN core.pricing_quote AS pq ON pq.id = a.quote_id
   WHERE a.hold_id = r.source_hold_id;
  RETURN QUERY SELECT
    c.id, v_trip, v_seg, t.country_code, r.currency, t.status, t.row_version,
    core.booking_epoch_ms(r.scheduled_start), core.booking_epoch_ms(r.booked_at),
    c.requested_reason, c.initiator, c.sub_reason,
    EXISTS (SELECT 1 FROM core.support_manual_action AS m
             WHERE m.id = c.id AND m.action_code = c.action_code AND m.subject_id = v_trip
               AND pg_catalog.cardinality(m.evidence_file_ids) > 0),
    t.checkin_validated_at IS NOT NULL, core.booking_epoch_ms(c.requested_at),
    q.engine_version, q.inputs, q.inputs_hash, q.outputs, q.outputs_hash, q.total_minor,
    q.currency, core.booking_cancellation_params(t.country_code, r.currency);
END
$fn$;

-- 9. Transition d'annulation réglée (travailleur trip_lifecycle) ---------------------------------
-- Appelée APRÈS core.settlement_cmd_record dans la MÊME transaction. Requalifie la demande en base
-- (règles 1 et 2 de BR-CXL, heure de la demande), lie le règlement à la demande (voir l'en-tête,
-- point 3), applique la transition avec le règlement, règle la demande. Une demande déjà réglée par
-- ce règlement rend son issue (rejeu après un accusé perdu, N-131) ; tout autre écart ⇒ refus.
CREATE FUNCTION core.booking_cmd_trip_cancel_settle(p_cancellation_id uuid, p_settlement_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip      uuid;
  t           record;
  c           record;
  r           record;
  s           record;
  v_reason    text;
  v_origin    text := 'EVENT';
  v_target    text;
  v_evidence  boolean;
  v_event     jsonb;
  v_params    jsonb;
  v_inputs    jsonb;
  v_bearer    text;
  v_version   integer;
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  IF v_trip IS NULL THEN
    PERFORM core.booking_trip_cancellations_pending(0);
    RAISE EXCEPTION 'trip: unknown cancellation'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_cancellation_closed';
  END IF;
  SELECT * INTO t FROM core.booking_trip_lock(v_trip, NULL);
  SELECT x.* INTO c FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  -- rejeu : la demande a déjà été réglée par CE règlement (accusé perdu) ⇒ son issue, rien d'écrit
  IF c.status = 'SETTLED' AND c.settlement_id = p_settlement_id THEN
    RETURN pg_catalog.jsonb_build_object('cancellationId', c.id, 'tripId', v_trip,
                                         'status', t.status, 'settlementId', c.settlement_id,
                                         'costBearer', c.cost_bearer, 'replayed', true);
  END IF;
  IF c.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'trip: cancellation % is %', c.id, c.status
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_cancellation_closed';
  END IF;
  SELECT x.* INTO c FROM core.booking_trip_cancellation AS x
   WHERE x.id = p_cancellation_id FOR UPDATE;

  -- preuve validée (règle 2) : au moins une pièce jointe par l'agent à l'action qui a créé la
  -- demande (17 §3.2.13 `manual_action.evidence_file_ids`, pièces du seau des preuves contrôlées
  -- par la console) ; jamais une valeur reçue (N-131)
  v_evidence := EXISTS (SELECT 1 FROM core.support_manual_action AS m
                         WHERE m.id = c.id AND m.action_code = c.action_code
                           AND m.subject_id = v_trip
                           AND pg_catalog.cardinality(m.evidence_file_ids) > 0);

  -- qualification à l'heure SERVEUR de la demande (corps de 0099, 10.4 ; règle 3 sans objet : aucun
  -- no-show n'est demandé par ces actions)
  v_reason := c.requested_reason;
  IF c.requested_reason = 'GUEST_CANCELLED' THEN                                -- règle 1
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF c.requested_at >= t.no_show_at AND t.checkin_validated_at IS NULL THEN
      v_reason := 'GUEST_NO_SHOW';
      v_origin := 'LATE_GUEST_CANCELLATION';
    END IF;
  ELSIF c.requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST' THEN                 -- règle 2
    IF c.sub_reason IS NULL
       OR c.sub_reason NOT IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT',
                               'LICENSE_NOT_UPLOADED_1H')
       OR NOT v_evidence THEN
      v_reason := 'HOST_CANCELLED';
      v_origin := 'REQUALIFIED_NO_EVIDENCE';
    END IF;
  END IF;
  v_target := core.booking_cancellation_target(v_reason);
  IF v_target IS NULL OR NOT EXISTS (
       SELECT 1 FROM core.booking_trip_transition AS tt
        WHERE tt.from_status = t.status AND tt.to_status = v_target AND tt.via = 'CANCEL') THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s (%s)', t.id, t.status, v_target, v_reason);
  END IF;

  -- liaison du règlement à la demande : même trip, version 1 en tête, motifs et état de la base ;
  -- entrées canoniques = faits de la base (événement, départ, réservation, devise, paramètres)
  SELECT r0.currency, r0.scheduled_start, r0.booked_at INTO r
    FROM core.booking_trip AS r0 WHERE r0.id = v_trip;
  v_params := core.booking_cancellation_params(t.country_code, r.currency);
  IF v_params IS NULL THEN
    RAISE EXCEPTION 'trip: cancellation parameters missing for %', t.country_code
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
  END IF;
  v_event := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'reason', c.requested_reason,
    'requestedAtMs', core.booking_epoch_ms(c.requested_at),
    'subReason', c.sub_reason,
    'evidenceValidated', CASE WHEN c.requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'
                              THEN v_evidence END,
    'checkinValidated', t.checkin_validated_at IS NOT NULL));
  SELECT x.* INTO s FROM core.settlement_cancellation_of(p_settlement_id) AS x;
  v_inputs := s.inputs;
  IF s.id IS NULL OR s.trip_id IS DISTINCT FROM v_trip OR s.segment_no <> 1 OR s.version <> 1
     OR s.supersedes_id IS NOT NULL OR s.kind IS DISTINCT FROM 'CANCELLATION'
     OR s.superseded IS DISTINCT FROM false
     OR s.requested_reason IS DISTINCT FROM c.requested_reason
     OR s.reason IS DISTINCT FROM v_reason
     OR s.origin IS DISTINCT FROM v_origin
     OR s.target_state IS DISTINCT FROM v_target
     OR (v_inputs -> 'event') IS DISTINCT FROM v_event
     OR (v_inputs -> 'params') IS DISTINCT FROM v_params
     OR (v_inputs -> 'trip' -> 'startAtMs') IS DISTINCT FROM
        pg_catalog.to_jsonb(core.booking_epoch_ms(r.scheduled_start))
     OR (v_inputs -> 'trip' -> 'bookedAtMs') IS DISTINCT FROM
        pg_catalog.to_jsonb(core.booking_epoch_ms(r.booked_at))
     OR (v_inputs -> 'trip' -> 'currency' ->> 'code') IS DISTINCT FROM r.currency THEN
    RAISE EXCEPTION 'trip: settlement % does not match cancellation %', p_settlement_id, c.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_cancellation_settlement_mismatch';
  END IF;

  v_bearer := core.booking_cancellation_cost_bearer(v_reason);
  v_version := core.booking_trip_apply_transition(
    t.id, t.status, v_target, v_reason, v_origin, c.initiator, 'CANCEL',
    pg_catalog.jsonb_build_object('initiator', c.initiator, 'requestedReason', c.requested_reason,
                                  'requestedAt', c.requested_at, 'settlementId', p_settlement_id));
  UPDATE core.booking_trip_cancellation AS x
     SET status = 'SETTLED', settlement_id = p_settlement_id, cost_bearer = v_bearer,
         decided_at = platform.now()
   WHERE x.id = c.id AND x.status = 'PENDING';
  RETURN pg_catalog.jsonb_build_object('cancellationId', c.id, 'tripId', t.id, 'from', t.status,
                                       'status', v_target, 'reason', v_reason, 'origin', v_origin,
                                       'requestedReason', c.requested_reason,
                                       'settlementId', p_settlement_id, 'costBearer', v_bearer,
                                       'rowVersion', v_version, 'replayed', false);
END
$fn$;

-- 10. Demande garée sans effet sur le trip (travailleur trip_lifecycle, transaction à part) -----
-- FIN_REVIEW : règlement hors bornes ou ordre refusé par la décision FINANCE à venir (US-224b) ;
-- FAILED : état du trip, paramètre, devis ou liaison refusés. Code seul (jamais un montant ni un
-- message). Une demande qui n'est plus en attente rend NOT_PENDING.
CREATE FUNCTION core.booking_cmd_trip_cancel_park(p_cancellation_id uuid, p_status text,
                                                  p_code text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
  t      record;
  n      integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('FIN_REVIEW', 'FAILED')
     OR p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'trip: invalid cancellation parking' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.booking_trip_cancellation AS x WHERE x.id = p_cancellation_id;
  IF v_trip IS NULL THEN
    PERFORM core.booking_trip_cancellations_pending(0);
    RETURN 'NOT_PENDING';
  END IF;
  SELECT * INTO t FROM core.booking_trip_lock(v_trip, NULL);
  UPDATE core.booking_trip_cancellation AS x
     SET status = p_status, outcome_code = p_code, decided_at = platform.now()
   WHERE x.id = p_cancellation_id AND x.status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'PARKED' ELSE 'NOT_PENDING' END;
END
$fn$;

COMMENT ON FUNCTION core.booking_trip_cancellations_pending(integer) IS
  'Demandes d''annulation en attente (500 au plus), travailleur trip_lifecycle. US-215.';
COMMENT ON FUNCTION core.booking_trip_cancellation_begin(uuid) IS
  'Ouverture du règlement d''une demande d''annulation : verrous voyageur → véhicule → trip, '
  'faits du trip, preuve dérivée des pièces de l''action, devis figé, paramètres canoniques du '
  'pays ; rien n''est écrit. Travailleur trip_lifecycle. US-215 (ADR-148).';
COMMENT ON FUNCTION core.booking_cmd_trip_cancel_settle(uuid, uuid) IS
  'Commande : annulation réglée (invariant 4 de SM-1) ; requalification en base, règlement lié à '
  'la demande (motifs, état, événement, instants, paramètres), transition avec settlement_id au '
  'journal et dans trip.status_changed, cost_bearer. Travailleur trip_lifecycle. US-215 (ADR-148).';
COMMENT ON FUNCTION core.booking_cmd_trip_cancel_park(uuid, text, text) IS
  'Commande : demande d''annulation garée (FIN_REVIEW ou FAILED, code seul), trip inchangé. '
  'Travailleur trip_lifecycle. US-215 (ADR-148).';

REVOKE ALL ON FUNCTION core.booking_epoch_ms(timestamptz),
  core.booking_cancellation_cost_bearer(text), core.booking_cancellation_params(text, text),
  core.booking_manual_action_cancel_trip(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.booking_trip_cancellations_pending(integer), core.booking_trip_cancellation_begin(uuid),
  core.booking_cmd_trip_cancel_settle(uuid, uuid),
  core.booking_cmd_trip_cancel_park(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.booking_manual_action_cancel_trip(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.booking_trip_cancellations_pending(integer),
  core.booking_trip_cancellation_begin(uuid), core.booking_cmd_trip_cancel_settle(uuid, uuid),
  core.booking_cmd_trip_cancel_park(uuid, text, text)
  TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 11. STL : lecture du règlement lié et contrainte différée des remboursements ------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Règlement d'annulation lu par la transition d'annulation (cmd_hold_owner seulement) : forme,
-- motifs, état cible et entrées canoniques ; `superseded` : une version suivante existe. Aucune
-- ligne pour un règlement inconnu ou d'une autre nature. Rien n'est écrit.
CREATE FUNCTION core.settlement_cancellation_of(p_settlement_id uuid)
  RETURNS TABLE (id uuid, trip_id uuid, segment_no integer, version integer, supersedes_id uuid,
                 kind text, requested_reason text, reason text, origin text, target_state text,
                 inputs jsonb, superseded boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id, s.trip_id, s.segment_no, s.version, s.supersedes_id, s.kind, s.requested_reason,
         s.reason, s.origin, s.target_state, s.inputs::jsonb,
         EXISTS (SELECT 1 FROM core.settlement_settlement AS n
                  WHERE n.trip_id = s.trip_id AND n.segment_no = s.segment_no
                    AND n.version > s.version)
    FROM core.settlement_settlement AS s
   WHERE s.id = p_settlement_id AND s.kind = 'CANCELLATION'
$fn$;
COMMENT ON FUNCTION core.settlement_cancellation_of(uuid) IS
  'Règlement d''annulation lu par core.booking_cmd_trip_cancel_settle (liaison à la demande) ; '
  'EXECUTE cmd_hold_owner seulement. US-215 (ADR-148).';
REVOKE ALL ON FUNCTION core.settlement_cancellation_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_cancellation_of(uuid) TO cmd_hold_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- Contrainte différée : jamais un règlement d'annulation sans ses remboursements.
-- Fonction créée par migrator (propriétaire de la table, qui pose le déclencheur), puis transférée à
-- cmd_money_owner, propriétaire NOLOGIN des lectures d'argent (règlement, soldes, ordres).
CREATE FUNCTION core.settlement_assert_cancellation_refunded()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s          record;
  v_legs     integer;
  v_captured bigint;
  v_refunded bigint;
BEGIN
  IF NEW.status IS DISTINCT FROM 'SETTLED' THEN
    RETURN NULL;
  END IF;
  SELECT x.trip_id, x.total_paid_minor, x.guest_refund_minor INTO s
    FROM core.settlement_settlement AS x WHERE x.id = NEW.settlement_id;
  -- trip encaissé : quatre jambes tenues dont la capture totale est le total payé du règlement
  SELECT pg_catalog.count(*)::integer, COALESCE(pg_catalog.sum(b.captured_minor), 0)
    INTO v_legs, v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = s.trip_id AND b.segment_no = 1;
  IF s.trip_id IS DISTINCT FROM NEW.trip_id OR v_legs <> 4
     OR v_captured IS DISTINCT FROM s.total_paid_minor THEN
    RAISE EXCEPTION 'cancellation %: trip not captured as settled', NEW.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_cancellation_uncaptured';
  END IF;
  -- remboursements du règlement enregistrés (non échoués) = remboursement du voyageur, exactement
  SELECT COALESCE(pg_catalog.sum(o.amount_minor), 0) INTO v_refunded
    FROM core.payment_payment_operation AS o
   WHERE o.settlement_id = NEW.settlement_id AND o.kind = 'REFUND' AND o.status <> 'FAILED';
  IF v_refunded IS DISTINCT FROM s.guest_refund_minor THEN
    RAISE EXCEPTION 'cancellation %: refunds % differ from the settlement', NEW.id, v_refunded
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_cancellation_unrefunded';
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_assert_cancellation_refunded() IS
  'Contrainte différée trip_cancellation_refunded : une demande réglée porte un trip encaissé '
  '(quatre jambes, Σ capturé = total payé) et des ordres REFUND non échoués du règlement dont la '
  'somme est exactement le remboursement du voyageur. US-215 (ADR-148).';
REVOKE ALL ON FUNCTION core.settlement_assert_cancellation_refunded() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER trip_cancellation_refunded
  AFTER UPDATE OF status ON core.booking_trip_cancellation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'SETTLED')
  EXECUTE FUNCTION core.settlement_assert_cancellation_refunded();
-- propriétaire NOLOGIN de la fonction SECURITY DEFINER (CREATE le temps du transfert seulement)
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_assert_cancellation_refunded() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 12. Cadre d'US-101 : liaison des trois actions (contrôlées par le déclencheur de la table) -----
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
SELECT a.code,
       'core.booking_manual_action_cancel_trip(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
       'US-215'
  FROM pg_catalog.unnest(ARRAY['CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST',
                               'CANCEL_TRIP_PLATFORM']) AS a(code);
