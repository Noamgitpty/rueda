-- 9957 — ordre de verrouillage des preuves qui ouvrent un interrupteur de mise en service (BOARD,
-- US-122, interblocage du job « base de données », run 44013812687). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Pourquoi : chaque écriture du journal d'audit prend le verrou de la ligne unique
-- `core.audit_chain_head` (FOR UPDATE, 0017) et le garde jusqu'à la fin de la transaction ; les
-- commandes à deux personnes d'US-125 prennent le verrou consultatif `config.go_live:<clé>:<pays>`
-- PUIS écrivent l'audit. Une preuve qui enchaîne plusieurs commandes dans UNE transaction annulée
-- (ouvrir `p2p_private_hosts_enabled` puis `insurer_contract_active`, déclarer un véhicule puis
-- ouvrir un interrupteur…) tient déjà la tête de chaîne quand elle demande le verrou consultatif :
-- ordre inverse de celui d'une transaction neuve, qui tient le consultatif et attend la tête.
-- Deux fichiers de vitest qui ouvrent le même interrupteur du même pays en même temps
-- s'interbloquent alors (40P01 : « waits for ExclusiveLock on advisory lock » contre « waits for
-- ShareLock on transaction » sur `audit_chain_head`). La production n'est pas touchée : chaque
-- commande y est sa propre transaction (consultatif puis tête, toujours dans cet ordre).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_api seul, comme les
-- commandes d'US-125) : prendre la tête de chaîne AVANT le verrou consultatif, dans la
-- transaction courante, pour que toutes les preuves suivent le même ordre (tête, puis
-- consultatif). Aucune écriture : un FOR UPDATE ne déclenche pas `audit_chain_head_guard`, et le
-- verrou tombe à la fin de la transaction (validée ou annulée), jamais un verrou de session.
--
-- Ordre complet (interblocage du run 44059396848, job « guide d'installation », 40P01 entre
-- l0-us205b-quote-mileage et l0-aud-01-audit-chain ; même cause au run 44059889606) : une écriture
-- d'audit ordinaire prend d'abord le verrou de table ROW EXCLUSIVE de `core.audit_audit_log` (son
-- INSERT), PUIS la tête. Les preuves d'altération du journal (fixture 9150) prennent ACCESS
-- EXCLUSIVE sur la table avant d'écrire, donc avant la tête : même ordre (table, puis tête). Une
-- première version de cette fonction prenait la tête SEULE : la preuve qui l'appelait tenait la
-- tête et attendait ROW EXCLUSIVE, pendant que l'altération tenait ACCESS EXCLUSIVE et attendait
-- la tête. La fonction prend donc ROW EXCLUSIVE sur `core.audit_audit_log` AVANT la tête : ordre
-- unique table, tête, consultatif. ROW EXCLUSIVE n'entre en conflit qu'avec les verrous forts
-- (SHARE et au-delà) : il n'ajoute aucune attente entre écrivains ordinaires.
--
-- Retour arrière : DROP FUNCTION test_fixture.audit_chain_head_lock();

CREATE FUNCTION test_fixture.audit_chain_head_lock()
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- verrou de table d'un INSERT d'audit, pris avant la tête (ordre des écritures ordinaires et de
  -- test_fixture.lock_audit_log, 9150)
  LOCK TABLE core.audit_audit_log IN ROW EXCLUSIVE MODE;
  PERFORM 1 FROM core.audit_chain_head AS h WHERE h.chain = 'audit_log' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_chain_head : tête de chaîne absente' USING ERRCODE = 'no_data_found';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.audit_chain_head_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.audit_chain_head_lock() TO app_api;
