-- 9962 — fixtures de la passe C2, C5 et C15 SANS horloge virtuelle (US-045, suite N-17 ; 17 §11
-- L0-06, §1.3 point 2 bis). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : sur l'horloge RÉELLE (`platform.now()` = `clock_timestamp()`, aucun `app.virtual_now`),
-- un hold n'échoit qu'après `hold_ttl_minutes` (graine : 10 min). La passe en horloge réelle de
-- l0-06-real-clock.test.ts pose donc ses holds pendant une courte FENÊTRE où `hold_ttl_minutes`
-- vaut 1 min pour le pays : une version de paramètre ordinaire, non rétroactive (valid_from =
-- platform.now()), fermée d'emblée (valid_to = platform.now() + fenêtre, au plus 60 s). Les holds
-- posés hors de la fenêtre gardent la graine ; aucune autre clé n'est écrite. Le fichier de test
-- tourne seul (projet l0-concurrence) : aucun autre fichier ne pose de hold pendant la fenêtre.
--
-- SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, aucune colonne gardée
-- (le trigger hold_guarded_columns n'est pas contourné : l'échéance vient de la commande réelle).
--
-- Retour arrière : DROP FUNCTION test_fixture.us045_short_hold_ttl(text, integer).

CREATE FUNCTION test_fixture.us045_short_hold_ttl(p_country_code text, p_window_s integer)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_from timestamptz := platform.now();
  v_to   timestamptz;
BEGIN
  IF p_window_s IS NULL OR p_window_s < 1 OR p_window_s > 60 THEN
    RAISE EXCEPTION 'us045_short_hold_ttl: window % out of [1, 60] s', p_window_s;
  END IF;
  v_to := v_from + pg_catalog.make_interval(secs => p_window_s);
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, valid_from, valid_to,
                                       change_reason)
  VALUES ('hold_ttl_minutes', p_country_code, 'COUNTRY', '1'::jsonb, v_from, v_to,
          'test US-045 : passe C2 / C5 / C15 en horloge réelle (fenêtre fermée)');
  RETURN v_to;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us045_short_hold_ttl(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us045_short_hold_ttl(text, integer) TO app_api;
