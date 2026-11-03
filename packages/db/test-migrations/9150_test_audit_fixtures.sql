-- 9150 — fixtures des preuves d'audit (US-009). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` ; la base `rueda_test_*_prod` ne la reçoit pas (test
-- d'intégration « fixtures absentes de la base de production »).
--
-- Rôle de ces fonctions (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique,
-- accordées à app_worker DANS LA BASE DE TEST seulement) :
--   - destroy_subject_key : la procédure manuelle de destruction (0020), qu'aucun rôle applicatif
--     n'exécute en production ; ici pour prouver le crypto-shredding sous les rôles de production ;
--   - set_file_legal_hold : pose d'un gel légal sur un fichier (outil : US-536 / US-046) ;
--   - owner_tamper_audit_log : simule un PROPRIÉTAIRE malveillant (migrator) qui altère le journal,
--     avec ou sans désactivation du trigger de refus, pour prouver (a) que le trigger refuse même le
--     propriétaire et (b) que la vérification de la chaîne détecte une altération qui l'aurait
--     contourné. À n'utiliser que dans une transaction de test annulée (ROLLBACK) ;
--   - lock_audit_log : prend le verrou ACCESS EXCLUSIVE du journal AVANT toute écriture, dans les
--     tests qui désactivent le trigger (ALTER TABLE) ; sans lui, un écrivain concurrent (autre
--     fichier de test) qui attend la tête de chaîne formerait un interblocage avec l'ALTER TABLE.
--
-- Retour arrière : DROP FUNCTION test_fixture.destroy_subject_key(text, uuid, uuid, text),
--   test_fixture.set_file_legal_hold(uuid, timestamptz), test_fixture.owner_tamper_audit_log(text, bigint, boolean),
--   test_fixture.lock_audit_log();

CREATE FUNCTION test_fixture.destroy_subject_key(
  p_subject_type text,
  p_subject_id   uuid,
  p_request_id   uuid,
  p_reason       text
)
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.audit_destroy_subject_key(p_subject_type, p_subject_id, p_request_id, p_reason)
$fn$;

CREATE FUNCTION test_fixture.set_file_legal_hold(p_file_id uuid, p_until timestamptz)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.audit_file_asset SET legal_hold_until = p_until WHERE id = p_file_id
$fn$;

-- p_kind :
--   'UPDATE_REASON'        : modifie `reason` sans toucher au hachage ;
--   'UPDATE_REASON_REHASH' : modifie `reason` ET recalcule le hachage de CETTE ligne seulement ;
--   'DELETE'               : supprime la ligne.
-- p_disable_guard : désactive (dans la transaction) les triggers de refus avant d'agir.
CREATE FUNCTION test_fixture.owner_tamper_audit_log(p_kind text, p_id bigint, p_disable_guard boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_disable_guard THEN
    ALTER TABLE core.audit_audit_log DISABLE TRIGGER audit_log_append_only;
  END IF;
  IF p_kind = 'UPDATE_REASON' THEN
    UPDATE core.audit_audit_log SET reason = 'altered by owner' WHERE id = p_id;
  ELSIF p_kind = 'UPDATE_REASON_REHASH' THEN
    UPDATE core.audit_audit_log SET reason = 'altered by owner' WHERE id = p_id;
    UPDATE core.audit_audit_log l
       SET hash = pg_catalog.sha256(pg_catalog.convert_to(core.audit_log_canonical(l), 'UTF8'))
     WHERE l.id = p_id;
  ELSIF p_kind = 'DELETE' THEN
    DELETE FROM core.audit_audit_log WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'unknown tamper kind %', p_kind;
  END IF;
  IF p_disable_guard THEN
    ALTER TABLE core.audit_audit_log ENABLE TRIGGER audit_log_append_only;
  END IF;
END
$fn$;

CREATE FUNCTION test_fixture.lock_audit_log()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  LOCK TABLE core.audit_audit_log IN ACCESS EXCLUSIVE MODE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.destroy_subject_key(text, uuid, uuid, text),
  test_fixture.set_file_legal_hold(uuid, timestamptz),
  test_fixture.owner_tamper_audit_log(text, bigint, boolean), test_fixture.lock_audit_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.destroy_subject_key(text, uuid, uuid, text),
  test_fixture.set_file_legal_hold(uuid, timestamptz),
  test_fixture.owner_tamper_audit_log(text, bigint, boolean), test_fixture.lock_audit_log() TO app_worker;
