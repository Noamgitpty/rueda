-- 9909 — fixtures des preuves des déclarations de dommage et des décisions (US-309, migration 0175).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser les états
-- que d'autres chemins écrivent (fin effective du trip, séries de photos SUBMITTED d'US-303 /
-- US-315, contrat signé d'US-211 avec la franchise du voyageur, opération de carte du loyer prouvée
-- d'US-223, déclaration et décision pour les preuves du gel du versement), relire les registres
-- (aucun rôle applicatif ne les lit) et tenter une écriture interdite. Les attendus des tests
-- viennent de 19 US-309, 16 CLM-001 / CLM-006 / ADM-008 / LEG-024 et 08 (BR-DAMAGE-01, 06,
-- BR-PAY-09 bis, BR-TT-05, BR-FUEL-03, E7 règle 7), jamais de ces fixtures. AUCUNE fixture n'écrit
-- un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us309_* (voir la liste des droits en fin de fichier).

-- Trip terminé : transition RETURNED à l'heure de la base (horloge virtuelle du test), COMPLETED
CREATE FUNCTION test_fixture.us309_returned(p_trip uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.booking_trip_state_log (id, trip_id, from_status, to_status, kind, reason_code,
                                           actor_role)
  VALUES (pg_catalog.gen_random_uuid(), p_trip, 'IN_PROGRESS', 'RETURNED', 'TRANSITION',
          'CHECKOUT_VALIDATED', 'SYSTEM');
  UPDATE core.booking_trip SET status = 'COMPLETED' WHERE id = p_trip;
END
$fn$;

-- État du trip (trip en cours, annulé…)
CREATE FUNCTION test_fixture.us309_set_status(p_trip uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip SET status = p_status WHERE id = p_trip
$fn$;

-- Série de photos SUBMITTED d'un côté (CHECKIN : départ, CHECKOUT : retour), par le titulaire
CREATE FUNCTION test_fixture.us309_inspection(p_trip uuid, p_kind text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.trip_ops_inspection (trip_id, country_code, kind, performer_role, performed_by,
                                        template_version, status, submitted_at)
  SELECT t.id, t.country_code, p_kind, 'HOST', o.holder_user_id, 1, 'SUBMITTED', platform.now()
    FROM core.booking_trip AS t JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip
$fn$;

-- Contrat du segment 1 portant la franchise du voyageur (texte d'un entier), signé ou non par lui
CREATE FUNCTION test_fixture.us309_contract(p_trip uuid, p_deductible text, p_signed boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_seg  uuid;
  v_prev record;
  v_id   uuid := platform.uuid_v7();
  v_es   uuid;
  v_en   uuid;
  t      record;
BEGIN
  SELECT x.id, x.country_code, x.guest_user_id, x.scheduled_start, x.scheduled_end INTO t
    FROM core.booking_trip AS x WHERE x.id = p_trip;
  SELECT s.id INTO v_seg FROM core.booking_trip_segment AS s WHERE s.trip_id = p_trip AND s.seq = 1;
  IF v_seg IS NULL THEN
    v_seg := pg_catalog.gen_random_uuid();
    INSERT INTO core.booking_trip_segment (id, trip_id, seq, period)
    VALUES (v_seg, p_trip, 1, pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)'));
  END IF;
  SELECT d.id, d.version INTO v_prev FROM core.contract_generated_document AS d
   WHERE d.subject_id = v_seg
     AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n WHERE n.supersedes_id = d.id);
  SELECT x.id INTO v_es FROM core.contract_document_template AS x
   WHERE x.kind = 'RENTAL_CONTRACT' AND x.country_code IS NULL AND x.locale = 'es'
   ORDER BY x.version DESC LIMIT 1;
  SELECT x.id INTO v_en FROM core.contract_document_template AS x
   WHERE x.kind = 'RENTAL_CONTRACT' AND x.country_code IS NULL AND x.locale = 'en'
   ORDER BY x.version DESC LIMIT 1;
  INSERT INTO core.contract_generated_document
         (id, kind, template_id, courtesy_template_id, subject_type, subject_id, trip_id,
          country_code, locale, version, supersedes_id, trigger_key, terms, derived,
          renderer_version, sha256)
  VALUES (v_id, 'RENTAL_CONTRACT', v_es, v_en, 'TRIP_SEGMENT', v_seg, p_trip, t.country_code, 'en',
          COALESCE(v_prev.version, 0) + 1, v_prev.id,
          'us309:' || (COALESCE(v_prev.version, 0) + 1)::text,
          pg_catalog.jsonb_build_object('schema', 'ctr.rental/1', 'protection',
            pg_catalog.jsonb_build_object('level', 'ESTANDAR', 'deductibleMinor', p_deductible)),
          '{"brand":"Marca"}', 'ctr.pdf/1',
          pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')));
  INSERT INTO core.contract_document_party (document_id, identity, body)
  VALUES (v_id, '{}'::jsonb, '[{"s":"p","t":"fixture"}]');
  IF p_signed THEN
    INSERT INTO core.contract_signature (document_id, trip_id, signer_user_id, signer_role, method,
                                         document_sha256, seal_sha256, c2_withheld)
    VALUES (v_id, p_trip, t.guest_user_id, 'GUEST', 'CLICKWRAP',
            pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')),
            pg_catalog.sha256(pg_catalog.convert_to('seal:' || v_id::text, 'UTF8')), true);
  END IF;
  RETURN v_id;
END
$fn$;

-- Opération de carte du loyer prouvée (CAPTURE SUCCEEDED, preuve signée, quatre jambes de 9001)
-- sur le compte FAKE de fixture du pays (jamais ACTIVE : aucune collision avec les autres preuves)
CREATE FUNCTION test_fixture.us309_card_rent(p_trip uuid, p_amount bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
  t    record;
BEGIN
  SELECT x.id, x.org_id, x.country_code, x.currency INTO t FROM core.booking_trip AS x
   WHERE x.id = p_trip;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, method, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent, proof_type)
  VALUES (v_id, t.id, test_fixture.fixture_psp_account(t.country_code), t.country_code, 'FAKE',
          'CAPTURE', 'RENT', 'CARD', p_amount, t.currency, 1, 'SUCCEEDED',
          pg_catalog.format('trip:%s:op:%s', t.id, v_id), pg_catalog.format('test:%s', v_id),
          'WEBHOOK_SIGNED');
  PERFORM test_fixture.fixture_operation_legs(v_id, 'CAPTURE', t.org_id, t.id, t.country_code,
                                              p_amount);
  RETURN v_id;
END
$fn$;

-- Titulaire du compte d'hôte d'un trip
CREATE FUNCTION test_fixture.us309_holder(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.holder_user_id FROM core.booking_trip AS t
    JOIN core.iam_organization AS o ON o.id = t.org_id WHERE t.id = p_trip
$fn$;

-- Déclaration et décision posées directement (preuves du gel du versement sous app_worker ; la
-- console les écrit autrement : l0-us309-claims)
CREATE FUNCTION test_fixture.us309_insert_claim(p_trip uuid, p_case uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.claim_damage_claim
         (id, trip_id, country_code, currency, case_id, declared_by, kind, declarant_user_id,
          recorded_by, recorded_role, request_id, description, trip_end_at, deadline_at)
  SELECT v_id, t.id, t.country_code, t.currency, p_case, 'HOST', 'DAMAGE', o.holder_user_id,
         o.holder_user_id, 'OPS_AGENT', pg_catalog.gen_random_uuid(), 'Déclaration de fixture',
         platform.now(), platform.now() + interval '24 hours'
    FROM core.booking_trip AS t JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us309_insert_decision(p_claim uuid, p_execution text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.claim_decision
         (id, claim_id, trip_id, country_code, currency, outcome, covered, repair_cost_minor,
          charge_amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, host_deductible_minor, lines, excluded, evidence, facts, decided_by,
          decided_role, request_id, execution_status, executed_at)
  SELECT v_id, c.id, c.trip_id, c.country_code, c.currency, 'NO_GUEST_CHARGE', false, 0, 0, 0, 0,
         0, 0, 0, '[]', '[]', '{}', 'Décision de fixture sans débit ni franchise', c.recorded_by,
         'OPS_AGENT', pg_catalog.gen_random_uuid(), p_execution,
         CASE WHEN p_execution = 'DONE' THEN platform.now() END
    FROM core.claim_damage_claim AS c WHERE c.id = p_claim;
  UPDATE core.claim_damage_claim SET status = 'DECIDED', decided_at = platform.now()
   WHERE id = p_claim;
  RETURN v_id;
END
$fn$;

-- Lectures des registres (aucun rôle applicatif ne les lit)
CREATE FUNCTION test_fixture.us309_claims(p_trip uuid)
  RETURNS TABLE (id uuid, declared_by text, kind text, declarant_user_id uuid, recorded_by uuid,
                 status text, reported_at timestamptz, deadline_at timestamptz,
                 trip_end_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.declared_by, c.kind, c.declarant_user_id, c.recorded_by, c.status, c.reported_at,
         c.deadline_at, c.trip_end_at
    FROM core.claim_damage_claim AS c WHERE c.trip_id = p_trip
   ORDER BY c.reported_at, c.declared_by, c.kind
$fn$;

CREATE FUNCTION test_fixture.us309_decision(p_decision uuid)
  RETURNS TABLE (execution_status text, execution_code text, charge_id uuid,
                 charge_amount_minor bigint, host_deductible_minor bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.execution_status, d.execution_code, d.charge_id, d.charge_amount_minor,
         d.host_deductible_minor
    FROM core.claim_decision AS d WHERE d.id = p_decision
$fn$;

-- Débits post-trip nés d'une décision (origine CLAIM_DECISION) et opérations de caution du trip
CREATE FUNCTION test_fixture.us309_charges(p_decision uuid)
  RETURNS TABLE (id uuid, purpose text, reason text, amount_minor bigint, leg_host_minor bigint,
                 leg_insurer_minor bigint, leg_tax_third_party_minor bigint,
                 leg_platform_minor bigint, guest_agreed boolean, status text,
                 tender_operation_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.purpose, c.reason, c.amount_minor, c.leg_host_minor, c.leg_insurer_minor,
         c.leg_tax_third_party_minor, c.leg_platform_minor, c.guest_agreed_at IS NOT NULL, c.status,
         c.tender_operation_id
    FROM core.payment_post_trip_charge AS c
   WHERE c.origin_type = 'CLAIM_DECISION' AND c.origin_id = p_decision
$fn$;

CREATE FUNCTION test_fixture.us309_deposit_operations(p_trip uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.count(*)::integer FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip AND o.kind LIKE 'DEPOSIT%'
$fn$;

CREATE FUNCTION test_fixture.us309_ledger(p_decision uuid)
  RETURNS TABLE (reason text, amount_minor bigint, org_id uuid, currency text, trip_id uuid,
                 settlement_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.reason, e.amount_minor, e.org_id, e.currency, e.trip_id, e.settlement_id
    FROM core.settlement_host_ledger_entry AS e WHERE e.claim_decision_id = p_decision
$fn$;

CREATE FUNCTION test_fixture.us309_declaration(p_decision uuid)
  RETURNS TABLE (id uuid, status text, provider_ref text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.provider_ref FROM core.claim_insurer_declaration AS i
   WHERE i.decision_id = p_decision
$fn$;

-- Écritures interdites (registres immuables) ; l'erreur de la garde remonte à l'appelant
CREATE FUNCTION test_fixture.us309_try_write(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'CLAIM_DEADLINE' THEN
    UPDATE core.claim_damage_claim SET deadline_at = deadline_at + interval '1 day' WHERE id = p_id;
  ELSIF p_what = 'CLAIM_DELETE' THEN
    DELETE FROM core.claim_damage_claim WHERE id = p_id;
  ELSIF p_what = 'DECISION_AMOUNT' THEN
    UPDATE core.claim_decision SET charge_amount_minor = charge_amount_minor + 1,
                                   leg_platform_minor = leg_platform_minor + 1
     WHERE id = p_id;
  ELSIF p_what = 'DECISION_REOPEN' THEN
    UPDATE core.claim_decision SET execution_status = 'PENDING', executed_at = NULL
     WHERE id = p_id;
  END IF;
END
$fn$;

-- Caution autorisée sur le trip (DEPOSIT_AUTH prouvée, aucune jambe : 0028) : preuve que la
-- décision n'en fait rien (revue qa n° 1)
CREATE FUNCTION test_fixture.us309_deposit_auth(p_trip uuid, p_amount bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
  t    record;
BEGIN
  SELECT x.id, x.country_code, x.currency INTO t FROM core.booking_trip AS x WHERE x.id = p_trip;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, method, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent, proof_type)
  VALUES (v_id, t.id, test_fixture.fixture_psp_account(t.country_code), t.country_code, 'FAKE',
          'DEPOSIT_AUTH', 'DEPOSIT', 'CARD', p_amount, t.currency, 1, 'SUCCEEDED',
          pg_catalog.format('trip:%s:dep:%s', t.id, v_id), pg_catalog.format('test:%s', v_id),
          'WEBHOOK_SIGNED');
  RETURN v_id;
END
$fn$;

-- Opérations de caution du trip (nature, statut, montant), plus anciennes d'abord
CREATE FUNCTION test_fixture.us309_deposit_state(p_trip uuid)
  RETURNS TABLE (id uuid, kind text, status text, amount_minor bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.id, o.kind, o.status, o.amount_minor FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip AND (o.kind LIKE 'DEPOSIT%' OR o.purpose = 'DEPOSIT')
   ORDER BY o.created_at, o.id
$fn$;

-- Compte d'hôte d'un trip (clé du verrou de la compensation)
CREATE FUNCTION test_fixture.us309_trip_org(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.org_id FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

-- Pièce du seau des preuves déposée par `p_user` à l'heure de la base (accord écrit signé)
CREATE FUNCTION test_fixture.us309_evidence_file(p_user uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, source,
                                     classification, retention_class, uploader_user_id)
  VALUES (v_id, 'PRIVATE_EVIDENCE', 'us309/' || v_id::text, 'application/pdf', 2048,
          pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')), 'STAFF_UPLOAD', 'C1',
          'EVIDENCE', p_user);
  RETURN v_id;
END
$fn$;

-- Décision couverte, à exécuter, et sa déclaration à l'assureur PENDING (preuve de l'envoi)
CREATE FUNCTION test_fixture.us309_insert_declaration(p_claim uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_dec uuid := pg_catalog.gen_random_uuid();
  v_id  uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.claim_decision
         (id, claim_id, trip_id, country_code, currency, outcome, covered, repair_cost_minor,
          charge_amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, host_deductible_minor, lines, excluded, evidence, facts, decided_by,
          decided_role, request_id, execution_status, executed_at)
  SELECT v_dec, c.id, c.trip_id, c.country_code, c.currency, 'NO_GUEST_CHARGE', true, 100, 0, 0,
         0, 0, 0, 0, '[]', '[]', '{}', 'Décision de fixture couverte par la protection',
         c.recorded_by, 'ADMIN', pg_catalog.gen_random_uuid(), 'DONE', platform.now()
    FROM core.claim_damage_claim AS c WHERE c.id = p_claim;
  UPDATE core.claim_damage_claim SET status = 'DECIDED', decided_at = platform.now()
   WHERE id = p_claim;
  INSERT INTO core.claim_insurer_declaration (id, decision_id, claim_id, trip_id, country_code)
  SELECT v_id, v_dec, c.id, c.trip_id, c.country_code
    FROM core.claim_damage_claim AS c WHERE c.id = p_claim;
  RETURN v_id;
END
$fn$;

-- Décision (état, code, prochaine vérification)
CREATE FUNCTION test_fixture.us309_decision_check(p_decision uuid)
  RETURNS TABLE (execution_status text, execution_code text, next_check_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.execution_status, d.execution_code, d.next_check_at
    FROM core.claim_decision AS d WHERE d.id = p_decision
$fn$;

-- Déclaration à l'assureur par son identifiant
CREATE FUNCTION test_fixture.us309_declaration_by_id(p_id uuid)
  RETURNS TABLE (id uuid, status text, provider_ref text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.provider_ref FROM core.claim_insurer_declaration AS i WHERE i.id = p_id
$fn$;

-- Calendrier des jours ouvrés propre au test (instabilité du 2026-11-22) : core.payout_business_day
-- relit à chaque instruction la DERNIÈRE version validée du calendrier du pays ; les fichiers L0
-- « ouverts » (US-708, US-709, US-314) en valident une nouvelle (test_fixture.us708_holiday : max + 1)
-- à tout moment. Une version posée à max + 1 par la transaction du test pouvait donc être dépassée
-- entre la pose et la préparation (CALENDAR_MISSING, lot absent). Ici la version est posée très
-- au-dessus (max + 1 000 000) dans la transaction du test, jamais validée (annulée avec elle) :
-- aucune version validée par un autre fichier ne la dépasse, et aucun autre test ne la voit.
CREATE FUNCTION test_fixture.us309_pinned_holiday(p_country text, p_date date)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
BEGIN
  SELECT COALESCE(pg_catalog.max(h.version), 0) + 1000000 INTO v_version
    FROM core.config_holiday_calendar AS h WHERE h.country_code::text = p_country;
  INSERT INTO core.config_holiday_calendar (country_code, date, name, version)
  VALUES (p_country, p_date, 'Fixture US-309', v_version);
  RETURN v_version;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us309_returned(uuid),
  test_fixture.us309_set_status(uuid, text),
  test_fixture.us309_inspection(uuid, text),
  test_fixture.us309_contract(uuid, text, boolean),
  test_fixture.us309_card_rent(uuid, bigint),
  test_fixture.us309_holder(uuid),
  test_fixture.us309_insert_claim(uuid, uuid),
  test_fixture.us309_insert_decision(uuid, text),
  test_fixture.us309_claims(uuid),
  test_fixture.us309_decision(uuid),
  test_fixture.us309_charges(uuid),
  test_fixture.us309_deposit_operations(uuid),
  test_fixture.us309_ledger(uuid),
  test_fixture.us309_declaration(uuid),
  test_fixture.us309_try_write(text, uuid),
  test_fixture.us309_deposit_auth(uuid, bigint),
  test_fixture.us309_deposit_state(uuid),
  test_fixture.us309_trip_org(uuid),
  test_fixture.us309_evidence_file(uuid),
  test_fixture.us309_insert_declaration(uuid),
  test_fixture.us309_decision_check(uuid),
  test_fixture.us309_declaration_by_id(uuid),
  test_fixture.us309_pinned_holiday(text, date)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us309_returned(uuid),
  test_fixture.us309_set_status(uuid, text),
  test_fixture.us309_inspection(uuid, text),
  test_fixture.us309_contract(uuid, text, boolean),
  test_fixture.us309_card_rent(uuid, bigint),
  test_fixture.us309_holder(uuid),
  test_fixture.us309_insert_claim(uuid, uuid),
  test_fixture.us309_insert_decision(uuid, text),
  test_fixture.us309_claims(uuid),
  test_fixture.us309_decision(uuid),
  test_fixture.us309_charges(uuid),
  test_fixture.us309_deposit_operations(uuid),
  test_fixture.us309_ledger(uuid),
  test_fixture.us309_declaration(uuid),
  test_fixture.us309_try_write(text, uuid),
  test_fixture.us309_deposit_auth(uuid, bigint),
  test_fixture.us309_deposit_state(uuid),
  test_fixture.us309_trip_org(uuid),
  test_fixture.us309_evidence_file(uuid),
  test_fixture.us309_insert_declaration(uuid),
  test_fixture.us309_decision_check(uuid),
  test_fixture.us309_declaration_by_id(uuid),
  test_fixture.us309_pinned_holiday(text, date)
TO app_worker, app_api;
