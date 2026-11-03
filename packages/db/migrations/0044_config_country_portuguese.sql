-- 0044 — graine complémentaire : langue « pt » ajoutée aux pays (locales et noms).
-- DEC-FONDATEUR-18 ; US-014 ; ADR-024, ADR-044, ADR-071. FICHIER GÉNÉRÉ depuis
-- apps/api/src/modules/cfg/data/countries.json par seed-sql.ts (renderLanguageSeedSql) : ne pas
-- l’éditer à la main (test seed-sql.test.ts). Appliquée sous `migrator`.
-- 0009 est immuable (ADR-044) : elle reste rendue sans la langue « pt ».
--
-- Retour arrière (base sans dépendance) : rétablir locales et noms de 0009 de la même façon
-- (garde suspendue puis rétablie) ; jamais en production : nouvelle migration à la place.

ALTER TABLE core.config_country DISABLE TRIGGER config_country_guard;
UPDATE core.config_country SET locales = ARRAY['es-PA', 'en', 'fr', 'pt']::text[], names = '{"en":"Panama","es":"Panamá","fr":"Panama","pt":"Panamá"}'::jsonb
 WHERE code = 'PA';
UPDATE core.config_country SET locales = ARRAY['es-PY', 'en', 'fr', 'pt']::text[], names = '{"en":"Paraguay","es":"Paraguay","fr":"Paraguay","pt":"Paraguai"}'::jsonb
 WHERE code = 'PY';

ALTER TABLE core.config_country ENABLE TRIGGER config_country_guard;

-- Fail-closed : chaque pays porte une locale et un nom dans la langue ajoutée (COALESCE : un
-- tableau ou un objet NULL compte comme absent).
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_country AS c
              WHERE NOT COALESCE(EXISTS (SELECT 1 FROM pg_catalog.unnest(c.locales) AS t(tag)
                                          WHERE pg_catalog.split_part(t.tag, '-', 1) = 'pt'), false)
                 OR COALESCE(pg_catalog.btrim(c.names ->> 'pt'), '') = '') THEN
    RAISE EXCEPTION 'graine : langue pt absente d''un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
