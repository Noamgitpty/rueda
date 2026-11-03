# Revue architecture — US-009 (fusion de US-008) — 2026-11-03

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l’auteur claude-opus-5-5)
Entrées : diff 269b903..6ab94c4, story US-009

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                                                                                                                                                         | Preuve (fichier:ligne, test)            | Décision |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------- |
| 1   | MINEUR                           | Numérotation contiguë et sans collision : 0010 et 0011 (US-010), 0012 à 0015 (US-008 : tables, fonctions, droits, supervision de l’outbox), 0016 à 0021 (US-009), soit 0010 à 0021 sans trou ni doublon, tous supérieurs au maximum précédent de `main`. La réserve de la revue précédente (0012 à 0015 réservées à US-008) est levée. À revérifier seulement si `main` avance avant la fusion. | `ls packages/db/migrations`             | accepté  |
| 2   | MINEUR                           | Aucun marqueur de conflit dans le dépôt ; le README du paquet porte les sections Audit, Outbox (renvoi à `migrations/README.md` pour la numérotation) et IAM, et liste 0012 à 0015. Les exclusions de `avl-schema.test.ts` (`audit_`, `outbox_`, `iam_`) suivent la règle « une famille de tables, un test d’inventaire ». Aucun changement de `docs/specs/`.                                   | README du paquet ; `avl-schema.test.ts` | accepté  |

Verdict : APPROUVÉ
