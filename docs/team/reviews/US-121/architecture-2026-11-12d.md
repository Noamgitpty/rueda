# Revue architecture — US-121, quatrième passe — 2026-11-12

Relecteur : architecture / claude-sonnet-5-5 (auteur : claude-opus-5-5 ; modèle différent de l'auteur)
Entrées : b1ac94cf1f209f7414eef6ab09641c9436425238..b765a644f4514e903d8d684e8f05307cc4fad627 ; PR #106 ; quatrième passe après `architecture-2026-11-12c.md`

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                           | Preuve                                                                 | Décision       |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------- |
| 1   | INFO    | **Réserve de couverture levée** (`proteccion`, `protecao`, `proteccao`) : le filet de la base couvre les plans de protection en es et pt, comme l'ADR-095 le promet.                                                                                                                                                              | Script ; ADR-095.                                                      | Aucune action. |
| 2   | INFO    | **Motif à trois alternatives** (`seguro` en segment délimité par des points, sigles par segment, racines par sous-chaîne) : cohérent, parité TS / SQL prouvée, ADR-095 décrit chaque alternative, les compromis assumés (liste complète) et la consigne de renommage ; la barrière principale reste le registre en liste blanche. | `editable-blocks.ts` ; `0062_config_content_legal_keys.sql` ; ADR-095. | Aucune action. |
| 3   | INFO    | Aucun changement de conception depuis la troisième passe (`layout.tsx`, `pageDescription`, migration 0062, catalogue v14, ordre des migrations, suivi des écarts au BOARD N-30 et N-31) : inchangé et accepté. Le diff ne porte que sur les tests, le motif, les plages d'invisibles, l'ADR et la passation.                      | Diff `b1ac94c..b765a64`.                                               | Aucune action. |
| 4   | MINEUR  | Suite : l'écran d'édition (US-120) devra citer le mot qui déclenche un refus « texte juridique » (faux positifs listés dans l'ADR) ; à reprendre dans le brief d'US-120.                                                                                                                                                          | ADR-095.                                                               | Non bloquant.  |

Aucun constat CRITIQUE ou MAJEUR.

Verdict : APPROUVÉ
