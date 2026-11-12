# Revue securite (troisième passe) — US-109 (PR n° 110) — 2026-11-12

SHA revu : f45607ad3af7b7e8e0db51a98562c1dae1549082 (delta 958d5b3..f45607a)
Relecteur : securite / claude-sonnet-5-5 (autre modèle que l'auteur claude-opus-5-5). CI verte sur f45607a (17 jobs, selon l'orchestrateur) ; PostgreSQL non démarré ici.

**Verdict : APPROUVÉ**

## Bloquants

Aucun.

## Constats sur le delta

- Delta (`git diff 958d5b3..f45607a`) : une ligne `GRANT USAGE ON SCHEMA core TO cmd_golive_owner` dans `packages/db/test-migrations/9990_test_us109_review_queue_fixtures.sql` (retour arrière complété en tête de fichier), plus une note dans `docs/team/handoffs/US-109.md` l. 49. Aucun code applicatif, aucune migration `00NN`, aucun fichier protégé touché.
- Point 1 : `test-migrations/` n'est appliqué que par le harnais, sur la base de test principale (`packages/db/README.md` l. 28 et 533 ; ADR-044 « Jamais appliquées hors du harnais » ; RT-CONC-64 : le Dockerfile de production ne les copie pas). Le grant n'existe pas en production.
- Point 2 : le grant n'élargit rien et ne masque pas de défaut : tout propriétaire producteur de production a déjà `USAGE ON SCHEMA core` (0022 l. 36, 0027, 0028, 0032, 0037…) ; la fixture est alignée sur le cas réel. La consigne pour une story productrice future (donner USAGE sur `core` au propriétaire de sa commande) est écrite dans la passation.
- Point 3 : `cmd_golive_owner` reste NOLOGIN (`packages/db/bootstrap/0000_instance_roles.sql` l. 47) ; le grant ne porte que sur le schéma, sans droit de table ni EXECUTE. `app_api` ne gagne rien : aucun EXECUTE sur `core.support_enqueue_review` ni `core.support_close_review_item`.
- Point 4 : les assertions 42501 pour `app_api` (`packages/db/test/l0/l0-us109-review-queues-360.test.ts` l. 825 à 865, dont la clôture l. 849) sont intactes.

## Réserves non bloquantes

Aucune nouvelle ; les réserves de la seconde passe restent valables (pour architecture : rappeler la consigne USAGE sur `core` dans le README SUP à la première consommation).
