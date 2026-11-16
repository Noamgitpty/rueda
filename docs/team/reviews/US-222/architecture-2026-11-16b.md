# Revue architecture — US-222 « vecteur doré TJ09c, checkout PY (N-151) » (PR n° 180) — 2026-11-16

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : b28addf2..7e85cf78

Contexte : Cohérence de numérotation et de traçabilité avec la PR #178 fusionnée (`origin/main` d13142e7) ; la fusion avec main est sans conflit (`git merge-tree` propre).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | L2R-09 est libre sur main : L2R-01 à 03 sont dans le journal de 08, L2R-04 à 08 dans celui de 17, L2R-10 à 18 dans 16, 17 et 10b (#178) ; aucune collision. L2R-09 est inscrit au journal de 08, là où se trouve la ligne TJ09c ; le saut 03 vers 09 dans ce journal s'explique par la répartition des numéros entre documents, et la phrase de source (« Complément du 2026-11-16 ») rend la provenance explicite. |
| 2   | MINEUR  | Traçabilité N-151 : la ligne du BOARD décrit exactement ce vecteur (D2 sans lignes non taxées, F au barème, 1 265 002) et renvoie aux revues qa d'US-208 (#174 n° 3, #175 n° 3) comme le journal. Le README de `@rueda/money` (59 lignes, TJ09c) et le commentaire de `registry.json` sont à jour. Réserve : N-151 passera à « fait » dans le BOARD à la fusion (hors périmètre, orchestrateur).                    |
| 3   | MINEUR  | Aucune décision nouvelle, aucun interrupteur touché ; modification de `docs/specs/` par demande de fusion revue (architecture, argent, sécurité pour `scripts/ci/`), conforme à CLAUDE.md.                                                                                                                                                                                                                          |

Verdict : APPROUVÉ
