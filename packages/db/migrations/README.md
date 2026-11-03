# Migrations SQL

Migrations de production, appliquées sous `migrator` par `src/migrate.ts` (US-005, ADR-044). Nommage `NNNN_<module>_<objet>.sql` (ex. `0003_avl_checkout_hold.sql`), une transaction par fichier, somme SHA-256 vérifiée : une migration appliquée ne se modifie plus. Chaque fichier `.sql` est analysé par `pnpm lint` (règle d'horloge, CONTRIBUTING « SQL et horloge »). Voir `packages/db/README.md`.

## Numérotation (revue architecture US-008, constat 3)

L'exécuteur refuse une migration plus ancienne que la dernière appliquée, et une migration appliquée ne se renumérote plus (somme SHA-256). D'où la règle :

1. Une nouvelle migration prend un numéro **strictement supérieur au plus grand numéro présent sur `origin/main` au moment de la fusion**. Quand `main` avance, l'auteur met sa branche à jour et **renumérote** ses migrations à la suite : c'est gratuit tant que rien n'est appliqué ailleurs.
2. **Aucune plage réservée.** Les migrations de production sont contiguës depuis `0000`, sans doublon ; les migrations de test (`test-migrations/`) sont ≥ `9000`.
3. Contrôle automatique : `src/numbering.test.ts` (`pnpm test:unit`) vérifie l'unicité, la contiguïté, le seuil des tests et, quand `origin/main` est disponible (dépôt complet), qu'aucune migration absente de `main` n'a un numéro inférieur ou égal au maximum de `main`.
4. L'exécuteur garde son refus : pas de mode « hors ordre ».
