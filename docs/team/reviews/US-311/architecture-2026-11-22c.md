# Revue delta architecture — US-311 « Vues de la bêta, KPI de sortie et rapprochement par jambe assisté » (PR n° 290, instantané des KPI en lecture seule) — 2026-11-22 (c)

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 0b5d3322..8f195c6b

Contexte : delta relu = `git diff origin/main...8f195c6b` (PR n° 290, correctif de test : instantané des KPI en lecture seule, écritures validées avant, fixture `test_fixture.us311_kpi_oracle`, boucle de nouvel essai supprimée). CI du run 45032753051 verte. PostgreSQL non démarré ici : les preuves L0 sont relues, pas rejouées.

| #   | Gravité | Constat                                                                                                                                                               | Preuve                            | Décision         |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------- |
| 1   | INFO    | **Aucune incidence** : aucune frontière de module, aucun ADR ni modèle de données livré ; correctif de test seul, fixture sous `test-migrations/` hors chaîne livrée. | `git diff origin/main...8f195c6b` | Aucun changement |

Verdict : APPROUVÉ
