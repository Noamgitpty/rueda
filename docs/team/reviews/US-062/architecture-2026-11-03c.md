# Revue architecture — US-062 — 2026-11-03 (reprise c)

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5)
Entrées : diff 69eb3b4..8018a34 (migration 0035 seule), story US-062 de 19. Revue complétée par la CI base de données verte rapportée par l'orchestrateur.

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                                                                | Preuve (fichier:ligne, test)                                                                | Décision |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------- |
| 1   | MINEUR                           | Correctif conforme au précédent d'0032 et à ADR-044 amendé (SET TRUE, INHERIT FALSE, aucun droit hérité) ; la liste blanche RLS-15 inscrit déjà host_view_owner pour host_covers_vehicle. Aucun changement d'architecture ni d'ADR requis. La CI base de données verte lève la réserve de première CI. | packages/db/migrations/0035_host_permissions_minimization.sql (section 5 et retour arrière) | accepté  |

Verdict : APPROUVÉ
