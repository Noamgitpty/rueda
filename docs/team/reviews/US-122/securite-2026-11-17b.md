# Revue sécurité — US-122 « limite de durée du job e2e web (20 à 30 min) » (PR n° 212) — 2026-11-17

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5 ; revue dégradée : famille B indisponible, TECH-007)
Entrées : c5d87037..bc83039b

Contexte : PR de CI et de documentation seules (4 fichiers : `.github/workflows/ci.yml`, `docs/ops/CI.md`, `docs/team/handoffs/US-122.md`, `changelog.d/`), tête `bc83039bc423db5994b363af3366bdb370434dd0` (confirmée à la lecture, identique à `refs/pull/212/head`). Lecture statique de `git diff origin/main...bc83039b` ; durées vérifiées par `gh run view --json jobs` sur les 15 derniers runs de `main` ; CI verte (run `44086984559`), non relancée.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                             |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | Chemin protégé touché (`.github/`) : revue sécurité au SHA fusionné requise ; cette revue porte sur `bc83039bc423db5994b363af3366bdb370434dd0`, toute nouvelle poussée la rend périmée. `scripts/ci/`, `scripts/team/` et `docs/team/review-requirements.json` ne sont pas touchés. |
| 2   | MINEUR  | Job `revues` de `ci.yml` vérifié intact : le diff de `.github/` ne contient qu'un hunk, dans le job `e2e-web` (lignes 113 à 119) ; aucune ligne du job `revues`, de ses permissions, du filtre ni du contrôle `check-story-reviews` n'est touchée.                                  |
| 3   | MINEUR  | Permissions, actions épinglées par SHA (`checkout`, `pnpm/action-setup`, `setup-node`), secrets, déclencheurs, `persist-credentials: false`, seuils, relances et filtres : inchangés dans le diff. Aucun secret ni jeton dans les lignes ajoutées.                                  |
| 4   | MINEUR  | Surface : relever la limite de 20 à 30 min allonge au plus de 10 min l'exécution d'un job sans secret ni droit d'écriture, sur un runner éphémère ; coût de minutes marginal, aucun gain pour un attaquant au-delà de ce que 20 min permettaient.                                   |
| 5   | MINEUR  | Revue dégradée : aucune revue d'une autre famille (TECH-007) ; reprise en famille B avant la production.                                                                                                                                                                            |

Verdict : APPROUVÉ
