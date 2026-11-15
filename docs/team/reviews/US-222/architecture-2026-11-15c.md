# Revue architecture — US-222 « recalage des spécifications du lot 2 » (PR n° 166) — 2026-11-15

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 734248df99cc895b56191053fd316be73a2afeb2..825b9b61e5f4fa89b46294667a48d87b3535a679

Contexte : cohérence d'ensemble de 17 et 19 après modification (§2.1, §2.2, §3.2.5, §4.5, §7.2, §8.1, annexe I ; DoR d'US-215, US-223, US-224). `verif18_crossref.py` et `check_backlog.py` : OK.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                              |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | CAT → CTR ajoutée au graphe (§2.1), à la ligne CAT de §2.2 et à `dependency-graph.ts` (« écart assumé », ADR-128) ; CTR ne dépend que de IAM, CFG, AUD : aucun cycle, aucune autre contradiction avec §2.2.                                                                                           |
| 2   | MINEUR  | Les cinq lignes ADR (124, 125, 126, 128, 129) correspondent aux fichiers de `docs/adr/` ; les autres ADR postérieurs à ADR-046 sont dits laissés au dépôt (annexe I, L2R-08).                                                                                                                         |
| 3   | MINEUR  | 17 §3.2.5 : « État livré » et « Reste à faire » cohérents avec les migrations 0100 et 0102 ; la table cible de `quote` est conservée avec renvoi explicite : pas de double vérité.                                                                                                                    |
| 4   | MINEUR  | DoR d'US-215, US-223 et US-224 : reports d'US-207 (règlement dans la même transaction que la transition) et d'US-219 (mode `REQUEST`) sans contredire les dépendances déclarées ; la consigne fail-closed sur `instant_book = false` s'adresse aux stories de recherche et de checkout, pas au livré. |
| 5   | MINEUR  | Même réserve que la revue argent (constat 1) sur la « lecture » de BR-PRICE-05 : décision produit présentée comme cohérence ; ADR-129 (« assiette à revoir si le fondateur retient P après promotions ») est la bonne formulation, que 08 devrait reprendre. Traité par l'argent.                      |

Verdict : APPROUVÉ
