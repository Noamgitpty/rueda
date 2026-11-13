-- 0086 — KYC : numéro fiscal de l'hôte facultatif à l'activation (« jamais plus lourd que Turo »).
-- US-123 (allègement) ; DEC-FONDATEUR-22 ; ADR-115 (cette migration et la graine générée 0085 ;
-- complète ADR-105) ;
-- 17 §2.4 (règle d'activation), §2.8 (capacités du PSP : inconnue = « non ») ; 16 HST-049 / FIN-008 ;
-- 22 OQ-P2P-07 ; DNIT RG 69/2020 (inscription au RUC : obligation de l'hôte dans les 30 jours
-- ouvrables après ses premiers revenus imposables, pas une condition de la plateforme).
-- Appliquée sous `migrator`.
--
-- Principes (ADR-115, PROPOSÉ) :
--   - paramètre de pays `host_tax_id_required_for_activation` (BOOL, portée COUNTRY, graine générée
--     0085) : true ⇒ le
--     numéro fiscal est une pièce du dossier (comportement de 0075) ; ABSENT ou mal formé ⇒ exigé
--     (fail-closed) ; graine false en PA et en PY (DEC-FONDATEUR-22). Il remplace, pour le dossier
--     et l'activation, la lecture de `p2p_host_requires_tax_id` (0009 immuable : la clé reste,
--     plus lue par le KYC de l'hôte) ;
--   - saisie toujours possible et chiffrée (0075 inchangée sur ce point) ; un PREMIER numéro est
--     admis aussi en revue ou après l'approbation (le numéro n'est plus une pièce du dossier) ; un
--     numéro enregistré ne se remplace pas après l'envoi (même règle qu'avant) ;
--   - versement : si un sous-marchand ACTIVE de l'hôte est chez un PSP qui n'a PAS validé
--     `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` (capacité inconnue = « non », 17 §2.8), le numéro est
--     exigé : blocage `HOST_TAX_ID_REQUIRED` à l'activation, hôte non activable tant qu'il manque.
--     Sans sous-marchand ACTIVE, l'activation reste bloquée par `SUBMERCHANT_NOT_ACTIVE` ;
--   - indiscernabilité (VER-028) : aucun de ces calculs ne lit le filtrage des sanctions ; un hôte
--     retenu et un hôte propre reçoivent les mêmes réponses à chaque étape.
--
-- Fonctions remplacées (même signature, même propriétaire kyc_cmd_owner, droits et commentaires
-- conservés ; corps de 0075 recopiés, seules les lignes marquées ADR-115 changent) :
-- core.kyc_host_gates(uuid), core.kyc_host_blockers(uuid), core.kyc_host_state(bytea, uuid),
-- core.kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text).
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   recréer les quatre fonctions avec les corps de 0075 ; DROP FUNCTION
--   core.kyc_host_psp_requires_tax_id(uuid), core.kyc_host_tax_saved(uuid) ; recréer la politique
--   kyc_cmd_host_read de core.config_param_value avec la liste de 0075 ; DELETE de la capacité
--   SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID du catalogue (la graine 0085 a son propre retour arrière).

-- 1. Capacité du PSP (17 §2.8 ; même liste que CAPABILITIES, module PAY) --------------------------
-- NON bloquante pour tous les hôtes : elle ne décide que du numéro fiscal au versement ; inconnue
-- ou non validée ⇒ numéro exigé à l'activation (section 3.4).
INSERT INTO core.payment_psp_capability_catalog (capability, kind, blocking, source) VALUES
  ('SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID', 'bool', 'NO',
   'ADR-115 (PROPOSÉ ; écart à reporter dans 17 §2.8) : versement B2C à un hôte sans numéro fiscal');

-- 2. Lecture du paramètre par kyc_cmd_owner (liste de 0075 + la nouvelle clé ; même nom, même
-- table : remplacement admis, ADR-081)
DROP POLICY kyc_cmd_host_read ON core.config_param_value;
CREATE POLICY kyc_cmd_host_read ON core.config_param_value FOR SELECT TO kyc_cmd_owner
  USING (key IN ('host_min_age_years', 'p2p_host_requires_tax_id', 'p2p_private_hosts_enabled',
                 'insurer_contract_active', 'host_tax_id_required_for_activation'));

