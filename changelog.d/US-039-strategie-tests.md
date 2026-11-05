lot: L0
module: Qualité et tests

- Ajouté : stratégie de test exécutable `docs/qa/STRATEGIE_TESTS.md` (commande, emplacement et job de CI de chaque famille : unitaires, intégration, vecteurs dorés et oracles, L0, C1–C20, RLS-1 à RLS-28, fuzz C11, e2e, accessibilité ; écarts connus), contrôlée par `scripts/qa/test-strategy.test.mjs` dans `pnpm test:unit` (US-039)
- Ajouté : commandes racine `pnpm test:money` (vecteurs dorés puis oracles d'argent) et `pnpm test:e2e` (build du site puis Playwright) ; `test:rls` et `test:concurrency` non créés, `test:nightly` réservé à US-047 (ADR-086) (US-039)
- Modifié : CONTRIBUTING décrit les revues requises par type de story, le flux de revue, les règles de fusion et la reprise par un humain (US-039)
