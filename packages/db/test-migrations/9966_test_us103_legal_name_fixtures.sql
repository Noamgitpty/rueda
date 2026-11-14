-- 9966 — fixtures des preuves du nom légal identique au permis (US-103, migration 0088). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - appel de la fonction pure de rapprochement `core.kyc_legal_name_match` (aucun rôle
--     applicatif ne l'exécute en production) sur des noms donnés par le test ;
--   - relectures des lignes que les rôles applicatifs ne lisent pas (nom lu sur le permis et
--     verdict, nom légal du compte, audit du changement de nom), clé du signal SAME_IDENTITY.
--     Une seule écriture : `us103_license_name` (nom lu sur le permis d'une vérification de
--     fixture). Les attendus des tests viennent de 19 US-103, 16 ACC-006 et de la règle écrite dans
--     ADR-117, jamais de ces relectures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us103_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us103_name_match(p_declared_first text, p_declared_last text,
                                              p_license_given text, p_license_surnames text)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.kyc_legal_name_match(p_declared_first, p_declared_last, p_license_given,
                                   p_license_surnames)
$fn$;

CREATE FUNCTION test_fixture.us103_name_key(p_given text, p_surnames text)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.kyc_legal_name_key(p_given, p_surnames)
$fn$;

CREATE FUNCTION test_fixture.us103_documents(p_user uuid)
  RETURNS TABLE (attempt integer, status text, holder_given_names text, holder_surnames text,
                 name_match text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.attempt, d.status, d.holder_given_names, d.holder_surnames, d.name_match
    FROM core.kyc_identity_document AS d
   WHERE d.user_id = p_user
   ORDER BY d.created_at, d.id
$fn$;

-- nom légal du compte en octets UTF-8 (comparaison caractère pour caractère, sans normalisation)
CREATE FUNCTION test_fixture.us103_account_name(p_user uuid)
  RETURNS TABLE (legal_first_name text, legal_last_name text, first_utf8 bytea, last_utf8 bytea)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.legal_first_name, u.legal_last_name,
         pg_catalog.convert_to(u.legal_first_name, 'UTF8'),
         pg_catalog.convert_to(u.legal_last_name, 'UTF8')
    FROM core.iam_user_account AS u WHERE u.id = p_user
$fn$;

CREATE FUNCTION test_fixture.us103_audit(p_user uuid)
  RETURNS TABLE (action_code text, actor_role text, before jsonb, after jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.action_code, a.actor_role, a.before, a.after FROM core.audit_audit_log AS a
   WHERE a.subject_id = p_user AND a.action_code = 'LEGAL_NAME_CHANGED'
   ORDER BY a.id
$fn$;

-- Nom lu sur le permis posé sur une vérification approuvée de fixture (9978,
-- us127_verified_identity, sans document) : éprouve la clé du signal SAME_IDENTITY (ADR-110,
-- ADR-117) sans rejouer tout le parcours du fournisseur.
CREATE FUNCTION test_fixture.us103_license_name(p_verification uuid, p_given text, p_surnames text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.kyc_identity_document (verification_id, user_id, attempt, doc_type,
                                          issuing_country, expiry_date, license_class,
                                          is_permanent, status, holder_given_names,
                                          holder_surnames, name_match)
  SELECT v.id, v.user_id, v.attempt, 'DRIVER_LICENSE', v.country_code, DATE '2035-01-31', 'B',
         true, 'ACCEPTED', p_given, p_surnames, 'MATCH'
    FROM core.kyc_identity_verification AS v WHERE v.id = p_verification
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us103_name_match(text, text, text, text),
  test_fixture.us103_name_key(text, text), test_fixture.us103_documents(uuid),
  test_fixture.us103_account_name(uuid), test_fixture.us103_audit(uuid),
  test_fixture.us103_license_name(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us103_name_match(text, text, text, text),
  test_fixture.us103_name_key(text, text), test_fixture.us103_documents(uuid),
  test_fixture.us103_account_name(uuid), test_fixture.us103_audit(uuid),
  test_fixture.us103_license_name(uuid, text, text) TO app_api;