-- 3. Fonctions (créées ou remplacées par leur propriétaire NOLOGIN, mécanique de 0077) ------------
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

-- 3.1 Numéro fiscal enregistré pour le compte d'hôte, d'un type admis dans le pays du compte.
CREATE FUNCTION core.kyc_host_tax_saved(p_org uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM core.kyc_host_tax_profile AS p
                   JOIN core.iam_organization AS o ON o.id = p.org_id
                   JOIN core.config_country AS k ON k.code::text = p.country_code
                  WHERE p.org_id = p_org AND p.country_code = o.country_code
                    AND p.tax_id_kind = ANY (k.host_tax_id_kinds))
$fn$;

-- 3.2 Numéro fiscal exigé par le PSP pour le versement (ADR-115) : vrai si un sous-marchand
-- ACTIVE de l'hôte, sur un compte marchand du pays du compte d'hôte, est chez un fournisseur qui
-- n'a pas VALIDÉ `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` (ligne en vigueur la plus récente de portée
-- (*, *) ; absente, `UNKNOWN`, `DOCUMENTED` ou valeur autre que true ⇒ exigé). Faux sans
-- sous-marchand ACTIVE (l'activation est alors bloquée par SUBMERCHANT_NOT_ACTIVE).
CREATE FUNCTION core.kyc_host_psp_requires_tax_id(p_org uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM core.payment_psp_submerchant AS m
      JOIN core.payment_psp_account AS a ON a.id = m.psp_account_id
      JOIN core.iam_organization AS o ON o.id = m.org_id
     WHERE m.org_id = p_org AND m.kyc_status = 'ACTIVE' AND a.country_code = o.country_code
       AND NOT COALESCE((
         SELECT v.status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT')
                AND v.value = 'true'::jsonb
           FROM core.payment_psp_capability AS v
          WHERE v.provider = a.provider AND v.country_code = a.country_code
            AND v.method = '*' AND v.network = '*'
            AND v.capability = 'SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID'
            AND v.valid_from <= platform.now()
          ORDER BY v.valid_from DESC
          LIMIT 1), false))
$fn$;

-- 3.3 Contrôles d'un compte d'hôte (0075 ; ADR-115 : clé du paramètre du dossier).
CREATE OR REPLACE FUNCTION core.kyc_host_gates(p_org uuid)
  RETURNS TABLE (org_id uuid, user_id uuid, country_code text, org_status text, kyc_id uuid,
                 age text, residence text, tax text, terms_ok boolean, screening_id uuid,
                 screening_result text, submerchant_ok boolean, capabilities_ok boolean,
                 p2p_open boolean, insurer_open boolean)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org      record;
  v_kyc      record;
  v_birth    date;
  v_res      text;
  v_tz       text;
  v_min      jsonb;
  v_age      text;
  v_resid    text;
  v_req      jsonb;
  v_tax      text;
  v_scr      record;
BEGIN
  SELECT o.id, o.holder_user_id, o.country_code, o.status INTO v_org
    FROM core.iam_organization AS o WHERE o.id = p_org AND o.kind = 'P2P_HOST_INDIVIDUAL';
  IF v_org.id IS NULL THEN
    RETURN;
  END IF;
  SELECT v.id, v.attempt INTO v_kyc FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_org.holder_user_id AND v.is_current AND v.status = 'APPROVED';
  -- règle de priorité : faits VÉRIFIÉS de la vérification courante approuvée, sinon déclarés
  IF v_kyc.id IS NOT NULL THEN
    SELECT s.date_of_birth, s.residence_country::text INTO v_birth, v_res
      FROM core.kyc_identity_subject AS s
     WHERE s.verification_id = v_kyc.id AND s.attempt = v_kyc.attempt;
  END IF;
  IF v_birth IS NULL THEN
    SELECT u.date_of_birth INTO v_birth FROM core.iam_user_account AS u
     WHERE u.id = v_org.holder_user_id;
  END IF;
  -- âge minimal du pays (OQ-P2P-01), au jour du fuseau du pays
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = v_org.country_code;
  v_min := core.kyc_host_param('host_min_age_years', v_org.country_code);
  IF v_min IS NULL OR pg_catalog.jsonb_typeof(v_min) <> 'number'
     OR (v_min #>> '{}') !~ '^[0-9]{1,3}$' OR v_tz IS NULL THEN
    v_age := 'PARAM_MISSING';
  ELSIF v_birth IS NULL THEN
    v_age := 'UNVERIFIED';
  ELSIF v_birth > (platform.now() AT TIME ZONE v_tz)::date
                  - pg_catalog.make_interval(years => (v_min #>> '{}')::integer) THEN
    v_age := 'UNDER_AGE';
  ELSE
    v_age := 'OK';
  END IF;
  v_resid := CASE WHEN v_res IS NULL THEN 'DECLARED'
                  WHEN v_res = v_org.country_code THEN 'VERIFIED'
                  ELSE 'MISMATCH' END;
  -- profil fiscal : exigé au DOSSIER si host_tax_id_required_for_activation vaut true ou s'il est
  -- absent ou mal formé (fail-closed ; ADR-115, DEC-FONDATEUR-22 : false en PA et en PY)
  v_req := core.kyc_host_param('host_tax_id_required_for_activation', v_org.country_code);
  IF v_req IS NOT DISTINCT FROM 'false'::jsonb
     OR EXISTS (SELECT 1 FROM core.kyc_host_tax_profile AS p
                  JOIN core.config_country AS k ON k.code::text = p.country_code
                 WHERE p.org_id = v_org.id AND p.country_code = v_org.country_code
                   AND p.tax_id_kind = ANY (k.host_tax_id_kinds)) THEN
    v_tax := 'OK';
  ELSE
    v_tax := 'MISSING';
  END IF;
  SELECT s.id, s.result INTO v_scr
    FROM core.kyc_host_verification AS h
    JOIN core.kyc_sanctions_screening AS s ON s.id = h.sanctions_screening_id
   WHERE h.org_id = v_org.id;
  RETURN QUERY SELECT
    v_org.id, v_org.holder_user_id, v_org.country_code, v_org.status, v_kyc.id, v_age, v_resid,
    v_tax, NOT core.ctr_host_terms_required(v_org.holder_user_id, v_org.country_code),
    v_scr.id, v_scr.result,
    EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS m
              JOIN core.payment_psp_account AS a ON a.id = m.psp_account_id
             WHERE m.org_id = v_org.id AND m.kyc_status = 'ACTIVE'
               AND a.country_code = v_org.country_code),
    EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS m
              JOIN core.payment_psp_account AS a ON a.id = m.psp_account_id
             WHERE m.org_id = v_org.id AND m.kyc_status = 'ACTIVE'
               AND a.country_code = v_org.country_code
               AND pg_catalog.cardinality(core.payment_missing_blocking_capabilities(
                     a.provider, a.country_code, a.collection_mode)) = 0),
    core.config_go_live('p2p_private_hosts_enabled', v_org.country_code),
    core.config_go_live('insurer_contract_active', v_org.country_code);
END
$fn$;

-- 3.4 Blocages de l'activation (0075 ; ADR-115 : numéro exigé aussi par le PSP du versement).
CREATE OR REPLACE FUNCTION core.kyc_host_blockers(p_org uuid)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  g  record;
  b  text[] := '{}';
BEGIN
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  IF g.org_id IS NULL THEN
    RETURN ARRAY['HOST_NOT_ACTIVATED'];
  END IF;
  IF g.age = 'UNDER_AGE' THEN b := b || 'HOST_UNDER_AGE'::text;
  ELSIF g.age = 'UNVERIFIED' THEN b := b || 'HOST_AGE_UNVERIFIED'::text;
  ELSIF g.age <> 'OK' THEN b := b || 'PARAM_MISSING'::text;
  END IF;
  IF g.residence = 'MISMATCH' THEN b := b || 'HOST_RESIDENCE_MISMATCH'::text; END IF;
  -- numéro fiscal : exigé par le pays (dossier), ou par le PSP du sous-marchand ACTIVE pour le
  -- versement (capacité inconnue = exigé, ADR-115)
  IF g.tax <> 'OK'
     OR (core.kyc_host_psp_requires_tax_id(p_org) AND NOT core.kyc_host_tax_saved(p_org)) THEN
    b := b || 'HOST_TAX_ID_REQUIRED'::text;
  END IF;
  IF NOT g.terms_ok THEN b := b || 'TERMS_REACCEPT_REQUIRED'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.kyc_host_verification AS h
                  WHERE h.org_id = p_org AND h.status = 'APPROVED') THEN
    b := b || 'HOST_VERIFICATION_NOT_APPROVED'::text;
  END IF;
  IF NOT g.submerchant_ok THEN b := b || 'SUBMERCHANT_NOT_ACTIVE'::text; END IF;
  -- capacité bloquante inconnue ou non validée : hôte non activable (CLAUDE.md contrainte 4)
  IF NOT g.capabilities_ok THEN b := b || 'PSP_CAPABILITY_MISSING'::text; END IF;
  IF NOT g.p2p_open THEN b := b || 'P2P_HOSTS_DISABLED'::text; END IF;
  IF NOT g.insurer_open THEN b := b || 'INSURER_CONTRACT_INACTIVE'::text; END IF;
  RETURN b;
END
$fn$;

-- 3.5 État de l'hôte de la session (0075 ; ADR-115 : `tax_required` = pays OU PSP du versement ;
-- `tax_saved` = numéro d'un type admis enregistré, quel que soit le paramètre).
CREATE OR REPLACE FUNCTION core.kyc_host_state(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, country_code text, org_status text, verification_status text,
                 missing text[], kyc_approved boolean, age_status text, residence_status text,
                 tax_required boolean, tax_saved boolean, tax_kind text, tax_kinds text[],
                 terms_ok boolean, screening_done boolean, blockers text[])
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_ok    boolean;
  g       record;
  h       record;
  v_kind  text;
  v_kinds text[];
  v_req   jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::text, NULL::text[],
      NULL::boolean, NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::text,
      NULL::text[], NULL::boolean, NULL::boolean, NULL::text[];
    RETURN;
  END IF;
  v_ok := EXISTS (SELECT 1 FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org);
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::text, NULL::text, NULL::text[],
      NULL::boolean, NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::text,
      NULL::text[], NULL::boolean, NULL::boolean, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  SELECT d.status, d.missing INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  SELECT p.tax_id_kind INTO v_kind FROM core.kyc_host_tax_profile AS p WHERE p.org_id = p_org;
  SELECT k.host_tax_id_kinds INTO v_kinds FROM core.config_country AS k
   WHERE k.code::text = g.country_code;
  v_req := core.kyc_host_param('host_tax_id_required_for_activation', g.country_code);
  RETURN QUERY SELECT 'OK'::text, g.country_code, g.org_status,
    h.status, COALESCE(h.missing, '{}'::text[]),
    g.kyc_id IS NOT NULL,
    CASE WHEN g.age = 'PARAM_MISSING' THEN 'UNVERIFIED' ELSE g.age END, g.residence,
    v_req IS DISTINCT FROM 'false'::jsonb OR core.kyc_host_psp_requires_tax_id(p_org),
    core.kyc_host_tax_saved(p_org), v_kind,
    COALESCE(v_kinds, '{}'::text[]), g.terms_ok, g.screening_id IS NOT NULL,
    CASE WHEN g.org_status = 'ACTIVE' THEN '{}'::text[] ELSE core.kyc_host_blockers(p_org) END;
END
$fn$;

-- 3.6 Profil fiscal (0075 ; ADR-115 : premier numéro admis en revue ou après l'approbation).
CREATE OR REPLACE FUNCTION core.kyc_cmd_host_save_tax_profile(p_token_hash bytea, p_org uuid, p_kind text,
                                                   p_tax_id_enc bytea, p_regime text,
                                                   p_taxpayer_kind text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
  v_kinds   text[];
  v_status  text;
  v_prev    uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text;
    RETURN;
  END IF;
  -- personne physique seulement (BR-ACC-06, DEC-FONDATEUR-13)
  IF p_taxpayer_kind IS DISTINCT FROM 'INDIVIDUAL' THEN
    RETURN QUERY SELECT 'HOST_ENTITY_NOT_ALLOWED'::text;
    RETURN;
  END IF;
  SELECT k.host_tax_id_kinds INTO v_kinds FROM core.config_country AS k WHERE k.code::text = v_country;
  IF p_kind IS NULL OR v_kinds IS NULL OR NOT (p_kind = ANY (v_kinds)) THEN
    RETURN QUERY SELECT 'HOST_TAX_ID_KIND_INVALID'::text;
    RETURN;
  END IF;
  IF p_tax_id_enc IS NULL OR pg_catalog.octet_length(p_tax_id_enc) NOT BETWEEN 30 AND 128
     OR pg_catalog.get_byte(p_tax_id_enc, 0) <> 1
     OR (p_regime IS NOT NULL AND p_regime !~ '^[A-Z][A-Z0-9_]{1,31}$') THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_org::text, 0));
  SELECT d.status INTO v_status FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  SELECT p.id INTO v_prev FROM core.kyc_host_tax_profile AS p WHERE p.org_id = p_org;
  -- dossier refusé ou révoqué : verrouillé ; en revue ou approuvé : seul un PREMIER numéro est
  -- admis (numéro facultatif, ADR-115), un numéro enregistré ne se remplace plus (une
  -- correspondance en attente n'y change rien : même réponse qu'un dossier propre)
  IF v_status IN ('REJECTED', 'REVOKED')
     OR (v_status IN ('IN_REVIEW', 'APPROVED') AND v_prev IS NOT NULL) THEN
    RETURN QUERY SELECT 'HOST_VERIFICATION_LOCKED'::text;
    RETURN;
  END IF;
  IF v_prev IS NULL THEN
    INSERT INTO core.kyc_host_tax_profile (org_id, user_id, country_code, tax_id_kind, tax_id_enc,
                                           tax_id_key_subject_id, regime)
    VALUES (p_org, v_user, v_country, p_kind, p_tax_id_enc, p_org, p_regime);
  ELSE
    UPDATE core.kyc_host_tax_profile AS p
       SET tax_id_kind = p_kind, tax_id_enc = p_tax_id_enc, regime = p_regime,
           row_version = p.row_version + 1, updated_at = platform.now()
     WHERE p.id = v_prev;
  END IF;
  -- audit : type seulement, jamais le numéro
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'HOST_TAX_PROFILE_SAVED', 'ORGANIZATION', p_org, NULL,
          pg_catalog.jsonb_build_object('country', v_country,
                                        'countries', pg_catalog.jsonb_build_array(v_country),
                                        'kind', p_kind, 'replaced', v_prev IS NOT NULL));
  RETURN QUERY SELECT 'SAVED'::text;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

COMMENT ON FUNCTION core.kyc_host_tax_saved(uuid) IS
  'Numéro fiscal de l''hôte enregistré, type admis dans le pays du compte. US-123 (ADR-115).';
COMMENT ON FUNCTION core.kyc_host_psp_requires_tax_id(uuid) IS
  'Numéro fiscal exigé par le PSP du sous-marchand ACTIVE pour le versement (capacité '
  'SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID non validée = exigé). US-123 (ADR-115).';
REVOKE ALL ON FUNCTION core.kyc_host_tax_saved(uuid), core.kyc_host_psp_requires_tax_id(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_tax_saved(uuid), core.kyc_host_psp_requires_tax_id(uuid)
  TO kyc_cmd_owner;
