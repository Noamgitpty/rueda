-- 0093 — SUP / RISK / CAT : correctifs de la red team du lot 1 (séparation des tâches, auto-réservation, contestations, filtre de contact).
-- US-122 ; rapport docs/team/redteam/L1-rls-abus.md (constats F-L1-C-01, C-02, C-03, S-01, V-01,
-- F-01) ; 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24), §10 ; 16 ACC-014,
-- ADM-001 ; 19 US-101, US-106, US-118, US-123, US-124, US-127 ; ADR-092, ADR-110, ADR-114,
-- ADR-117 ; ADR-122 (cette migration, PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-122, PROPOSÉS) :
--   - UNE garde de séparation des tâches pour toute la console : `core.support_actor_conflict(
--     acteur, type de sujet, sujet)`. Personnes du sujet (`core.support_subject_parties`) :
--       USER_ACCOUNT            la personne ;
--       IDENTITY_VERIFICATION   la personne vérifiée ;
--       ORGANIZATION            titulaire du compte d'hôte et membres ACTIVE / INVITED de TOUS les
--                               comptes d'hôte de ce titulaire (tous pays, co-hôtes compris) ;
--       LISTING, VEHICLE        les mêmes, pour le compte de l'annonce ou du véhicule ;
--       VEHICLE_CLAIM           le demandeur, son compte ET le compte du véhicule contesté ;
--       CATALOG_ADDITION_REQUEST le demandeur et son compte ;
--       TRIP                    le voyageur et le compte d'hôte du trip ;
--       SUPPORT_CASE            le demandeur (et le trip du dossier) ;
--       PLATFORM_ADVANCE        le compte d'hôte débiteur (et le trip) ;
--       INSURER_BORDEREAU       personne (aucun particulier) ;
--       autre type              INCONNU ⇒ conflit présumé (fail-closed).
--     Conflit : l'acteur est l'une de ces personnes, ou l'ops a constaté un lien LINKED entre
--     l'acteur et l'une d'elles (`risk_account_link`, US-127) ;
--   - la garde est appelée par les TROIS points d'entrée des décisions de la console, avant toute
--     commande de domaine : `core.iam_staff_cmd_manual_action` (toutes les actions du catalogue :
--     décision d'hôte, filtrage et revue du filtrage des sanctions, décision KYC, restrictions,
--     création de compte d'hôte, DSR, actions FINANCE, actions d'enregistrement seul ; issue
--     REFUSED, détail SELF_FORBIDDEN, journalisée MANUAL_ACTION_REFUSED), la garde de la file
--     LISTING `core.support_staff_vehicle_item` (annonce, éligibilité du véhicule, contestation de
--     plaque ou de VIN : issue SELF_FORBIDDEN, journalisée STAFF_FORBIDDEN) et la garde de la file
--     d'ajout au catalogue `core.support_staff_catalog_item` (même issue). Les gardes par commande
--     existantes (0064, 0076, 0081) restent en place (défense en profondeur) ;
--   - auto-réservation (F-L1-S-01) : le signal SAME_IDENTITY compare des SACS DE MOTS normalisés
--     (prénoms et noms réunis, sans le découpage du document ; mots d'une lettre ignorés) : même
--     date de naissance ET tous les mots du sac le plus court présents dans le plus long, le plus
--     court comptant au moins deux mots. La clé d'US-103 (`core.kyc_legal_name_key`) et le
--     rapprochement du nom (`core.kyc_legal_name_match`) sont inchangés. Le fournisseur `FAKE` ne
--     rend aucun numéro de permis (ADR-102 : « aucun numéro ») : le hachage du numéro est reporté
--     au connecteur réel (lot C), comme le contrôle de doublon du fournisseur ;
--   - contestations de plaque (F-L1-V-01) : au plus `plate_claims_open_per_host[pays]` contestations
--     OUVERTES par compte d'hôte (graine 0094, défaut PROPOSÉ 5 ; absent ou mal formé ⇒ refus,
--     fail-closed) ; issue CLAIM_LIMIT_REACHED, jugée avant l'antivirus, sous un verrou du compte ;
--   - filtre de contact (F-L1-F-01, ADR-114 inchangée : il réduit le risque sans prétendre à
--     l'exhaustivité) : chiffres séparés par toute ponctuation, chiffres en toutes lettres (es,
--     pt-BR, en), « arroba », « punto / ponto / dot » suivi d'une extension, lettres isolées
--     réunies avant la recherche des messageries, messageries abrégées (insta, ig, wpp, zap…).
--     « Calle 50 », « Avenida 25 de Mayo », « Ciudad Uno » passent toujours.
--
-- Expand / contract : fonctions, droits et politiques ajoutés ; corps de
-- `core.iam_staff_cmd_manual_action` (0060), `core.support_staff_vehicle_item` (0077),
-- `core.support_staff_catalog_item` (0074), `core.risk_self_booking_signal` (0088),
-- `core.catalog_vehicle_claim_target` (0077) et `core.catalog_text_has_contact` (0084) remplacés à
-- signature, propriétaire et droits identiques. Le COMPORTEMENT se resserre volontairement : un
-- membre du staff ne décide plus sur un sujet qui le concerne ; deux comptes de la même personne
-- dont le permis découpe le nom autrement sont liés ; au-delà du plafond, une contestation est
-- refusée ; quelques écritures de contact de plus sont refusées. La version N de l'API traduit
-- une issue inconnue en refus (FORBIDDEN ou 503), sans rien écrire de plus.
--
-- Retour arrière :
--   réappliquer core.iam_staff_cmd_manual_action de 0060, core.support_staff_vehicle_item de 0077,
--     core.support_staff_catalog_item de 0074 (sous iam_staff_owner), core.risk_self_booking_signal
--     de 0088 (sous risk_limit_owner), core.catalog_vehicle_claim_target de 0077 et
--     core.catalog_text_has_contact de 0084 (sous catalog_cmd_owner) ;
--   DROP FUNCTION core.support_actor_conflict(uuid, text, uuid),
--     core.support_subject_parties(text, uuid), core.support_org_people(uuid),
--     core.kyc_legal_name_bags_match(text[], text[]), core.kyc_legal_name_bag(text, text) ;
--   DROP POLICY iam_staff_party_read ON core.iam_membership, core.kyc_identity_verification,
--     core.catalog_listing, core.catalog_vehicle, core.catalog_vehicle_claim,
--     core.catalog_addition_request ;
--   DROP POLICY catalog_cmd_claim_read ON core.config_param_definition, core.config_param_value ;
--   révoquer les droits accordés ci-dessous.

