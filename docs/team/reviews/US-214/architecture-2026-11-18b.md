# Revue architecture (seconde passe) — US-214 « Mis viajes (S08) et détail du trip (S09) du voyageur » (PR n° 230) — 2026-11-18

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 9d537b9f..7c206cd9 (tête 7c206cd9c78245778c09262f00a5f079fcfe3b45 ; diff complet `origin/main...7c206cd9` relu aussi)

Contexte : rapports de première passe, passation (cycle 1), ADR-160 et diff de correction relus ; CI du run 44265484923 verte au SHA relu (dont base de données L0, e2e, revues).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                           |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Majeur 1 d'architecture (`COMME_TURO.md`) levé.** Le fichier fait 209 lignes contre 207 sur `main` ; la seule différence avec `origin/main` est l'ajout des deux lignes US-214 (aucune ligne d'autrui retirée).                                                                                                                                 |
| 2   | INFO    | **Frontières intactes.** Correction limitée à 0136 (modifiée en place, non fusionnée), au module AVL, à la lecture du site et aux catalogues ; aucun import interne d'un autre module, OpenAPI élargi (`totalMinor` nullable) cohérent avec le type API et le type du site, ADR-160 et passation mis à jour (point d'entrée depuis S06 consigné). |
| 3   | INFO    | **Contrat entre base, API et site cohérent.** La base ne rend plus que `AWAITING_HOST` ou `PAYMENT_IN_FLIGHT` avec heure limite ; l'API accepte exactement ces deux statuts pour une demande et exige l'heure limite ; le site fait la même garde. Aucune ligne légitime n'est refusée.                                                           |
| 4   | INFO    | **Catalogue v76** : trois clés ajoutées dans les quatre langues, version inchangée (76).                                                                                                                                                                                                                                                          |

Verdict : APPROUVÉ
