# Revue architecture — US-046 « délai explicite du lint expand/contract » (PR n° 119) — 2026-11-12 (seconde passe)

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5)
Entrées : 1464701a061536ad8a073857579046f23b0eeae7..d98ccf15074c2c29f6122af7d5bd5cfda5831fb7 (PR n° 119 ; seconde passe après le correctif du fragment et du testTimeout ; relecture statique, PostgreSQL non démarré ; CI du run 43193207931 : 16 jobs verts sur 17, seul « revues indépendantes » est rouge, car il lit encore les revues CHANGEMENTS DEMANDÉS de la première passe)

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                      |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | MINEUR                           | L'incohérence relevée est résorbée : la suite unitaire de `packages/db` fixe un `testTimeout` de 30 s, comme la suite sur base (`vitest.shared.ts`) et les autres paquets. La voie de fond (configuration) est retenue plutôt qu'un correctif test par test. |
| 2   | MINEUR                           | Périmètre : un fichier de configuration de test, un test, un fragment de changelog et la passation. Aucune frontière de module, aucun schéma, aucun paramètre touché ; documentation conforme à la DoD, sans texte visible (pas d'enjeu quadrilingue).       |
| 3   | MINEUR                           | Marge de 30 s (60 s pour le lint) contre 0,4 s mesuré : suffisante à mesure que le nombre de migrations croît.                                                                                                                                               |

Verdict : APPROUVÉ