-- 1. Lectures d'iam_staff_owner : personnes d'un sujet (colonnes d'identifiants seulement) --------
GRANT SELECT (org_id, user_id, status) ON core.iam_membership TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.iam_membership FOR SELECT TO iam_staff_owner USING (true);
GRANT SELECT (id, user_id) ON core.kyc_identity_verification TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.kyc_identity_verification FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, org_id) ON core.catalog_listing TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.catalog_listing FOR SELECT TO iam_staff_owner USING (true);
GRANT SELECT (id, org_id) ON core.catalog_vehicle TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.catalog_vehicle FOR SELECT TO iam_staff_owner USING (true);
GRANT SELECT (id, org_id, claimant_user_id, target_vehicle_id) ON core.catalog_vehicle_claim
  TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.catalog_vehicle_claim FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, org_id, requested_by) ON core.catalog_addition_request TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.catalog_addition_request FOR SELECT TO iam_staff_owner
  USING (true);
-- politiques iam_staff_select déjà en place (0033, 0060) : colonnes seulement
GRANT SELECT (org_id, trip_id) ON core.settlement_platform_advance TO iam_staff_owner;

-- 2. Garde de séparation des tâches (sous iam_staff_owner, SECURITY INVOKER, EXECUTE à personne) --
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Personnes d'un compte d'hôte : titulaire et membres ACTIVE / INVITED de tous ses comptes d'hôte
-- (tous pays), comme le signal d'auto-réservation (ADR-110). Compte inconnu : aucune.
CREATE FUNCTION core.support_org_people(p_org uuid)
  RETURNS uuid[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT ARRAY(
    SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = p_org
    UNION
    SELECT m.user_id
      FROM core.iam_organization AS o
      JOIN core.iam_organization AS o2 ON o2.holder_user_id = o.holder_user_id
      JOIN core.iam_membership AS m ON m.org_id = o2.id AND m.status IN ('ACTIVE', 'INVITED')
     WHERE o.id = p_org)
$fn$;

-- Personnes concernées par un sujet de la console ; NULL = type inconnu (conflit présumé).
CREATE FUNCTION core.support_subject_parties(p_subject_type text, p_subject_id uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF p_subject_type IS NULL OR p_subject_id IS NULL THEN
    RETURN NULL;
  END IF;
  CASE p_subject_type
    WHEN 'USER_ACCOUNT' THEN
      RETURN ARRAY[p_subject_id];
    WHEN 'IDENTITY_VERIFICATION' THEN
      RETURN ARRAY(SELECT v.user_id FROM core.kyc_identity_verification AS v WHERE v.id = p_subject_id);
    WHEN 'ORGANIZATION' THEN
      RETURN core.support_org_people(p_subject_id);
    WHEN 'LISTING' THEN
      SELECT l.org_id INTO r FROM core.catalog_listing AS l WHERE l.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE' THEN
      SELECT x.org_id INTO r FROM core.catalog_vehicle AS x WHERE x.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE_CLAIM' THEN
      SELECT c.org_id, c.claimant_user_id, x.org_id AS target_org INTO r
        FROM core.catalog_vehicle_claim AS c
        LEFT JOIN core.catalog_vehicle AS x ON x.id = c.target_vehicle_id
       WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.claimant_user_id], NULL)
             || core.support_org_people(r.org_id) || core.support_org_people(r.target_org);
    WHEN 'CATALOG_ADDITION_REQUEST' THEN
      SELECT a.org_id, a.requested_by INTO r
        FROM core.catalog_addition_request AS a WHERE a.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requested_by], NULL) || core.support_org_people(r.org_id);
    WHEN 'TRIP' THEN
      SELECT t.guest_user_id, t.org_id INTO r FROM core.booking_trip AS t WHERE t.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.guest_user_id], NULL) || core.support_org_people(r.org_id);
    WHEN 'SUPPORT_CASE' THEN
      SELECT c.requester_user_id, c.trip_id INTO r
        FROM core.support_support_case AS c WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requester_user_id], NULL)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'PLATFORM_ADVANCE' THEN
      SELECT a.org_id, a.trip_id INTO r
        FROM core.settlement_platform_advance AS a WHERE a.id = p_subject_id;
      RETURN core.support_org_people(r.org_id)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'INSURER_BORDEREAU' THEN
      RETURN '{}'::uuid[];
    ELSE
      RETURN NULL;
  END CASE;
