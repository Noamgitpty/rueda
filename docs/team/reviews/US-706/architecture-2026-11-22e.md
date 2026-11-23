# Revue architecture (delta 4) — US-706 « frais annexes : paiement ou contestation par le voyageur » (PR n° 292) — 2026-11-22e

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A ; autre modèle que l'auteur claude-opus-5-5)
Entrées : 38032050634019987a4fe024a9a037cdcf4a3675..dde9ba314af54234adaf7780198bc0244a399ecc (git diff, 10 fichiers, ~230 lignes ; CI verte, run 45084432843)

Contexte : relu ADR-197 n° 12, README CLM, handoff, schéma, 0177. journal du job base de données (137399695491, run 45084432843) : `l0-us706-incidental-fees.test.ts (28 tests)` réussi, PA et PY ; base 178 fichiers, 3 091 tests réussis.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Preuve                                                          | Décision |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| 1   | INFO    | **Découpage porte / détail : cohérent avec ADR-122 et ADR-197 n° 18.** La porte (propriétaire `iam_staff_owner`) décide qui voit quoi (pays, séparation des tâches, limite) ; la fonction `cmd_money` ne fait que lire le détail des ids choisis. Aucune dépendance de module nouvelle ; la route `GET /console/incidental-reviews` est décrite au README CLM.                                                                                          | `0177:1356-1381, 1774-1826` ; `clm/README.md:32-33`             | Aucune.  |
| 2   | INFO    | **Textes alignés sur le rattachement au trip.** ADR-197 n° 12, README CLM (commande `claim_cmd_attach_incidental_file`, table `claim_incidental_host_file`, route d'envoi : suite), `COMME_TURO.md`, description du paramètre : plus aucune mention de « fenêtre du trip » comme critère. Suites inscrites au handoff (plafond de fichiers, course à deux connexions, alerte par l'outbox, route d'envoi, commande de reprise avant `payouts_enabled`). | `ADR-197:27` ; `handoff US-706.md` (section 2026-11-22 reprise) | Aucune.  |

Aucun constat CRITIQUE ou MAJEUR.

Verdict : APPROUVÉ
