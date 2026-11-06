# Passation US-049 (axe rls) — red team RLS, rôles et SECURITY DEFINER (2026-11-06, red-team, claude-sonnet-5-5)

- Fait : trois suites d'attaque sous les rôles de production, branchées sur les suites existantes (aucun script ajouté) :
  `packages/db/test/l0/redteam-rls/rt-rls-catalog.test.ts` et `rt-rls-actors.test.ts` (rattrapées par le motif `test/l0/**` de `pnpm test:l0`), `apps/api/test/int/redteam-rls-http.int.test.ts` (rattrapée par `pnpm test:int` de l'API). Rapport : `docs/team/redteam/L0-rls.md`.
- Reste : décision de l'orchestrateur sur chaque constat (bogue ou story) ; rejouer la suite après correction ; une revue sécurité Opus du rapport (revue dégradée TECH-007, Sonnet).
- Prochaine commande exacte : `pnpm --filter @rueda/db test:l0 -- redteam-rls` (PostgreSQL réel : la CI fait foi, ne jamais démarrer le PostgreSQL local).
- Pièges / hypothèses : un test rouge de ces dossiers est une faille trouvée, pas un défaut de test ; deux constats le restent volontairement (voir le rapport). `payment_psp_account` n'est lisible par `app_worker` que dans la base de test (GRANT de `test-migrations/9500`), exclu des balayages. L'échec `config_brand_asset` de `l0-us043-authorization-matrix` est antérieur à ces suites (course entre fichiers), à confirmer sur `main`.
- Paramètres créés (17 §7.2) : aucun. Entités / migrations : aucune.
- Tests ajoutés et état : voir le rapport (nombre de scénarios, bloqués, en faille). Décisions prises (ADR / DECISIONS) : aucune.