END
$fn$;

-- Conflit d'intérêts de l'acteur sur le sujet (ADR-122) : l'acteur est une personne du sujet, ou
-- un compte que l'ops a constaté LIÉ (US-127) à l'une d'elles ; type inconnu ou acteur absent :
-- conflit présumé (fail-closed).
CREATE FUNCTION core.support_actor_conflict(p_actor uuid, p_subject_type text, p_subject_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_parties uuid[] := core.support_subject_parties(p_subject_type, p_subject_id);
BEGIN
  IF p_actor IS NULL OR v_parties IS NULL THEN
    RETURN true;
  END IF;
  v_parties := pg_catalog.array_remove(v_parties, NULL);
  RETURN p_actor = ANY (v_parties)
      OR EXISTS (SELECT 1
                   FROM pg_catalog.unnest(v_parties) AS p(user_id)
                   JOIN core.risk_account_link AS l
                     ON l.user_low = LEAST(p.user_id, p_actor)
                    AND l.user_high = GREATEST(p.user_id, p_actor)
                  WHERE l.decision = 'LINKED');
END
$fn$;
COMMENT ON FUNCTION core.support_org_people(uuid) IS
  'Titulaire et membres ACTIVE / INVITED de tous les comptes d''hôte du titulaire d''un compte. '
  'Aide interne sous iam_staff_owner. US-122 (ADR-122).';
COMMENT ON FUNCTION core.support_subject_parties(text, uuid) IS
  'Personnes concernées par un sujet de la console (NULL : type inconnu). Aide interne sous '
  'iam_staff_owner. US-122 (ADR-122).';
COMMENT ON FUNCTION core.support_actor_conflict(uuid, text, uuid) IS
  'Séparation des tâches : vrai si l''acteur est une personne du sujet ou un compte lié (LINKED) à '
  'l''une d''elles ; type inconnu : vrai (fail-closed). Aide interne sous iam_staff_owner. US-122 '
  '(ADR-122, F-L1-C-01 à C-03).';
REVOKE ALL ON FUNCTION core.support_org_people(uuid), core.support_subject_parties(text, uuid),
  core.support_actor_conflict(uuid, text, uuid) FROM PUBLIC;

-- 3. Commande de console : garde de séparation des tâches avant la commande de domaine ----------
-- (définition de 0060 recopiée à l'identique ; seul le bloc marqué US-122 est ajouté, après les
-- contrôles de disponibilité et avant l'appel de la commande liée ou l'enregistrement seul).
CREATE OR REPLACE FUNCTION core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid,
                                                 p_action_code text, p_subject_id uuid,
                                                 p_reason text, p_input jsonb, p_evidence uuid[])
  RETURNS TABLE (outcome text, action_id uuid, domain_ref uuid, detail text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s        record;
  v_cat      record;
  v_resolver regprocedure;
  v_known    boolean;
  v_prev     record;
  v_h        record;
  v_input    jsonb := COALESCE(p_input, '{}'::jsonb);
  v_evidence uuid[] := COALESCE(p_evidence, '{}'::uuid[]);
  v_country  text;
  v_role     text;
  v_why      text;
  v_key      text;
  v_value    jsonb;
  v_handler  regprocedure;
  v_bad      text;
  v_call     text;
  v_outcome  text;
  v_ref      uuid;
  v_events   uuid[] := '{}'::uuid[];
  v_audit    bigint;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT c.action_code, c.permission_code, c.mode, c.subject_type, c.available, c.input_keys,
         c.input_values, c.requires_approval INTO v_cat
    FROM core.support_manual_action_catalog AS c WHERE c.action_code = p_action_code;
  IF v_cat.action_code IS NULL OR p_request_id IS NULL OR p_subject_id IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000
     OR pg_catalog.jsonb_typeof(v_input) <> 'object' OR pg_catalog.octet_length(v_input::text) > 4096
     OR pg_catalog.cardinality(v_evidence) > 20 OR pg_catalog.array_position(v_evidence, NULL) IS NOT NULL
     OR (SELECT pg_catalog.count(DISTINCT e) FROM pg_catalog.unnest(v_evidence) AS e)
        <> pg_catalog.cardinality(v_evidence) THEN
    RAISE EXCEPTION 'console : action, motif ou données invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', v_cat.action_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- pays du sujet, relu en base par le résolveur déclaré du type (jamais reçu du client), puis
  -- permission et portée pays. Le nom du résolveur est lu dans pg_proc, la valeur est liée.
  SELECT s.resolver INTO v_resolver
    FROM core.support_manual_action_subject AS s WHERE s.subject_type = v_cat.subject_type;
  -- un résolveur devenu non conforme (droit accordé plus tard…) : type traité comme inconnu
  v_known := v_resolver IS NOT NULL AND core.support_subject_resolver_check(v_resolver) IS NULL;
  IF v_known THEN
    SELECT pg_catalog.format('SELECT %I.%I($1)', n.nspname, p.proname) INTO v_call
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE p.oid = v_resolver;
    EXECUTE v_call INTO v_country USING p_subject_id;
    IF v_country IS NULL THEN
      v_why := 'SUBJECT_NOT_FOUND';
    ELSE
      v_role := core.iam_staff_permitted(v_s.user_id, v_cat.permission_code, ARRAY[v_country], NULL);
      IF v_role IS NULL THEN
        v_why := CASE WHEN core.support_staff_holds_permission(v_s.user_id, v_cat.permission_code)
                      THEN 'COUNTRY_SCOPE' ELSE 'PERMISSION' END;
      END IF;
    END IF;
  ELSIF NOT core.support_staff_holds_permission(v_s.user_id, v_cat.permission_code) THEN
    v_why := 'PERMISSION';
  END IF;
  IF v_why IS NOT NULL THEN
    -- 16 ADM-001 : action interdite => 403 journalisé ; sujet introuvable et hors portée : même issue
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why,
                                   'attempted', v_cat.action_code,
                                   'permission', v_cat.permission_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF NOT v_known THEN
    -- type de sujet sans table en Bêta : aucune commande ne peut encore y être liée
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code),
                                 p_reason, p_request_id);
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- règles de saisie de l'action : clés déclarées seulement, et pour chacune une valeur de
  -- l'énumération FERMÉE du catalogue (l'agent ne saisit jamais un montant : 19 US-101, 17 §10 NN3)
  FOR v_key, v_value IN SELECT e.key, e.value FROM pg_catalog.jsonb_each(v_input) AS e LOOP
    IF NOT (v_key = ANY (v_cat.input_keys))
       OR pg_catalog.jsonb_typeof(v_value) <> 'string'
       OR NOT COALESCE((v_cat.input_values -> v_key) ? (v_value #>> '{}'), false) THEN
      RAISE EXCEPTION 'console : donnée % refusée (clé non déclarée ou valeur hors énumération)', v_key
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  -- pièces : obligatoires pour une action d'enregistrement seul ; toujours des preuves reçues
  -- (seau PRIVATE_EVIDENCE, non supprimées)
  IF v_cat.mode = 'RECORD_ONLY' AND pg_catalog.cardinality(v_evidence) = 0 THEN
    RAISE EXCEPTION 'console : pièce obligatoire' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.cardinality(v_evidence) > 0
     AND (SELECT pg_catalog.count(*) FROM core.audit_file_asset AS f
           WHERE f.id = ANY (v_evidence) AND f.bucket = 'PRIVATE_EVIDENCE' AND f.deleted_at IS NULL)
         <> pg_catalog.cardinality(v_evidence) THEN
    RAISE EXCEPTION 'console : pièce inconnue' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- idempotence par (action, sujet, request_id) ; un request_id réutilisé ailleurs est refusé.
  -- Deux appels concurrents du même request_id sont sérialisés : le second attend la fin du
  -- premier, puis voit sa ligne (DUPLICATE) au lieu d'une violation d'unicité.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.manual_action:' || p_request_id::text, 0));
  SELECT m.id, m.action_code, m.subject_id, m.outcome, m.domain_ref INTO v_prev
    FROM core.support_manual_action AS m WHERE m.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action_code = v_cat.action_code AND v_prev.subject_id = p_subject_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id, v_prev.domain_ref, v_prev.outcome;
      RETURN;
    END IF;
    RAISE EXCEPTION 'console : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- disponibilité : RECORD_ONLY ouverte au catalogue ; DOMAIN_COMMAND liée à sa commande
  SELECT h.handler INTO v_handler
    FROM core.support_manual_action_handler AS h WHERE h.action_code = v_cat.action_code;
  IF (v_cat.mode = 'RECORD_ONLY' AND NOT v_cat.available)
     OR (v_cat.mode = 'DOMAIN_COMMAND' AND v_handler IS NULL) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                   'country', v_country), p_reason, p_request_id);
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_cat.mode = 'DOMAIN_COMMAND' THEN
    -- invariant revérifié à chaque appel : une liaison devenue non conforme (droit accordé plus
    -- tard à un rôle applicatif, propriétaire changé…) rend l'action indisponible, journalisé
    v_bad := core.support_manual_action_handler_check(v_cat.action_code, v_handler);
    IF v_bad IS NOT NULL THEN
      PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                   p_subject_id, NULL,
                                   pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                     'country', v_country, 'handler', v_bad), p_reason, p_request_id);
      RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- US-122 (ADR-122, F-L1-C-01 à C-03) : jamais une action sur un sujet qui concerne l'acteur
  -- (titulaire, membre, personne vérifiée, partie du trip ou du dossier, compte lié LINKED) ;
  -- même issue qu'un refus du domaine, journalisée, aucun effet
  IF core.support_actor_conflict(v_s.user_id, v_cat.subject_type, p_subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_REFUSED', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                   'country', v_country, 'domainOutcome', 'SELF_FORBIDDEN',
                                   'guard', 'SEPARATION_OF_DUTIES'), p_reason, p_request_id);
    RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, NULL::uuid, 'SELF_FORBIDDEN'::text;
    RETURN;
  END IF;

  IF v_cat.mode = 'RECORD_ONLY' THEN
    v_outcome := 'RECORDED';
  ELSE
    -- commande de domaine liée, dans la MÊME transaction : nom lu dans pg_catalog (jamais reçu),
    -- toutes les valeurs liées ; une erreur annule tout (aucune ligne, aucun audit)
    SELECT pg_catalog.format('SELECT h.outcome, h.ref_id, h.emitted_event_ids FROM %I.%I($1, $2, $3, $4, $5, $6, $7, $8) AS h',
                             n.nspname, p.proname)
      INTO v_call
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE p.oid = v_handler;
    EXECUTE v_call INTO v_h
      USING p_token_hash, p_request_id, v_cat.action_code, p_subject_id, v_input,
            pg_catalog.btrim(p_reason), v_s.user_id, v_role;
    IF v_h.outcome IS NULL THEN
      RAISE EXCEPTION 'console : la commande de domaine n''a rendu aucune issue';
    END IF;
    -- action d'argent : jamais un effet en une personne (RLS-24) ; une issue DONE annule tout
    IF v_cat.requires_approval AND v_h.outcome = 'DONE' THEN
      RAISE EXCEPTION 'console : % exige une seconde personne, issue DONE refusée', v_cat.action_code
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF v_h.outcome NOT IN ('DONE', 'REQUESTED') THEN
      PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_REFUSED', v_cat.subject_type,
                                   p_subject_id, NULL,
                                   pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                     'country', v_country, 'domainOutcome', v_h.outcome,
                                     'domainRef', v_h.ref_id), p_reason, p_request_id);
      RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, v_h.ref_id, v_h.outcome::text;
      RETURN;
    END IF;
    v_outcome := v_h.outcome;
    v_ref := v_h.ref_id;
    v_events := COALESCE(v_h.emitted_event_ids, '{}'::uuid[]);
  END IF;

  INSERT INTO core.support_manual_action (id, action_code, mode, subject_type, subject_id, country_code,
                                          actor_user_id, actor_role, input, evidence_file_ids, reason,
                                          emitted_event_ids, outcome, domain_ref, request_id)
  VALUES (p_request_id, v_cat.action_code, v_cat.mode, v_cat.subject_type, p_subject_id, v_country,
          v_s.user_id, v_role, v_input, v_evidence, pg_catalog.btrim(p_reason),
          v_events, v_outcome, v_ref, p_request_id);
  v_audit := core.iam_staff_audit(v_s.user_id, v_role,
                                  CASE v_outcome WHEN 'RECORDED' THEN 'MANUAL_ACTION_RECORDED'
                                                 WHEN 'DONE' THEN 'MANUAL_ACTION_DONE'
                                                 ELSE 'MANUAL_ACTION_REQUESTED' END,
                                  v_cat.subject_type, p_subject_id, NULL,
                                  pg_catalog.jsonb_build_object('manualActionId', p_request_id,
                                    'action', v_cat.action_code, 'mode', v_cat.mode,
                                    'country', v_country, 'outcome', v_outcome,
                                    'domainRef', v_ref,
                                    'evidence', pg_catalog.cardinality(v_evidence)),
                                  p_reason, p_request_id);
  UPDATE core.support_manual_action AS m SET audit_log_id = v_audit WHERE m.id = p_request_id;
  RETURN QUERY SELECT v_outcome, p_request_id, v_ref, NULL::text;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[]) IS
  'Action de console (17 §3.2.13, §10) : TOTP, permission, portée pays, aucun montant saisi, pièces '
  'des actions d''enregistrement seul, séparation des tâches (jamais un sujet qui concerne l''acteur, '
  'US-122), commande de domaine liée dans la même transaction ; refus journalisés. US-101 (ADR-092, '
  'ADR-122).';

