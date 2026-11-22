# Revue architecture — US-309 « Dommages, incidents et décisions » (PR n° 287) — 2026-11-22 (delta, test instable)

Relecteur : revue-architecture / claude-sonnet-5-5 (modèle autre que l'auteur claude-opus-5-5)
Entrées : d4e67b2f..bd17b39b

Contexte : revue delta ; aucun code de production ni migration modifié.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                                        | Preuve           | Décision |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| 1   | INFO    | La fixture vit sous `packages/db/test-migrations/` (numéro 9909 ≥ 9000, chargée uniquement par le chargeur de test) ; aucun fichier de `packages/db/migrations/` ni de `apps/` touché dans `d4e67b2f..bd17b39b`. Jamais chargée en production.                                                                                                                                                                 | diff --name-only | OK       |
| 2   | MINEUR  | Comportement de production de `payout_business_day` : il ne lit que la dernière version globale du calendrier et rend NULL (CALENDAR_MISSING, échec fermé) si une année du parcours n'y figure pas. Sûr, mais une nouvelle version partielle publiée en production suspendrait les préparations du pays jusqu'à complétion. À documenter dans l'exploitation du calendrier (une version = calendrier complet). | 0165:591-612     | Suite    |

Verdict : APPROUVÉ
