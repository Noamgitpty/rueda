-- 0183 — CLM : refacturation des amendes, péages et fourrières — clé canonique du PV, unicité par
-- compte d'hôte du pays, seuil cumulé du trip (revue de l'ops). Correctifs des constats de la
-- passe de porte de la red team du lot 3 : F-L3-SIN-03 (le même PV refacturé deux fois quand
-- l'écriture de la référence change), F-L3-SIN-05 (le même PV refacturé à deux voyageurs du même
-- hôte), critiques ; F-L3-SIN-04 (aucun cumul par trip), ramené à élevé par la revue argent.
-- US-318 (suite 2) ; 19 US-318 critère 3 ; 08 BR-TT-02 à 04, BR-REIMB-05 (« doublons », « montant
-- non justifié » interdits) ; ADR-198 (0178), ADR-201 (0181) ; ADR-203 (cette migration, PROPOSÉ).
-- Red team : docs/team/redteam/L3-porte.md (RT-L3-S04, rt-l3-11-variantes). Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-203, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Clé canonique de la référence (F-L3-SIN-03) : `core.claim_traffic_reference_key`, fonction
--      IMMUABLE et unique (colonne générée `reference_canonical_key` et déclaration) : majuscules,
--      séparateurs retirés (comme `reference_key` de 0181) ; puis, dans chaque suite MAXIMALE de
--      chiffres et de lettres O, I, L qui contient au moins un chiffre (quelle que soit sa première
--      lettre), O vaut 0 et I ou L valent 1, puis les zéros de tête sont retirés (un zéro seul
--      reste). « PV 000123 » = « PV 123 » = « PV O123 » ; « PV 100200 » = « PV 1OO2OO » =
--      « PV I00200 » = « PV L00200 » ; « PV 2066-0042 » = « PV20660042 » (0181 inchangé). Les
--      homoglyphes non ASCII restent refusés par le format fermé de 0181. Limites assumées
--      (ADR-203) : un préfixe ajouté ou retiré, des zéros après un séparateur au milieu d'un numéro
--      restent des références distinctes ; le seuil cumulé du trip (revue de l'ops) borne le
--      reste.
--   2. Unicité du PV par compte d'hôte du pays (F-L3-SIN-05) : une référence d'avis désigne une
--      infraction d'UN véhicule, et un véhicule n'appartient qu'à un compte d'hôte ; l'index unique
--      partiel `claim_traffic_charge_reference_host_unique` (pays, compte d'hôte, clé canonique)
--      couvre donc (pays, véhicule) et aussi le même véhicule réinscrit sous une autre fiche. Deux
--      voyageurs ne sont jamais refacturés du même PV. Doublon ⇒ `TRAFFIC_DUPLICATE` (inchangé).
--      Les déclarations d'un compte d'hôte sont sérialisées par un verrou consultatif de l'hôte,
--      pris avant celui du trip (ordre fixe) ; l'index est la garde de dernier recours.
--   3. Seuil cumulé du trip (F-L3-SIN-04) : somme des montants déclarés (frais de gestion non
--      compris) des refacturations du trip, sauf celles rejetées par l'ops, plus le nouveau montant
--      > `traffic_trip_charge_max_minor[pays]` ⇒ la refacturation est ENREGISTRÉE avec
--      `ops_review_required` (figé ; annoncé au récapitulatif et à la déclaration :
--      `opsReviewRequired`) et n'est JAMAIS débitée sans décision de l'ops : contestée, elle suit la
--      décision d'US-318 suite (débit réservé à ADMIN) ; payée ou sans réponse à l'échéance, le
--      travailleur la passe en BLOCKED `TRAFFIC_OPS_REVIEW_REQUIRED` (alerte CLAIM_TRAFFIC_BLOCKED,
--      reprise par l'ops). Pas de refus : plusieurs amendes réelles sur un trajet sont légitimes et
--      08 ne fixe aucun plafond par trip (revue argent de la red team ; jamais plus lourd que Turo,
--      dont le support revoit). La contrainte `claim_traffic_charge_review_before_charge` prouve en
--      base qu'aucun débit d'une telle refacturation n'a une autre base que `OPS_DECISION`. Somme lue
--      sous le verrou du trip. Paramètre absent ou illisible ⇒ `TRAFFIC_CAP_UNKNOWN` (fail-closed).
--      Valeurs PROPOSÉES : 1 000,00 USD (PA), 7 500 000 PYG (PY), égales au plafond d'une
--      refacturation.
--   4. Données existantes : la colonne générée calcule la clé canonique de chaque refacturation
--      déjà écrite (0181) ; si deux refacturations de version 2 d'un même compte d'hôte du pays ont
--      la même clé, la migration échoue EN BLOC (aucun index, aucune fonction ; reprise manuelle
--      par l'ops), jamais un choix silencieux. Aucune n'existe hors des bases de test (bêta non
--      ouverte).
--   5. Écritures par commandes seulement ; RLS ENABLE + FORCE (inchangée) ; aucun droit applicatif
--      sur la table ; heure de la base ; aucune constante de pays hors du bloc généré ; aucun
--      interrupteur écrit ; aucune politique nouvelle de `cmd_hold_owner` (ADR-199) : le plafond
--      du trip est lu par une fonction de `cmd_money_owner`.
--
-- Expand / contract : fonctions, colonne générée (nulle pour les lignes de 0178), colonne
-- `ops_review_required` (défaut false), contrainte, index et paramètre AJOUTÉS ; `reference_key`
-- et `claim_traffic_charge_reference_unique` (trip, clé de 0181) GARDÉS (impliqués par le nouvel index, lus par la version N) ; politique
-- `cmd_money_traffic_guest_param_read` recréée sous son nom (+ `traffic_trip_charge_max_minor`) ;
-- `core.claim_p2p_guard` (migrator), `core.claim_cmd_execute_traffic_charge` (cmd_money_owner) et
-- `core.claim_cmd_declare_traffic_charge` (9 arguments, cmd_hold_owner) remplacées à signature
-- identique (corps de 0181 recopiés puis élargis). L'API version N ignore `opsReviewRequired` :
-- la refacturation reste revue par l'ops avant tout débit (jugé en base).
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   réappliquer les corps de 0181 de core.claim_p2p_guard (migrator),
--     core.claim_cmd_execute_traffic_charge (cmd_money_owner) et
--     core.claim_cmd_declare_traffic_charge (9 arguments, cmd_hold_owner) ; recréer
--     cmd_money_traffic_guest_param_read de 0181 (deux clés) ;
--   DROP FUNCTION core.claim_traffic_trip_cap(text) ;
--   DROP INDEX core.claim_traffic_charge_reference_host_unique ;
--   ALTER TABLE core.claim_traffic_charge DROP CONSTRAINT claim_traffic_charge_review_before_charge,
--     DROP COLUMN ops_review_required, DROP COLUMN reference_canonical_key ;
--   DROP FUNCTION core.claim_traffic_reference_key(text) ;
--   DELETE des valeurs puis de la définition du paramètre « traffic_trip_charge_max_minor ».

-- 0. Paramètre du pays (bloc généré, POST_SEED_PARAMS « traffic_trip_charge_max_minor », embedded)

-- 0183 — graine complémentaire : paramètres « traffic_trip_charge_max_minor* » (US-318 suite 2 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « traffic_trip_charge_max_minor » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('traffic_trip_charge_max_minor', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-TT-02 à 04, BR-REIMB-03, BR-REIMB-05 (« doublons », « montant non justifié » interdits) ; red team F-L3-SIN-04 ; ADR-203 : seuil CUMULÉ des amendes, péages et fourrières refacturés sur un même trip (montants déclarés, frais de gestion non compris, refacturations rejetées par l’ops exclues), en unités mineures de la devise du pays ; une déclaration qui porte la somme du trip au-delà est enregistrée mais revue par l’ops avant tout débit (ops_review_required : jamais débitée sans décision de l’ops) ; absent ou mal formé : aucune refacturation (TRAFFIC_CAP_UNKNOWN, fail-closed)', 'PROPOSÉ comme Turo (ADR-203) : 1 000,00 USD au Panama ; 7 500 000 PYG au Paraguay (égal au plafond d’une refacturation) ; au-delà, revue de l’ops plutôt qu’un refus (plusieurs amendes réelles sur un trajet sont légitimes ; Turo fait revoir par son support, jamais plus lourd que Turo) ; réglage modifiable par l’administration des paramètres');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('traffic_trip_charge_max_minor', 'PA', 'COUNTRY', NULL, NULL, '"100000"'::jsonb, 'graine US-318 suite 2 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-REIMB-05 ; ADR-203)'),
  ('traffic_trip_charge_max_minor', 'PY', 'COUNTRY', NULL, NULL, '"7500000"'::jsonb, 'graine US-318 suite 2 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-REIMB-05 ; ADR-203)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'traffic\_trip\_charge\_max\_minor%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre traffic_trip_charge_max_minor* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;

-- 1. Clé canonique et unicité par compte d'hôte du pays (migrator) ------------------------------

-- 1.1 Clé canonique d'une référence (F-L3-SIN-03) : fonction pure, immuable, seule définition
-- (colonne générée et déclaration). NULL pour NULL (lignes de 0178).
CREATE FUNCTION core.claim_traffic_reference_key(p_reference text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.string_agg(
           CASE
             WHEN m.part[1] ~ '[0-9]' THEN
               COALESCE(NULLIF(pg_catalog.ltrim(pg_catalog.translate(m.part[1], 'OIL', '011'), '0'),
                               ''), '0')
             ELSE m.part[1]
           END, '' ORDER BY m.n)
    FROM pg_catalog.regexp_matches(
           pg_catalog.regexp_replace(pg_catalog.upper(p_reference), '[^A-Z0-9]', '', 'g'),
           '[0-9OIL]+|[A-Z]', 'g') WITH ORDINALITY AS m(part, n)
$fn$;
COMMENT ON FUNCTION core.claim_traffic_reference_key(text) IS
  'Clé canonique de la référence d''un avis, d''un PV ou d''un reçu (F-L3-SIN-03) : majuscules, '
  'séparateurs retirés, O → 0 et I / L → 1 dans les suites maximales de [0-9OIL] contenant un '
  'chiffre, zéros de '
  'tête des suites de chiffres retirés. Colonne générée reference_canonical_key et déclaration. '
  'US-318 suite 2 (ADR-203).';
REVOKE ALL ON FUNCTION core.claim_traffic_reference_key(text) FROM PUBLIC;
-- évaluée par la colonne générée à l'écriture (déclaration : cmd_hold_owner ; réponse, décision,
-- exécution : cmd_money_owner) et par la déclaration
GRANT EXECUTE ON FUNCTION core.claim_traffic_reference_key(text) TO cmd_hold_owner, cmd_money_owner;

-- 1.2 Colonne générée : la clé canonique de chaque refacturation, y compris celles déjà écrites
ALTER TABLE core.claim_traffic_charge
  ADD COLUMN reference_canonical_key text
    GENERATED ALWAYS AS (core.claim_traffic_reference_key(reference)) STORED;
COMMENT ON COLUMN core.claim_traffic_charge.reference_canonical_key IS
  'Clé canonique de la référence (core.claim_traffic_reference_key) ; unique par compte d''hôte '
  'du pays (F-L3-SIN-03, F-L3-SIN-05). US-318 suite 2 (ADR-203).';

-- 1.3 Données existantes : deux refacturations de version 2 d'un même compte d'hôte du pays qui
-- deviennent le même PV font échouer la migration EN BLOC (fail-closed ; reprise par l'ops)
DO $check$
BEGIN
  IF EXISTS (SELECT 1
               FROM core.claim_traffic_charge AS x
              WHERE x.rules_version = 2
              GROUP BY x.country_code, x.org_id, x.reference_canonical_key
             HAVING pg_catalog.count(*) > 1) THEN
    RAISE EXCEPTION 'refacturation : deux refacturations d''un même compte d''hôte désignent le même PV (clé canonique) ; reprise par l''ops avant 0183'
      USING ERRCODE = 'unique_violation';
  END IF;
END
$check$;

-- 1.4 Un PV par compte d'hôte du pays (F-L3-SIN-05), quel que soit le trip (version 2 ; les lignes
-- de 0178 n'ont pas de référence)
CREATE UNIQUE INDEX claim_traffic_charge_reference_host_unique
  ON core.claim_traffic_charge (country_code, org_id, reference_canonical_key)
  WHERE (rules_version = 2);

-- 1.5 Seuil cumulé du trip dépassé (F-L3-SIN-04) : figé à la déclaration (garde ci-dessous) ;
-- une telle refacturation n'est débitée que sur décision de l'ops (preuve en base)
ALTER TABLE core.claim_traffic_charge
  ADD COLUMN ops_review_required boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT claim_traffic_charge_review_before_charge CHECK (
    NOT ops_review_required
    OR (rules_version = 2 AND (charge_basis IS NULL OR charge_basis = 'OPS_DECISION')));
COMMENT ON COLUMN core.claim_traffic_charge.ops_review_required IS
  'Somme des refacturations du trip au-delà du seuil cumulé du pays (traffic_trip_charge_max_minor) '
  'à la déclaration : jamais débitée sans décision de l''ops (F-L3-SIN-04). US-318 suite 2 '
  '(ADR-203).';

-- 1.6 Garde (0181, même signature, corps recopié) : `ops_review_required` figé comme la référence,
-- le délai et le plafond
CREATE OR REPLACE FUNCTION core.claim_p2p_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_theft_case' THEN
    -- THEFT_INVESTIGATION → RETURNED (une fois) ; déclaration PENDING → SENT | WITHDRAWN
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.org_id, NEW.opened_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.trip_id, OLD.country_code, OLD.org_id, OLD.opened_at)
       AND (NEW.status = OLD.status AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
            OR (OLD.status = 'THEFT_INVESTIGATION' AND NEW.status = 'RETURNED'))
       AND (NEW.insurer_status = OLD.insurer_status
            AND NEW.insurer_sent_at IS NOT DISTINCT FROM OLD.insurer_sent_at
            AND NEW.insurer_ref IS NOT DISTINCT FROM OLD.insurer_ref
            OR (OLD.insurer_status = 'PENDING' AND NEW.insurer_status IN ('SENT', 'WITHDRAWN'))) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_traffic_charge' THEN
    -- l'exécution change : PENDING → DONE | BLOCKED | VOID, le débit rattaché une fois ; la réponse
    -- du voyageur et la décision de l'ops sont écrites une fois, avant toute exécution (0181)
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.org_id, NEW.declared_by, NEW.kind,
        NEW.occurred_at, NEW.file_id, NEW.amount_minor, NEW.fee_bps, NEW.admin_fee_minor,
        NEW.total_minor, NEW.leg_host_minor, NEW.leg_insurer_minor, NEW.leg_tax_third_party_minor,
        NEW.leg_platform_minor, NEW.trip_start_at, NEW.trip_end_at, NEW.deadline_at,
        NEW.request_id, NEW.declared_at, NEW.rules_version, NEW.guest_user_id, NEW.reference,
        NEW.response_hours, NEW.response_due_at, NEW.cap_minor, NEW.ops_review_required)
       IS NOT DISTINCT FROM
       (OLD.id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.org_id, OLD.declared_by, OLD.kind,
        OLD.occurred_at, OLD.file_id, OLD.amount_minor, OLD.fee_bps, OLD.admin_fee_minor,
        OLD.total_minor, OLD.leg_host_minor, OLD.leg_insurer_minor, OLD.leg_tax_third_party_minor,
        OLD.leg_platform_minor, OLD.trip_start_at, OLD.trip_end_at, OLD.deadline_at,
        OLD.request_id, OLD.declared_at, OLD.rules_version, OLD.guest_user_id, OLD.reference,
        OLD.response_hours, OLD.response_due_at, OLD.cap_minor, OLD.ops_review_required)
       AND (OLD.charge_id IS NULL OR NEW.charge_id IS NOT DISTINCT FROM OLD.charge_id)
       AND NEW.failed_attempts >= OLD.failed_attempts
       AND (OLD.execution_status = 'PENDING'
            OR (OLD.execution_status = NEW.execution_status
                AND NEW.executed_at IS NOT DISTINCT FROM OLD.executed_at
                AND NEW.guest_status IS NOT DISTINCT FROM OLD.guest_status))
       AND (NEW.guest_status IS NOT DISTINCT FROM OLD.guest_status
            OR (OLD.guest_status = 'AWAITING_GUEST' AND NEW.guest_status IN ('ACCEPTED', 'DISPUTED'))
            OR (OLD.guest_status = 'DISPUTED' AND NEW.guest_status IN ('DECIDED_CHARGE', 'REJECTED')))
       AND (OLD.accepted_at IS NULL OR NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at)
       AND (OLD.disputed_at IS NULL
            OR (NEW.disputed_at, NEW.dispute_reason, NEW.dispute_evidence_file_ids)
               IS NOT DISTINCT FROM
               (OLD.disputed_at, OLD.dispute_reason, OLD.dispute_evidence_file_ids))
       AND (OLD.decided_at IS NULL
            OR (NEW.decided_at, NEW.decided_by, NEW.decided_role, NEW.decision_request_id,
                NEW.decision_rationale)
               IS NOT DISTINCT FROM
               (OLD.decided_at, OLD.decided_by, OLD.decided_role, OLD.decision_request_id,
                OLD.decision_rationale))
       AND (OLD.charge_basis IS NULL OR NEW.charge_basis IS NOT DISTINCT FROM OLD.charge_basis) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'claim p2p: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_p2p_record_immutable';
END
$fn$;
COMMENT ON FUNCTION core.claim_p2p_guard() IS
  'Garde des registres d''US-318 : dossier de vol THEFT_INVESTIGATION → RETURNED, déclaration à '
  'l''assureur PENDING → SENT | WITHDRAWN ; incident immuable ; refacturation figée (seules son '
  'exécution, la réponse du voyageur et la décision de l''ops changent, une fois chacune ; revue '
  'de l''ops figée) ; jamais de DELETE ni de TRUNCATE. US-318 (ADR-198, ADR-201, ADR-203).';
REVOKE ALL ON FUNCTION core.claim_p2p_guard() FROM PUBLIC;

-- 2. Seuil cumulé du trip et exécution (cmd_money_owner) -----------------------------------------
-- Paramètre lu par cmd_money_owner seulement : politique de 0181 recréée sous son nom (+ une clé)
DROP POLICY cmd_money_traffic_guest_param_read ON core.config_param_value;
CREATE POLICY cmd_money_traffic_guest_param_read ON core.config_param_value FOR SELECT
  TO cmd_money_owner
  USING (key IN ('traffic_guest_response_h', 'traffic_guest_charge_max_minor',
                 'traffic_trip_charge_max_minor'));

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 2.1 Seuil cumulé des refacturations d'un trip (traffic_trip_charge_max_minor) du pays ; NULL si
-- absent ou mal formé (F-L3-SIN-04). Lu pour la déclaration (cmd_hold_owner) sans politique
-- nouvelle de cmd_hold_owner (ADR-199).
CREATE FUNCTION core.claim_traffic_trip_cap(p_country text)
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_cap jsonb := core.claim_incidental_param('traffic_trip_charge_max_minor', p_country);
BEGIN
  IF pg_catalog.jsonb_typeof(v_cap) IN ('string', 'number')
     AND (v_cap #>> '{}') ~ '^(0|[1-9][0-9]{0,14})$' THEN
    RETURN (v_cap #>> '{}')::bigint;
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_trip_cap(text) IS
  'Interne : seuil cumulé des amendes, péages et fourrières refacturés sur un trip '
  '(traffic_trip_charge_max_minor) du pays ; NULL si absent. EXECUTE cmd_hold_owner. US-318 '
  'suite 2 (ADR-203).';
REVOKE ALL ON FUNCTION core.claim_traffic_trip_cap(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_traffic_trip_cap(text) TO cmd_hold_owner;

-- 2.2 Exécution par Kmino (0181 2.11, même signature, corps recopié, élargi) : une refacturation
-- au-delà du seuil cumulé du trip n'est débitée que décidée par l'ops (DECIDED_CHARGE, ADMIN) ;
-- payée ou sans réponse à l'échéance : BLOCKED `TRAFFIC_OPS_REVIEW_REQUIRED`
CREATE OR REPLACE FUNCTION core.claim_cmd_execute_traffic_charge(p_traffic_charge_id uuid,
                                                                 p_charge_id uuid)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  x        core.claim_traffic_charge%ROWTYPE;
  v_trip   uuid;
  v_tender uuid;
  v_now    timestamptz;
  v_basis  text;
  r        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: execute_traffic_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_traffic_charge_id IS NULL OR p_charge_id IS NULL THEN
    RAISE EXCEPTION 'claim: invalid execution input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  SELECT b.id, b.country_code, b.currency, b.source_hold_id INTO t
    FROM core.booking_trip AS b WHERE b.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id FOR UPDATE;
  v_now := platform.now();
  IF x.execution_status <> 'PENDING' THEN
    RETURN QUERY SELECT x.execution_status, x.execution_code;
    RETURN;
  END IF;
  IF x.rules_version = 1 THEN
    -- refacturation de 0178 sans délai de réponse : jamais débitée automatiquement (fail-closed)
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'GUEST_RESPONSE_MISSING'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'GUEST_RESPONSE_MISSING'::text;
    RETURN;
  END IF;
  IF x.guest_status = 'DISPUTED' THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'TRAFFIC_DISPUTED'::text;
    RETURN;
  END IF;
  IF NOT core.claim_traffic_charge_eligible(x.rules_version, x.execution_status, x.guest_status,
                                            x.response_due_at, LEAST(x.next_check_at, v_now),
                                            v_now) THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'GUEST_RESPONSE_WINDOW_OPEN'::text;
    RETURN;
  END IF;
  -- 0183 (F-L3-SIN-04) : au-delà du seuil cumulé du trip, jamais débitée sans décision de l'ops
  -- (payée par le voyageur ou échéance passée sans réponse : BLOCKED, alerte CLAIM_TRAFFIC_BLOCKED,
  -- reprise par l'ops ; contestée : décision de l'ops, débit réservé à ADMIN, inchangé)
  IF x.ops_review_required AND x.guest_status IS DISTINCT FROM 'DECIDED_CHARGE' THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'TRAFFIC_OPS_REVIEW_REQUIRED'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'TRAFFIC_OPS_REVIEW_REQUIRED'::text;
    RETURN;
  END IF;
  v_basis := CASE x.guest_status WHEN 'ACCEPTED' THEN 'GUEST_ACCEPTED'
                                 WHEN 'DECIDED_CHARGE' THEN 'OPS_DECISION'
                                 ELSE 'NO_RESPONSE' END;
  IF t.id IS NULL OR t.country_code <> x.country_code OR t.currency <> x.currency THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'TRIP_UNKNOWN'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'TRIP_UNKNOWN'::text;
    RETURN;
  END IF;
  SELECT o.id INTO v_tender
    FROM core.payment_payment_operation AS o
   WHERE (o.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id))
     AND o.kind IN ('AUTH', 'CAPTURE') AND o.method = 'CARD' AND o.purpose = 'RENT'
     AND o.status = 'SUCCEEDED' AND o.currency = t.currency
   ORDER BY (o.kind = 'CAPTURE') DESC, o.created_at, o.id
   LIMIT 1;
  IF v_tender IS NULL THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'NO_CARD_TENDER'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'NO_CARD_TENDER'::text;
    RETURN;
  END IF;
  -- débit séparé d'US-703 : montant explicite de chaque jambe ; accord écrit = paiement du voyageur
  SELECT * INTO r FROM core.payment_cmd_notify_post_trip_charge(
    p_charge_id, t.id, 'INCIDENTAL', 'DELAYED_CHARGES', 'TRAFFIC_CHARGE', x.id, NULL, v_tender,
    x.total_minor,
    pg_catalog.jsonb_build_object('HOST', x.leg_host_minor::text,
                                  'INSURER', x.leg_insurer_minor::text,
                                  'TAX_THIRD_PARTY', x.leg_tax_third_party_minor::text,
                                  'PLATFORM', x.leg_platform_minor::text),
    v_basis = 'GUEST_ACCEPTED');
  UPDATE core.claim_traffic_charge AS c
     SET execution_status = 'DONE', execution_code = NULL, charge_id = r.charge_id,
         executed_at = v_now, charge_basis = v_basis
   WHERE c.id = x.id;
  RETURN QUERY SELECT 'DONE'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_execute_traffic_charge(uuid, uuid) IS
  'Exécution d''une refacturation par Kmino : payée, décidée par l''ops (ADMIN) ou échéance du '
  'voyageur passée sans réponse ; jamais contestée ni avant l''échéance ; au-delà du seuil cumulé '
  'du trip, seulement décidée par l''ops (sinon BLOCKED TRAFFIC_OPS_REVIEW_REQUIRED) ; débit séparé '
  'du voyageur (US-703, but INCIDENTAL, motif DELAYED_CHARGES, jambes explicites, jamais la '
  'caution). Travailleur payment_command. EXECUTE app_worker. US-318 (ADR-198, ADR-201, ADR-203).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 3. Déclaration (cmd_hold_owner, EXECUTE app_api) ----------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 3.1 Amende, péage ou fourrière déclarés par le titulaire (0181 3.1 recopiée, élargie : clé
-- canonique, unicité par compte d'hôte du pays, seuil cumulé du trip). Issues de 0181 ;
-- TRAFFIC_CAP_UNKNOWN couvre aussi le seuil cumulé absent ; TRAFFIC_DUPLICATE vaut aussi pour le
-- même PV sur un autre trip du compte d'hôte ; `body.opsReviewRequired` (récapitulatif, déclaration,
-- rejeu) : somme du trip au-delà du seuil, revue de l'ops avant tout débit. Rien n'est écrit hors
-- DECLARED.
CREATE OR REPLACE FUNCTION core.claim_cmd_declare_traffic_charge(p_token_hash bytea,
                                                                 p_request_id uuid,
                                                                 p_trip_id uuid, p_kind text,
                                                                 p_occurred_at timestamptz,
                                                                 p_amount_minor bigint,
                                                                 p_file_id uuid,
                                                                 p_preview boolean,
                                                                 p_reference text)
  RETURNS TABLE (outcome text, charge_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p      record;
  f      record;
  g      record;
  v_old  core.claim_traffic_charge%ROWTYPE;
  v_legs bigint[];
  v_now  timestamptz;
  v_id   uuid;
  v_ok   boolean;
  v_ref  text := NULLIF(pg_catalog.btrim(p_reference), '');
  v_key  text;
  v_dup  uuid;
  v_due  timestamptz;
  v_guest uuid;
  v_org   uuid;
  v_cc    text;
  v_tcap  bigint;
  v_sum   bigint;
  v_review boolean;
BEGIN
  IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('TOLL', 'FINE', 'IMPOUND')
     OR p_occurred_at IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_amount_minor > 1000000000000 OR p_file_id IS NULL OR p_preview IS NULL
     OR (v_ref IS NOT NULL
         AND (pg_catalog.char_length(v_ref) NOT BETWEEN 3 AND 40
              OR v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*[A-Za-z0-9]$'
              OR pg_catalog.char_length(pg_catalog.regexp_replace(pg_catalog.upper(v_ref),
                                                                  '[^A-Z0-9]', '', 'g')) < 3)) THEN
    RAISE EXCEPTION 'refacturation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'TRAFFIC');
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF v_ref IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_REFERENCE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- clé canonique du PV (0183, F-L3-SIN-03) : la fonction de la colonne générée, jamais recopiée
  v_key := core.claim_traffic_reference_key(v_ref);
  -- compte d'hôte et pays du trip (immuables) : portée de l'unicité du PV (F-L3-SIN-05)
  SELECT t.org_id, t.country_code INTO v_org, v_cc FROM core.booking_trip AS t
   WHERE t.id = p.trip_id;
  IF v_org IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic:' || p_request_id::text, 0));
  -- déclarations d'un même compte d'hôte sérialisées (0183, F-L3-SIN-05 : le même PV déclaré en
  -- même temps sur deux trips de l'hôte), puis celles du trip (F-L3-SIN-01 ; seuil cumulé du
  -- trip, F-L3-SIN-04) ; ordre fixe hôte → trip, aucune autre commande ne prend le verrou de l'hôte
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic.host:' || v_cc || ':' || v_org::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic.trip:' || p.trip_id::text, 0));
  SELECT * INTO v_old FROM core.claim_traffic_charge AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL AND NOT p_preview THEN
    IF v_old.trip_id = p.trip_id AND v_old.declared_by = p.user_id AND v_old.kind = p_kind
       AND v_old.occurred_at = p_occurred_at AND v_old.amount_minor = p_amount_minor
       AND v_old.file_id = p_file_id AND v_old.reference IS NOT DISTINCT FROM v_ref THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_old.id, pg_catalog.jsonb_build_object(
        'amountMinor', v_old.amount_minor::text, 'adminFeeMinor', v_old.admin_fee_minor::text,
        'totalMinor', v_old.total_minor::text,
        'deadlineAt', pg_catalog.to_char(v_old.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'responseDueAt', pg_catalog.to_char(v_old.response_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'opsReviewRequired', v_old.ops_review_required);
      RETURN;
    END IF;
    RAISE EXCEPTION 'refacturation : identifiant de requête déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO f FROM core.claim_traffic_facts(p.trip_id);
  IF f.trip_id IS NULL OR f.holder_user_id IS DISTINCT FROM p.user_id
     OR f.org_id IS DISTINCT FROM v_org OR f.country_code IS DISTINCT FROM v_cc THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.end_at IS NULL OR NOT p.open THEN
    RETURN QUERY SELECT 'TRAFFIC_TRIP_NOT_ENDED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.deadline_at IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.fee_bps IS NULL OR f.fee_bps > 10000 THEN
    RETURN QUERY SELECT 'TRAFFIC_FEE_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- délai du voyageur et plafond du pays (0181) ; absents : aucune refacturation
  SELECT * INTO g FROM core.claim_traffic_guest_terms(f.country_code);
  IF g.response_hours IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_RESPONSE_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF g.cap_minor IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_CAP_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- seuil cumulé du trip (0183, F-L3-SIN-04) ; absent : aucune refacturation (fail-closed)
  v_tcap := core.claim_traffic_trip_cap(f.country_code);
  IF v_tcap IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_CAP_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- pièces de la série verrouillées ; heure de la base lue APRÈS les verrous
  PERFORM 1 FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p.trip_id AND i.kind = 'TRAFFIC' AND i.performer_role = 'HOST'
   FOR UPDATE;
  v_now := platform.now();
  IF v_now > f.deadline_at THEN
    RETURN QUERY SELECT 'TRAFFIC_CHARGE_DEADLINE_PASSED'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  IF p_occurred_at < f.start_at OR p_occurred_at > f.end_at OR p_occurred_at > v_now
     OR f.start_at >= f.end_at THEN
    RETURN QUERY SELECT 'TRAFFIC_OUTSIDE_TRIP'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('tripStartAt', pg_catalog.to_char(f.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  IF p_amount_minor > g.cap_minor THEN
    RETURN QUERY SELECT 'TRAFFIC_AMOUNT_ABOVE_CAP'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('capMinor', g.cap_minor::text,
                                                      'currency', f.currency);
    RETURN;
  END IF;
  -- une refacturation par PV et par compte d'hôte du pays (F-L3-SIN-01, 0183 : F-L3-SIN-03 et
  -- F-L3-SIN-05), quels que soient le trip, la nature, l'heure, le montant, la photo et l'écriture
  -- de la référence (clé canonique) ; une refacturation rejetée garde sa référence
  SELECT x.id INTO v_dup FROM core.claim_traffic_charge AS x
   WHERE x.country_code = v_cc AND x.org_id = v_org AND x.rules_version = 2
     AND x.reference_canonical_key = v_key;
  IF v_dup IS NOT NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_DUPLICATE'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('chargeId', v_dup);
    RETURN;
  END IF;
  -- seuil cumulé du trip (0183, F-L3-SIN-04) : montants déclarés (frais de gestion non compris)
  -- des refacturations du trip, toutes versions, sauf celles rejetées par l'ops ; lu SOUS le verrou
  -- du trip (aucune déclaration concurrente du trip ne peut s'intercaler). Au-delà : la
  -- refacturation est enregistrée, revue par l'ops avant tout débit (jamais un refus : plusieurs
  -- amendes réelles sur un trajet sont légitimes ; jamais plus lourd que Turo)
  SELECT COALESCE(pg_catalog.sum(x.amount_minor), 0)::bigint INTO v_sum
    FROM core.claim_traffic_charge AS x
   WHERE x.trip_id = p.trip_id AND x.guest_status IS DISTINCT FROM 'REJECTED';
  v_review := v_sum + p_amount_minor > v_tcap;
  SELECT EXISTS (SELECT 1
                   FROM core.trip_ops_inspection_photo AS ph
                   JOIN core.trip_ops_inspection AS i ON i.id = ph.inspection_id
                  WHERE ph.file_id = p_file_id AND i.trip_id = p.trip_id AND i.kind = 'TRAFFIC'
                    AND i.performer_role = 'HOST' AND i.performed_by = p.user_id)
         AND NOT EXISTS (SELECT 1 FROM core.claim_traffic_charge AS x WHERE x.file_id = p_file_id)
    INTO v_ok;
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'TRAFFIC_EVIDENCE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  v_legs := core.claim_traffic_charge_legs(p_amount_minor, f.fee_bps);
  v_due := v_now + pg_catalog.make_interval(hours => g.response_hours);
  IF p_preview THEN
    RETURN QUERY SELECT 'PREVIEW'::text, NULL::uuid, pg_catalog.jsonb_build_object(
      'amountMinor', p_amount_minor::text, 'adminFeeMinor', v_legs[4]::text,
      'totalMinor', (v_legs[1] + v_legs[4])::text, 'currency', f.currency, 'feeBps', f.fee_bps,
      'reference', v_ref, 'responseHours', g.response_hours, 'capMinor', g.cap_minor::text,
      'tripCapMinor', v_tcap::text, 'tripChargedMinor', v_sum::text,
      'opsReviewRequired', v_review,
      'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'legs', pg_catalog.jsonb_build_object('HOST', v_legs[1]::text, 'INSURER', v_legs[2]::text,
                                            'TAX_THIRD_PARTY', v_legs[3]::text,
                                            'PLATFORM', v_legs[4]::text));
    RETURN;
  END IF;
  SELECT t.guest_user_id INTO v_guest FROM core.booking_trip AS t WHERE t.id = p.trip_id;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.claim_traffic_charge
         (id, trip_id, country_code, currency, org_id, declared_by, kind, occurred_at, file_id,
          amount_minor, fee_bps, admin_fee_minor, total_minor, leg_host_minor, leg_insurer_minor,
          leg_tax_third_party_minor, leg_platform_minor, trip_start_at, trip_end_at, deadline_at,
          request_id, declared_at, next_check_at, rules_version, guest_user_id, reference,
          response_hours, response_due_at, cap_minor, guest_status, ops_review_required)
  VALUES (v_id, p.trip_id, f.country_code, f.currency, f.org_id, p.user_id, p_kind, p_occurred_at,
          p_file_id, p_amount_minor, f.fee_bps, v_legs[4], v_legs[1] + v_legs[4], v_legs[1],
          v_legs[2], v_legs[3], v_legs[4], f.start_at, f.end_at, f.deadline_at, p_request_id,
          v_now, v_due, 2, v_guest, v_ref, g.response_hours, v_due, g.cap_minor,
          'AWAITING_GUEST', v_review);
  -- avis au voyageur, dans la transaction de la déclaration (US-706 : EVT_INVOICE_TO_GUEST)
  IF NOT core.claim_traffic_notify_guest(v_id) THEN
    RAISE EXCEPTION 'refacturation : avis au voyageur impossible'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY SELECT 'DECLARED'::text, v_id, pg_catalog.jsonb_build_object(
    'amountMinor', p_amount_minor::text, 'adminFeeMinor', v_legs[4]::text,
    'totalMinor', (v_legs[1] + v_legs[4])::text,
    'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'responseDueAt', pg_catalog.to_char(v_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'opsReviewRequired', v_review,
    'legs', pg_catalog.jsonb_build_object('HOST', v_legs[1]::text, 'INSURER', v_legs[2]::text,
                                          'TAX_THIRD_PARTY', v_legs[3]::text,
                                          'PLATFORM', v_legs[4]::text));
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz,
  bigint, uuid, boolean, text) IS
  'Amende, péage ou fourrière déclarés par le titulaire du compte d''hôte de la session : pièce de '
  'sa série TRAFFIC, référence unique par compte d''hôte du pays (clé canonique), montant sous le '
  'plafond du pays (au-delà du seuil cumulé du trip : revue de l''ops avant tout débit), dans '
  'le délai du pays '
  '(08 BR-TT-02) ; jambes explicites ; voyageur avisé, délai de réponse figé. SECURITY DEFINER, '
  'EXECUTE app_api. US-318 (ADR-198, ADR-201, ADR-203).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