-- 4. Gardes des files LISTING et CATALOG_ADDITION : même séparation des tâches -------------------
-- (définitions de 0077 et de 0074 recopiées à l'identique ; seul le bloc marqué US-122 est ajouté,
-- après les contrôles de permission, de pays et de prise en charge). Toute lecture ou décision qui
-- passe par la garde est refusée (SELF_FORBIDDEN) : dossier, pièce, décision du véhicule,
-- contestation, annonce, demande d'ajout.
CREATE OR REPLACE FUNCTION core.support_staff_vehicle_item(p_user uuid, p_item_id uuid, p_subject_type text,
                                                p_attempted text, p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'LISTING' OR v_item.subject_type <> p_subject_type THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  -- US-122 (ADR-122, F-L1-C-03) : jamais un élément dont le sujet concerne l'acteur (titulaire ou
  -- membre du compte, demandeur, compte du véhicule contesté, compte lié LINKED) ; journalisé
  IF core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id) THEN
    PERFORM core.iam_staff_audit(p_user, role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM', p_item_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', p_attempted, 'country', v_item.country_code),
                                 NULL, p_request_id);
    refusal := 'SELF_FORBIDDEN';
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;

CREATE OR REPLACE FUNCTION core.support_staff_catalog_item(p_user uuid, p_item_id uuid, p_attempted text,
                                                p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'CATALOG_ADDITION' OR v_item.subject_type <> 'CATALOG_ADDITION_REQUEST'
      THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  -- US-122 (ADR-122, F-L1-C-03) : jamais un élément dont le sujet concerne l'acteur (titulaire ou
  -- membre du compte, demandeur, compte du véhicule contesté, compte lié LINKED) ; journalisé
  IF core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id) THEN
    PERFORM core.iam_staff_audit(p_user, role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM', p_item_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', p_attempted, 'country', v_item.country_code),
                                 NULL, p_request_id);
    refusal := 'SELF_FORBIDDEN';
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;

