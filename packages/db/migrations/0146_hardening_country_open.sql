-- 0146 — SUP / FIN / CAT : durcissement avant l'ouverture d'un pays (suites des revues : BOARD
-- N-354, N-342, N-313 ; ADR-171, PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- 1. N-354 (revues sécurité et architecture de #235, US-224e) : `CANCEL_HOST_TRIPS` n'annule les
--    trips à venir d'un hôte que s'il est DÉFAILLANT, c'est-à-dire suspendu par une restriction
--    active d'un genre de sûreté : `TS_HOLD` (confiance et sécurité), `POLICY_VIOLATION`,
--    `KYC_REVOKED`. Une restriction d'argent (`UNPAID_BALANCE`, `PAYMENT_PLAN_ACTIVE`,
--    `CHARGEBACK`) bloque toujours les nouvelles réservations (ADR-124, inchangé) mais ne suffit
--    plus à annuler en masse les trips d'un hôte qui doit seulement une avance à Kmino : issue
--    `HOST_NOT_RESTRICTED`, rien n'est écrit (fail-closed). Liste fermée, sans code pays ; comme
--    Turo (la plateforme annule les trips d'un hôte désactivé pour la sûreté, pas pour une dette).
--    Corps de 0140 recopié, une condition changée ; droit de lecture de `kind` AJOUTÉ à
--    `cmd_hold_owner` (colonne non personnelle, liste fermée).
-- 2. N-342 (revues sécurité de #231, US-217a) : `core.booking_trip_receipt` juge l'hôte comme le
--    relevé des gains (`booking_host_earnings`) : titulaire du compte ET rôle `P2P_HOST` `ACTIVE`
--    (`core.iam_host_accounts`). Un titulaire dont l'adhésion n'est plus active, comme un co-hôte
--    (`CO_HOST`), reçoit `NOT_FOUND`, la même réponse qu'un tiers (aucun oracle). Co-hôtes : refusés
--    tant qu'aucune permission de co-hôte ne porte la lecture des gains (BR-COHOST, PROPOSÉ,
--    fail-closed). Corps de 0137 recopié, le jugement de l'hôte changé.
-- 3. N-313 (revue sécurité de #229, N-83) : classe de valeur des saisies libres. Une marque ou un
--    modèle s'écrit de plusieurs façons (« G 500 », « G500 », « LandCruiser », « Mercedes ») :
--    `core.catalog_value_class_resolve` compare désormais les slugs SANS leurs tirets (« landcruiser »
--    = « land-cruiser ») et reconnaît un modèle suivi d'un chiffre (« g500 », « lx570 ») ou, pour un
--    modèle qui finit par un chiffre, d'une lettre (« 740i ») ; graine complétée (marques et modèles
--    absents, écritures « Mercedes » et « Mercedes-AMG » des modèles de Mercedes-Benz). Les règles
--    ne font toujours que RELEVER une classe ; la règle la plus précise l'emporte (modèle le plus
--    long sans ses tirets, puis règle du pays, puis la classe la plus haute). Une marque ou un modèle
--    absent de la table suit toujours le défaut du pays (ADR-159 corrigé) : la table se complète.
--    Les véhicules déjà classés ne sont pas recalculés (une classe posée ne change jamais).
--
-- Expand / contract : trois corps remplacés à signature, propriétaire, SECURITY et droits
-- identiques ; un droit de colonne et des règles AJOUTÉS ; rien n'est retiré. L'API N lit les mêmes
-- issues (aucun code nouveau).
--
-- Retour arrière :
--   réappliquer core.booking_manual_action_cancel_host_trips de 0140 (sous cmd_hold_owner),
--   core.booking_trip_receipt de 0137 (sous cmd_hold_owner), core.catalog_value_class_resolve de
--   0135 (sous migrator) ; REVOKE SELECT (kind) ON core.iam_restriction FROM cmd_hold_owner ;
--   UPDATE core.catalog_value_class_rule SET status = 'RETIRED'
--    WHERE source_ref LIKE '%N-313%' (jamais supprimées).

-- 1 et 2. Commandes de cmd_hold_owner ---------------------------------------------------------
GRANT SELECT (kind) ON core.iam_restriction TO cmd_hold_owner;

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 1. N-354 : seul un hôte suspendu pour la sûreté est « défaillant » (corps de 0140)
CREATE OR REPLACE FUNCTION core.booking_manual_action_cancel_host_trips(p_token_hash bytea,
                                                                        p_action_id uuid,
                                                                        p_action_code text,
                                                                        p_subject_id uuid,
                                                                        p_input jsonb,
                                                                        p_reason text,
                                                                        p_actor uuid,
                                                                        p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org    record;
  r        record;
  v_target text := core.booking_cancellation_target('HOST_ACCOUNT_CLOSED');
  v_n      integer := 0;
BEGIN
  IF p_action_code IS DISTINCT FROM 'CANCEL_HOST_TRIPS' OR p_action_id IS NULL
     OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL OR p_reason IS NULL
     OR p_input IS NULL THEN
    RAISE EXCEPTION 'annulation des trips d''un hôte : action invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT o.id, o.holder_user_id INTO v_org
    FROM core.iam_organization AS o WHERE o.id = p_subject_id;
  IF v_org.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- l'hôte défaillant est d'abord suspendu (08 BR-TRUST-09, ADR-124) par une restriction active
  -- d'un genre de SÛRETÉ (N-354, ADR-171) ; une restriction d'argent (dette, plan de paiement,
  -- rétrofacturation) ne rend pas l'hôte défaillant : rien n'est annulé (fail-closed)
  IF NOT EXISTS (SELECT 1 FROM core.iam_restriction AS x
                  WHERE x.user_id = v_org.holder_user_id AND x.active
                    AND x.kind IN ('TS_HOLD', 'POLICY_VIOLATION', 'KYC_REVOKED')) THEN
    RETURN QUERY SELECT 'HOST_NOT_RESTRICTED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- défense en profondeur (la console a déjà appliqué la garde ADR-122 au compte d'hôte) : l'agent
  -- n'annule pas un trip dont il est le voyageur
  IF EXISTS (SELECT 1 FROM core.booking_trip AS t
              WHERE t.org_id = v_org.id AND t.guest_user_id = p_actor) THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- trips à venir : état qui a une sortie CANCEL vers CANCELLED_BY_PLATFORM (paire de SM-1, même
  -- règle que CANCEL_TRIP_PLATFORM) ; une demande vivante d'un trip (autre agent, même instant) le
  -- laisse à sa demande (ON CONFLICT : index trip_cancellation_live_unique)
  FOR r IN
    SELECT t.id, t.country_code
      FROM core.booking_trip AS t
     WHERE t.org_id = v_org.id
       AND EXISTS (SELECT 1 FROM core.booking_trip_transition AS tt
                    WHERE tt.from_status = t.status AND tt.via = 'CANCEL'
                      AND tt.to_status = v_target)
       AND NOT EXISTS (SELECT 1 FROM core.booking_trip_cancellation AS c
                        WHERE c.trip_id = t.id AND c.status IN ('PENDING', 'SETTLED', 'FIN_REVIEW'))
     ORDER BY t.scheduled_start, t.id
  LOOP
    INSERT INTO core.booking_trip_cancellation
           (id, trip_id, country_code, action_code, requested_reason, initiator, sub_reason,
            requested_at, requested_by)
    VALUES (pg_catalog.md5(p_action_id::text || ':' || r.id::text)::uuid, r.id, r.country_code,
            'CANCEL_TRIP_PLATFORM', 'HOST_ACCOUNT_CLOSED', 'PLATFORM', NULL, platform.now(), p_actor)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RETURN QUERY SELECT 'NO_TRIP_TO_CANCEL'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, p_action_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.booking_manual_action_cancel_host_trips(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à CANCEL_HOST_TRIPS (cadre d''US-101) : hôte défaillant suspendu (restriction '
  'active TS_HOLD, POLICY_VIOLATION ou KYC_REVOKED ; jamais une restriction d''argent, N-354), une '
  'demande d''annulation PENDING par trip à venir de son compte, motif dérivé HOST_ACCOUNT_CLOSED '
  '(remboursement intégral, 08 BR-TRUST-09, BR-CXL-14), réglée par le travailleur trip_lifecycle ; '
  'aucun montant. EXECUTE iam_staff_owner. US-224e (ADR-163, ADR-171).';

-- 2. N-342 : l'hôte du reçu est jugé comme celui du relevé (corps de 0137)
CREATE OR REPLACE FUNCTION core.booking_trip_receipt(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, viewer_role text, trip_status text, currency text, timezone text,
                 receipt jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  t         record;
  v_role    text;
  v_receipt jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT tr.id, tr.status, tr.currency, tr.timezone, tr.guest_user_id, tr.org_id INTO t
    FROM core.booking_trip AS tr
   WHERE tr.id = p_trip_id;
  -- hôte : titulaire du compte avec le rôle P2P_HOST ACTIVE (iam_host_accounts, comme le relevé
  -- des gains ; N-342, ADR-171) ; co-hôte, adhésion retirée : refusé (fail-closed)
  v_role := CASE WHEN v_user IS NULL OR t.id IS NULL THEN NULL
                 WHEN v_user = t.guest_user_id THEN 'GUEST'
                 WHEN EXISTS (SELECT 1 FROM core.iam_host_accounts(p_token_hash) AS a
                               WHERE a.org_id = t.org_id) THEN 'HOST' END;
  IF v_role IS NULL THEN
    -- autre personne, trip inconnu, session absente : même réponse (aucun oracle d'existence)
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_receipt := core.finance_trip_receipt_view(t.id, v_role);
  IF v_receipt IS NULL THEN
    -- trip sans capture ni règlement : aucun montant à montrer (jamais un reçu deviné)
    RETURN QUERY SELECT 'NO_RECEIPT'::text, v_role, t.status, t.currency, t.timezone, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_role, t.status, t.currency, t.timezone, v_receipt;
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_receipt(bytea, uuid) IS
  'Reçu d''un trip pour sa partie de la session (voyageur : paiement et trip fee ; titulaire du '
  'compte d''hôte au rôle P2P_HOST ACTIVE : gains du trip) ; NOT_FOUND sinon, NO_RECEIPT sans '
  'capture ni règlement. SECURITY DEFINER, EXECUTE app_api. US-217 (217a, ADR-161 ; N-342, ADR-171).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. N-313 : écritures d'une saisie libre (corps de 0135 ; propriétaire migrator, inchangé) ------
CREATE OR REPLACE FUNCTION core.catalog_value_class_resolve(p_country text, p_variant uuid,
                                                            p_make_text text, p_model_text text)
  RETURNS TABLE (value_class text, source text, rule_id uuid)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_class text;
  v_make  text;
  v_model text;
  v_rule  record;
  v_def   text;
BEGIN
  IF p_country IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  -- 1. classe de la variante du catalogue
  IF p_variant IS NOT NULL THEN
    SELECT v.value_class, m.slug, o.slug INTO v_class, v_make, v_model
      FROM core.catalog_vehicle_variant AS v
      JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
      JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
     WHERE v.id = p_variant;
    IF v_class IS NOT NULL THEN
      RETURN QUERY SELECT v_class, 'CATALOG'::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;
  -- 2. règle de modèle ou de marque (variante du catalogue, sinon saisie de l'hôte). N-313 :
  --    marque comparée sans ses tirets ; modèle de la règle reconnu au début du modèle saisi, ses
  --    tirets facultatifs, suivi de la fin, d'un tiret, ou d'un chiffre (règle qui finit par une
  --    lettre : « g » ⇒ « g500 ») ou d'une lettre (règle qui finit par un chiffre : « 740 » ⇒
  --    « 740i ») ; les slugs n'ont que [a-z0-9-] : aucun caractère spécial dans le motif
  v_make := COALESCE(v_make, core.catalog_slug(p_make_text));
  v_model := COALESCE(v_model, core.catalog_slug(p_model_text));
  IF v_make IS NOT NULL THEN
    SELECT r.id, r.value_class, r.model_slug INTO v_rule
      FROM core.catalog_value_class_rule AS r
     WHERE r.status = 'ACTIVE'
       AND pg_catalog.replace(r.make_slug, '-', '') = pg_catalog.replace(v_make, '-', '')
       AND (r.country_code IS NULL OR r.country_code = p_country)
       AND (r.model_slug IS NULL
            OR (v_model IS NOT NULL
                AND v_model ~ ('^'
                  || pg_catalog.rtrim(pg_catalog.regexp_replace(
                       pg_catalog.replace(r.model_slug, '-', ''), '(.)', '\1-?', 'g'), '-?')
                  || CASE WHEN r.model_slug ~ '[a-z]$' THEN '(-|$|[0-9])'
                          ELSE '(-|$|[a-z])' END)))
     ORDER BY pg_catalog.char_length(pg_catalog.replace(COALESCE(r.model_slug, ''), '-', '')) DESC,
              (r.country_code IS NOT NULL) DESC,
              CASE r.value_class WHEN 'LUXE' THEN 3 WHEN 'PREMIUM' THEN 2 ELSE 1 END DESC,
              (r.make_slug = v_make) DESC, r.make_slug, r.id
     LIMIT 1;
    IF v_rule.id IS NOT NULL THEN
      RETURN QUERY SELECT v_rule.value_class,
                          CASE WHEN v_rule.model_slug IS NULL THEN 'MAKE_RULE'
                               ELSE 'MODEL_RULE' END::text,
                          v_rule.id;
      RETURN;
    END IF;
  END IF;
  -- 3. défaut du pays en vigueur (chaîne de la liste fermée, sinon aucune classe)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(pv.value) = 'string' THEN pv.value #>> '{}' END
    INTO v_def
    FROM core.config_param_value AS pv
   WHERE pv.key = 'vehicle_default_value_class' AND pv.country_code::text = p_country
     AND pv.scope_type = 'COUNTRY'
     AND pv.valid_from <= v_now AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
   ORDER BY pv.valid_from DESC
   LIMIT 1;
  IF v_def IN ('STANDARD', 'PREMIUM', 'LUXE') THEN
    RETURN QUERY SELECT v_def, 'COUNTRY_DEFAULT'::text, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::text, NULL::text, NULL::uuid;
END
$fn$;
COMMENT ON FUNCTION core.catalog_value_class_resolve(text, uuid, text, text) IS
  'Classe de valeur d''un véhicule : variante du catalogue (CATALOG), règle de modèle ou de marque '
  '(MODEL_RULE, MAKE_RULE ; écritures d''une saisie libre reconnues, N-313), défaut du pays '
  '(COUNTRY_DEFAULT) ; sinon aucune (fail-closed). Lecture seule. EXECUTE catalog_cmd_owner. '
  'N-83 (ADR-159, ADR-171).';

-- Graine complétée (PROPOSÉE, aucun code pays ; 08 BR-ACC-05 : PREMIUM au-delà de 35 000 $, LUXE
-- au-delà de 70 000 $, prix d'un véhicule récent, notoriété publique). Valeurs définitives selon
-- le contrat de l'assureur (POUR_LE_FONDATEUR.md §3).
INSERT INTO core.catalog_value_class_rule (make_slug, model_slug, value_class, source_ref) VALUES
  -- marques de luxe absentes
  ('karma', NULL, 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque de luxe)'),
  ('koenigsegg', NULL, 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque de luxe)'),
  ('lucid', NULL, 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque de luxe)'),
  ('pagani', NULL, 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque de luxe)'),
  ('rimac', NULL, 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque de luxe)'),
  -- marques premium absentes
  ('alpina', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('alpine', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('denza', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('hongqi', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('ineos', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('morgan', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('rivian', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('voyah', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  ('zeekr', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (marque premium)'),
  -- modèles de valeur haute absents d'une marque premium ou généraliste
  ('bmw', '7-series', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('bmw', '740', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('bmw', '750', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('bmw', '760', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('bmw', 'i7', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe)'),
  ('bmw', 'series-7', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('cadillac', 'escalade', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe)'),
  ('gmc', 'hummer', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe)'),
  ('gmc', 'sierra', 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (pick-up pleine taille)'),
  ('gmc', 'yukon', 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle premium)'),
  ('infiniti', 'qx80', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe)'),
  ('lincoln', 'navigator', 'LUXE', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe)'),
  ('nissan', 'armada', 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'prado', 'PREMIUM', '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle premium, saisie libre)');

-- Écritures « Mercedes », « Mercedes-AMG » et « Mercedes-Benz » : mêmes modèles de luxe, plus les
-- lettres seules de la Classe G et de la Classe S (« G 500 », « S 580 ») et leur nom français.
INSERT INTO core.catalog_value_class_rule (make_slug, model_slug, value_class, source_ref)
SELECT mk.slug, md.slug, 'LUXE',
       '08 BR-ACC-05 ; N-313 graine PROPOSÉE (modèle de luxe, saisie libre)'
  FROM (VALUES ('mercedes'), ('mercedes-amg'), ('mercedes-benz')) AS mk (slug)
 CROSS JOIN (VALUES ('amg-gt'), ('clase-g'), ('clase-s'), ('classe-g'), ('classe-s'), ('g'),
                    ('g-class'), ('gls'), ('s'), ('s-class'), ('sl')) AS md (slug)
 WHERE NOT EXISTS (SELECT 1 FROM core.catalog_value_class_rule AS r
                    WHERE r.country_code IS NULL AND r.make_slug = mk.slug
                      AND r.model_slug = md.slug);
