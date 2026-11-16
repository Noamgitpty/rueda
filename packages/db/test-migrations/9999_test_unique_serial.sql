-- 9999 — compteur unique des valeurs de test soumises à une contrainte d'unicité (BOARD N-186,
-- US-122). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Pourquoi : les fichiers de test tiraient au hasard des numéros de téléphone (10^7 numéros en PA),
-- des plaques, des VIN et des numéros de châssis, sur une base partagée par tous les fichiers d'une
-- exécution, où des milliers de comptes à téléphone vérifié sont validés. Collision d'anniversaire
-- sur `user_account_phone_verified_unique` (ACC-014) au run 43877229339 (job « base de données »,
-- rt-l1-03, 23505). Une séquence de la base est le seul compteur commun à tous les travailleurs
-- de vitest, à tous les projets (l0, l0-concurrence, l0-redteam) et à tous les fichiers (chaque
-- fichier recharge ses modules : un compteur en mémoire repartirait de zéro) : chaque appel rend
-- un entier jamais rendu dans cette base, même dans une transaction annulée (nextval n'est pas
-- transactionnel). Les valeurs sont formées par packages/db/test/support/unique.ts.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_api et app_worker) : rendre
-- la valeur suivante de la séquence, sans droit sur la séquence elle-même.
--
-- Retour arrière : DROP FUNCTION test_fixture.next_unique_serial();
--   DROP SEQUENCE test_fixture.unique_serial_seq;

CREATE SEQUENCE test_fixture.unique_serial_seq AS bigint MINVALUE 1 START WITH 1 NO CYCLE;
REVOKE ALL ON SEQUENCE test_fixture.unique_serial_seq FROM PUBLIC;

CREATE FUNCTION test_fixture.next_unique_serial()
  RETURNS bigint
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.nextval('test_fixture.unique_serial_seq'::pg_catalog.regclass)
$fn$;

REVOKE ALL ON FUNCTION test_fixture.next_unique_serial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.next_unique_serial() TO app_api, app_worker;