COMMENT ON FUNCTION core.support_staff_vehicle_item(uuid, uuid, text, text, uuid) IS
  'Garde commune des éléments de la file LISTING (permission, pays, prise en charge, séparation des '
  'tâches US-122). Aide interne sous iam_staff_owner. US-124 (ADR-107, ADR-122).';
COMMENT ON FUNCTION core.support_staff_catalog_item(uuid, uuid, text, uuid) IS
  'Garde commune des éléments de la file CATALOG_ADDITION (permission, pays, prise en charge, '
  'séparation des tâches US-122). Aide interne sous iam_staff_owner. US-114 (ADR-104, ADR-122).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 5. Sac de mots du nom (F-L1-S-01) : fonctions pures (SECURITY INVOKER, IMMUTABLE) ---------------
-- Mots normalisés (core.kyc_name_tokens d'US-103 : casse, accents, ponctuation, particules) des
-- prénoms ET des noms réunis, sans doublon, triés ; les mots d'une lettre (initiales) sont ignorés.
CREATE FUNCTION core.kyc_legal_name_bag(p_given text, p_surnames text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT ARRAY(SELECT DISTINCT x
                 FROM pg_catalog.unnest(core.kyc_name_tokens(p_given)
                                        || core.kyc_name_tokens(p_surnames)) AS x
                WHERE pg_catalog.char_length(x) >= 2
                ORDER BY x)
$fn$;
-- Deux sacs désignent la même personne (à date de naissance égale, jugée par l'appelant) : le plus
-- court compte au moins deux mots et tous ses mots sont dans l'autre.
CREATE FUNCTION core.kyc_legal_name_bags_match(p_a text[], p_b text[])
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(LEAST(pg_catalog.cardinality(p_a), pg_catalog.cardinality(p_b)) >= 2
                  AND (p_a <@ p_b OR p_b <@ p_a), false)
$fn$;
COMMENT ON FUNCTION core.kyc_legal_name_bag(text, text) IS
  'Sac de mots normalisés d''un nom (prénoms et noms réunis, initiales ignorées) du signal '
  'SAME_IDENTITY. Pure. US-122 (ADR-122, F-L1-S-01).';
COMMENT ON FUNCTION core.kyc_legal_name_bags_match(text[], text[]) IS
  'Inclusion de deux sacs de mots (le plus court : deux mots au moins) du signal SAME_IDENTITY. '
  'Pure. US-122 (ADR-122, F-L1-S-01).';
REVOKE ALL ON FUNCTION core.kyc_legal_name_bag(text, text),
  core.kyc_legal_name_bags_match(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_legal_name_bag(text, text),
  core.kyc_legal_name_bags_match(text[], text[]) TO risk_limit_owner;

-- 6. Signal d'auto-réservation (sous risk_limit_owner ; définition de 0088 recopiée, seul le
-- jugement SAME_IDENTITY change, marqué US-122 : sac de mots et inclusion au lieu de la clé
-- « prénoms | noms ») ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO risk_limit_owner;
SET LOCAL ROLE risk_limit_owner;
CREATE OR REPLACE FUNCTION core.risk_self_booking_signal(p_guest uuid, p_org uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid;
  v_host   uuid[];
  v_auto   uuid[];
  v_signal text;
  v_key    text;
  v_birth  date;
BEGIN
  -- entrée absente ou compte inconnu : aucun lien jugeable, fail-closed
  IF p_guest IS NULL OR p_org IS NULL THEN
    RETURN 'DIRECT';
  END IF;
  SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = p_org;
  IF v_holder IS NULL THEN
    RETURN 'DIRECT';
  END IF;
  -- personnes du côté hôte : titulaire du compte du véhicule et membres ACTIVE / INVITED de tous
  -- les comptes d'hôte de ce titulaire (tous pays)
  v_host := ARRAY(
    SELECT v_holder
    UNION
    SELECT m.user_id
      FROM core.iam_organization AS o2
      JOIN core.iam_membership AS m ON m.org_id = o2.id AND m.status IN ('ACTIVE', 'INVITED')
     WHERE o2.holder_user_id = v_holder);
  IF p_guest = ANY (v_host) THEN
    RETURN 'DIRECT';
  END IF;
  -- constat LINKED de l'ops sur une paire (voyageur, personne du côté hôte)
  SELECT l.signal INTO v_signal
    FROM pg_catalog.unnest(v_host) AS h(user_id)
    JOIN core.risk_account_link AS l
      ON l.user_low = LEAST(h.user_id, p_guest) AND l.user_high = GREATEST(h.user_id, p_guest)
   WHERE l.decision = 'LINKED'
   ORDER BY l.signal LIMIT 1;
  IF v_signal IS NOT NULL THEN
    RETURN v_signal;
  END IF;
  -- signaux automatiques : toutes les personnes du côté hôte sauf celles constatées NOT_LINKED
  v_auto := ARRAY(
    SELECT h.user_id
      FROM pg_catalog.unnest(v_host) AS h(user_id)
     WHERE NOT EXISTS (SELECT 1 FROM core.risk_account_link AS l
                        WHERE l.user_low = LEAST(h.user_id, p_guest)
                          AND l.user_high = GREATEST(h.user_id, p_guest)
                          AND l.decision = 'NOT_LINKED'));
  IF pg_catalog.cardinality(v_auto) = 0 THEN
    RETURN NULL;
  END IF;
  -- SAME_IDENTITY : identités du voyageur (chacune de ses vérifications approuvées une fois) ;
  -- aucune ⇒ aucune lecture côté hôte (cas courant). US-122 : sac de mots du nom lu sur le permis
  -- (sinon du nom déclaré), comparé par inclusion (ADR-122)
  IF EXISTS (
    WITH g AS (
      SELECT COALESCE(
               NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
               core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag,
             s.date_of_birth
        FROM core.iam_user_account AS u
        JOIN core.kyc_identity_verification AS v
          ON v.user_id = u.id AND v.first_approved_at IS NOT NULL
        JOIN core.kyc_identity_subject AS s
          ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
       WHERE u.id = p_guest AND u.pseudonymized_at IS NULL
    ),
    h AS (
      SELECT COALESCE(
               NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
               core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag,
             s.date_of_birth
        FROM pg_catalog.unnest(v_auto) AS a(user_id)
        JOIN core.iam_user_account AS u ON u.id = a.user_id
        JOIN core.kyc_identity_verification AS v
          ON v.user_id = u.id AND v.first_approved_at IS NOT NULL
        JOIN core.kyc_identity_subject AS s
          ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
       WHERE u.pseudonymized_at IS NULL
         AND EXISTS (SELECT 1 FROM g)
    )
    -- US-122 (F-L1-S-01) : sacs de mots, inclusion, même date de naissance
    SELECT 1 FROM g JOIN h ON h.date_of_birth = g.date_of_birth
     WHERE core.kyc_legal_name_bags_match(g.name_bag, h.name_bag)) THEN
    RETURN 'SAME_IDENTITY';
  END IF;
  -- SAME_PHONE : même numéro, vérifié sur l'un des deux comptes au moins
  IF EXISTS (SELECT 1
               FROM core.iam_user_account AS g
               JOIN core.iam_user_account AS h ON h.id = ANY (v_auto)
              WHERE g.id = p_guest AND g.pseudonymized_at IS NULL
                AND h.pseudonymized_at IS NULL AND g.phone_e164 IS NOT NULL
                AND g.phone_e164 = h.phone_e164
                AND (g.phone_verified_at IS NOT NULL OR h.phone_verified_at IS NOT NULL)) THEN
    RETURN 'SAME_PHONE';
  END IF;
  RETURN NULL;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;

-- 7. Contestations de plaque (F-L1-V-01) et filtre de contact (F-L1-F-01), sous catalog_cmd_owner -
-- plafond du pays lu par catalog_param_int : cette clé seulement (graine 0094)
CREATE POLICY catalog_cmd_claim_read ON core.config_param_definition FOR SELECT
  TO catalog_cmd_owner
  USING (key = 'plate_claims_open_per_host');
CREATE POLICY catalog_cmd_claim_read ON core.config_param_value FOR SELECT
  TO catalog_cmd_owner
  USING (key = 'plate_claims_open_per_host');
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 7.1 Cible d'une contestation (définition de 0077 recopiée ; plafond marqué US-122, jugé après le
-- doublon). Issue ajoutée : CLAIM_LIMIT_REACHED (rien n'est révélé d'un autre compte).
CREATE OR REPLACE FUNCTION core.catalog_vehicle_claim_target(p_token_hash bytea, p_org uuid, p_plate text,
                                                  p_vin text)
  RETURNS TABLE (outcome text, user_id uuid, country_code text, target uuid, plate text, vin text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h       record;
  v_plate text := core.catalog_normalize_plate(p_plate);
  v_vin   text := core.catalog_normalize_vin(p_vin);
  v_t     uuid;
  v_max   bigint;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_plate IS NULL OR v_plate !~ '^[A-Z0-9]{2,12}$'
     OR (p_vin IS NOT NULL AND (v_vin IS NULL OR v_vin !~ '^[A-Z0-9]{5,17}$')) THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT x.id INTO v_t
    FROM core.catalog_vehicle AS x
   WHERE x.released_at IS NULL AND x.country_code = h.country_code AND x.org_id <> p_org
     AND (x.plate = v_plate OR (v_vin IS NOT NULL AND x.vin = v_vin))
   ORDER BY x.created_at, x.id
   LIMIT 1;
  IF v_t IS NULL THEN
    RETURN QUERY SELECT 'CLAIM_NOT_NEEDED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_claim AS c
              WHERE c.org_id = p_org AND c.target_vehicle_id = v_t AND c.status = 'OPEN') THEN
    RETURN QUERY SELECT 'CLAIM_DUPLICATE'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  -- US-122 (F-L1-V-01, ADR-122) : plafond de contestations OUVERTES par compte d'hôte, paramètre
  -- du pays (absent ou mal formé : refus, fail-closed) ; compté sous un verrou du compte, que
  -- l'ouverture garde jusqu'à la fin de sa transaction (deux ouvertures concurrentes : sérialisées)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cat.claim.org:' || p_org::text, 0));
  v_max := core.catalog_param_int('plate_claims_open_per_host', h.country_code);
  IF v_max IS NULL
     OR (SELECT pg_catalog.count(*) FROM core.catalog_vehicle_claim AS c
          WHERE c.org_id = p_org AND c.status = 'OPEN') >= v_max THEN
    RETURN QUERY SELECT 'CLAIM_LIMIT_REACHED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, h.user_id, h.country_code, v_t, v_plate, v_vin;
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_claim_target(bytea, uuid, text, text) IS
  'Cible d''une contestation de plaque ou de VIN (N-61) : compte, doublon, plafond de contestations '
  'ouvertes du pays (US-122). Aide interne sous catalog_cmd_owner. US-124 (ADR-107, ADR-122).';

-- 7.2 Contact hors plateforme (définition de 0084 élargie, marquée US-122 ; ADR-114 : le filtre
-- réduit le risque sans prétendre à l'exhaustivité). Avant les règles de 0084, sur le texte
-- normalisé (NFKC, invisibles retirés) :
--   - chiffres en toutes lettres (es, pt-BR, en ; mots entiers) remplacés par le chiffre ;
--   - suite de 7 chiffres ou plus séparés par toute ponctuation ou blanc (barres, virgules…),
--     jamais par une lettre : « Calle 50 », « Avenida 25 de Mayo », « Ciudad Uno » passent ;
--   - « arroba » (mot entier), ou « punto / ponto / dot / point » suivi d'une extension courante ;
--   - lettres isolées séparées (« w h a t s a p p », « i.n.s.t.a ») réunies avant la recherche des
--     messageries ; messageries abrégées en mots entiers (insta, ig, wpp, zap, signal, viber…).
CREATE OR REPLACE FUNCTION core.catalog_text_has_contact(p_text text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT core.catalog_public_text_norm(p_text) AS v),
  -- US-122 : chiffres en toutes lettres (es, pt-BR, en) remplacés par le chiffre
  w AS (
    SELECT t.v,
           pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(t.v,
             '\m(cero|zero)\M', '0', 'gi'),
             '\m(uno|una|um|uma|one)\M', '1', 'gi'),
             '\m(dos|dois|duas|two)\M', '2', 'gi'),
             '\m(tres|três|three)\M', '3', 'gi'),
             '\m(cuatro|quatro|four)\M', '4', 'gi'),
             '\m(cinco|five)\M', '5', 'gi'),
             '\m(seis|six)\M', '6', 'gi'),
             '\m(siete|sete|seven)\M', '7', 'gi'),
             '\m(ocho|oito|eight)\M', '8', 'gi'),
             '\m(nueve|nove|nine)\M', '9', 'gi') AS d
      FROM t
  )
  SELECT p_text IS NOT NULL AND (
       w.v ~ '[0-9]([[:space:]().-]*[0-9]){6,}'
    OR w.v ~* '@[a-z0-9_.]{2,}'
    OR w.v ~* '(https?:|www\.|wa\.me|t\.me)'
    OR w.v ~* '[a-z0-9-]{2,}\.[a-z]{2,3}(/|[[:space:]]|$)'
    OR w.v ~* '(whatsapp|telegram|instagram|facebook|tiktok|wsp)'
    -- US-122 (F-L1-F-01) : contournements simples
    OR w.d ~ '[0-9]([^[:alnum:]]*[0-9]){6,}'
    OR w.v ~* '\marroba\M'
    OR w.v ~* '\m(punto|ponto|dot|point)\M[^[:alnum:]]*(com|net|org|info|io|co|me|app|biz)\M'
    OR w.v ~* '\m(insta|ig|wpp|zap|zapzap|signal|viber|messenger|snapchat|discord)\M'
    OR EXISTS (
         SELECT 1
           FROM pg_catalog.regexp_matches(w.v,
                  '(?:^|[^[:alpha:]])([[:alpha:]](?:[^[:alnum:]]{1,3}[[:alpha:]]){3,})(?![[:alpha:]])',
                  'g') AS m
          WHERE pg_catalog.regexp_replace(pg_catalog.lower(m[1]), '[^[:alpha:]]', '', 'g')
                ~ '(whatsapp|whats|wsp|wpp|telegram|insta|facebook|tiktok|signal|viber|zap)'))
    FROM w
$fn$;
COMMENT ON FUNCTION core.catalog_text_has_contact(text) IS
  'Téléphone (chiffres ou chiffres en lettres, toute ponctuation), courriel ou identifiant (« @ », '
  '« arroba », « punto com »), adresse web, messagerie nommée, abrégée ou en lettres espacées dans '
  'un texte public. Aide interne sous catalog_cmd_owner. US-118, US-122 (ADR-114, ADR-122).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
