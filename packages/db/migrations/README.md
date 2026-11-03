# Migrations SQL

Migrations de production, appliquées sous `migrator` par `src/migrate.ts` (US-005, ADR-044). Nommage `NNNN_<module>_<objet>.sql` (ex. `0003_avl_checkout_hold.sql`), une transaction par fichier, somme SHA-256 vérifiée : une migration appliquée ne se modifie plus. Chaque fichier `.sql` est analysé par `pnpm lint` (règle d'horloge, CONTRIBUTING « SQL et horloge »). Voir `packages/db/README.md`.
