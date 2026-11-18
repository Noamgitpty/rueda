# Revue architecture — US-224 « durcissement avant ouverture d'un pays (N-354, N-342, N-313) » (PR n° 247) — 2026-11-18

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : eb90f895..f4020a39f241eb0fc1affd37c76768ba2f175797

Contexte : lecture de `git diff eb90f895...f4020a39` (migration 0147, fixture 9935, ADR-171, correction d'ADR-159, trois L0, documentation). CI de f4020a39 (run 44404059009) verte, dont « base de données » (test:int, test:l0). Corps recopiés de 0140, 0137 et 0135 comparés au corps de 0147 : seules les conditions annoncées changent.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | ADR-171 PROPOSÉ, complète ADR-163, 124, 161 et corrige ADR-159 (phrase fausse « marque premium inconnue tombe en classe haute » rectifiée explicitement). Expand / contract respecté : rien n'est retiré.                                                                                                                              |
| 2   | INFO    | Cohérence avec CLAUDE.md : `cmd_hold_owner` seul propriétaire des commandes, aucune importation inter-module, aucune constante de pays, `platform.now()`, défaut du pays pour une marque absente. COMME_TURO et BOARD (N-354, N-342, N-313) à jour ; la validation à deux personnes écartée est motivée et notée comme suite possible. |

Verdict : APPROUVÉ
