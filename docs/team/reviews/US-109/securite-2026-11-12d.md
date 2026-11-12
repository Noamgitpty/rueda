# Revue securite — US-109 « Fiche 360° et files de revue » (PR n° 110) — 2026-11-12

Relecteur : securite / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5, revue dégradée : famille B indisponible, TECH-007)
Entrées : b16a9537440e6fa7ebbe719c163df25860bb2b1a..f45607ad3af7b7e8e0db51a98562c1dae1549082 (PR n° 110, story US-109 ; troisième passe consolidant les passes b et c ; relecture statique, PostgreSQL non démarré ; CI verte à f45607a selon l'orchestrateur)

Passes b (958d5b3) et c (f45607a, delta `958d5b3..f45607a`) : APPROUVÉ, sans bloquant.

| # | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat | Preuve (fichier:ligne, test) | Décision |
| --- | --- | --- | --- | --- |
| 1 | MINEUR | Première passe n° 1 (séparation des fonctions) corrigé : `SELF_FORBIDDEN` et `STAFF_SUBJECT_ADMIN_ONLY` avant verrou et écriture ; test L0 PA et PY. Un ADMIN peut restreindre un autre ADMIN (journalisé, motivé). | `0064` `iam_manual_action_restriction` ; `l0-us109-review-queues-360.test.ts` | Conforme. |
| 2 | MINEUR | Première passe n° 3 (pays non recoupé) corrigé : `COUNTRY_MISMATCH` à la mise en file, `FORBIDDEN` journalisé dans le dossier KYC, jamais `CASE_REQUIRED`. | `0064` | Conforme. |
| 3 | MINEUR | Fonctions de file : `SECURITY DEFINER`, `search_path` figé, `PUBLIC` révoqué, EXECUTE à personne ; `iam_staff_close` limitée à `iam_staff_owner`, `WITH CHECK` interdisant tout état vivant ; RLS `ENABLE` + `FORCE`, aucun `BYPASSRLS`, aucun fichier protégé ni interrupteur touché. | `0064` ; allowlist | Conforme. |
| 4 | MINEUR | Delta `958d5b3..f45607a` : `GRANT USAGE ON SCHEMA core TO cmd_golive_owner` en test seulement (`test-migrations/` jamais appliqué hors harnais ; RT-CONC-64). NOLOGIN inchangé, aucun droit de table ni EXECUTE ; `app_api` sans EXECUTE sur les deux fonctions de `core`, assertions 42501 intactes. | `9990` l. 53 ; L0 l. 825 à 865 | Conforme. |
| 5 | MINEUR | Pays recoupé seulement pour `USER_ACCOUNT` et `ORGANIZATION` ; `p_actor` non vérifié ici ; restriction posée pendant un hold actif non relue au paiement. | `0064` | Risques résiduels acceptés, au BOARD (N-53 à N-57) et à recouper dans les stories productrices. |

<!-- Laisser une ligne vide avant « Verdict » : sinon prettier l’absorbe dans le tableau. -->

Verdict : APPROUVÉ
