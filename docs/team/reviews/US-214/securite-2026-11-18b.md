# Revue securite (seconde passe) — US-214 « Mis viajes (S08) et détail du trip (S09) du voyageur » (PR n° 230) — 2026-11-18

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5 ; revue dégradée : famille B indisponible, TECH-007)
Entrées : 9d537b9f..7c206cd9 (tête 7c206cd9c78245778c09262f00a5f079fcfe3b45 ; diff complet `origin/main...7c206cd9` relu aussi)

Contexte : rapports de première passe, passation (cycle 1), ADR-160 et diff de correction relus ; CI du run 44265484923 verte au SHA relu (dont base de données L0, e2e, revues).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **0136 : sécurité intacte.** La modification ne fait que restreindre le prédicat de la branche REQUEST (moins de lignes rendues) : `SET search_path = pg_catalog, pg_temp`, `SECURITY DEFINER` propriétaire `cmd_hold_owner`, EXECUTE à `app_api` seul, entrée de liste blanche, identité jugée par la session, filtre `guest_user_id` : inchangés. |
| 2   | INFO    | **Minimisation et absence d'oracle conservées.** Aucune adresse pour une demande, hôte en prénom et initiale, aucune plaque ; `totalMinor` nullable n'ajoute aucune donnée ; 404 uniforme ; `Cache-Control: no-store`. Un trip sans devis ne révèle rien de plus.                                                                                   |
| 3   | INFO    | **Preuves.** L0 sous `app_api` en PA et PY (IDOR, onglets, absence de la demande en vol) ; CI verte (gitleaks, base de données). Aucun chemin protégé (`.github/`, `scripts/ci/`, `scripts/team/`, `review-requirements.json`) touché. Le constat 8 de la première passe (disponibilité) est levé.                                                  |

Verdict : APPROUVÉ
