-- 9978 — fixtures des preuves du cumul hôte / voyageur et de l'auto-réservation (US-127, migration
-- 0079). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - mise en place de ce que d'autres stories écrivent par leurs commandes : identité vérifiée
--     (vérification APPROVED et date de naissance rendue par le fournisseur, US-105 / US-106),
--     téléphone (US-104), compte d'hôte ACTIVE d'un titulaire donné (US-107 / US-123) ;
--   - relectures des lignes que les rôles applicatifs ne lisent pas (évaluations, éléments de
--     file, constats de l'ops, holds d'un voyageur). Les attendus des tests viennent de 19 US-127,
--     16 ACC-014 / BKG-012 et 17 §2.3 / §2.5, jamais de ces relectures.
-- AUCUNE fixture n'écrit un constat de l'ops (risk_account_link) : les tests passent par la vraie
-- commande core.risk_staff_decide_account_link.
--
-- Retour arrière : DROP FUNCTION test_fixture.us127_* (voir la liste des droits en fin de fichier).

-- Identité vérifiée : noms légaux du compte, vérification APPROVED (courante s'il n'y en a pas) et
-- sujet de la tentative avec la date de naissance du fournisseur.
CREATE FUNCTION test_fixture.us127_verified_identity(p_user uuid, p_country text, p_first text,
                                                    p_last text, p_birth date)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  UPDATE core.iam_user_account AS u
     SET legal_first_name = p_first, legal_last_name = p_last
   WHERE u.id = p_user;
  INSERT INTO core.kyc_identity_verification (id, user_id, country_code, status, is_current, attempt,
                                              approved_at, expires_at)
  VALUES (v_id, p_user, p_country, 'APPROVED',
          NOT EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                       WHERE v.user_id = p_user AND v.is_current),
          1, platform.now(), platform.now() + interval '365 days');
  INSERT INTO core.kyc_identity_subject (verification_id, user_id, attempt, date_of_birth,
                                         residence_country)
  VALUES (v_id, p_user, 1, p_birth, p_country);
  RETURN v_id;
END
$fn$;

-- Téléphone du compte, vérifié ou non (US-104 écrit la version vérifiée par l'OTP).
CREATE FUNCTION test_fixture.us127_set_phone(p_user uuid, p_phone text, p_verified boolean)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account AS u
     SET phone_e164 = p_phone,
         phone_verified_at = CASE WHEN p_verified THEN platform.now() END
   WHERE u.id = p_user
$fn$;

-- Compte d'hôte ACTIVE d'un titulaire EXISTANT (sa ligne P2P_HOST comprise), dans un pays.
CREATE FUNCTION test_fixture.us127_create_org_for(p_org uuid, p_holder uuid, p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_organization (id, holder_user_id, country_code, status)
  VALUES (p_org, p_holder, p_country, 'ACTIVE');
  INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
  VALUES (pg_catalog.gen_random_uuid(), p_holder, p_org, 'P2P_HOST', 'ACTIVE');
$fn$;

CREATE FUNCTION test_fixture.us127_assessments(p_user uuid)
  RETURNS TABLE (id uuid, subject_type text, country_code text, org_id uuid, rules_fired jsonb,
                 score integer, decision text, dedupe_key text, explanation text,
                 decided_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.id, a.subject_type, a.country_code, a.org_id, a.rules_fired, a.score, a.decision,
         a.dedupe_key, a.explanation, a.decided_at
    FROM core.risk_assessment AS a
   WHERE a.subject_id = p_user
   ORDER BY a.created_at, a.id
$fn$;

CREATE FUNCTION test_fixture.us127_queue_items(p_subject uuid)
  RETURNS TABLE (queue text, subject_type text, country_code text, status text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.queue, i.subject_type, i.country_code, i.status
    FROM core.support_review_queue_item AS i
   WHERE i.subject_id = p_subject
   ORDER BY i.created_at
$fn$;

CREATE FUNCTION test_fixture.us127_link(p_a uuid, p_b uuid)
  RETURNS TABLE (id uuid, user_low uuid, user_high uuid, decision text, signal text,
                 decided_by uuid, row_version integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.user_low, l.user_high, l.decision, l.signal, l.decided_by, l.row_version
    FROM core.risk_account_link AS l
   WHERE l.user_low = LEAST(p_a, p_b) AND l.user_high = GREATEST(p_a, p_b)
$fn$;

-- Holds et occupations HOLD d'un voyageur sur un véhicule (tous statuts).
CREATE FUNCTION test_fixture.us127_holds(p_guest uuid, p_vehicle uuid)
  RETURNS TABLE (holds integer, occupancies integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (SELECT pg_catalog.count(*)::integer FROM core.booking_checkout_hold AS h
           WHERE h.guest_user_id = p_guest AND h.vehicle_id = p_vehicle),
         (SELECT pg_catalog.count(*)::integer FROM core.booking_vehicle_occupancy AS o
           WHERE o.vehicle_id = p_vehicle AND o.kind = 'HOLD' AND o.created_by = p_guest)
$fn$;

-- Noms légaux seuls (aucune vérification) : témoin « identité non vérifiée ».
CREATE FUNCTION test_fixture.us127_set_names(p_user uuid, p_first text, p_last text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account AS u
     SET legal_first_name = p_first, legal_last_name = p_last
   WHERE u.id = p_user
$fn$;

-- Un hold quelconque d'un voyageur sur un véhicule (le plus récent).
CREATE FUNCTION test_fixture.us127_any_hold(p_guest uuid, p_vehicle uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.id FROM core.booking_checkout_hold AS h
   WHERE h.guest_user_id = p_guest AND h.vehicle_id = p_vehicle
   ORDER BY h.created_at DESC
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us127_verified_identity(uuid, text, text, text, date),
  test_fixture.us127_set_phone(uuid, text, boolean),
  test_fixture.us127_create_org_for(uuid, uuid, text), test_fixture.us127_assessments(uuid),
  test_fixture.us127_queue_items(uuid), test_fixture.us127_link(uuid, uuid),
  test_fixture.us127_holds(uuid, uuid), test_fixture.us127_set_names(uuid, text, text),
  test_fixture.us127_any_hold(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us127_verified_identity(uuid, text, text, text, date),
  test_fixture.us127_set_phone(uuid, text, boolean),
  test_fixture.us127_create_org_for(uuid, uuid, text), test_fixture.us127_assessments(uuid),
  test_fixture.us127_queue_items(uuid), test_fixture.us127_link(uuid, uuid),
  test_fixture.us127_holds(uuid, uuid), test_fixture.us127_set_names(uuid, text, text),
  test_fixture.us127_any_hold(uuid, uuid) TO app_api;
