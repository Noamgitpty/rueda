-- 9907 — fixtures des preuves des frais annexes (US-706, migration 0177). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser les états
-- que d'autres chemins écrivent (photo d'une série SUBMITTED d'US-303 / US-315 avec son fichier,
-- validation de la remise ou du retour d'US-315 avec le niveau de carburant, fin anticipée,
-- nouvelle version d'un paramètre du pays lu par les frais annexes), relire le registre et les
-- débits d'US-703 (aucun rôle applicatif ne les lit). Les attendus des tests viennent de 19
-- US-706, 16 CLM-021 et 08 (BR-REIMB-01 / 02, BR-PROT-08, BR-FUEL-01 à 03, BR-RETURN-05, T69),
-- jamais de ces fixtures. Appelées SEULEMENT dans une transaction ANNULÉE. AUCUNE fixture n'écrit
-- un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us706_* (voir la liste des droits en fin de fichier).

-- Photo d'une série SUBMITTED (départ CHECKIN ou retour CHECKOUT) prise par une partie (HOST :
-- titulaire ; GUEST : voyageur) à l'emplacement donné du gabarit 1 ; fichier du seau des preuves
-- reçu à l'heure de la base. Rend l'identifiant du fichier.
CREATE FUNCTION test_fixture.us706_photo(p_trip uuid, p_kind text, p_slot text, p_role text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_file uuid := pg_catalog.gen_random_uuid();
  v_cap  uuid := pg_catalog.gen_random_uuid();
  v_insp uuid;
  v_user uuid;
  t      record;
BEGIN
  SELECT x.id, x.country_code, x.guest_user_id, o.holder_user_id INTO t
    FROM core.booking_trip AS x JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_trip;
  v_user := CASE p_role WHEN 'GUEST' THEN t.guest_user_id ELSE t.holder_user_id END;
  SELECT i.id INTO v_insp FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p_trip AND i.kind = p_kind AND i.performer_role = p_role;
  IF v_insp IS NULL THEN
    INSERT INTO core.trip_ops_inspection (trip_id, country_code, kind, performer_role, performed_by,
                                          template_version, status, submitted_at)
    VALUES (p_trip, t.country_code, p_kind, p_role, v_user, 1, 'SUBMITTED', platform.now())
    RETURNING id INTO v_insp;
  END IF;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, source,
                                     classification, retention_class, uploader_user_id)
  VALUES (v_file, 'PRIVATE_EVIDENCE', 'us706/' || v_file::text, 'image/jpeg', 4096,
          pg_catalog.sha256(pg_catalog.convert_to(v_file::text, 'UTF8')), 'IN_APP_CAMERA', 'C1',
          'TRIP_INSPECTION', v_user);
  INSERT INTO core.trip_ops_photo_capture (id, inspection_id, slot_code, issued_to, issued_at,
                                           expires_at, used_at)
  VALUES (v_cap, v_insp, p_slot, v_user, platform.now(), platform.now() + interval '10 minutes',
          platform.now());
  INSERT INTO core.trip_ops_inspection_photo (inspection_id, slot_code, file_id, taken_by_role,
                                              capture_id, sha256, bytes, received_at,
                                              device_captured_at, clock_skew_flag)
  VALUES (v_insp, p_slot, v_file, p_role, v_cap,
          pg_catalog.sha256(pg_catalog.convert_to(v_file::text, 'UTF8')), 4096, platform.now(),
          platform.now(), false);
  RETURN v_file;
END
$fn$;

-- Fichier du seau des preuves qui n'est PAS une photo d'une série du trip (pièce étrangère)
CREATE FUNCTION test_fixture.us706_loose_file(p_user uuid)
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
  VALUES (v_id, 'PRIVATE_EVIDENCE', 'us706/' || v_id::text, 'image/jpeg', 2048,
          pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')), 'HOST_UPLOAD', 'C1',
          'EVIDENCE', p_user);
  RETURN v_id;
END
$fn$;

