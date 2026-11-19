-- 0159 — PYO : compte de versement vérifié de l'hôte (`payout_account`).
-- US-707 ; ADR-180 ; 16 PYO-001 (fiche, critères) ; 17 §2.3 (`payout.manage_account`), §2.10,
-- §3.2.9 (`payout_account`), §7.2 (`payout_account_change_hold_h`) ; 08 BR-PAYOUT-01, BR-ACC-06 ;
-- 22 OQ-P2P-07, OQ-PAY-09. Rails du pays : graine générée 0160 (`payout_account_rails`).
-- Appliquée sous `migrator`.
--
-- Principes (ADR-180, PROPOSÉ « comme Turo », jamais plus lourd) :
--   - un compte bancaire ou un portefeuille AU NOM DE L'HÔTE, personne physique : le titulaire
--     déclaré (prénoms, noms) est rapproché du nom légal du compte vérifié par le KYC
--     (`core.kyc_legal_name_match`, règle tolérante d'ADR-117) ; discordant ⇒ refus, rien
--     n'est écrit. La cédula / le RUC du titulaire est comparé par l'API au numéro fiscal
--     CHIFFRÉ de l'hôte (la base ne le voit jamais en clair, ADR-105) : la base rend l'enveloppe
--     au seul titulaire (`payout_payout_account_context`) et exige un profil fiscal enregistré
--     (absent ⇒ HOST_TAX_ID_REQUIRED : au Paraguay, seul le RUC est admis, un hôte sans RUC n'a
--     donc jamais de compte de versement, OQ-PAY-09 fail-closed) ; le numéro n'est pas recopié
--     ici (minimisation : seul son type l'est) ;
--   - seul le TITULAIRE gère le compte (`payout.manage_account`, matrice semée ici pour P2P_HOST
--     et pour lui seul) : un co-hôte n'est pas titulaire, `core.iam_host_accounts` ne lui rend
--     pas le compte (même réponse qu'un compte inconnu, 17 §2.3 point 5) ; une permission absente
--     ou échue ⇒ PERMISSION_DENIED ;
--   - numéro de compte : enveloppe v1 de `@rueda/db/audit` par la clé du sujet `ORG:<compte>`
--     (C3, chiffré par l'API avant l'écriture ; AAD
--     `rueda.c2.v1|core.payout_payout_account.account_number_enc|ORG:<id>`), plus ses 4 derniers
--     caractères pour l'affichage masqué ; AUCUN numéro (ni compte ni cédula / RUC, ni les 4
--     derniers) dans l'audit, les événements ou les erreurs ;
--   - vérification par le PSP (port de PYO, FAKE seulement avant le lot C) : PENDING → VERIFIED
--     ou REJECTED (titulaire, pièce ou compte refusés) ; sans prestataire, le compte reste PENDING
--     et aucun versement ne part (capacité inconnue = « non ») ;
--   - changement de compte d'un hôte qui a déjà eu un compte VÉRIFIÉ : l'ancien passe REPLACED,
--     le nouveau porte `change_hold_until` = maintenant + `payout_account_change_hold_h[pays]`
--     (48 h ; absente ou mal formée ⇒ retenue sans fin, fail-closed) ;
--   - garde des versements (`core.payout_payout_account_hold`, pour les lots d'US-708) : aucun
--     compte ⇒ PAYOUT_ACCOUNT_MISSING ; compte non vérifié ⇒ PAYOUT_ACCOUNT_UNVERIFIED ;
--     versement prévu avant `change_hold_until` ⇒ PAYOUT_ACCOUNT_CHANGE_HOLD (lot ON_HOLD).
--     AUCUN interrupteur n'est lu ni écrit ici : `payouts_enabled[pays]` reste la garde du
--     versement (0054) ;
--   - aucun montant dans cette migration.
--
-- Écarts PROPOSÉS avec 17 §3.2.9 (ADR-180, à reporter) : `account_bidx` non créé (aucun usage
-- avant une story anti-fraude : minimisation) ; `holder_tax_id` remplacé par
-- `holder_tax_id_kind` (le numéro reste dans le profil fiscal chiffré) ; colonnes en plus :
-- `user_id`, `rail_kind`, `institution_code`, `account_last4`, `holder_name`, `reject_reason`,
-- `provider_ref`, `replaced_at`, `row_version`.
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   DROP FUNCTION core.payout_payout_account_hold(uuid, text, timestamptz),
--     core.payout_cmd_record_payout_account_verification(bytea, uuid, uuid, text, text, text),
--     core.payout_cmd_register_payout_account(bytea, uuid, text, text, bytea, text, text, text),
--     core.payout_payout_account_context(bytea, uuid, text, text),
--     core.payout_payout_account_state(bytea, uuid), core.payout_titular(bytea, uuid),
--     core.payout_param(text, text), core.kyc_host_payout_identity(uuid, text, text) ;
--   DROP TABLE core.payout_payout_account ; DROP FUNCTION core.payout_payout_account_guard() ;
--   ALTER POLICY cmd_money_sel ON core.config_param_value (liste de 0054) ;
--   SET LOCAL ROLE iam_auth_owner ; REVOKE EXECUTE ON FUNCTION core.iam_host_accounts(bytea)
--     FROM cmd_money_owner ; RESET ROLE ;
--   DELETE FROM core.iam_role_permission WHERE permission_code = 'payout.manage_account'.

-- 1. Matrice des permissions (17 §2.3 : `payout.manage_account`, P2P_HOST seulement) ----------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES ('P2P_HOST', 'payout.manage_account', 'ORG', '2026-11-19T00:00:00Z',
        'US-707 : matrice 17 §2.3 (compte de versement, titulaire seulement ; jamais un CO_HOST)');

-- 2. Table ---------------------------------------------------------------------------------------
CREATE TABLE core.payout_payout_account (
  id                       uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT payout_payout_account_pkey PRIMARY KEY,
  org_id                   uuid        NOT NULL,
  user_id                  uuid        NOT NULL,
  country_code             text        NOT NULL
    CONSTRAINT payout_payout_account_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- devise du pays (08 BR-PAYOUT-01, E5 : aucune conversion)
  currency                 text        NOT NULL
    CONSTRAINT payout_payout_account_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  rail_kind                text        NOT NULL
    CONSTRAINT payout_payout_account_rail_valid CHECK (rail_kind IN ('BANK_ACCOUNT', 'WALLET')),
  -- établissement (banque ou portefeuille) : code de la configuration du pays
  institution_code         text        NOT NULL
    CONSTRAINT payout_payout_account_institution_format
      CHECK (institution_code ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'),
  -- enveloppe v1 (0x01 || nonce || texte chiffré || étiquette) par la clé du sujet [C3]
  account_number_enc       bytea       NOT NULL
    CONSTRAINT payout_payout_account_envelope CHECK (
      pg_catalog.octet_length(account_number_enc) BETWEEN 30 AND 128
      AND pg_catalog.get_byte(account_number_enc, 0) = 1),
  account_key_subject_type text        NOT NULL DEFAULT 'ORG'
    CONSTRAINT payout_payout_account_key_type_valid CHECK (account_key_subject_type = 'ORG'),
  account_key_subject_id   uuid        NOT NULL,
  -- affichage masqué seulement (« •••• 1234 ») [C2]
  account_last4            text        NOT NULL
    CONSTRAINT payout_payout_account_last4_format CHECK (account_last4 ~ '^[0-9A-Z]{4}$'),
  -- titulaire = l'hôte (nom rapproché du nom légal vérifié) [C2]
  holder_name              text        NOT NULL
    CONSTRAINT payout_payout_account_holder_length CHECK (pg_catalog.length(holder_name) BETWEEN 3 AND 201),
  -- type de la pièce du titulaire (config_country.host_tax_id_kinds) ; le numéro n'est pas copié
  holder_tax_id_kind       text        NOT NULL
    CONSTRAINT payout_payout_account_tax_kind_format CHECK (holder_tax_id_kind ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  status                   text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT payout_payout_account_status_valid
      CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'REPLACED')),
  reject_reason            text
    CONSTRAINT payout_payout_account_reason_valid
      CHECK (reject_reason IN ('HOLDER_MISMATCH', 'TAX_ID_MISMATCH', 'ACCOUNT_INVALID')),
  provider_ref             text
    CONSTRAINT payout_payout_account_ref_format CHECK (provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  verified_at              timestamptz,
  change_hold_until        timestamptz,
  replaced_at              timestamptz,
  row_version              integer     NOT NULL DEFAULT 0
    CONSTRAINT payout_payout_account_row_version_valid CHECK (row_version >= 0),
  created_at               timestamptz NOT NULL DEFAULT platform.now(),
  updated_at               timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT payout_payout_account_org_fk FOREIGN KEY (org_id, user_id)
    REFERENCES core.iam_organization (id, holder_user_id),
  CONSTRAINT payout_payout_account_key_is_org CHECK (account_key_subject_id = org_id),
  CONSTRAINT payout_payout_account_verified_dated CHECK (status <> 'VERIFIED' OR verified_at IS NOT NULL),
  CONSTRAINT payout_payout_account_rejected_reason CHECK ((status = 'REJECTED') = (reject_reason IS NOT NULL)),
  CONSTRAINT payout_payout_account_replaced_dated CHECK ((status = 'REPLACED') = (replaced_at IS NOT NULL))
);

-- au plus un compte courant (PENDING ou VERIFIED) par compte d'hôte
CREATE UNIQUE INDEX payout_payout_account_one_current
  ON core.payout_payout_account (org_id) WHERE (status IN ('PENDING', 'VERIFIED'));
CREATE INDEX payout_payout_account_org_idx ON core.payout_payout_account (org_id, created_at DESC);

COMMENT ON TABLE core.payout_payout_account IS
  'PYO payout_account (17 §3.2.9) : compte de versement de l''hôte, à son nom ; numéro chiffré par '
  'la clé du sujet (C3), 4 derniers caractères pour l''affichage. Écrite par les commandes '
  'payout_cmd_* seulement. Classe B. US-707 (ADR-180).';

-- Garde (sans lecture : pas de SECURITY DEFINER) : identité et numéro figés ; transitions
-- PENDING → VERIFIED | REJECTED | REPLACED, VERIFIED → REPLACED ; REJECTED et REPLACED terminaux ;
-- aucune suppression.
CREATE FUNCTION core.payout_payout_account_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'payout_payout_account: no delete'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_payout_account_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.rail_kind IS DISTINCT FROM OLD.rail_kind
     OR NEW.institution_code IS DISTINCT FROM OLD.institution_code
     OR NEW.account_number_enc IS DISTINCT FROM OLD.account_number_enc
     OR NEW.account_key_subject_id IS DISTINCT FROM OLD.account_key_subject_id
     OR NEW.account_last4 IS DISTINCT FROM OLD.account_last4
     OR NEW.holder_name IS DISTINCT FROM OLD.holder_name
     OR NEW.holder_tax_id_kind IS DISTINCT FROM OLD.holder_tax_id_kind
     OR NEW.change_hold_until IS DISTINCT FROM OLD.change_hold_until
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
     OR (OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref) THEN
    RAISE EXCEPTION 'payout_payout_account: identity, account and hold are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_payout_account_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'PENDING' AND NEW.status IN ('VERIFIED', 'REJECTED', 'REPLACED'))
              OR (OLD.status = 'VERIFIED' AND NEW.status = 'REPLACED')) THEN
    RAISE EXCEPTION 'payout_payout_account: transition % -> % refused', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_payout_account_transition';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_payout_account_guard() FROM PUBLIC;

CREATE TRIGGER payout_payout_account_guard BEFORE UPDATE OR DELETE ON core.payout_payout_account
  FOR EACH ROW EXECUTE FUNCTION core.payout_payout_account_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.payout_payout_account
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER payout_payout_account_no_truncate BEFORE TRUNCATE ON core.payout_payout_account
  FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_account_guard();

-- 3. RLS : aucun rôle applicatif ne lit ni n'écrit la table ; commandes de cmd_money_owner -------
ALTER TABLE core.payout_payout_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payout_payout_account FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payout_payout_account TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payout_payout_account FROM PUBLIC;

GRANT SELECT, INSERT ON core.payout_payout_account TO cmd_money_owner;
GRANT UPDATE (status, reject_reason, provider_ref, verified_at, replaced_at, row_version, updated_at)
  ON core.payout_payout_account TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payout_payout_account FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payout_payout_account FOR INSERT TO cmd_money_owner
  WITH CHECK (status = 'PENDING' AND verified_at IS NULL AND provider_ref IS NULL);
CREATE POLICY cmd_money_upd ON core.payout_payout_account FOR UPDATE TO cmd_money_owner
  USING (status IN ('PENDING', 'VERIFIED'))
  WITH CHECK (status IN ('VERIFIED', 'REJECTED', 'REPLACED'));

-- 4. Droits de lecture de cmd_money_owner --------------------------------------------------------
-- identifiant v7 des comptes (défaut de la table, insertion par la commande)
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO cmd_money_owner;
-- paramètres du compte de versement (en plus des trois interrupteurs de 0054 ; même nom de
-- politique : remplacement admis, ADR-081)
ALTER POLICY cmd_money_sel ON core.config_param_value
  USING (key IN ('payouts_enabled', 'insurer_contract_active', 'funds_holding_enabled',
                 'payout_account_rails', 'payout_account_change_hold_h'));
-- comptes d'hôte TITULAIRES de la session (fonction d'iam_auth_owner : seul son propriétaire
-- accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_host_accounts(bytea) TO cmd_money_owner;
RESET ROLE;

-- 5. Identité de l'hôte pour le compte de versement (fonction de KYC, kyc_cmd_owner) -------------
-- Rend, pour un compte d'hôte : KYC courant approuvé, rapprochement du titulaire déclaré avec le
-- nom légal du compte (MATCH, MISMATCH, MISSING ; NULL sans nom déclaré), type et enveloppe du
-- numéro fiscal enregistré (type admis dans le pays). Aucune ligne pour un compte inconnu.
-- EXECUTE au seul cmd_money_owner : l'enveloppe ne sort qu'au titulaire, par la commande de PYO.
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

CREATE FUNCTION core.kyc_host_payout_identity(p_org uuid, p_holder_given text,
                                              p_holder_surnames text)
  RETURNS TABLE (kyc_approved boolean, name_match text, tax_id_kind text, tax_id_enc bytea)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org   record;
  v_first text;
  v_last  text;
  v_kyc   boolean;
  v_match text;
  v_kind  text;
  v_enc   bytea;
BEGIN
  SELECT o.id, o.holder_user_id, o.country_code INTO v_org
    FROM core.iam_organization AS o WHERE o.id = p_org AND o.kind = 'P2P_HOST_INDIVIDUAL';
  IF v_org.id IS NULL THEN
    RETURN;
  END IF;
  v_kyc := EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                    WHERE v.user_id = v_org.holder_user_id AND v.is_current
                      AND v.status = 'APPROVED');
  IF p_holder_given IS NOT NULL OR p_holder_surnames IS NOT NULL THEN
    SELECT u.legal_first_name, u.legal_last_name INTO v_first, v_last
      FROM core.iam_user_account AS u WHERE u.id = v_org.holder_user_id;
    v_match := core.kyc_legal_name_match(v_first, v_last, p_holder_given, p_holder_surnames);
  END IF;
  SELECT p.tax_id_kind, p.tax_id_enc INTO v_kind, v_enc
    FROM core.kyc_host_tax_profile AS p
    JOIN core.config_country AS k ON k.code::text = p.country_code
   WHERE p.org_id = v_org.id AND p.country_code = v_org.country_code
     AND p.tax_id_kind = ANY (k.host_tax_id_kinds);
  RETURN QUERY SELECT v_kyc, v_match, v_kind, v_enc;
END
$fn$;

COMMENT ON FUNCTION core.kyc_host_payout_identity(uuid, text, text) IS
  'Identité de l''hôte pour son compte de versement : KYC approuvé, rapprochement du titulaire '
  'déclaré avec le nom légal (ADR-117), type et enveloppe du numéro fiscal. EXECUTE '
  'cmd_money_owner. US-707 (ADR-180).';
REVOKE ALL ON FUNCTION core.kyc_host_payout_identity(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_payout_identity(uuid, text, text) TO cmd_money_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 6. Fonctions de PYO (créées par migrator, propriétaire cmd_money_owner, mécanique de 0039) -----

-- 6.1 Valeur en vigueur d'un paramètre de pays (portée COUNTRY), à l'horloge de la base.
CREATE FUNCTION core.payout_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- 6.2 Titulaire de la session pour un compte d'hôte : AUTH_REQUIRED (session), FORBIDDEN (compte
-- inconnu, d'un autre hôte, ou dont la personne n'est pas titulaire : co-hôte), PERMISSION_DENIED
-- (matrice sans `payout.manage_account` en vigueur pour P2P_HOST), OK.
CREATE FUNCTION core.payout_titular(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, user_id uuid, country_code text, currency text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user     uuid;
  v_country  text;
  v_currency text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_role_permission AS p
                  WHERE p.role = 'P2P_HOST' AND p.permission_code = 'payout.manage_account'
                    AND p.valid_from <= platform.now()
                    AND (p.valid_to IS NULL OR p.valid_to > platform.now())) THEN
    RETURN QUERY SELECT 'PERMISSION_DENIED'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT k.currency::text INTO v_currency FROM core.config_country AS k
   WHERE k.code::text = v_country;
  RETURN QUERY SELECT 'OK'::text, v_user, v_country, v_currency;
END
$fn$;

-- 6.3 État du compte de versement pour l'écran du titulaire : rails du pays (forme validée par
-- CFG ; absents ⇒ NULL), type du numéro fiscal enregistré, compte courant ou, à défaut, le
-- dernier refusé (masqué : établissement, 4 derniers caractères, statut, retenue, motif).
CREATE FUNCTION core.payout_payout_account_state(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, country_code text, currency text, rails jsonb, tax_kind text,
                 account_id uuid, status text, rail_kind text, institution_code text,
                 account_last4 text, change_hold_until timestamptz, reject_reason text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t     record;
  v_id  record;
  v_acc record;
  v_r   jsonb;
BEGIN
  SELECT * INTO t FROM core.payout_titular(p_token_hash, p_org);
  IF t.outcome <> 'OK' THEN
    RETURN QUERY SELECT t.outcome, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::uuid,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  v_r := core.payout_param('payout_account_rails', t.country_code);
  IF v_r IS NULL OR pg_catalog.jsonb_typeof(v_r) <> 'object' THEN
    v_r := NULL;
  END IF;
  SELECT * INTO v_id FROM core.kyc_host_payout_identity(p_org, NULL, NULL);
  SELECT a.id, a.status, a.rail_kind, a.institution_code, a.account_last4, a.change_hold_until,
         a.reject_reason
    INTO v_acc
    FROM core.payout_payout_account AS a
   WHERE a.org_id = p_org AND a.status IN ('PENDING', 'VERIFIED', 'REJECTED')
   ORDER BY (a.status <> 'REJECTED') DESC, a.created_at DESC, a.id DESC
   LIMIT 1;
  RETURN QUERY SELECT 'OK'::text, t.country_code, t.currency, v_r, v_id.tax_id_kind, v_acc.id,
                      v_acc.status, v_acc.rail_kind, v_acc.institution_code, v_acc.account_last4,
                      v_acc.change_hold_until, v_acc.reject_reason;
END
$fn$;

-- 6.4 Contexte de l'enregistrement, avant le chiffrement : titulaire, KYC approuvé, rails du
-- pays, nom du titulaire déclaré, profil fiscal ; rend l'enveloppe du numéro fiscal au seul
-- titulaire (comparaison par l'API, sous la clé du sujet). Lecture seule.
CREATE FUNCTION core.payout_payout_account_context(p_token_hash bytea, p_org uuid,
                                                p_holder_given text, p_holder_surnames text)
  RETURNS TABLE (outcome text, country_code text, currency text, rails jsonb, tax_kind text,
                 tax_id_enc bytea)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t    record;
  v_id record;
  v_r  jsonb;
  v_o  text := 'OK';
BEGIN
  SELECT * INTO t FROM core.payout_titular(p_token_hash, p_org);
  IF t.outcome <> 'OK' THEN
    RETURN QUERY SELECT t.outcome, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::bytea;
    RETURN;
  END IF;
  v_r := core.payout_param('payout_account_rails', t.country_code);
  SELECT * INTO v_id FROM core.kyc_host_payout_identity(p_org, p_holder_given, p_holder_surnames);
  IF v_r IS NULL OR pg_catalog.jsonb_typeof(v_r) <> 'object' THEN
    v_o := 'HOST_PAYOUT_RAIL_UNAVAILABLE';
  ELSIF v_id.kyc_approved IS DISTINCT FROM true THEN
    v_o := 'HOST_KYC_REQUIRED';
  ELSIF v_id.tax_id_kind IS NULL OR v_id.tax_id_enc IS NULL THEN
    v_o := 'HOST_TAX_ID_REQUIRED';
  ELSIF v_id.name_match IS DISTINCT FROM 'MATCH' THEN
    v_o := 'PAYOUT_HOLDER_MISMATCH';
  END IF;
  IF v_o <> 'OK' THEN
    RETURN QUERY SELECT v_o, t.country_code, t.currency, NULL::jsonb, v_id.tax_id_kind, NULL::bytea;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, t.country_code, t.currency, v_r, v_id.tax_id_kind, v_id.tax_id_enc;
END
$fn$;

-- 6.5 Enregistrement (ou changement) du compte de versement par le titulaire. Revérifie tout ce
-- que juge le contexte (sauf la comparaison du numéro fiscal, faite par l'API sous la clé du
-- sujet), puis le rail et l'établissement contre la configuration du pays, la forme de
-- l'enveloppe et des 4 derniers caractères. Changement d'un hôte qui a déjà eu un compte
-- vérifié : retenue des versements jusqu'à maintenant + payout_account_change_hold_h[pays]
-- (absente ou mal formée ⇒ sans fin). Audit sans aucun numéro.
CREATE FUNCTION core.payout_cmd_register_payout_account(p_token_hash bytea, p_org uuid,
                                                     p_rail_kind text, p_institution text,
                                                     p_account_enc bytea, p_account_last4 text,
                                                     p_holder_given text, p_holder_surnames text)
  RETURNS TABLE (outcome text, account_id uuid, change_hold_until timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c        record;
  v_user   uuid;
  v_rail   jsonb;
  v_prev   uuid;
  v_change boolean;
  v_hold_v jsonb;
  v_hold   timestamptz;
  v_id     uuid := platform.uuid_v7();
  v_given  text := pg_catalog.btrim(p_holder_given);
  v_sur    text := pg_catalog.btrim(p_holder_surnames);
BEGIN
  IF v_given IS NULL OR v_sur IS NULL
     OR pg_catalog.length(v_given) NOT BETWEEN 1 AND 100
     OR pg_catalog.length(v_sur) NOT BETWEEN 1 AND 100
     OR p_rail_kind IS NULL OR p_institution IS NULL
     OR p_institution !~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
     OR p_account_last4 IS NULL OR p_account_last4 !~ '^[0-9A-Z]{4}$'
     OR p_account_enc IS NULL OR pg_catalog.octet_length(p_account_enc) NOT BETWEEN 30 AND 128
     OR pg_catalog.get_byte(p_account_enc, 0) <> 1 THEN
    -- forme refusée avant toute lecture (la session est jugée ensuite par le contexte)
    IF (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s) IS NULL THEN
      RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::timestamptz;
    ELSE
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO c FROM core.payout_payout_account_context(p_token_hash, p_org, v_given, v_sur);
  IF c.outcome <> 'OK' THEN
    RETURN QUERY SELECT c.outcome, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- rail et établissement : données de configuration du pays (0160), jamais une constante
  v_rail := c.rails -> p_rail_kind;
  IF v_rail IS NULL OR pg_catalog.jsonb_typeof(v_rail) <> 'object' THEN
    RETURN QUERY SELECT 'PAYOUT_RAIL_UNSUPPORTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF pg_catalog.jsonb_typeof(v_rail -> 'institutions') = 'array' THEN
    IF NOT ((v_rail -> 'institutions') ? p_institution) THEN
      RETURN QUERY SELECT 'PAYOUT_RAIL_UNSUPPORTED'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
  ELSIF pg_catalog.jsonb_typeof(v_rail -> 'institutionPattern') = 'string' THEN
    IF p_institution !~ (v_rail ->> 'institutionPattern') THEN
      RETURN QUERY SELECT 'PAYOUT_ACCOUNT_INVALID'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT 'HOST_PAYOUT_RAIL_UNAVAILABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pyo.payout_account:' || p_org::text, 0));
  SELECT a.id INTO v_prev FROM core.payout_payout_account AS a
   WHERE a.org_id = p_org AND a.status IN ('PENDING', 'VERIFIED');
  -- un changement : l'hôte a déjà eu un compte vérifié (le premier compte n'est pas retenu)
  v_change := EXISTS (SELECT 1 FROM core.payout_payout_account AS a
                       WHERE a.org_id = p_org AND a.verified_at IS NOT NULL);
  IF v_change THEN
    v_hold_v := core.payout_param('payout_account_change_hold_h', c.country_code);
    IF v_hold_v IS NOT NULL AND pg_catalog.jsonb_typeof(v_hold_v) = 'number'
       AND (v_hold_v #>> '{}') ~ '^[0-9]{1,4}$' THEN
      v_hold := platform.now()
                + pg_catalog.make_interval(hours => (v_hold_v #>> '{}')::integer);
    ELSE
      v_hold := 'infinity'::timestamptz;   -- fail-closed : paramètre absent ou mal formé
    END IF;
  END IF;
  IF v_prev IS NOT NULL THEN
    UPDATE core.payout_payout_account AS a
       SET status = 'REPLACED', replaced_at = platform.now(), row_version = a.row_version + 1
     WHERE a.id = v_prev;
  END IF;
  INSERT INTO core.payout_payout_account (id, org_id, user_id, country_code, currency, rail_kind,
                                       institution_code, account_number_enc,
                                       account_key_subject_id, account_last4, holder_name,
                                       holder_tax_id_kind, change_hold_until)
  VALUES (v_id, p_org, v_user, c.country_code, c.currency, p_rail_kind, p_institution,
          p_account_enc, p_org, p_account_last4, v_given || ' ' || v_sur, c.tax_kind, v_hold);
  -- audit : rail, établissement et retenue seulement ; jamais un numéro ni les 4 derniers
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'P2P_HOST', 'PAYOUT_ACCOUNT_REGISTERED', 'ORGANIZATION', p_org,
          CASE WHEN v_prev IS NULL THEN NULL
               ELSE pg_catalog.jsonb_build_object('accountId', v_prev) END,
          pg_catalog.jsonb_build_object('country', c.country_code,
                                        'countries', pg_catalog.jsonb_build_array(c.country_code),
                                        'accountId', v_id, 'rail', p_rail_kind,
                                        'institution', p_institution, 'replaced', v_prev IS NOT NULL,
                                        'holdUntil', v_hold));
  RETURN QUERY SELECT 'REGISTERED'::text, v_id, v_hold;
END
$fn$;

-- 6.6 Résultat de la vérification du compte par le PSP (FAKE avant le lot C), dans la requête du
-- titulaire : PENDING → VERIFIED (référence du PSP) ou REJECTED (motif fermé). Rejeu de la même
-- issue ⇒ DUPLICATE ; compte déjà décidé ou remplacé ⇒ CONFLICT. Audit sans aucun numéro.
CREATE FUNCTION core.payout_cmd_record_payout_account_verification(p_token_hash bytea, p_org uuid,
                                                                p_account uuid, p_status text,
                                                                p_reason text, p_provider_ref text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t   record;
  v_a record;
BEGIN
  SELECT * INTO t FROM core.payout_titular(p_token_hash, p_org);
  IF t.outcome <> 'OK' THEN
    RETURN QUERY SELECT t.outcome;
    RETURN;
  END IF;
  IF p_account IS NULL
     OR NOT ((p_status = 'VERIFIED' AND p_reason IS NULL
              AND p_provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$')
             OR (p_status = 'REJECTED'
                 AND p_reason IN ('HOLDER_MISMATCH', 'TAX_ID_MISMATCH', 'ACCOUNT_INVALID')
                 AND (p_provider_ref IS NULL OR p_provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'))) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pyo.payout_account:' || p_org::text, 0));
  SELECT a.id, a.status, a.reject_reason, a.provider_ref INTO v_a
    FROM core.payout_payout_account AS a WHERE a.id = p_account AND a.org_id = p_org;
  IF v_a.id IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text;
    RETURN;
  END IF;
  IF v_a.status = p_status AND v_a.reject_reason IS NOT DISTINCT FROM p_reason
     AND (p_status = 'REJECTED' OR v_a.provider_ref = p_provider_ref) THEN
    RETURN QUERY SELECT 'DUPLICATE'::text;
    RETURN;
  END IF;
  IF v_a.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'CONFLICT'::text;
    RETURN;
  END IF;
  UPDATE core.payout_payout_account AS a
     SET status = p_status, reject_reason = p_reason, provider_ref = p_provider_ref,
         verified_at = CASE WHEN p_status = 'VERIFIED' THEN platform.now() END,
         row_version = a.row_version + 1
   WHERE a.id = p_account;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (t.user_id, 'P2P_HOST', 'PAYOUT_ACCOUNT_VERIFICATION_RECORDED', 'ORGANIZATION', p_org,
          pg_catalog.jsonb_build_object('status', 'PENDING'),
          pg_catalog.jsonb_build_object('country', t.country_code,
                                        'countries', pg_catalog.jsonb_build_array(t.country_code),
                                        'accountId', p_account, 'status', p_status,
                                        'reason', p_reason));
  RETURN QUERY SELECT 'APPLIED'::text;
END
$fn$;

-- 6.7 Garde du versement par le compte (lots d'US-708) : motifs de retenue d'un versement prévu à
-- `p_scheduled_for` pour le compte d'hôte et la devise ; tableau vide ⇒ aucun motif tenant au
-- compte (les autres gardes, dont payouts_enabled[pays], restent celles de 0054).
CREATE FUNCTION core.payout_payout_account_hold(p_org uuid, p_currency text,
                                             p_scheduled_for timestamptz)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a record;
BEGIN
  SELECT a.status, a.currency, a.change_hold_until INTO v_a
    FROM core.payout_payout_account AS a
   WHERE a.org_id = p_org AND a.status IN ('PENDING', 'VERIFIED');
  IF NOT FOUND OR v_a.currency IS DISTINCT FROM p_currency THEN
    RETURN ARRAY['PAYOUT_ACCOUNT_MISSING'];
  END IF;
  IF v_a.status <> 'VERIFIED' THEN
    RETURN ARRAY['PAYOUT_ACCOUNT_UNVERIFIED']
           || CASE WHEN v_a.change_hold_until IS NOT NULL
                        AND (p_scheduled_for IS NULL OR p_scheduled_for < v_a.change_hold_until)
                   THEN ARRAY['PAYOUT_ACCOUNT_CHANGE_HOLD'] ELSE ARRAY[]::text[] END;
  END IF;
  IF v_a.change_hold_until IS NOT NULL
     AND (p_scheduled_for IS NULL OR p_scheduled_for < v_a.change_hold_until) THEN
    RETURN ARRAY['PAYOUT_ACCOUNT_CHANGE_HOLD'];
  END IF;
  RETURN ARRAY[]::text[];
END
$fn$;

-- 7. Commentaires et droits (posés par migrator, encore propriétaire), puis propriétaire --------------------------------------------------------
COMMENT ON FUNCTION core.payout_param(text, text) IS
  'Valeur en vigueur d''un paramètre de pays (portée COUNTRY). US-707.';
COMMENT ON FUNCTION core.payout_titular(bytea, uuid) IS
  'Titulaire de la session pour un compte d''hôte et permission payout.manage_account. US-707.';
COMMENT ON FUNCTION core.payout_payout_account_state(bytea, uuid) IS
  'État masqué du compte de versement pour son titulaire (rails du pays, type du numéro fiscal, '
  'compte courant). SECURITY DEFINER, EXECUTE app_api. US-707 (ADR-180).';
COMMENT ON FUNCTION core.payout_payout_account_context(bytea, uuid, text, text) IS
  'Contexte de l''enregistrement du compte de versement (titulaire, KYC, rails, nom, enveloppe du '
  'numéro fiscal). SECURITY DEFINER, EXECUTE app_api. US-707 (ADR-180).';
COMMENT ON FUNCTION core.payout_cmd_register_payout_account(bytea, uuid, text, text, bytea, text, text, text) IS
  'Enregistrement ou changement du compte de versement par le titulaire (retenue de 48 h après un '
  'changement). SECURITY DEFINER, EXECUTE app_api. US-707 (ADR-180).';
COMMENT ON FUNCTION core.payout_cmd_record_payout_account_verification(bytea, uuid, uuid, text, text, text) IS
  'Issue de la vérification du compte de versement par le PSP (FAKE avant le lot C). SECURITY '
  'DEFINER, EXECUTE app_api. US-707 (ADR-180).';
COMMENT ON FUNCTION core.payout_payout_account_hold(uuid, text, timestamptz) IS
  'Motifs de retenue d''un versement tenant au compte (absent, non vérifié, changement < 48 h). '
  'SECURITY DEFINER, EXECUTE app_worker. US-707 (ADR-180).';

REVOKE ALL ON FUNCTION core.payout_param(text, text), core.payout_titular(bytea, uuid),
  core.payout_payout_account_state(bytea, uuid),
  core.payout_payout_account_context(bytea, uuid, text, text),
  core.payout_cmd_register_payout_account(bytea, uuid, text, text, bytea, text, text, text),
  core.payout_cmd_record_payout_account_verification(bytea, uuid, uuid, text, text, text),
  core.payout_payout_account_hold(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payout_payout_account_state(bytea, uuid),
  core.payout_payout_account_context(bytea, uuid, text, text),
  core.payout_cmd_register_payout_account(bytea, uuid, text, text, bytea, text, text, text),
  core.payout_cmd_record_payout_account_verification(bytea, uuid, uuid, text, text, text)
  TO app_api;
GRANT EXECUTE ON FUNCTION core.payout_payout_account_hold(uuid, text, timestamptz) TO app_worker;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.payout_param(text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_titular(bytea, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_payout_account_state(bytea, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_payout_account_context(bytea, uuid, text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_register_payout_account(bytea, uuid, text, text, bytea, text, text, text)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_record_payout_account_verification(bytea, uuid, uuid, text, text, text)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_payout_account_hold(uuid, text, timestamptz) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
