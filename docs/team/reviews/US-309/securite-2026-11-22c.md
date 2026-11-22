# Revue securite — US-309 « Dommages, incidents et décisions » (PR n° 287) — 2026-11-22 (delta, test instable)

Relecteur : revue-securite / claude-sonnet-5-5 (modèle autre que l'auteur claude-opus-5-5)
Entrées : d4e67b2f..bd17b39b; revue dégradée : famille B indisponible, TECH-007

Contexte : fixture `test_fixture.us309_pinned_holiday` relue.

| #   | Gravité | Constat                                                                                                                                                                                                                        | Preuve                 | Décision |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------- |
| 1   | INFO    | `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, objets qualifiés, `pg_catalog.max` ; `REVOKE ALL ... FROM PUBLIC` puis `GRANT EXECUTE` à `app_worker`, `app_api` seulement, comme les autres fixtures du fichier. | 9909:424-446, 471, 496 | OK       |
| 2   | INFO    | Fixture sous `test-migrations` : jamais chargée en production ; insertion limitée à une ligne de calendrier annulée avec la transaction. Aucun secret, aucune écriture d'interrupteur.                                         | diff                   | OK       |

Verdict : APPROUVÉ
