# Revue securite — US-050 « US-709 dans le registre des revues » (PR n° 218) — 2026-11-17

Relecteur : securite / claude-sonnet-5-5 (famille A, autre modèle que l'auteur) ; revue dégradée : famille B indisponible, TECH-007
Entrées : origin/main..3d795750 (3d79575072bf29fd8d4abefe6e1d9861c8450d59)

Relecture statique du diff `origin/main...3d795750` (1 fichier protégé : `docs/team/review-requirements.json`).

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR                           | Aucun rôle affaibli : ajout seul de `stories.US-709` et d'un propriétaire dans `pathOwners["packages/db/"]` ; `default`, `pathRules`, `sharedPaths`, `branchPrefixes`, `nonStoryForbiddenPaths` et toutes les autres stories inchangés.                                                                                                |
| 2   | MINEUR                           | `git diff origin/main...3d795750 -- .github/ scripts/` est vide : le job `revues` de `ci.yml` et `scripts/ci/check-story-reviews.mjs` sont intacts par construction. Le fichier protégé impose la présente revue sécurité au SHA fusionné ; toute poussée ultérieure sur la branche exigera une revue au nouveau SHA.                  |
| 3   | MINEUR                           | La nouvelle entrée exige `securite` et `argent` pour US-709a, dont le périmètre (PR n° 215 : migration `SECURITY DEFINER`, RLS, déclencheur dans la transaction de règlement, lecture FINANCE / ADMIN) le justifie ; `pathRules` imposait déjà securite et architecture sur `packages/db/`. L'entrée renforce, elle ne contourne rien. |
| 4   | MINEUR                           | Aucun secret, aucun interrupteur de mise en service ni donnée personnelle dans le diff. Aucun fichier de catalogue ni d'écran touché par la PR n° 215, donc pas d'exigence `ux` omise.                                                                                                                                                 |
| 5   | MINEUR                           | CI `ci` de la PR n° 218 en file d'attente (`queued`) à la revue ; rien relancé. Revue dégradée : relecture statique, aucune revue d'une autre famille.                                                                                                                                                                                 |

Verdict : APPROUVÉ