-- Validation de la remise (CHECKIN) ou du retour (CHECKOUT) d'une partie : niveau de carburant en
-- huitièmes, compteur
CREATE FUNCTION test_fixture.us706_validation(p_trip uuid, p_kind text, p_role text,
                                              p_fuel_eighths smallint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  SELECT x.id, x.country_code, x.guest_user_id, o.holder_user_id INTO t
    FROM core.booking_trip AS x JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_trip;
  INSERT INTO core.trip_ops_handover_validation (trip_id, country_code, kind, performer_role,
                                                 performed_by, odometer_km, fuel_eighths, method)
  VALUES (p_trip, t.country_code, p_kind, p_role,
          CASE p_role WHEN 'GUEST' THEN t.guest_user_id ELSE t.holder_user_id END,
          CASE p_kind WHEN 'CHECKIN' THEN 12000 ELSE 12350 END, p_fuel_eighths, 'IN_PERSON');
END
$fn$;

-- Fin anticipée (transition TERMINATED_EARLY du journal d'état)
CREATE FUNCTION test_fixture.us706_terminated_early(p_trip uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.booking_trip_state_log (id, trip_id, from_status, to_status, kind, reason_code,
                                           actor_role)
  VALUES (pg_catalog.gen_random_uuid(), p_trip, 'IN_PROGRESS', 'TERMINATED_EARLY', 'TRANSITION',
          'HOST_REQUEST', 'SYSTEM')
$fn$;

-- Nouvelle version d'un paramètre lu par les frais annexes (transaction ANNULÉE) ; NULL : version
-- « absente » impossible (insertion seule) — le test d'absence passe par un pays sans valeur
CREATE FUNCTION test_fixture.us706_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('incidental_host_window_h', 'invoice_guest_response_h',
                   'incidental_cleaning_max_minor', 'fuel_refill_max') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-706 (annulé)');
END
$fn$;

-- Lectures du registre et des débits (aucun rôle applicatif ne les lit)
CREATE FUNCTION test_fixture.us706_invoices(p_trip uuid)
  RETURNS TABLE (id uuid, fee_type text, status text, amount_minor bigint, leg_host_minor bigint,
                 leg_insurer_minor bigint, leg_tax_third_party_minor bigint,
                 leg_platform_minor bigint, host_user_id uuid, guest_user_id uuid,
                 notified_at timestamptz, response_due_at timestamptz,
                 host_deadline_at timestamptz, accepted_at timestamptz, disputed_at timestamptz,
                 decided_role text, charge_basis text, charge_id uuid, charged_at timestamptz,
                 execution_code text, next_check_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.fee_type, i.status, i.amount_minor, i.leg_host_minor, i.leg_insurer_minor,
         i.leg_tax_third_party_minor, i.leg_platform_minor, i.host_user_id, i.guest_user_id,
         i.notified_at, i.response_due_at, i.host_deadline_at, i.accepted_at, i.disputed_at,
         i.decided_role, i.charge_basis, i.charge_id, i.charged_at, i.execution_code,
         i.next_check_at
    FROM core.claim_incidental_invoice AS i WHERE i.trip_id = p_trip
   ORDER BY i.notified_at, i.fee_type
$fn$;

-- Débits post-trip nés d'un frais annexe (origine INCIDENTAL_INVOICE)
CREATE FUNCTION test_fixture.us706_charges(p_invoice uuid)
  RETURNS TABLE (id uuid, purpose text, reason text, amount_minor bigint, leg_host_minor bigint,
                 leg_insurer_minor bigint, leg_tax_third_party_minor bigint,
                 leg_platform_minor bigint, guest_agreed boolean, status text,
                 tender_operation_id uuid, notified_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.purpose, c.reason, c.amount_minor, c.leg_host_minor, c.leg_insurer_minor,
         c.leg_tax_third_party_minor, c.leg_platform_minor, c.guest_agreed_at IS NOT NULL, c.status,
         c.tender_operation_id, c.notified_at
    FROM core.payment_post_trip_charge AS c
   WHERE c.origin_type = 'INCIDENTAL_INVOICE' AND c.origin_id = p_invoice
$fn$;

-- Débits post-trip d'un trip, toutes origines (aucun débit hors frais annexe)
CREATE FUNCTION test_fixture.us706_trip_charges(p_trip uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.count(*)::integer FROM core.payment_post_trip_charge AS c
   WHERE c.trip_id = p_trip
$fn$;

-- Écriture directe interdite (garde) : changer le montant ou supprimer la demande
CREATE FUNCTION test_fixture.us706_try_write(p_what text, p_invoice uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'AMOUNT' THEN
    UPDATE core.claim_incidental_invoice SET amount_minor = amount_minor + 1,
                                             leg_host_minor = leg_host_minor + 1
     WHERE id = p_invoice;
  ELSIF p_what = 'REOPEN' THEN
    UPDATE core.claim_incidental_invoice SET status = 'AWAITING_GUEST' WHERE id = p_invoice;
  ELSIF p_what = 'DELETE' THEN
    DELETE FROM core.claim_incidental_invoice WHERE id = p_invoice;
  ELSE
    RAISE EXCEPTION 'écriture inconnue : %', p_what USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$fn$;

-- Demande posée directement (AWAITING_GUEST) pour la matrice des routes de la console (US-043) :
-- la décision d'un frais non contesté rend INCIDENTAL_NOT_DISPUTED, rien n'est écrit
CREATE FUNCTION test_fixture.us706_insert_invoice(p_trip uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id  uuid := pg_catalog.gen_random_uuid();
  -- une seule lecture de l'horloge (horloge réelle de la matrice : échéance = notification + 72 h)
  v_now timestamptz := platform.now();
BEGIN
  INSERT INTO core.claim_incidental_invoice
         (id, trip_id, country_code, currency, org_id, host_user_id, guest_user_id, request_id,
          fee_type, amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, description, evidence_file_ids, trip_end_at, host_deadline_at,
          notified_at, response_hours, response_due_at, next_check_at)
  SELECT v_id, t.id, t.country_code, t.currency, t.org_id, o.holder_user_id, t.guest_user_id,
         pg_catalog.gen_random_uuid(), 'CLEANING', 100, 100, 0, 0, 0, 'Demande de fixture US-706',
         ARRAY[pg_catalog.gen_random_uuid()], v_now, v_now + interval '72 hours', v_now, 72,
         v_now + interval '72 hours', v_now + interval '72 hours'
    FROM core.booking_trip AS t JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip;
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us706_photo(uuid, text, text, text),
  test_fixture.us706_loose_file(uuid),
  test_fixture.us706_validation(uuid, text, text, smallint),
  test_fixture.us706_terminated_early(uuid),
  test_fixture.us706_param_version(text, text, jsonb),
  test_fixture.us706_invoices(uuid),
  test_fixture.us706_charges(uuid),
  test_fixture.us706_trip_charges(uuid),
  test_fixture.us706_try_write(text, uuid),
  test_fixture.us706_insert_invoice(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us706_photo(uuid, text, text, text),
  test_fixture.us706_loose_file(uuid),
  test_fixture.us706_validation(uuid, text, text, smallint),
  test_fixture.us706_terminated_early(uuid),
  test_fixture.us706_param_version(text, text, jsonb),
  test_fixture.us706_invoices(uuid),
  test_fixture.us706_charges(uuid),
  test_fixture.us706_trip_charges(uuid),
  test_fixture.us706_try_write(text, uuid),
  test_fixture.us706_insert_invoice(uuid)
TO app_worker, app_api;
